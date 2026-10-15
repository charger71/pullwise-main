// Turns a backup file (shop-backup-YYYY-MM-DD.json.gz, downloaded from Admin -> Staff -> Backup) into SQL you can run. It never touches the database itself.
//
//   node tools/restore.mjs <backup-file> <out-folder> [--tables items,customers] [--replace]
//
// Writes SQL files into <out-folder> (restore-<table>.sql; a big table is split into .part01, .part02 ... because
// Supabase refuses requests over about 1 MB), plus restore-all.txt listing them in the order to run them. Run each with:
//   supabase db query --linked -f <file>
//
//   default     adds the backed-up rows and skips any whose key already exists (nothing is overwritten)
//   --replace   first DELETES every row in the table, then loads the backup (use after data was lost or damaged)
//
// Each file is its own transaction, with triggers and foreign-key checks switched off while it loads, so the audit
// log and "updated" columns are not touched. Identity counters are moved past the restored ids. The sign-in
// list (auth_users) is NOT restored: it is there for reference (customers sign up again; staff are re-added
// from Admin -> Staff). Fixing the schema is a separate job: it comes from supabase/migrations in git.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROWS_PER_INSERT = 400;
const PART_BYTES = 800_000; // each file stays under Supabase's ~1 MB request limit
const sqlString = (s) => `'${s.replace(/'/g, "''")}'`; // JSON text only; no backslash escapes with standard_conforming_strings on

/**
 * SQL for one table from its backed-up rows, as a list of parts. Supabase refuses requests over about 1 MB, so a
 * big table is split; each part is its own transaction (the first one also deletes first in replace mode).
 */
export function tableSql(name, meta, rows, { replace = false } = {}) {
  const generated = new Set(meta.generated ?? []);
  const columns = rows.length ? Object.keys(rows[0]).filter((c) => !generated.has(c)) : [];
  const q = (c) => `"${c.replace(/"/g, '""')}"`;
  const head = ['begin;', 'set local session_replication_role = replica;'];
  const override = (meta.identity_always ?? []).length ? ' overriding system value' : '';
  const conflict = replace || !meta.pk ? '' : ' on conflict do nothing';
  const insert = (chunk) => `insert into public.${q(name)} (${columns.map(q).join(', ')})${override} select ${columns.map(q).join(', ')} from jsonb_populate_recordset(null::public.${q(name)}, ${sqlString(JSON.stringify(chunk))}::jsonb)${conflict};`;
  const tail = (meta.identity_always ?? []).map((col) => `select setval(pg_get_serial_sequence('public.${name}', '${col}'), greatest((select coalesce(max(${q(col)}), 0) from public.${q(name)}), 1));`);

  const parts = [];
  let cur = [...head];
  if (replace) cur.push(`delete from public.${q(name)};`);
  let size = 0;
  const flush = () => {
    parts.push([...cur, 'commit;'].join('\n') + '\n');
    cur = [...head];
    size = 0;
  };
  for (let i = 0; i < rows.length; ) {
    // Grow a statement until it is about to pass the part limit.
    let n = Math.min(ROWS_PER_INSERT, rows.length - i);
    let sql = insert(rows.slice(i, i + n));
    while (sql.length > PART_BYTES && n > 1) (n = Math.ceil(n / 2)), (sql = insert(rows.slice(i, i + n)));
    if (size + sql.length > PART_BYTES && size > 0) flush();
    cur.push(sql);
    size += sql.length;
    i += n;
  }
  cur.push(...tail);
  flush();
  return parts;
}

// Parents before children, so the files also work in order when foreign keys are checked.
const FIRST = ['staff', 'settings', 'categories', 'customers', 'items', 'pages', 'events', 'posts', 'surveys'];

export function main(argv) {
  const [dir, out] = argv.filter((a) => !a.startsWith('--'));
  const replace = argv.includes('--replace');
  const only = argv.find((a) => a.startsWith('--tables='))?.slice(9).split(',') ?? (argv.includes('--tables') ? argv[argv.indexOf('--tables') + 1].split(',') : null);
  if (!dir || !out) throw new Error('Usage: node tools/restore.mjs <backup-file> <out-folder> [--tables a,b] [--replace]');
  // A backup is the single .json.gz file from Admin -> Staff -> Backup (or a folder of <table>.json.gz files).
  let manifest;
  let rowsOf;
  if (/\.json(\.gz)?$/.test(dir)) {
    const raw = readFileSync(dir);
    const file = JSON.parse((dir.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
    if (file.format !== 'shop-backup-1') throw new Error('That file is not a shop backup.');
    manifest = { tables: Object.fromEntries(Object.entries(file.tables).map(([n, t]) => [n, { pk: t.pk, generated: t.generated, identity_always: t.identity_always }])) };
    rowsOf = (n) => file.tables[n].rows;
  } else {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    rowsOf = (n) => JSON.parse(gunzipSync(readFileSync(join(dir, `${n}.json.gz`))).toString('utf8'));
  }
  mkdirSync(out, { recursive: true });
  const names = Object.keys(manifest.tables).filter((n) => n !== 'auth_users' && (!only || only.includes(n)));
  names.sort((a, b) => (FIRST.indexOf(a) + 1 || 99) - (FIRST.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const files = [];
  for (const name of names) {
    const rows = rowsOf(name);
    const parts = tableSql(name, manifest.tables[name], rows, { replace });
    parts.forEach((sql, i) => {
      const file = join(out, parts.length === 1 ? `restore-${name}.sql` : `restore-${name}.part${String(i + 1).padStart(2, '0')}.sql`);
      writeFileSync(file, sql);
      files.push(file);
    });
  }
  writeFileSync(join(out, 'restore-all.txt'), files.join('\n') + '\n');
  console.log(`Wrote ${files.length} files to ${out}${replace ? ' (REPLACE mode: each file deletes the table first)' : ''}`);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

#!/usr/bin/env node
// Guards the rule that keeps deploys from touching shop data (README → "One codebase, many shops"):
// a migration changes the schema, never a shop's own content. Every shop's database runs every migration, so an
// `update public.pages …` would overwrite text that shop's staff wrote.
//
//   node tools/check-migrations.js      # exits 1 and lists the problems, if any
//
// Checked in migrations newer than CHECKED_AFTER (older ones already ran everywhere before the rule existed):
//  * no update / delete / truncate on pages, faqs or settings, and no insert into them that overwrites
//    (`on conflict … do update`) or could fail on an existing row (no `on conflict … do nothing`);
//  * statements inside function bodies are fine (they run when staff act, not at deploy), but not in `do` blocks.
// A migration that truly must change shop content (a data fix every shop needs) says why on a line of its own:
//   -- content-change-ok: <reason>
// All migration file names are checked too: 14-digit version, lower_snake name, no duplicate versions.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKED_AFTER = '20270103000000';
export const PROTECTED = ['pages', 'faqs', 'settings'];

const T = `(?:public\\.)?(?:${PROTECTED.join('|')})\\b`;
const RULES = [
  [new RegExp(`\\bupdate\\s+(?:only\\s+)?${T}`, 'i'), 'updates shop content'],
  [new RegExp(`\\bdelete\\s+from\\s+(?:only\\s+)?${T}`, 'i'), 'deletes shop content'],
  [new RegExp(`\\btruncate\\s+(?:table\\s+)?(?:only\\s+)?${T}`, 'i'), 'truncates shop content'],
];
const INSERT = new RegExp(`\\binsert\\s+into\\s+${T}`, 'i');

/** The SQL that runs at deploy time: comments, strings' and quoted names' insides removed, function bodies dropped, `do` blocks kept. */
export function deployTimeSql(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    let m;
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (rest[0] === "'") {
      m = /^'(?:[^']|'')*'/.exec(rest);
      i += m ? m[0].length : rest.length;
      out += "''";
    } else if (rest[0] === '"') {
      m = /^"(?:[^"]|"")*"/.exec(rest); // a quoted name, e.g. a policy called "staff update pages"
      i += m ? m[0].length : rest.length;
      out += '""';
    } else if ((m = /^\$[A-Za-z_]*\$/.exec(rest))) {
      const end = sql.indexOf(m[0], i + m[0].length);
      const body = sql.slice(i + m[0].length, end < 0 ? sql.length : end);
      i = end < 0 ? sql.length : end + m[0].length;
      out += /\bdo\s*$/i.test(out) ? ` ${deployTimeSql(body)} ` : ' '; // a `do` block runs now; a function body later
    } else {
      out += sql[i++];
    }
  }
  return out;
}

/** Problems in one migration's SQL (empty when it's fine). */
export function checkMigration(sql) {
  if (/^[ \t]*--[ \t]*content-change-ok:[ \t]*\S/im.test(sql)) return [];
  const problems = [];
  for (const stmt of deployTimeSql(sql).split(';')) {
    const s = stmt.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    for (const [re, why] of RULES) if (re.test(s)) problems.push(`${why}: ${s.slice(0, 100)}`);
    if (INSERT.test(s)) {
      if (/\bon\s+conflict\b[\s\S]*\bdo\s+update\b/i.test(s)) problems.push(`overwrites shop content (on conflict do update): ${s.slice(0, 100)}`);
      else if (!/\bon\s+conflict\b[\s\S]*\bdo\s+nothing\b/i.test(s)) problems.push(`inserts without "on conflict do nothing", so it fails where the row exists: ${s.slice(0, 100)}`);
    }
  }
  return problems;
}

/** Problems with the set of file names. */
export function checkNames(names) {
  const problems = [];
  const seen = new Map();
  for (const n of names) {
    const m = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(n);
    if (!m) { problems.push(`${n}: name must be <14-digit version>_<lower_snake_name>.sql`); continue; }
    if (seen.has(m[1])) problems.push(`${n}: same version as ${seen.get(m[1])}`);
    seen.set(m[1], n);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
  const problems = checkNames(names);
  for (const n of names) {
    if (n.slice(0, 14) <= CHECKED_AFTER) continue;
    for (const p of checkMigration(fs.readFileSync(path.join(dir, n), 'utf8'))) problems.push(`${n}: ${p}`);
  }
  if (problems.length) {
    console.error(`Migration check failed (see tools/check-migrations.js for the rules):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`migrations ok (${names.length} files)`);
}

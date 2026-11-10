// Brings the demo shop's database up to today with realistic, rule-following data, then checks every rule.
//   npm run demo-data                run refresh.sql, then check.sql
//   npm run demo-data -- --hold-week keep every title released this week (Sun-Sat) unreceived, so Admin > Ordering
//                                    > Received has the whole week to tick (for a demo given late in the week)
//   npm run demo-data -- --check     only check, change nothing
//   npm run demo-data -- --dry-run   with any of the above: do everything in a transaction that is never committed and
//                                    print what the data would look like and whether every rule passes; changes nothing
//   npm run demo-data -- --reset --yes   clear the customer-side data first (reset.sql: everything except staff, the
//                                    catalog and shop content), then build ~55 customers and ~100 days of history
//                                    from scratch, all in one transaction. Without --yes it only shows what would go.
// With no options in a terminal it asks what you want, so there is nothing to remember: just `npm run demo`.
// Needs the Supabase CLI linked to the demo project; it refuses to run against any other project.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_REF = 'ltjkhteibtuiywhoaqic';
let args = process.argv.slice(2);

function die(msg) { console.error(msg); process.exit(1); }

const linked = (() => { try { return readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim(); } catch { return ''; } })();
if (linked !== DEMO_REF) die(`Linked Supabase project is "${linked || 'none'}", not the demo project (${DEMO_REF}). Run: supabase link --project-ref ${DEMO_REF}`);

async function askWhatToDo() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q) => (await rl.question(q)).trim().toLowerCase();
  try {
    console.log(`Demo shop (${DEMO_REF}). What do you want to do?
  1) Bring the data up to today            (safe, adds only what is missing)
  2) Bring it up to today, and keep this week's titles unreceived (for the Received tab)
  3) Wipe the customer side and rebuild from scratch (staff, catalog and shop content are kept)
  4) Only check the data, change nothing`);
    const pick = await ask('Choose 1-4 [1]: ') || '1';
    if (pick === '4') return ['--check'];
    if (!['1', '2', '3'].includes(pick)) die('Nothing chosen.');
    const out = pick === '3' ? ['--reset'] : pick === '2' ? ['--hold-week'] : [];
    if (await ask('Preview first without changing anything? [Y/n]: ') !== 'n') return [...out, '--dry-run'];
    if (pick === '3') {
      const [n] = query(`select (select count(*) from public.customers where user_id is null) customers,
        (select count(*) from public.reservation_orders) orders, (select count(*) from public.reservations) reservations`);
      if (await ask(`This deletes ${n.customers} customers, ${n.orders} orders and ${n.reservations} reservation lines, then rebuilds. Type "reset" to continue: `) !== 'reset') die('Cancelled.');
      out.push('--yes');
    }
    return out;
  } finally { rl.close(); }
}

function query(sqlText) {
  const dir = mkdtempSync(join(tmpdir(), 'demo-data-'));
  const file = join(dir, 'q.sql');
  writeFileSync(file, sqlText);
  const r = spawnSync('supabase', ['db', 'query', '--linked', '-f', file, '-o', 'json'], { cwd: root, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) die(`${r.stderr || r.stdout}`.trim());
  // A statement with no result set prints no JSON object (just "[ ]"); the run itself succeeded.
  const start = r.stdout.indexOf('{');
  return start < 0 ? [] : JSON.parse(r.stdout.slice(start)).rows || [];
}

if (!args.length && process.stdin.isTTY) args = await askWhatToDo();

const dry = args.includes('--dry-run');
if (args.includes('--reset') && !args.includes('--yes') && !dry) {
  const [n] = query(`select (select count(*) from public.customers where user_id is null) customers,
    (select count(*) from public.reservation_orders) orders, (select count(*) from public.reservations) reservations,
    (select count(*) from public.email_log) emails, (select count(*) from public.staff) staff`);
  die(`--reset would delete ${n.customers} customers, ${n.orders} orders, ${n.reservations} reservation lines, ${n.emails} emails and the rest of the
customer-side data, keep all ${n.staff} staff, and rebuild it. Run again with --yes to do it.`);
}

if (!args.includes('--check')) {
  let sql = readFileSync(join(root, 'tools/demo-data/refresh.sql'), 'utf8');
  if (args.includes('--reset')) {
    const reset = readFileSync(join(root, 'tools/demo-data/reset.sql'), 'utf8');
    sql = sql.replace('-- @options', `-- @options\nselect set_config('demo.seed', 'on', true);\n${reset}`);
  }
  if (args.includes('--hold-week')) sql = sql.replace('-- @options', "-- @options\nselect set_config('demo.hold_week', 'on', true);");
  if (dry) {
    // Stand in for the commit: run the checks and a summary inside the transaction, then let it roll back.
    const summary = `
      union all select 'info: customers', count(*) from public.customers
      union all select 'info: staff kept', count(*) from public.staff
      union all select 'info: orders', count(*) from public.reservation_orders
      union all select 'info: reservation lines', count(*) from public.reservations
      union all select 'info: days with website orders (last 45)', count(distinct (created_at at time zone 'America/New_York')::date) from public.reservation_orders where kind = 'order' and created_at > now() - interval '45 days'
      union all select 'info: days copies arrived (last 45)', count(distinct arrived_on) from public.reservations where arrived_on >= (now() at time zone 'America/New_York')::date - 45
      union all select 'info: ordered, waiting to be received', count(*) from public.reservations where status = 'ordered'
      union all select 'info: arrived, waiting for pickup', count(*) from public.reservations where status = 'arrived'
      union all select 'info: picked up', count(*) from public.reservations where status = 'picked_up'
      union all select 'info: emails', count(*) from public.email_log
      union all select 'info: chats (open, unread)', count(*) from public.chat_conversations where status = 'open' and unread_staff > 0
      union all select 'info: chats', count(*) from public.chat_conversations
      union all select 'info: searches (no results)', count(*) from public.search_log where titles = 0
      union all select 'info: searches', count(*) from public.search_log
      union all select 'info: customer re-orders', count(*) from public.reservations where reorder
      union all select 'info: shelf re-orders', count(*) from public.stock_reorders
      union all select 'info: stock alerts', count(*) from public.stock_alerts
      union all select 'info: app users', count(*) from public.app_visits
      union all select 'info: uncollected past the hold', count(*) from public.reservations r, public.settings s where s.id = 1 and r.status = 'arrived' and r.arrived_on < (now() at time zone 'America/New_York')::date - s.hold_days
      union all select 'info: unread survey answers and sign-ups', (select count(*) from public.survey_responses where not seen) + (select count(*) from public.event_signups where not seen)`;
    const check = readFileSync(join(root, 'tools/demo-data/check.sql'), 'utf8').trim();
    const rows = query(sql.replace(/commit;\s*$/, `${check}\n${summary};`));
    console.log('DRY RUN: nothing was changed.');
    for (const r of rows) console.log(r.rule.startsWith('info:') ? `      ${r.rule.slice(6)}: ${r.bad}` : `${Number(r.bad) ? 'FAIL' : ' ok '}  ${r.rule}${Number(r.bad) ? ` (${r.bad})` : ''}`);
    process.exit(rows.some(r => !r.rule.startsWith('info:') && Number(r.bad) > 0) ? 1 : 0);
  }
  query(sql);
  console.log(args.includes('--reset') ? 'Demo data reset and rebuilt.' : 'Demo data brought up to date.');
}

const rows = query(readFileSync(join(root, 'tools/demo-data/check.sql'), 'utf8'));
const bad = rows.filter(r => Number(r.bad) > 0);
for (const r of rows) console.log(`${Number(r.bad) ? 'FAIL' : ' ok '}  ${r.rule}${Number(r.bad) ? ` (${r.bad})` : ''}`);

const [wk] = query(`
  select count(distinct r.item_id) titles, count(*) copies
  from public.reservations r join public.items i on i.id = r.item_id
  where r.status in ('open','ordered','reordered')
    and i.release_date between (now() at time zone 'America/New_York')::date - extract(dow from (now() at time zone 'America/New_York')::date)::int
                           and (now() at time zone 'America/New_York')::date - extract(dow from (now() at time zone 'America/New_York')::date)::int + 6`);
console.log(`Received tab this week: ${wk.copies} copies across ${wk.titles} titles.`);
if (bad.length) die(`${bad.length} rule(s) broken.`);

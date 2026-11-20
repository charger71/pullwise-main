// node tools/shop-status.test.mjs
import assert from 'node:assert/strict';
import { shopRows, shopLevel, statusEmail, ago, failureEmail } from './shop-status.mjs';

const now = Date.parse('2026-11-20T13:00:00Z');
const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();
const job = (name, schedule, h, extra = {}) => ({ name, schedule, active: true, last_start: hoursAgo(h), last_status: 'succeeded', ...extra });
const healthy = {
  id: 'derby', name: 'Derby Comics', catalog: false,
  settings: { pull_list_email_enabled: true, pull_list_email_last_sent: '2026-11-18', arrival_email_enabled: true },
  health: { jobs: [job('flip-item-statuses', '5 * * * *', 0.5), job('weekly-pull-list', '0 * * * *', 0.5), job('arrival-email', '10 * * * *', 0.3), job('pull-import-cleanup', '30 3 * * *', 10)], arrival_waiting: 0, http_errors_24h: 0 },
  sync: { last_run_at: hoursAgo(0.5), last_ok_at: hoursAgo(0.5), last_error: null, cursor_at: hoursAgo(1) },
  behind: 0, missing: 0,
  lastBackup: { ok: true, created_at: hoursAgo(5), message: 'Automatic nightly backup: 41,956 rows in 61 tables (3.3 MB)' },
  emails: { sent: 12, failed: 0 },
  activity: { customers: 340, newCustomers: 2, openReservations: 1210, upcomingTitles: 4100 },
};
const label = (rows, l) => rows.find((r) => r.label === l);

// A healthy shop: everything OK, the jobs on one line, and an activity line.
let rows = shopRows(healthy, now);
assert.equal(shopLevel(rows), 'ok');
assert.equal(label(rows, 'Scheduled jobs').text, '4 jobs running on time');
assert.equal(label(rows, 'Catalog sync').text, 'Worked 30 minutes ago; up to date');
assert.equal(label(rows, 'Nightly backup').text, 'Backed up 5 hours ago: 41,956 rows in 61 tables (3.3 MB)');
assert.equal(label(rows, 'Emails').text, '12 emails sent in the last 24 hours');
assert.equal(label(rows, 'Activity').level, 'info');
assert.equal(label(rows, 'Activity').text, '340 customers (2 new in the last 24 hours) · 1,210 open reservations · 4,100 upcoming titles');

// Problems: a failed job, a late one, a broken sync, missing titles, no recent backup, failed emails.
rows = shopRows({
  ...healthy,
  health: { jobs: [job('flip-item-statuses', '5 * * * *', 1, { last_status: 'failed', last_message: 'ERROR: boom' }), job('arrival-email', '10 * * * *', 6), job('pull-import-cleanup', '30 3 * * *', 2, { active: false })], arrival_waiting: 3, http_errors_24h: 2 },
  sync: { last_run_at: hoursAgo(0.2), last_ok_at: hoursAgo(5), last_error: 'Catalog unreachable', cursor_at: hoursAgo(6) },
  missing: 495,
  lastBackup: { ok: true, created_at: hoursAgo(40) },
  emails: { sent: 3, failed: 1 },
}, now);
assert.equal(shopLevel(rows), 'bad');
assert.equal(label(rows, 'Title statuses').level, 'bad');
assert.match(label(rows, 'Title statuses').text, /^Last run failed 60 minutes ago: ERROR: boom$/);
assert.deepEqual([label(rows, '“Your books are in” email').level, label(rows, '“Your books are in” email').text], ['warn', 'Last ran 6 hours ago (it should run every hour)']);
assert.deepEqual([label(rows, 'Pull list import cleanup').level, label(rows, 'Pull list import cleanup').text], ['warn', 'Switched off']);
assert.equal(label(rows, 'Scheduled jobs'), undefined, 'no OK line when no job is fine');
assert.equal(label(rows, 'Catalog sync').level, 'bad');
assert.match(label(rows, 'Catalog sync').text, /Last run failed 12 minutes ago: Catalog unreachable \(last worked 5 hours ago\)/);
assert.deepEqual([label(rows, 'Catalog titles').level, label(rows, 'Catalog titles').text.slice(0, 41)], ['warn', '495 upcoming catalog titles not in this s']);
assert.equal(label(rows, 'Nightly backup').level, 'bad');
assert.equal(label(rows, 'Emails').level, 'bad');
assert.equal(label(rows, 'Emails').text, '3 emails sent in the last 24 hours; 1 failed; 2 calls to the email service failed; 3 titles waiting for a “Your books are in” email');

// Email features switched off in Shop Settings aren't reported; a weekly email not sent for over 8 days is.
rows = shopRows({ ...healthy, settings: { pull_list_email_enabled: false, arrival_email_enabled: false }, health: { jobs: [job('weekly-pull-list', '0 * * * *', 50), job('arrival-email', '10 * * * *', 50)] } }, now);
assert.equal(label(rows, 'Weekly pull list email'), undefined);
assert.equal(label(rows, '“Your books are in” email'), undefined);
rows = shopRows({ ...healthy, settings: { ...healthy.settings, pull_list_email_last_sent: '2026-11-05' } }, now);
assert.deepEqual([label(rows, 'Weekly pull list email').level, label(rows, 'Weekly pull list email').text], ['warn', 'Last sent 15 days ago (it goes out weekly)']);

// A sync that's merely waiting for its next hourly run is fine; one that hasn't caught up for hours is a Check.
assert.equal(label(shopRows({ ...healthy, behind: 127 }, now), 'Catalog sync').level, 'ok');
assert.match(label(shopRows({ ...healthy, behind: 127 }, now), 'Catalog sync').text, /127 catalog changes to copy on the next run/);
assert.equal(label(shopRows({ ...healthy, behind: 127, sync: { ...healthy.sync, last_ok_at: hoursAgo(2.5) } }, now), 'Catalog sync').level, 'warn');
assert.equal(label(shopRows({ ...healthy, sync: { last_ok_at: hoursAgo(4) } }, now), 'Catalog sync').level, 'warn');
assert.equal(label(shopRows({ ...healthy, sync: null }, now), 'Catalog sync').text, 'Has never run');
assert.equal(label(shopRows({ ...healthy, health: null }, now), 'Scheduled jobs').level, 'bad');

// The master catalog: no sync of its own; its daily imports, with what each left out.
const catalog = {
  ...healthy, id: 'catalog', name: 'Pullwise Catalog', catalog: true, sync: undefined,
  imports: { prh_import: { ok: true, created_at: hoursAgo(2), message: 'PRH, next 13 weeks: 0 added' }, lunar_import: { ok: false, created_at: hoursAgo(3), message: 'Lunar import failed: timeout' } },
  leftOut: { prh: 478, lunar: 727 },
};
rows = shopRows(catalog, now);
assert.equal(label(rows, 'Catalog sync'), undefined);
assert.equal(label(rows, 'Automatic PRH import').text, 'Ran 2 hours ago: PRH, next 13 weeks: 0 added; 478 titles left out');
assert.equal(label(rows, 'Automatic Lunar import').level, 'bad');
assert.equal(label(shopRows({ ...catalog, imports: { prh_import: { ok: true, created_at: hoursAgo(60), message: 'x' } } }, now), 'Automatic PRH import').level, 'warn');
assert.equal(label(shopRows({ ...catalog, imports: {} }, now), 'Automatic Lunar import').text, 'Has not run yet');

// The email: subject counts, worst shops first, every shop's lines, escaped HTML.
const reports = [
  { id: 'catalog', name: 'Pullwise Catalog', domain: 'catalog.getpullwise.com', rows: shopRows(catalog, now) },
  { id: 'derby', name: 'Derby <Comics>', domain: 'derbycomics.com', rows: shopRows(healthy, now) },
  { id: 'pops', name: 'Pop’s Comics', domain: '', rows: shopRows({ ...healthy, missing: 3 }, now) },
];
const mail = statusEmail(reports, '2026-11-20');
assert.equal(mail.subject, 'Pullwise status: 1 problem, 1 to check (3 shops, Fri, Nov 20)');
const order = ['Pullwise Catalog', 'Pop’s Comics', 'Derby <Comics>'].map((n) => mail.text.indexOf(`${n} (`));
assert.ok(order[0] < order[1] && order[1] < order[2], 'problem shops first, then checks, then OK');
assert.match(mail.text, /Problem Pullwise Catalog \(catalog\): Automatic Lunar import/);
assert.match(mail.text, /OK {6}Derby <Comics> \(derby\)\n/);
assert.match(mail.text, / {2}✗ Automatic Lunar import: Last run failed 3 hours ago: Lunar import failed: timeout/);
assert.ok(mail.html.includes('Derby &lt;Comics&gt;') && !mail.html.includes('Derby <Comics>'));
assert.equal(statusEmail([reports[1]], '2026-11-20').subject, 'Pullwise status: everything OK (1 shop, Fri, Nov 20)');
assert.equal(statusEmail([{ id: 'x', name: 'X', rows: [{ level: 'bad', label: 'Shop', text: 'Couldn’t read it: 401' }] }], '2026-11-20').subject, 'Pullwise status: 1 problem (1 shop, Fri, Nov 20)');

assert.equal(ago(hoursAgo(0.01), now), 'just now');
assert.equal(ago(hoursAgo(72), now), '3 days ago');
const failed = failureEmail('fetch <failed>', '2026-11-20');
assert.equal(failed.subject, 'Pullwise status: the report failed (2026-11-20)');
assert.ok(failed.html.includes('fetch &lt;failed&gt;'));
console.log('shop status tests passed');

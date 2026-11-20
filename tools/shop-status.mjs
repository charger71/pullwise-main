#!/usr/bin/env node
// Daily status email: every shop in shops.json in one message, so a problem in any of them is seen the same morning
// (.github/workflows/status-report.yml). For each shop, read with its service key as the nightly backup does:
//   - its scheduled database jobs (the Dashboard's System Health: staff_health), and the weekly pull list email;
//   - the catalog sync: when it last worked, how many catalog changes it hasn't copied yet, and any upcoming catalog
//     titles the shop doesn't have at all (a restored shop whose sync skipped some, as popscomics502 did);
//   - the nightly backup;
//   - emails sent and failed in the last 24 hours;
//   - on the master catalog, the daily PRH and Lunar imports and how many titles each left out;
//   - a line of activity: customers, open reservations, upcoming titles.
// Each line is OK, Check (worth a look) or Problem (something failed or stopped); the subject says how many of each.
// The email goes to STATUS_EMAIL from the catalog's server, as reports@pullwise.shop (tools/catalog-job.mjs sendEmail →
// the catalog's report-email function), and is recorded in the catalog's Admin → Emails. A shop that can't be read is a Problem line of its own; the others are still reported.
//
//   node tools/shop-status.mjs             # read every shop and send the email
//   node tools/shop-status.mjs --dry-run   # read every shop and print the report, send nothing
//
// Needs SUPABASE_ACCESS_TOKEN (each shop's service key is read with it) and @supabase/supabase-js (the workflow
// installs it), and STATUS_EMAIL to send; the catalog needs its RESEND_API_KEY function secret.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobCadence } from '../admin/cron.js';
import { serviceClient, catalogShop, sendEmail } from './catalog-job.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3600000;
const JOB_NAMES = {
  'flip-item-statuses': 'Title statuses',
  'apply-subscriptions': 'Pull list follows',
  'weekly-pull-list': 'Weekly pull list email',
  'arrival-email': '“Your books are in” email',
  'pickup-ladder': 'Unclaimed books reminders',
  'pull-import-cleanup': 'Pull list import cleanup',
};
const DAILY_IMPORTS = { prh_import: 'Automatic PRH import', lunar_import: 'Automatic Lunar import' };
export const LEVEL_WORD = { ok: 'OK', warn: 'Check', bad: 'Problem', info: '' };

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const brief = (s, n = 140) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? '');

/** "just now", "40 minutes ago", "5 hours ago", "3 days ago", counted from `now`. */
export function ago(iso, now) {
  const min = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  if (min < 2) return 'just now';
  if (min < 90) return `${min} minutes ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} hours ago`;
  return `${Math.round(min / 1440)} days ago`;
}

/**
 * One shop's status lines from what was read for it (gatherShop). Pure, so it can be tested.
 * @param d    { id, name, catalog, settings, health, sync, behind, missing, lastBackup, emails, imports, leftOut, activity }
 * @param now  Date.now()
 * @returns [{ level: 'ok' | 'warn' | 'bad' | 'info', label, text }]
 */
export function shopRows(d, now) {
  const rows = [];
  const add = (level, label, text) => rows.push({ level, label, text });

  // Scheduled jobs: only the ones needing attention are listed; the rest are one OK line.
  const fine = [];
  for (const j of d.health?.jobs ?? []) {
    const label = JOB_NAMES[j.name] ?? j.name;
    if (j.name === 'weekly-pull-list' && !d.settings?.pull_list_email_enabled) continue;
    if (j.name === 'arrival-email' && !d.settings?.arrival_email_enabled) continue;
    if (!j.active) add('warn', label, 'Switched off');
    else if (!j.last_start) add('warn', label, 'Has not run yet');
    else if (j.last_status === 'failed') add('bad', label, `Last run failed ${ago(j.last_start, now)}${j.last_message ? `: ${brief(j.last_message)}` : ''}`);
    else {
      const { every, staleMs } = jobCadence(j.schedule);
      if (now - new Date(j.last_start) > staleMs) add('warn', label, `Last ran ${ago(j.last_start, now)} (it should run ${every})`);
      else fine.push(label);
    }
  }
  const sent = d.settings?.pull_list_email_last_sent;
  if (d.settings?.pull_list_email_enabled && sent) {
    const days = Math.round((now - Date.parse(`${sent}T12:00:00Z`)) / (24 * HOUR));
    if (days > 8) add('warn', 'Weekly pull list email', `Last sent ${days} days ago (it goes out weekly)`);
  }
  if (d.health) {
    if (fine.length) add('ok', 'Scheduled jobs', `${plural(fine.length, 'job')} running on time`);
  } else add('bad', 'Scheduled jobs', 'Couldn’t read them (System Health)');

  // The catalog sync (every shop but the catalog itself).
  if (!d.catalog) {
    const s = d.sync;
    if (!s?.last_ok_at) add('bad', 'Catalog sync', s?.last_error ? `Has never worked: ${brief(s.last_error)}` : 'Has never run');
    else if (s.last_error && s.last_run_at && new Date(s.last_run_at) > new Date(s.last_ok_at)) add('bad', 'Catalog sync', `Last run failed ${ago(s.last_run_at, now)}: ${brief(s.last_error)} (last worked ${ago(s.last_ok_at, now)})`);
    else if (now - new Date(s.last_ok_at) > 3 * HOUR) add('warn', 'Catalog sync', `Last worked ${ago(s.last_ok_at, now)} (it runs every hour)`);
    else add(d.behind > 0 && now - new Date(s.last_ok_at) > 2 * HOUR ? 'warn' : 'ok', 'Catalog sync', `Worked ${ago(s.last_ok_at, now)}${d.behind ? `; ${plural(d.behind, 'catalog change')} to copy on the next run` : '; up to date'}`);
    if (d.missing > 0) add('warn', 'Catalog titles', `${plural(d.missing, 'upcoming catalog title')} not in this shop (Titles → Sync now, or a full re-sync)`);
  }

  // The nightly backup.
  const b = d.lastBackup;
  if (!b) add('bad', 'Nightly backup', 'No backup recorded yet');
  else if (!b.ok) add('bad', 'Nightly backup', `Last backup failed ${ago(b.created_at, now)}${b.message ? `: ${brief(b.message)}` : ''}`);
  else if (now - new Date(b.created_at) > 30 * HOUR) add('bad', 'Nightly backup', `Last backup ${ago(b.created_at, now)} (it runs every night)`);
  else add('ok', 'Nightly backup', `Backed up ${ago(b.created_at, now)}${b.message ? `: ${brief(b.message.replace(/^.*?: /, ''), 80)}` : ''}`);

  // Emails in the last 24 hours.
  const e = d.emails ?? { sent: 0, failed: 0 };
  const waiting = d.health?.arrival_waiting ?? 0;
  const http = d.health?.http_errors_24h ?? 0;
  const emailText = [`${plural(e.sent, 'email')} sent in the last 24 hours`, e.failed && `${e.failed} failed`, http && `${plural(http, 'call')} to the email service failed`, waiting && `${plural(waiting, 'title')} waiting for a “Your books are in” email`].filter(Boolean).join('; ');
  add(e.failed || http ? 'bad' : 'ok', 'Emails', emailText);

  // The master catalog's daily imports.
  if (d.catalog) {
    for (const [job, label] of Object.entries(DAILY_IMPORTS)) {
      const r = d.imports?.[job];
      const source = job === 'prh_import' ? 'prh' : 'lunar';
      const left = d.leftOut?.[source] ? `; ${plural(d.leftOut[source], 'title')} left out` : '';
      if (!r) add('warn', label, 'Has not run yet');
      else if (!r.ok) add('bad', label, `Last run failed ${ago(r.created_at, now)}: ${brief(r.message)}`);
      else if (now - new Date(r.created_at) > 48 * HOUR) add('warn', label, `Last ran ${ago(r.created_at, now)} (it should run every morning)`);
      else add('ok', label, `Ran ${ago(r.created_at, now)}: ${brief(r.message)}${left}`);
    }
  }

  const a = d.activity;
  if (a) add('info', 'Activity', [`${plural(a.customers, 'customer')}${a.newCustomers ? ` (${a.newCustomers} new in the last 24 hours)` : ''}`, plural(a.openReservations, 'open reservation'), plural(a.upcomingTitles, 'upcoming title')].join(' · '));
  return rows;
}

/** A shop's overall level: its worst line. */
export const shopLevel = (rows) => (rows.some((r) => r.level === 'bad') ? 'bad' : rows.some((r) => r.level === 'warn') ? 'warn' : 'ok');

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const COLOR = { ok: '#1a7f37', warn: '#9a6700', bad: '#cf222e', info: '#57606a' };
const MARK = { ok: '✓', warn: '!', bad: '✗', info: '·' };

/**
 * The email for every shop: a summary table (each shop, its status and what needs attention), then each shop's lines,
 * worst shops first.
 * @param shops  [{ id, name, domain, rows }]
 * @param date   the day it reports on, YYYY-MM-DD
 * @returns { subject, html, text }
 */
export function statusEmail(shops, date) {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const rank = { bad: 0, warn: 1, ok: 2 };
  const list = shops.map((s) => ({ ...s, level: shopLevel(s.rows) })).sort((a, b) => rank[a.level] - rank[b.level] || a.name.localeCompare(b.name));
  const count = (level) => list.reduce((n, s) => n + s.rows.filter((r) => r.level === level).length, 0);
  const problems = count('bad');
  const checks = count('warn');
  const all = plural(list.length, 'shop');
  const subject = problems || checks
    ? `Pullwise status: ${[problems && plural(problems, 'problem'), checks && `${checks} to check`].filter(Boolean).join(', ')} (${all}, ${day})`
    : `Pullwise status: everything OK (${all}, ${day})`;
  const needs = (s) => s.rows.filter((r) => r.level === 'bad' || r.level === 'warn').map((r) => r.label);

  const text = [
    `Pullwise status, ${day}: ${problems || checks ? `${problems} problems, ${checks} to check` : 'everything OK'} across ${all}.`,
    '',
    ...list.map((s) => `${LEVEL_WORD[s.level].padEnd(8)}${s.name} (${s.id})${needs(s).length ? `: ${needs(s).join(', ')}` : ''}`),
    ...list.flatMap((s) => ['', `${s.name} (${s.id}${s.domain ? `, ${s.domain}` : ''})`, ...s.rows.map((r) => `  ${MARK[r.level]} ${r.label}: ${r.text}`)]),
  ].join('\n');

  const font = 'font:14px/1.45 Arial,sans-serif;color:#222';
  const pill = (level) => `<span style="color:${COLOR[level]};font-weight:bold">${MARK[level]} ${escHtml(LEVEL_WORD[level])}</span>`;
  const html = `<div style="${font}">
<p style="margin:0 0 12px"><b>Pullwise status, ${escHtml(day)}</b><br>${problems || checks ? `${escHtml(plural(problems, 'problem'))} and ${checks} to check` : 'Everything OK'} across ${escHtml(all)}.</p>
<table cellpadding="4" cellspacing="0" style="${font};margin:0 0 16px;border-collapse:collapse">${list.map((s) => `<tr><td>${pill(s.level)}</td><td><b>${escHtml(s.name)}</b></td><td style="color:#57606a">${escHtml(needs(s).join(', '))}</td></tr>`).join('')}</table>
${list.map((s) => `<h3 style="font:bold 15px Arial,sans-serif;margin:18px 0 4px">${escHtml(s.name)} <span style="font-weight:normal;color:#57606a">${escHtml(s.id)}${s.domain ? ` · ${escHtml(s.domain)}` : ''}</span></h3>
<table cellpadding="3" cellspacing="0" style="${font}">${s.rows.map((r) => `<tr><td style="color:${COLOR[r.level]};font-weight:bold;vertical-align:top">${MARK[r.level]}</td><td style="vertical-align:top;white-space:nowrap"><b>${escHtml(r.label)}</b></td><td>${escHtml(r.text)}</td></tr>`).join('')}</table>`).join('\n')}
</div>`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------------------------------------
// Reading the shops
// ---------------------------------------------------------------------------------------------------------

/** Every row of a select, a thousand at a time (PostgREST's most per request). */
async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const count = async (q) => {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
};
const one = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
};

/** What shopRows needs for one shop. `catalogTitles` is the catalog's [{ id, updated_at, upcoming }]. */
export async function gatherShop(sb, shop, catalogTitles, now) {
  const since = new Date(now - 24 * HOUR).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);
  const settings = await one(sb.from('settings').select('shop_name,pull_list_email_enabled,pull_list_email_last_sent,arrival_email_enabled').eq('id', 1).limit(1));
  const healthRes = await sb.rpc('staff_health');
  const d = {
    id: shop.id,
    name: settings?.shop_name || shop.id,
    catalog: !!shop.catalog,
    settings,
    health: healthRes.error ? null : healthRes.data,
    lastBackup: await one(sb.from('job_log').select('ok,message,created_at').eq('job', 'backup').order('id', { ascending: false }).limit(1)),
    emails: {
      sent: await count(sb.from('email_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', since)),
      failed: await count(sb.from('email_log').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', since)),
    },
    activity: {
      customers: await count(sb.from('customers').select('id', { count: 'exact', head: true })),
      newCustomers: await count(sb.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', since)),
      openReservations: await count(sb.from('reservations').select('id', { count: 'exact', head: true }).in('status', ['open', 'ordered', 'arrived'])),
      upcomingTitles: await count(sb.from('items').select('id', { count: 'exact', head: true }).gte('release_date', today).eq('hidden', false)),
    },
  };
  if (shop.catalog) {
    d.imports = {};
    for (const job of Object.keys(DAILY_IMPORTS)) d.imports[job] = await one(sb.from('job_log').select('ok,message,created_at').eq('job', job).order('id', { ascending: false }).limit(1));
    d.leftOut = {};
    for (const source of ['prh', 'lunar']) d.leftOut[source] = await count(sb.from('import_left_out').select('sku', { count: 'exact', head: true }).eq('source', source));
  } else {
    d.sync = await one(sb.from('catalog_sync_state').select('last_run_at,last_ok_at,last_error,cursor_at').eq('id', 1).limit(1));
    const cursor = d.sync?.cursor_at ? new Date(d.sync.cursor_at) : null;
    d.behind = catalogTitles.filter((t) => !cursor || new Date(t.updated_at) > cursor).length;
    const linked = new Set((await fetchAll(() => sb.from('items').select('catalog_id').not('catalog_id', 'is', null))).map((r) => String(r.catalog_id)));
    d.missing = catalogTitles.filter((t) => t.upcoming && !linked.has(String(t.id))).length;
  }
  return d;
}

/** The email when the report itself couldn't be built, so a broken report is noticed rather than silent. */
export function failureEmail(message, date) {
  const text = `The daily Pullwise status report couldn't be built today (${date}): ${message}\n\nSee the "Daily status report" run in GitHub Actions.`;
  return { subject: `Pullwise status: the report failed (${date})`, text, html: `<p style="font:14px/1.45 Arial,sans-serif">${escHtml(text).replace(/\n/g, '<br>')}</p>` };
}

async function main({ dryRun, now }) {
  const shops = JSON.parse(fs.readFileSync(path.join(ROOT, 'shops.json'), 'utf8')).shops;
  const catalog = catalogShop();
  const catalogSb = await serviceClient(catalog);
  const today = new Date(now).toISOString().slice(0, 10);
  const send = (mail) => (dryRun ? null : sendEmail(catalogSb, { to: process.env.STATUS_EMAIL, mail, kind: 'status_report', sentBy: 'Daily status report', label: 'status email' }));
  try {
    const catalogTitles = (await fetchAll(() => catalogSb.from('items').select('id,updated_at,release_date,hidden'))).map((t) => ({ id: t.id, updated_at: t.updated_at, upcoming: !t.hidden && t.release_date >= today }));
    const reports = [];
    for (const shop of [catalog, ...shops.filter((s) => s.id !== catalog.id)]) {
      const domain = shop.domains?.[0] ?? '';
      try {
        const sb = shop.id === catalog.id ? catalogSb : await serviceClient(shop);
        const d = await gatherShop(sb, shop, catalogTitles, now);
        reports.push({ id: shop.id, name: d.name, domain, rows: shopRows(d, now) });
      } catch (err) {
        reports.push({ id: shop.id, name: shop.id, domain, rows: [{ level: 'bad', label: 'Shop', text: `Couldn’t read it: ${brief(err.message)}` }] });
      }
    }
    const mail = statusEmail(reports, today);
    console.log(`${mail.subject}\n\n${mail.text}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${mail.subject}\n\n\`\`\`\n${mail.text}\n\`\`\`\n`);
    await send(mail);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    await send(failureEmail(err.message, today));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main({ dryRun: process.argv.includes('--dry-run'), now: Date.now() }).catch((err) => {
    console.error(`✗ ${err.message}`); // the catalog's keys couldn't be read: nothing to send the email with
    process.exit(1);
  });
}

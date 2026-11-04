// Backup (owners): download everything in the shop's database as one file. Restoring is the Restore screen. See BACKUPS.md.

import { $, setStatus, fmtDateTime, solidIcon, friendlyError, downloadCsv, setupTabs, loadRunLog } from '../lib.js';

const LOG_NAMES = { backup: 'Backup', export: 'Customer export' };
import { buildBackup, lastBackup, recordBackup, customerRows, CUSTOMER_HEADER } from '../backup.js';

export async function mount(el, ctx) {
  const sb = ctx.sb;
  const { data: { user } } = await sb.auth.getUser();
  el.innerHTML = `
    <h1>Backup</h1>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="backup">Download Backup</button>
      <button type="button" class="admin-tab" role="tab" data-tab="customers">Export Customers</button>
      <button type="button" class="admin-tab" role="tab" data-tab="log">Backup Log</button>
    </div>
    <div data-tabpane="backup">
    <section class="fold fold--compact fold--static">
    <div class="fold__head"><h2>Download a Backup</h2></div>
    <div class="fold__body">
    <p>Downloads one file with <strong>everything in the shop’s database</strong>: titles, customers, pull lists and reservations, orders, events, news, page text, settings and the change log. Do this regularly (weekly is a good habit) and keep the file somewhere safe, such as Dropbox.</p>
    <p class="field__hint">The file contains customer names, phone numbers and emails: don’t share it or email it. Uploaded pictures (Media) are not in it, and neither are distributor cover images, which a re-import brings back. To load data back from a file, use <a href="#restore">Restore</a>.</p>
    <p data-last class="card__meta">Checking the last backup…</p>
    <p class="admin-status" role="status" data-status></p>
    <button class="btn btn--primary" type="button" data-backup>${solidIcon('download', 16)} Download backup</button>
    </div>
    </section>
    </div>
    <div data-tabpane="customers">
    <section class="fold fold--compact fold--static">
    <div class="fold__head"><h2>Export Customers</h2></div>
    <div class="fold__body">
    <p>A spreadsheet (CSV) of just the customers: name, email, phone, address, whether they get the weekly pull list email and the “your books are in” email, whether they have a website login, and when they joined. It is a contact list, not a backup: pull lists and reservations are not in it.</p>
    <p class="field__hint">It contains personal details: don’t share it or email it. If you use it to send mail, leave out anyone marked “No” under the email columns.</p>
    <p class="admin-status" role="status" data-cust-status></p>
    <button class="btn btn--ghost" type="button" data-customers>${solidIcon('download', 16)} Export customers (CSV)</button>
    </div>
    </section>
    </div>
    <div data-tabpane="log">
    <p>Every backup downloaded and every customer list exported, newest first, with who did it.</p>
    <div data-log></div>
    </div>`;
  const log = () => loadRunLog(sb, $('[data-log]', el), { jobs: Object.keys(LOG_NAMES), name: (job) => LOG_NAMES[job] ?? job, by: true, limit: 50, empty: 'No backups or exports yet.' }).catch(() => {});
  setupTabs(el, 'admin-backup-tab', 'backup');
  log();

  const lastEl = $('[data-last]', el);
  const showLast = async () => {
    const last = await lastBackup(sb);
    lastEl.textContent = last ? `Last backup: ${fmtDateTime(last.at)} (${last.days === 0 ? 'today' : `${last.days} ${last.days === 1 ? 'day' : 'days'} ago`}). ${last.message ?? ''}` : 'No backup has been downloaded yet.';
  };
  showLast().catch(() => (lastEl.textContent = ''));

  $('[data-backup]', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = $('[data-status]', el);
    btn.disabled = true;
    try {
      const built = await buildBackup(sb, (t) => setStatus(status, t));
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(built.file), download: built.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      await recordBackup(sb, user.email, built).catch(() => {});
      setStatus(status, `Saved ${built.name}: ${built.rows.toLocaleString()} rows from ${built.tables} tables (${(built.file.size / 1024 / 1024).toFixed(1)} MB). Move it somewhere safe.`, 'ok');
      showLast().catch(() => {});
      log();
    } catch (err) {
      setStatus(status, `Backup failed: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
  });

  $('[data-customers]', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = $('[data-cust-status]', el);
    btn.disabled = true;
    setStatus(status, 'Reading the customers…');
    try {
      const rows = await customerRows(sb);
      downloadCsv(`shop-customers-${new Date().toLocaleDateString('en-CA')}.csv`, CUSTOMER_HEADER, rows);
      await sb.from('job_log').insert({ job: 'export', ok: true, message: `${user.email}: customer list, ${rows.length.toLocaleString()} customers` });
      setStatus(status, `Saved the customer list: ${rows.length.toLocaleString()} customers.`, 'ok');
      log();
    } catch (err) {
      setStatus(status, `Export failed: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
  });
}

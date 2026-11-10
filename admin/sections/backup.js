// Backup (owners): the nightly backups (download or restore any of them), download everything in the shop's
// database now as one file, load tables back from a backup file, and export the customers. One Log tab. See BACKUPS.md.

import { $, $$, esc, setStatus, fmtDate, fmtDateTime, solidIcon, friendlyError, downloadCsv, setupTabs, loadRunLog, hintSlot, openDialog, toast } from '../lib.js';
import { buildBackup, buildMediaBackup, recordMediaBackup, readMediaArchives, restoreMedia, recordMediaRestore, lastBackup, recordBackup, customerRows, CUSTOMER_HEADER, pullListRows, PULL_HEADER, nightlyBackups, nightlyBackupFile, parseBackup, currentCounts, restoreTables, replaceImpact, failedTable, restoreOrder, recordRestore, NOT_RESTORED } from '../backup.js';

const label = (n) => (n === 'auth_users' ? 'customer sign-ins' : n.replace(/_/g, ' '));

/** The nightly backup files as a table, with the buttons for each file (`buttons(f)` returns their markup). */
const nightlyTable = (files, buttons) => files.length
  ? `<div class="admin-table-wrap"><table class="admin-table cards">
      <thead><tr><th scope="col">Backup</th><th scope="col">Kept until</th><th scope="col" class="center">Size</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${files.map((f) => `<tr>
        <td class="card-title"><strong>${esc(fmtDate(f.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong>${f.kind === 'monthly' ? ' <span class="pill pill--accent">Monthly</span>' : ''}${f.kind === 'weekly' ? ` <span class="pill pill--info">Pictures${f.parts ? `: part ${f.part} of ${f.parts}` : ''}</span>` : ''}</td>
        <td class="card__meta nowrap card-line card-label">${esc(fmtDate(f.keptUntil))}</td>
        <td class="center nowrap card-key card-label">${(f.size / 1024 / 1024).toFixed(1)} MB</td>
        <td class="card-foot">${buttons(f)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`
  : '<p class="empty">No nightly backups yet. The first one is made tonight.</p>';

const LOG_NAMES = { backup: 'Backup', backup_file: 'Nightly backup downloaded', export: 'Customer export', media_backup: 'Media backup', media_restore: 'Media restore' };

const download = (built) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(built.file), download: built.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

export async function mount(el, ctx) {
  const sb = ctx.sb;
  const { data: { user } } = await sb.auth.getUser();
  el.innerHTML = `
    <h1>Backup</h1>
    ${hintSlot()}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="backups">Backups</button>
      <button type="button" class="admin-tab" role="tab" data-tab="restore">Restore</button>
      <button type="button" class="admin-tab" role="tab" data-tab="customers">Customers</button>
      <button type="button" class="admin-tab" role="tab" data-tab="log">Log</button>
    </div>
    <div data-tabpane="backups">
    <section class="fold fold--compact fold--static">
    <div class="fold__head"><h2>Download a Backup Now</h2></div>
    <div class="fold__body">
    <p data-last class="card__meta">Checking the last backup…</p>
    <p class="admin-status" role="status" data-status></p>
    <div class="admin-actions">
    <button class="btn btn--primary" type="button" data-backup>${solidIcon('download', 16)} Download database backup</button>
    <button class="btn btn--ghost" type="button" data-media>${solidIcon('download', 16)} Download media backup (.zip)</button>
    </div>
    </div>
    </section>
    <section class="fold fold--compact fold--static">
    <div class="fold__head"><h2>Automatic Backups<span class="fold__note">Every night, and pictures every Sunday</span></h2></div>
    <div class="fold__body">
    <p class="admin-status" role="status" data-nightly-status></p>
    <div data-nightly><p class="card__meta">Loading the backups…</p></div>
    </div>
    </section>
    </div>
    <div data-tabpane="restore">
    <section class="fold fold--compact fold--static">
    <div class="fold__head"><h2>Restore the Database from a File on This Computer</h2></div>
    <div class="fold__body">
      <div class="field"><label for="bk-file">Backup file</label><input id="bk-file" type="file" accept=".gz,.json,application/gzip,application/json"></div>
      <p class="admin-status" role="status" data-file-status></p>
    </div>
    </section>
    <div data-plan hidden></div>
    <section class="fold fold--compact fold--static">
    <div class="fold__head"><h2>Restore Pictures from a Media Backup</h2></div>
    <div class="fold__body">
      <p class="field__hint">Pick every .zip from a media backup (all the parts). Pictures go back under their original names; nothing changes until you confirm.</p>
      <div class="field"><label for="bk-media">Media backup files</label><input id="bk-media" type="file" accept=".zip,application/zip" multiple></div>
      <p class="admin-status" role="status" data-media-status></p>
      <div data-media-plan hidden></div>
    </div>
    </section>
    </div>
    <div data-tabpane="customers">
    <section class="fold fold--compact fold--static">
    <div class="fold__head"><h2>Customers</h2></div>
    <div class="fold__body">
    <p><strong>Customers</strong> is a spreadsheet (CSV) of just the customers: name, email, phone, address, whether they get the weekly pull list email and the “your books are in” email, whether they have a website login, and when they joined. <strong>Customers and pull lists</strong> adds what is on each customer’s pull list right now (titles still open, ordered or arrived, and the series and creators they follow), one row per entry. Take them with you if you ever leave Pullwise. Neither is a backup: use the backups for that.</p>
    <p class="field__hint">They contain personal details: don’t share them or email them. If you use one to send mail, leave out anyone marked “No” under the email columns. Orders that aren’t linked to a customer are left out of the pull list file.</p>
    <p class="admin-status" role="status" data-cust-status></p>
    <div class="admin-actions">
    <button class="btn btn--ghost" type="button" data-customers>${solidIcon('download', 16)} Customers (CSV)</button>
    <button class="btn btn--ghost" type="button" data-pulllists>${solidIcon('download', 16)} Customers and pull lists (CSV)</button>
    </div>
    </div>
    </section>
    </div>
    <div data-tabpane="log">
    <div data-log></div>
    </div>`;
  const log = () => loadRunLog(sb, $('[data-log]', el), {
    jobs: [...Object.keys(LOG_NAMES), 'restore'],
    name: (job, text) => (job === 'restore' || job === 'media_restore' ? `${job === 'restore' ? 'Restore' : 'Media restore'}: ${text.startsWith('replace') ? 'replace' : 'add missing'}` : LOG_NAMES[job] ?? job),
    detail: (text) => text.replace(/^(replace|add missing) — /, ''),
    by: true, limit: 50, empty: 'No backups, restores or exports yet.',
  }).catch(() => {});
  const showTab = setupTabs(el, 'admin-backup-tab', 'backups', undefined, {
    backups: 'The shop is backed up automatically every night. Each day’s file is kept for 35 days, and the first of each month for about a year. Every Sunday the uploaded pictures are saved too, as .zip files (listed as Pictures, kept 35 days: download all the parts of a week, then restore them from the Restore tab). <strong>Download a backup now</strong> before a big change, or to keep a copy of your own somewhere safe, such as Dropbox: the <strong>database backup</strong> is one file with everything in the shop’s database (titles, customers, pull lists, orders, events, news, page text, settings and the change log); the <strong>media backup</strong> is every uploaded picture, as one or more .zip files. Distributor cover images are in neither (a re-import brings them back). In the nightly list, <strong>Download</strong> saves a file and <strong>Restore</strong> loads tables back from it (nothing is downloaded, and nothing changes until you confirm). The files contain customer names, phone numbers, emails and password hashes: don’t share them or email them. Pictures are put back on the Restore tab. A big library is split into several .zip files of about 250 MB; your browser may ask to allow multiple downloads.',
    restore: 'Pick a database backup file on this computer, or press Restore on a nightly backup, then tick only the tables you need. To put uploaded pictures back, pick the .zip files of a media backup at the bottom. <strong>Add missing rows</strong> puts back what was deleted and leaves everything else alone; <strong>Replace</strong> deletes every row in the table first and loads the backup’s, so changes made since the backup are lost.',
    customers: 'A spreadsheet of just the customers’ contact details, for a mailing or your records. It is not a backup.',
    log: 'Every backup (the nightly automatic ones and those downloaded here), every nightly file downloaded, every restore (who ran it, how, and what each table got; a failed restore changed nothing) and every customer list exported, newest first, with who did it.',
  });
  log();

  const nightlyEl = $('[data-nightly]', el);
  const nightlyStatus = $('[data-nightly-status]', el);
  const fileStatus = $('[data-file-status]', el);
  const plan = $('[data-plan]', el);
  const showNightly = async () => {
    try {
      const files = await nightlyBackups(sb);
      nightlyEl.innerHTML = nightlyTable(files, (f) => `<button type="button" class="btn btn--small" data-get="${esc(f.key)}">Download</button>${f.kind === 'weekly' ? '' : ` <button type="button" class="btn btn--ghost btn--small" data-pick="${esc(f.key)}">Restore</button>`}`);
    } catch (err) {
      nightlyEl.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
    }
  };
  showNightly();
  const setNightlyButtons = (off) => $$('[data-get],[data-pick]', nightlyEl).forEach((b) => (b.disabled = off));
  nightlyEl.addEventListener('click', async (e) => {
    const get = e.target.closest('[data-get]');
    const pick = e.target.closest('[data-pick]');
    if (!get && !pick) return;
    setNightlyButtons(true);
    if (pick) {
      $('#bk-file', el).value = '';
      await readBackup(nightlyStatus, async () => {
        setStatus(nightlyStatus, 'Loading the backup…');
        const { file, name } = await nightlyBackupFile(sb, pick.dataset.pick);
        return new File([file], name);
      });
    } else {
      setStatus(nightlyStatus, 'Downloading…');
      try {
        const { file, name } = await nightlyBackupFile(sb, get.dataset.get);
        download({ file, name });
        await sb.from('job_log').insert({ job: 'backup_file', ok: true, message: `${user.email}: ${name}` });
        setStatus(nightlyStatus, `Saved ${name}. Keep it somewhere safe.`, 'ok');
        log();
      } catch (err) {
        setStatus(nightlyStatus, `Download failed: ${friendlyError(err)}`, 'error');
      }
    }
    setNightlyButtons(false);
  });
  $('#bk-file', el).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
      plan.hidden = true;
      return setStatus(fileStatus, '');
    }
    readBackup(fileStatus, async () => file);
  });

  const lastEl = $('[data-last]', el);
  const showLast = async () => {
    const last = await lastBackup(sb);
    lastEl.textContent = last ? `Last backup: ${fmtDateTime(last.at)} (${last.days === 0 ? 'today' : `${last.days} ${last.days === 1 ? 'day' : 'days'} ago`}). ${last.message ?? ''}` : 'No backup has been made yet.';
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

  $('[data-media]', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = $('[data-status]', el);
    btn.disabled = true;
    try {
      const saved = [];
      const built = await buildMediaBackup(sb, (t) => setStatus(status, t), async (part) => {
        download(part);
        saved.push(part.name);
        await new Promise((r) => setTimeout(r, 1500)); // let the browser start this download before the next archive is built
      });
      await recordMediaBackup(sb, user.email, built).catch(() => {});
      setStatus(status, `Saved ${built.files.toLocaleString()} pictures (${(built.bytes / 1024 / 1024).toFixed(1)} MB) in ${built.parts} ${built.parts === 1 ? 'file' : 'files'}: ${saved.join(', ')}.${built.failed ? ` ${built.failed} could not be read: try again.` : ' Move them somewhere safe.'}`, built.failed ? 'error' : 'ok');
      log();
    } catch (err) {
      setStatus(status, `Media backup failed: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
  });

  // Restore pictures: read the picked archives, show what they hold, then confirm.
  const mediaStatus = $('[data-media-status]', el);
  const mediaPlan = $('[data-media-plan]', el);
  $('#bk-media', el).addEventListener('change', async (e) => {
    const picked = [...e.target.files];
    mediaPlan.hidden = true;
    mediaPlan.innerHTML = '';
    if (!picked.length) return setStatus(mediaStatus, '');
    setStatus(mediaStatus, 'Reading the files…');
    try {
      const entries = await readMediaArchives(picked);
      if (!entries.length) return setStatus(mediaStatus, 'No pictures found in those files.', 'error');
      setStatus(mediaStatus, '');
      const mb = (entries.reduce((n, x) => n + x.size, 0) / 1024 / 1024).toFixed(1);
      mediaPlan.hidden = false;
      mediaPlan.innerHTML = `
        <p><strong>${entries.length.toLocaleString()} pictures</strong> (${mb} MB) in ${picked.length} ${picked.length === 1 ? 'file' : 'files'}.</p>
        <fieldset class="field">
          <legend>How to load them</legend>
          <div class="field field--check"><input id="bm-add" type="radio" name="mmode" value="add" checked><label for="bm-add"><strong>Add missing pictures only</strong> (safe): pictures that are still there are left as they are.</label></div>
          <div class="field field--check"><input id="bm-rep" type="radio" name="mmode" value="replace"><label for="bm-rep"><strong>Replace pictures with the backup’s</strong>: a picture that is still there is overwritten with the backup’s copy.</label></div>
        </fieldset>
        <button class="btn btn--danger" type="button" data-media-restore>Restore the pictures…</button>`;
      $('[data-media-restore]', mediaPlan).addEventListener('click', () => confirmMedia(entries));
    } catch (err) {
      setStatus(mediaStatus, friendlyError(err), 'error');
    }
  });

  function confirmMedia(entries) {
    const overwrite = $('input[name=mmode]:checked', mediaPlan).value === 'replace';
    const d = openDialog(overwrite ? 'Replace pictures from the backup?' : 'Add missing pictures from the backup?', `
      <p>${overwrite
        ? `<strong>Every picture in the backup is uploaded, and any picture with the same name that is there now is overwritten.</strong> ${entries.length.toLocaleString()} pictures.`
        : `Pictures that are already there are left alone; only missing ones are added. Up to ${entries.length.toLocaleString()} pictures.`}</p>
      ${overwrite ? '<div class="field"><label for="bm-type">Type RESTORE to confirm</label><input id="bm-type" autocomplete="off"></div>' : ''}
      <div class="admin-actions"><button class="btn btn--danger" type="button" data-go ${overwrite ? 'disabled' : ''}>${overwrite ? 'Replace' : 'Add missing pictures'}</button><button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>`);
    $('[data-cancel]', d).addEventListener('click', () => d.close());
    $('#bm-type', d)?.addEventListener('input', () => ($('[data-go]', d).disabled = $('#bm-type', d).value.trim() !== 'RESTORE'));
    $('[data-go]', d).addEventListener('click', async () => {
      d.close();
      const btn = $('[data-media-restore]', mediaPlan);
      btn.disabled = true;
      try {
        const r = await restoreMedia(sb, entries, { overwrite, onProgress: (t) => setStatus(mediaStatus, t) });
        await recordMediaRestore(sb, user.email, overwrite ? 'replace' : 'add missing', r).catch(() => {});
        setStatus(mediaStatus, `Done: ${r.uploaded.toLocaleString()} pictures loaded${r.skipped ? `, ${r.skipped.toLocaleString()} already there` : ''}.${r.failed.length ? ` ${r.failed.length} failed (${r.failed.slice(0, 3).join(', ')}${r.failed.length > 3 ? ', …' : ''}): try again.` : ''}`, r.failed.length ? 'error' : 'ok');
        log();
      } catch (err) {
        setStatus(mediaStatus, `Restore didn’t finish: ${friendlyError(err)}`, 'error');
      }
      btn.disabled = false;
    });
  }

  $('[data-pulllists]', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = $('[data-cust-status]', el);
    btn.disabled = true;
    setStatus(status, 'Reading the customers and their pull lists…');
    try {
      const rows = await pullListRows(sb);
      downloadCsv(`shop-customers-pull-lists-${new Date().toLocaleDateString('en-CA')}.csv`, PULL_HEADER, rows);
      await sb.from('job_log').insert({ job: 'export', ok: true, message: `${user.email}: customers and pull lists, ${rows.length.toLocaleString()} rows` });
      setStatus(status, `Saved the customers and pull lists: ${rows.length.toLocaleString()} rows.`, 'ok');
      log();
    } catch (err) {
      setStatus(status, `Export failed: ${friendlyError(err)}`, 'error');
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

  // Read a backup (one of the nightly ones, or a file from this computer), then show its tables to pick from.
  async function readBackup(statusEl, getFile) {
    plan.hidden = true;
    plan.innerHTML = '';
    try {
      const file = await getFile();
      setStatus(statusEl, 'Reading the file…');
      const backup = await parseBackup(file);
      const meta = (await sb.rpc('backup_meta')).data;
      // Only tables the database has now and lets a restore write (not the staff list, audit trail or job log).
      const restorable = meta ? new Set(meta.tables.filter((t) => t.restorable !== false).map((t) => t.name)) : null;
      const names = restoreOrder(Object.keys(backup.tables).filter((n) => !NOT_RESTORED.includes(n) && (!restorable || restorable.has(n) || n === 'auth_users')));
      const counts = await currentCounts(sb, names).catch(() => ({}));
      const total = names.reduce((n, t) => n + backup.tables[t].rows.length, 0);
      setStatus(statusEl, '');
      const now = meta?.migration;
      const note = now && backup.migration && now !== backup.migration
        ? `This backup was made when the database was at version ${backup.migration}; it is at ${now} now. Columns added since then come back empty or at their default value.`
        : '';
      showPlan(backup, names, counts, total, note);
    } catch (err) {
      setStatus(statusEl, friendlyError(err), 'error');
    }
  }

  function showPlan(backup, names, counts, total, versionNote = '') {
    plan.hidden = false;
    showTab('restore', false);
    const hasPasswords = (backup.tables.auth_users?.rows ?? []).some((r) => r.encrypted_password);
    plan.innerHTML = `
      <p><strong>Backup taken ${esc(fmtDateTime(backup.taken_at))}</strong>: ${total.toLocaleString()} rows in ${names.length} tables.</p>
      ${versionNote ? `<p class="field__hint">${esc(versionNote)}</p>` : ''}
      <fieldset class="field">
        <legend>How to load the tables you tick</legend>
        <div class="field field--check"><input id="bk-add" type="radio" name="mode" value="add" checked><label for="bk-add"><strong>Add missing rows only</strong> (safe): rows that already exist are left as they are; only rows that are gone come back.</label></div>
        <div class="field field--check"><input id="bk-rep" type="radio" name="mode" value="replace"><label for="bk-rep"><strong>Replace the table with the backup</strong>: deletes every row now in the table first. Changes made since the backup are lost. A safety backup of today’s data is downloaded automatically before anything is changed.</label></div>
      </fieldset>
      <div class="admin-table-wrap"><table class="admin-table cards">
        <thead><tr><th scope="col"><input type="checkbox" data-all aria-label="Tick all tables"></th><th scope="col">Table</th><th scope="col" class="num">In backup</th><th scope="col" class="num">Now</th></tr></thead>
        <tbody>${names.map((n) => `<tr>
          <td class="card-lead"><input type="checkbox" data-table="${esc(n)}" aria-label="Restore ${esc(n)}">
          </td>
          <td class="card-title">${esc(label(n))}</td>
          <td class="num card-key card-label">${backup.tables[n].rows.length.toLocaleString()}</td>
          <td class="num card-key card-label">${counts[n] == null ? '' : counts[n].toLocaleString()}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      ${names.includes('auth_users') ? `<p class="field__hint"><strong>Customer sign-ins</strong> bring customers’ accounts and passwords back, so they don’t have to sign up again. Tick them together with customers. They are only ever added: an account that exists already is never changed, even in Replace.${hasPasswords ? '' : ' This backup was made before backups carried passwords, so each restored customer uses “Forgot password” once.'}</p>` : ''}
      <p class="field__hint">Not restored here: the staff list (add people under Staff) and the change log and job log. The ticked tables are loaded together, parents first: if any of them fails, none of them is changed. Foreign keys stay enforced, so a table whose parent rows are missing is refused unless you tick the parent table too.</p>
      <p class="admin-status" role="status" data-restore-status></p>
      <ul class="restore-results" data-results></ul>
      <button class="btn btn--danger" type="button" data-restore disabled>Restore the ticked tables…</button>`;

    const boxes = $$('[data-table]', plan);
    const restoreBtn = $('[data-restore]', plan);
    const sync = () => (restoreBtn.disabled = !boxes.some((b) => b.checked));
    boxes.forEach((b) => b.addEventListener('change', sync));
    $('[data-all]', plan).addEventListener('change', (e) => (boxes.forEach((b) => (b.checked = e.target.checked)), sync()));

    restoreBtn.addEventListener('click', () => {
      const picked = restoreOrder(boxes.filter((b) => b.checked).map((b) => b.dataset.table));
      const replace = $('input[name=mode]:checked', plan).value === 'replace';
      confirmRestore(backup, picked, counts, replace, names);
    });
  }

  async function confirmRestore(backup, picked, counts, replace, names) {
    // Replacing a table also deletes or unlinks the rows in other tables that point at it (foreign keys): say which.
    let impact = [];
    if (replace) {
      const status = $('[data-restore-status]', plan);
      setStatus(status, 'Checking which other tables would be affected…');
      try {
        impact = await replaceImpact(sb, picked.filter((n) => n !== 'auth_users')); // sign-ins are only ever added, never replaced
        setStatus(status, '');
      } catch (err) {
        return setStatus(status, `Couldn’t check the other tables: ${friendlyError(err)}`, 'error');
      }
    }
    const lost = impact.filter((x) => x.action !== 'blocks');
    const blocks = impact.filter((x) => x.action === 'blocks');
    const addable = impact.filter((x) => names.includes(x.table)).map((x) => x.table);
    const via = (x) => x.via.map(label).join(', ');
    const what = (x) => (x.action === 'deleted' ? `${Number(x.rows).toLocaleString()} rows deleted (they belong to ${esc(via(x))})` : `${Number(x.rows).toLocaleString()} rows unlinked from ${esc(via(x))}`);
    const d = openDialog(replace ? 'Replace tables from the backup?' : 'Add missing rows from the backup?', `
      <p>${replace
        ? `<strong>This deletes every row now in ${picked.length === 1 ? 'this table' : 'these tables'} and loads the backup instead.</strong> Anything added or changed since ${esc(fmtDateTime(backup.taken_at))} is lost. Your current data is downloaded first as a safety backup.`
        : `Rows that already exist are left alone; only missing rows are added.`}</p>
      <ul>${picked.map((n) => `<li><strong>${esc(label(n))}</strong>: ${backup.tables[n].rows.length.toLocaleString()} rows in the backup${counts[n] == null ? '' : `, ${counts[n].toLocaleString()} now`}</li>`).join('')}</ul>
      ${lost.length ? `<p class="form-error"><strong>Tables you didn’t tick lose rows too</strong>, because their rows point at the ones being replaced:</p>
      <ul>${lost.map((x) => `<li><strong>${esc(label(x.table))}</strong>: ${what(x)}${names.includes(x.table) ? '' : ' (not in this backup)'}</li>`).join('')}</ul>` : ''}
      ${blocks.length ? `<p class="form-error">${blocks.map((x) => `<strong>${esc(label(x.table))}</strong> has ${Number(x.rows).toLocaleString()} rows that point at ${esc(via(x))}`).join('; ')}, so the restore will be refused unless ${blocks.length === 1 ? 'that table is' : 'those tables are'} restored too.</p>` : ''}
      ${addable.length ? `<p><button class="btn btn--ghost" type="button" data-include>Also restore ${esc(addable.map(label).join(', '))} from the backup</button></p>` : ''}
      ${lost.length ? `<div class="field field--check"><input id="bk-ack" type="checkbox"><label for="bk-ack">Yes, also delete or unlink the rows in ${esc(lost.map((x) => label(x.table)).join(', '))}.</label></div>` : ''}
      ${replace ? '<div class="field"><label for="bk-type">Type RESTORE to confirm</label><input id="bk-type" autocomplete="off"></div>' : ''}
      <div class="admin-actions"><button class="btn btn--danger" type="button" data-go ${replace ? 'disabled' : ''}>${replace ? 'Replace' : 'Add missing rows'}</button><button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>`);
    $('[data-cancel]', d).addEventListener('click', () => d.close());
    $('[data-include]', d)?.addEventListener('click', () => {
      d.close();
      $$('[data-table]', plan).forEach((b) => addable.includes(b.dataset.table) && (b.checked = true));
      confirmRestore(backup, restoreOrder([...picked, ...addable]), counts, replace, names);
    });
    if (replace) {
      const ok = () => ($('[data-go]', d).disabled = $('#bk-type', d).value.trim() !== 'RESTORE' || (lost.length > 0 && !$('#bk-ack', d).checked));
      $('#bk-type', d).addEventListener('input', ok);
      $('#bk-ack', d)?.addEventListener('change', ok);
    }
    $('[data-go]', d).addEventListener('click', () => {
      d.close();
      run(backup, picked, replace);
    });
  }

  async function run(backup, picked, replace) {
    const status = $('[data-restore-status]', plan);
    const list = $('[data-results]', plan);
    const btn = $('[data-restore]', plan);
    btn.disabled = true;
    list.innerHTML = '';
    const results = [];
    try {
      if (replace) {
        const safety = await buildBackup(sb, (t) => setStatus(status, `Safety backup first: ${t}`));
        safety.name = safety.name.replace('shop-backup-', 'shop-backup-before-restore-');
        download(safety);
        toast(`Saved ${safety.name}`);
      }
      // One transaction for all the ticked tables: either every one is restored or none is changed.
      try {
        const out = await restoreTables(sb, picked, (n) => backup.tables[n].rows, { replace, onProgress: (t) => setStatus(status, t) });
        for (const r of out) {
          const orphans = Number(r.orphans_skipped ?? 0);
          results.push({ table: r.table, inserted: r.inserted, now: r.rows_now, orphans });
          list.insertAdjacentHTML('beforeend', `<li>✓ <strong>${esc(label(r.table))}</strong>: ${Number(r.inserted).toLocaleString()} rows loaded, ${Number(r.rows_now).toLocaleString()} in the table now${orphans ? `. ${orphans.toLocaleString()} skipped: what they belong to isn’t in the backup (it changed while the backup was taken)` : ''}</li>`);
        }
        setStatus(status, `Done: ${results.length} ${results.length === 1 ? 'table' : 'tables'} restored.`, 'ok');
      } catch (err) {
        const bad = failedTable(err);
        const raw = err.raw ?? err.message;
        const blocker = raw.match(/violates foreign key constraint "[^"]*" on table "(\w+)"/)?.[1];
        const msg = err.code === '23503'
          ? (blocker ? `Rows in ${label(blocker)} point at it: tick ${label(blocker)} too.` : 'A table it depends on is missing rows: tick that table too.')
          : err.code === '57014' ? 'That took too long. Restore fewer tables at a time.' : friendlyError(err).replace(/^[a-z0-9_]+: /, '');
        results.push({ table: bad ?? picked.join('+'), error: raw });
        list.insertAdjacentHTML('beforeend', `<li class="form-error">✗ ${bad ? `<strong>${esc(label(bad))}</strong>: ` : ''}${esc(msg)}</li>`);
        setStatus(status, 'Nothing was restored: every table was left as it was. See the ✗ above.', 'error');
      }
      await recordRestore(sb, user.email, replace ? 'replace' : 'add missing', results).catch(() => {});
      log();
    } catch (err) {
      setStatus(status, `Restore didn’t start: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
  }
}

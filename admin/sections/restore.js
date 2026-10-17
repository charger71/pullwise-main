// Restore (owners): load tables back from a backup file made on the Backup screen. See BACKUPS.md.

import { $, $$, esc, setStatus, fmtDateTime, openDialog, toast, friendlyError, setupTabs } from '../lib.js';
import { buildBackup, parseBackup, currentCounts, restoreTables, replaceImpact, failedTable, restoreOrder, recordRestore, NOT_RESTORED } from '../backup.js';

const label = (n) => n.replace(/_/g, ' ');

const download = (built) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(built.file), download: built.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

export async function mount(el, ctx) {
  const sb = ctx.sb;
  const { data: { user } } = await sb.auth.getUser();
  el.innerHTML = `
    <h1>Restore</h1>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="file">Backup File</button>
      <button type="button" class="admin-tab" role="tab" data-tab="tables" disabled title="Choose a backup file first">Tables to Restore</button>
    </div>
    <div data-tabpane="file">
    <p>Load tables back from a backup file, for example after something was deleted by mistake. Pick the file, then tick only the tables you need. <strong>Nothing happens until you press Restore.</strong></p>
    <div class="field"><label for="bk-file">Backup file</label><input id="bk-file" type="file" accept=".gz,.json,application/gzip,application/json"></div>
    <p class="admin-status" role="status" data-file-status></p>
    </div>
    <div data-tabpane="tables">
    <div data-plan hidden></div>
    </div>`;
  const showTab = setupTabs(el, 'admin-restore-tab', 'file');
  const tablesTab = $('[data-tab="tables"]', el);
  showTab('file', false); // never reopen on the table list: it needs a file read first

  const fileStatus = $('[data-file-status]', el);
  const plan = $('[data-plan]', el);
  $('#bk-file', el).addEventListener('change', async (e) => {
    plan.hidden = true;
    plan.innerHTML = '';
    tablesTab.disabled = true;
    showTab('file', false);
    const file = e.target.files[0];
    if (!file) return setStatus(fileStatus, '');
    setStatus(fileStatus, 'Reading the file…');
    try {
      const backup = await parseBackup(file);
      const meta = (await sb.rpc('backup_meta')).data;
      // Only tables the database has now and lets a restore write (not the staff list, audit trail or job log).
      const restorable = meta ? new Set(meta.tables.filter((t) => t.restorable !== false).map((t) => t.name)) : null;
      const names = restoreOrder(Object.keys(backup.tables).filter((n) => !NOT_RESTORED.includes(n) && (!restorable || restorable.has(n))));
      const counts = await currentCounts(sb, names).catch(() => ({}));
      const total = names.reduce((n, t) => n + backup.tables[t].rows.length, 0);
      setStatus(fileStatus, '');
      const now = meta?.migration;
      const note = now && backup.migration && now !== backup.migration
        ? `This backup was made when the database was at version ${backup.migration}; it is at ${now} now. Columns added since then come back empty or at their default value.`
        : '';
      showPlan(backup, names, counts, total, note);
    } catch (err) {
      setStatus(fileStatus, friendlyError(err), 'error');
    }
  });

  function showPlan(backup, names, counts, total, versionNote = '') {
    plan.hidden = false;
    tablesTab.disabled = false;
    showTab('tables', false);
    plan.innerHTML = `
      <p><strong>Backup taken ${esc(fmtDateTime(backup.taken_at))}</strong>: ${total.toLocaleString()} rows in ${names.length} tables.</p>
      ${versionNote ? `<p class="field__hint">${esc(versionNote)}</p>` : ''}
      <fieldset class="field">
        <legend>How to load the tables you tick</legend>
        <div class="field field--check"><input id="bk-add" type="radio" name="mode" value="add" checked><label for="bk-add"><strong>Add missing rows only</strong> (safe): rows that already exist are left as they are; only rows that are gone come back.</label></div>
        <div class="field field--check"><input id="bk-rep" type="radio" name="mode" value="replace"><label for="bk-rep"><strong>Replace the table with the backup</strong>: deletes every row now in the table first. Changes made since the backup are lost. A safety backup of today’s data is downloaded automatically before anything is changed.</label></div>
      </fieldset>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th scope="col"><input type="checkbox" data-all aria-label="Tick all tables"></th><th scope="col">Table</th><th scope="col" class="num">In backup</th><th scope="col" class="num">Now</th></tr></thead>
        <tbody>${names.map((n) => `<tr><td><input type="checkbox" data-table="${esc(n)}" aria-label="Restore ${esc(n)}"></td><th scope="row">${esc(n.replace(/_/g, ' '))}</th><td class="num">${backup.tables[n].rows.length.toLocaleString()}</td><td class="num">${counts[n] == null ? '' : counts[n].toLocaleString()}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="field__hint">Not restored here: the staff list (add people under Staff), customers’ sign-ins (they sign up again with the same email and are matched back to their pull list), and the change log and job log. The ticked tables are loaded together, parents first: if any of them fails, none of them is changed. Foreign keys stay enforced, so a table whose parent rows are missing is refused unless you tick the parent table too.</p>
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
        impact = await replaceImpact(sb, picked);
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
    } catch (err) {
      setStatus(status, `Restore didn’t start: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
  }
}

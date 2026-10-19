// Staff: your own account (change your password) and, for owners, who has access to the admin.
// Account changes go through the staff-admin Edge Function; the staff table is read-only here.

import { getTheme, saveTheme, COLOR_VARS, getColors, saveColors, currentMode } from '../theme.js';
import { $, $$, esc, toast, setStatus, openDialog, fmtDateTime, solidIcon, friendlyError, setupTabs, sortableTable } from '../lib.js';

let sb;

// Plain names for the tables the change log covers.
const LOG_TABLES = {
  settings: 'Shop settings', items: 'Titles', events: 'Events', posts: 'News', pages: 'Pages', faqs: 'FAQ', categories: 'Categories',
  series_catalog: 'Series list', creator_catalog: 'Creative list', series_aliases: 'Series merges', surveys: 'Surveys', import_exclusions: 'Import exclusions',
  customers: 'Customers', customer_notes: 'Customer notes', event_signups: 'Event signups', staff: 'Staff', media: 'Media',
};
const VERBS = { insert: 'Added', update: 'Changed', delete: 'Deleted' };
const LOG_PAGE = 50;

/** "Changed 1 Titles: Batman #1 (price, status)" as plain text. */
function describe(r) {
  const what = LOG_TABLES[r.table_name] ?? r.table_name;
  const rows = Array.isArray(r.summary) ? r.summary : [];
  const names = rows.map((x) => {
    const cols = x.changed ? ` (${Object.keys(x.changed).join(', ')})` : '';
    return `${x.label || x.key || ''}${cols}`;
  });
  const more = r.row_count > rows.length ? `, and ${r.row_count - rows.length} more` : '';
  return `${VERBS[r.action] ?? r.action} ${r.row_count} ${what}${names.length ? `: ${names.join('; ')}${more}` : ''}`;
}

async function loadLog(el, more = false) {
  const box = $('[data-log]', el);
  const table = $('#log-table', el).value;
  const have = more ? box.querySelectorAll('tbody tr').length : 0;
  let q = sb.from('staff_audit').select('id,created_at,staff_name,table_name,action,row_count,summary').order('id', { ascending: false }).range(have, have + LOG_PAGE - 1);
  if (table) q = q.eq('table_name', table);
  const { data, error } = await q;
  if (error) return void (box.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
  const rowsHtml = data.map((r) => `<tr><td class="card__meta nowrap">${esc(fmtDateTime(r.created_at))}</td><td class="nowrap">${esc(r.staff_name ?? 'Unknown')}</td><td>${esc(describe(r))}</td></tr>`).join('');
  if (!more) {
    box.innerHTML = data.length
      ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th></tr></thead><tbody>${rowsHtml}</tbody></table></div><p data-more-wrap></p>`
      : '<p class="empty">Nothing logged yet.</p>';
  } else {
    $('tbody', box).insertAdjacentHTML('beforeend', rowsHtml);
  }
  const wrap = $('[data-more-wrap]', box);
  if (wrap) wrap.innerHTML = data.length === LOG_PAGE ? '<button class="btn btn--ghost btn--small" type="button" data-more>Show older changes</button>' : '';
  $('[data-more]', box)?.addEventListener('click', () => loadLog(el, true));
}

/** Run a staff-admin action; throws an Error with the server's readable message. */
async function call(body) {
  const { data, error } = await sb.functions.invoke('staff-admin', { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? friendlyError(error));
  }
  return data;
}

/** Show a new password once, with a Copy button. */
function showPassword(title, email, password) {
  const d = openDialog(title, `
    <p>Share this with <strong>${esc(email)}</strong> privately (in person, or a message only they can see). It is shown only once.</p>
    <dl class="staff-cred"><dt>Sign in at</dt><dd>${esc(new URL('./', location.href).href)}</dd><dt>Email</dt><dd>${esc(email)}</dd><dt>Password</dt><dd><code>${esc(password)}</code></dd></dl>
    <div class="admin-actions"><button class="btn btn--primary" type="button" data-copy>Copy email and password</button><button class="btn btn--ghost" type="button" data-done>Done</button></div>
    <p class="field__hint">They can change it any time under Admin → Staff → My account.</p>`);
  $('[data-copy]', d).addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(`Admin: ${new URL('./', location.href).href}\nEmail: ${email}\nPassword: ${password}`);
      e.target.textContent = 'Copied';
    } catch {
      e.target.textContent = 'Couldn’t copy: select the password above';
    }
  });
  $('[data-done]', d).addEventListener('click', () => d.close());
}

export async function mount(el, ctx) {
  sb = ctx.sb;
  const { data: { user } } = await sb.auth.getUser();
  const { data: rows, error } = await sb.rpc('staff_list');
  if (error) {
    el.innerHTML = `<h1>Staff</h1><p class="form-error">${esc(friendlyError(error))}</p>`;
    return;
  }
  const me = rows.find((r) => r.user_id === user.id);
  const owner = !!me?.is_owner;
  const viewerSuper = !!me?.is_super;
  const roleOf = (r) => (r.is_super ? 'Super Admin' : r.is_owner ? 'Owner' : 'Staff');

  el.innerHTML = `
    <h1>Staff</h1>
    ${owner ? `<div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="me">My Account</button>
      <button type="button" class="admin-tab" role="tab" data-tab="access">Staff List</button>
      <button type="button" class="admin-tab" role="tab" data-tab="add">Add a Staff Member</button>
      <button type="button" class="admin-tab" role="tab" data-tab="log">Change Log</button>
    </div>` : ''}
    <div data-tabpane="me">
    <details class="fold toorder fold--static" open>
      <summary class="fold__head"><h2>My Account</h2></summary>
      <div class="fold__body">
      <p>${esc(me?.name ?? '')} · ${esc(user.email)} · <strong>${me ? roleOf(me) : 'Staff'}</strong></p>
      <form class="admin-form" data-theme-form>
        <div class="field"><label for="st-theme">Appearance</label>
          <select id="st-theme">${[['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${v === getTheme() ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <p class="field__hint">Changes the admin for you only, on every device you sign in from.</p></div>
        <p class="admin-status" role="status" data-theme-status></p>
      </form>
      <form class="admin-form" data-colors>
        <h3>Admin colors</h3>
        <p class="field__hint">Pick your own colors for the admin. They apply to the <strong data-colors-mode></strong> theme you are using now (switch Appearance above to set the other one), for you only, on every device you sign in from.</p>
        <div class="form-grid color-grid">${COLOR_VARS.map(([v, label, hint], i) => `<div class="field"><label for="st-c${i}">${label}</label><input id="st-c${i}" data-var="${v}" type="color"><p class="field__hint">${hint}</p></div>`).join('')}</div>
        <div class="admin-form__actions"><button class="btn" type="submit">Save colors</button> <button class="btn btn--ghost" type="button" data-colors-reset>Back to standard colors</button></div>
        <p class="admin-status" role="status" data-colors-status></p>
      </form>
      <form class="admin-form" data-password novalidate>
        <div class="form-grid">
          <div class="field"><label for="st-new">New password</label><input id="st-new" type="password" autocomplete="new-password" minlength="10"></div>
          <div class="field"><label for="st-new2">Type it again</label><input id="st-new2" type="password" autocomplete="new-password" minlength="10"></div>
        </div>
        <p class="field__hint">At least 10 characters. A few random words make a good password.</p>
        <p class="admin-status" role="status" data-pw-status></p>
        <button class="btn btn--primary" type="submit">Change my password</button>
      </form>
      </div>
    </details>
    </div>
    ${owner ? `
    <div data-tabpane="access">
    <details class="fold toorder fold--static" open>
      <summary class="fold__head"><h2>Staff List</h2></summary>
      <div class="fold__body">
      <p class="field__hint">Everyone here can open every admin screen. Owners can also manage this list. Removing someone locks them out of the admin right away. A Super Admin can’t be removed, demoted or have their password reset by an owner.</p>
      <div class="admin-table-wrap"><table class="admin-table staff-table">
        <thead><tr><th scope="col" data-sort="text">Name</th><th scope="col" data-sort="text">Role</th><th scope="col" data-sort="text" data-first="desc">Last Signed In</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${rows.map((r) => {
          const roleKey = r.is_super ? 'super' : r.is_owner ? 'owner' : 'staff';
          return `<tr>
          <td class="st-who"><strong>${esc(r.name)}</strong>${r.user_id === user.id ? ' <span class="card__meta">(you)</span>' : ''}<br><span class="card__meta">${esc(r.email)}</span></td>
          <td class="st-role" data-sort="${r.is_super ? 0 : r.is_owner ? 1 : 2}"><span class="role-badge role-badge--${roleKey}">${solidIcon(roleKey === 'super' ? 'shield' : roleKey === 'owner' ? 'crown' : 'person', 14)} ${roleOf(r)}</span></td>
          <td class="st-last card__meta nowrap" data-sort="${r.last_sign_in_at ?? ''}">${solidIcon('clock', 14)} ${r.last_sign_in_at ? esc(fmtDateTime(r.last_sign_in_at)) : 'Never'}</td>
          <td class="st-actions staff-actions">
            ${r.is_super && !viewerSuper ? '' : `<button class="icon-btn" type="button" data-reset="${r.user_id}" aria-label="Reset password for ${esc(r.name)}" title="Reset password">${solidIcon('key')}</button>`}
            ${r.is_super ? '' : `<button class="icon-btn" type="button" data-owner="${r.user_id}" data-make="${r.is_owner ? '0' : '1'}" aria-label="${r.is_owner ? `Make ${esc(r.name)} regular staff` : `Make ${esc(r.name)} an owner`}" title="${r.is_owner ? 'Make staff' : 'Make owner'}">${solidIcon(r.is_owner ? 'person' : 'crown')}</button>`}
            ${r.user_id === user.id || r.is_super ? '' : `<button class="icon-btn icon-btn--remove" type="button" data-remove="${r.user_id}" aria-label="Remove ${esc(r.name)} from staff" title="Remove from staff">${solidIcon('remove')}</button>`}
          </td></tr>`;
        }).join('')}</tbody>
      </table></div>
      </div>
    </details>
    </div>
    <div data-tabpane="add">
    <details class="fold toorder fold--static" open>
      <summary class="fold__head"><h2>Add a Staff Member</h2></summary>
      <div class="fold__body">
      <form class="admin-form" data-add novalidate>
        <div class="form-grid">
          <div class="field"><label for="st-name">Name</label><input id="st-name" maxlength="80" autocomplete="off" required><p class="field__hint">Shown in change logs, such as “changed by Chris”.</p></div>
          <div class="field"><label for="st-email">Email</label><input id="st-email" type="email" maxlength="254" autocomplete="off" required><p class="field__hint">Their sign-in. Use an address that isn’t already a customer account.</p></div>
          <div class="field"><label for="st-pass">Starting password (optional)</label><input id="st-pass" type="text" autocomplete="off" minlength="10"><p class="field__hint">Leave blank and one is made for you.</p></div>
        </div>
        <p class="admin-status" role="status" data-add-status></p>
        <button class="btn btn--add" type="submit">${solidIcon('add', 18)} Add staff member</button>
      </form>
      </div>
    </details>
    </div>
    <div data-tabpane="log">
    <details class="fold toorder fold--static" open data-log-fold>
      <summary class="fold__head"><h2>Change Log</h2></summary>
      <div class="fold__body">
      <p class="field__hint">Who changed what in the admin, newest first. Imports and bulk changes show as one line. Customer details list the fields changed, not their values.</p>
      <div class="field"><label for="log-table">Show</label>
        <select id="log-table"><option value="">Everything</option>${Object.entries(LOG_TABLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div data-log aria-live="polite"></div>
      </div>
    </details>
    </div>` : '<p class="field__hint">Ask an owner to add or remove staff.</p>'}`;

  // Light or dark: applied at once, then saved on my account.
  $('#st-theme', el).addEventListener('change', async (e) => {
    const status = $('[data-theme-status]', el);
    setStatus(status, 'Saving…');
    const err = await saveTheme(sb, user, e.target.value);
    if (err) setStatus(status, `Applied here, but not saved to your account: ${friendlyError(err)}`, 'error');
    else setStatus(status, 'Saved.', 'ok');
    fillColors();
  });

  // Admin colors: pickers show the colors in effect now; saving keeps only the ones that differ from the standard.
  const colorForm = $('[data-colors]', el);
  const standard = {};
  const fillColors = () => {
    const mode = currentMode();
    $('[data-colors-mode]', el).textContent = mode;
    const root = document.documentElement.style;
    const mine = getColors()[mode] ?? {};
    const saved = COLOR_VARS.map(([v]) => [v, root.getPropertyValue(v)]);
    COLOR_VARS.forEach(([v]) => root.removeProperty(v));
    const cs = getComputedStyle(document.documentElement);
    for (const [v] of COLOR_VARS) standard[v] = hex(cs.getPropertyValue(v).trim());
    saved.forEach(([v, val]) => val && root.setProperty(v, val));
    $$('[data-var]', colorForm).forEach((i) => { i.value = mine[i.dataset.var] ?? standard[i.dataset.var]; });
  };
  const hex = (c) => {
    const d = document.createElement('i');
    d.style.color = c;
    document.body.append(d);
    const [r, g, b] = getComputedStyle(d).color.match(/\d+/g).map(Number);
    d.remove();
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  };
  fillColors();
  const persist = async (mine, msg) => {
    const status = $('[data-colors-status]', el);
    setStatus(status, 'Saving…');
    const all = { ...getColors(), [currentMode()]: mine };
    const err = await saveColors(sb, user, all);
    if (err) setStatus(status, `Applied here, but not saved to your account: ${friendlyError(err)}`, 'error');
    else setStatus(status, msg, 'ok');
    fillColors();
  };
  colorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const mine = {};
    $$('[data-var]', colorForm).forEach((i) => { if (i.value.toLowerCase() !== standard[i.dataset.var].toLowerCase()) mine[i.dataset.var] = i.value; });
    persist(mine, Object.keys(mine).length ? 'Saved.' : 'Saved. Everything is on the standard colors.');
  });
  $('[data-colors-reset]', el).addEventListener('click', () => persist({}, 'Back to the standard colors.'));
  // Preview as you pick.
  colorForm.addEventListener('input', (e) => {
    const v = e.target.dataset?.var;
    if (!v) return;
    document.documentElement.style.setProperty(v, e.target.value);
  });

  // Change my own password.
  const pwForm = $('[data-password]', el);
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('[data-pw-status]', el);
    const a = $('#st-new', el).value;
    if (a.length < 10) return setStatus(status, 'A password needs at least 10 characters.', 'error');
    if (a !== $('#st-new2', el).value) return setStatus(status, 'The two passwords don’t match.', 'error');
    setStatus(status, 'Saving…');
    const { error: uErr } = await sb.auth.updateUser({ password: a });
    if (uErr) return setStatus(status, friendlyError(uErr), 'error');
    pwForm.reset();
    setStatus(status, 'Password changed.', 'ok');
    toast('Password changed');
  });

  if (!owner) return;
  const reload = () => mount(el, ctx);

  setupTabs(el, 'admin-staff-tab', 'me', (tab) => tab === 'log' && !$('[data-log] table', el) && loadLog(el));
  sortableTable($('.staff-table', el));
  $('#log-table', el).addEventListener('change', () => loadLog(el));
  const nameOf = (id) => rows.find((r) => r.user_id === id);

  $('[data-add]', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('[data-add-status]', el);
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    setStatus(status, 'Adding…');
    try {
      const out = await call({ action: 'add', name: $('#st-name', el).value, email: $('#st-email', el).value, password: $('#st-pass', el).value });
      await reload();
      showPassword('Staff member added', out.email, out.password);
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
      btn.disabled = false;
    }
  });

  $$('[data-reset]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      const r = nameOf(b.dataset.reset);
      if (!confirm(`Set a new password for ${r.name}? Their current password stops working.`)) return;
      b.disabled = true;
      try {
        const out = await call({ action: 'reset_password', user_id: r.user_id });
        showPassword('New password', r.email, out.password);
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      b.disabled = false;
    }),
  );
  $$('[data-owner]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      const r = nameOf(b.dataset.owner);
      const make = b.dataset.make === '1';
      if (!confirm(make ? `Make ${r.name} an owner? Owners can add and remove staff.` : `Make ${r.name} a regular staff member? They will no longer be able to manage staff.`)) return;
      b.disabled = true;
      try {
        await call({ action: 'set_owner', user_id: r.user_id, is_owner: make });
        toast(`${r.name} is now ${make ? 'an owner' : 'staff'}`);
        reload();
      } catch (err) {
        toast(friendlyError(err), 'error');
        b.disabled = false;
      }
    }),
  );
  $$('[data-remove]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      const r = nameOf(b.dataset.remove);
      if (!confirm(`Remove ${r.name} (${r.email}) from the staff?\n\nThey will be locked out of the admin right away.`)) return;
      b.disabled = true;
      try {
        await call({ action: 'remove', user_id: r.user_id });
        toast(`${r.name} removed`);
        reload();
      } catch (err) {
        toast(friendlyError(err), 'error');
        b.disabled = false;
      }
    }),
  );
}

// Emails: the weekly pull list email and the "your books are in" email —
// schedule, sender, and preview / test / send-now tools. Saves only its own
// settings columns, so it never touches the Shop Settings fields.

import { $, $$, esc, must, toast, setStatus, openDialog, makeEditor, setHtml, getHtml, imageField, settingsField, formReaders, fmtDateTime, debounce, friendlyError, setupTabs } from '../lib.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;

const SITE_COLOR_FALLBACK = '#982c21';

let dirty = false; // email settings changed (the preview and send buttons use the saved ones)
let textDirty = false; // signup text changed
const sending = new WeakSet(); // email buttons whose request is still running: they stay disabled until it ends
export const hasUnsavedChanges = () => dirty || textDirty;

export async function mount(el, { sb }) {
  dirty = false;
  textDirty = false;
  const s = await must(sb.from('settings').select('*').eq('id', 1).single());
  const signup = await must(sb.from('pages').select('lede_html').eq('slug', 'home-newsletter').maybeSingle());
  const field = settingsField(s);

  el.innerHTML = `
    <h1>Emails</h1>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="settings">Email Settings</button>
      <button type="button" class="admin-tab" role="tab" data-tab="send">Send</button>
      <button type="button" class="admin-tab" role="tab" data-tab="log">Email Log</button>
    </div>
    <div data-tabpane="settings">
    <form class="admin-form settings-form" novalidate>
      <details class="fold toorder"><summary class="fold__head"><h2>Weekly Email Signup</h2></summary><div class="fold__body">
        <div class="editor-block">
          <span class="label" id="lbl-signup">Intro text</span>
          <p class="editor-block__hint">The short text above the email signup form at the bottom of every page. The text can be left empty; the whole signup section is hidden unless the form code below is filled in.</p>
          <div class="editor--lede"><div data-signup-intro></div></div>
        </div>
        <div class="field"><label for="s-newsletter-embed">Signup form code</label>
          <textarea id="s-newsletter-embed" name="newsletter_embed" rows="6" spellcheck="false" autocomplete="off" placeholder="Paste the embed code from EmailOctopus, Mailchimp, Klaviyo or another email service">${esc(s.newsletter_embed)}</textarea>
          <p class="field__hint">Paste the form’s embed or script snippet from your email service. Leave it empty to hide the signup section on every page. Only an owner can change this, because the code runs on your public site.</p></div>
      </div></details>

      <details class="fold toorder"><summary class="fold__head"><h2>Look (Both Emails)<span class="toorder__count">Logo and colors</span></h2></summary><div class="fold__body">
        <p class="field__hint">The logo and colors at the top of the weekly and “your books are in” emails. Anything left on “match the site” follows the Shop Settings logo and main color. Text colors are picked automatically so they stay readable.</p>
        <div data-email-logo></div>
        <p class="field__hint">Leave empty to use the site logo. A square image works best; it is shown small, on the header color below.</p>
        <div class="form-grid color-grid">
          ${[['email_header_color', 'Header color', 'The band behind the logo and shop name.'], ['email_button_color', 'Button color', 'The “Log in” / “View my pull list” button and the section titles.']]
            .map(([k, label, hint]) => `<div class="field"><label for="e-${k}">${label}</label>
              <div class="color-row"><input id="e-${k}" name="${k}" type="color" value="${esc(s[k] ?? s.colors?.primary ?? SITE_COLOR_FALLBACK)}"${s[k] ? '' : ' disabled'}>
              <label class="color-row__match"><input type="checkbox" data-match="${k}"${s[k] ? '' : ' checked'}> Match the site</label></div>
              <p class="field__hint">${hint}</p></div>`).join('')}
        </div>
        <p class="field__hint">Save, then use Preview or “Send a test to me” below to see how it looks.</p>
      </div></details>

      <details class="fold toorder"><summary class="fold__head"><h2>Weekly Pull List Email<span class="toorder__count">${s.pull_list_email_enabled ? `On: ${WEEKDAYS[s.pull_list_email_day]} around ${hourLabel(s.pull_list_email_hour)}` : 'Off'}</span></h2></summary><div class="fold__body">
        <p class="field__hint">Every customer with something on their pull list gets one email a week: what’s ready for pickup, what’s coming, and a link to log in and edit. Customers can turn it off in their profile or with the link in the email.</p>
        <div class="form-grid form-grid--pairs">
          <div class="field span-2"><label><input type="checkbox" name="pull_list_email_enabled"${s.pull_list_email_enabled ? ' checked' : ''}> Send the weekly email</label>
            <p class="field__hint">When this is on, the email goes out automatically on the day and time below.</p></div>
          <div class="field"><label for="s-email-day">Day</label><select id="s-email-day" name="pull_list_email_day">${WEEKDAYS.map((d, i) => `<option value="${i}"${i === s.pull_list_email_day ? ' selected' : ''}>${d}</option>`).join('')}</select></div>
          <div class="field"><label for="s-email-hour">Time (shop time)</label><select id="s-email-hour" name="pull_list_email_hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === s.pull_list_email_hour ? ' selected' : ''}>${hourLabel(h)}</option>`).join('')}</select>
            <p class="field__hint">Sent within the hour, in the shop time zone above.</p></div>
          ${field('pull_list_email_from', 'From', 'maxlength="200" placeholder="Pop’s Comics &lt;pulllist@yourdomain.com&gt;"', 'Must be an address on a domain verified with the sending service. Replies go to the shop email above.').replace('class="field"', 'class="field field--full"')}
        </div>
      </div></details>

      <details class="fold toorder"><summary class="fold__head"><h2>“Your Books Are In” Email<span class="toorder__count">${s.arrival_email_enabled ? `On: ${hourLabel(s.arrival_email_after_hour)} to ${hourLabel(s.arrival_email_before_hour % 24)}` : 'Off'}</span></h2></summary><div class="fold__body">
        <p class="field__hint">When titles on a customer’s pull list become ready for pickup, they get one email listing them (plus anything still waiting). It uses the same sender as the weekly email, and customers can turn it off in their profile.</p>
        <div class="form-grid form-grid--pairs">
          <div class="field span-2"><label><input type="checkbox" name="arrival_email_enabled"${s.arrival_email_enabled ? ' checked' : ''}> Send “your books are in” emails</label>
            <p class="field__hint">Checked every hour. Titles become ready for pickup on their release date, or when you mark them Ready.</p></div>
          <div class="field"><label for="s-arr-after">Send no earlier than</label><select id="s-arr-after" name="arrival_email_after_hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === s.arrival_email_after_hour ? ' selected' : ''}>${hourLabel(h)}</option>`).join('')}</select>
            <p class="field__hint">Shop time. Set it to when the new books are on the shelf.</p></div>
          <div class="field"><label for="s-arr-before">and before</label><select id="s-arr-before" name="arrival_email_before_hour">${Array.from({ length: 24 }, (_, i) => i + 1).map((h) => `<option value="${h}"${h === s.arrival_email_before_hour ? ' selected' : ''}>${hourLabel(h % 24)}</option>`).join('')}</select>
            <p class="field__hint">Anything marked later waits until tomorrow.</p></div>
        </div>
      </div></details>

      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">Save email settings</button>
        <span class="admin-status" role="status"></span>
      </div>
    </form>
    </div>
    <div data-tabpane="send">
    <details class="fold toorder fold--static" open>
      <summary class="fold__head"><h2>Weekly Pull List Email<span class="toorder__count">${s.pull_list_email_enabled ? `Automatic: ${WEEKDAYS[s.pull_list_email_day]} around ${hourLabel(s.pull_list_email_hour)}` : 'Automatic sending is off'}</span></h2></summary>
      <div class="fold__body">
        <div class="email-tools">
          <h2 class="email-tools__title">Try It First</h2>
          <div class="admin-actions">
            <button class="btn btn--ghost btn--small" type="button" data-email="preview">Preview</button>
            <button class="btn btn--ghost btn--small" type="button" data-email="test">Send a test to me</button>
          </div>
          <p class="field__hint">Uses the customer with the fullest pull list and sends only to you.</p>
          <div class="email-tools__send">
            <button class="btn btn--danger btn--small" type="button" data-email="send">Send to everyone now</button>
            <p class="field__hint">Emails every customer with something to report, right now. Anyone already emailed today is skipped.${s.pull_list_email_last_sent ? ` Last scheduled send: ${esc(s.pull_list_email_last_sent)}.` : ''}</p>
          </div>
          <p class="admin-status" role="status" data-email-status></p>
          <p class="email-tools__dirty" data-email-dirty hidden>You have unsaved changes. These buttons use the <strong>saved</strong> settings, so save them first on the Email settings tab.</p>
        </div>
      </div>
    </details>
    <details class="fold toorder fold--static" open>
      <summary class="fold__head"><h2>“Your Books Are In” Email<span class="toorder__count">${s.arrival_email_enabled ? `Automatic: ${hourLabel(s.arrival_email_after_hour)} to ${hourLabel(s.arrival_email_before_hour % 24)}` : 'Automatic sending is off'}</span></h2></summary>
      <div class="fold__body">
        <div class="email-tools">
          <h2 class="email-tools__title">Try It First</h2>
          <div class="admin-actions">
            <button class="btn btn--ghost btn--small" type="button" data-email="arrivals_preview">Preview</button>
            <button class="btn btn--ghost btn--small" type="button" data-email="arrivals_test">Send a test to me</button>
          </div>
          <p class="field__hint">Uses a customer with titles waiting to be announced. If there are none, it shows a sample using someone’s open titles, marked [Sample].</p>
          <div class="email-tools__send">
            <button class="btn btn--danger btn--small" type="button" data-email="arrivals">Send waiting emails now</button>
            <p class="field__hint">Emails everyone whose newly arrived titles haven’t been announced yet, right now, ignoring the sending hours.</p>
          </div>
          <p class="admin-status" role="status" data-email-status></p>
          <p class="email-tools__dirty" data-email-dirty hidden>You have unsaved changes. These buttons use the <strong>saved</strong> settings, so save them first on the Email settings tab.</p>
        </div>
      </div>
    </details>
    </div>
    <div data-tabpane="log">
    <details class="fold toorder fold--static email-log" data-email-log open>
      <summary class="fold__head"><h2>Email Log<span class="toorder__count" data-log-count>Every email the site has sent</span></h2></summary>
      <div class="fold__body">
        <div class="email-log__filters filters--compact">
          <select data-log-kind aria-label="Type of email"><option value="">All types</option>${Object.entries(LOG_KINDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
          <input type="search" data-log-q placeholder="Search recipient or subject" aria-label="Search the email log">
          <label><input type="checkbox" data-log-failed> Failed only</label>
        </div>
        <div data-log-rows aria-live="polite"></div>
        <div class="admin-pager"><button class="btn btn--ghost" type="button" data-log-prev>← Newer</button><span data-log-page></span><button class="btn btn--ghost" type="button" data-log-next>Older →</button></div>
      </div>
    </details>
    </div>`;

  const showTab = setupTabs(el, 'admin-emails-tab', 'settings');
  const form = $('form', el);
  const emailLogo = imageField($('[data-email-logo]', el), { folder: 'brand', label: 'Logo', maxSize: 800, library: true });
  emailLogo.set(s.email_logo_url);
  // "Match the site" greys out the color; saving then stores nothing, so the emails follow Shop Settings.
  $$('[data-match]', el).forEach((box) => box.addEventListener('change', () => ($(`input[name="${box.dataset.match}"]`, el).disabled = box.checked)));
  const signupEditor = makeEditor($('[data-signup-intro]', el), 'lede', $('#lbl-signup', el));
  setHtml(signupEditor, signup?.lede_html);
  signupEditor.on('text-change', () => (textDirty = true));
  // Preview / test / send-now read the saved settings, so hold them back while the form has unsaved edits.
  const syncEmailButtons = () => {
    $$('[data-email]', el).forEach((b) => (b.disabled = dirty || sending.has(b)));
    $$('[data-email-dirty]', el).forEach((n) => (n.hidden = !dirty));
  };
  form.addEventListener('input', () => ((dirty = true), syncEmailButtons()));
  form.addEventListener('change', () => ((dirty = true), syncEmailButtons()));
  syncEmailButtons();

  $$('[data-email]', el).forEach((btn) => btn.addEventListener('click', () => emailAction(sb, btn, $('[data-email-status]', btn.closest('.email-tools')))));

  setupLog(sb, el);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('.sticky-actions .admin-status', el);
    const f = new FormData(form);
    const { text, int } = formReaders(f);
    if (int('arrival_email_after_hour', 12) >= int('arrival_email_before_hour', 20)) return setStatus(status, 'The “your books are in” sending hours need to end after they start.', 'error');
    const row = {
      pull_list_email_enabled: f.has('pull_list_email_enabled'), pull_list_email_day: int('pull_list_email_day', 4), pull_list_email_hour: int('pull_list_email_hour', 9), pull_list_email_from: text('pull_list_email_from'),
      email_logo_url: emailLogo.get(), email_header_color: text('email_header_color'), email_button_color: text('email_button_color'), // disabled colors aren't in the form data → null
      arrival_email_enabled: f.has('arrival_email_enabled'), arrival_email_after_hour: int('arrival_email_after_hour', 12), arrival_email_before_hour: int('arrival_email_before_hour', 20),
    };
    const embed = text('newsletter_embed');
    if (embed !== (s.newsletter_embed?.trim() || null)) row.newsletter_embed = embed; // sent only when changed, so other staff can save the rest
    setStatus(status, 'Saving…');
    try {
      // One call, so the settings and the signup text are saved together or not at all (it errors if nothing was saved).
      await must(sb.rpc('staff_save_email_settings', { p: row, p_signup_html: getHtml(signupEditor) }));
      s.newsletter_embed = embed;
      dirty = false;
      textDirty = false;
      syncEmailButtons();
      setStatus(status, `Saved ${new Date().toLocaleTimeString()} — live on the site now.`, 'ok');
      toast('Email settings saved');
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
}

const LOG_KINDS = { weekly: 'Weekly pull list', arrival: 'Your books are in', message: 'Message to a customer', test: 'Test', inquiry: 'Sell form', event_confirm: 'Event signup confirmation', event_notify: 'Event signup (to shop)' };
const LOG_PAGE = 25;

/**
 * The email log. Loads when the panel is first opened. Emails sent together by one weekly or "your books are in"
 * run show as a single entry that expands to its recipients; single emails (messages, tests, the sell form) show
 * on their own. Searching or "Failed only" lists individual emails instead, since those cut across runs.
 */
function setupLog(sb, el) {
  const box = $('[data-email-log]', el);
  const rowsBox = $('[data-log-rows]', box);
  const state = { offset: 0, kind: '', q: '', failed: false };
  const byId = new Map(); // email id -> row, for the View dialog
  let loaded = false;

  const kindLabel = (k) => LOG_KINDS[k] ?? k;
  const statusCell = (r) => (r.status === 'failed' ? '<span class="pill pill--failed">Failed</span>' : 'Sent');
  const emailRow = (r, { member = false } = {}) => {
    byId.set(r.id, r);
    return `<tr class="${member ? 'email-log__member' : ''}${r.status === 'failed' ? ' is-overdue' : ''}">
      <td class="nowrap card__meta">${member ? '' : esc(fmtDateTime(r.created_at))}</td>
      <td>${member ? '' : esc(kindLabel(r.kind))}</td>
      <td class="email-log__to card-title">${esc(r.to_email)}</td>
      <td class="email-log__subject card-line">${esc(r.subject)}</td>
      <td class="card-key">${statusCell(r)}</td>
      <td class="card-action"><button class="btn btn--ghost btn--small" type="button" data-log-view="${r.id}">View</button></td>
    </tr>`;
  };
  const groupRow = (g) => `<tr class="email-log__group" data-run="${esc(g.run_id)}">
      <td class="nowrap card__meta">${esc(fmtDateTime(g.created_at))}</td>
      <td>${esc(kindLabel(g.kind))}</td>
      <td colspan="2" class="card-title"><strong>${g.total} ${g.total === 1 ? 'email' : 'emails'}</strong>${g.sent_by ? ` <span class="card__meta">· ${esc(g.sent_by)}</span>` : ''}</td>
      <td class="card-key">${g.failed ? `<span class="pill pill--failed">${g.failed} failed</span>` : 'Sent'}</td>
      <td class="card-action"><button class="btn btn--ghost btn--small" type="button" data-log-run="${esc(g.run_id)}" aria-expanded="false">Show</button></td>
    </tr>`;
  // An entry with no run is one email: show it like any other row, and fetch its text when View is clicked.
  const singleRow = (g) => `<tr${g.failed ? ' class="is-overdue"' : ''}>
      <td class="nowrap card__meta">${esc(fmtDateTime(g.created_at))}</td>
      <td>${esc(kindLabel(g.kind))}</td>
      <td class="email-log__to card-title">${esc(g.to_email)}</td>
      <td class="email-log__subject card-line">${esc(g.subject)}</td>
      <td class="card-key">${g.failed ? '<span class="pill pill--failed">Failed</span>' : 'Sent'}</td>
      <td class="card-action"><button class="btn btn--ghost btn--small" type="button" data-log-view="${g.first_id}">View</button></td>
    </tr>`;
  const table = (body) => `<div class="admin-table-wrap"><table class="admin-table email-log__table cards">
      <thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">View</span></th></tr></thead>
      <tbody>${body}</tbody></table></div>`;

  async function load() {
    rowsBox.setAttribute('aria-busy', 'true');
    const flat = !!(state.q.trim() || state.failed);
    let q;
    if (flat) {
      q = sb.from('email_log').select('id,kind,to_email,subject,body,status,error,sent_by,created_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false });
      if (state.failed) q = q.eq('status', 'failed');
      const term = state.q.trim().replace(/[%_,()"\\]/g, ' ').trim();
      if (term) q = q.or(`to_email.ilike.%${term}%,subject.ilike.%${term}%`);
    } else {
      q = sb.from('email_log_groups').select('group_key,run_id,kind,created_at,total,failed,first_id,to_email,subject,sent_by', { count: 'exact' }).order('created_at', { ascending: false });
    }
    if (state.kind) q = q.eq('kind', state.kind);
    const { data, count, error } = await q.range(state.offset, state.offset + LOG_PAGE - 1);
    rowsBox.removeAttribute('aria-busy');
    if (error) {
      rowsBox.innerHTML = `<p class="form-error">Couldn’t load the log: ${esc(friendlyError(error))}</p>`;
      return;
    }
    const noun = flat ? (count === 1 ? 'email' : 'emails') : count === 1 ? 'entry' : 'entries';
    $('[data-log-count]', box).textContent = `${count} ${noun}${state.kind || flat ? ' match' : ''}`;
    $('[data-log-page]', box).textContent = count ? `${state.offset + 1}–${Math.min(state.offset + LOG_PAGE, count)} of ${count}` : '';
    $('[data-log-prev]', box).disabled = state.offset === 0;
    $('[data-log-next]', box).disabled = state.offset + LOG_PAGE >= count;
    rowsBox.innerHTML = data.length ? table(data.map((r) => (flat ? emailRow(r) : r.run_id ? groupRow(r) : singleRow(r))).join('')) : '<p class="empty">No emails match.</p>';
  }

  const reload = () => ((state.offset = 0), load());
  $('[data-log-kind]', box).addEventListener('change', (e) => ((state.kind = e.target.value), reload()));
  $('[data-log-failed]', box).addEventListener('change', (e) => ((state.failed = e.target.checked), reload()));
  // The Dashboard's Needs Attention "Fix" opens the log on the failed emails.
  try {
    if (sessionStorage.getItem('admin-emails-failed')) {
      sessionStorage.removeItem('admin-emails-failed');
      state.failed = true;
      $('[data-log-failed]', box).checked = true;
      showTab('log');
    }
  } catch {
    /* no hand-off */
  }
  loaded = true;
  load();
  $('[data-log-q]', box).addEventListener('input', debounce((e) => ((state.q = e.target.value), reload()), 300));
  $('[data-log-prev]', box).addEventListener('click', () => ((state.offset = Math.max(0, state.offset - LOG_PAGE)), load()));
  $('[data-log-next]', box).addEventListener('click', () => ((state.offset += LOG_PAGE), load()));

  rowsBox.addEventListener('click', async (e) => {
    const run = e.target.closest('[data-log-run]');
    if (run) {
      const groupTr = run.closest('tr');
      const open = run.getAttribute('aria-expanded') === 'true';
      const members = groupTr.nextElementSibling?.matches('.email-log__members') ? groupTr.nextElementSibling : null;
      if (open) {
        members?.remove();
        run.setAttribute('aria-expanded', 'false');
        run.textContent = 'Show';
        return;
      }
      run.disabled = true;
      // A run can have more than 1000 emails (one request's limit), so read it in pages.
      const data = [];
      let error = null;
      for (let from = 0; ; from += 1000) {
        const res = await sb.from('email_log').select('id,kind,to_email,subject,body,status,error,sent_by,created_at').eq('run_id', run.dataset.logRun).order('to_email').order('id').range(from, from + 999);
        if (res.error) {
          error = res.error;
          break;
        }
        data.push(...res.data);
        if (res.data.length < 1000) break;
      }
      run.disabled = false;
      if (error) return void toast(`Couldn’t load that run: ${friendlyError(error)}`, 'error');
      groupTr.insertAdjacentHTML('afterend', `<tr class="email-log__members card-expand"><td colspan="6">${table(data.map((r) => emailRow(r, { member: true })).join(''))}</td></tr>`);
      run.setAttribute('aria-expanded', 'true');
      run.textContent = 'Hide';
      return;
    }
    const id = Number(e.target.closest('[data-log-view]')?.dataset.logView);
    if (!id) return;
    let r = byId.get(id);
    if (!r) {
      const { data, error } = await sb.from('email_log').select('id,kind,to_email,subject,body,status,error,sent_by,created_at').eq('id', id).single();
      if (error) return void toast(`Couldn’t open that email: ${friendlyError(error)}`, 'error');
      r = data;
    }
    openDialog(
      r.subject,
      `<p class="card__meta">${esc(kindLabel(r.kind))} · to ${esc(r.to_email)} · ${esc(fmtDateTime(r.created_at))}${r.sent_by ? ` · by ${esc(r.sent_by)}` : ''}</p>
       ${r.status === 'failed' ? `<p class="form-error">Not sent: ${esc(r.error ?? 'unknown error')}</p>` : ''}
       <pre class="email-log__body">${esc(r.body ?? '(no text saved)')}</pre>`,
      { wide: true },
    );
  });
}

/** Preview / test / send for the weekly email, through the weekly-pull-list Edge Function. */
async function emailAction(sb, btn, status) {
  const mode = btn.dataset.email;
  const kind = mode.startsWith('arrivals') ? 'arrivals' : 'weekly';
  const action = mode.endsWith('preview') ? 'preview' : mode.endsWith('test') ? 'test' : 'send';
  if (action === 'send' && !confirm(kind === 'arrivals'
    ? 'Send “your books are in” emails now to everyone whose newly arrived titles haven’t been announced yet?'
    : 'Send the weekly pull list email to every opted-in customer now? Anyone already emailed today is skipped.')) return;
  btn.disabled = true;
  sending.add(btn);
  setStatus(status, action === 'preview' ? 'Building preview…' : 'Sending…');
  try {
    const { data, error } = await sb.functions.invoke('weekly-pull-list', { body: { mode } });
    if (error) {
      // The function answers errors as JSON with a readable message.
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error ?? friendlyError(error));
    }
    if (action === 'preview') {
      setStatus(status, '');
      const d = openDialog(`Preview — ${data.subject}`, `<p class="card__meta">${data.sample ? 'Sample: no titles are waiting to be announced, so this shows someone’s open titles as if they had just arrived. Customer: ' : 'Customer: '}${esc(data.customer)}</p><iframe class="email-preview" sandbox title="Email preview" srcdoc="${esc(data.html)}"></iframe>`, { wide: true });
      d.querySelector('iframe').style.cssText = 'width:100%;height:70vh;border:1px solid #ddd;border-radius:6px';
    } else if (action === 'test') {
      setStatus(status, `Test sent to ${data.to}.`, 'ok');
    } else {
      // Customers another run (the scheduled one, another tab) was already emailing, and bookkeeping problems.
      const extra = `${data.sendingElsewhere ? ` ${data.sendingElsewhere} were already being sent by another run.` : ''}${data.errors?.length ? ` Problem: ${data.errors.join(' ')}` : ''}`;
      const bad = data.failed || data.errors?.length ? 'error' : 'ok';
      if (kind === 'arrivals') {
        setStatus(status, (data.sent ? `Sent ${data.sent}${data.failed ? `, ${data.failed} failed (they’ll be retried)` : ''}.` : data.failed ? `${data.failed} failed; they’ll be retried.` : data.sendingElsewhere ? 'Nothing sent here.' : 'Nothing waiting: no customer has newly arrived titles to announce.') + extra, bad);
      } else {
        setStatus(status, `Sent ${data.sent}${data.failed ? `, ${data.failed} failed` : ''}. ${data.nothingToSend} had nothing to report, ${data.optedOut} opted out.${extra}`, bad);
      }
    }
  } catch (err) {
    setStatus(status, friendlyError(err), 'error');
  }
  sending.delete(btn);
  btn.disabled = dirty;
}

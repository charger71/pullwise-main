// Notifications: staff write shop news (a sale, a big new release, a closure) and send it to every app user who has
// "News from the shop" on. The push-notify Edge Function (mode `news`) checks it, records it in news_pushes and sends
// it in the background; a test send goes only to the sender's own app devices. Below the form, the shop's sends so far.
// Only shops with the app have this screen (APP_ENABLED; admin.js hides the menu item).

import { $, esc, must, toast, setStatus, fmtDateTime, friendlyError, hintFold, uid, openDialog } from '../lib.js';
import { APP_TARGETS, toNewsPath, lastSentText, recentWarning, reachText, testResultText, rowSummary, stillSending, NEWS_EMOJI, insertText } from '../news-push.js';

const TITLE_MAX = 60; // as supabase/functions/push-notify/messages.js
const BODY_MAX = 180;
const PAGE = 20;
const POLL = 4000; // re-read the history this often while a send is still going out
const SITE = 'site'; // the "A page on our website" choice
const COLUMNS = 'id,title,body,url,test,sent_by_name,status,error,devices,sent,failed,created_at';

const NOTE = 'Send only what customers will be glad to get: a sale, a big new release, a closure or change of hours. Every notice buzzes their phone. Too many and they’ll turn shop news off, or turn off notifications altogether. Once or twice a month is plenty.';

let sb;
let root;
let run = 0; // bumped on each mount, so a late answer or timer for an old screen is ignored
let rows = []; // news_pushes shown, newest first
let limit = PAGE;
let reach = 0;
let requestId = ''; // one per message: a retry of the same message is the same send, never a second one
let timer;
let shown; // what this screen put on the page; every screen draws into the same #section, so leaving takes it off

const chars = (s) => Array.from(s).length;
const live = (mine) => mine === run && !!shown?.isConnected;

export async function mount(el, ctx) {
  clearTimeout(timer);
  sb = ctx.sb;
  root = el;
  const mine = ++run;
  limit = PAGE;
  requestId = crypto.randomUUID();
  root.innerHTML = '<p class="admin-hint loading">Loading…</p>';
  shown = root.firstElementChild;
  const shop = (await must(sb.from('settings').select('shop_name,favicon_url,logo_url').eq('id', 1).maybeSingle())) ?? {};
  if (!live(mine)) return;
  const u = uid('np');
  root.innerHTML = `
    <h1>Notifications</h1>
    ${hintFold('Send a notification to the phones of everyone who uses your pull list app with notifications on: a sale, a big new release, a closure or a change of hours. Write a short title and message, pick where a tap opens (the app, one of its tabs, or a page on your website), and tick <strong>Test send</strong> to try it on your own phone first. A test only reaches you if you are signed in to the app with this same account and turned its notifications on. A real send goes out straight away, to every customer with <strong>News from the shop</strong> on (customers turn it off in the app under Account → Notifications, and keep their pickup alerts). iPhones only get notifications from the app added to the Home Screen. Below the form is every notification the shop has sent, with who sent it and how many devices got it.')}
    <p class="notice">${esc(NOTE)}</p>
    <form class="admin-form push-compose" novalidate>
      <div class="push-compose__fields">
        <div class="field"><label for="${u}-title">Title</label><input id="${u}-title" name="title" maxlength="${TITLE_MAX * 2}" autocomplete="off" value="${esc((shop.shop_name ?? '').trim())}" aria-describedby="${u}-title-count">
          ${underField(u, 'title', 'the title')}</div>
        <div class="field"><label for="${u}-body">Message</label><textarea id="${u}-body" name="body" rows="3" maxlength="${BODY_MAX * 2}" aria-describedby="${u}-body-count"></textarea>
          ${underField(u, 'body', 'the message')}</div>
        <div class="field"><label for="${u}-opens">Tapping it opens</label><select id="${u}-opens" name="opens">
          ${APP_TARGETS.map((t) => `<option value="${esc(t.value)}">${esc(t.label)}</option>`).join('')}
          <option value="${SITE}">A page on our website</option></select></div>
        <div class="field" data-site hidden><label for="${u}-page">Page</label><input id="${u}-page" name="page" maxlength="400" autocomplete="off" placeholder="/news/big-sale" aria-describedby="${u}-page-hint">
          <p class="field__hint" id="${u}-page-hint">A page on your own site, like /news/big-sale, or its full address. It opens like any page of your website, outside the app’s tabs.</p></div>
      </div>
      <div class="push-compose__side">
        <p class="push-preview__label" id="${u}-preview">How it looks</p>
        <div class="push-preview" aria-labelledby="${u}-preview">
          ${notificationIcon(shop) ? `<img class="push-preview__icon" src="${esc(notificationIcon(shop))}" alt="">` : '<span class="push-preview__icon" aria-hidden="true"></span>'}
          <div class="push-preview__text"><strong data-preview="title"></strong><span data-preview="body"></span></div>
        </div>
      </div>
      <p class="admin-hint" data-reach></p>
      <div class="field field--check"><input id="${u}-test" name="test" type="checkbox"><label for="${u}-test">Test send: only to my own devices</label></div>
      <p class="admin-status" role="status" data-state></p>
      <div class="admin-actions"><button class="btn btn--primary" type="submit" data-send>Send</button></div>
    </form>
    <h2>Sent</h2>
    <div data-history><p class="admin-hint loading">Loading…</p></div>`;

  const form = $('form', root);
  shown = form;
  const update = (e) => {
    // A changed message is a new send: a retry after a lost answer must not repeat the earlier one (a test, say).
    if (e) requestId = crypto.randomUUID();
    preview(form);
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(form, mine);
  });
  emojiPickers(form);
  update();
  await refresh(mine);
}

/** Under Title and Message: the character count, and the emoji picker for that field. */
function underField(u, name, what) {
  const panel = `${u}-${name}-emoji`;
  return `<div class="push-compose__under">
          <p class="field__hint" id="${u}-${name}-count" data-count="${name}"></p>
          <div class="emoji-pick">
            <button class="btn btn--ghost btn--small" type="button" aria-expanded="false" aria-controls="${panel}" data-emoji-for="${name}"><span aria-hidden="true">🙂</span> Emoji</button>
            <div class="emoji-pick__panel" id="${panel}" role="group" aria-label="Add an emoji to ${what}" hidden>
              ${NEWS_EMOJI.map((e) => `<button class="emoji-pick__item" type="button" data-emoji="${e.emoji}" aria-label="${esc(e.name)}" title="${esc(e.name)}">${e.emoji}</button>`).join('')}
            </div>
          </div>
        </div>`;
}

/**
 * The emoji buttons open their panel (one at a time); picking one puts it in the field at the cursor and closes the
 * panel. Escape or a click elsewhere closes it, Escape returning to its button.
 */
function emojiPickers(form) {
  const close = (btn, focus = false) => {
    btn.setAttribute('aria-expanded', 'false');
    $(`#${btn.getAttribute('aria-controls')}`, form).hidden = true;
    if (focus) btn.focus();
  };
  const openBtn = () => $('[data-emoji-for][aria-expanded="true"]', form);
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji-for]');
    if (btn) {
      const was = btn.getAttribute('aria-expanded') === 'true';
      if (openBtn()) close(openBtn());
      if (!was) {
        btn.setAttribute('aria-expanded', 'true');
        const panel = $(`#${btn.getAttribute('aria-controls')}`, form);
        panel.hidden = false;
        $('.emoji-pick__item', panel).focus();
      }
      return;
    }
    const item = e.target.closest('[data-emoji]');
    if (!item) return;
    const owner = item.closest('.emoji-pick').querySelector('[data-emoji-for]');
    const field = form.elements[owner.dataset.emojiFor];
    const { value, caret } = insertText(field.value, field.selectionStart, field.selectionEnd, item.dataset.emoji);
    close(owner);
    field.value = value;
    field.focus();
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event('input', { bubbles: true })); // counts, preview and a new send id
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openBtn()) {
      e.preventDefault();
      close(openBtn(), true);
    }
  });
  const outside = (e) => {
    if (!form.isConnected) return document.removeEventListener('click', outside);
    if (openBtn() && !e.target.closest('.emoji-pick')) close(openBtn());
  };
  document.addEventListener('click', outside);
}

/** The shop's tab icon (or logo), as the notification shows it. */
const notificationIcon = (shop) => (/^https:\/\//.test(shop.favicon_url || shop.logo_url || '') ? shop.favicon_url || shop.logo_url : '');

/** Counts, the preview, the page box and the Send button, from what's typed. */
function preview(form) {
  const title = form.elements.title.value.trim();
  const body = form.elements.body.value.trim();
  const count = (name, n, max) => {
    const p = $(`[data-count="${name}"]`, form);
    p.textContent = `${n} / ${max}`;
    p.classList.toggle('form-error', n > max);
  };
  count('title', chars(title), TITLE_MAX);
  count('body', chars(body), BODY_MAX);
  $('[data-preview="title"]', form).textContent = title || 'Title';
  $('[data-preview="body"]', form).textContent = body || 'Your message';
  $('[data-site]', form).hidden = form.elements.opens.value !== SITE;
  $('[data-send]', form).disabled = !form.elements.test.checked && reach === 0;
  $('[data-send]', form).textContent = form.elements.test.checked ? 'Send test' : 'Send';
}

/** The reach, the last send and the history. Keeps re-reading while a send is still going out. */
async function refresh(mine) {
  clearTimeout(timer);
  const [count, list] = await Promise.all([sb.rpc('push_news_reach'), sb.from('news_pushes').select(COLUMNS).order('created_at', { ascending: false }).limit(limit + 1)]);
  if (!live(mine)) return;
  const form = $('form', root);
  if (count.error || list.error) {
    setStatus($('[data-state]', form), friendlyError(count.error ?? list.error), 'error');
    return;
  }
  reach = count.data ?? 0;
  rows = list.data.slice(0, limit);
  $('[data-reach]', form).innerHTML = `<strong>${esc(reachText(reach))}</strong> · ${esc(lastSentText(rows))}`;
  preview(form);
  showHistory(list.data.length > limit);
  if (stillSending(rows)) timer = setTimeout(() => live(mine) && refresh(mine), POLL);
}

function showHistory(more) {
  const box = $('[data-history]', root);
  if (!rows.length) {
    box.innerHTML = '<p class="empty">Nothing sent yet.</p>';
    return;
  }
  const opens = (url) => APP_TARGETS.find((t) => t.value === url)?.label ?? url;
  box.innerHTML = `<div class="admin-table-wrap"><table class="admin-table cards"><thead><tr><th scope="col">Notification</th><th scope="col">Opens</th><th scope="col">Sent</th><th scope="col">Reached</th></tr></thead><tbody>${rows
    .map((r) => `<tr>
        <td class="card-title"><strong>${esc(r.title)}</strong>${r.test ? ' <span class="pill pill--info">Test</span>' : ''}<br><span class="card__meta">${esc(r.body)}</span></td>
        <td class="card-key">${esc(opens(r.url))}</td>
        <td class="card-key">${esc(fmtDateTime(r.created_at))}${r.sent_by_name ? `<br><span class="card__meta">${esc(r.sent_by_name)}</span>` : ''}</td>
        <td class="card-key">${esc(rowSummary(r))}</td>
      </tr>`)
    .join('')}</tbody></table></div>${more ? '<div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-more>Show more</button></div>' : ''}`;
  $('[data-more]', box)?.addEventListener('click', () => {
    limit += PAGE;
    refresh(run);
  });
}

/** Check, confirm (unless it's a test) and send. */
async function send(form, mine) {
  const status = $('[data-state]', form);
  const title = form.elements.title.value.trim();
  const body = form.elements.body.value.trim();
  const test = form.elements.test.checked;
  if (!title) return setStatus(status, 'Write a title.', 'error'), form.elements.title.focus();
  if (chars(title) > TITLE_MAX) return setStatus(status, `Keep the title to ${TITLE_MAX} characters.`, 'error'), form.elements.title.focus();
  if (!body) return setStatus(status, 'Write a message.', 'error'), form.elements.body.focus();
  if (chars(body) > BODY_MAX) return setStatus(status, `Keep the message to ${BODY_MAX} characters.`, 'error'), form.elements.body.focus();
  let url = form.elements.opens.value;
  if (url === SITE) {
    if (!form.elements.page.value.trim()) return setStatus(status, 'Write the page to open, like /news/big-sale.', 'error'), form.elements.page.focus();
    const link = toNewsPath(form.elements.page.value, location.host);
    if (link.error) return setStatus(status, link.error, 'error'), form.elements.page.focus();
    url = link.path;
  }
  setStatus(status, '');
  if (!test && !(await confirmSend())) return;

  const btn = $('[data-send]', form);
  btn.disabled = true;
  setStatus(status, 'Sending…');
  try {
    const { data, error } = await sb.functions.invoke('push-notify', { body: { mode: 'news', title, body, url, test, request_id: requestId } });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error ?? friendlyError(error));
    }
    requestId = crypto.randomUUID();
    if (!live(mine)) return;
    if (test) {
      const devices = data.push?.devices ?? data.devices ?? 0;
      setStatus(status, testResultText(devices), devices ? 'ok' : 'error');
    } else {
      setStatus(status, '');
      const devices = data.push?.devices ?? 0;
      toast(`Sending to ${devices} device${devices === 1 ? '' : 's'}.`);
      form.elements.body.value = '';
      form.elements.test.checked = false;
    }
    await refresh(mine);
  } catch (err) {
    if (live(mine)) setStatus(status, friendlyError(err), 'error');
  }
  if (live(mine)) preview(form);
}

/** "Send to 143 devices?", with a warning when the shop sent one in the last few days. Resolves true to send. */
function confirmSend() {
  const warning = recentWarning(rows);
  const d = openDialog(
    'Send this notification?',
    `<p>Send to ${esc(String(reach))} device${reach === 1 ? '' : 's'}? This can’t be undone.</p>
     ${warning ? `<p class="cust-warn">${esc(warning)}</p>` : ''}
     <div class="admin-actions"><button class="btn btn--primary" type="button" data-yes>Send</button><button class="btn btn--ghost" type="button" data-no>Cancel</button></div>`,
  );
  return new Promise((resolve) => {
    let answer = false;
    $('[data-yes]', d).addEventListener('click', () => {
      answer = true;
      d.close();
    });
    $('[data-no]', d).addEventListener('click', () => d.close());
    d.addEventListener('close', () => resolve(answer));
    $('[data-no]', d).focus();
  });
}

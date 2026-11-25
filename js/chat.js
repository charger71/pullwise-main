// Live chat for the public pages: a button in the corner opens a small chat box. Shown only when staff switch it on
// (Shop Settings → Online). A visitor needs no login: this browser keeps a random secret token, and the database
// functions chat_start / chat_send / chat_fetch (supabase/migrations/…_live_chat.sql) only ever give back the chat
// that token belongs to. Staff answer from Admin → Chat. New replies arrive by checking every few seconds while the
// box is open (and every half minute while it is closed, to light the dot on the button).
// A customer who is signed in starts the chat on their account (chat_start links it), so staff see who they are and
// the shop's replies reach the customer's phone as an app notification (supabase/functions/push-notify, chat-reply).
// Staff can also start a chat with a customer (Admin → Customers → Messages → Chat). That chat lives on the customer's
// account, so a signed-in customer's browser asks chat_mine for their newest open chat (on load, and with each check
// while the box is closed) and switches to it, lighting the dot. The same check carries a chat across their devices.
// While the box is open it reports the newest shop message it has shown (chat_mark_seen), so staff see "Seen".
// In the shop's app the button sits above the tab bar, and a notification's ?chat=1 opens the chat.

import { supabase, DEMO } from './data.js';
import { esc, chatOn } from './util.js';
import { $, linkify, fmtTime } from './site.js';
import { profile } from './customer.js';

const KEY = 'pw-chat';
const POLL_OPEN = 4000;
const POLL_CLOSED = 30000;
const LAUNCH_LABEL = 'Chat with us';
const LAUNCH_LABEL_NEW = 'Chat with us, the shop has replied';
const DEFAULT_GREETING = 'Ask us anything. We’ll reply right here. If we’re busy in the shop it can take a few minutes.';

const readSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
};
/** Keep what is saved (the chat's token, what was read, whether the button is hidden) and change only `patch`. */
const writeSaved = (patch) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readSaved(), ...patch }));
  } catch {
    /* without storage the chat lasts until the page is closed */
  }
};
/** The message to show a visitor for a failed call: the database's own sentence when it wrote one, else a generic one. */
const sayError = (error) => (error?.code === 'P0001' ? error.message : 'Sorry, that didn’t go through. Please check your connection and try again.');

/** `findAgain`: where a visitor who hid the button finds the chat again (the website's footer, the app's Shop tab). */
export function initChat(settings, { findAgain = 'Find it again in the page footer.' } = {}) {
  if (DEMO || !chatOn(settings) || $('#chat')) return;
  const saved = readSaved();
  let token = saved.token ?? null; // set once a chat has been started
  let seen = saved.seen ?? 0; // the newest shop message the visitor has read
  let hidden = saved.hidden ?? false; // the visitor hid the floating button; the footer link still opens the chat
  let messages = [];
  let status = 'open';
  let isOpen = false;
  let timer;
  let reported = 0; // the newest shop message chat_mark_seen has been told about (it ignores anything older)

  document.body.insertAdjacentHTML('beforeend', `
    <button class="btn btn--primary chat-launch" id="chat-launch" type="button" aria-controls="chat" aria-expanded="false" aria-label="${LAUNCH_LABEL}" title="${LAUNCH_LABEL}"><svg class="chat-launch__icon" viewBox="0 0 307 246" aria-hidden="true" focusable="false"><path d="M47.5 179.4A153.4 103.8 0 1 1 100.2 201.4L27 246L20 244zM88.3 103.9a14.5 14.5 0 1 0 29 0a14.5 14.5 0 1 0-29 0zM138.3 103.9a14.5 14.5 0 1 0 29 0a14.5 14.5 0 1 0-29 0zM188.3 103.9a14.5 14.5 0 1 0 29 0a14.5 14.5 0 1 0-29 0z"/></svg><span class="chat-launch__dot" hidden></span></button>
    <section class="chat" id="chat" aria-label="Chat with ${esc(settings.shop_name)}" hidden>
      <div class="chat__head">
        <h2 class="chat__title">Chat with ${esc(settings.shop_name)}</h2>
        <button class="btn btn--ghost btn--small" type="button" data-chat-close>Close</button>
      </div>
      <div class="chat__body"></div>
      <p class="chat__foot"><button class="chat__hide" type="button">Hide this button</button><span>${esc(findAgain)}</span></p>
    </section>`);
  const launch = $('#chat-launch');
  launch.hidden = hidden;
  const panel = $('#chat');
  const body = $('.chat__body', panel);
  const dot = $('.chat-launch__dot', launch);
  /** The dot on the button says there is a new reply; the button's name says it too, for a screen reader. */
  const setDot = (show) => {
    dot.hidden = !show;
    launch.setAttribute('aria-label', show ? LAUNCH_LABEL_NEW : LAUNCH_LABEL);
    launch.title = show ? LAUNCH_LABEL_NEW : LAUNCH_LABEL;
  };

  /**
   * Signed in: switch to the newest open chat on the customer's account when it isn't the one this browser has (the
   * shop started it, or it was started on another device). Shows the button again, since the shop is waiting on them.
   * Returns whether it switched. Quiet on failure, like refresh.
   */
  async function adopt() {
    const sb = await supabase();
    const { data: auth } = await sb.auth.getSession();
    if (!auth?.session) return false;
    const { data, error } = await sb.rpc('chat_mine');
    if (error || !data?.token || data.token === token) return false;
    token = data.token;
    messages = [];
    seen = 0;
    reported = 0;
    hidden = false;
    writeSaved({ token, seen, hidden });
    if (!isOpen) launch.hidden = false;
    return true;
  }

  const newestShop = () => messages.filter((m) => m.from_staff).reduce((max, m) => Math.max(max, m.id), 0);

  /** With the box open, tell the shop how far the visitor has read, so staff see "Seen". Tries again next time on failure. */
  async function markSeen() {
    const last = newestShop();
    if (!token || !last || last <= reported) return;
    reported = last;
    const sb = await supabase();
    const { error } = await sb.rpc('chat_mark_seen', { p_token: token, p_message: last });
    if (error) reported = 0;
  }

  function renderStart() {
    const me = profile(); // signed in: the chat goes on their account, and the form starts with their details
    body.innerHTML = `
      <form class="chat__form" novalidate>
        <p class="chat__note">${esc(settings.chat_greeting || DEFAULT_GREETING)}</p>
        ${me ? '<p class="chat__note">You’re signed in, so the shop sees this chat on your account, and its replies can reach you as app notifications.</p>' : ''}
        <div class="field"><label for="chat-name">Your name</label><input id="chat-name" name="name" required maxlength="80" autocomplete="given-name" value="${esc(me?.name.slice(0, 80) ?? '')}"></div>
        <div class="field"><label for="chat-email">Email (optional)</label><input id="chat-email" name="email" type="email" maxlength="200" autocomplete="email" value="${esc(me?.email.slice(0, 200) ?? '')}"><p class="field__hint">So we can reach you if you close this page.</p></div>
        <div class="field"><label for="chat-first">Message</label><textarea id="chat-first" name="body" rows="2" required maxlength="1000"></textarea></div>
        <div class="honeypot" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <p class="form-error" role="alert"></p>
        <button class="btn btn--primary" type="submit">Start chat</button>
      </form>`;
    $('form', body).addEventListener('submit', start);
  }

  function renderThread() {
    body.innerHTML = `
      <div class="chat__log" role="log" aria-label="Chat messages" tabindex="0"></div>
      <p class="chat__note" hidden>The shop closed this chat. Send a message to open it again.</p>
      <form class="chat__send">
        <label class="visually-hidden" for="chat-reply">Your message</label>
        <textarea id="chat-reply" rows="2" maxlength="1000" required></textarea>
        <button class="btn btn--primary" type="submit">Send</button>
      </form>
      <p class="form-error" role="alert"></p>`;
    const form = $('.chat__send', body);
    form.addEventListener('submit', send);
    // Enter sends, Shift+Enter adds a line (a phone's keyboard keeps its own Return key for a new line).
    $('textarea', form).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(min-width: 600px)').matches) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    paintLog();
  }

  function paintLog() {
    const log = $('.chat__log', body);
    if (!log) return;
    const nearEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.innerHTML = messages
      .map((m) => `<div class="chat__msg${m.from_staff ? '' : ' chat__msg--mine'}"><p>${m.from_staff ? linkify(m.body) : esc(m.body)}</p><span class="chat__time">${m.from_staff ? 'Shop · ' : ''}${esc(fmtTime(m.created_at))}</span></div>`)
      .join('');
    $('.chat__note', body).hidden = status !== 'closed';
    if (nearEnd || !log.dataset.drawn) log.scrollTop = log.scrollHeight;
    log.dataset.drawn = '1';
  }

  /** Fetch the chat and redraw if anything changed. Quiet on failure: the next check tries again. */
  async function refresh() {
    if ((!isOpen || !token) && (await adopt()) && isOpen) renderThread();
    if (!token) return;
    const sb = await supabase();
    const { data, error } = await sb.rpc('chat_fetch', { p_token: token });
    if (error) return;
    if (!data) {
      // Staff deleted the chat: the next message starts a fresh one.
      token = null;
      messages = [];
      seen = 0;
      writeSaved({ token: null, seen: 0 });
      setDot(false);
      if (isOpen) renderStart();
      return;
    }
    const changed = data.messages.at(-1)?.id !== messages.at(-1)?.id || data.status !== status;
    messages = data.messages;
    status = data.status;
    if (isOpen) {
      seen = newestShop();
      writeSaved({ token, seen });
      markSeen();
      if (changed) paintLog();
    } else {
      setDot(newestShop() > seen);
    }
  }

  function schedule() {
    clearTimeout(timer);
    // With no chat yet, keep checking only for a signed-in customer (adopt asks nothing of a visitor).
    timer = setTimeout(async () => {
      if (!document.hidden) await refresh();
      schedule();
    }, isOpen ? POLL_OPEN : POLL_CLOSED);
  }

  async function start(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const err = $('.form-error', form);
    const f = new FormData(form);
    const [name, email, text] = ['name', 'email', 'body'].map((k) => String(f.get(k) ?? '').trim());
    if (!name || !text) {
      err.textContent = 'Please add your name and a message.';
      return $(name ? '#chat-first' : '#chat-name', form).focus();
    }
    err.textContent = '';
    const submit = $('[type="submit"]', form);
    submit.disabled = true;
    const sb = await supabase();
    const fresh = crypto.randomUUID();
    const { error } = await sb.rpc('chat_start', { p_token: fresh, p_name: name, p_email: email || null, p_body: text, p_website: f.get('website') || null });
    if (error) {
      submit.disabled = false;
      err.textContent = sayError(error);
      return;
    }
    token = fresh;
    seen = 0;
    writeSaved({ token, seen });
    renderThread();
    await refresh();
    $('#chat-reply', body)?.focus();
    schedule();
  }

  async function send(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const box = $('textarea', form);
    const text = box.value.trim();
    if (!text) return box.focus();
    const err = $('.form-error', body);
    err.textContent = '';
    const submit = $('[type="submit"]', form);
    submit.disabled = true;
    const sb = await supabase();
    const { error } = await sb.rpc('chat_send', { p_token: token, p_body: text });
    submit.disabled = false;
    if (error) {
      err.textContent = sayError(error);
      return;
    }
    box.value = '';
    box.focus();
    await refresh();
  }

  async function setOpen(open) {
    isOpen = open;
    panel.hidden = !open;
    launch.hidden = open || hidden;
    launch.setAttribute('aria-expanded', String(open));
    if (open) {
      token ? renderThread() : renderStart();
      (token ? $('#chat-reply', body) : profile()?.name ? $('#chat-first', body) : $('#chat-name', body))?.focus();
      await refresh();
      if (token) {
        seen = newestShop();
        writeSaved({ token, seen });
        markSeen();
        setDot(false);
      }
    } else {
      // Back to where the visitor opened it from: the button, or the footer link once the button is hidden.
      hidden ? $('a[href="#chat"]')?.focus({ preventScroll: true }) : launch.focus();
    }
    schedule();
  }

  launch.addEventListener('click', () => setOpen(true));
  $('[data-chat-close]', panel).addEventListener('click', () => setOpen(false));
  $('.chat__hide', panel).addEventListener('click', () => {
    hidden = true;
    writeSaved({ hidden });
    setOpen(false);
  });
  // The footer's "Chat with us" link (js/site.js) opens the chat, whether or not the button is hidden. Hiding is kept
  // between visits; closing the box afterwards doesn't bring the button back.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href="#chat"]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    setOpen(true);
  });
  panel.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));

  // Tapping a "the shop replied" notification opens the app at ?chat=1: show the chat, then tidy the address.
  const params = new URLSearchParams(location.search);
  if (params.has('chat')) {
    params.delete('chat');
    history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    setOpen(true);
  } else {
    // A visitor who chatted before sees the dot if the shop has answered since they last looked; a signed-in customer
    // also sees a chat the shop started with them.
    refresh().then(schedule);
  }
}

// Chat: read and answer the live chat visitors start on the public pages. The switch at the top of the list turns the
// chat button on and off for visitors; the owner can remove the whole feature in Shop Settings → Online. The list and an open chat update as messages arrive (Supabase Realtime), with a slow refresh
// as a backup in case the live connection drops.

import { $, $$, esc, must, toast, setStatus, fmtDateTime, friendlyError, hintFold, uid, switchHtml } from '../lib.js';
import { adminHash } from '../route.js';
import { setupStaffPush } from '../staff-push.js';

const BACKUP_REFRESH = 20000;
const SNIPPET = 90;
let sb;
let root; // the element this screen draws into (replaced by the next screen, which is how we know to stop)
let run = 0; // bumped each time the list or a chat is drawn, so a late answer for an old screen is ignored
let channel;
let timer;
let listTab = 'open'; // open | closed
let me = null; // the signed-in staff member's email, saved with each reply

export const hasUnsavedChanges = () => !!(root?.isConnected && $('[name="reply"]', root)?.value.trim());

/** Stop listening for the screen that is going away. */
function stop() {
  clearInterval(timer);
  if (channel) sb.removeChannel(channel);
  channel = null;
}

/** Call `refresh` whenever a chat changes, and every so often as a backup. Stops itself once the screen has gone. */
function listen(mine, refresh) {
  const live = () => mine === run && root.isConnected;
  const again = () => (live() ? refresh() : stop());
  channel = sb
    .channel(`admin-chat-${mine}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, again)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, again)
    .subscribe();
  timer = setInterval(again, BACKUP_REFRESH);
}

export async function mount(el, ctx) {
  stop();
  sb = ctx.sb;
  root = el;
  me ??= (await sb.auth.getUser()).data.user?.email ?? null;
  return ctx.arg ? showChat(Number(ctx.arg)) : showList();
}

// ---- The list of chats ----------------------------------------------------------------------------------------------

async function showList() {
  const mine = ++run;
  const settings = await must(sb.from('settings').select('chat_enabled').eq('id', 1).maybeSingle());
  const on = !!settings?.chat_enabled;
  root.innerHTML = `
    <div class="admin-title-row"><h1>Chat</h1>${switchHtml(chatLabel(on), { checked: on, attrs: 'data-chat-switch' })}</div>
    ${hintFold('Visitors start a chat from the button in the corner of every public page. This screen shows new messages as they arrive, so leave it open while you want to be reachable; if you are on another screen, a message pops up in the corner and the Chat menu item shows how many chats are waiting. Turn on chat notifications (the line under the switch) to get a notification on this phone or computer when a visitor writes, even with the admin closed; each staff member turns them on for each of their own devices. Reply here, close a chat when you are done, and delete the ones you no longer need (chats keep the visitor’s name and, if they gave it, their email). A visitor who writes again reopens a closed chat. A customer who is signed in (on the website or in the app) chats on their account: the chat says Customer and links to their account, and your replies reach their phone as an app notification if they turned those on. Use the switch at the top to turn chat on or off for visitors. The owner can remove the chat feature altogether in Shop Settings → Online.')}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-status="open">Open <span class="admin-tab__badge" data-unread hidden></span></button>
      <button type="button" class="admin-tab" role="tab" data-status="closed">Closed</button>
    </div>
    <p class="admin-hint" data-switch-hint></p>
    <p class="admin-hint" data-chat-notify></p>
    <p class="admin-status" role="status" data-state></p>
    <div data-list></div>`;
  $$('[data-status]', root).forEach((b) =>
    b.addEventListener('click', () => {
      listTab = b.dataset.status;
      loadList(mine);
    }),
  );
  wireSwitch(mine, on);
  setupStaffPush($('[data-chat-notify]', root), sb);
  await loadList(mine);
  listen(mine, () => loadList(mine));
}

const chatLabel = (on) => (on ? 'Chat is on' : 'Chat is off');
const switchHint = (on) =>
  on
    ? 'Visitors see a “Chat with us” button on every public page. You only get their messages while you are signed in to the admin, so switch chat off when nobody is around to answer.'
    : 'Visitors don’t see the chat button or the footer link. Switch chat on when you can answer.';

/** The on/off switch: saves as soon as it is flipped, and goes back if the save fails. */
function wireSwitch(mine, on) {
  const box = $('[data-chat-switch]', root);
  const text = $('.switch__text', root);
  const hint = $('[data-switch-hint]', root);
  const show = (v) => {
    box.checked = v;
    text.textContent = chatLabel(v);
    hint.textContent = switchHint(v);
  };
  show(on);
  box.addEventListener('change', async () => {
    const want = box.checked;
    box.disabled = true;
    try {
      // Row-level security turns an update by a signed-out session into "0 rows", not an error.
      const rows = await must(sb.from('settings').update({ chat_enabled: want }).eq('id', 1).select('id'));
      if (!rows?.length) throw Object.assign(new Error('You may have been signed out. Sign in again, then try once more.'), { code: 'P0001' });
      show(want);
      toast(want ? 'Chat is on. Visitors can message you now.' : 'Chat is off. Visitors no longer see the chat button.');
    } catch (err) {
      if (mine === run && root.isConnected) show(!want);
      toast(`Not saved: ${friendlyError(err)}`, 'error');
    } finally {
      box.disabled = false;
    }
  });
}

async function loadList(mine) {
  const box = $('[data-list]', root);
  try {
    const all = await must(sb.from('chat_conversations').select('id,name,email,status,unread_staff,last_message_at,customer_id').order('last_message_at', { ascending: false }).limit(200));
    if (mine !== run) return;
    const rows = all.filter((c) => c.status === listTab);
    const last = new Map(); // the newest message of each chat, for the preview
    if (rows.length) {
      const recent = await must(sb.from('chat_messages').select('conversation_id,from_staff,body').in('conversation_id', rows.map((c) => c.id)).order('id', { ascending: false }).limit(400));
      recent.forEach((m) => last.has(m.conversation_id) || last.set(m.conversation_id, m));
    }
    if (mine !== run) return;
    $$('[data-status]', root).forEach((b) => b.setAttribute('aria-selected', b.dataset.status === listTab));
    const unread = all.filter((c) => c.status === 'open').reduce((n, c) => n + (c.unread_staff > 0 ? 1 : 0), 0);
    const badge = $('[data-unread]', root);
    badge.textContent = unread;
    badge.hidden = !unread;
    setStatus($('[data-state]', root), '');
    box.innerHTML = rows.length
      ? `<div class="admin-table-wrap"><table class="admin-table cards"><thead><tr><th scope="col">Visitor</th><th scope="col">Last message</th><th scope="col">When</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows
          .map((c) => {
            const m = last.get(c.id);
            const text = m ? `${m.from_staff ? 'You: ' : ''}${m.body}` : '';
            return `<tr>
              <td class="card-title"><strong>${esc(c.name)}</strong>${c.email || c.customer_id ? `<br><span class="card__meta">${[c.customer_id ? 'Customer' : '', esc(c.email ?? '')].filter(Boolean).join(' · ')}</span>` : ''}</td>
              <td class="card-wide">${esc(text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text)}</td>
              <td class="card-key">${esc(fmtDateTime(c.last_message_at))}</td>
              <td class="card-key">${c.unread_staff > 0 ? `<span class="pill pill--new">${c.unread_staff} new</span>` : c.status === 'closed' ? '<span class="pill pill--off">Closed</span>' : '<span class="pill pill--done">Answered</span>'}</td>
              <td class="card-foot"><a class="btn btn--ghost btn--small" href="${adminHash('chat', c.id)}">Open<span class="visually-hidden"> chat with ${esc(c.name)}</span></a></td>
            </tr>`;
          })
          .join('')}</tbody></table></div>`
      : `<p class="empty">${listTab === 'open' ? 'No open chats. New ones show up here the moment a visitor writes.' : 'No closed chats.'}</p>`;
  } catch (err) {
    if (mine === run) setStatus($('[data-state]', root), `Couldn’t load chats: ${friendlyError(err)}`, 'error');
  }
}

// ---- One chat -------------------------------------------------------------------------------------------------------

async function showChat(id) {
  const mine = ++run;
  const chat = await must(sb.from('chat_conversations').select('id,name,email,status,created_at,customer_id').eq('id', id).maybeSingle());
  if (!chat) {
    root.innerHTML = `<p><a class="btn btn--ghost btn--small" href="${adminHash('chat')}">← Back to chats</a></p><p class="empty">That chat is gone. A teammate may have deleted it.</p>`;
    return;
  }
  const replyId = uid('chat-reply');
  root.innerHTML = `
    <p><a class="btn btn--ghost btn--small" href="${adminHash('chat')}">← Back to chats</a></p>
    <div class="admin-title-row">
      <h1>${esc(chat.name)}</h1>
      <div class="admin-actions">
        <button class="btn btn--ghost btn--small" type="button" data-toggle></button>
        <button class="btn btn--danger btn--small" type="button" data-delete>Delete</button>
      </div>
    </div>
    <p class="card__meta">${chat.customer_id ? `<a href="${adminHash('customers', chat.customer_id)}">Customer account</a> · ` : ''}${chat.email ? `<a href="mailto:${esc(chat.email)}" data-email-to="${esc(chat.email)}" data-email-name="${esc(chat.name)}">${esc(chat.email)}</a> · ` : ''}Started ${esc(fmtDateTime(chat.created_at))}</p>
    <div class="chat-thread" role="log" aria-label="Messages with ${esc(chat.name)}" tabindex="0" data-log></div>
    <form class="chat-compose" data-reply-form>
      <div class="field"><label for="${replyId}">Reply</label><textarea id="${replyId}" name="reply" rows="2" maxlength="1000" required></textarea></div>
      <button class="btn btn--primary" type="submit">Send</button>
    </form>
    <p class="admin-status" role="status" data-state></p>`;
  const state = $('[data-state]', root);
  const toggle = $('[data-toggle]', root);
  const paintStatus = () => {
    toggle.textContent = chat.status === 'open' ? 'Close chat' : 'Reopen chat';
  };
  paintStatus();

  toggle.addEventListener('click', async () => {
    const next = chat.status === 'open' ? 'closed' : 'open';
    try {
      await must(sb.from('chat_conversations').update({ status: next }).eq('id', id).select('id'));
      chat.status = next;
      paintStatus();
      toast(next === 'closed' ? 'Chat closed' : 'Chat reopened');
    } catch (err) {
      setStatus(state, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });

  $('[data-delete]', root).addEventListener('click', async () => {
    if (!confirm(`Delete the chat with ${chat.name} and all its messages? This can’t be undone.`)) return;
    try {
      await must(sb.from('chat_conversations').delete().eq('id', id).select('id'));
      toast('Chat deleted');
      location.hash = adminHash('chat');
    } catch (err) {
      setStatus(state, `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });

  const form = $('[data-reply-form]', root);
  const box = $('[name="reply"]', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text) return box.focus();
    const send = $('[type="submit"]', form);
    send.disabled = true;
    try {
      await must(sb.from('chat_messages').insert({ conversation_id: id, from_staff: true, body: text, sent_by: me }).select('id'));
      if (chat.status === 'closed') {
        // Answering a closed chat opens it again, so the visitor isn't told the shop closed it.
        await must(sb.from('chat_conversations').update({ status: 'open' }).eq('id', id).select('id'));
        chat.status = 'open';
        paintStatus();
      }
      box.value = '';
      setStatus(state, '');
      await loadChat(mine, id);
    } catch (err) {
      setStatus(state, `Not sent: ${friendlyError(err)}`, 'error');
    }
    send.disabled = false;
    box.focus();
  });
  // Ctrl or Cmd + Enter sends from the keyboard.
  box.addEventListener('keydown', (e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && (e.preventDefault(), form.requestSubmit()));

  await loadChat(mine, id);
  box.focus();
  listen(mine, () => loadChat(mine, id));
}

async function loadChat(mine, id) {
  try {
    const messages = await must(sb.from('chat_messages').select('id,from_staff,body,sent_by,created_at').eq('conversation_id', id).order('id'));
    if (mine !== run) return;
    const log = $('[data-log]', root);
    const nearEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.innerHTML = messages.length
      ? messages.map((m) => `<div class="chat-msg${m.from_staff ? ' chat-msg--staff' : ''}"><p>${esc(m.body)}</p><span class="chat-msg__meta">${m.from_staff ? esc(m.sent_by || 'Staff') : 'Visitor'} · ${esc(fmtDateTime(m.created_at))}</span></div>`).join('')
      : '<p class="empty">No messages.</p>';
    if (nearEnd || !log.dataset.drawn) log.scrollTop = log.scrollHeight;
    log.dataset.drawn = '1';
    // Opening a chat reads it: clear the "new" count (only when there is something to clear, so it isn't written every refresh).
    await sb.from('chat_conversations').update({ unread_staff: 0 }).eq('id', id).gt('unread_staff', 0);
  } catch (err) {
    if (mine === run) setStatus($('[data-state]', root), `Couldn’t load messages: ${friendlyError(err)}`, 'error');
  }
}

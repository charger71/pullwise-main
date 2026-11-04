// Chat alerts on every admin screen: a count of chats with unread visitor messages on the Chat menu item (admin.js adds
// it to the phone menu button's total), the same count in the browser tab's title, a toast when a visitor writes while staff are
// somewhere else, and a desktop notification when this tab is in the background and staff turned those on (Chat
// screen). The count clears once staff open the chat, since opening it sets its unread_staff back to 0.
// Supabase Realtime tells us about changes; a slow refresh is the backup in case the live connection drops.

import { $, $$, toast } from './lib.js';
import { adminHash } from './route.js';

const BACKUP_REFRESH = 60000;
const SNIPPET = 120;
let sb;
let screen = () => ({ name: '', arg: '' }); // the open admin screen
let changed = () => {};
let channel = null;
let timer;
let pending;
let count = 0;

/** How many open chats have visitor messages nobody has read yet. */
export const unreadChats = () => count;

/** Can this browser show desktop notifications, and what has staff said? 'unsupported' | 'default' | 'granted' | 'denied' */
export const desktopAlerts = () => ('Notification' in window ? Notification.permission : 'unsupported');

/** Ask for desktop notifications (call from a click). Resolves to the new desktopAlerts() value. */
export async function askForDesktopAlerts() {
  if (!('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Start watching. `current()` names the open screen ({ name, arg }); `onCount(n)` runs whenever the count changes. */
export function startChatAlerts(client, { current, onCount } = {}) {
  stopChatAlerts();
  sb = client;
  if (current) screen = current;
  if (onCount) changed = onCount;
  channel = sb
    .channel('admin-chat-alerts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (change) => arrived(change.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, soon)
    .subscribe();
  timer = setInterval(refresh, BACKUP_REFRESH);
  document.addEventListener('visibilitychange', onVisible);
  refresh();
}

/** Stop watching and hide the count (Live Chat switched off for the shop). */
export function stopChatAlerts() {
  clearInterval(timer);
  clearTimeout(pending);
  document.removeEventListener('visibilitychange', onVisible);
  if (channel) sb.removeChannel(channel);
  channel = null;
  paint(0);
}

const onVisible = () => document.visibilityState === 'visible' && refresh();

// Several changes often land together (a message and its chat's new count): count once.
function soon() {
  clearTimeout(pending);
  pending = setTimeout(refresh, 300);
}

async function refresh() {
  if (!channel) return;
  const { count: n, error } = await sb.from('chat_conversations').select('id', { count: 'exact', head: true }).eq('status', 'open').gt('unread_staff', 0);
  if (!error && channel) paint(n ?? 0);
}

function paint(n) {
  $$('[data-chat-badge]').forEach((b) => {
    b.hidden = !n;
    b.innerHTML = n ? `${n}<span class="visually-hidden"> unread chat${n === 1 ? '' : 's'}</span>` : '';
  });
  if (n === count) return;
  count = n;
  changed(n);
}

/** A new message: tell staff unless they are already looking at it. */
async function arrived(m) {
  soon();
  if (!m || m.from_staff) return;
  const { name, arg } = screen();
  // The Chat list and the open chat show new messages themselves.
  const onScreen = name === 'chat' && (!arg || Number(arg) === m.conversation_id);
  const away = document.visibilityState === 'hidden';
  if (onScreen && !away) return;
  const { data: chat } = await sb.from('chat_conversations').select('name').eq('id', m.conversation_id).maybeSingle();
  const who = chat?.name || 'a visitor';
  const href = adminHash('chat', m.conversation_id);
  // One toast per chat at a time: a visitor sending three lines in a row shouldn't stack three.
  if (!onScreen && !$(`.toast__link[href="${href}"]`)) toast(`New chat message from ${who}`, 'ok', { href, text: 'Open chat' });
  if (away && desktopAlerts() === 'granted') {
    const body = String(m.body ?? '');
    try {
      const note = new Notification(`Chat from ${who}`, { body: body.length > SNIPPET ? `${body.slice(0, SNIPPET)}…` : body, tag: `chat-${m.conversation_id}` });
      note.onclick = () => {
        window.focus();
        location.hash = href;
        note.close();
      };
    } catch {
      /* some browsers only allow notifications from a service worker; the toast and count still show */
    }
  }
}

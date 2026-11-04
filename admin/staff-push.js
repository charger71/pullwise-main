// Chat notifications on a staff member's phone or computer, even with the admin closed (Web Push). Turned on per
// device from the Chat screen: the browser subscribes through the admin's service worker (admin/sw.js shows what
// arrives), the database keeps the subscription (save_staff_push_subscription), and supabase/functions/push-notify
// sends a notice when a visitor writes (public.chat_message_push asks it to). Where the browser can't do Web Push, or
// the shop has no VAPID keys yet, the line offers the in-tab desktop alerts instead (admin/chat-alerts.js).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { $, toast, friendlyError, solidIcon, openDialog, esc } from './lib.js';
import { desktopAlerts, askForDesktopAlerts } from './chat-alerts.js';

/** How to allow notifications again once they are blocked, for the browsers staff use. */
function showUnblockHelp() {
  const site = esc(location.host || 'this site');
  const d = openDialog('Allow notifications', `
    <p>Notifications for <strong>${site}</strong> were blocked in this browser. Allow them again, reload this page, then choose <strong>Turn on chat notifications</strong>.</p>
    <h3>Chrome</h3>
    <ol>
      <li>Click the icon at the left end of the address bar, just before <strong>${site}</strong>.</li>
      <li>Next to <strong>Notifications</strong>, choose <strong>Allow</strong> (or turn the switch on).</li>
      <li>Reload the page.</li>
    </ol>
    <p class="admin-hint">Or open Settings → Privacy and security → Site settings → Notifications, find ${site} under “Not allowed to send notifications” and change it to Allow. On an Android phone: tap the icon before the address, then Permissions → Notifications.</p>
    <h3>Edge</h3>
    <ol>
      <li>Click the lock icon at the left end of the address bar.</li>
      <li>Choose <strong>Permissions for this site</strong>.</li>
      <li>Next to <strong>Notifications</strong>, choose <strong>Allow</strong>, then reload the page.</li>
    </ol>
    <p class="admin-hint">Or open Settings → Cookies and site permissions → Notifications and remove ${site} from the Block list.</p>
    <h3>Safari on a Mac</h3>
    <ol>
      <li>In the menu bar, choose <strong>Safari → Settings</strong> (Preferences on older versions), then the <strong>Websites</strong> tab.</li>
      <li>Choose <strong>Notifications</strong> on the left.</li>
      <li>Find ${site} and set it to <strong>Allow</strong>, then reload the page.</li>
    </ol>
    <p class="admin-hint">Also check that the Mac lets Safari show notifications: System Settings → Notifications → Safari.</p>
    <div class="admin-actions"><button class="btn btn--primary" type="button" data-close>Done</button></div>`);
  $('[data-close]', d).addEventListener('click', () => d.close());
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** The shop's VAPID public key from push-notify ('' when notifications aren't set up there yet). */
let keyPromise;
const publicKey = () =>
  (keyPromise ??= (SUPABASE_URL
    ? fetch(`${SUPABASE_URL}/functions/v1/push-notify`, { headers: { apikey: SUPABASE_ANON_KEY } })
        .then((r) => (r.ok ? r.json() : {}))
        .then((j) => j.publicKey || '')
        .catch(() => '')
    : Promise.resolve('')));

const keyBytes = (base64url) => Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** The admin's service worker, registered on first use; null if it doesn't start. */
async function worker() {
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' });
    return await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
  } catch {
    return null;
  }
}

/** This device's subscription, if it has one (without registering anything). */
async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration('./').catch(() => null);
  return reg ? reg.pushManager.getSubscription().catch(() => null) : null;
}

/** Tapping a notice while the admin is open: the worker asks the tab to show that chat. */
export function listenForOpenRequests() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const hash = e.data?.type === 'open' && typeof e.data.hash === 'string' ? e.data.hash : '';
    if (/^#chat(\/\d+)?$/.test(hash)) location.hash = hash;
  });
}

/** Fill `line` (a <p class="admin-hint">) with where this device stands, and the button to change it. */
export async function setupStaffPush(line, sb) {
  const button = (text, attr) => `<button class="admin-link-button" type="button" ${attr}>${text}</button>`;
  const show = (html) => {
    if (line.isConnected) line.innerHTML = html;
  };

  async function render() {
    const permission = desktopAlerts();
    line.hidden = permission === 'unsupported';
    if (permission === 'unsupported') return;
    if (permission === 'denied') {
      return show(`Notifications are blocked for this site. To get them, allow notifications for this site in your browser’s settings. <button class="icon-btn icon-btn--info" type="button" aria-label="How to allow notifications" title="How to allow notifications" data-push-help>${solidIcon('info', 20)}</button>`);
    }
    if (!supported() || !(await publicKey())) {
      // No Web Push here: alerts while the admin is open in a background tab.
      return show(permission === 'granted'
        ? 'Desktop alerts are on in this browser: a message shows on your screen while the admin is open in a background tab.'
        : `Get a desktop alert when a visitor writes while the admin is in a background tab. ${button('Turn on desktop alerts', 'data-alerts-on')}`);
    }
    if (await currentSubscription()) {
      return show(`Chat notifications are on for this device, even when the admin is closed. ${button('Send a test', 'data-push-test')} · ${button('Turn off on this device', 'data-push-off')}`);
    }
    show(`Get a notification on this device when a visitor writes, even when the admin is closed. ${button('Turn on chat notifications', 'data-push-on')}`);
  }

  async function turnOn() {
    if ((await Notification.requestPermission()) !== 'granted') {
      await render();
      return toast('Notifications weren’t allowed. You can turn them on here any time.', 'error');
    }
    const reg = await worker();
    if (!reg) throw new Error('The browser didn’t start notifications. Reload the page and try once more.');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await publicKey()) });
    const { endpoint, keys } = sub.toJSON();
    const { error } = await sb.rpc('save_staff_push_subscription', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth, p_user_agent: navigator.userAgent });
    if (error) {
      await sub.unsubscribe().catch(() => {});
      throw error;
    }
    await render();
    toast('Chat notifications are on for this device');
  }

  async function turnOff() {
    const sub = await currentSubscription();
    if (sub) {
      const { error } = await sb.rpc('delete_staff_push_subscription', { p_endpoint: sub.endpoint });
      if (error) throw error;
      await sub.unsubscribe();
    }
    await render();
    toast('Chat notifications are off for this device');
  }

  async function test() {
    const { data, error } = await sb.functions.invoke('push-notify', { body: { mode: 'staff-test' } });
    if (error || !data?.sent) throw new Error('The test didn’t go through. Turn notifications off and on again, then try once more.');
    toast('Test sent. It should appear in a moment.');
  }

  line.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-push-help]')) return showUnblockHelp();
    b.disabled = true;
    try {
      if (b.matches('[data-push-on]')) await turnOn();
      else if (b.matches('[data-push-off]')) await turnOff();
      else if (b.matches('[data-push-test]')) await test();
      else if (b.matches('[data-alerts-on]')) {
        await askForDesktopAlerts();
        await render();
        if (desktopAlerts() === 'granted') toast('Desktop alerts are on');
      }
    } catch (err) {
      await render();
      toast(err?.code ? `Not saved: ${friendlyError(err)}` : err?.message || 'That didn’t work. Please try again.', 'error');
    } finally {
      b.disabled = false;
    }
  });
  await render();
}

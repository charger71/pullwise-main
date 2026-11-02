// Notifications in the pull list app (App → Account): turn them on or off for this phone or browser, pick which kinds,
// and send a test. The phone subscribes through the app's service worker (sw.js shows what arrives); the database keeps
// the subscription (save_push_subscription) and supabase/functions/push-notify sends the notices.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, esc } from './site.js';
import * as pull from './customer.js';
import { isInstalled as installed } from './app-device.js';

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/push-notify`;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** The shop's VAPID public key from push-notify ('' when notifications aren't set up there yet). */
let keyPromise;
const publicKey = () =>
  (keyPromise ??= fetch(FUNCTION_URL, { headers: { apikey: SUPABASE_ANON_KEY } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => j.publicKey || '')
    .catch(() => ''));

const keyBytes = (base64url) => Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** The app's service worker, once it's running (js/pages/app.js registers it); null if it never starts. */
const worker = () => Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);

const KINDS = [
  { key: 'push_arrivals', label: 'When my books are ready for pickup' },
  { key: 'push_new_titles', label: 'When a series or artist I follow adds a title to my list' },
  { key: 'push_reminders', label: 'Reminders: books still waiting for pickup, and the day before my list closes for an order' },
];

/** Fill `host` with the notification settings for `customer` (its push_* columns), and keep it current. */
export async function setupNotifications(host, sb, customer) {
  const say = (text, bad = false) => ($('[data-push-status]', host).innerHTML = text ? `<p class="${bad ? 'form-error' : 'account-saved'}" role="${bad ? 'alert' : 'status'}">${esc(text)}</p>` : '');
  const shell = (body) => (host.innerHTML = `${body}<div data-push-status></div>`);

  async function render() {
    if (!supported()) {
      return shell(`<p class="field__hint">${iPhone() && !installed()
        ? 'To get notifications on an iPhone, add this app to your Home Screen first: tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>. Then open it from there.'
        : 'This browser can’t show notifications. Try the app in Chrome on Android, or on an iPhone from your Home Screen.'}</p>`);
    }
    if (!(await publicKey())) return shell('<p class="field__hint">Notifications aren’t available from the shop yet.</p>');
    if (Notification.permission === 'denied') {
      return shell('<p class="field__hint">Notifications are blocked for this app. Allow them in your phone’s settings for this app (or this site, in the browser), then come back here.</p>');
    }
    const reg = await worker();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) {
      return shell(`
        <p class="field__hint">Get a notification on this ${iPhone() ? 'iPhone' : 'device'} when your books are ready for pickup.</p>
        <button class="btn btn--primary" type="button" data-push-on>Turn on notifications</button>`);
    }
    shell(`
      <p class="push-on"><span aria-hidden="true">✓</span> Notifications are on for this device.</p>
      ${KINDS.map((k) => `
        <div class="field field--check">
          <input id="push-${k.key}" type="checkbox" data-push-kind="${k.key}"${customer[k.key] !== false ? ' checked' : ''}>
          <label for="push-${k.key}">${esc(k.label)}</label>
        </div>`).join('')}
      <div class="push-actions">
        <button class="btn btn--ghost" type="button" data-push-test>Send a test</button>
        <button class="link-button" type="button" data-push-off>Turn off on this device</button>
      </div>`);
  }

  async function turnOn(button) {
    button.disabled = true;
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        await render();
        return say('Notifications weren’t allowed. You can turn them on any time from here.', true);
      }
      const reg = await worker();
      if (!reg) throw new Error('The app isn’t ready yet. Close it, open it again and try once more.');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await publicKey()) });
      const { endpoint, keys } = sub.toJSON();
      const { error } = await sb.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth, p_user_agent: navigator.userAgent });
      if (error) {
        await sub.unsubscribe().catch(() => {});
        throw error;
      }
      await render();
      say('Notifications are on. Tap Send a test to see one.');
      $('[data-push-test]', host)?.focus();
    } catch (err) {
      console.error(err);
      await render();
      say(err?.code ? pull.customerMessage(err) : err?.message || 'Notifications couldn’t be turned on. Please try again.', true);
    }
  }

  async function turnOff() {
    try {
      const sub = await (await worker())?.pushManager.getSubscription();
      if (sub) {
        const { error } = await sb.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
        if (error) throw error;
        await sub.unsubscribe();
      }
      await render();
      say('Notifications are off for this device.');
      $('[data-push-on]', host)?.focus();
    } catch (err) {
      say(pull.customerMessage(err), true);
    }
  }

  host.addEventListener('click', async (e) => {
    const on = e.target.closest('[data-push-on]');
    if (on) return turnOn(on);
    if (e.target.closest('[data-push-off]')) return turnOff();
    const test = e.target.closest('[data-push-test]');
    if (!test) return;
    test.disabled = true;
    say('');
    const { data, error } = await sb.functions.invoke('push-notify', { body: { mode: 'test' } });
    test.disabled = false;
    if (error || !data?.sent) say('The test didn’t go through. Turn notifications off and on again, then try once more.', true);
    else say('Test sent. It should appear in a moment.');
  });
  host.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-push-kind]');
    if (!box) return;
    const key = box.dataset.pushKind;
    const { error } = await sb.from('customers').update({ [key]: box.checked }).eq('id', customer.id);
    if (error) {
      box.checked = !box.checked;
      return say(pull.customerMessage(error), true);
    }
    customer[key] = box.checked;
    say('Saved.');
  });
  await render();
}

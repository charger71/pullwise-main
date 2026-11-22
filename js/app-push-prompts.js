// Asking app customers to turn on notifications, so the phone's own "Allow notifications?" box only comes up once
// they've said yes to ours. Three places: a card after an add or a follow (the moment it's worth it), a button in the
// welcome card, and a quiet card at the top of My List for everyone else. When each may show again is in
// js/push-nudge.js; turning on is the Account tab's own code (js/app-notifications.js).

import { $, esc } from './site.js';
import { pushState, turnOnPush, pushError } from './app-notifications.js';
import { NUDGE_EVENT, CHANGED_EVENT, MOMENT_KEY, BANNER_KEY, MOMENT_DAYS, BANNER_DAYS, pausedUntil, isPaused, pause, momentText } from './push-nudge.js';

const store = (() => {
  try {
    return localStorage;
  } catch {
    return { getItem() { throw new Error('no storage'); }, setItem() { throw new Error('no storage'); } };
  }
})();

const CONFIRM_MS = 4000; // how long "Notifications are on" stays up

let momentShown = false; // at most one card after an add or a follow each time the app is opened
let wired = false;

const removeAll = () => document.querySelectorAll('[data-push-banner], [data-push-nudge]').forEach((el) => el.remove());

function resetWelcome() {
  const span = $('[data-push-welcome]');
  if (span) span.textContent = 'Turn on notifications on the Account tab.';
}

/** The moment card's markup: the question (HTML) and its buttons, or a message on its own. */
const nudgeCard = (inner) => `
  <div class="push-nudge" role="region" aria-label="Notifications" data-push-nudge>
    ${inner}
  </div>`;

/** Show the card after an add or a follow, if it's the moment for one. */
async function onNudge(e) {
  if (momentShown || $('[data-push-nudge]')) return;
  // Nowhere to keep "Not now": once per open is the only limit.
  if (pausedUntil(store, MOMENT_KEY) !== Infinity && isPaused(store, MOMENT_KEY, Date.now())) return;
  momentShown = true;
  if ((await pushState()) !== 'off') return;
  $('[data-push-banner]')?.remove();
  document.body.insertAdjacentHTML('beforeend', nudgeCard(`
    <p class="push-nudge__text">${momentText(e.detail)}</p>
    <div class="push-nudge__actions">
      <button class="btn btn--primary btn--small" type="button" data-push-prompt-on>Turn on</button>
      <button class="btn btn--ghost btn--small" type="button" data-push-nudge-later>Not now</button>
    </div>
    <div data-push-prompt-status></div>`));
}

/** Turn notifications on from any of the prompts. */
async function turnOn(button, sb) {
  const card = button.closest('[data-push-nudge], [data-push-banner], [data-welcome]');
  const status = $('[data-push-prompt-status]', card);
  if (status) status.innerHTML = '';
  button.disabled = true;
  try {
    const state = await turnOnPush(sb, button);
    removeAll();
    if (state !== 'on') return resetWelcome();
    const span = $('[data-push-welcome]');
    if (span) span.textContent = 'Notifications are on.';
    document.body.insertAdjacentHTML('beforeend', nudgeCard('<p class="push-nudge__text" role="status">Notifications are on. Change which ones on the Account tab.</p>'));
    const done = $('[data-push-nudge]');
    setTimeout(() => done.remove(), CONFIRM_MS);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    const msg = `<p class="form-error" role="alert">${esc(pushError(err))}</p>`;
    if (status) status.innerHTML = msg;
    else button.insertAdjacentHTML('afterend', msg);
  }
}

/**
 * Offer notifications in the app: the welcome card's button, the card on My List (`welcomeShown`: the welcome card is
 * up, so that's where the offer is instead), and the card after an add or a follow. Nothing shows unless this device
 * could turn them on right now.
 */
export async function setupPushPrompts({ root, sb, welcomeShown }) {
  if (!wired) {
    wired = true;
    addEventListener(NUDGE_EVENT, onNudge);
    addEventListener(CHANGED_EVENT, (e) => {
      if (e.detail?.state === 'on' || e.detail?.state === 'denied') removeAll();
      if (e.detail?.state === 'denied') resetWelcome();
    });
    document.addEventListener('click', (e) => {
      const on = e.target.closest('[data-push-prompt-on]');
      if (on) return void turnOn(on, sb);
      if (e.target.closest('[data-push-nudge-later]')) {
        pause(store, MOMENT_KEY, MOMENT_DAYS, Date.now());
        return $('[data-push-nudge]')?.remove();
      }
      if (e.target.closest('[data-push-banner-close]')) {
        pause(store, BANNER_KEY, BANNER_DAYS, Date.now());
        $('[data-push-banner]')?.remove();
      }
    });
  }
  if ((await pushState()) !== 'off') return;

  const span = $('[data-push-welcome]', root);
  if (span) span.innerHTML = '<button class="btn btn--primary btn--small" type="button" data-push-prompt-on>Turn on notifications</button>';

  if (welcomeShown || isPaused(store, BANNER_KEY, Date.now()) || $('[data-push-nudge]')) return;
  $('[data-view="list"]', root)?.insertAdjacentHTML('afterbegin', `
    <div class="push-banner" data-push-banner>
      <p class="push-banner__text">Get a notification when your books are ready for pickup.</p>
      <button class="btn btn--primary btn--small" type="button" data-push-prompt-on>Turn on</button>
      <button class="push-banner__close" type="button" data-push-banner-close aria-label="Not now">✕</button>
      <div data-push-prompt-status></div>
    </div>`);
}

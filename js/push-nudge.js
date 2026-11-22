// Asking app customers to turn on notifications (see js/app-push-prompts.js, which draws the cards). This part has no
// DOM so it can be tested: when a prompt may show again, and its words. Pauses are kept per device, since permission to
// notify is per device anyway.

import { esc } from './util.js';

/** Fired on window after an add or a follow worked: { kind: 'add' | 'follow', label }. Only the app listens. */
export const NUDGE_EVENT = 'pullwise:push-nudge';
/** Fired on window when notifications were turned on or off on this device: { from } is the element that did it. */
export const CHANGED_EVENT = 'pullwise:push-changed';

export const MOMENT_KEY = 'pc-push-moment-until';
export const BANNER_KEY = 'pc-push-banner-until';
export const MOMENT_DAYS = 14; // "Not now" on the card after an add or a follow
export const BANNER_DAYS = 30; // closing the card at the top of My List

const DAY = 24 * 60 * 60 * 1000;

/** Say an add or a follow just worked, so the app can offer notifications. */
export function nudge(detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NUDGE_EVENT, { detail }));
}

/** When the pause under `key` ends (ms), null if there's none, Infinity if nothing can be kept on this device. */
export function pausedUntil(store, key) {
  try {
    const v = store.getItem(key);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return Infinity;
  }
}

export const isPaused = (store, key, now) => (pausedUntil(store, key) ?? -Infinity) > now;

export function pause(store, key, days, now) {
  try {
    store.setItem(key, String(now + days * DAY));
  } catch {
    /* nowhere to keep it */
  }
}

/** The card's question after an add or a follow (HTML). */
export const momentText = ({ kind, label }) =>
  kind === 'follow'
    ? `Want a heads-up when new <strong>${esc(label)}</strong> issues arrive?`
    : `Want a heads-up when <strong>${esc(label)}</strong> is ready for pickup?`;

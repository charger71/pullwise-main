// What the pull list app (app.html) keeps on the phone: the count on its Home Screen icon, and the last copy of the
// customer's list, shown read-only when the app opens without a connection (js/pages/account.js). Both are cleared
// on sign-out. The copy stays on this device only.

const KEY = 'pc-app-list';

/** The number on the app's icon (books ready for pickup); 0 clears it. Phones without icon badges ignore it. */
export function setBadge(n) {
  if (!('setAppBadge' in navigator)) return;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

/** Keep the list as drawn, with how many are ready, for the next time the app opens offline. */
export function saveList(html, ready) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), html, ready }));
  } catch {
    /* private mode or full: offline just shows nothing */
  }
}

/** The kept list: { at, html, ready }, or null. */
export function savedList() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return typeof v?.html === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function forgetList() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * A short buzz under the finger in the app, as native apps give: 'tick' when a pull or swipe reaches the point where
 * letting go acts, 'done' when a title goes on the list. Only in the app (not the website), and only on phones that
 * can (Android; an iPhone has no vibration for web apps and ignores it).
 */
const BUZZ = { tick: 8, done: 15 };
export function haptic(kind = 'tick') {
  if (document.body?.dataset.page !== 'app' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(BUZZ[kind] ?? BUZZ.tick);
  } catch {
    /* not allowed before the first tap on some phones: nothing to do */
  }
}

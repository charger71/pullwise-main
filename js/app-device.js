// What the pull list app (app.html) keeps on the phone: the count on its Home Screen icon, and the last copy of the
// customer's list, shown read-only when the app opens without a connection (js/pages/account.js). Both are cleared
// on sign-out. The copy stays on this device only. Also the app's small device helpers: what it keeps in storage,
// whether it's installed, and the buzz under the finger.

const KEY = 'pc-app-list';

/**
 * What the app keeps on this phone (localStorage, as JSON). Storage can be missing or full (private mode, say):
 * reading then gives `fallback` and keeping does nothing, so every caller works without it.
 */
export function kept(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
export function keep(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: it lasts until the app closes */
  }
}
export function forget(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing kept */
  }
}

/** An iPhone or iPad (an iPad asking for the desktop site reports a Mac with touch). */
export const isIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Opened from the Home Screen (installed), not in the browser. */
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** The number on the app's icon (books ready for pickup); 0 clears it. Phones without icon badges ignore it. */
export function setBadge(n) {
  if (!('setAppBadge' in navigator)) return;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

/** Keep the list as drawn, with how many are ready, for the next time the app opens offline. */
export const saveList = (html, ready) => keep(KEY, { at: new Date().toISOString(), html, ready });

/** The kept list: { at, html, ready }, or null. */
export function savedList() {
  const v = kept(KEY);
  return typeof v?.html === 'string' ? v : null;
}

export const forgetList = () => forget(KEY);

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

/**
 * For a pull or swipe: returns a function to call as it moves with whether letting go would act now; it buzzes
 * ('tick') once each time that turns true, not on every move.
 */
export function buzzOnCross() {
  let was = false;
  return (now) => {
    if (now && !was) haptic('tick');
    was = now;
  };
}

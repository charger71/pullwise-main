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

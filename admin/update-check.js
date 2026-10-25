// Tells staff when the site has been updated while this admin tab was open.
//
// A tab keeps the scripts it loaded for as long as it stays open, and screens are loaded one at a time, so
// after a deploy an old tab can mix old and new files and fail ("Importing binding name … is not found").
// admin/version.js holds a fingerprint of every file under admin/, js/ and css/ (tools/stamp-version.js), so it
// changes exactly when the code does. This rereads it every few minutes and whenever the tab is shown again,
// and when it no longer matches the version this tab loaded, shows a bar offering a reload.
//
// It compares that one file's contents, not file headers: /js/config.js is generated per shop from cached
// settings, so its ETag changes without any deploy, and that showed the bar at random.

import { VERSION } from './version.js';

const EVERY = 5 * 60 * 1000;
const MIN_GAP = 60 * 1000; // coming back to the tab checks at most once a minute
const URL_ = new URL('./version.js', import.meta.url);

let lastCheck = 0;
let shown = false;

/** The VERSION string in a version.js file's text, or null. */
export const readVersion = (text) => text.match(/VERSION\s*=\s*'([^']+)'/)?.[1] ?? null;

async function published() {
  try {
    const res = await fetch(URL_, { cache: 'no-store' });
    return res.ok ? readVersion(await res.text()) : null;
  } catch {
    return null; // offline or a blip: try again next time
  }
}

async function check(onUpdate) {
  if (shown || document.visibilityState !== 'visible') return;
  lastCheck = Date.now();
  const v = await published();
  if (v && v !== VERSION) {
    shown = true;
    onUpdate();
  }
}

/** @param {{ onUpdate: () => void }} opts  called once, when a newer version has been published */
export function watchForUpdates({ onUpdate }) {
  setInterval(() => check(onUpdate), EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > MIN_GAP) check(onUpdate);
  });
}

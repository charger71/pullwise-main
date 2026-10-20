// Tells staff when the site has been updated while this admin tab was open.
//
// A tab keeps the scripts it loaded for as long as it stays open, and screens are loaded one at a time, so
// after a deploy an old tab can mix old and new files and fail ("Importing binding name … is not found").
// This remembers a fingerprint (ETag, else Last-Modified) of every admin/shared script and stylesheet the
// page has loaded, rechecks them every few minutes and whenever the tab is shown again, and when any
// differs, shows a bar offering a reload.

const EVERY = 5 * 60 * 1000;
const MIN_GAP = 60 * 1000; // coming back to the tab checks at most once a minute
const OURS = /\/(admin|js)\/[^?#]*\.(js|css)$/;

const baseline = new Map(); // url -> fingerprint when first seen
let lastCheck = 0;
let shown = false;

const loadedUrls = () =>
  [...new Set(performance.getEntriesByType('resource').map((e) => e.name))].filter((u) => u.startsWith(location.origin) && OURS.test(new URL(u).pathname));

async function fingerprint(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return null;
    // Cloudflare answers the same file with a weak ETag (W/"x") or a strong one ("x") depending on whether that
    // response was compressed; the hash inside is what says the content changed.
    return res.headers.get('etag')?.replace(/^W\//, '') ?? res.headers.get('last-modified');
  } catch {
    return null; // offline or a blip: try again next time
  }
}

/** Remember the fingerprint of any file loaded since the last call (call again after loading a screen). */
export async function track() {
  const fresh = loadedUrls().filter((u) => !baseline.has(u));
  await Promise.all(fresh.map(async (u) => {
    baseline.set(u, null); // claim it so a second call doesn't repeat the request
    baseline.set(u, await fingerprint(u));
  }));
}

async function check(onUpdate) {
  if (shown || document.visibilityState !== 'visible') return;
  lastCheck = Date.now();
  await track();
  const known = [...baseline].filter(([, f]) => f);
  const now = await Promise.all(known.map(([u]) => fingerprint(u)));
  if (known.some(([, f], i) => now[i] && now[i] !== f)) {
    shown = true;
    onUpdate();
  }
}

/** @param {{ onUpdate: () => void }} opts  called once, when a newer version has been published */
export function watchForUpdates({ onUpdate }) {
  track();
  setInterval(() => check(onUpdate), EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > MIN_GAP) check(onUpdate);
  });
}

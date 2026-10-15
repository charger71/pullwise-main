// Last-visit snapshots in localStorage, so a returning visitor's page can paint
// before the network answers. Callers show the snapshot, fetch fresh data, and
// swap it in only if it changed. Everything here fails quietly (private mode,
// full storage): the page just waits for the network as it always did.

const PREFIX = 'pc-cache:';
const MAX_AGE = 3 * 24 * 3600 * 1000; // older snapshots are worse than a short wait

export function readCache(key) {
  try {
    const entry = JSON.parse(localStorage.getItem(PREFIX + key));
    return entry && Date.now() - entry.t < MAX_AGE ? entry.v : null;
  } catch {
    return null;
  }
}

export function writeCache(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* nothing to do */
  }
}

export const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);

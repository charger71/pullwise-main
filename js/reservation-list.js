// The customer's in-progress reservation list: pre-order titles they've added
// but not yet submitted. Kept in localStorage so it survives page changes;
// falls back to memory if storage is unavailable (private mode, blocked, …).
//
// Each entry stores a snapshot of the item so the list can be shown on any
// page without refetching. The server re-validates everything on submit.

const KEY = 'reservation-list';
const SNAPSHOT = ['id', 'title', 'issue_number', 'variant', 'publisher', 'price', 'release_date', 'foc_date', 'cover_url', 'cover_thumb_url'];

let lines = load();
const listeners = new Set();

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((l) => l?.item?.id && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* memory-only this session */
  }
  listeners.forEach((fn) => fn(lines));
}

// Keep multiple open tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  lines = load();
  listeners.forEach((fn) => fn(lines));
});

export const getLines = () => lines;
export const count = () => lines.length;
export const has = (id) => lines.some((l) => l.item.id === id);
export const onChange = (fn) => listeners.add(fn);

/** `search` is the search this title was added after, credited in Analytics if the order goes through. */
export function add(item, quantity = 1, search = null) {
  if (has(item.id)) return;
  lines = [...lines, { item: Object.fromEntries(SNAPSHOT.map((k) => [k, item[k] ?? null])), quantity, search }];
  save();
}

export function setQuantity(id, quantity) {
  lines = lines.map((l) => (l.item.id === id ? { ...l, quantity } : l));
  save();
}

export function remove(id) {
  lines = lines.filter((l) => l.item.id !== id);
  save();
}

export function clear() {
  lines = [];
  save();
}

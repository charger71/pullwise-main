// The signed-in customer and their pull list, shared by every page.
// Signed out (or in demo mode) nothing here does anything: pages fall back to the
// guest reservation list in reservation-list.js. All writes go through the
// pull_list_* database functions, which enforce cutoffs and copy limits.

import { DEMO, supabase, recentSearchId, creditSearch } from './data.js';
import { nameKey } from './util.js';
import { friendlyError } from './errors.js';

// "Not ordered" lines are left out: they don't count toward the list, and adding the title again reopens the line.
const ACTIVE = ['open', 'ordered', 'reordered', 'arrived'];
let customer = null; // the customers row, once signed in (id null until the account page's setup form is saved)
let lines = new Map(); // item_id → { id, quantity, status, source, created_at } for active lines
let seenAt = null; // when the customer last opened My Pull List (null: not since the "new" highlight shipped)
let viewing = false; // on My Pull List itself, where new titles are badged in the list instead
let subs = []; // follows: { id, kind: 'series' | 'artist', key, label, role, quantity }
const listeners = new Set();

export const isSignedIn = () => customer != null;
/** The signed-in customer's name and email (for forms that ask for them), or null when signed out. */
export const profile = () => (customer ? { name: customer.name ?? '', email: customer.email ?? '' } : null);
export const has = (itemId) => lines.has(itemId);
export const lineFor = (itemId) => lines.get(itemId);
export const count = () => lines.size;

/** Titles a follow added (by the hourly sweep or on follow) count as new after `since`; with no visit on record, the last 7 days. */
const AUTO = ['series', 'artist'];
const NEW_DAYS = 7;
export const isNewAuto = (line, since = seenAt) =>
  AUTO.includes(line.source) && line.status === 'open' &&
  new Date(line.created_at) > (since ? new Date(since) : new Date(Date.now() - NEW_DAYS * 864e5));
export const newCount = () => (viewing ? 0 : [...lines.values()].filter((l) => isNewAuto(l)).length);
export const getSubscriptions = () => subs;
export const findSubscription = (kind, key, role = null) => subs.find((s) => s.kind === kind && s.key === key && (s.role ?? null) === role);

/** Same normalising as person_key() in the database. */
export const personKey = nameKey;

export const onChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

const GENERIC = 'Something went wrong. Please try again or call the shop.';
export const SIGN_IN_AGAIN = 'Your sign-in has expired. Please sign in again.';

/** An expired or missing sign-in: the token was refused, or the request went out signed out and was denied. */
export const isAuthError = (error) =>
  !!error &&
  (error.status === 401 || error.code === 'PGRST301' || error.code === 'PGRST302' ||
    /\bJWT\b|token is expired|not authenticated|Invalid Refresh Token|Auth session missing/i.test(error.message ?? '') ||
    (error.code === '42501' && /permission denied|Please sign in/i.test(error.message ?? '')) ||
    (error.code === 'P0001' && /^Please sign in\.$/.test(error.message ?? '')));

/**
 * A message a customer can act on, for any Supabase / PostgREST error. Messages raised by the pull_list_* functions
 * with errcode P0001 are written for customers; database internals never are.
 */
export function customerMessage(error) {
  if (!error) return GENERIC;
  if (isAuthError(error)) return SIGN_IN_AGAIN;
  if (error.code === 'P0001') return error.message;
  // friendlyError() is written for the admin: keep only the answers that make sense to a customer.
  const msg = friendlyError(error);
  return /^(Couldn’t reach the server|Too many attempts|.* is too long|“.*” is required|A required field|One of the values isn’t in the right format)/.test(msg) ? msg : GENERIC;
}

/** An Error with the customer-safe message; `.signIn` is set when signing in again will fix it. */
export function customerError(error) {
  const e = new Error(customerMessage(error));
  e.signIn = isAuthError(error);
  e.raw = error;
  return e;
}

const fail = (error) => {
  if (error.code !== 'P0001') console.error(error);
  throw customerError(error);
};

/** The error as HTML for a message line, with a sign-in link when that's the fix. */
export const errorHtml = (err) =>
  `${String(err?.message ?? GENERIC).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}${err?.signIn ? ' <a href="account.html">Sign in</a>' : ''}`;

/** Forget the customer (signed out, or the session ended): every page falls back to the guest list. */
function clear() {
  customer = null;
  lines = new Map();
  subs = [];
  seenAt = null;
  viewing = false;
  notify();
}

let watching = false;
function watchAuth(sb) {
  if (watching) return;
  watching = true;
  sb.auth.onAuthStateChange((event, session) => {
    // A failed token refresh also ends in SIGNED_OUT.
    if (event === 'SIGNED_OUT' || !session) {
      if (customer) clear();
    } else if ((event === 'SIGNED_IN' && !customer) || event === 'USER_UPDATED') {
      // Signed in in another tab, or the login changed: load (again). Run outside the auth callback, which must not await Supabase calls.
      setTimeout(() => load(sb).catch((err) => console.error('Pull list failed to load', err)));
    }
  });
}

/** Call once per page (initPage does). Resolves quietly when signed out. */
export async function initCustomer() {
  if (DEMO) return;
  try {
    const sb = await supabase();
    watchAuth(sb);
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    await load(sb);
  } catch (err) {
    console.error('Pull list failed to load', err);
  }
}

async function load(sb) {
  const { data: row, error } = await sb.rpc('claim_customer');
  if (error) throw error;
  customer = row;
  await refresh(sb);
}

/**
 * After a change that worked: reload the list, but never report the change as failed if only the reload fails.
 * Tries again a moment later; until then the list keeps the change made locally (if any).
 */
async function softRefresh(sb) {
  try {
    await refresh(sb);
  } catch (err) {
    console.warn('Pull list refresh failed; retrying', err);
    notify();
    setTimeout(() => customer && refresh(sb).catch((e) => console.error('Pull list refresh failed', e)), 2000);
  }
}

let refreshRun = 0; // the latest refresh() call: an older one that answers late must not replace a newer list

export async function refresh(sb) {
  sb ??= await supabase();
  if (!customer) return;
  const mine = ++refreshRun;
  if (!customer.id) {
    // Signed in, but the account page's setup form isn't finished, so there's no customer record (or list) yet.
    lines = new Map();
    subs = [];
    return notify();
  }
  const id = customer.id;
  // The list, the last visit and the follows don't depend on each other: asked for together, every page waits once.
  const [list, seen, followed] = await Promise.all([
    sb
      .from('reservations')
      .select('id,item_id,quantity,status,source,created_at,order:reservation_orders!inner(customer_id)')
      .eq('order.customer_id', id)
      .in('status', ACTIVE),
    sb.from('pull_list_seen').select('seen_at').eq('customer_id', id).maybeSingle(),
    sb.from('subscriptions').select('id,kind,key,label,role,quantity,all_covers').eq('customer_id', id).order('label'),
  ]);
  if (list.error) throw customerError(list.error);
  if (followed.error) throw customerError(followed.error);
  let follows = followed.data;
  const seriesKeys = follows.filter((f) => f.kind === 'series').map((f) => f.key);
  if (seriesKeys.length) {
    const { data: covers } = await sb.from('series_catalog').select('key,cover_url').in('key', seriesKeys).not('cover_url', 'is', null);
    const byKey = new Map((covers ?? []).map((c) => [c.key, c.cover_url]));
    follows = follows.map((f) => (f.kind === 'series' ? { ...f, cover: byKey.get(f.key) ?? null } : f));
  }
  if (mine !== refreshRun || customer?.id !== id) return; // a newer refresh (or a sign-out) has the say now
  lines = new Map(list.data.map((r) => [r.item_id, { id: r.id, quantity: r.quantity, status: r.status, source: r.source, created_at: r.created_at }]));
  seenAt = seen.data?.seen_at ?? null;
  subs = follows;
  notify();
}

/**
 * The customer is looking at My Pull List: records the visit (so the nav's "new" count starts over) and
 * resolves when they last looked before this browser session, so the page can badge what's new. Reloads in
 * the same session keep the badges (the first answer is kept in sessionStorage).
 */
export async function markSeen() {
  const sb = await supabase();
  const key = `pull-seen:${customer.id}`;
  let kept;
  try {
    kept = sessionStorage.getItem(key);
  } catch {}
  const { data, error } = await sb.rpc('pull_list_mark_seen');
  if (error) fail(error);
  if (kept == null) {
    kept = data ?? '';
    try {
      sessionStorage.setItem(key, kept);
    } catch {}
  }
  viewing = true;
  notify();
  return kept || null;
}

// Adding and removing show at once (optimistic): the buttons, counts and My List change before the shop's database
// answers, and change back, with the error, if it says no. A line added this way has no id until the answer comes
// (`pending`), so callers don't act on it meanwhile.

export async function add(itemId, quantity = 1) {
  const before = lines.get(itemId);
  lines.set(itemId, { id: before?.id ?? null, quantity, status: 'open', source: 'manual', created_at: new Date().toISOString(), pending: true });
  notify();
  const { sb, data: id } = await changeOrUndo('pull_list_add', { p_item_id: itemId, p_quantity: quantity }, () => undo(itemId, before));
  if (id) lines.set(itemId, { id, quantity, status: 'open', source: 'manual', created_at: new Date().toISOString() });
  if (id && !before) creditSearch(recentSearchId());
  await softRefresh(sb);
}

/** Run a pull list change; if it fails (refused, or no connection), undo what was shown and throw. */
async function changeOrUndo(name, args, undoIt) {
  let sb;
  let res;
  try {
    sb = await supabase();
    res = await sb.rpc(name, args);
  } catch (err) {
    undoIt();
    throw err;
  }
  if (res.error) {
    undoIt();
    fail(res.error);
  }
  return { sb, data: res.data };
}

/** Put a line back as it was before a change the database refused (`before` undefined: it wasn't on the list). */
function undo(itemId, before) {
  if (before) lines.set(itemId, before);
  else lines.delete(itemId);
  notify();
}

/** Order a copy of a trade or omnibus (a re-order: the shop orders it from the distributor). */
export async function reorder(itemId, quantity = 1) {
  const sb = await supabase();
  const { data: id, error } = await sb.rpc('pull_list_reorder', { p_item_id: itemId, p_quantity: quantity });
  if (error) fail(error);
  if (id) lines.set(itemId, { id, quantity, status: 'open', source: 'manual', created_at: new Date().toISOString() });
  if (id) creditSearch(recentSearchId());
  await softRefresh(sb);
}

/** Add every open, non-incentive cover of the same issue. Resolves { added, skipped }. */
export async function addVariants(itemId, quantity = 1) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('pull_list_add_variants', { p_item_id: itemId, p_quantity: quantity });
  if (error) fail(error);
  creditSearch(recentSearchId(), data?.added);
  await softRefresh(sb);
  return data;
}

export async function setQuantity(lineId, quantity) {
  const entry = [...lines].find(([, l]) => l.id === lineId);
  if (entry) {
    lines.set(entry[0], { ...entry[1], quantity });
    notify();
  }
  const { sb } = await changeOrUndo('pull_list_set_quantity', { p_line: lineId, p_quantity: quantity }, () => entry && undo(...entry));
  await softRefresh(sb);
}

export async function remove(lineId) {
  const entry = [...lines].find(([, l]) => l.id === lineId);
  if (entry) {
    lines.delete(entry[0]);
    notify();
  }
  const { sb } = await changeOrUndo('pull_list_remove', { p_line: lineId }, () => entry && undo(...entry));
  await softRefresh(sb);
}

// ---------------------------------------------------------------------------
// Following a series or an artist: new issues are added to the pull list for you.
// ---------------------------------------------------------------------------

/** Resolves { id, added }: `added` is how many open titles were added right away. allCovers: every cover of each issue, not just the main one. */
export async function followSeries(key, quantity = 1, allCovers = false) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('follow_series', { p_key: key, p_quantity: quantity, p_all_covers: allCovers });
  if (error) fail(error);
  await softRefresh(sb);
  return data;
}

/** The next issue of a series open for ordering: { label, issues, next, more } (series_follow_preview), or null if it can't be loaded. */
export async function seriesFollowPreview(key) {
  try {
    const sb = await supabase();
    const { data, error } = await sb.rpc('series_follow_preview', { p_key: key });
    return error ? null : data;
  } catch {
    return null;
  }
}

/** role: 'cover' (every cover by them) or 'creator' (one cover per issue they work on). */
export async function followArtist(name, role = 'cover', quantity = 1) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('follow_artist', { p_name: name, p_role: role, p_quantity: quantity });
  if (error) fail(error);
  await softRefresh(sb);
  return data;
}

/** Whether the customer asked to hear when this title is in (stock_alerts; the app's title details). */
export async function hasStockAlert(itemId) {
  if (!customer?.id) return false;
  const sb = await supabase();
  const { data, error } = await sb.from('stock_alerts').select('id').eq('customer_id', customer.id).eq('item_id', itemId).maybeSingle();
  if (error) fail(error);
  return !!data;
}

/** Ask (or stop asking) to hear when a title that can't be reserved is in the shop. push-notify sends it once. */
export async function setStockAlert(itemId, on) {
  if (!customer?.id) throw Object.assign(new Error('Please sign in first.'), { signIn: true });
  const sb = await supabase();
  const { error } = on
    ? await sb.from('stock_alerts').upsert({ customer_id: customer.id, item_id: itemId }, { onConflict: 'customer_id,item_id', ignoreDuplicates: true })
    : await sb.from('stock_alerts').delete().eq('customer_id', customer.id).eq('item_id', itemId);
  if (error) fail(error);
}

/** Unfollows, removing the titles it added that haven't been ordered. Resolves how many came off the list. */
export async function unfollow(id) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('unfollow', { p_id: id });
  if (error) fail(error);
  await softRefresh(sb);
  return data ?? 0;
}

/** How many titles unfollowing would take off the list (added by this follow, not ordered yet). */
export async function unfollowPreview(id) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('unfollow_preview', { p_id: id });
  if (error) fail(error);
  return data ?? 0;
}

/**
 * Asks first, saying how many titles will come off the pull list, then unfollows.
 * Resolves the number removed, or null if they changed their mind.
 */
export async function unfollowWithWarning(sub) {
  const n = await unfollowPreview(sub.id);
  const msg = n
    ? `Unfollow ${sub.label}?\n\n${n} ${n === 1 ? 'title' : 'titles'} it added to your pull list that ${n === 1 ? 'hasn’t' : 'haven’t'} been ordered yet will be removed. Titles already ordered stay on your list.`
    : `Unfollow ${sub.label}?\n\nNew issues will stop being added. Titles already ordered stay on your list.`;
  if (!confirm(msg)) return null;
  return unfollow(sub.id);
}

/** Series follows: every cover of each new issue (on) or just the main one (off). Resolves { added, removed }. */
export async function setFollowAllCovers(id, on) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('set_follow_all_covers', { p_id: id, p_on: on });
  if (error) fail(error);
  await softRefresh(sb);
  return data ?? { added: 0, removed: 0 };
}

/** Copies of each issue: the follow and every title it added that hasn't been ordered. Resolves { updated, skipped }. */
export async function setFollowQuantity(id, quantity) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('set_follow_quantity', { p_id: id, p_quantity: quantity });
  if (error) fail(error);
  await softRefresh(sb);
  return data ?? { updated: 0, skipped: 0 };
}

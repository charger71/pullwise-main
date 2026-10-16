// The signed-in customer and their pull list, shared by every page.
// Signed out (or in demo mode) nothing here does anything: pages fall back to the
// guest reservation list in reservation-list.js. All writes go through the
// pull_list_* database functions, which enforce cutoffs and copy limits.

import { DEMO, supabase } from './data.js';

const ACTIVE = ['open', 'ordered', 'reordered', 'arrived'];
let customer = null; // the customers row, once signed in
let lines = new Map(); // item_id → { id, quantity, status, source, created_at } for active lines
let seenAt = null; // when the customer last opened My Pull List (null: not since the "new" highlight shipped)
let viewing = false; // on My Pull List itself, where new titles are badged in the list instead
let subs = []; // follows: { id, kind: 'series' | 'artist', key, label, role, quantity }
const listeners = new Set();

export const isSignedIn = () => customer != null;
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
export const personKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const onChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

// Messages raised by the pull_list_* functions with errcode P0001 are written for customers.
const fail = (error) => {
  throw new Error(error.code === 'P0001' ? error.message : 'Something went wrong. Please try again or call the shop.');
};

/** Call once per page (initPage does). Resolves quietly when signed out. */
export async function initCustomer() {
  if (DEMO) return;
  try {
    const sb = await supabase();
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

export async function refresh(sb) {
  sb ??= await supabase();
  const { data, error } = await sb
    .from('reservations')
    .select('id,item_id,quantity,status,source,created_at,order:reservation_orders!inner(customer_id)')
    .eq('order.customer_id', customer.id)
    .in('status', ACTIVE);
  if (error) throw error;
  lines = new Map(data.map((r) => [r.item_id, { id: r.id, quantity: r.quantity, status: r.status, source: r.source, created_at: r.created_at }]));
  const { data: seen } = await sb.from('pull_list_seen').select('seen_at').eq('customer_id', customer.id).maybeSingle();
  seenAt = seen?.seen_at ?? null;
  const { data: follows, error: followError } = await sb.from('subscriptions').select('id,kind,key,label,role,quantity').eq('customer_id', customer.id).order('label');
  if (followError) throw followError;
  subs = follows;
  const seriesKeys = follows.filter((f) => f.kind === 'series').map((f) => f.key);
  if (seriesKeys.length) {
    const { data: covers } = await sb.from('series_catalog').select('key,cover_url').in('key', seriesKeys).not('cover_url', 'is', null);
    const byKey = new Map((covers ?? []).map((c) => [c.key, c.cover_url]));
    subs = follows.map((f) => (f.kind === 'series' ? { ...f, cover: byKey.get(f.key) ?? null } : f));
  }
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

export async function add(itemId, quantity = 1) {
  const sb = await supabase();
  const { error } = await sb.rpc('pull_list_add', { p_item_id: itemId, p_quantity: quantity });
  if (error) fail(error);
  await refresh(sb);
}

/** Add every open, non-incentive cover of the same issue. Resolves { added, skipped }. */
export async function addVariants(itemId, quantity = 1) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('pull_list_add_variants', { p_item_id: itemId, p_quantity: quantity });
  if (error) fail(error);
  await refresh(sb);
  return data;
}

export async function setQuantity(lineId, quantity) {
  const sb = await supabase();
  const { error } = await sb.rpc('pull_list_set_quantity', { p_line: lineId, p_quantity: quantity });
  if (error) fail(error);
  await refresh(sb);
}

export async function remove(lineId) {
  const sb = await supabase();
  const { error } = await sb.rpc('pull_list_remove', { p_line: lineId });
  if (error) fail(error);
  await refresh(sb);
}

// ---------------------------------------------------------------------------
// Following a series or an artist: new issues are added to the pull list for you.
// ---------------------------------------------------------------------------

/** Resolves { id, added }: `added` is how many open titles were added right away. */
export async function followSeries(key, quantity = 1) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('follow_series', { p_key: key, p_quantity: quantity });
  if (error) fail(error);
  await refresh(sb);
  return data;
}

/** role: 'cover' (every cover by them) or 'creator' (one cover per issue they work on). */
export async function followArtist(name, role = 'cover', quantity = 1) {
  const sb = await supabase();
  const { data, error } = await sb.rpc('follow_artist', { p_name: name, p_role: role, p_quantity: quantity });
  if (error) fail(error);
  await refresh(sb);
  return data;
}

export async function unfollow(id) {
  const sb = await supabase();
  const { error } = await sb.rpc('unfollow', { p_id: id });
  if (error) fail(error);
  await refresh(sb);
}

export async function setFollowQuantity(id, quantity) {
  const sb = await supabase();
  const { error } = await sb.rpc('set_follow_quantity', { p_id: id, p_quantity: quantity });
  if (error) fail(error);
  await refresh(sb);
}

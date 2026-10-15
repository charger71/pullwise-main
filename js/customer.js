// The signed-in customer and their pull list, shared by every page.
// Signed out (or in demo mode) nothing here does anything: pages fall back to the
// guest reservation list in reservation-list.js. All writes go through the
// pull_list_* database functions, which enforce cutoffs and copy limits.

import { DEMO, supabase } from './data.js';

const ACTIVE = ['open', 'ordered', 'reordered', 'arrived'];
let customer = null; // the customers row, once signed in
let lines = new Map(); // item_id → { id, quantity, status } for active lines
let subs = []; // follows: { id, kind: 'series' | 'artist', key, label, role, quantity }
const listeners = new Set();

export const isSignedIn = () => customer != null;
export const has = (itemId) => lines.has(itemId);
export const lineFor = (itemId) => lines.get(itemId);
export const count = () => lines.size;
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
    .select('id,item_id,quantity,status,order:reservation_orders!inner(customer_id)')
    .eq('order.customer_id', customer.id)
    .in('status', ACTIVE);
  if (error) throw error;
  lines = new Map(data.map((r) => [r.item_id, { id: r.id, quantity: r.quantity, status: r.status }]));
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

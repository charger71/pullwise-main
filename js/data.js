// Data access for customer-facing pages. Talks to Supabase when configured,
// otherwise serves demo data with the same shapes and filtering behaviour.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { squash, searchWords } from './util.js';

export const DEMO = !SUPABASE_URL;

let clientPromise;
export function supabase() {
  if (DEMO) return null;
  clientPromise ??= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.9/+esm').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
  );
  return clientPromise;
}

// Start downloading the client now, so it's ready by the time the first query is made.
if (!DEMO) supabase();

let demoPromise;
const demo = () => (demoPromise ??= import('./demo-data.js'));

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

let settingsPromise;
export function getSettings() {
  settingsPromise ??= DEMO
    ? demo().then((d) => d.settings)
    : supabase().then(async (sb) => {
        const row = unwrap(await sb.from('settings').select('*').eq('id', 1).maybeSingle());
        if (!row) throw new Error('Shop settings not found — run supabase/seed.sql against this project.');
        return row;
      });
  return settingsPromise;
}

export async function getCategories() {
  if (DEMO) return (await demo()).categories;
  const sb = await supabase();
  return unwrap(await sb.from('categories').select('*').order('sort'));
}

/**
 * @param {object} f
 * @param {string[]} [f.statuses]  item_status values to include
 * @param {string[]} [f.excludeStatuses]
 * @param {number}   [f.categoryId]
 * @param {string}   [f.categorySlug] one category by slug (joined in the same query, so no separate lookup is needed)
 * @param {number[]} [f.categoryIds] any of these categories
 * @param {string[]} [f.publishers] any of these publishers
 * @param {string}   [f.focFrom]   ISO date; skip items whose FOC is before this
 * @param {string}   [f.focBefore] ISO date; pre-orders with FOC on/before this
 * @param {string}   [f.q]         search title, variant and creators
 * @param {string[]} [f.badges]     titles with any of these collector badges
 * @param {boolean}  [f.featured]   staff-chosen for the homepage
 * @param {boolean}  [f.staffPick]
 * @param {string}   [f.order]     'foc' | 'title' | 'newest' | 'released' (latest release date first) | 'arrivals' (New This Wednesday, Just Arrived, then the rest)
 * @param {number}   [f.limit]
 * @param {number}   [f.offset]
 * @param {boolean}  [f.withCount] resolve { rows, count } instead of rows
 */
export async function getItems(f = {}) {
  const topPromise = getTopReserved();
  const out = await fetchItems(f);
  const top = await topPromise;
  for (const r of f.withCount ? out.rows : out) r.top10 = top.has(r.id);
  return out;
}

let topPromise;
/** Ids of the ten most-reserved titles (for the "Top 10" badge). Never fails: no badges if it can't load. */
export function getTopReserved() {
  topPromise ??= DEMO
    ? Promise.resolve(new Set())
    : supabase()
        .then((sb) => sb.rpc('top_reserved_items'))
        .then(({ data, error }) => new Set(error ? [] : (data ?? []).map((r) => r.item_id)))
        .catch(() => new Set());
  return topPromise;
}

/**
 * f.openFirst (an ISO date, the first FOC still open, from openFocFrom()): titles that can still go on a pull list
 * (pre-order, order cutoff not passed) come first, then everything else, each part in the usual order. Paging
 * (offset/limit) runs across both parts as one list.
 */
async function fetchItems(f) {
  if (f.openFirst && !DEMO) return fetchOpenFirst(f);
  if (DEMO) {
    const { items, categories } = await demo();
    const words = searchWords(f.q);
    const text = (i) => squash(`${i.title} ${i.variant ?? ''} ${i.creators ?? ''} ${i.issue_number ?? ''}`);
    let rows = items.filter(
      (i) =>
        (!f.statuses || f.statuses.includes(i.status)) &&
        (!f.excludeStatuses || !f.excludeStatuses.includes(i.status)) &&
        (!f.categoryId || i.category_id === f.categoryId) &&
        (!f.categorySlug || i.category_id === categories.find((c) => c.slug === f.categorySlug)?.id) &&
        (!f.categoryIds?.length || f.categoryIds.includes(i.category_id)) &&
        (!f.publishers?.length || f.publishers.includes(i.publisher)) &&
        (!f.focFrom || !i.foc_date || i.foc_date >= f.focFrom) &&
        (!f.focBefore || (i.foc_date && i.foc_date <= f.focBefore)) &&
        (!f.badges?.length || f.badges.some((b) => i.badges?.includes(b))) &&
        (!f.featured || i.featured) &&
        (!f.staffPick || i.staff_pick) &&
        !i.hidden &&
        words.every((w) => text(i).includes(w)),
    );
    rows = [...rows].sort(sorter(f.order));
    if (f.openFirst) {
      const open = (i) => i.status === 'pre_order' && (!i.foc_date || i.foc_date >= f.openFirst);
      rows = [...rows.filter(open), ...rows.filter((i) => !open(i))];
    }
    const count = rows.length;
    const start = f.offset ?? 0;
    rows = f.limit ? rows.slice(start, start + f.limit) : rows.slice(start);
    return f.withCount ? { rows, count } : rows;
  }

  const sb = await supabase();
  // Forgiving text search on items.search_norm (title, cover, creators, issue number with case, accents and
  // punctuation squashed away); every word of the search must appear, in any order.
  const words = searchWords(f.q);
  // Row-level security already hides these from customers, but staff signed in
  // to the admin share this session — keep the public pages showing what customers see.
  const columns = f.categorySlug ? '*, cat:categories!inner(slug)' : '*';
  let query = sb
    .from('items')
    .select(columns, f.countOnly ? { count: 'exact', head: true } : f.withCount ? { count: 'exact' } : undefined)
    .eq('hidden', false);
  if (f.categorySlug) query = query.eq('cat.slug', f.categorySlug);
  if (f.statuses) query = query.in('status', f.statuses);
  if (f.excludeStatuses) query = query.not('status', 'in', `(${f.excludeStatuses.join(',')})`);
  if (f.categoryId) query = query.eq('category_id', f.categoryId);
  if (f.categoryIds?.length) query = query.in('category_id', f.categoryIds);
  if (f.publishers?.length) query = query.in('publisher', f.publishers);
  if (f.focFrom) query = query.or(`foc_date.is.null,foc_date.gte.${f.focFrom}`);
  if (f.focBefore) query = query.lte('foc_date', f.focBefore);
  // Everything that can't go on a pull list any more: not a pre-order, or its order cutoff has passed.
  if (f.closedBefore) query = query.or(`status.neq.pre_order,foc_date.lt.${f.closedBefore}`);
  if (f.badges?.length) query = query.overlaps('badges', f.badges);
  if (f.featured) query = query.eq('featured', true);
  if (f.staffPick) query = query.eq('staff_pick', true);
  for (const w of words) query = query.like('search_norm', `%${w}%`); // letters and digits only, so nothing to escape
  if (f.order === 'foc') query = query.order('foc_date', { ascending: true, nullsFirst: false });
  if (f.order === 'newest') query = query.order('updated_at', { ascending: false });
  if (f.order === 'arrivals') query = query.order('arrival_rank');
  if (f.order === 'released') query = query.order('release_date', { ascending: false, nullsFirst: false });
  // Keep an issue's covers together, main cover (no variant / CVR A) first.
  query = query.order('title').order('issue_number', { nullsFirst: true }).order('variant', { nullsFirst: true }).order('id');
  if (f.limit) query = query.range(f.offset ?? 0, (f.offset ?? 0) + f.limit - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  if (f.countOnly) return count;
  return f.withCount ? { rows: data, count } : data;
}

/** fetchItems with f.openFirst: the open part, then the rest, paged as one list. */
async function fetchOpenFirst({ openFirst, ...f }) {
  const open = { ...f, statuses: ['pre_order'], focFrom: openFirst };
  const rest = { ...f, closedBefore: openFirst };
  const start = f.offset ?? 0;
  const openCount = await fetchItems({ ...open, countOnly: true });
  const rows = [];
  if (start < openCount) {
    rows.push(...(await fetchItems({ ...open, withCount: false, offset: start, limit: f.limit ? Math.min(f.limit, openCount - start) : undefined })));
  }
  const left = f.limit ? f.limit - rows.length : undefined;
  let restCount;
  if (left === 0) restCount = await fetchItems({ ...rest, countOnly: true });
  else {
    const page = await fetchItems({ ...rest, withCount: true, offset: Math.max(0, start - openCount), limit: left });
    rows.push(...page.rows);
    restCount = page.count;
  }
  return f.withCount ? { rows, count: openCount + restCount } : rows;
}

function sorter(order) {
  const byTitle = (a, b) =>
    a.title.localeCompare(b.title) || (a.issue_number ?? '').localeCompare(b.issue_number ?? '') || (a.variant ?? '').localeCompare(b.variant ?? '');
  if (order === 'foc') return (a, b) => (a.foc_date ?? '9').localeCompare(b.foc_date ?? '9') || byTitle(a, b);
  if (order === 'newest') return (a, b) => b.id - a.id;
  if (order === 'released') return (a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? '') || byTitle(a, b);
  if (order === 'arrivals') {
    const rank = (i) => ({ new_this_wednesday: 0, just_arrived: 1, backorder: 3, sold_out: 3 })[i.status] ?? 2;
    return (a, b) => rank(a) - rank(b) || byTitle(a, b);
  }
  return byTitle;
}

export async function getPublishers(statuses) {
  if (DEMO) {
    const rows = await getItems({ statuses });
    return [...new Set(rows.map((r) => r.publisher).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  // Only the publisher column, paged past PostgREST's default 1000-row cap.
  const sb = await supabase();
  const names = new Set();
  for (let from = 0; ; from += 1000) {
    const rows = unwrap(await sb.from('items').select('publisher').eq('hidden', false).in('status', statuses).not('publisher', 'is', null).range(from, from + 999));
    rows.forEach((r) => names.add(r.publisher));
    if (rows.length < 1000) break;
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Distinct FOC dates (ISO, ascending) of visible items with these statuses, on or after `focFrom`. */
export async function getFocDates(statuses, focFrom) {
  if (DEMO) {
    const rows = await getItems({ statuses });
    return [...new Set(rows.map((r) => r.foc_date).filter((d) => d && d >= focFrom))].sort();
  }
  const sb = await supabase();
  const dates = new Set();
  for (let from = 0; ; from += 1000) {
    const rows = unwrap(await sb.from('items').select('foc_date').eq('hidden', false).in('status', statuses).gte('foc_date', focFrom).range(from, from + 999));
    rows.forEach((r) => dates.add(r.foc_date));
    if (rows.length < 1000) break;
  }
  return [...dates].sort();
}

/** @param {{ from?: string, to?: string, type?: string }} f  ISO timestamps */
/** One visible title by id, or null. */
export async function getItem(id) {
  if (DEMO) return (await demo()).items.find((i) => i.id === id && !i.hidden) ?? null;
  const sb = await supabase();
  return unwrap(await sb.from('items').select('*').eq('id', id).eq('hidden', false).maybeSingle());
}

/** Every visible cover of the same issue (the main cover first), including `item` itself. */
export async function getVariants(item) {
  if (!item.series_key || !item.issue_number) return [item];
  if (DEMO) {
    const { items } = await demo();
    return items.filter((i) => i.series_key === item.series_key && i.issue_number === item.issue_number && !i.hidden);
  }
  const sb = await supabase();
  const rows = unwrap(
    await sb.from('items').select('*').eq('hidden', false).eq('series_key', item.series_key).eq('issue_number', item.issue_number).order('variant', { nullsFirst: true }).order('id').limit(40),
  );
  return rows.some((r) => r.id === item.id) ? rows : [item, ...rows];
}

export async function getEvents(f = {}) {
  if (DEMO) {
    const { events } = await demo();
    return events
      .filter(
        (e) =>
          (!f.from || e.starts_at >= f.from) &&
          (!f.to || e.starts_at < f.to) &&
          (!f.type || e.event_type === f.type),
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  const sb = await supabase();
  let query = sb.from('events').select('*').order('starts_at');
  if (f.from) query = query.gte('starts_at', f.from);
  if (f.to) query = query.lt('starts_at', f.to);
  if (f.type) query = query.eq('event_type', f.type);
  return unwrap(await query);
}

export async function getEvent(id) {
  if (DEMO) return (await demo()).events.find((e) => e.id === id) ?? null;
  const sb = await supabase();
  return unwrap(await sb.from('events').select('*').eq('id', id).maybeSingle());
}

/** People signed up so far for an event (null if unknown). */
export async function getEventSpotsTaken(eventId) {
  if (DEMO) return 0;
  const sb = await supabase();
  const { data, error } = await sb.rpc('event_spots_taken', { p_event_id: eventId });
  return error ? null : data;
}

/** Sign someone up for an event. Throws an Error whose message is safe to show the customer. */
export async function signUpForEvent({ eventId, name, email, phone, party, notes, website }) {
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 400));
    return 1;
  }
  const sb = await supabase();
  const { data, error } = await sb.rpc('event_signup', {
    p_event_id: eventId, p_name: name, p_email: email, p_phone: phone, p_party: party, p_notes: notes || null, p_website: website || null,
  });
  if (error) throw new Error(error.code === 'P0001' ? error.message : 'Something went wrong with your signup. Please try again or call the shop.');
  return data;
}

export async function getPosts(limit) {
  if (DEMO) {
    const { posts } = await demo();
    return limit ? posts.slice(0, limit) : posts;
  }
  const sb = await supabase();
  let query = sb.from('posts').select('id,title,slug,excerpt,cover_url,published_at').order('published_at', { ascending: false });
  if (limit) query = query.limit(limit);
  return unwrap(await query);
}

/** Editable page text blocks: { slug: { lede_html, body_html } } for the given slugs. */
export async function getPageContent(slugs) {
  if (DEMO) {
    const { PAGES } = await import('./page-defaults.js');
    return Object.fromEntries(slugs.map((s) => [s, { lede_html: PAGES[s]?.lede ?? null, body_html: PAGES[s]?.body ?? null }]));
  }
  const sb = await supabase();
  const rows = unwrap(await sb.from('pages').select('slug,lede_html,body_html,meta_title,meta_description').in('slug', slugs));
  return Object.fromEntries(rows.map((r) => [r.slug, r]));
}

/** Series matching a search, for the site search: { key, label, issues, cover_url }. Needs the database. */
export async function searchSeries(q) {
  if (DEMO) return [];
  const sb = await supabase();
  return unwrap(await sb.rpc('search_series', { p_q: q }));
}

/** The cover artist named in a title's cover text when they aren't credited on it: [{ name, covers }]. Needs the database. */
export async function coverArtists(itemId) {
  if (DEMO) return [];
  const sb = await supabase();
  return unwrap(await sb.rpc('item_cover_artists', { p_item: itemId }));
}

/** Creators matching a search, for following an artist: { key, label, ... }. Needs the database. */
export async function searchArtists(q) {
  if (DEMO) return [];
  const sb = await supabase();
  return unwrap(await sb.rpc('search_artists', { p_q: q }));
}

/** Every page text block (built-in and custom) for the site search: { slug, title, lede_html, body_html }. */
export async function getSearchablePages() {
  if (DEMO) {
    const { PAGES } = await import('./page-defaults.js');
    return Object.entries(PAGES).map(([slug, p]) => ({ slug, title: null, lede_html: p.lede ?? null, body_html: p.body ?? null, custom: false }));
  }
  const sb = await supabase();
  return unwrap(await sb.from('pages').select('slug,title,lede_html,body_html,custom'));
}

export async function getCustomPage(slug) {
  if (DEMO) return null;
  const sb = await supabase();
  return unwrap(await sb.from('pages').select('slug,title,lede_html,body_html,meta_title,meta_description').eq('custom', true).eq('slug', slug).maybeSingle());
}

/** Pages staff created in the admin, in menu order. */
export async function getCustomPages() {
  if (DEMO) return [];
  const sb = await supabase();
  return unwrap(await sb.from('pages').select('slug,title,placement').eq('custom', true).order('sort').order('title'));
}

export async function getFaqs() {
  if (DEMO) {
    const { FAQS } = await import('./page-defaults.js');
    return FAQS.map((f, i) => ({ id: i + 1, question: f.question, answer_html: f.answer, sort: i }));
  }
  const sb = await supabase();
  return unwrap(await sb.from('faqs').select('*').order('sort').order('id'));
}

export async function getPost(slug) {
  if (DEMO) return (await demo()).posts.find((p) => p.slug === slug) ?? null;
  const sb = await supabase();
  return unwrap(await sb.from('posts').select('*').eq('slug', slug).maybeSingle());
}

/**
 * Submit a reservation order covering one or more pre-order titles.
 * `lines` is [{ itemId, quantity }]. Resolves with the order id, or throws an
 * Error whose message is safe to show the customer. All-or-nothing: if any
 * title fails validation, nothing is saved.
 */
export async function reserve({ name, phone, email, website, lines }) {
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 400));
    const { settings, items } = await demo();
    for (const l of lines) {
      const item = items.find((i) => i.id === l.itemId);
      const title = item ? (item.issue_number ? `${item.title} #${item.issue_number}` : item.title) : 'One of those titles';
      if (!item || item.status !== 'pre_order') throw new Error(`${title} is no longer open for pre-order — please remove it from your list.`);
      if (l.quantity > settings.max_copies_per_title) throw new Error(`Limit is ${settings.max_copies_per_title} copies per customer for ${title}.`);
    }
    return Math.floor(Math.random() * 90000) + 10000;
  }
  const sb = await supabase();
  const { data, error } = await sb.rpc('create_reservation_order', {
    p_name: name,
    p_phone: phone || null,
    p_email: email || null,
    p_items: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
    p_website: website || null,
  });
  if (error) {
    // Messages raised with errcode P0001 in create_reservation_order are written for customers.
    throw new Error(error.code === 'P0001' ? error.message : 'Something went wrong saving your pull list. Please try again or call the shop.');
  }
  return data;
}

/** The survey to show: the one with this slug if it is open, else the newest open survey. Null if none. With `preview`, a closed survey is returned too (the database only lets signed-in staff read those). */
export async function getSurvey(slug, { preview = false } = {}) {
  if (DEMO) return null;
  const sb = await supabase();
  let q = sb.from('surveys').select('id,slug,title,intro,thank_you,questions,is_open,collect_email,email_prompt');
  if (!preview) q = q.eq('is_open', true);
  return unwrap(await (slug ? q.eq('slug', slug) : q.order('updated_at', { ascending: false }).limit(1)).maybeSingle());
}

/** Save one anonymous survey response. Throws an Error whose message is safe to show the customer. */
export async function submitSurvey({ surveyId, answers, website, email }) {
  const sb = await supabase();
  const { error } = await sb.rpc('submit_survey_response', { p_survey_id: surveyId, p_answers: answers, p_website: website || null, p_email: email || null });
  if (error) throw new Error(error.code === 'P0001' ? error.message : 'Something went wrong saving your answers. Please try again or tell us in the shop.');
}

/** Email the shop a collection for sale (details + photos) via the sell-inquiry function. Throws an Error safe to show. */
export async function sendSellInquiry(formData) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sell-inquiry`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY }, body: formData }).catch(() => null);
  const body = await res?.json().catch(() => ({}));
  if (!res?.ok) throw new Error(body?.error || 'Sorry, that didn’t go through. Please check your connection and try again.');
}

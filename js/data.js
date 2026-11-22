// Data access for customer-facing pages. Talks to Supabase when configured,
// otherwise serves demo data with the same shapes and filtering behaviour.

import { SUPABASE_URL, SUPABASE_ANON_KEY, LOCATIONS_ENABLED } from './config.js';
import { squash, searchWords } from './util.js';

export const DEMO = !SUPABASE_URL;

let clientPromise;
export function supabase() {
  if (DEMO) return null;
  clientPromise ??= import('./vendor/supabase.mjs').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
  );
  return clientPromise;
}

// Start downloading the client now, so it's ready by the time the first query is made.
if (!DEMO) supabase();

let demoPromise;
const demo = () => (demoPromise ??= import('./demo-data.js'));

/** A Supabase answer's data; a failure is thrown as a real Error (with a stack), keeping the database's code, details and hint. */
const unwrap = ({ data, error }) => {
  if (error) throw error instanceof Error ? error : Object.assign(new Error(error.message || 'The request failed'), error);
  return data;
};

let settingsPromise;
export function getSettings() {
  settingsPromise ??= DEMO
    ? demo().then((d) => d.settings)
    : supabase().then(async (sb) => {
        // Both at once: every page waits for this.
        const [settings, { data: all }] = await Promise.all([
          sb.from('settings').select('*').eq('id', 1).maybeSingle(),
          sb.from('locations').select('*').order('id'),
        ]);
        const row = unwrap(settings);
        if (!row) throw new Error('Shop settings not found — run supabase/seed.sql against this project.');
        // Address, phone, hours and holiday hours come from the shop's default location (a shop's first one mirrors its settings).
        // A shop with 2+ locations also gets them all as `locations`, for the Visit page and footer.
        const loc = (all ?? []).find((l) => l.is_default);
        if (loc) {
          const { street, city, region, postal_code, country, phone, hours, holiday_hours, map_embed_url } = loc;
          return { ...row, street, city, region, postal_code, country, phone, hours, holiday_hours, map_embed_url, locations: LOCATIONS_ENABLED && all.length > 1 ? all : [] };
        }
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
 * @param {number[]} [f.ids]       only these titles
 * @param {string[]} [f.statuses]  item_status values to include
 * @param {string[]} [f.excludeStatuses]
 * @param {number}   [f.categoryId]
 * @param {string}   [f.categorySlug] one category by slug (joined in the same query, so no separate lookup is needed)
 * @param {number[]} [f.categoryIds] any of these categories
 * @param {string[]} [f.publishers] any of these publishers
 * @param {string}   [f.focFrom]   ISO date; skip items whose FOC is before this
 * @param {string}   [f.focBefore] ISO date; pre-orders with FOC on/before this
 * @param {string}   [f.closedBefore] ISO date (from openFocFrom()); leave out pre-orders still open to reserve
 * @param {string}   [f.q]         search title, variant and creators
 * @param {string[]} [f.badges]     titles with any of these collector badges
 * @param {boolean}  [f.featured]   staff-chosen for the homepage
 * @param {boolean}  [f.staffPick]
 * @param {string}   [f.order]     'foc' | 'title' | 'newest' | 'released' (latest release date first) | 'arrivals' (New This Wednesday, Just Arrived, in stock, Backorder / Sold Out, then Coming Soon)
 * @param {number}   [f.limit]
 * @param {number}   [f.offset]
 * @param {boolean}  [f.withCount] resolve { rows, count } instead of rows
 * @param {number}   [f.knownCount] with withCount: the total from this list's first page, so the next pages skip
 *                                  counting every match again (it comes back as the count)
 *
 * Rows carry LIST_COLUMNS, not the description or ISBN: the title popup loads those when it opens (getItem).
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
 * The ten of these titles customers have pulled most, most first (the app's Hot rows); titles nobody has pulled keep
 * their order after the rest. Never fails: the first ten as given if the ranking can't load.
 */
export async function rankByPulls(ids) {
  if (DEMO || !ids.length) return ids.slice(0, 10);
  try {
    const { data, error } = await (await supabase()).rpc('rank_by_pulls', { p_ids: ids });
    if (error) throw error;
    return data.map((r) => r.item_id);
  } catch {
    return ids.slice(0, 10);
  }
}

/**
 * f.openFirst (an ISO date, the first FOC still open, from openFocFrom()): titles that can still go on a pull list
 * (pre-order, order cutoff not passed) come first, then everything else, each part in the usual order. Paging
 * (offset/limit) runs across both parts as one list.
 */
// What a title card, the popup's first view and a reservation need. Leaves out the description and ISBN (the popup
// fetches them) and the search-only columns, about half of each row.
export const LIST_COLUMNS = 'id,title,issue_number,publisher,category_id,status,cover_url,cover_thumb_url,price,retail_price,shop_price,release_date,foc_date,arrived_on,staff_pick,featured,badges,mature,hidden,variant,creators,series_key,arrival_rank,created_at,updated_at';

async function fetchItems(f) {
  // A search with no letters or digits in it ("!!!", emoji, or a script the search can't read yet) matches
  // nothing, rather than every title.
  if (f.q?.trim() && !searchWords(f.q).length) return f.countOnly ? 0 : f.withCount ? { rows: [], count: 0 } : [];
  if (f.openFirst && !DEMO) return fetchOpenFirst(f);
  if (DEMO) {
    const { items, categories } = await demo();
    const words = searchWords(f.q);
    const text = (i) => squash(`${i.title} ${i.variant ?? ''} ${i.creators ?? ''} ${i.issue_number ?? ''}`);
    let rows = items.filter(
      (i) =>
        (!f.ids || f.ids.includes(i.id)) &&
        // Demo titles have no series key: made from the title, as the database's trigger does.
        (!f.seriesKey || (i.series_key ?? String(i.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()) === f.seriesKey) &&
        (!f.statuses || f.statuses.includes(i.status)) &&
        (!f.excludeStatuses || !f.excludeStatuses.includes(i.status)) &&
        (!f.categoryId || i.category_id === f.categoryId) &&
        (!f.categorySlug || i.category_id === categories.find((c) => c.slug === f.categorySlug)?.id) &&
        (!f.categoryIds?.length || f.categoryIds.includes(i.category_id)) &&
        (!f.publishers?.length || f.publishers.includes(i.publisher)) &&
        (!f.focFrom || !i.foc_date || i.foc_date >= f.focFrom) &&
        (!f.focBefore || (i.foc_date && i.foc_date <= f.focBefore)) &&
        (!f.closedBefore || i.status !== 'pre_order' || (i.foc_date && i.foc_date < f.closedBefore)) &&
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
  const columns = f.categorySlug ? `${LIST_COLUMNS}, cat:categories!inner(slug)` : LIST_COLUMNS;
  const counting = f.withCount && f.knownCount == null;
  let query = sb
    .from('items')
    .select(columns, f.countOnly ? { count: 'exact', head: true } : counting ? { count: 'exact' } : undefined)
    .eq('hidden', false);
  if (f.categorySlug) query = query.eq('cat.slug', f.categorySlug);
  if (f.ids) query = query.in('id', f.ids);
  if (f.seriesKey) query = query.eq('series_key', f.seriesKey);
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
  if (f.order === 'released_asc') query = query.order('release_date', { ascending: true, nullsFirst: false });
  if (f.order === 'price') query = query.order('price', { ascending: true, nullsFirst: false });
  if (f.order === 'price_desc') query = query.order('price', { ascending: false, nullsFirst: false });
  if (f.order === 'publisher') query = query.order('publisher', { ascending: true, nullsFirst: false });
  // Keep an issue's covers together, main cover (no variant / CVR A) first.
  const desc = f.order === 'title_desc';
  query = query.order('title', { ascending: !desc }).order('issue_number', { ascending: !desc, nullsFirst: true }).order('variant', { nullsFirst: true }).order('id');
  if (f.limit) query = query.range(f.offset ?? 0, (f.offset ?? 0) + f.limit - 1);
  const res = await query;
  const data = unwrap(res);
  const count = counting || f.countOnly ? res.count : f.knownCount;
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
  // The open part is counted on every page (where it ends decides each page); the rest only when the total is wanted.
  const total = f.withCount && f.knownCount == null;
  let restCount = 0;
  if (left === 0) {
    if (total) restCount = await fetchItems({ ...rest, countOnly: true });
  } else {
    const page = await fetchItems({ ...rest, withCount: total, offset: Math.max(0, start - openCount), limit: left });
    rows.push(...(total ? page.rows : page));
    if (total) restCount = page.count;
  }
  return f.withCount ? { rows, count: total ? openCount + restCount : f.knownCount } : rows;
}

function sorter(order) {
  const byTitle = (a, b) =>
    a.title.localeCompare(b.title) || (a.issue_number ?? '').localeCompare(b.issue_number ?? '') || (a.variant ?? '').localeCompare(b.variant ?? '');
  if (order === 'foc') return (a, b) => (a.foc_date ?? '9').localeCompare(b.foc_date ?? '9') || byTitle(a, b);
  if (order === 'newest') return (a, b) => b.id - a.id;
  if (order === 'released') return (a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? '') || byTitle(a, b);
  if (order === 'released_asc') return (a, b) => (a.release_date ?? '9').localeCompare(b.release_date ?? '9') || byTitle(a, b);
  if (order === 'price') return (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || byTitle(a, b);
  if (order === 'price_desc') return (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity) || byTitle(a, b);
  if (order === 'publisher') return (a, b) => (a.publisher ?? '\uffff').localeCompare(b.publisher ?? '\uffff') || byTitle(a, b);
  if (order === 'title_desc') return (a, b) => byTitle(b, a);
  if (order === 'arrivals') {
    const rank = (i) => ({ new_this_wednesday: 0, just_arrived: 1, backorder: 3, sold_out: 3, coming_soon: 4, pre_order: 4 })[i.status] ?? 2;
    return (a, b) => rank(a) - rank(b) || byTitle(a, b);
  }
  return byTitle;
}

export async function getPublishers(statuses) {
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  if (DEMO) {
    const rows = await getItems({ statuses });
    return [...new Set(rows.map((r) => r.publisher).filter(Boolean))].sort(byName);
  }
  // The distinct names in one call (catalog_publishers in the database), not every title's publisher.
  const sb = await supabase();
  return unwrap(await sb.rpc('catalog_publishers', { p_statuses: statuses })).map((r) => r.publisher).sort(byName);
}

/** Distinct FOC dates (ISO, ascending) of visible items with these statuses, on or after `focFrom`. */
export async function getFocDates(statuses, focFrom) {
  if (DEMO) {
    const rows = await getItems({ statuses });
    return [...new Set(rows.map((r) => r.foc_date).filter((d) => d && d >= focFrom))].sort();
  }
  const sb = await supabase();
  return unwrap(await sb.rpc('catalog_foc_dates', { p_statuses: statuses, p_from: focFrom })).map((r) => r.foc_date);
}

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

/**
 * @param {{ from?: string, to?: string, type?: string }} f  ISO timestamps. `from`: events not over by then (a
 * convention that has started but not ended counts); `to`: events over before then. The same time as both splits
 * the calendar into upcoming and past with every event in exactly one. An event without an end time is over once it starts.
 */
export async function getEvents(f = {}) {
  if (DEMO) {
    const { events } = await demo();
    const end = (e) => e.ends_at ?? e.starts_at;
    return events
      .filter(
        (e) =>
          (!f.from || Date.parse(end(e)) >= Date.parse(f.from)) &&
          (!f.to || Date.parse(end(e)) < Date.parse(f.to)) &&
          (!f.type || e.event_type === f.type),
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  const sb = await supabase();
  let query = sb.from('events').select('*').order('starts_at');
  // coalesce(ends_at, starts_at) >= from / < to
  if (f.from) query = query.or(`ends_at.gte."${f.from}",and(ends_at.is.null,starts_at.gte."${f.from}")`);
  if (f.to) query = query.or(`ends_at.lt."${f.to}",and(ends_at.is.null,starts_at.lt."${f.to}")`);
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

/**
 * Records what was searched and how many titles it found, for Dashboard → Trends. Never gets in the search's way.
 * Reloading or coming back to the same results doesn't count again (remembered for this tab).
 */
export async function logSearch(term, titles) {
  const words = term.trim();
  if (DEMO || !words) return;
  const key = 'pw-last-search';
  const same = words.toLowerCase();
  try {
    if (sessionStorage.getItem(key) === same) return rememberSearch(recentSearchId());
    sessionStorage.setItem(key, same);
  } catch { /* private window: it may count twice, which is fine */ }
  try {
    const { data: id } = await (await supabase()).rpc('log_search', { p_term: words, p_titles: titles });
    rememberSearch(titles > 0 ? id : null); // nothing can be reserved from a search that found nothing
  } catch (err) {
    console.warn(err);
  }
}

// So Analytics can tell which searches lead to a reservation: this tab remembers the log row of its latest search for
// a while. Only that number is kept, and the log itself never says who searched.
const SEARCH_MEMO = 'pw-search-memo';
const SEARCH_CREDIT_MS = 30 * 60 * 1000;

function rememberSearch(id) {
  try {
    if (id) sessionStorage.setItem(SEARCH_MEMO, JSON.stringify({ id, at: Date.now() }));
    else sessionStorage.removeItem(SEARCH_MEMO);
  } catch { /* the reservation just isn't credited to a search */ }
}

/** The log row of this tab's search in the last 30 minutes, or null. */
export function recentSearchId() {
  try {
    const memo = JSON.parse(sessionStorage.getItem(SEARCH_MEMO) ?? 'null');
    return memo && Date.now() - memo.at < SEARCH_CREDIT_MS ? memo.id : null;
  } catch {
    return null;
  }
}

/** Adds reserved titles to that search's count. Never gets in the reservation's way. */
export async function creditSearch(id, titles = 1) {
  if (DEMO || !id || !titles) return;
  try {
    await (await supabase()).rpc('log_search_reserved', { p_id: id, p_titles: titles });
  } catch (err) {
    console.warn(err);
  }
}

/** One log row number per title on a guest's order (null for a title that didn't follow a search). */
export function creditSearches(ids) {
  const titles = new Map();
  for (const id of ids) if (id) titles.set(id, (titles.get(id) ?? 0) + 1);
  titles.forEach((n, id) => creditSearch(id, n));
}

let settleTimer;
/** For boxes that search as you type: logs only the words the customer stopped on. Call cancelSearchLog() on more typing. */
export function logSearchWhenSettled(term, titles) {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => logSearch(term, titles), 2000);
}
export const cancelSearchLog = () => clearTimeout(settleTimer);

/** Series matching a search, for the site search: { key, label, issues, cover_url }. Needs the database. */
/**
 * One series for its page (series.html): { key, label, publisher, cover_url } from the shop's Series list, or null when
 * it isn't on the list (a series made only from imported titles: the page names it from its issues).
 */
export async function getSeriesEntry(key) {
  if (DEMO) return null;
  const sb = await supabase();
  const row = unwrap(await sb.from('series_catalog').select('key,title,publisher,cover_url').eq('key', key).maybeSingle());
  return row ? { key: row.key, label: row.title, publisher: row.publisher, cover_url: row.cover_url } : null;
}

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

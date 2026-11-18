// What the "Follow this series?" dialog shows (storefront, app and Admin → Customers): the next issue still open for
// ordering, from series_follow_preview() in the database, with its cover and dates, and the other open issues that
// come in with it. Each side draws its own markup from these facts.
import { localDate, lastReserveDay } from './dates.js';

const day = (iso) => localDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * preview: { label, issues, next, more } from series_follow_preview(), or null when it couldn't be loaded.
 * label: the series name to use when there's no preview. Returns
 *   { name, loaded, next: { title, covers, orderBy, foc, coverUrl, thumbUrl } | null, also: ['#26', …], alsoMore }
 *   also: the other open issues added now (up to six); alsoMore: how many more beyond those.
 */
export function seriesFollowFacts(preview, { label = 'this series', allCovers = false } = {}) {
  const name = preview?.label || label;
  const n = preview?.next;
  const next = n ? {
    title: [n.title, n.issue_number && `#${n.issue_number}`].filter(Boolean).join(' '),
    covers: allCovers ? (n.covers > 1 ? `All ${n.covers} covers` : 'All covers') : 'Main cover',
    orderBy: n.foc_date ? day(lastReserveDay(n.foc_date)) : '',
    foc: n.foc_date ? day(n.foc_date) : '',
    coverUrl: n.cover_url || '',
    thumbUrl: n.cover_thumb_url || n.cover_url || '',
  } : null;
  const also = (preview?.more ?? []).map((m) => (m.issue_number ? `#${m.issue_number}` : '')).filter(Boolean);
  return { name, loaded: !!preview, next, also, alsoMore: Math.max(0, (preview?.issues ?? 0) - 1 - also.length) };
}

/** "#26, #27 and 3 more" */
export const alsoText = (f) => [f.also.join(', '), f.alsoMore && `${f.alsoMore} more`].filter(Boolean).join(' and ');

export const NEVER_ADDED = 'Facsimiles and later printings are never added.';

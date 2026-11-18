// The question asked before following a series (storefront, app and Admin → Customers): it names the next issue
// still open for ordering, from series_follow_preview() in the database, so the customer knows what goes on their
// list first.
import { localDate, lastReserveDay } from './dates.js';

const day = (iso) => localDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * preview: { label, issues, next: { title, issue_number, foc_date } | null } (null when it couldn't be loaded).
 * label: the series name to use when there's no preview. list: whose pull list ("your pull list", "Dana's pull list").
 */
export function seriesFollowQuestion(preview, { label = 'this series', allCovers = false, list = 'your pull list' } = {}) {
  const name = preview?.label || label;
  const head = `Follow ${name}${allCovers ? ' (all covers)' : ''}?`;
  const never = 'Facsimiles and later printings are never added.';
  if (!preview) return `${head}\n\nNew issues will be added to ${list} automatically. ${never}`;
  const next = preview.next;
  if (!next) return `${head}\n\nNo issue is open for ordering right now. The next one is added to ${list} when the shop lists it. ${never}`;
  const issue = [next.title, next.issue_number && `#${next.issue_number}`].filter(Boolean).join(' ');
  const when = next.foc_date ? ` — order by ${day(lastReserveDay(next.foc_date))} (FOC ${day(next.foc_date)})` : '';
  const more = preview.issues > 1 ? `, along with ${preview.issues - 1} more open ${preview.issues === 2 ? 'issue' : 'issues'}` : '';
  return `${head}\n\nNext issue open for ordering: ${issue}${when}.\n\nIt goes on ${list} now${more}${allCovers ? ', every cover' : ''}. Later issues are added automatically. ${never}`;
}

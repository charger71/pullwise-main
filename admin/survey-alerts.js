// New survey responses on every admin screen: a count of responses nobody has read yet on the Surveys menu item (and,
// added to the unread chats, on the phone menu button). Opening a survey's Results marks its responses read
// (staff_mark_survey_seen), which clears them from the count. Customers answer without signing in and responses
// arrive rarely, so the count is read again on each screen change, when the tab comes back into view, and every few
// minutes, rather than live.

import { $$ } from './lib.js';

const REFRESH = 5 * 60000;
let sb;
let changed = () => {};
let timer;
let count = 0;

/** How many survey responses nobody has read yet. */
export const newSurveyResponses = () => count;

/** Start counting. `onCount(n)` runs whenever the count changes. */
export function startSurveyAlerts(client, { onCount } = {}) {
  sb = client;
  if (onCount) changed = onCount;
  clearInterval(timer);
  timer = setInterval(refreshSurveyAlerts, REFRESH);
  document.addEventListener('visibilitychange', onVisible);
  refreshSurveyAlerts();
}

const onVisible = () => document.visibilityState === 'visible' && refreshSurveyAlerts();

/** Count again now (after a screen change, or after Results marked a survey read). */
export async function refreshSurveyAlerts() {
  if (!sb) return;
  const { count: n, error } = await sb.from('survey_responses').select('id', { count: 'exact', head: true }).eq('seen', false);
  if (!error) paint(n ?? 0);
}

function paint(n) {
  $$('[data-survey-badge]').forEach((b) => {
    b.hidden = !n;
    b.innerHTML = n ? `${n}<span class="visually-hidden"> new survey response${n === 1 ? '' : 's'}</span>` : '';
  });
  if (n === count) return;
  count = n;
  changed(n);
}

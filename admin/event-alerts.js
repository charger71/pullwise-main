// New event signups on every admin screen: a count of signups nobody has looked at yet on the Events menu item (and,
// added to the other counts, on the phone menu button). Opening Events → Event Signups, or one event's signups, marks
// them read (event_signups.seen), which clears them from the count. Same timing as survey-alerts.js: read again on each
// screen change, when the tab comes back into view, and every few minutes, rather than live.

import { $$ } from './lib.js';

const REFRESH = 5 * 60000;
let sb;
let changed = () => {};
let timer;
let count = 0;

/** How many event signups nobody has looked at yet. */
export const newEventSignups = () => count;

/** Start counting. `onCount(n)` runs whenever the count changes. */
export function startEventAlerts(client, { onCount } = {}) {
  sb = client;
  if (onCount) changed = onCount;
  clearInterval(timer);
  timer = setInterval(refreshEventAlerts, REFRESH);
  document.addEventListener('visibilitychange', onVisible);
  refreshEventAlerts();
}

const onVisible = () => document.visibilityState === 'visible' && refreshEventAlerts();

/** Count again now (after a screen change, or after the signups were marked read). */
export async function refreshEventAlerts() {
  if (!sb) return;
  const { count: n, error } = await sb.from('event_signups').select('id', { count: 'exact', head: true }).eq('seen', false);
  if (!error) paint(n ?? 0);
}

function paint(n) {
  $$('[data-event-badge]').forEach((b) => {
    b.hidden = !n;
    b.innerHTML = n ? `${n}<span class="visually-hidden"> new event signup${n === 1 ? '' : 's'}</span>` : '';
  });
  if (n === count) return;
  count = n;
  changed(n);
}

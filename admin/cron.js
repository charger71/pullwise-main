// How often a scheduled database job (pg_cron) runs, from its schedule, so Dashboard → System Health can tell a job
// that has stopped from one that simply isn't due yet. Most jobs run hourly; pull-import-cleanup runs nightly.

/**
 * A pg_cron schedule (minute hour day-of-month month day-of-week) → { every, staleMs }: the words for how often it
 * runs ('every hour', 'every night', 'every week') and how long after its last run it counts as late (one missed run
 * plus some slack). A schedule this doesn't recognise is treated as daily or slower, so it isn't flagged too soon.
 */
export function jobCadence(schedule) {
  const [minute, hour, dom, month, dow] = String(schedule ?? '').trim().split(/\s+/);
  const any = (f) => f === '*';
  const HOUR = 3600000;
  if (/^\d+$/.test(minute ?? '') && any(hour) && any(dom) && any(month) && any(dow)) return { every: 'every hour', staleMs: 2.5 * HOUR };
  if (/^\d+$/.test(minute ?? '') && /^\d+$/.test(hour ?? '') && any(dom) && any(month) && any(dow)) return { every: 'every night', staleMs: 26 * HOUR };
  if (/^\d+$/.test(minute ?? '') && /^\d+$/.test(hour ?? '') && any(dom) && any(month) && /^\d$/.test(dow ?? '')) return { every: 'every week', staleMs: 8 * 24 * HOUR };
  return { every: 'on its schedule', staleMs: 26 * HOUR };
}

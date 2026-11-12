import { initPage, $, esc, fmtDate, fmtTime, eventTimes, isAllDay, eventPlace, EVENT_TYPES, focusBackOnClose } from '../site.js';
import { getEvents, getEventSpotsTaken, DEMO } from '../data.js';
import { SUPABASE_URL, SITE_URL } from '../config.js';
import { icsFor, googleLink, outlookLink, htmlToText } from '../ics.js';

const s = await initPage();
// Dates (and the month headings) are the shop's, wherever the visitor is (an unknown zone falls back to the browser's).
const tz = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: s.timezone || undefined }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
})();
const day = (iso, opts) => fmtDate(iso, { ...opts, timeZone: tz });
const host = new URL(SITE_URL).host;

// Standing feed of all events, served by the calendar-feed Edge Function.
if (!DEMO) {
  const sub = $('#subscribe');
  sub.href = `${SUPABASE_URL.replace(/^https:/, 'webcal:')}/functions/v1/calendar-feed`;
  sub.hidden = false;
}

const form = $('#filters');
const list = $('#events');
let events = [];

const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** Small status tags for the list, as HTML by event id: Cancelled, Today / Tomorrow, and the signup state (open, N spots left, full). */
async function eventTags(rows) {
  const out = new Map();
  const todayKey = dayKey(Date.now());
  const tomorrowKey = dayKey(Date.now() + DAY_MS);
  const live = rows.filter((e) => e.signup_enabled && !e.cancelled_at && new Date(e.ends_at ?? e.starts_at) >= new Date());
  const taken = new Map(await Promise.all(live.filter((e) => e.signup_capacity).map(async (e) => [e.id, await getEventSpotsTaken(e.id)])));
  for (const e of rows) {
    const tags = [];
    if (e.cancelled_at) tags.push('<span class="event__tag event__tag--cancelled">Cancelled</span>');
    else {
      const k = dayKey(e.starts_at);
      if (k === todayKey) tags.push('<span class="event__tag event__tag--today">Today</span>');
      else if (k === tomorrowKey) tags.push('<span class="event__tag">Tomorrow</span>');
      if (live.includes(e)) {
        const left = e.signup_capacity && taken.get(e.id) != null ? Math.max(0, e.signup_capacity - taken.get(e.id)) : null;
        tags.push(left === 0 ? '<span class="event__tag event__tag--full">Full</span>' : left === null ? '<span class="event__tag event__tag--open">Signups open</span>' : `<span class="event__tag event__tag--open">${left} ${left === 1 ? 'spot' : 'spots'} left</span>`);
      }
    }
    if (tags.length) out.set(e.id, tags.join(' '));
  }
  return out;
}

// How often a repeating event happens, said from the dates of its series that are loaded ("Repeats weekly").
const DAY_MS = 864e5;
function repeatLabels(rows) {
  const bySeries = new Map();
  for (const e of rows) if (e.series_id) bySeries.set(e.series_id, [...(bySeries.get(e.series_id) ?? []), Date.parse(e.starts_at)]);
  const out = new Map();
  for (const [id, times] of bySeries) {
    const gaps = times.sort((a, b) => a - b).slice(1).map((t, i) => Math.round((t - times[i]) / DAY_MS));
    const all = (test) => gaps.length > 0 && gaps.every(test);
    out.set(id, all((g) => g === 1) ? 'Repeats daily' : all((g) => g === 7) ? 'Repeats weekly' : all((g) => g === 14) ? 'Repeats every 2 weeks' : all((g) => g >= 28 && g <= 31) ? 'Repeats monthly' : all((g) => g <= 7) ? 'Repeats weekly' : 'Repeats');
  }
  return out;
}

// List or Calendar, remembered on this device. The calendar shows one month at a time, so the When filter only applies to the list.
let view = 'list';
try {
  view = localStorage.getItem('pc-calendar-view') === 'calendar' ? 'calendar' : 'list';
} catch {
  /* start on the list */
}
let month = new Date(); // the month the calendar shows (year and month are what matter)
month = new Date(month.getFullYear(), month.getMonth(), 1);

// The address remembers the view, month and filters, so a month can be linked or shared: ?view=calendar&month=2026-12&type=signing
const params = new URLSearchParams(location.search);
if (params.get('view') === 'calendar' || params.get('view') === 'list') view = params.get('view');
if (/^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') ?? '')) month = new Date(Number(params.get('month').slice(0, 4)), Number(params.get('month').slice(5)) - 1, 1);
if ([...$('#f-type').options].some((o) => o.value && o.value === params.get('type'))) $('#f-type').value = params.get('type');
if ([...$('#f-range').options].some((o) => o.value === params.get('range'))) $('#f-range').value = params.get('range');
function syncUrl() {
  const q = new URLSearchParams();
  const { type, range } = Object.fromEntries(new FormData(form));
  if (view === 'calendar') q.set('view', 'calendar'), q.set('month', `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`);
  if (type) q.set('type', type);
  if (view === 'list' && range !== 'upcoming') q.set('range', range);
  try {
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  } catch {
    /* the address is a convenience */
  }
}
const syncView = () => {
  document.querySelectorAll('.view-toggle [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#f-range').closest('.field').hidden = view === 'calendar';
};
document.querySelectorAll('.view-toggle [data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    view = b.dataset.view;
    try {
      localStorage.setItem('pc-calendar-view', view);
    } catch {
      /* remembering the view is optional */
    }
    syncView();
    load();
  }),
);

async function load() {
  syncView();
  syncUrl();
  if (view === 'calendar') return loadMonth();
  const { type, range } = Object.fromEntries(new FormData(form));
  const now = new Date().toISOString();
  try {
    events = await getEvents(range === 'past' ? { to: now, type } : { from: now, type });
  } catch (err) {
    console.error(err);
    events = [];
    list.innerHTML = '<p class="empty">We couldn’t load the events just now. Please try again in a moment.</p>';
    return;
  }
  // An event is upcoming until it ends (the same rule getEvents uses), so one that's under way isn't "past" yet.
  const ended = (e) => new Date(e.ends_at ?? e.starts_at) < new Date(now);
  events = events.filter((e) => (range === 'past' ? ended(e) : !ended(e)) && (range !== 'week' || Date.parse(e.starts_at) < Date.parse(now) + 7 * DAY_MS));
  if (range === 'past') events.reverse();

  if (!events.length) {
    list.innerHTML = '<p class="empty">No events here yet — check back soon.</p>';
    return;
  }
  // The short description, or the start of the full one (plain text: the full text is on the event's page).
  const plain = (html) => htmlToText(html).replace(/\s+/g, ' ');
  const blurb = (e) => {
    if (e.summary?.trim()) return e.summary.trim();
    const text = plain(e.description);
    return text.length > 200 ? `${text.slice(0, 200).replace(/\s+\S*$/, '')}…` : text;
  };
  const repeats = repeatLabels(events);
  const tags = await eventTags(events);
  let lastMonth = '';
  list.innerHTML = events
    .map((e) => {
      const month = day(e.starts_at, { month: 'long', year: 'numeric' });
      const heading = month !== lastMonth ? `<h2 class="month-heading">${esc(month)}</h2>` : '';
      lastMonth = month;
      return `${heading}
        <article class="event">
          <div class="event__date" aria-hidden="true">
            <span class="event__month">${day(e.starts_at, { month: 'short' })}</span>
            <span class="event__day">${day(e.starts_at, { day: 'numeric' })}</span>
          </div>
          <div class="event__body${e.image_url ? ' event__body--img' : ''}">
            <div class="event__text">
            <span class="event__type">${esc(EVENT_TYPES[e.event_type] ?? 'Event')}${e.series_id ? ` <span class="event__repeat">· ${repeats.get(e.series_id)}</span>` : ''}</span>
            ${tags.get(e.id) ? `<p class="event__tags">${tags.get(e.id)}</p>` : ''}
            <h3${e.cancelled_at ? ' class="event__title--cancelled"' : ''}><a href="event.html?id=${e.id}">${esc(e.title)}</a></h3>
            <p class="event__when">${day(e.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${eventTimes(e)}${eventPlace(s, e).label ? ` · ${esc(eventPlace(s, e).label)}` : ''}</p>
            ${blurb(e) ? `<p class="event__summary">${esc(blurb(e))}</p>` : ''}
            <p class="event__more"><a href="event.html?id=${e.id}">More details →</a></p>
            <div class="event__actions"${e.cancelled_at ? ' hidden' : ''}>
              <span>Add to calendar:</span>
              <a href="#" data-ics="${e.id}">Apple / .ics</a>
              <a href="${esc(googleLink(e, eventPlace(s, e).where, s.timezone))}" target="_blank" rel="noopener">Google</a>
              <a href="${esc(outlookLink(e, eventPlace(s, e).where, s.timezone))}" target="_blank" rel="noopener">Outlook</a>
            </div>
            </div>
            ${e.image_url ? `<a class="event__photo" href="${esc(e.image_url)}" data-lightbox><img class="event__img" src="${esc(e.image_url)}" alt="${esc(e.title)}" loading="lazy"></a>` : ''}
          </div>
        </article>`;
    })
    .join('');
}

const CAL_FIT = 2; // events shown in a date square before "+N more"
const dayEventsByKey = new Map(); // day key → { label, list } for the "+N more" dialog

/** Opens a dialog with every event on one day. */
function showDay(k, opener) {
  const day = dayEventsByKey.get(k);
  if (!day) return;
  let dlg = $('#cal-day-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'cal-day-dialog';
    dlg.setAttribute('aria-labelledby', 'cal-day-title');
    dlg.addEventListener('click', (e) => (e.target === dlg || e.target.closest('.dialog__close')) && dlg.close());
    focusBackOnClose(dlg);
    document.body.append(dlg);
  }
  dlg.returnFocusTo = opener;
  dlg.innerHTML = `<div class="dialog__head"><h2 id="cal-day-title">${esc(day.label)}</h2><button class="dialog__close" type="button" aria-label="Close">✕</button></div><div class="dialog__body"><ul class="cal__events cal__events--dialog">${day.list}</ul></div>`;
  dlg.showModal();
}

/** One month as a grid (a plain day-by-day list on phones, where only days with events show). */
async function loadMonth() {
  syncUrl();
  const { type } = Object.fromEntries(new FormData(form));
  const y = month.getFullYear();
  const m = month.getMonth();
  const key = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const pad = (n) => String(n).padStart(2, '0');
  const first = `${y}-${pad(m + 1)}-01`;
  const total = new Date(y, m + 1, 0).getDate();
  const last = `${y}-${pad(m + 1)}-${pad(total)}`;
  try {
    // A day either side covers the shop's time zone differing from UTC; the day keys below do the exact filtering.
    events = await getEvents({ from: new Date(Date.UTC(y, m, 1) - DAY_MS).toISOString(), type });
  } catch (err) {
    console.error(err);
    events = [];
    list.innerHTML = '<p class="empty">We couldn’t load the events just now. Please try again in a moment.</p>';
    return;
  }
  events = events.filter((e) => key(e.starts_at) <= last);
  const repeats = repeatLabels(events);
  const cells = [];
  dayEventsByKey.clear();
  const lead = new Date(y, m, 1).getDay();
  for (let i = 0; i < lead; i++) cells.push('<li class="cal__day cal__day--blank" aria-hidden="true"></li>');
  const todayKey = key(Date.now());
  for (let d = 1; d <= total; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const dayEvents = events.filter((e) => key(e.starts_at) <= k && k <= key(e.ends_at ?? e.starts_at));
    const label = new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    const chip = (e, extra = false) => `<li${extra ? ' class="cal__extra"' : ''}><a class="cal__event cal__event--${esc(e.event_type)}${e.cancelled_at ? ' cal__event--cancelled' : ''}" href="event.html?id=${e.id}" title="${esc(`${e.cancelled_at ? 'Cancelled: ' : ''}${e.title} · ${EVENT_TYPES[e.event_type] ?? 'Event'}${e.series_id ? ` · ${repeats.get(e.series_id)}` : ''}`)}"><span class="cal__time">${isAllDay(e) ? 'All day' : fmtTime(e.starts_at)}</span> ${esc(e.title)}<span class="visually-hidden"> (${esc(EVENT_TYPES[e.event_type] ?? 'Event')}${e.cancelled_at ? ', cancelled' : ''}${e.series_id ? ', repeats' : ''})</span></a></li>`;
    dayEventsByKey.set(k, { label: new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), list: dayEvents.map((e) => chip(e)).join('') });
    // A date square holds CAL_FIT events; on the grid the rest are behind "+N more" (phones list every event, so show them all there).
    cells.push(`<li class="cal__day${dayEvents.length ? ' cal__day--has' : ''}${k === todayKey ? ' cal__day--today' : ''}">
      <span class="cal__num"><span class="cal__label">${esc(label)}</span><span class="cal__digit" aria-hidden="true">${d}</span></span>
      ${dayEvents.length ? `<ul class="cal__events">${dayEvents.map((e, i) => chip(e, i >= CAL_FIT)).join('')}</ul>` : ''}
      ${dayEvents.length > CAL_FIT ? `<button class="cal__more" type="button" data-day="${k}">+${dayEvents.length - CAL_FIT} more<span class="visually-hidden"> events on ${esc(new Date(y, m, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }))}</span></button>` : ''}
    </li>`);
  }
  const title = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  list.innerHTML = `<div class="cal">
    <div class="cal__nav">
      <button class="btn btn--ghost btn--small" type="button" data-month="-1" aria-label="Previous month">← Prev</button>
      <h2 class="cal__title">${esc(title)}</h2>
      <button class="btn btn--ghost btn--small" type="button" data-month="1" aria-label="Next month">Next →</button>
    </div>
    <p class="cal__today"><button class="btn btn--small btn--ghost" type="button" data-month="0">This month</button></p>
    <ul class="cal__weekdays" aria-hidden="true">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<li>${w}</li>`).join('')}</ul>
    <ol class="cal__grid">${cells.join('')}</ol>
    <ul class="cal__legend" aria-label="Event colors">${Object.entries(EVENT_TYPES).map(([k, l]) => `<li><span class="cal__swatch cal__swatch--${esc(k)}" aria-hidden="true"></span>${esc(l)}</li>`).join('')}</ul>
    ${events.some((e) => key(e.starts_at) >= first && key(e.starts_at) <= last) || events.some((e) => key(e.ends_at ?? e.starts_at) >= first && key(e.starts_at) <= last) ? '' : '<p class="empty">No events this month.</p>'}
  </div>`;
}

list.addEventListener('click', (ev) => {
  const more = ev.target.closest('[data-day]');
  if (more) return showDay(more.dataset.day, more);
  const step = ev.target.closest('[data-month]');
  if (step) {
    const n = Number(step.dataset.month);
    month = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(month.getFullYear(), month.getMonth() + n, 1);
    loadMonth();
    return;
  }
  const link = ev.target.closest('[data-ics]');
  if (!link) return;
  ev.preventDefault();
  const e = events.find((x) => x.id === Number(link.dataset.ics));
  const blob = new Blob([icsFor(e, s.shop_name, host, eventPlace(s, e).ics, s.timezone)], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${e.title.replace(/[^\w]+/g, '-')}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Arrow keys move between the days of the month grid: left / right a day, up / down a week, on the day's first event link.
list.addEventListener('keydown', (ev) => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
  const here = ev.target.closest?.('.cal__event, .cal__more');
  if (!step || !here || ev.altKey || ev.ctrlKey || ev.metaKey || !matchMedia('(min-width: 700px)').matches) return;
  const days = [...list.querySelectorAll('.cal__day:not(.cal__day--blank)')];
  const from = days.indexOf(here.closest('.cal__day'));
  for (let i = from + step; i >= 0 && i < days.length; i += step) {
    const target = days[i].querySelector('.cal__event, .cal__more');
    if (target) {
      ev.preventDefault();
      target.focus();
      return;
    }
  }
});

// Swiping sideways on a phone changes the month.
let touchStart = null;
list.addEventListener('touchstart', (ev) => (touchStart = view === 'calendar' && ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null), { passive: true });
list.addEventListener('touchend', (ev) => {
  if (!touchStart) return;
  const dx = ev.changedTouches[0].clientX - touchStart.x;
  const dy = ev.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
  month = new Date(month.getFullYear(), month.getMonth() + (dx < 0 ? 1 : -1), 1);
  loadMonth();
});

form.addEventListener('input', load);
await load();

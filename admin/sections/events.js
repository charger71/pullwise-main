// Events: the Community Calendar (signings, release parties, tournaments…).

import { refreshEventAlerts, newEventSignups } from '../event-alerts.js';
import { $, esc, must, toast, openDialog, imageField, makeEditor, setHtml, getHtml, setStatus, toLocalInput, fromLocalInput, fmtDateTime, sortableTable, formatPhone, solidIcon, friendlyError, fetchAll, listLocations, hintFold } from '../lib.js';

const TYPES = { release_party: 'Release party', signing: 'Signing', tournament: 'Tournament', livestream: 'Livestream', comic_con: 'Comic Con', sale: 'Sale', other: 'Other' };
const REPEATS = { none: 'Does not repeat', daily: 'Every day', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month, same date (like the 15th)', monthlyweekday: 'Every month, same weekday (like the 2nd Friday)' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_REPEATS = 60; // dates in one series

/** Which of its weekday a date is in its month: 1–4, or 5 for the last one. */
const nthWeekday = (d) => (d.getDate() + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() ? 5 : Math.ceil(d.getDate() / 7));

/**
 * Start times of a repeating event: the first date, then each match up to and including the `until` day (local time, so
 * the clock time holds across daylight saving). `days` are the weekdays (0 = Sunday) for the weekly choices; none means
 * the first date's own weekday. The first date is always included.
 */
export function occurrences(start, repeat, until, days = []) {
  const first = new Date(start);
  const last = new Date(until);
  last.setHours(23, 59, 59, 999);
  const out = [first];
  const on = days.length ? days : [first.getDay()];
  const weekStart = new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay()); // the Sunday of the first week
  const at = (y, m, day) => new Date(y, m, day, first.getHours(), first.getMinutes());
  for (let i = 1; out.length < MAX_REPEATS && i < 4000; i++) {
    let d;
    if (repeat === 'daily') d = at(first.getFullYear(), first.getMonth(), first.getDate() + i);
    else if (repeat === 'weekly' || repeat === 'biweekly') {
      d = at(first.getFullYear(), first.getMonth(), first.getDate() + i);
      const weeks = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()) - weekStart) / 6048e5);
      if (!on.includes(d.getDay()) || weeks % (repeat === 'biweekly' ? 2 : 1)) { if (d > last) break; continue; }
    } else if (repeat === 'monthly') {
      d = at(first.getFullYear(), first.getMonth() + i, first.getDate());
      if (d.getDate() !== first.getDate()) { if (d > last) break; continue; } // a month without that date (the 31st): skip it
    } else if (repeat === 'monthlyweekday') {
      const n = nthWeekday(first);
      const m = new Date(first.getFullYear(), first.getMonth() + i, 1);
      const offset = (first.getDay() - m.getDay() + 7) % 7;
      let day = 1 + offset + (n === 5 ? 0 : (n - 1) * 7);
      if (n === 5) while (day + 7 <= new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) day += 7; // the last one
      else if (day > new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) continue;
      d = at(m.getFullYear(), m.getMonth(), day);
    } else break;
    if (d > last) break;
    out.push(d);
  }
  return out;
}

let sb;
let showPast = false;
let showSignupsTab = false;
let showCalendarTab = false;
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // the month the Calendar tab shows

export async function mount(el, ctx) {
  sb = ctx.sb;
  showList(el);
}

function showList(el) {
  try {
    // Remembers the last tab; the Dashboard's Needs Attention "View" sets it to 'signups' to open Event Signups.
    const tab = sessionStorage.getItem('admin-events-past');
    showPast = tab === '1';
    showSignupsTab = tab === 'signups';
    showCalendarTab = tab === 'calendar';
  } catch {
    /* start on Upcoming */
  }
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Events</h1>
      <button class="btn btn--add" type="button" data-new>${solidIcon('add', 18)} New event</button>
    </div>
    ${hintFold('Events show on the website’s Events page. <strong>Upcoming</strong> lists what’s ahead and <strong>Past</strong> the ones that are over; open one to edit it. <strong>Calendar</strong> shows a month at a time: drag an event to another day to move it. <strong>Event Signups</strong> lists everyone who signed up for an event, and new signups carry a badge until you’ve seen them.')}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-past="0">Upcoming</button>
      <button type="button" class="admin-tab" role="tab" data-past="1">Past</button>
      <button type="button" class="admin-tab" role="tab" data-past="calendar">Calendar</button>
      <button type="button" class="admin-tab" role="tab" data-past="signups">Event Signups${newEventSignups() ? ` <span class="admin-tab__badge" data-unread>${newEventSignups()}<span class="visually-hidden"> new</span></span>` : ''}</button>
    </div>
    <div data-list></div>`;
  el.querySelectorAll('[data-past]').forEach((b) => b.addEventListener('click', () => ((showSignupsTab = b.dataset.past === 'signups'), (showCalendarTab = b.dataset.past === 'calendar'), (showPast = b.dataset.past === '1'), remember(), load(el))));
  $('[data-new]', el).addEventListener('click', () => edit(el, null));
  $('[data-list]', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) edit(el, Number(b.dataset.edit));
  });
  load(el);
}

function remember() {
  try {
    sessionStorage.setItem('admin-events-past', showSignupsTab ? 'signups' : showCalendarTab ? 'calendar' : showPast ? '1' : '0');
  } catch {
    /* remembering the tab is optional */
  }
}

async function load(el) {
  const current = showSignupsTab ? 'signups' : showCalendarTab ? 'calendar' : showPast ? '1' : '0';
  el.querySelectorAll('[data-past]').forEach((b) => b.setAttribute('aria-selected', b.dataset.past === current));
  $('[data-new]', el).hidden = showSignupsTab;
  if (showSignupsTab) return loadAllSignups($('[data-list]', el));
  if (showCalendarTab) return loadCalendar(el);
  const now = new Date().toISOString();
  const q = sb.from('events').select('*');
  const locations = await listLocations(sb); // [] unless the shop has 2+ locations
  const placeOf = (e) => [locations.length ? (e.location_id === null ? 'All locations' : locations.find((l) => l.id === e.location_id)?.name) : null, e.location].filter(Boolean).join(' — ');
  const { data, error } = await (showPast ? q.lt('starts_at', now).order('starts_at', { ascending: false }).limit(100) : q.gte('starts_at', now).order('starts_at'));
  const box = $('[data-list]', el);
  if (error) return (box.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
  box.innerHTML = data.length
    ? `<table class="admin-table cards"><thead><tr><th scope="col" data-sort="text">When</th><th scope="col" data-sort="text">Event</th><th scope="col" data-sort="text">Type</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead><tbody>${data
        .map((e) => `<tr>
          <td class="nowrap" data-sort="${esc(e.starts_at)}">${fmtDateTime(e.starts_at)}</td>
          <td class="card-title"><strong>${esc(e.title)}</strong>${e.cancelled_at ? ' <span class="pill pill--cancelled">Cancelled</span>' : ''}${e.series_id ? ' <span class="pill pill--info">Repeats</span>' : ''}${placeOf(e) ? `<br><span class="card__meta">${esc(placeOf(e))}</span>` : ''}</td>
          <td>${TYPES[e.event_type] ?? e.event_type}</td>
          <td class="card-action"><button class="btn btn--ghost btn--small" type="button" data-edit="${e.id}">${solidIcon('edit', 16)} Edit<span class="visually-hidden"> ${esc(e.title)}</span></button>
          </td>
          </tr>`)
        .join('')}</tbody></table>`
    : `<p class="empty">${showPast ? 'No past events.' : 'No upcoming events — add one so it shows on the calendar and the home page.'}</p>`;
  if (data.length) sortableTable($('table', box));
}

/** The edit form. `template` pre-fills a new event (Copy event, or Add on a day of the Calendar tab). */
/** The Calendar tab: one month, with each event on its day. Drag an event to another day to move it (same time of day). */
async function loadCalendar(el) {
  const box = $('[data-list]', el);
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const total = new Date(y, m + 1, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  const key = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  let rows;
  try {
    rows = await must(sb.from('events').select('id,title,event_type,starts_at,ends_at,cancelled_at,series_id,signup_enabled').gte('starts_at', new Date(y, m, 1).toISOString()).lt('starts_at', new Date(y, m + 1, 1).toISOString()).order('starts_at'));
  } catch (err) {
    return (box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`);
  }
  const cells = [];
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cells.push('<li class="admin-cal__day admin-cal__day--blank" aria-hidden="true"></li>');
  const todayKey = key(new Date().toISOString());
  for (let d = 1; d <= total; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const here = rows.filter((e) => key(e.starts_at) === k);
    const label = new Date(y, m, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    cells.push(`<li class="admin-cal__day${here.length ? ' admin-cal__day--has' : ''}${k === todayKey ? ' admin-cal__day--today' : ''}" data-day="${k}">
      <div class="admin-cal__head"><span class="admin-cal__num"><span class="admin-cal__label">${esc(label)}</span><span class="admin-cal__digit" aria-hidden="true">${d}</span></span>
        <button class="icon-btn admin-cal__add" type="button" data-add-day="${k}" aria-label="Add an event on ${esc(label)}" title="Add an event">${solidIcon('add', 18)}</button></div>
      <ul class="admin-cal__events">${here.map((e) => `<li><button class="admin-cal__chip${e.cancelled_at ? ' admin-cal__chip--cancelled' : ''}" type="button" draggable="true" data-edit="${e.id}" data-move="${e.id}" title="${esc(`${e.title} · ${TYPES[e.event_type] ?? e.event_type}${e.cancelled_at ? ' · Cancelled' : ''}${e.series_id ? ' · Repeats' : ''}`)}"><span class="admin-cal__time">${esc(new Date(e.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</span> ${esc(e.title)}${e.cancelled_at ? '<span class="visually-hidden"> (cancelled)</span>' : ''}</button></li>`).join('')}</ul>
    </li>`);
  }
  const title = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  box.innerHTML = `<div class="admin-cal">
    <div class="admin-cal__nav">
      <button class="btn btn--ghost btn--small" type="button" data-cal-month="-1" aria-label="Previous month">← Prev</button>
      <h2 class="admin-cal__title">${esc(title)}</h2>
      <button class="btn btn--ghost btn--small" type="button" data-cal-month="1" aria-label="Next month">Next →</button>
    </div>
    <p class="admin-cal__today"><button class="btn btn--ghost btn--small" type="button" data-cal-month="0">This month</button></p>
    <ul class="admin-cal__weekdays" aria-hidden="true">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<li>${w}</li>`).join('')}</ul>
    <ol class="admin-cal__grid">${cells.join('')}</ol>
    <p class="admin-hint">${rows.length ? '' : 'No events this month. '}Drag an event to another day to move it; its time stays the same. Press + on a day to add one.</p>
  </div>`;
  if (box.dataset.calWired) return;
  box.dataset.calWired = '1';
  box.addEventListener('click', (e) => {
    const step = e.target.closest('[data-cal-month]');
    if (step) {
      const n = Number(step.dataset.calMonth);
      calMonth = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1);
      return loadCalendar(el);
    }
    const add = e.target.closest('[data-add-day]');
    if (add) {
      const [yy, mm, dd] = add.dataset.addDay.split('-').map(Number);
      return edit(el, null, { starts_at: new Date(yy, mm - 1, dd, 18, 0).toISOString() });
    }
  });
  let dragging = null;
  box.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('[data-move]');
    if (!chip) return;
    dragging = Number(chip.dataset.move);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragging));
  });
  box.addEventListener('dragover', (e) => {
    const day = e.target.closest('[data-day]');
    if (!day || dragging === null) return;
    e.preventDefault();
    box.querySelectorAll('.is-over').forEach((n) => n !== day && n.classList.remove('is-over'));
    day.classList.add('is-over');
  });
  box.addEventListener('dragend', () => {
    dragging = null;
    box.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
  });
  box.addEventListener('drop', async (e) => {
    const day = e.target.closest('[data-day]');
    const id = dragging;
    dragging = null;
    box.querySelectorAll('.is-over').forEach((n) => n.classList.remove('is-over'));
    if (!day || id === null) return;
    e.preventDefault();
    try {
      const ev = await must(sb.from('events').select('id,title,starts_at,ends_at,signup_enabled').eq('id', id).single());
      const [yy, mm, dd] = day.dataset.day.split('-').map(Number);
      const from = new Date(ev.starts_at);
      const to = new Date(yy, mm - 1, dd, from.getHours(), from.getMinutes());
      if (to.getTime() === from.getTime()) return;
      const { count } = ev.signup_enabled ? await sb.from('event_signups').select('id', { count: 'exact', head: true }).eq('event_id', id) : { count: 0 };
      if (count && !confirm(`${count} ${count === 1 ? 'person is' : 'people are'} signed up for “${ev.title}”. They aren’t told when you move it. Move it anyway?`)) return;
      const ends = ev.ends_at ? new Date(to.getTime() + (new Date(ev.ends_at) - from)).toISOString() : null;
      await must(sb.from('events').update({ starts_at: to.toISOString(), ends_at: ends, reminder_sent_at: null }).eq('id', id));
      toast(`Moved to ${to.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
      loadCalendar(el);
    } catch (err) {
      toast(`Not moved: ${friendlyError(err)}`, 'error');
    }
  });
}

async function edit(listEl, id, template = null) {
  const ev = id ? await must(sb.from('events').select('*').eq('id', id).single()) : { event_type: 'other', ...template };
  const locations = await listLocations(sb); // [] unless the shop has 2+ locations
  const d = listEl;
  const back = () => showList(listEl);
  d.innerHTML = `
    <p class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-back>← Back to events</button>
      ${id && ev.signup_enabled ? '<button class="btn btn--blue btn--small" type="button" data-signups>View signups</button>' : ''}
      ${id ? `<button class="btn btn--ghost btn--small" type="button" data-copy-event>Copy event</button>` : ''}
      ${id ? (ev.cancelled_at ? '<button class="btn btn--green btn--small" type="button" data-restore>Restore event</button>' : '<button class="btn btn--ghost btn--small" type="button" data-cancel-event>Cancel event</button>') : ''}</p>
    ${ev.cancelled_at ? '<p class="notice" role="status">This event is cancelled. It still shows on the calendar marked Cancelled, and signups are closed.</p>' : ''}
    <h1>${id ? 'Edit Event' : 'New Event'}</h1>
    <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Event Details</h2></div><div class="fold__body">
    <form class="admin-form" novalidate>
      <div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="ev-title">Title <span class="req" aria-hidden="true">*</span></label><input id="ev-title" name="title" required value="${esc(ev.title)}"></div>
        <div class="field"><label for="ev-type">Type</label><select id="ev-type" name="event_type">${Object.entries(TYPES).map(([v, l]) => `<option value="${v}"${v === ev.event_type ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${locations.length ? `<div class="field"><label for="ev-store">Location</label><select id="ev-store" name="location_id"><option value="">All locations</option>${locations.map((l) => `<option value="${l.id}"${l.id === ev.location_id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label for="ev-loc">${locations.length ? 'Where in the store (optional)' : 'Location'}</label><input id="ev-loc" name="location" placeholder="${locations.length ? 'e.g. back room' : 'In store'}" value="${esc(ev.location)}"></div>
        <div class="field"><label for="ev-start">Starts <span class="req" aria-hidden="true">*</span></label><input id="ev-start" name="starts_at" type="datetime-local" required value="${toLocalInput(ev.starts_at)}"></div>
        <div class="field"><label for="ev-end">Ends (optional)</label><input id="ev-end" name="ends_at" type="datetime-local" value="${toLocalInput(ev.ends_at)}"></div>
        ${id ? '' : `<div class="field"><label for="ev-repeat">Repeats</label><select id="ev-repeat" name="repeat">${Object.entries(REPEATS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="field span-2" data-days hidden><span class="label" id="ev-days-label">On these days (the start date is always included)</span><div class="checks" role="group" aria-labelledby="ev-days-label">${WEEKDAYS.map((w, i) => `<label><input type="checkbox" name="days" value="${i}"> ${w}</label>`).join('')}</div></div>
        <div class="field" data-until hidden><label for="ev-until">Repeat until <span class="req" aria-hidden="true">*</span></label><input id="ev-until" name="until" type="date"><p class="field__hint">Up to ${MAX_REPEATS} dates. Each date is its own event, so you can edit or delete one without touching the rest.</p></div>`}
        <div class="field span-2"><label for="ev-summary">Short description</label><textarea id="ev-summary" name="summary" rows="2" maxlength="300">${esc(ev.summary)}</textarea>
          <p class="field__hint">One or two sentences, shown on the Calendar page next to a “More details” link. Leave it blank to show the start of the full description instead.</p></div>
        <div class="field span-2"><span class="label" id="ev-desc-label">Full description</span><div class="editor--body"><div data-desc></div></div></div>
        <div class="field span-2" data-image></div>
        <div class="checks span-2"><label><input name="signup_enabled" type="checkbox"${ev.signup_enabled ? ' checked' : ''}> Show a signup form on the event page</label></div>
        <div class="checks span-2"><label><input name="send_reminder" type="checkbox"${ev.send_reminder === false ? '' : ' checked'}> Email signed-up customers a reminder the day before</label></div>
        <div class="field"><label for="ev-cap">Spots available (optional)</label><input id="ev-cap" name="signup_capacity" type="number" min="1" max="1000" value="${esc(ev.signup_capacity)}"><p class="field__hint">Counts people, not signups. Leave blank for no limit. Reminders go out about 24 hours before the event starts (between 8am and 8pm), once, and only when the box above is checked.</p></div>
      </div>
      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">${id ? (ev.series_id ? 'Save this date only' : 'Save') : 'Add event'}</button>
        ${id && ev.series_id ? '<button class="btn btn--ghost" type="submit" data-apply-later>Save and apply to all future dates</button>' : ''}
        ${id ? `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>` : ''}
        ${id && ev.series_id ? `<button class="btn btn--danger" type="button" data-delete-later>${solidIcon('trash', 16)} Delete this and future dates</button>` : ''}
        <span class="admin-status" role="status"></span>
      </div>
      ${id && ev.series_id ? '<p class="field__hint">This event is part of a repeating series. “Save and apply to all future dates” carries the details, photo, signup settings and time of day to every future date; each date keeps its own signups.</p>' : ''}
    </form>
    </div></section>`;
  window.scrollTo(0, 0);
  $('[data-back]', d).addEventListener('click', back);
  const quill = makeEditor($('[data-desc]', d), 'body', $('#ev-desc-label', d));
  setHtml(quill, ev.description);
  const image = imageField($('[data-image]', d), { folder: 'events', label: 'Photo (optional)', maxSize: 1600 });
  image.set(ev.image_url);
  const form = $('form', d);
  const repeatSel = $('#ev-repeat', d);
  repeatSel?.addEventListener('change', () => {
    $('[data-until]', d).hidden = repeatSel.value === 'none';
    $('[data-days]', d).hidden = !['weekly', 'biweekly'].includes(repeatSel.value);
  });
  const status = $('.admin-status', d);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const row = {
      title: f.get('title').trim(), event_type: f.get('event_type'), location: f.get('location').trim() || null,
      ...(f.has('location_id') ? { location_id: Number(f.get('location_id')) || null } : {}), // empty = every location
      starts_at: fromLocalInput(f.get('starts_at')), ends_at: fromLocalInput(f.get('ends_at')),
      summary: f.get('summary').trim() || null,
      signup_enabled: f.get('signup_enabled') === 'on', send_reminder: f.get('send_reminder') === 'on', signup_capacity: Number(f.get('signup_capacity')) || null, description: getHtml(quill), image_url: image.get(),
    };
    if (id && Date.parse(row.starts_at) !== Date.parse(ev.starts_at)) row.reminder_sent_at = null; // a new time gets its own reminder
    if (!row.title) return setStatus(status, 'Please enter a title.', 'error');
    if (!row.starts_at) return setStatus(status, 'Please choose when it starts.', 'error');
    if (row.ends_at && row.ends_at < row.starts_at) return setStatus(status, 'The end is before the start.', 'error');
    let rows = [row];
    if (!id && f.get('repeat') !== 'none') {
      if (!f.get('until')) return setStatus(status, 'Please choose the day the repeating stops.', 'error');
      const starts = occurrences(row.starts_at, f.get('repeat'), `${f.get('until')}T00:00`, f.getAll('days').map(Number));
      if (starts.length < 2) return setStatus(status, 'The repeat-until day is too soon for a second date.', 'error');
      const length = row.ends_at ? new Date(row.ends_at) - new Date(row.starts_at) : null;
      const series_id = crypto.randomUUID();
      rows = starts.map((st) => ({ ...row, series_id, starts_at: st.toISOString(), ends_at: length === null ? null : new Date(st.getTime() + length).toISOString() }));
    }
    setStatus(status, 'Saving…');
    try {
      await must(id ? sb.from('events').update(row).eq('id', id) : sb.from('events').insert(rows));
      let later = 0;
      if (id && ev.series_id && e.submitter?.hasAttribute('data-apply-later')) later = await updateLater(ev, row);
      toast(id ? (later ? `Event saved, and ${later} future ${later === 1 ? 'date' : 'dates'}` : 'Event saved') : rows.length > 1 ? `${rows.length} events created` : 'Event created');
      back();
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-signups]', d)?.addEventListener('click', () => showSignups(listEl, ev));
  $('[data-copy-event]', d)?.addEventListener('click', () => {
    const { id: _i, series_id: _s, cancelled_at: _c, reminder_sent_at: _r, starts_at: _a, ends_at: _b, created_at: _ca, updated_at: _u, ...copy } = ev;
    edit(listEl, null, copy);
  });
  $('[data-cancel-event]', d)?.addEventListener('click', async () => {
    const { count } = await sb.from('event_signups').select('id', { count: 'exact', head: true }).eq('event_id', id);
    if (!confirm(`Cancel “${ev.title}”? It stays on the calendar marked Cancelled and signups close.${count ? `\n\n${count} ${count === 1 ? 'signup' : 'signups'} will be emailed that it’s cancelled.` : ''}`)) return;
    try {
      await must(sb.from('events').update({ cancelled_at: new Date().toISOString() }).eq('id', id));
      toast('Event cancelled');
      back();
    } catch (err) {
      setStatus(status, `Not cancelled: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-restore]', d)?.addEventListener('click', async () => {
    if (!confirm(`Restore “${ev.title}”? It shows as on again and signups reopen. No email is sent.`)) return;
    try {
      await must(sb.from('events').update({ cancelled_at: null }).eq('id', id));
      toast('Event restored');
      back();
    } catch (err) {
      setStatus(status, `Not restored: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-delete-later]', d)?.addEventListener('click', async () => {
    if (!confirm(`Delete “${ev.title}” on ${fmtDateTime(ev.starts_at)} and every future date in this series? This can’t be undone.`)) return;
    try {
      await must(sb.from('events').delete().eq('series_id', ev.series_id).gte('starts_at', ev.starts_at));
      toast('Events deleted');
      back();
    } catch (err) {
      setStatus(status, `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-delete]', d)?.addEventListener('click', async () => {
    if (!confirm(`Delete “${ev.title}”? This can’t be undone.`)) return;
    try {
      await must(sb.from('events').delete().eq('id', id));
      toast('Event deleted');
      back();
    } catch (err) {
      setStatus(status, `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });
}

/** Carries an edited series date's shared fields to every later date of its series. The time of day follows too; the dates stay. Returns how many it changed. */
async function updateLater(ev, row) {
  const { starts_at: _s, ends_at: _e, reminder_sent_at: _r, ...shared } = row;
  const later = await must(sb.from('events').select('id,starts_at').eq('series_id', ev.series_id).gt('starts_at', ev.starts_at));
  const clock = new Date(row.starts_at);
  const length = row.ends_at ? new Date(row.ends_at) - clock : null;
  for (const l of later) {
    const day = new Date(l.starts_at);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.getHours(), clock.getMinutes());
    await must(sb.from('events').update({ ...shared, starts_at: start.toISOString(), ends_at: length === null ? null : new Date(start.getTime() + length).toISOString() }).eq('id', l.id));
  }
  return later.length;
}

/** The signups table (with email and remove buttons) for one event's rows. */
function signupsTable(rows) {
  return `<table class="admin-table cards"><thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">People</th><th scope="col">Notes</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead><tbody>${rows
      .map((r) => `<tr>
        <td class="card-title">${esc(r.name)}${r.seen ? '' : ' <span class="pill pill--new">New</span>'}</td>
        <td class="nowrap card-line">${esc(formatPhone(r.phone))}</td>
        <td class="card-foot"><button type="button" class="btn btn--ghost btn--small cust-email" title="Write an email to ${esc(r.email)}" aria-label="Email ${esc(r.name)}" data-email-to="${esc(r.email)}" data-email-name="${esc(r.name)}">Email</button>
        </td>
        <td class="card-key card-label">${r.party_size}</td>
        <td class="card-wide">${esc(r.notes)}</td>
        <td class="card-foot"><button class="icon-btn icon-btn--remove" type="button" data-remove="${r.id}" aria-label="Remove ${esc(r.name)}'s signup" title="Remove signup">${solidIcon('remove')}</button>
        </td>
        </tr>`)
      .join('')}</tbody></table>`;
}

/** Looking at signups reads them: clear them from the counts (menu, tab, Dashboard). Best effort.
 *  `all` (the Event Signups tab) reads every new signup, including any for an event whose form was since turned off,
 *  which no screen lists. */
function markSeen(rows, { all = false } = {}) {
  const ids = rows.filter((r) => !r.seen).map((r) => r.id);
  if (!ids.length && !(all && newEventSignups())) return;
  (async () => {
    if (all) {
      const { error } = await sb.from('event_signups').update({ seen: true }).eq('seen', false);
      if (error) return;
    } else
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await sb.from('event_signups').update({ seen: true }).in('id', ids.slice(i, i + 100));
        if (error) return;
      }
    document.querySelector('[data-past="signups"] [data-unread]')?.remove();
    refreshEventAlerts();
  })();
}

/** Admin > Events > Event Signups: every event with a signup form, its signups under it. */
async function loadAllSignups(box) {
  box.innerHTML = '<p class="admin-hint" aria-busy="true">Loading…</p>';
  try {
    const events = await must(sb.from('events').select('id,title,starts_at,signup_capacity').eq('signup_enabled', true));
    // Only the listed events' signups, a page at a time (one request returns at most 1,000 rows).
    const signups = [];
    const ids = events.map((e) => e.id);
    for (let i = 0; i < ids.length; i += 100) signups.push(...(await fetchAll(() => sb.from('event_signups').select('*').in('event_id', ids.slice(i, i + 100)).order('created_at').order('id'))));
    const now = new Date().toISOString();
    const byEvent = new Map(events.map((e) => [e.id, []]));
    for (const r of signups) byEvent.get(r.event_id)?.push(r);
    // Upcoming events first (soonest first), then past ones (most recent first).
    events.sort((a, b) => ((a.starts_at >= now) === (b.starts_at >= now) ? (a.starts_at >= now ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at)) : a.starts_at >= now ? -1 : 1));
    box.innerHTML = events.length
      ? events
          .map((e) => {
            const rows = byEvent.get(e.id);
            const people = rows.reduce((n, r) => n + r.party_size, 0);
            const fresh = rows.filter((r) => !r.seen).length;
            return `<details class="fold fold--compact" data-event="${e.id}"${rows.length ? ' open' : ''}>
              <summary class="fold__head"><h2>${esc(e.title)}<span class="fold__note">${fmtDateTime(e.starts_at)} · ${rows.length} ${rows.length === 1 ? 'signup' : 'signups'} · ${people} ${people === 1 ? 'person' : 'people'}${e.signup_capacity ? ` of ${e.signup_capacity} spots` : ''}${fresh ? ` · ${fresh} new` : ''}</span></h2></summary>
              <div class="fold__body">${rows.length ? signupsTable(rows) : '<p class="empty">No one has signed up yet.</p>'}</div>
            </details>`;
          })
          .join('')
      : '<p class="empty">No events have a signup form. Turn on “Show a signup form on the event page” when editing an event.</p>';
    markSeen(signups, { all: true });
    if (!box.dataset.wired) {
      box.dataset.wired = '1';
      box.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-remove]');
        if (!b || !confirm('Remove this signup?')) return;
        try {
          await must(sb.from('event_signups').delete().eq('id', b.dataset.remove));
          toast('Signup removed');
          loadAllSignups(box);
        } catch (err) {
          toast(`Not removed: ${friendlyError(err)}`);
        }
      });
    }
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
}

async function showSignups(el, ev) {
  const rows = await fetchAll(() => sb.from('event_signups').select('*').eq('event_id', ev.id).order('created_at').order('id'));
  const people = rows.reduce((n, r) => n + r.party_size, 0);
  el.innerHTML = `
    <p><button class="btn btn--ghost btn--small" type="button" data-back>← Back to event</button></p>
    <h1>Signups: ${esc(ev.title)}</h1>
    <p>${rows.length} signup${rows.length === 1 ? '' : 's'}, ${people} ${people === 1 ? 'person' : 'people'}${ev.signup_capacity ? ` of ${ev.signup_capacity} spots` : ''}.</p>
    <div data-signups-view>${rows.length ? signupsTable(rows) : '<p class="empty">No one has signed up yet.</p>'}</div>`;
  window.scrollTo(0, 0);
  markSeen(rows);
  $('[data-back]', el).addEventListener('click', () => edit(el, ev.id));
  // On an element of this view (not the section itself, which outlives it), so the handler goes when the view does.
  $('[data-signups-view]', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b || !confirm('Remove this signup?')) return;
    try {
      await must(sb.from('event_signups').delete().eq('id', b.dataset.remove));
      toast('Signup removed');
      showSignups(el, ev);
    } catch (err) {
      toast(`Not removed: ${friendlyError(err)}`);
    }
  });
}

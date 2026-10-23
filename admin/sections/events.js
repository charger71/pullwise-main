// Events: the Community Calendar (signings, release parties, tournaments…).

import { $, esc, must, toast, openDialog, imageField, makeEditor, setHtml, getHtml, setStatus, toLocalInput, fromLocalInput, fmtDateTime, sortableTable, formatPhone, solidIcon, friendlyError, fetchAll, listLocations } from '../lib.js';

const TYPES = { release_party: 'Release party', signing: 'Signing', tournament: 'Tournament', livestream: 'Livestream', comic_con: 'Comic Con', sale: 'Sale', other: 'Other' };
let sb;
let showPast = false;
let showSignupsTab = false;

export async function mount(el, ctx) {
  sb = ctx.sb;
  showList(el);
}

function showList(el) {
  try {
    const tab = sessionStorage.getItem('admin-events-past');
    showPast = tab === '1';
    showSignupsTab = tab === 'signups';
  } catch {
    /* start on Upcoming */
  }
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Events</h1>
      <button class="btn btn--add" type="button" data-new>${solidIcon('add', 18)} New event</button>
    </div>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-past="0">Upcoming</button>
      <button type="button" class="admin-tab" role="tab" data-past="1">Past</button>
      <button type="button" class="admin-tab" role="tab" data-past="signups">Event Signups</button>
    </div>
    <div data-list></div>`;
  el.querySelectorAll('[data-past]').forEach((b) => b.addEventListener('click', () => ((showSignupsTab = b.dataset.past === 'signups'), (showPast = b.dataset.past === '1'), remember(), load(el))));
  $('[data-new]', el).addEventListener('click', () => edit(el, null));
  $('[data-list]', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) edit(el, Number(b.dataset.edit));
  });
  load(el);
}

function remember() {
  try {
    sessionStorage.setItem('admin-events-past', showSignupsTab ? 'signups' : showPast ? '1' : '0');
  } catch {
    /* remembering the tab is optional */
  }
}

async function load(el) {
  const current = showSignupsTab ? 'signups' : showPast ? '1' : '0';
  el.querySelectorAll('[data-past]').forEach((b) => b.setAttribute('aria-selected', b.dataset.past === current));
  $('[data-new]', el).hidden = showSignupsTab;
  if (showSignupsTab) return loadAllSignups($('[data-list]', el));
  const now = new Date().toISOString();
  const q = sb.from('events').select('*');
  const locations = await listLocations(sb); // [] unless the shop has 2+ locations
  const placeOf = (e) => [locations.length ? (e.location_id === null ? 'All locations' : locations.find((l) => l.id === e.location_id)?.name) : null, e.location].filter(Boolean).join(' — ');
  const { data, error } = await (showPast ? q.lt('starts_at', now).order('starts_at', { ascending: false }).limit(100) : q.gte('starts_at', now).order('starts_at'));
  const box = $('[data-list]', el);
  if (error) return (box.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
  box.innerHTML = data.length
    ? `<table class="admin-table cards"><thead><tr><th scope="col" data-sort="text">When</th><th scope="col" data-sort="text">Event</th><th scope="col" data-sort="text">Type</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead><tbody>${data
        .map((e) => `<tr><td class="nowrap" data-sort="${esc(e.starts_at)}">${fmtDateTime(e.starts_at)}</td><td class="card-title"><strong>${esc(e.title)}</strong>${placeOf(e) ? `<br><span class="card__meta">${esc(placeOf(e))}</span>` : ''}</td><td>${TYPES[e.event_type] ?? e.event_type}</td><td class="card-action"><button class="btn btn--ghost btn--small" type="button" data-edit="${e.id}">${solidIcon('edit', 16)} Edit<span class="visually-hidden"> ${esc(e.title)}</span></button></td></tr>`)
        .join('')}</tbody></table>`
    : `<p class="empty">${showPast ? 'No past events.' : 'No upcoming events — add one so it shows on the calendar and the home page.'}</p>`;
  if (data.length) sortableTable($('table', box));
}

async function edit(listEl, id) {
  const ev = id ? await must(sb.from('events').select('*').eq('id', id).single()) : { event_type: 'other' };
  const locations = await listLocations(sb); // [] unless the shop has 2+ locations
  const d = listEl;
  const back = () => showList(listEl);
  d.innerHTML = `
    <p class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-back>← Back to events</button>
      ${id && ev.signup_enabled ? '<button class="btn btn--ghost btn--small" type="button" data-signups>View signups</button>' : ''}</p>
    <h1>${id ? 'Edit Event' : 'New Event'}</h1>
    <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Event Details</h2></summary><div class="fold__body">
    <form class="admin-form" novalidate>
      <div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="ev-title">Title <span class="req" aria-hidden="true">*</span></label><input id="ev-title" name="title" required value="${esc(ev.title)}"></div>
        <div class="field"><label for="ev-type">Type</label><select id="ev-type" name="event_type">${Object.entries(TYPES).map(([v, l]) => `<option value="${v}"${v === ev.event_type ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${locations.length ? `<div class="field"><label for="ev-store">Location</label><select id="ev-store" name="location_id"><option value="">All locations</option>${locations.map((l) => `<option value="${l.id}"${l.id === ev.location_id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label for="ev-loc">${locations.length ? 'Where in the store (optional)' : 'Location'}</label><input id="ev-loc" name="location" placeholder="${locations.length ? 'e.g. back room' : 'In store'}" value="${esc(ev.location)}"></div>
        <div class="field"><label for="ev-start">Starts <span class="req" aria-hidden="true">*</span></label><input id="ev-start" name="starts_at" type="datetime-local" required value="${toLocalInput(ev.starts_at)}"></div>
        <div class="field"><label for="ev-end">Ends (optional)</label><input id="ev-end" name="ends_at" type="datetime-local" value="${toLocalInput(ev.ends_at)}"></div>
        <div class="field span-2"><label for="ev-summary">Short description</label><textarea id="ev-summary" name="summary" rows="2" maxlength="300">${esc(ev.summary)}</textarea>
          <p class="field__hint">One or two sentences, shown on the Calendar page next to a “More details” link. Leave it blank to show the start of the full description instead.</p></div>
        <div class="field span-2"><span class="label" id="ev-desc-label">Full description</span><div class="editor--body"><div data-desc></div></div></div>
        <div class="field span-2" data-image></div>
        <div class="checks span-2"><label><input name="signup_enabled" type="checkbox"${ev.signup_enabled ? ' checked' : ''}> Show a signup form on the event page</label></div>
        <div class="field"><label for="ev-cap">Spots available (optional)</label><input id="ev-cap" name="signup_capacity" type="number" min="1" max="1000" value="${esc(ev.signup_capacity)}"><p class="field__hint">Counts people, not signups. Leave blank for no limit.</p></div>
      </div>
      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">${id ? 'Save' : 'Add event'}</button>
        ${id ? `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>` : ''}
        <span class="admin-status" role="status"></span>
      </div>
    </form>
    </div></details>`;
  window.scrollTo(0, 0);
  $('[data-back]', d).addEventListener('click', back);
  const quill = makeEditor($('[data-desc]', d), 'body', $('#ev-desc-label', d));
  setHtml(quill, ev.description);
  const image = imageField($('[data-image]', d), { folder: 'events', label: 'Photo (optional)', maxSize: 1600 });
  image.set(ev.image_url);
  const form = $('form', d);
  const status = $('.admin-status', d);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const row = {
      title: f.get('title').trim(), event_type: f.get('event_type'), location: f.get('location').trim() || null,
      ...(f.has('location_id') ? { location_id: Number(f.get('location_id')) || null } : {}), // empty = every location
      starts_at: fromLocalInput(f.get('starts_at')), ends_at: fromLocalInput(f.get('ends_at')),
      summary: f.get('summary').trim() || null,
      signup_enabled: f.get('signup_enabled') === 'on', signup_capacity: Number(f.get('signup_capacity')) || null, description: getHtml(quill), image_url: image.get(),
    };
    if (!row.title) return setStatus(status, 'Please enter a title.', 'error');
    if (!row.starts_at) return setStatus(status, 'Please choose when it starts.', 'error');
    if (row.ends_at && row.ends_at < row.starts_at) return setStatus(status, 'The end is before the start.', 'error');
    setStatus(status, 'Saving…');
    try {
      await must(id ? sb.from('events').update(row).eq('id', id) : sb.from('events').insert(row));
      toast(id ? 'Event saved' : 'Event created');
      back();
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-signups]', d)?.addEventListener('click', () => showSignups(listEl, ev));
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

/** The signups table (with email and remove buttons) for one event's rows. */
function signupsTable(rows) {
  return `<table class="admin-table cards"><thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">People</th><th scope="col">Notes</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead><tbody>${rows
      .map((r) => `<tr><td class="card-title">${esc(r.name)}</td><td class="nowrap card-line">${esc(formatPhone(r.phone))}</td><td class="card-foot"><button type="button" class="btn btn--ghost btn--small cust-email" title="Write an email to ${esc(r.email)}" aria-label="Email ${esc(r.name)}" data-email-to="${esc(r.email)}" data-email-name="${esc(r.name)}">Email</button></td><td class="card-key card-label">${r.party_size}</td><td class="card-wide">${esc(r.notes)}</td><td class="card-foot"><button class="icon-btn icon-btn--remove" type="button" data-remove="${r.id}" aria-label="Remove ${esc(r.name)}'s signup" title="Remove signup">${solidIcon('remove')}</button></td></tr>`)
      .join('')}</tbody></table>`;
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
            return `<details class="fold toorder" data-event="${e.id}"${rows.length ? ' open' : ''}>
              <summary class="fold__head"><h2>${esc(e.title)}<span class="toorder__count">${fmtDateTime(e.starts_at)} · ${rows.length} ${rows.length === 1 ? 'signup' : 'signups'} · ${people} ${people === 1 ? 'person' : 'people'}${e.signup_capacity ? ` of ${e.signup_capacity} spots` : ''}</span></h2></summary>
              <div class="fold__body">${rows.length ? signupsTable(rows) : '<p class="empty">No one has signed up yet.</p>'}</div>
            </details>`;
          })
          .join('')
      : '<p class="empty">No events have a signup form. Turn on “Show a signup form on the event page” when editing an event.</p>';
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

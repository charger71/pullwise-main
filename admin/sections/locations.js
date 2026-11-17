// Locations: the shop's pickup locations (owners only). A shop with one location edits its address and hours in
// Shop Settings, which keeps that location in step; once there are two or more, each is edited here.

import { $, $$, esc, must, toast, setStatus, solidIcon, friendlyError, hintSlot, setHint, isPhone, uid } from '../lib.js';
import { holidayEditor } from '../holiday-hours.js';

const DAYS = [['Mo', 'Mon'], ['Tu', 'Tue'], ['We', 'Wed'], ['Th', 'Thu'], ['Fr', 'Fri'], ['Sa', 'Sat'], ['Su', 'Sun']];

let cards = []; // { el, dirty }
export const hasUnsavedChanges = () => cards.some((c) => c.dirty);

export async function mount(el, { sb }) {
  cards = [];
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Locations</h1>
      <button class="btn btn--add" type="button" data-add>${solidIcon('add', 18)} Add a location</button>
    </div>
    ${hintSlot()}
    <div data-list></div>`;
  const list = $('[data-list]', el);
  let rows;
  try {
    rows = await must(sb.from('locations').select('*').order('id'));
  } catch (err) {
    list.innerHTML = `<p class="form-error">Couldn’t load the locations: ${esc(friendlyError(err))}</p>`;
    return;
  }
  const shared = rows.length === 1; // a lone location mirrors Shop Settings
  setHint(el, shared
    ? 'This shop has one location, so its address and hours are edited in <a href="#settings">Shop Settings</a>. Add a second location and each one is edited here. Customers then choose which one they pick up at.'
    : 'Customers choose which location they pick up at. Their emails show that location’s address and hours.');
  rows.forEach((l) => addCard(sb, list, l, { locked: shared, remount: () => mount(el, { sb }) }));
  $('[data-add]', el).addEventListener('click', () => {
    if (cards.some((c) => !c.id)) return;
    const card = addCard(sb, list, { id: null, name: '', country: 'US', hours: [], holiday_hours: [] }, { locked: false, remount: () => mount(el, { sb }) });
    card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('input', card.el).focus();
  });
}

function addCard(sb, list, l, { locked, remount }) {
  const el = document.createElement('details');
  el.className = 'fold fold--compact';
  el.open = !l.id || !isPhone();
  const n = uid('f');
  const input = (key, label, extra = '', cls = '') => `<div class="field${cls}"><label for="${key}-${n}">${label}</label><input id="${key}-${n}" name="${key}" maxlength="200" value="${esc(l[key])}"${extra}></div>`;
  const dis = locked ? ' disabled' : '';
  const where = [l.street, l.city].filter(Boolean).join(', ');
  el.innerHTML = `
    <summary class="fold__head"><h2>${l.id ? esc(l.name) : 'New location'}${l.is_default ? '<span class="fold__note">First location</span>' : where ? `<span class="fold__note">${esc(where)}</span>` : ''}</h2></summary>
    <div class="fold__body">
    <form novalidate>
      <div class="form-grid form-grid--pairs">
        ${input('name', 'Name (shown to customers, e.g. “Downtown”)', ` required${dis}`, ' span-2')}
        ${input('street', 'Street address', dis, ' span-2')}
        ${input('city', 'City', dis, ' span-2')}
        ${input('region', 'State', dis)}
        ${input('postal_code', 'Zip code', dis)}
        ${input('phone', 'Phone', dis, ' span-2')}
      </div>
      <fieldset class="account-fieldset"${dis}>
        <legend>Hours</legend>
        <div data-hours></div>
        ${locked ? '' : `<button class="btn btn--add btn--small" type="button" data-add-hours>${solidIcon('add', 16)} Add hours</button>`}
      </fieldset>
      <fieldset class="account-fieldset"${dis}>
        <legend>Holiday Hours</legend>
        <div data-holidays></div>
      </fieldset>
      <div class="form-grid form-grid--pairs">
        ${input('map_embed_url', 'Map embed link (optional)', dis, ' span-2')}
      </div>
      ${locked ? '' : `<div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">Save</button>
        ${l.id && !l.is_default ? `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>` : ''}
        <span class="admin-status" role="status"></span>
      </div>`}
    </form>
    </div>`;
  list.append(el);
  const card = { el, id: l.id, dirty: !l.id };
  cards.push(card);

  const hoursBox = $('[data-hours]', el);
  (l.hours ?? []).forEach((h) => addHours(hoursBox, h, locked, () => (card.dirty = true)));
  const holidays = holidayEditor($('[data-holidays]', el), l.holiday_hours, { locked, onChange: () => (card.dirty = true) });
  if (locked) return card;

  const form = $('form', el);
  const status = $('.admin-status', el);
  form.addEventListener('input', () => {
    card.dirty = true;
    setStatus(status, 'Unsaved changes');
  });
  $('[data-add-hours]', el).addEventListener('click', () => {
    addHours(hoursBox, { days: [], open: '11:00', close: '19:00' }, false, () => (card.dirty = true));
    card.dirty = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (k) => form.elements[k].value.trim() || null;
    if (!v('name')) return setStatus(status, 'Please enter a name.', 'error');
    const hours = $$('.hours-row', hoursBox).map((row) => ({
      days: $$('[data-day]:checked', row).map((c) => c.dataset.day),
      open: $('[data-open]', row).value,
      close: $('[data-close]', row).value,
    }));
    if (hours.some((h) => !h.days.length || !h.open || !h.close)) return setStatus(status, 'Each hours row needs at least one day and open/close times.', 'error');
    const holiday = holidays.read();
    if (holiday.error) return setStatus(status, holiday.error, 'error');
    const row = { name: v('name'), street: v('street'), city: v('city'), region: v('region'), postal_code: v('postal_code'), phone: v('phone'), map_embed_url: v('map_embed_url'), hours, holiday_hours: holiday.list, updated_at: new Date().toISOString() };
    const btn = $('[type=submit]', form);
    if (btn.disabled) return;
    btn.disabled = true;
    setStatus(status, 'Saving…');
    try {
      const saved = card.id
        ? await must(sb.from('locations').update(row).eq('id', card.id).select('id'))
        : await must(sb.from('locations').insert(row).select('id'));
      if (!saved?.length) throw new Error('Only a shop owner can change locations.');
      card.dirty = false;
      toast('Location saved');
      if (!card.id) return remount(); // the shop just went from one location to two: reload so the first becomes editable
      $('h2', el).firstChild.textContent = row.name;
      setStatus(status, 'Saved.', 'ok');
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $('[data-delete]', el)?.addEventListener('click', async () => {
    if (!confirm(`Delete the location “${l.name}”? This can’t be undone.`)) return;
    try {
      await must(sb.from('locations').delete().eq('id', card.id));
      toast('Location deleted');
      remount();
    } catch (err) {
      // A location customers, pickups or events still point at can't be removed.
      setStatus(status, /foreign key|violates/i.test(err?.message ?? '') ? 'Not deleted: customers or orders still use this location. Move them to another location first.' : `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });
  return card;
}

function addHours(box, h, locked, onChange) {
  const row = document.createElement('div');
  row.className = 'hours-row';
  const n = uid('f');
  const dis = locked ? ' disabled' : '';
  row.innerHTML = `
    <div class="hours-row__days" role="group" aria-label="Days">${DAYS.map(([d, label]) => `<label class="chip"><input type="checkbox" data-day="${d}"${h.days?.includes(d) ? ' checked' : ''}${dis}> ${label}</label>`).join('')}</div>
    <div class="field"><label for="open-${n}">Open</label><input id="open-${n}" type="time" data-open value="${esc(h.open)}"${dis}></div>
    <div class="field"><label for="close-${n}">Close</label><input id="close-${n}" type="time" data-close value="${esc(h.close)}"${dis}></div>
    ${locked ? '' : `<button class="btn btn--danger btn--small" type="button" aria-label="Remove these hours">${solidIcon('remove', 16)} Remove</button>`}`;
  $('button', row)?.addEventListener('click', () => {
    row.remove();
    onChange();
  });
  box.append(row);
}

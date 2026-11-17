// Holiday hours editor, shared by Shop Settings (one shop) and Locations (each location): one .holiday-row per date,
// with a "Closed all day" chip that turns the open and close times off. Past dates aren't shown, so they're dropped
// the next time the list is saved. The website lists the next HOLIDAY_LOOKAHEAD_DAYS days (js/holiday-hours.js).

import { $, $$, esc, uid, solidIcon } from './lib.js';
import { shopToday, addDays } from '../js/dates.js';
import { futureHolidays, tidyHoliday, HOLIDAY_LOOKAHEAD_DAYS } from '../js/holiday-hours.js';

export const HOLIDAY_HINT = `Dates when you keep different hours or are closed, such as Thanksgiving or Christmas Eve. They show under your opening hours on the website from ${HOLIDAY_LOOKAHEAD_DAYS} days before, and disappear once the day has passed.`;

/**
 * Fill `box` with the holiday rows for `list` and an "Add a date" button. `locked` shows them read-only.
 * Returns { read() }: { list } to save, or { error } to show.
 */
export function holidayEditor(box, list, { locked = false, onChange = () => {} } = {}) {
  box.innerHTML = `<div data-holiday-rows></div>
    ${locked ? '' : `<button class="btn btn--add btn--small mt-14" type="button" data-add-holiday>${solidIcon('add', 16)} Add a date</button>`}
    <p class="field__hint">${HOLIDAY_HINT}</p>`;
  const rows = $('[data-holiday-rows]', box);
  futureHolidays(list, shopToday()).forEach((h) => addRow(rows, h, locked, onChange));
  $('[data-add-holiday]', box)?.addEventListener('click', () => {
    // Start a day after the last one, so adding a run of dates (Dec 24, 25, 26) is quick.
    const last = $$('[data-date]', rows).map((i) => i.value).filter(Boolean).sort().at(-1);
    const row = addRow(rows, { date: last ? addDays(last, 1) : '', open: '11:00', close: '16:00', closed: true }, false, onChange);
    $('[data-date]', row).focus();
    onChange();
  });
  return {
    read() {
      const today = shopToday();
      const entries = $$('.holiday-row', rows).map((row) => ({
        date: $('[data-date]', row).value,
        label: $('[data-label]', row).value,
        closed: $('[data-closed]', row).checked,
        open: $('[data-open]', row).value,
        close: $('[data-close]', row).value,
      }));
      if (entries.some((h) => !h.date)) return { error: 'Each holiday row needs a date.' };
      if (entries.some((h) => !h.closed && (!h.open || !h.close))) return { error: 'Each holiday row needs open and close times, or “Closed all day” ticked.' };
      if (entries.some((h) => !h.closed && h.close <= h.open)) return { error: 'A holiday’s closing time must be after its opening time.' };
      const dates = entries.map((h) => h.date);
      const twice = dates.find((d, i) => dates.indexOf(d) !== i);
      if (twice) return { error: `${twice} is listed twice under holiday hours.` };
      return { list: futureHolidays(entries.map(tidyHoliday), today) };
    },
  };
}

function addRow(box, h, locked, onChange) {
  const row = document.createElement('div');
  row.className = 'holiday-row';
  const n = uid('hol');
  const dis = locked ? ' disabled' : '';
  const timeDis = locked || h.closed ? ' disabled' : '';
  row.innerHTML = `
    <div class="field"><label for="${n}-date">Date</label><input id="${n}-date" type="date" data-date min="${esc(shopToday())}" value="${esc(h.date)}"${dis}></div>
    <div class="field"><label for="${n}-label">Holiday (optional)</label><input id="${n}-label" type="text" data-label maxlength="60" placeholder="e.g. Christmas Day" value="${esc(h.label ?? '')}"${dis}></div>
    <label class="chip holiday-row__closed"><input type="checkbox" data-closed${h.closed ? ' checked' : ''}${dis}> Closed all day</label>
    <div class="field"><label for="${n}-open">Open</label><input id="${n}-open" type="time" data-open value="${esc(h.open ?? '11:00')}"${timeDis}></div>
    <div class="field"><label for="${n}-close">Close</label><input id="${n}-close" type="time" data-close value="${esc(h.close ?? '16:00')}"${timeDis}></div>
    ${locked ? '' : `<button class="btn btn--danger btn--small" type="button" aria-label="Remove this holiday">${solidIcon('remove', 16)} Remove</button>`}`;
  $('[data-closed]', row).addEventListener('change', (e) => {
    $$('[data-open], [data-close]', row).forEach((i) => (i.disabled = e.target.checked));
  });
  $('button', row)?.addEventListener('click', () => {
    row.remove();
    onChange();
  });
  box.append(row);
  return row;
}

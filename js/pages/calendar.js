import { initPage, $, esc, fmtDate, fmtTime, addressLines, EVENT_TYPES } from '../site.js';
import { getEvents, DEMO } from '../data.js';
import { SUPABASE_URL, SITE_URL } from '../config.js';
import { icsFor, googleLink, outlookLink } from '../ics.js';

const s = await initPage();
const where = [s.shop_name, ...addressLines(s)].join(', ');
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

async function load() {
  const { type, range } = Object.fromEntries(new FormData(form));
  const now = new Date().toISOString();
  events = await getEvents(range === 'past' ? { to: now, type } : { from: now, type });
  if (range === 'past') events.reverse();

  if (!events.length) {
    list.innerHTML = '<p class="empty">No events here yet — check back soon.</p>';
    return;
  }
  // The short description, or the start of the full one (plain text: the full text is on the event's page).
  const plain = (html) => String(html ?? '').replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const blurb = (e) => {
    if (e.summary?.trim()) return e.summary.trim();
    const text = plain(e.description);
    return text.length > 200 ? `${text.slice(0, 200).replace(/\s+\S*$/, '')}…` : text;
  };
  let lastMonth = '';
  list.innerHTML = events
    .map((e) => {
      const month = fmtDate(e.starts_at, { month: 'long', year: 'numeric' });
      const heading = month !== lastMonth ? `<h2 class="month-heading">${esc(month)}</h2>` : '';
      lastMonth = month;
      return `${heading}
        <article class="event">
          <div class="event__date" aria-hidden="true">
            <span class="event__month">${fmtDate(e.starts_at, { month: 'short' })}</span>
            <span class="event__day">${fmtDate(e.starts_at, { day: 'numeric' })}</span>
          </div>
          <div class="event__body${e.image_url ? ' event__body--img' : ''}">
            <div class="event__text">
            <span class="event__type">${esc(EVENT_TYPES[e.event_type] ?? 'Event')}</span>
            <h3><a href="event.html?id=${e.id}">${esc(e.title)}</a></h3>
            <p class="event__when">${fmtDate(e.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(e.starts_at)}${e.ends_at ? `–${fmtTime(e.ends_at)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</p>
            ${blurb(e) ? `<p class="event__summary">${esc(blurb(e))}</p>` : ''}
            <p class="event__more"><a href="event.html?id=${e.id}">More details →</a></p>
            <div class="event__actions">
              <span>Add to calendar:</span>
              <a href="#" data-ics="${e.id}">Apple / .ics</a>
              <a href="${esc(googleLink(e, where))}" target="_blank" rel="noopener">Google</a>
              <a href="${esc(outlookLink(e, where))}" target="_blank" rel="noopener">Outlook</a>
            </div>
            </div>
            ${e.image_url ? `<a class="event__photo" href="${esc(e.image_url)}" data-lightbox><img class="event__img" src="${esc(e.image_url)}" alt="${esc(e.title)}" loading="lazy"></a>` : ''}
          </div>
        </article>`;
    })
    .join('');
}

list.addEventListener('click', (ev) => {
  const link = ev.target.closest('[data-ics]');
  if (!link) return;
  ev.preventDefault();
  const e = events.find((x) => x.id === Number(link.dataset.ics));
  const blob = new Blob([icsFor(e, s.shop_name, host)], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${e.title.replace(/[^\w]+/g, '-')}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

form.addEventListener('input', load);
await load();

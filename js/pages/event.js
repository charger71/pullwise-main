// One event's detail page: event.html?id=…
import { initPage, $, esc, fmtDate, fmtTime, addressLines, EVENT_TYPES } from '../site.js';
import { getEvent, getEventSpotsTaken, signUpForEvent } from '../data.js';
import { SITE_URL } from '../config.js';
import { icsFor, googleLink, outlookLink } from '../ics.js';
import { renderRich } from '../content.js';
import { dayIn } from '../dates.js';
import { setPageMeta, snippet, htmlSnippet } from '../page-meta.js';

const s = await initPage();
const el = $('#event');
const id = Number(new URLSearchParams(location.search).get('id'));
// undefined = couldn't load (network, database), null = no such event.
const e = Number.isInteger(id) && id > 0 ? await getEvent(id).catch((err) => (console.error(err), undefined)) : null;
// Dates and times are the shop's, wherever the visitor is (an unknown zone falls back to the browser's).
const tz = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: s.timezone || undefined }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
})();

if (e === undefined) {
  setPageMeta({ title: `${s.shop_name} — Event`, noindex: true });
  el.innerHTML = `<h1>We Couldn't Load This Event</h1><p>Please check your connection and try again in a moment.</p><p><a href="calendar.html">← Calendar</a></p>`;
} else if (!e) {
  setPageMeta({ title: `${s.shop_name} — Event Not Found`, noindex: true });
  el.innerHTML = '<h1>Event Not Found</h1><p><a href="calendar.html">← Calendar</a></p>';
} else {
  setPageMeta({ title: `${s.shop_name} — ${e.title}`, description: snippet(e.summary) || htmlSnippet(e.description) });
  const where = [s.shop_name, ...addressLines(s)].join(', ');
  // The description comes from the admin editor: sanitized before showing.
  const description = await renderRich(e.description, s).catch((err) => (console.error(err), '<p>Sorry, the details couldn’t be shown right now. Please try again in a moment.</p>'));
  const long = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz };
  const dayKey = (iso) => dayIn(iso, tz);
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
  // Events entered as midnight to 11:59 PM (shop time) are all-day: show the dates, not the times.
  const allDay = e.ends_at && clock(e.starts_at) === '00:00' && clock(e.ends_at) === '23:59';
  const multiDay = e.ends_at && dayKey(e.ends_at) !== dayKey(e.starts_at);
  const when = allDay
    ? multiDay ? `${fmtDate(e.starts_at, long)} – ${fmtDate(e.ends_at, long)}` : fmtDate(e.starts_at, long)
    : multiDay ? `${fmtDate(e.starts_at, long)}, ${fmtTime(e.starts_at)} – ${fmtDate(e.ends_at, long)}, ${fmtTime(e.ends_at)}`
    : `${fmtDate(e.starts_at, long)} · ${fmtTime(e.starts_at)}${e.ends_at ? `–${fmtTime(e.ends_at)}` : ''}`;
  el.innerHTML = `
    <p><a href="calendar.html">← Calendar</a></p>
    ${e.image_url ? `<a href="${esc(e.image_url)}" data-lightbox><img class="event__img" src="${esc(e.image_url)}" alt="${esc(e.title)}"></a>` : ''}
    <span class="event__type">${esc(EVENT_TYPES[e.event_type] ?? 'Event')}</span>
    <h1>${esc(e.title)}</h1>
    <p class="event__when">${esc(when)}${e.location ? ` · ${esc(e.location)}` : ''}</p>
    ${description.trim() ? `<div class="page-body">${description}</div>` : ''}
    <div id="signup"></div>
    <div class="event__actions">
      <span>Add to calendar:</span>
      <a href="#" data-ics>Apple / .ics</a>
      <a href="${esc(googleLink(e, where))}" target="_blank" rel="noopener">Google</a>
      <a href="${esc(outlookLink(e, where))}" target="_blank" rel="noopener">Outlook</a>
    </div>`;
  $('[data-ics]', el).addEventListener('click', (ev) => {
    ev.preventDefault();
    const blob = new Blob([icsFor(e, s.shop_name, new URL(SITE_URL).host)], { type: 'text/calendar' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${e.title.replace(/[^\w]+/g, '-')}.ics` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  if (e.signup_enabled && new Date(e.ends_at ?? e.starts_at) > new Date()) mountSignup($('#signup', el), e);
}

async function mountSignup(box, e) {
  const taken = e.signup_capacity ? await getEventSpotsTaken(e.id) : 0;
  const left = e.signup_capacity ? Math.max(0, e.signup_capacity - (taken ?? 0)) : null;
  if (left === 0) return (box.innerHTML = '<div class="panel"><h2 style="margin-top:0">Sign up</h2><p>This event is full. Call the shop to be put on a waiting list.</p></div>');
  const max = Math.min(10, left ?? 10);
  box.innerHTML = `
    <form class="panel" id="signup-form" novalidate aria-labelledby="signup-h">
      <h2 id="signup-h" style="margin-top:0">Sign up</h2>
      ${left != null ? `<p>${left} spot${left === 1 ? '' : 's'} left.</p>` : ''}
      <div hidden aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <div class="field"><label for="su-name">Your name <span aria-hidden="true">*</span></label><input id="su-name" name="name" autocomplete="name" maxlength="100" required></div>
      <div class="field"><label for="su-email">Email <span aria-hidden="true">*</span></label><input id="su-email" name="email" type="email" autocomplete="email" maxlength="200" required></div>
      <div class="field"><label for="su-phone">Phone <span aria-hidden="true">*</span></label><input id="su-phone" name="phone" type="tel" autocomplete="tel" maxlength="40" required></div>
      <div class="field"><label for="su-party">Number of people</label><select id="su-party" name="party">${Array.from({ length: max }, (_, i) => `<option>${i + 1}</option>`).join('')}</select></div>
      <div class="field"><label for="su-notes">Notes (optional)</label><textarea id="su-notes" name="notes" rows="3" maxlength="500"></textarea></div>
      <p role="alert" id="su-err" style="color:var(--red-btn);font-weight:600"></p>
      <button class="btn btn--primary" type="submit">Sign up</button>
    </form>`;
  const form = $('#signup-form', box);
  const err = $('#su-err', form);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const f = form.elements;
    if (!f.name.value.trim()) return (err.textContent = 'Please enter your name.'), f.name.focus();
    if (!f.email.value.trim() || !f.email.validity.valid) return (err.textContent = 'Please enter a valid email address.'), f.email.focus();
    if (!f.phone.value.trim()) return (err.textContent = 'Please enter your phone number.'), f.phone.focus();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Signing up…';
    try {
      await signUpForEvent({ eventId: e.id, name: f.name.value, email: f.email.value, phone: f.phone.value, party: Number(f.party.value), notes: f.notes.value.trim(), website: f.website.value });
      form.innerHTML = `<h2 style="margin-top:0">You're signed up!</h2><p>Thanks, ${esc(f.name.value.trim())}. We'll see you at ${esc(e.title)}. Need to change something? Call the shop.</p>`;
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Sign up';
    }
  });
}

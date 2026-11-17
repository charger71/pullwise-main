import { initPage, $, esc, hoursList, addressLines, mapsHref, telHref, mapEmbed, socialIcons, locationAs } from '../site.js';
import { formatPhone } from '../util.js';

const s = await initPage();
const addr = addressLines(s);

/** Email, social links and the Whatnot stream: shared by every location. */
const touch = (heading) => `
  <h2${heading ? ' class="mt-1em"' : ''}>Get in Touch</h2>
  ${s.email ? `<p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>` : ''}
  ${socialIcons(s, { except: ['whatnot'] })}
  ${s.socials?.whatnot ? `<h2 class="mt-1em">Watch Us Live</h2><p>We stream on Whatnot — dollar-bin digs, new-release breaks and more.</p><p><a class="btn btn--primary" href="${esc(s.socials.whatnot)}" rel="noopener">Watch on Whatnot</a></p>` : ''}`;

if (s.locations?.length) {
  // Several locations: a card for each (address, phone, hours, its own map), then the shared contact details.
  const grid = $('#contact-info').parentElement;
  grid.className = 'locations-grid';
  grid.innerHTML =
    s.locations
      .map((l) => {
        const as = locationAs(s, l);
        const a = addressLines(l);
        return `<section class="panel location" aria-labelledby="loc-${l.id}">
          <h2 id="loc-${l.id}">${esc(l.name)}</h2>
          ${a.length ? `<address><a href="${esc(mapsHref(as))}">${a.map(esc).join('<br>')}</a></address>` : ''}
          ${l.phone ? `<p><a class="btn btn--ghost" href="${telHref(l.phone)}">Call ${esc(formatPhone(l.phone))}</a></p>` : ''}
          ${l.hours?.length ? `<h3>Hours</h3>${hoursList(l.hours, l.holiday_hours)}` : ''}
          ${mapEmbed(as, 'map map--small')}
        </section>`;
      })
      .join('') + `<div class="panel">${touch(false)}</div>`;
} else {
$('#contact-info').innerHTML = `
  ${addr.length ? `<h2>Address</h2><address><a href="${mapsHref(s)}">${addr.map(esc).join('<br>')}</a></address>` : ''}
  <h2>Hours</h2>
  ${hoursList(s.hours ?? [], s.holiday_hours)}
  <h2 class="mt-1em">Get in Touch</h2>
  ${s.phone ? `<p><a class="btn btn--ghost" href="${telHref(s.phone)}">Call ${esc(formatPhone(s.phone))}</a></p>` : ''}
  ${s.email ? `<p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>` : ''}
  ${socialIcons(s, { except: ['whatnot'] })}
  ${s.socials?.whatnot ? `<h2 class="mt-1em">Watch Us Live</h2><p>We stream on Whatnot — dollar-bin digs, new-release breaks and more.</p><p><a class="btn btn--primary" href="${esc(s.socials.whatnot)}" rel="noopener">Watch on Whatnot</a></p>` : ''}`;

const map = mapEmbed(s, 'map map--large');
if (map) {
  $('#map').innerHTML = map;
} else {
  // No map: let the contact details use the full width instead of half.
  $('#map').remove();
  $('#contact-info').parentElement.classList.add('info-grid--single');
}
}

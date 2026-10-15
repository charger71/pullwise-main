import { initPage, $, esc, hoursList, addressLines, mapsHref, telHref, mapEmbed, socialIcons } from '../site.js';
import { formatPhone } from '../util.js';

const s = await initPage();
const addr = addressLines(s);

$('#contact-info').innerHTML = `
  ${addr.length ? `<h2>Address</h2><address><a href="${mapsHref(s)}">${addr.map(esc).join('<br>')}</a></address>` : ''}
  <h2>Hours</h2>
  ${hoursList(s.hours ?? [])}
  <h2 style="margin-top:1em">Get in Touch</h2>
  ${s.phone ? `<p><a class="btn btn--ghost" href="${telHref(s.phone)}">Call ${esc(formatPhone(s.phone))}</a></p>` : ''}
  ${s.email ? `<p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>` : ''}
  ${socialIcons(s, { except: ['whatnot'] })}
  ${s.socials?.whatnot ? `<h2 style="margin-top:1em">Watch Us Live</h2><p>We stream on Whatnot — dollar-bin digs, new-release breaks and more.</p><p><a class="btn btn--primary" href="${esc(s.socials.whatnot)}" rel="noopener">Watch on Whatnot</a></p>` : ''}`;

const map = mapEmbed(s, 'map map--large');
if (map) {
  $('#map').innerHTML = map;
} else {
  // No map: let the contact details use the full width instead of half.
  $('#map').remove();
  $('#contact-info').parentElement.classList.add('info-grid--single');
}

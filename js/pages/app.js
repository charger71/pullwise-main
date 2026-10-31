// The shop's pull list app (app.html, served at /app; the Worker gives it the shop's install manifest). It's the
// account page (js/pages/account.js) shown one view at a time under a tab bar — My List, Following, Shop and
// Account — with the shop's brand on top, so the installed app is the shop's own. Tabs are #hash links, so the back
// button and links from outside (a notification) can open one. sw.js keeps the app opening without a connection.

import { $, esc, sizedImage, addressLines, hoursList, mapsHref, telHref, socialIcons, linkify, locationAs } from '../site.js';
import { getSettings } from '../data.js';
import { formatPhone, LOGO_WIDTH } from '../util.js';

const VIEWS = ['list', 'following', 'shop', 'me'];
const account = $('#account');

/** Show the view the address names (My List by default) and mark its tab. */
function showView({ focus = false } = {}) {
  const want = location.hash.slice(1);
  const view = VIEWS.includes(want) ? want : 'list';
  // Signed out (or still loading) there are no account views: the sign-in form stands in for all but Shop.
  for (const el of document.querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== view;
  account.hidden = view === 'shop';
  for (const a of document.querySelectorAll('.tab-bar [data-tab]')) {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (focus) {
    scrollTo(0, 0);
    const heading = $(`[data-view="${view}"] h2`);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}

addEventListener('hashchange', () => showView({ focus: true }));
// The account page draws its views after sign-in (and again after signing out and in): show the right one.
new MutationObserver(() => showView()).observe(account, { childList: true });
showView();

// ---------------------------------------------------------------------------
// Shop: who the app belongs to, how to reach it, and its website
// ---------------------------------------------------------------------------

/** One place's address, phone and hours. */
const placeHtml = (s, title) => {
  const addr = addressLines(s);
  return `
    ${title ? `<h3 class="app-shop__place">${esc(title)}</h3>` : ''}
    <div class="app-shop__actions">
      ${s.phone ? `<a class="btn btn--primary" href="${esc(telHref(s.phone))}">Call ${esc(formatPhone(s.phone))}</a>` : ''}
      ${addr.length ? `<a class="btn btn--ghost" href="${esc(mapsHref(s))}" target="_blank" rel="noopener">Directions</a>` : ''}
    </div>
    ${addr.length ? `<address class="app-shop__address">${addr.map(esc).join('<br>')}</address>` : ''}
    ${s.hours?.length ? `<h4 class="app-shop__sub">Hours</h4>${hoursList(s.hours)}` : ''}`;
};

// Pages of the shop's website, opened in the browser: an installed app has no back button to return from them.
const SITE_LINKS = [
  { href: 'pre-orders.html', label: 'Pre-Orders' },
  { href: 'new-arrivals.html', label: 'New Arrivals' },
  { href: 'calendar.html', label: 'Events' },
  { href: 'index.html', label: 'Website' },
];

async function renderShop() {
  const host = $('[data-shop]');
  let s;
  try {
    s = await getSettings();
  } catch {
    host.innerHTML = '<p class="empty">The shop’s details couldn’t be loaded. Please try again shortly.</p>';
    return;
  }
  const many = s.locations?.length > 1;
  const social = socialIcons(s);
  host.innerHTML = `
    ${s.announcement ? `<p class="notice"><strong>Announcement:</strong> ${linkify(s.announcement)}</p>` : ''}
    <div class="panel app-shop">
      ${s.logo_url ? `<img class="app-shop__logo" src="${esc(sizedImage(s.logo_url, LOGO_WIDTH))}" alt="" loading="lazy">` : ''}
      <p class="app-shop__name">${esc(s.shop_name)}</p>
      ${s.tagline ? `<p class="app-shop__tagline">${esc(s.tagline)}</p>` : ''}
      ${many ? s.locations.map((l) => placeHtml(locationAs(s, l), l.name)).join('') : placeHtml(s)}
      ${s.email ? `<p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>` : ''}
      ${social}
    </div>
    <ul class="app-shop__links">${SITE_LINKS.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}<span class="visually-hidden"> (opens in your browser)</span></a></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Install: "Add to Home Screen", offered until it's installed or dismissed
// ---------------------------------------------------------------------------

const DISMISSED = 'pc-app-install-dismissed';
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
};

function offerInstall(shopName, prompt = null) {
  const box = $('[data-install]');
  if (installed() || dismissed() || (!prompt && !iPhone())) return void (box.hidden = true);
  const name = esc(shopName || 'this app');
  box.innerHTML = `
    <p class="app-install__text"><strong>Add ${name} to your Home Screen</strong> for one-tap access to your pull list.
      ${prompt ? '' : 'Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.'}</p>
    ${prompt ? '<button class="btn btn--primary" type="button" data-install-go>Install</button>' : ''}
    <button class="app-install__close" type="button" data-install-close aria-label="Not now">✕</button>`;
  box.hidden = false;
  $('[data-install-go]', box)?.addEventListener('click', async () => {
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    box.hidden = true;
  });
  $('[data-install-close]', box).addEventListener('click', () => {
    box.hidden = true;
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* private mode: offered again next time */
    }
  });
}

// Chrome and Edge hand over their install prompt for a button of our own; Safari has none, so it gets directions.
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  getSettings().then((s) => offerInstall(s.shop_name, installPrompt), () => offerInstall('', installPrompt));
});
addEventListener('appinstalled', () => ($('[data-install]').hidden = true));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './app' }).catch((err) => console.error('Service worker', err));

// The account page signs in and draws the views; it runs initPage, which paints the shop's brand.
await import('./account.js').catch((err) => console.error(err)); // an outage message is already on the page
renderShop();
getSettings().then((s) => offerInstall(s.shop_name, installPrompt), () => {});

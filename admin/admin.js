// Staff admin: sign-in and section routing. Each section lives in
// sections/<name>.js and exports mount(el, ctx) (and optionally
// hasUnsavedChanges()). Writes go through Supabase row-level security, which
// only lets accounts listed in `staff` change anything.

import { parseAdminHash, adminHash } from './route.js';
import { decorateTabs, tabKeys } from './tab-icons.js';
import { DEMO, getSettings } from '../js/data.js';
import { LOCATIONS_ENABLED } from '../js/config.js';
import { $, $$, db, esc, openEmailDialog, friendlyError } from './lib.js';
import { sizedImage } from '../js/util.js';
import { setShopTimeZone } from '../js/dates.js';
import { VERSION } from './version.js';
import { syncTheme } from './theme.js';
import { watchForUpdates } from './update-check.js';
import { startChatAlerts, stopChatAlerts, unreadChats } from './chat-alerts.js';
import { startSurveyAlerts, refreshSurveyAlerts, newSurveyResponses } from './survey-alerts.js';
import { startEventAlerts, refreshEventAlerts, newEventSignups } from './event-alerts.js';
import { listenForOpenRequests } from './staff-push.js';

const SECTIONS = ['dashboard', 'analytics', 'titles', 'reservations', 'customers', 'chat', 'series', 'import', 'events', 'news', 'media', 'pages', 'faq', 'qr', 'emails', 'surveys', 'settings', 'locations', 'backup', 'staff'];
// Screens only owners open (the menu item is hidden and the address redirects to the Dashboard).
// Owner-only screens: the whole Utilities group except Staff, which every staff member opens for My Account (from the
// header's My account button, since staff don't see the Utilities group).
const OWNER_ONLY = ['import', 'settings', 'locations', 'backup'];
let isOwner = false;
let chatAvailable = true; // Shop Settings → Online → Live Chat: off removes the Chat screen
let current = null; // { name, module }
let sb;
let signedInAs = null; // the staff user id the screens were opened for
// Arrived from a "reset your password" email: Supabase signs them in from the link, then they choose a password.
// Read before the Supabase client clears the address.
const RECOVERY = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';

// Any customer email link (data-email-to) opens the compose box instead of the mail app.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-email-to]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  e.stopPropagation();
  openEmailDialog({ to: a.dataset.emailTo, name: a.dataset.emailName, customerId: a.dataset.emailCustomer });
}, true);

window.addEventListener('beforeunload', (e) => {
  if (current?.module.hasUnsavedChanges?.()) e.preventDefault();
});

async function start() {
  if (DEMO) {
    $('#not-configured').hidden = false;
    return;
  }
  sb = await db();
  getSettings()
    .then((s) => {
      $('#admin-shop').textContent = `${s.shop_name} · Staff`;
      shopName = s.shop_name;
      setTitle();
      // Same tab icon as the public site: the favicon, else the logo.
      const icon = sizedImage(s.favicon_url || s.logo_url, 64, { format: 'origin', square: true });
      if (icon) {
        const link = document.head.querySelector('link[rel="icon"]') ?? Object.assign(document.createElement('link'), { rel: 'icon' });
        link.href = icon;
        document.head.append(link);
      }
    })
    .catch(() => {});

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
    if (error) err.textContent = error.message === 'Invalid login credentials' ? 'That email and password don’t match a staff account.' : friendlyError(error);
    else showApp();
  });
  $('#forgot-password').addEventListener('click', async () => {
    const status = $('#forgot-status');
    const email = $('#login-email').value.trim();
    if (!email) {
      status.textContent = 'Type your email address above first.';
      return $('#login-email').focus();
    }
    status.textContent = 'Sending…';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/` });
    // The same answer whether or not the address has an account, so this can't be used to find staff emails.
    status.textContent = error && error.status !== 400
      ? friendlyError(error)
      : `If ${email} has a staff account, we’ve emailed it a link to choose a new password. It can take a few minutes; check spam too.`;
  });
  $('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#reset-error');
    const password = $('#reset-password').value;
    if (password.length < 10) return (err.textContent = 'A password needs at least 10 characters.');
    if (password !== $('#reset-password2').value) return (err.textContent = 'The two passwords don’t match.');
    err.textContent = '';
    const { error } = await sb.auth.updateUser({ password });
    if (error) return (err.textContent = friendlyError(error));
    history.replaceState(null, '', location.pathname);
    $('#reset-form').hidden = true;
    $('#login-form').hidden = false;
    showApp();
  });
  $('#sign-out').addEventListener('click', async () => {
    if (current?.module.hasUnsavedChanges?.() && !confirm('You have unsaved changes. Sign out anyway?')) return;
    await sb.auth.signOut();
    location.reload();
  });

  // The session can end or change while the admin is open (it expires, Sign out in another tab, or a customer
  // signs in on the shop site in the same browser). Writes would then run without staff rights, and an update
  // row-level security filters out changes nothing and reports no error, so check again and lock the screens.
  sb.auth.onAuthStateChange((event, session) => {
    if (!signedInAs || event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_OUT' || !session) return lockOut('You’ve been signed out. Sign in again to carry on; anything you haven’t saved is still on the screen.');
    // supabase-js warns against awaiting its own calls inside this callback.
    if (session.user.id !== signedInAs || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') setTimeout(recheckStaff);
  });

  const { data } = await sb.auth.getSession();
  if (RECOVERY && data.session) {
    $('#login').hidden = false;
    $('#login-form').hidden = true;
    $('#reset-form').hidden = false;
    $('#reset-password').focus();
    return;
  }
  data.session ? showApp() : ($('#login').hidden = false);
}

/** Is the signed-in account still the staff member the screens were opened for? Locks the screens if not. */
async function recheckStaff() {
  const { data: { user }, error } = await sb.auth.getUser();
  if (error?.name === 'AuthRetryableFetchError') return; // offline: the next save says so itself
  const { data: staff, error: staffError } = user ? await sb.from('staff').select('user_id').eq('user_id', user.id).maybeSingle() : { data: null };
  if (staffError) return;
  if (staff && user.id === signedInAs) return;
  // Another staff login: start again with their permissions (the browser asks first if anything is unsaved).
  if (staff) return location.reload();
  lockOut(user
    ? 'This browser is now signed in to an account that isn’t staff (perhaps in another tab). Sign in with your staff account to carry on.'
    : 'You’ve been signed out. Sign in again to carry on; anything you haven’t saved is still on the screen.');
}

/** Hide the screens (kept as they are, so unsaved work survives) and show the sign-in form. */
function lockOut(message) {
  if ($('#app').hidden) return;
  $('#app').hidden = true;
  $('#admin-user').hidden = true;
  $('#admin-notice').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = message;
}

async function showApp() {
  const { data: { user } } = await sb.auth.getUser();
  // Only accounts in the staff table can read it (row-level security).
  const { data: staff } = user ? await sb.from('staff').select('user_id').eq('user_id', user.id).maybeSingle() : { data: null };
  if (!staff) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = 'This account isn’t set up as staff. Ask the shop owner to add you.';
    await sb.auth.signOut();
    return;
  }
  if (signedInAs) {
    // Signed back in after lockOut(): the same person picks up where they were; anyone else starts fresh.
    if (user.id !== signedInAs) return location.reload();
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#admin-user').hidden = false;
    $('#admin-notice').hidden = !$('#admin-notice').textContent;
    return;
  }
  signedInAs = user.id;
  isOwner = (await sb.rpc('is_owner')).data === true;
  OWNER_ONLY.forEach((name) => {
    const item = $(`.admin-nav a[href="#${name}"]`)?.closest('li');
    if (item) item.hidden = !isOwner;
  });
  $$('.admin-nav [data-owner-only]').forEach((group) => (group.hidden = !isOwner)); // Utilities
  if (!LOCATIONS_ENABLED) $('.admin-nav a[href="#locations"]')?.closest('li')?.setAttribute('hidden', ''); // "locations": true in shops.json
  // Live chat can be switched off for the whole shop (Shop Settings); then its screen is gone. A shop that hasn't got the
  // column yet (an update still rolling out) keeps the screen.
  const showChat = (on) => {
    chatAvailable = on;
    const item = $('.admin-nav a[href="#chat"]')?.closest('li');
    if (item) item.hidden = !on;
    // The unread count on the menu and the alerts while staff are on other screens.
    on ? startChatAlerts(sb, { current: () => parseAdminHash(location.hash, SECTIONS), onCount: setTitle }) : stopChatAlerts();
  };
  const { data: shopSetting } = await sb.from('settings').select('chat_available,timezone').eq('id', 1).maybeSingle();
  // "Today" and the order cutoffs on every screen follow the shop's timezone (js/dates.js), like the database does,
  // wherever this staff member is. Set before the first screen opens.
  setShopTimeZone(shopSetting?.timezone);
  showChat(shopSetting?.chat_available !== false);
  window.addEventListener('chat-available', (e) => showChat(e.detail));
  startSurveyAlerts(sb, { onCount: setTitle }); // the count of new survey responses on the Surveys menu item
  startEventAlerts(sb, { onCount: setTitle }); // the count of new event signups on the Events menu item
  listenForOpenRequests(); // tapping a chat notification while the admin is open shows that chat here
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#admin-user').hidden = false;
  showAccount(user);
  syncTheme(user);
  const showNotice = (text) => {
    const n = $('#admin-notice');
    n.textContent = text || '';
    n.hidden = !text;
  };
  window.addEventListener('admin-notice', (e) => showNotice(e.detail));
  sb.from('staff_notice').select('notice').eq('id', 1).maybeSingle().then(({ data }) => showNotice(data?.notice));
  window.addEventListener('hashchange', route);
  route();
}

// The browser tab names the open screen first ("Customers · Staff · Pop's Comics"), so tabs and history can be told apart,
// after the number of unread chats ("(2) Customers · …") so a new chat shows on a tab in the background.
// The phone menu button (the menu is folded away there) counts everything waiting: unread chats, new survey responses
// and new event signups.
let shopName = '';
const setTitle = () => {
  const screen = $('#app').hidden ? '' : $('[data-nav-label]')?.textContent.trim();
  const unread = unreadChats();
  document.title = `${unread ? `(${unread}) ` : ''}${[screen, 'Staff', shopName].filter(Boolean).join(' · ')}`;
  const total = unread + newSurveyResponses() + newEventSignups();
  const badge = $('[data-nav-total]');
  if (badge) (badge.hidden = !total), (badge.innerHTML = total ? `${total}<span class="visually-hidden"> waiting</span>` : '');
};

let lastHash = location.hash;
let routeRun = 0; // the latest route() call: a slower, earlier one must not draw over the screen opened after it
async function route() {
  if (location.hash === '#restore') history.replaceState(null, '', '#backup'); // Restore is now part of Backup
  let { name, arg } = parseAdminHash(location.hash, SECTIONS);
  if ((OWNER_ONLY.includes(name) && !isOwner) || (name === 'chat' && !chatAvailable) || (name === 'locations' && !LOCATIONS_ENABLED)) {
    name = 'dashboard';
    arg = '';
    history.replaceState(null, '', '#dashboard');
  }
  if (current && (current.name !== name || adminHash(name, arg) !== lastHash) && current.module.hasUnsavedChanges?.() && !confirm('You have unsaved changes here. Leave anyway?')) {
    history.replaceState(null, '', lastHash || `#${current.name}`);
    return;
  }
  lastHash = adminHash(name, arg);
  $$('.admin-nav a').forEach((a) => (a.getAttribute('href') === `#${name}` ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  revealCurrentGroup();
  const navLabel = $(`.admin-nav a[href="#${name}"] > span:not(.admin-nav__badge)`)?.textContent.trim(); // not the count badge
  if (navLabel) $('[data-nav-label]').textContent = navLabel;
  setTitle();
  refreshSurveyAlerts();
  refreshEventAlerts();
  setNavOpen(false);
  const el = $('#section');
  el.setAttribute('aria-label', navLabel || name); // focus lands here on each screen change, so a screen reader names the screen
  el.innerHTML = '<p class="admin-hint loading">Loading…</p>';
  const mine = ++routeRun;
  try {
    const module = await import(`./sections/${name}.js`);
    if (mine !== routeRun) return; // another screen was chosen while this one's file loaded
    current = { name, module };
    el.innerHTML = '';
    await module.mount(el, { sb, isOwner, arg });
  } catch (err) {
    if (mine !== routeRun) return;
    console.error(err);
    el.innerHTML = `<p class="form-error">Couldn’t open this section: ${esc(friendlyError(err))}</p>`;
  }
  if (mine === routeRun) el.focus({ preventScroll: true });
}

// Collapsible groups in the section list (Pull List, Website, Utilities). Each starts as its markup says (Pull List
// open; Website and Utilities folded) until staff open or fold it, which is remembered on this device.
const NAV_KEY = 'admin-nav-groups';
const savedGroups = () => {
  try {
    return JSON.parse(localStorage.getItem(NAV_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
};
function setGroup(btn, open, remember = true) {
  btn.setAttribute('aria-expanded', String(open));
  const list = document.getElementById(btn.getAttribute('aria-controls'));
  if (list) list.hidden = !open;
  if (!remember) return;
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify({ ...savedGroups(), [btn.getAttribute('aria-controls')]: open }));
  } catch {
    /* remembering is optional */
  }
}
$$('.admin-nav__heading').forEach((btn) => {
  const saved = savedGroups()[btn.getAttribute('aria-controls')];
  setGroup(btn, typeof saved === 'boolean' ? saved : btn.getAttribute('aria-expanded') === 'true', false);
  btn.addEventListener('click', () => setGroup(btn, btn.getAttribute('aria-expanded') !== 'true'));
});
/** Open the group that holds the page being shown, so the current item is never hidden. */
const revealCurrentGroup = () => {
  const list = $('.admin-nav a[aria-current="page"]')?.closest('ul.admin-nav__items');
  const btn = list && $(`.admin-nav__heading[aria-controls="${list.id}"]`);
  if (btn && btn.getAttribute('aria-expanded') !== 'true') setGroup(btn, true, false);
};

// The header's account menu: the staff member's name, then a circle with its first letter that opens My account and
// Sign out. Staff without a name show their email instead.
async function showAccount(user) {
  $('#admin-email').textContent = user.email;
  const { data: me } = await sb.from('staff').select('name').eq('user_id', user.id).maybeSingle();
  const name = me?.name?.trim() || user.email;
  $('#admin-name').textContent = name;
  $('[data-account-name]').textContent = name;
  $('[data-initial]').textContent = (Array.from(name.trim())[0] ?? '?').toUpperCase();
  $('#account-btn').setAttribute('aria-label', `Account: ${name}`);
  $('#account-btn').title = name;
}
function setAccountOpen(open) {
  $('#account-btn').setAttribute('aria-expanded', String(open));
  $('#account-menu').hidden = !open;
}
$('#account-btn').addEventListener('click', () => setAccountOpen($('#account-btn').getAttribute('aria-expanded') !== 'true'));
$('#my-account').addEventListener('click', () => setAccountOpen(false));
document.addEventListener('click', (e) => !e.target.closest('.account-menu') && setAccountOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('#account-menu').hidden) return;
  setAccountOpen(false);
  $('#account-btn').focus();
});

// Phones and tablets: the section list opens from a menu button; picking a section, Escape or a tap elsewhere closes it.
function setNavOpen(open) {
  $('.admin-nav').classList.toggle('is-open', open);
  $('.admin-nav__toggle').setAttribute('aria-expanded', String(open));
}
$('.admin-nav__toggle').addEventListener('click', () => setNavOpen($('.admin-nav__toggle').getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setNavOpen(false));
// Skip link: jump past the header and menu to the open screen (a plain #hash would be read as a route).
$('.skip-link').addEventListener('click', (e) => (e.preventDefault(), ($('#app').hidden ? $('#main') : $('#section')).focus()));
document.addEventListener('click', (e) => !e.target.closest('.admin-nav') && setNavOpen(false));

// `cards` tables become stacked cards on phones: tag them and copy each column heading onto its cells.
const stackTables = (root) => {
  root.querySelectorAll('table.admin-table.cards').forEach((table) => {
    const heads = [];
    table.querySelectorAll('thead tr:last-child th').forEach((th) => {
      const hidden = th.querySelector('.visually-hidden');
      const label = hidden && th.textContent.trim() === hidden.textContent.trim() ? '' : th.textContent.trim();
      for (let i = 0; i < (Number(th.colSpan) || 1); i++) heads.push(label);
    });
    table.classList.add('is-stack');
    table.querySelectorAll('tbody tr').forEach((tr) => {
      let col = 0;
      [...tr.children].forEach((td) => {
        if (td.colSpan > 1) return void (col += td.colSpan);
        if (td.dataset.label === undefined) td.dataset.label = heads[col] ?? '';
        col++;
      });
    });
  });
};

// Pages with tabs show the open tab after the section name in the heading ("Titles > Out this week").
const crumbHeading = () => {
  const section = $('#section');
  const h1 = $('h1', section);
  const tab = $('.admin-tabs [aria-selected="true"]', section);
  if (!h1 || !h1.closest('#section')) return;
  const words = h1.firstChild?.nodeType === Node.TEXT_NODE ? h1.firstChild : null; // the title's words; the help icon after it stays
  if (!words) return;
  if (h1.dataset.base === undefined || (words.data !== h1.dataset.shown)) h1.dataset.base = words.data;
  let text = h1.dataset.base;
  if (tab) {
    const clone = tab.cloneNode(true);
    clone.querySelectorAll('.admin-tab__badge').forEach((n) => n.remove());
    text = `${h1.dataset.base} > ${clone.textContent.trim()}`;
  }
  if (words.data !== text) words.data = text;
  h1.dataset.shown = text;
};
$('#section').addEventListener('keydown', tabKeys);
// A screen drawing a long list changes the page many times in a row: do the work once per frame, not once per change.
let tidyQueued = false;
const tidySection = () => {
  tidyQueued = false;
  decorateTabs($('#section'));
  stackTables($('#section'));
  crumbHeading();
};
new MutationObserver(() => {
  if (tidyQueued) return;
  tidyQueued = true;
  requestAnimationFrame(tidySection);
}).observe($('#section'), { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });

$('#admin-version').textContent = VERSION;

// A deploy while this tab is open can leave it with a mix of old and new scripts: offer a reload.
watchForUpdates({
  // The bar is a role="status" region, so it is announced; it doesn't take focus, which could land a keystroke
  // meant for a field on Reload.
  onUpdate: () => ($('#admin-update').hidden = false),
});
$('#admin-update-reload').addEventListener('click', () => {
  if (current?.module.hasUnsavedChanges?.() && !confirm('You have unsaved changes here. Reload anyway?')) return;
  location.reload();
});
$('#admin-update-later').addEventListener('click', () => ($('#admin-update').hidden = true));

start();

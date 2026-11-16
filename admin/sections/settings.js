// Shop settings: everything customer pages read from the settings row — name,
// contact, hours, socials, map, logo, colors and fonts, and the reservation rules — plus the pickup and new-account
// rules (trust_settings, staff-only, so not on the public settings row).

import { SOCIAL_ICONS } from '../../js/social-icons.js';
import { tiersFrom } from '../../js/discount.js';
import { SUPABASE_URL, APP_ENABLED } from '../../js/config.js';
import { putMedia } from '../../js/media-store.js';
import { contrast, colorVars, FONT_LIBRARY, FONT_SLOTS, SPACING, SIZES, letterSpacing, sizeScale, fontScale, isFontUpload } from '../../js/theme-vars.js';
import { $, $$, esc, must, toast, setStatus, settingsField, formReaders, solidIcon, friendlyError, setupTabs, fmtTime, fmtDateTime, uid, db, slugify, switchHtml, hintSlot } from '../lib.js';
import { imageField } from '../images.js';
import { capField, trustRowFrom, settingChange, DAY_FIELDS } from '../trust.js';

const DAYS = [['Mo', 'Mon'], ['Tu', 'Tue'], ['We', 'Wed'], ['Th', 'Thu'], ['Fr', 'Fri'], ['Sa', 'Sat'], ['Su', 'Sun']];
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const COLORS = [['primary', 'Main color (buttons, highlights)'], ['accent', 'Accent (banner, badges)'], ['ink', 'Text'], ['paper', 'Page background'], ['footer', 'Footer background']];
const COLOR_DEFAULTS = { primary: '#982c21', accent: '#e7b84b', ink: '#f4f0ea', paper: '#121212', footer: '#121212', link: '#91bbdd' };
const PREVIEW_VARS = { display: '--pv-display', heading: '--pv-heading', body: '--pv-body' }; // admin.css .font-preview
const PREVIEW_TRACKING = { display: '--pv-display-tracking', heading: '--pv-heading-tracking', body: '--pv-body-tracking' };
const PREVIEW_SCALE = { display: '--pv-display-scale', heading: '--pv-heading-scale', body: '--pv-body-scale' };
const FONT_MAX_KB = 500; // a font is downloaded before the page's text shows in it, so keep uploads small

const TRUST_LOG_SHOW = 8;

let dirty = false;
let previewFaces; // <style> with the font preview's @font-face rules
export const hasUnsavedChanges = () => dirty;

export async function mount(el, { sb }) {
  dirty = false;
  const [s, notice, trust, trustLog] = await Promise.all([
    must(sb.from('settings').select('*').eq('id', 1).single()),
    // The staff notice has its own staff-only table (settings can be read by anyone).
    must(sb.from('staff_notice').select('notice').eq('id', 1).maybeSingle()),
    // So do the pickup and new-account rules.
    must(sb.from('trust_settings').select('*').eq('id', 1).single()),
    must(sb.from('trust_settings_log').select('setting,from_value,to_value,staff_name,created_at').order('created_at', { ascending: false }).limit(TRUST_LOG_SHOW)),
  ]);
  const field = settingsField({ ...s, admin_notice: notice?.notice });

  el.innerHTML = `
    <h1>Shop Settings</h1>
    ${hintSlot()}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="shop">Shop</button>
      <button type="button" class="admin-tab" role="tab" data-tab="look">Logo, Colors &amp; Fonts</button>
      <button type="button" class="admin-tab" role="tab" data-tab="online">Online</button>
      <button type="button" class="admin-tab" role="tab" data-tab="stock">Pre-Orders &amp; Stock</button>
      <button type="button" class="admin-tab" role="tab" data-tab="trust">Pickups &amp; Accounts</button>
    </div>
    <form class="admin-form settings-form" novalidate>
      <div data-tabpane="shop">
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Admin Notice</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('admin_notice', 'Notice for staff', 'maxlength="500"', 'Shown in a gold bar at the very top of every admin page. Staff only — customers never see it. Leave blank to hide it.', 'field--full')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Shop</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('shop_name', 'Shop name', 'required', '', 'field--full')}
        ${field('founded_year', 'Open since (year)', 'type="number" min="1900" max="2100" inputmode="numeric"')}
        ${field('tagline', 'Tagline', '', 'Shown under the home page headline and in browser tabs.', 'field--full')}
        ${field('copyright_text', 'Footer copyright', 'maxlength="200"', 'Shown at the very bottom of every page. Type {year} to always show the current year, e.g. “© {year} Pop’s Comics &amp; Collectibles. All rights reserved.” Leave blank for “© year shop name”.', 'field--full')}
        ${field('hero_headline', 'Home page headline', '', 'Wrap words in *asterisks* to show them in the accent color.', 'field--full')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Contact &amp; Address</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('phone', 'Phone', 'type="tel"', '', 'field--full')}
        ${field('email', 'Email', 'type="email"', '', 'field--full')}
        ${field('street', 'Street address', 'autocapitalize="words"', '', 'field--full')}
        ${field('city', 'City', 'autocapitalize="words"')}
        ${field('region', 'State', 'autocapitalize="words"')}
        ${field('postal_code', 'ZIP code', 'inputmode="numeric"')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Opening Hours</h2></div><div class="fold__body">
        <div data-hours></div>
        <button class="btn btn--add btn--small mt-14" type="button" data-add-hours>${solidIcon('add', 16)} Add hours</button>
      </div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Map</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field field--full"><label><input type="checkbox" name="show_map"${s.show_map ? ' checked' : ''}> Show a Google Map on the Home and Visit pages</label></div>
        ${field('map_embed_url', 'Custom map link (optional)', 'type="url" placeholder="https://www.google.com/maps/embed?…"', 'From Google Maps: Share → Embed a map → copy the link inside src="…". Leave blank to map the address.', 'field--full')}
      </div></div></section>
      </div>
      <div data-tabpane="look">
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Logo &amp; Colors</h2></div><div class="fold__body">
        <div data-logo></div>
        <div class="field field--full"><label><input type="checkbox" name="show_name_with_logo"${s.show_name_with_logo ? ' checked' : ''}> Show the shop name next to the logo</label>
        <p class="field__hint">Unticked, the logo replaces the name in the header. Without a logo, the name is always shown.</p></div>
        <div data-favicon></div>
        <p class="field__hint">The small icon in the browser tab. Use a simple square picture (it's shown at 64 px or less). Blank uses the logo. It can take about a minute to appear on the site.</p>
        <div data-hero></div>
        <p class="field__hint">Shown behind the home page headline, darkened so the text stays readable. Cropped wide; a landscape photo of the shop works best. Without one, the banner uses the page background.</p>
        <div class="form-grid form-grid--pairs color-grid">${COLORS.map(([k, label]) => `<div class="field"><label for="c-${k}">${label}</label><input id="c-${k}" data-color="${k}" type="color" value="${esc(s.colors?.[k] ?? COLOR_DEFAULTS[k])}"></div>`).join('')}
          <div class="field field--full"><label for="c-link">Text links</label>
            <div class="color-row"><input id="c-link" data-color="link" type="color" value="${esc(s.colors?.link ?? COLOR_DEFAULTS.link)}"${s.colors?.link ? '' : ' disabled'}>
            <label class="color-row__match"><input type="checkbox" data-link-auto${s.colors?.link ? '' : ' checked'}> Automatic</label></div>
            <p class="field__hint">Links in text and focus outlines. Automatic picks a blue that reads well on the page background; pick your own to override it (make sure it is readable on the page background).</p></div></div>
        <p class="field__hint">The site is designed for a dark page background with light text. Everything else (cards, borders, muted text) is worked out from these five colors. Use the page background and text colors together: a dark background needs light text.</p>
        <div class="contrast" data-contrast aria-live="polite"></div>
      </div></section>
      ${APP_ENABLED ? `<section class="fold fold--compact fold--static"><div class="fold__head"><h2>Pull List App</h2></div><div class="fold__body">
        <div data-app-icon></div>
        <p class="field__hint">The app’s icon on Android and iPhone Home Screens, saved at 512 × 512. Fill the whole square with a solid background color and keep your logo inside the middle 60%: phones cut the icon to a circle or rounded square, so anything near the edges can be cut off. Blank uses the browser tab icon (or the logo), shown smaller on a plain background. It can take about a minute to reach the app, and a phone that already has the app picks up a new icon when it next updates it.</p>
        <div class="form-grid form-grid--pairs">${[1, 2, 3, 4].map((n) => `<div class="field" data-app-shot="${n}"></div>`).join('')}</div>
        <p class="field__hint">Up to four pictures of the app, shown when Android offers to install it. Take them on a phone with the app open (My List, Hot, a title’s details, the Shop tab). Each is cropped to a phone screen’s shape and saved at 1080 × 2340. Without any, Android shows a small install bar instead.</p>
      </div></section>` : ''}
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Fonts</h2></div><div class="fold__body">
        <div class="form-grid form-grid--pairs">${FONT_SLOTS.map((slot) => fontPicker(slot, s.fonts?.[slot.slot])).join('')}</div>
        <p class="field__hint">The built-in fonts are free to use. For <strong>Your own font file</strong>, upload a .woff2 (or .woff) file of ${FONT_MAX_KB} KB or less, and only a font your shop is licensed to use on a website. Each built-in font is sized to look about as big as the default at Medium; an uploaded font is set at the default's size. Changes can take about a minute to appear on the site.</p>
        <div class="font-preview" data-font-preview aria-hidden="true">
          <p class="font-preview__display">${esc(s.shop_name || 'Your Comic Shop')}</p>
          <p class="font-preview__heading">New this week</p>
          <p class="font-preview__body">Pull lists, pre-orders and the week’s new comics. Reserve online and pay when you pick them up.</p>
        </div>
      </div></section>
      </div>
      <div data-tabpane="online">
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Social Media</h2></div><div class="fold__body">
        <p class="field__hint">Full profile links. Leave blank to hide a network.</p>
        <div class="form-grid">${Object.entries(SOCIAL_ICONS).map(([k, { label }]) => `<div class="field"><label for="soc-${k}">${esc(label)}</label><input id="soc-${k}" data-social="${k}" type="url" placeholder="https://…" value="${esc(s.socials?.[k])}"></div>`).join('')}</div>
      </div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Google Analytics</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('ga_measurement_id', 'Measurement ID', 'placeholder="G-XXXXXXXXXX" pattern="G-[A-Za-z0-9]+" autocomplete="off"', 'From Google Analytics: Admin → Data streams → your website. Tracking runs on every public page; leave blank to turn it off.', 'field--full')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Live Chat</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field span-2">${switchHtml('Use live chat on this site', { name: 'chat_available', checked: s.chat_available !== false })}
        <p class="field__hint">Turns the whole feature on or off. Off removes the Chat screen from this admin and the chat button and footer link from every public page, and visitors can’t start chats; saved chats are kept. While it is on, you switch chat on and off for visitors from Admin → Chat (chat starts off).</p></div>
        ${field('chat_greeting', 'Greeting', 'maxlength="200"', 'Shown above the first message box. Leave blank for the standard greeting.', 'field--full')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Maintenance Mode</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field span-2">${switchHtml('Cover the public site with a “be right back” screen', { name: 'maintenance_mode', checked: !!s.maintenance_mode })}
        <p class="field__hint">When on, every public page and the pull list app are covered by a “be right back” screen showing the message below, with the shop’s phone and email if set. This staff admin keeps working, so you can switch it off again. It only hides the site from visitors: it doesn’t stop the database from answering, so the pull list app’s data calls still work. Only owners can change it.</p></div>
        ${field('maintenance_message', 'Message for visitors', 'maxlength="500"', 'Optional. Leave blank for the standard message.', 'field--full')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Footer Code</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="s-footer-scripts">Code for the bottom of every page</label>
          <textarea id="s-footer-scripts" class="font-mono" name="footer_scripts" rows="8" maxlength="20000" spellcheck="false" autocomplete="off" placeholder="&lt;script src=&quot;https://…&quot;&gt;&lt;/script&gt;">${esc(s.footer_scripts)}</textarea>
          <p class="field__hint">Paste the snippet a service gives you (a help chat, for example), including its &lt;script&gt; tags. It runs on every public page, but not in the admin. <strong>Only paste code from a source you trust:</strong> it can see everything a customer sees. A mistake here can break the site, so if pages misbehave, clear this box and save. Leave blank for none.</p></div>
      </div></div></section>
      </div>
      <div data-tabpane="stock">
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Pre-Orders &amp; Stock</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('max_copies_per_title', 'Copies per customer per title', 'type="number" min="1" max="100" inputmode="numeric"')}
        ${field('hold_days', 'Hold reservations after arrival (days)', 'type="number" min="1" max="365" inputmode="numeric"')}
        <div class="field field--full"><label for="s-timezone">Shop time zone</label><select id="s-timezone" name="timezone">${[...new Set([s.timezone, ...ZONES])].filter(Boolean).map((z) => `<option${z === s.timezone ? ' selected' : ''}>${z}</option>`).join('')}</select><p class="field__hint">Reservations close at midnight shop time on the Saturday before each order cutoff (FOC).</p></div>
        <div class="field span-2"><label for="s-pinned">Publishers pinned to the top of the Publisher filter</label><textarea id="s-pinned" name="pinned_publishers" rows="3">${esc((s.pinned_publishers ?? []).join(', '))}</textarea><p class="field__hint">Comma-separated, in order — spelled as they appear in the filter.</p></div>
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Pull List Discount</h2></div><div class="fold__body">
        <div class="field"><label><input type="checkbox" name="discount_enabled"${s.discount_enabled === false ? '' : ' checked'}> Give customers a discount based on how many series they follow (titles added one at a time don’t count)</label>
        <p class="field__hint">Shown on My Pull List and in the pull list emails and printed pull lists. Unticked, no discount is shown or applied anywhere (your tiers are kept).</p></div>
        <div data-tiers></div>
        <button class="btn btn--add btn--small mt-14" type="button" data-add-tier>${solidIcon('add', 16)} Add a tier</button>
        <p class="field__hint">Each tier starts at a number of different series on the customer’s active pull list and gives that percent off the cover-price total until the next tier starts. Start numbers must go up. Toys and anything without a series don’t count toward the number.</p>
      </div></section>
      </div>
      <div data-tabpane="trust">${trustPane(trust, trustLog)}</div>

      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">Save settings</button>
        <span class="admin-status" role="status"></span>
      </div>
    </form>`;

  const form = $('form', el);
  const hoursBox = $('[data-hours]', el);
  (s.hours ?? []).forEach((h) => addHours(hoursBox, h));
  $('[data-add-hours]', el).addEventListener('click', () => {
    addHours(hoursBox, { days: [], open: '11:00', close: '19:00' });
    dirty = true;
  });
  const tiersBox = $('[data-tiers]', el);
  tiersFrom({ discount_tiers: s.discount_tiers }).forEach((t) => addTier(tiersBox, t));
  $('[data-add-tier]', el).addEventListener('click', () => {
    const last = $$('.tier-row', tiersBox).at(-1);
    addTier(tiersBox, { min: last ? Number($('[data-min]', last).value || 0) + 15 : 1, pct: last ? Math.min(Number($('[data-pct]', last).value || 0) + 5, 100) : 10 });
    dirty = true;
  });
  const logo = imageField($('[data-logo]', el), { folder: 'brand', label: 'Logo', maxSize: 800, library: true });
  logo.set(s.logo_url);
  const favicon = imageField($('[data-favicon]', el), { folder: 'brand', label: 'Browser tab icon (favicon)', crop: 'square', maxSize: 256, library: true });
  favicon.set(s.favicon_url);
  const hero = imageField($('[data-hero]', el), { folder: 'brand', label: 'Home page banner photo', crop: 'wide', maxSize: 2000, library: true });
  hero.set(s.hero_image_url);
  // The app's pictures are saved at an exact size (the manifest states it), so they're uploaded, not picked from Media.
  const appIcon = APP_ENABLED ? imageField($('[data-app-icon]', el), { folder: 'brand', label: 'App icon', exact: [512, 512] }) : null;
  appIcon?.set(s.app_icon_url);
  const appShots = APP_ENABLED ? $$('[data-app-shot]', el).map((box, i) => imageField(box, { folder: 'brand', label: `Screenshot ${i + 1}`, exact: [1080, 2340] })) : [];
  appShots.forEach((f, i) => f.set(s.app_screenshots?.[i]));
  setupTabs(el, 'admin-settings-tab', 'shop', undefined, {
    shop: 'The shop’s name, contact details, address, opening hours and map, as customers see them on the website. The Admin Notice at the top is for staff only. Press Save settings when you’re done; it saves every tab.',
    look: 'The logo, colors and fonts of the website. Text colors are checked so they stay readable. Press Save settings when you’re done.',
    online: 'Links to the shop’s social media, Google Analytics, live chat and any extra code for the footer. Press Save settings when you’re done.',
    stock: 'How pre-orders and stock work for customers, and the discount pull list customers get. Press Save settings when you’re done.',
    trust: 'Keeps the shop from ordering books for customers who don’t pick up, and for fake accounts. Customers never see any of this. Press Save settings when you’re done.',
  });
  setupTrustPane(form);

  $('[data-link-auto]', form).addEventListener('change', (e) => ($('#c-link', form).disabled = e.target.checked));

  // Accessibility check of the colors as picked (WCAG: 4.5:1 for text, 3:1 for large or bold text), updated as you pick.
  const val = (k) => $(`[data-color="${k}"]`, form).value;
  const checkContrast = () => {
    // Check the colors the public site will actually show: js/theme-vars.js picks link, button-text and accent-text
    // colors from these settings (the same colorVars() the site Worker uses), so test those, not the raw picks.
    const paper = val('paper');
    const accent = val('accent');
    const auto = $('[data-link-auto]', form).checked;
    const site = Object.fromEntries(colorVars({ primary: val('primary'), accent, ink: val('ink'), paper, footer: val('footer'), ...(auto ? {} : { link: val('link') }) }));
    const accentText = site['--gold-text'] ?? accent;
    const rows = [
      ['Text on the page background', val('ink'), paper, 4.5],
      [`Text links on the page background${auto ? ' (automatic)' : ''}`, site['--teal'], paper, 4.5],
      ['Button text on the main color', site['--on-primary'], val('primary'), 4.5],
      ['Badge text on the accent', site['--on-accent'], accent, 4.5],
      [`Accent as text on the page background${accentText !== accent ? ' (adjusted automatically)' : ''}`, accentText, paper, 4.5],
      ['Footer headings on the footer background', site['--footer-heading'] ?? accent, val('footer'), 3],
    ];
    $('[data-contrast]', form).innerHTML = `<h3>Readability check</h3><ul class="contrast__list">${rows.map(([label, fg, bg, need]) => {
      const r = contrast(fg, bg);
      const ok = r >= need;
      return `<li class="${ok ? 'is-ok' : 'is-bad'}"><span class="contrast__sample" style="color:${fg};background:${bg}" aria-hidden="true">Aa</span> <span>${label}: <strong>${r.toFixed(1)}:1</strong> ${ok ? '✓ passes' : `✗ needs ${need}:1`}</span></li>`;
    }).join('')}</ul>`;
  };
  checkContrast();
  form.addEventListener('input', checkContrast);
  form.addEventListener('change', checkContrast);

  const fonts = setupFonts(form, s.fonts ?? {}, val);
  form.addEventListener('input', () => (dirty = true));
  form.addEventListener('change', () => (dirty = true));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('.sticky-actions .admin-status', el);
    const f = new FormData(form);
    const { text, int } = formReaders(f);
    const hours = $$('.hours-row', hoursBox).map((row) => ({
      days: DAYS.map(([d]) => d).filter((d) => $(`[data-day="${d}"]`, row).checked),
      open: $('[data-open]', row).value,
      close: $('[data-close]', row).value,
    }));
    const tiers = $$('.tier-row', tiersBox).map((row) => ({ min: Number($('[data-min]', row).value), pct: Number($('[data-pct]', row).value) }));
    const socials = Object.fromEntries($$('[data-social]', form).map((i) => [i.dataset.social, i.value.trim()]).filter(([, v]) => v));
    const colors = Object.fromEntries($$('[data-color]:not(:disabled)', form).map((i) => [i.dataset.color, i.value])); // Automatic links: no link key
    const fontPicks = fonts.get();

    if (!text('shop_name')) return setStatus(status, 'The shop needs a name.', 'error');
    if (hours.some((h) => !h.days.length || !h.open || !h.close)) return setStatus(status, 'Each hours row needs at least one day and open/close times.', 'error');
    if (tiers.some((t) => !Number.isInteger(t.min) || !Number.isInteger(t.pct) || t.min < 1 || t.pct < 0 || t.pct > 100)) return setStatus(status, 'Each discount tier needs a whole number of series (1 or more) and a percent from 0 to 100.', 'error');
    if (tiers.some((t, i) => i && t.min <= tiers[i - 1].min)) return setStatus(status, 'Discount tiers must start at higher and higher numbers of series.', 'error');
    const badSocial = Object.entries(socials).find(([, v]) => !/^https?:\/\//i.test(v));
    if (badSocial) return setStatus(status, `The ${SOCIAL_ICONS[badSocial[0]].label} link should start with https://`, 'error');
    const gaId = text('ga_measurement_id');
    if (gaId && !/^G-[A-Za-z0-9]+$/.test(gaId)) return setStatus(status, 'The Analytics measurement ID should look like G-XXXXXXXXXX.', 'error');
    const mapUrl = text('map_embed_url');
    if (mapUrl && !/^https:\/\/(www\.)?google\.com\/maps\/embed\?/.test(mapUrl)) return setStatus(status, 'The custom map link should be a Google Maps embed link (https://www.google.com/maps/embed?…).', 'error');
    if (typeof fontPicks === 'string') return setStatus(status, fontPicks, 'error');
    const trustRow = readTrust(f);
    if (typeof trustRow === 'string') return setStatus(status, trustRow, 'error');

    const row = {
      shop_name: text('shop_name'), tagline: text('tagline'), hero_headline: text('hero_headline'), copyright_text: text('copyright_text'), footer_scripts: text('footer_scripts'), chat_available: f.has('chat_available'), maintenance_mode: f.has('maintenance_mode'), maintenance_message: text('maintenance_message'), chat_greeting: text('chat_greeting'), founded_year: int('founded_year', null),
      phone: text('phone'), email: text('email'), street: text('street'), city: text('city'), region: text('region'), postal_code: text('postal_code'),
      hours, socials, colors, fonts: fontPicks, logo_url: logo.get(), favicon_url: favicon.get(), show_name_with_logo: f.has('show_name_with_logo'), hero_image_url: hero.get(), show_map: f.has('show_map'), map_embed_url: mapUrl, ga_measurement_id: gaId,
      max_copies_per_title: int('max_copies_per_title', 10), hold_days: int('hold_days', 30),
      timezone: f.get('timezone'),
      discount_enabled: f.has('discount_enabled'), discount_tiers: tiers,
      pinned_publishers: (text('pinned_publishers') ?? '').split(',').map((p) => p.trim()).filter(Boolean),
      // Without the app the fields aren't shown, so what's saved is left as it is.
      ...(APP_ENABLED ? { app_icon_url: appIcon.get(), app_screenshots: appShots.map((f) => f.get()).filter(Boolean) } : {}),
    };
    setStatus(status, 'Saving…');
    try {
      const adminNotice = text('admin_notice');
      // Row-level security turns an update by a signed-out (or non-owner) session into "0 rows", not an error.
      const notSaved = () => Object.assign(new Error('You may have been signed out. Sign in again, then save once more.'), { code: 'P0001' });
      if (!(await must(sb.from('settings').update(row).eq('id', 1).select('id')))?.length) throw notSaved();
      if (!(await must(sb.from('staff_notice').update({ notice: adminNotice }).eq('id', 1).select('id')))?.length) throw notSaved();
      if (!(await must(sb.from('trust_settings').update(trustRow).eq('id', 1).select('id')))?.length) throw notSaved();
      await refreshTrust(sb, form); // turning the ladder on moves its start date; the change history grows
      dirty = false;
      window.dispatchEvent(new CustomEvent('admin-notice', { detail: adminNotice }));
      window.dispatchEvent(new CustomEvent('chat-available', { detail: row.chat_available }));
      setStatus(status, `Saved ${fmtTime()} — live on the site now.`, 'ok');
      toast('Settings saved');
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Pickups & Accounts (trust_settings): the two switches, the weekly limit, and the reminder / pause days.
// ---------------------------------------------------------------------------------------------------------------------

const DAY_LABEL = { warning_days: 'reminder email after', pause_days: 'pause after', monthly_warning_days: 'reminder email after', monthly_pause_days: 'pause after' };

function trustPane(t, log) {
  const field = settingsField({ ...t, unproven_weekly_cap: capField(t.unproven_weekly_cap_cents) });
  const days = DAY_FIELDS.flatMap(([warn, pause, label]) => [warn, pause].map((k) =>
    field(k, `${label} customers: ${DAY_LABEL[k]} (days)`, 'type="number" min="1" max="365" step="1" inputmode="numeric" required data-ladder')));
  return `
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Unclaimed Books</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field span-2">${switchHtml('Pause pulls for unclaimed books', { name: 'pickup_pause_enabled', checked: t.pickup_pause_enabled })}
          <p class="field__hint">On: when a customer’s books have been waiting too long, they get a friendly “your books are waiting” email, and later their pull list is paused (no new titles from follows, no new pre-orders, and nothing new is ordered for them) until they pick up. Off: no reminder emails and no automatic pauses. The Unclaimed list on Customers and pausing a customer by hand work either way.</p></div>
        ${days.join('')}
        <p class="field__hint span-2" data-ladder>Counted from the day the oldest waiting book came in. Set each customer to weekly, monthly or exempt on their page.</p>
        <div class="field span-2" data-ladder><label><input type="checkbox" name="auto_resume_on_pickup"${t.auto_resume_on_pickup ? ' checked' : ''}> Un-pause automatically when everything waiting is picked up</label>
          <p class="field__hint">Only for automatic pauses. A customer paused by hand stays paused until staff resume them.</p></div>
        ${field('reliability_started_at', 'Count waiting days from', 'type="date" required data-ladder', 'Books that came in before this date count from it, so nobody is paused for old history. Turning the switch on sets it to today. The Unclaimed list still shows how long books have really waited.')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>New Accounts</h2></div><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field span-2">${switchHtml('Verify new accounts', { name: 'verification_enabled', checked: t.verification_enabled })}
          <p class="field__hint">On: a new account can build a list, but nothing is ordered for them until staff approve it. Then a weekly limit applies until their first pickup. Off: new accounts count straight away, with no approval and no limit. Turning this on never affects accounts that already exist.</p></div>
        ${field('unproven_weekly_cap', 'Weekly limit before first pickup ($)', 'inputmode="decimal" maxlength="12" placeholder="No limit" data-verify', 'Per order cutoff week, at the price the customer pays, titles added by follows included. Titles over the limit wait for staff approval instead of being refused. Blank or 0: no limit.')}
      </div></div></section>
      <section class="fold fold--compact fold--static"><div class="fold__head"><h2>Change History</h2></div><div class="fold__body" data-trust-log>${trustLogHtml(log)}</div></section>`;
}

const trustLogHtml = (rows) =>
  rows.length
    ? `<ul class="job-log">${rows.map((r) => `<li><span class="job-log__when">${esc(fmtDateTime(r.created_at))}</span><span>${esc(r.staff_name ?? 'Automatic')}</span><span class="job-log__msg">${esc(settingChange(r))}</span></li>`).join('')}</ul>${rows.length === TRUST_LOG_SHOW ? `<p class="field__hint">Showing the latest ${TRUST_LOG_SHOW} changes.</p>` : ''}`
    : '<p class="empty">No changes yet.</p>';

/** Hide the day counts while the ladder is off, and the limit while verification is off (their values are kept). */
function setupTrustPane(form) {
  const sync = () => {
    const ladder = form.elements.pickup_pause_enabled.checked;
    const verify = form.elements.verification_enabled.checked;
    $$('[data-ladder]', form).forEach((n) => ((n.closest('.field') ?? n).hidden = !ladder));
    $$('[data-verify]', form).forEach((n) => ((n.closest('.field') ?? n).hidden = !verify));
  };
  form.elements.pickup_pause_enabled.addEventListener('change', sync);
  form.elements.verification_enabled.addEventListener('change', sync);
  sync();
}

/** The trust_settings row from the form, or a message saying what to fix. Hidden fields still send their values. */
const readTrust = (f) => trustRowFrom((k) => f.get(k), (k) => f.has(k));

async function refreshTrust(sb, form) {
  const [t, log] = await Promise.all([
    must(sb.from('trust_settings').select('reliability_started_at').eq('id', 1).single()),
    must(sb.from('trust_settings_log').select('setting,from_value,to_value,staff_name,created_at').order('created_at', { ascending: false }).limit(TRUST_LOG_SHOW)),
  ]);
  form.elements.reliability_started_at.value = t.reliability_started_at;
  $('[data-trust-log]', form).innerHTML = trustLogHtml(log);
}

/** One font slot: built-in fonts that suit it, or the shop's own file (uploaded on the spot). */
function fontPicker({ slot, label, hint, default: dflt }, pick = {}) {
  const id = uid('font');
  const groups = [...new Set(FONT_LIBRARY.map((f) => f.group))];
  const chosen = pick.upload ? 'upload' : FONT_LIBRARY.some((f) => f.id === pick.font && f.slots.includes(slot)) ? pick.font : dflt;
  const options = groups.map((g) => {
    const fonts = FONT_LIBRARY.filter((f) => f.group === g && f.slots.includes(slot));
    return fonts.length ? `<optgroup label="${esc(g)}">${fonts.map((f) => `<option value="${f.id}"${f.id === chosen ? ' selected' : ''}>${esc(f.name)}${f.id === dflt ? ' (default)' : ''}</option>`).join('')}</optgroup>` : '';
  }).join('');
  return `<div class="field font-pick" data-font-slot="${slot}">
    <label for="${id}">${esc(label)}</label>
    <select id="${id}" data-font-select>${options}<optgroup label="Your own"><option value="upload"${chosen === 'upload' ? ' selected' : ''}>Your own font file…</option></optgroup></select>
    <p class="field__hint">${esc(hint)}</p>
    <div class="font-pick__options">
      ${radioRow(`${id}-size`, 'Size', SIZES, pick.size ?? 'medium', 'data-font-size')}
      ${radioRow(`${id}-sp`, 'Letter spacing', SPACING, pick.spacing ?? 'normal', 'data-font-spacing')}
    </div>
    <div class="font-pick__upload"${chosen === 'upload' ? '' : ' hidden'}>
      <input id="${id}-file" type="file" accept=".woff2,.woff,font/woff2,font/woff" class="visually-hidden">
      <label class="btn btn--ghost btn--small" for="${id}-file">Upload font file…</label>
      <span class="font-pick__file" data-font-file>${pick.upload ? esc(pick.name || 'Uploaded font') : 'No file yet'}</span>
      <span class="admin-status" role="status"></span>
    </div>
    ${slot === 'display' ? `<div class="field--check mt-8"><input id="${id}-caps" type="checkbox" data-font-caps${pick.caps === false ? '' : ' checked'}><label for="${id}-caps">Headlines in capitals</label></div>` : ''}
  </div>`;
}

/** A row of radio buttons for one font option (Size, Letter spacing); the value is read from the checked one. */
function radioRow(name, legend, choices, checked, attr) {
  return `<fieldset class="font-pick__choice" ${attr}><legend>${esc(legend)}</legend><span class="font-pick__radios">${choices.map(([v, text]) => `<label><input type="radio" name="${name}" value="${v}"${v === checked ? ' checked' : ''}> ${esc(text)}</label>`).join('')}</span></fieldset>`;
}

/**
 * The Fonts fold: shows the upload controls for "Your own font file", uploads it to the shop's storage, and keeps the
 * preview in the chosen fonts and colors. get() returns the settings.fonts value, or an error message.
 */
function setupFonts(form, saved, colorOf) {
  const uploads = Object.fromEntries(FONT_SLOTS.map(({ slot }) => [slot, saved[slot]?.upload ? { upload: saved[slot].upload, name: saved[slot].name } : null]));
  const preview = $('[data-font-preview]', form);
  previewFaces ??= document.head.appendChild(document.createElement('style')); // one for the page, kept between visits
  const box = (slot) => $(`[data-font-slot="${slot}"]`, form);
  const choice = (slot) => $('[data-font-select]', box(slot)).value;
  const spacing = (slot) => $('[data-font-spacing] input:checked', box(slot)).value;
  const size = (slot) => $('[data-font-size] input:checked', box(slot)).value;

  const paint = () => {
    const css = [];
    for (const { slot, default: dflt } of FONT_SLOTS) {
      const v = choice(slot);
      const lib = FONT_LIBRARY.find((f) => f.id === (v === 'upload' ? dflt : v));
      const file = v === 'upload' && uploads[slot] ? uploads[slot].upload : `../fonts/${lib.file}`;
      const family = `Preview ${slot}`;
      css.push(`@font-face{font-family:'${family}';font-weight:${v === 'upload' || !lib.weight ? '100 900' : lib.weight};src:url(${file})}`);
      preview.style.setProperty(PREVIEW_VARS[slot], `'${family}', ${lib.fallback}`);
      const display = v === 'upload' && uploads[slot] ? [700, '0em'] : lib.display; // as js/theme-vars.js resolveFonts
      preview.style.setProperty(PREVIEW_TRACKING[slot], `${letterSpacing(slot, spacing(slot), display).toFixed(3)}em`);
      const own = v === 'upload' ? 1 : fontScale(slot, v); // the font's own size adjustment, as on the site
      preview.style.setProperty(PREVIEW_SCALE[slot], (own * sizeScale(slot, size(slot))).toFixed(3));
      if (slot === 'display') {
        preview.style.setProperty('--pv-display-weight', display[0]);
        preview.style.setProperty('--pv-display-case', $('[data-font-caps]', box(slot)).checked ? 'uppercase' : 'none');
      }
    }
    previewFaces.textContent = css.join('\n');
    preview.style.background = colorOf('paper');
    preview.style.color = colorOf('ink');
  };

  for (const { slot } of FONT_SLOTS) {
    const el = box(slot);
    $('[data-font-select]', el).addEventListener('change', (e) => ($('.font-pick__upload', el).hidden = e.target.value !== 'upload'));
    $('input[type=file]', el).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const status = $('.admin-status', el);
      const ext = file.name.toLowerCase().match(/\.(woff2?)$/)?.[1];
      if (!ext) return setStatus(status, 'Choose a .woff2 or .woff font file.', 'error');
      if (file.size > FONT_MAX_KB * 1024) return setStatus(status, `That file is ${Math.ceil(file.size / 1024)} KB; the most is ${FONT_MAX_KB} KB.`, 'error');
      setStatus(status, 'Uploading…');
      try {
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
        const path = `fonts/${Date.now().toString(36)}-${slugify(name) || 'font'}.${ext}`;
        const url = await putMedia(await db(), path, file, { contentType: `font/${ext}`, cacheControl: '31536000' });
        if (!isFontUpload(url, SUPABASE_URL)) throw new Error('The font was stored somewhere the site can’t use it from.');
        uploads[slot] = { upload: url, name };
        $('[data-font-file]', el).textContent = name;
        setStatus(status, '');
        paint();
        form.dispatchEvent(new Event('change')); // unsaved changes
      } catch (err) {
        setStatus(status, friendlyError(err), 'error');
      }
    });
  }
  form.addEventListener('change', paint);
  form.addEventListener('input', paint);
  paint();

  return {
    get() {
      const out = {};
      for (const { slot, label, default: dflt } of FONT_SLOTS) {
        const v = choice(slot);
        if (v === 'upload') {
          if (!uploads[slot]) return `${label}: upload a font file, or pick one of the built-in fonts.`;
          out[slot] = { ...uploads[slot] };
        } else if (v !== dflt) out[slot] = { font: v };
        if (spacing(slot) !== 'normal') out[slot] = { ...out[slot], spacing: spacing(slot) };
        if (size(slot) !== 'medium') out[slot] = { ...out[slot], size: size(slot) };
      }
      if (!$('[data-font-caps]', box('display')).checked) out.display = { ...out.display, caps: false };
      return out;
    },
  };
}

function addTier(box, t) {
  const row = document.createElement('div');
  row.className = 'tier-row';
  const n = uid('f');
  row.innerHTML = `
    <div class="field"><label for="tmin-${n}">From this many series</label><input id="tmin-${n}" type="number" min="1" max="1000" step="1" data-min value="${esc(t.min)}"></div>
    <div class="field"><label for="tpct-${n}">Percent off</label><input id="tpct-${n}" type="number" min="0" max="100" step="1" data-pct value="${esc(t.pct)}"></div>
    <button class="btn btn--danger btn--small" type="button" aria-label="Remove this tier">${solidIcon('remove', 16)} Remove</button>`;
  $('button', row).addEventListener('click', () => {
    row.remove();
    dirty = true;
  });
  box.append(row);
}

function addHours(box, h) {
  const row = document.createElement('div');
  row.className = 'hours-row';
  const n = uid('f');
  row.innerHTML = `
    <div class="hours-row__days" role="group" aria-label="Days">${DAYS.map(([d, label]) => `<label class="chip"><input type="checkbox" data-day="${d}"${h.days?.includes(d) ? ' checked' : ''}> ${label}</label>`).join('')}</div>
    <div class="field"><label for="open-${n}">Open</label><input id="open-${n}" type="time" data-open value="${esc(h.open)}"></div>
    <div class="field"><label for="close-${n}">Close</label><input id="close-${n}" type="time" data-close value="${esc(h.close)}"></div>
    <button class="btn btn--danger btn--small" type="button" aria-label="Remove these hours">${solidIcon('remove', 16)} Remove</button>`;
  $('button', row).addEventListener('click', () => {
    if (!confirm('Remove these opening hours? The change is saved when you save Settings.')) return;
    row.remove();
    dirty = true;
  });
  box.append(row);
}

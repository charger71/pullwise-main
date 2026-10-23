// Shop settings: everything customer pages read from the settings row — name,
// contact, hours, socials, map, logo and colors, and the reservation rules.

import { SOCIAL_ICONS } from '../../js/social-icons.js';
import { tiersFrom } from '../../js/discount.js';
import { contrast } from '../theme.js';
import { $, $$, esc, must, toast, imageField, setStatus, settingsField, formReaders, solidIcon, friendlyError, setupTabs } from '../lib.js';

const DAYS = [['Mo', 'Mon'], ['Tu', 'Tue'], ['We', 'Wed'], ['Th', 'Thu'], ['Fr', 'Fri'], ['Sa', 'Sat'], ['Su', 'Sun']];
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const COLORS = [['primary', 'Main color (buttons, highlights)'], ['accent', 'Accent (banner, badges)'], ['ink', 'Text'], ['paper', 'Page background'], ['footer', 'Footer background']];
const COLOR_DEFAULTS = { primary: '#982c21', accent: '#e7b84b', ink: '#f4f0ea', paper: '#121212', footer: '#121212', link: '#91bbdd' };

let dirty = false;
export const hasUnsavedChanges = () => dirty;

export async function mount(el, { sb }) {
  dirty = false;
  const [s, notice] = await Promise.all([
    must(sb.from('settings').select('*').eq('id', 1).single()),
    // The staff notice has its own staff-only table (settings can be read by anyone).
    must(sb.from('staff_notice').select('notice').eq('id', 1).maybeSingle()),
  ]);
  const field = settingsField({ ...s, admin_notice: notice?.notice });

  el.innerHTML = `
    <h1>Shop Settings</h1>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="shop">Shop</button>
      <button type="button" class="admin-tab" role="tab" data-tab="look">Logo &amp; Colors</button>
      <button type="button" class="admin-tab" role="tab" data-tab="online">Online</button>
      <button type="button" class="admin-tab" role="tab" data-tab="stock">Pre-Orders &amp; Stock</button>
    </div>
    <form class="admin-form settings-form" novalidate>
      <div data-tabpane="shop">
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Admin Notice</h2></summary><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('admin_notice', 'Notice for staff', 'maxlength="500"', 'Shown in a gold bar at the very top of every admin page. Staff only — customers never see it. Leave blank to hide it.', 'field--full')}
      </div></div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Shop</h2></summary><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('shop_name', 'Shop name', 'required', '', 'field--full')}
        ${field('founded_year', 'Open since (year)', 'type="number" min="1900" max="2100" inputmode="numeric"')}
        ${field('tagline', 'Tagline', '', 'Shown under the home page headline and in browser tabs.', 'field--full')}
        ${field('copyright_text', 'Footer copyright', 'maxlength="200"', 'Shown at the very bottom of every page. Type {year} to always show the current year, e.g. “© {year} Pop’s Comics &amp; Collectibles. All rights reserved.” Leave blank for “© year shop name”.', 'field--full')}
        ${field('hero_headline', 'Home page headline', '', 'Wrap words in *asterisks* to show them in the accent color.', 'field--full')}
      </div></div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Contact &amp; Address</h2></summary><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('phone', 'Phone', 'type="tel"', '', 'field--full')}
        ${field('email', 'Email', 'type="email"', '', 'field--full')}
        ${field('street', 'Street address', 'autocapitalize="words"', '', 'field--full')}
        ${field('city', 'City', 'autocapitalize="words"')}
        ${field('region', 'State', 'autocapitalize="words"')}
        ${field('postal_code', 'ZIP code', 'inputmode="numeric"')}
      </div></div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Opening Hours</h2></summary><div class="fold__body">
        <div data-hours></div>
        <button class="btn btn--add btn--small" type="button" data-add-hours>${solidIcon('add', 16)} Add hours</button>
      </div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Map</h2></summary><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field field--full"><label><input type="checkbox" name="show_map"${s.show_map ? ' checked' : ''}> Show a Google Map on the Home and Visit pages</label></div>
        ${field('map_embed_url', 'Custom map link (optional)', 'type="url" placeholder="https://www.google.com/maps/embed?…"', 'From Google Maps: Share → Embed a map → copy the link inside src="…". Leave blank to map the address.', 'field--full')}
      </div></div></details>
      </div>
      <div data-tabpane="look">
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Logo &amp; Colors</h2></summary><div class="fold__body">
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
      </div></details>
      </div>
      <div data-tabpane="online">
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Social Media</h2></summary><div class="fold__body">
        <p class="field__hint">Full profile links. Leave blank to hide a network.</p>
        <div class="form-grid">${Object.entries(SOCIAL_ICONS).map(([k, { label }]) => `<div class="field"><label for="soc-${k}">${esc(label)}</label><input id="soc-${k}" data-social="${k}" type="url" placeholder="https://…" value="${esc(s.socials?.[k])}"></div>`).join('')}</div>
      </div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Google Analytics</h2></summary><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('ga_measurement_id', 'Measurement ID', 'placeholder="G-XXXXXXXXXX" pattern="G-[A-Za-z0-9]+" autocomplete="off"', 'From Google Analytics: Admin → Data streams → your website. Tracking runs on every public page; leave blank to turn it off.', 'field--full')}
      </div></div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Footer Code</h2></summary><div class="fold__body"><div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="s-footer-scripts">Code for the bottom of every page</label>
          <textarea id="s-footer-scripts" name="footer_scripts" rows="8" maxlength="20000" spellcheck="false" autocomplete="off" placeholder="&lt;script src=&quot;https://…&quot;&gt;&lt;/script&gt;" style="font-family:monospace">${esc(s.footer_scripts)}</textarea>
          <p class="field__hint">Paste the snippet a service gives you (a help chat, for example), including its &lt;script&gt; tags. It runs on every public page, but not in the admin. <strong>Only paste code from a source you trust:</strong> it can see everything a customer sees. A mistake here can break the site, so if pages misbehave, clear this box and save. Leave blank for none.</p></div>
      </div></div></details>
      </div>
      <div data-tabpane="stock">
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Pre-orders &amp; Stock</h2></summary><div class="fold__body"><div class="form-grid form-grid--pairs">
        ${field('max_copies_per_title', 'Copies per customer per title', 'type="number" min="1" max="100" inputmode="numeric"')}
        ${field('hold_days', 'Hold reservations after arrival (days)', 'type="number" min="1" max="365" inputmode="numeric"')}
        <div class="field field--full"><label for="s-timezone">Shop time zone</label><select id="s-timezone" name="timezone">${[...new Set([s.timezone, ...ZONES])].filter(Boolean).map((z) => `<option${z === s.timezone ? ' selected' : ''}>${z}</option>`).join('')}</select><p class="field__hint">Reservations close at midnight shop time on the Saturday before each order cutoff (FOC).</p></div>
        <div class="field span-2"><label for="s-pinned">Publishers pinned to the top of the Publisher filter</label><textarea id="s-pinned" name="pinned_publishers" rows="3">${esc((s.pinned_publishers ?? []).join(', '))}</textarea><p class="field__hint">Comma-separated, in order — spelled as they appear in the filter.</p></div>
      </div></div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Pull List Discount</h2></summary><div class="fold__body">
        <div class="field"><label><input type="checkbox" name="discount_enabled"${s.discount_enabled === false ? '' : ' checked'}> Give customers a discount based on how many series are on their pull list</label>
        <p class="field__hint">Shown on My Pull List and in the pull list emails and printed pull lists. Unticked, no discount is shown or applied anywhere (your tiers are kept).</p></div>
        <div data-tiers></div>
        <button class="btn btn--add btn--small mt-14" type="button" data-add-tier>${solidIcon('add', 16)} Add a tier</button>
        <p class="field__hint">Each tier starts at a number of different series on the customer’s active pull list and gives that percent off the cover-price total until the next tier starts. Start numbers must go up. Toys and anything without a series don’t count toward the number.</p>
      </div></details>
      </div>

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
  setupTabs(el, 'admin-settings-tab', 'shop');

  $('[data-link-auto]', form).addEventListener('change', (e) => ($('#c-link', form).disabled = e.target.checked));

  // Accessibility check of the colors as picked (WCAG: 4.5:1 for text, 3:1 for large or bold text), updated as you pick.
  const val = (k) => $(`[data-color="${k}"]`, form).value;
  const light = (hex) => contrast(hex, '#000000') > contrast(hex, '#ffffff');
  const checkContrast = () => {
    const paper = val('paper');
    // The same choices the public site makes (applyTheme in js/site.js): the first blue that reads, else its own pick.
    const autoLink = [['#91bbdd', '#b9d5ec', '#ffffff'], ['#0b4f8a', '#08396a', '#000000']][light(paper) ? 1 : 0];
    const auto = $('[data-link-auto]', form).checked;
    const link = auto ? autoLink.find((c) => contrast(c, paper) >= 4.5) ?? autoLink.at(-1) : val('link');
    const onPrimary = light(val('primary')) ? '#161616' : '#ffffff'; // the site's choice of button text
    const rows = [
      ['Text on the page background', val('ink'), paper, 4.5],
      [`Text links on the page background${auto ? ' (automatic)' : ''}`, link, paper, 4.5],
      ['Button text on the main color', onPrimary, val('primary'), 4.5],
      ['Accent on the page background (headings, highlights)', val('accent'), paper, 3],
      ['Accent on the footer background (footer headings)', val('accent'), val('footer'), 3],
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

    const row = {
      shop_name: text('shop_name'), tagline: text('tagline'), hero_headline: text('hero_headline'), copyright_text: text('copyright_text'), footer_scripts: text('footer_scripts'), founded_year: int('founded_year', null),
      phone: text('phone'), email: text('email'), street: text('street'), city: text('city'), region: text('region'), postal_code: text('postal_code'),
      hours, socials, colors, logo_url: logo.get(), favicon_url: favicon.get(), show_name_with_logo: f.has('show_name_with_logo'), hero_image_url: hero.get(), show_map: f.has('show_map'), map_embed_url: mapUrl, ga_measurement_id: gaId,
      max_copies_per_title: int('max_copies_per_title', 10), hold_days: int('hold_days', 30),
      timezone: f.get('timezone'),
      discount_enabled: f.has('discount_enabled'), discount_tiers: tiers,
      pinned_publishers: (text('pinned_publishers') ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    };
    setStatus(status, 'Saving…');
    try {
      const adminNotice = text('admin_notice');
      // Row-level security turns an update by a signed-out (or non-owner) session into "0 rows", not an error.
      const notSaved = () => Object.assign(new Error('You may have been signed out. Sign in again, then save once more.'), { code: 'P0001' });
      if (!(await must(sb.from('settings').update(row).eq('id', 1).select('id')))?.length) throw notSaved();
      if (!(await must(sb.from('staff_notice').update({ notice: adminNotice }).eq('id', 1).select('id')))?.length) throw notSaved();
      dirty = false;
      window.dispatchEvent(new CustomEvent('admin-notice', { detail: adminNotice }));
      setStatus(status, `Saved ${new Date().toLocaleTimeString()} — live on the site now.`, 'ok');
      toast('Settings saved');
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
}

function addTier(box, t) {
  const row = document.createElement('div');
  row.className = 'tier-row';
  const n = Math.random().toString(36).slice(2);
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
  const n = Math.random().toString(36).slice(2);
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

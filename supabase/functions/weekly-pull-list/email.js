// Builds one customer's weekly pull-list email. Pure functions (no network, no Deno
// APIs) so they can be tested with plain Node:  node supabase/functions/weekly-pull-list/email.test.js

import { followedSeries, discountFor, totals, tiersFrom } from './discount.js';

// Kept in step with worker/shop-page.js (a Supabase function is deployed on its own, so it can't import from worker/);
// email.test.js checks they agree.
export const EMAIL_LOGO_PATH = '/__email-logo';
export const STORAGE_SERVE_PATH = '/__sb/';
/** A cover kept in the shop's own Supabase Storage ("media" bucket, covers/ or series/), as the same picture on the shop's domain; else the address as it was. */
export function ownDomainStorage(url, storageBase, siteBase) {
  const prefix = `${String(storageBase ?? '').replace(/\/+$/, '')}/storage/v1/object/public/media/`;
  const own = String(siteBase ?? '').replace(/\/+$/, '');
  if (!storageBase || !own || typeof url !== 'string' || !url.startsWith(prefix)) return url;
  const path = url.slice(prefix.length);
  // The same rules as the Worker (worker/shop-page.js storagePath): covers/ or series/, plain names, an image extension.
  const parts = path.split('/');
  const ok = ['covers', 'series'].includes(parts[0]) && parts.length >= 2 && parts.every((p) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(p)) && /\.(jpe?g|png|webp|gif)$/i.test(parts.at(-1)) && path.length <= 300;
  return ok ? `${own}${STORAGE_SERVE_PATH}${path}` : url;
}
export function ownDomainImage(url, publicBase, siteBase) {
  const base = String(publicBase ?? '').replace(/\/+$/, '');
  const own = String(siteBase ?? '').replace(/\/+$/, '');
  if (!base || !own || typeof url !== 'string' || !url.startsWith(`${base}/`)) return url;
  return `${own}/__img/${url.slice(base.length + 1)}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// YYYY-MM-DD helpers (calendar dates, no time zones)
const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => fmt(new Date(parse(iso).getTime() + n * 86400000));
const dow = (iso) => parse(iso).getUTCDay(); // 0 = Sunday

/** Last day a customer can still change a title whose FOC is `foc`: the Saturday before it (as on the site). */
export const lastChangeDay = (foc) => addDays(foc, -(dow(foc) === 6 ? 7 : dow(foc) + 1));

export const dayLabel = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  parse(iso).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

const titleOf = (item) => [item.title, item.issue_number && `#${item.issue_number}`].filter(Boolean).join(' ');

const SOURCE_NOTE = { variant: 'all covers', series: 'from a series you follow', artist: 'from an artist you follow' };

/**
 * Sort a customer's active lines into the email's sections.
 * `lines`: [{ id, quantity, status, arrived_on, source, created_at, item: { title, issue_number, variant, release_date, foc_date, price, cover_url } }]
 * Returns null when there is nothing worth emailing about.
 */
export function sections(lines, { today, holdDays = 30, follows = [] }) {
  const ready = [];
  const soon = [];
  const later = [];
  const weekAhead = addDays(today, 6); // Thursday through next Wednesday
  const weekAgo = addDays(today, -7);
  for (const l of lines) {
    if (!l.item) continue;
    const entry = {
      title: titleOf(l.item),
      variant: l.item.variant,
      quantity: l.quantity,
      price: l.item.price,
      out: l.item.release_date,
      note: SOURCE_NOTE[l.source] ?? null,
      cover: l.item.cover_url ?? null,
      coverThumb: l.item.cover_thumb_url ?? null,
      isNew: ['series', 'artist', 'variant', 'staff'].includes(l.source) && String(l.created_at ?? '').slice(0, 10) >= weekAgo,
    };
    if (l.status === 'arrived') {
      entry.holdUntil = l.arrived_on ? addDays(l.arrived_on, holdDays) : null;
      ready.push(entry);
    } else if (['open', 'ordered', 'reordered'].includes(l.status)) {
      const changeBy = l.status === 'open' && l.item.foc_date ? lastChangeDay(l.item.foc_date) : null;
      entry.changeBy = changeBy && changeBy >= today ? changeBy : null;
      // A title a follow added this week, still open for changes: the email can offer a one-tap Skip.
      if (l.id && entry.isNew && entry.changeBy && l.status === 'open' && ['series', 'artist'].includes(l.source)) entry.skipId = l.id;
      if (l.status !== 'reordered' && l.item.release_date && l.item.release_date <= weekAhead) soon.push(entry);
      else later.push(entry);
    }
  }
  if (!ready.length && !soon.length && !later.length) return null;
  const series = followedSeries(follows);
  const byTitle = (a, b) => a.title.localeCompare(b.title) || (a.variant ?? '').localeCompare(b.variant ?? '');
  ready.sort((a, b) => (a.holdUntil ?? '9').localeCompare(b.holdUntil ?? '9') || byTitle(a, b));
  soon.sort((a, b) => (a.out ?? '9').localeCompare(b.out ?? '9') || byTitle(a, b));
  later.sort((a, b) => (a.out ?? '9').localeCompare(b.out ?? '9') || byTitle(a, b));
  return { ready, soon, later, series };
}

/** Discount tier for a series count: { pct, line } where line says what they have and what the next tier needs ('' when no series). */
export function tierNote(series, tiers) {
  const { pct, next } = discountFor(series, tiers);
  if (!series || !tiers.length) return { pct, line: '' };
  const have = `You follow ${plural(series, 'series', 'series')}: ${pct}% off.`;
  return { pct, line: next ? `${have} Follow ${next.more} more to get ${next.pct}% off.` : `${have} That's our top discount!` };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The shop logo as a small (96px) copy for email: Supabase Storage resizes it on the fly, so the 800px original isn't downloaded. */
export function logoSrc(url) {
  if (!/^https:\/\//.test(url ?? '')) return null;
  return url.includes('/storage/v1/object/public/') ? `${url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=96&height=96&resize=contain` : url;
}

const HEX = /^#[0-9a-f]{6}$/i;
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** White or near-black, whichever reads better on `bg`. */
const textOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#161616') ? '#ffffff' : '#161616');

/**
 * Logo and colors for the emails (Admin → Emails → Look). Anything left blank follows the site:
 * the site logo and its main color. Text colors are picked automatically so they stay readable.
 */
export function emailLook(shop, siteUrl = '') {
  const site = HEX.test(shop.colors?.primary ?? '') ? shop.colors.primary : '#c8102e';
  const header = HEX.test(shop.email_header_color ?? '') ? shop.email_header_color : site;
  const button = HEX.test(shop.email_button_color ?? '') ? shop.email_button_color : site;
  const page = HEX.test(shop.email_page_color ?? '') ? shop.email_page_color : '#f4f1ea';
  const body = HEX.test(shop.email_body_color ?? '') ? shop.email_body_color : '#ffffff';
  const dark = textOn(body) === '#ffffff';
  return {
    page,
    body,
    text: textOn(body),
    muted: dark ? '#c9c9c9' : '#5b5b5b',
    rule: dark ? '#4a4a4a' : '#eeeeee',
    // From the shop's own domain when we know it (the Worker serves it: worker/index.js): mail from a shop's domain
    // that pulls its logo from another one (supabase.co) is more likely to be filed as spam.
    logo: !(shop.email_logo_url || shop.logo_url) ? null : /^https:\/\//.test(siteUrl) ? `${siteUrl.replace(/\/+$/, '')}${EMAIL_LOGO_PATH}` : logoSrc(shop.email_logo_url || shop.logo_url),
    header,
    headerText: textOn(header),
    button,
    buttonText: textOn(button),
    // Section titles sit on the body color, so a button color that doesn't stand out from it falls back to plain text.
    title: contrast(button, body) >= 3 ? button : textOn(body),
    night: nightPalette({ page, body, button }),
  };
}

/**
 * The colors a mail app in dark mode gets (@media (prefers-color-scheme: dark), below). The shop's brand colors (header
 * band, button) are kept; a light page or body turns dark, and a page or body the shop already made dark is left as it
 * is. Text, muted text, rules and section titles are worked out again for the dark body so they stay readable.
 */
function nightPalette({ page, body, button }) {
  const nightPage = luminance(page) > 0.2 ? '#121212' : page;
  const nightBody = luminance(body) > 0.2 ? '#1e1e1e' : body;
  const light = textOn(nightBody) === '#ffffff';
  return {
    page: nightPage,
    body: nightBody,
    text: textOn(nightBody),
    muted: light ? '#c9c9c9' : '#5b5b5b',
    rule: light ? '#4a4a4a' : '#eeeeee',
    title: contrast(button, nightBody) >= 3 ? button : textOn(nightBody),
  };
}

/**
 * Hidden "preview text": what an inbox shows after the subject. Without it the inbox shows the greeting ("Hi Jo, …"). The
 * filler stops the app pulling the first lines of the visible email in after it.
 */
const preheader = (text) => `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0">${esc(text)}${'&zwnj;&nbsp;'.repeat(40)}</div>`;

/** "Absolute Batman #25, Saga #70 and 3 more" */
function titlesBlurb(entries, max = 2) {
  const names = entries.slice(0, max).map((e) => e.title);
  const more = entries.length - names.length;
  return names.join(', ') + (more > 0 ? ` and ${more} more` : '');
}

/**
 * The <head> of every email: a phone-width viewport, a declaration that the email has both a light and a dark look, and the
 * rules for both. Colors in the markup are inline (so every mail app shows the light look); the pw-* classes let a dark-mode
 * app swap them, and a narrow screen tighten the padding. Apps that ignore <style> (some Outlooks) just show the light look.
 */
export function emailHead(look, title = '') {
  const n = look.night;
  return `<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{-webkit-text-size-adjust:100%;margin:0}
img{-ms-interpolation-mode:bicubic}
@media (max-width:520px){
.pw-outer{padding:8px!important}
.pw-pad{padding-left:16px!important;padding-right:16px!important}
.pw-btn{display:block!important}
}
@media (prefers-color-scheme:dark){
.pw-page{background:${n.page}!important}
.pw-body{background:${n.body}!important}
.pw-text{color:${n.text}!important}
.pw-muted{color:${n.muted}!important}
.pw-title{color:${n.title}!important}
.pw-rule{border-color:${n.rule}!important}
.pw-fill{background:${n.rule}!important}
}
</style>`;
}

/** The coloured band at the top of every email: logo (when there is one) and the shop name. */
function header(shop, look) {
  const name = esc(shop.shop_name);
  return `<tr><td style="background:${look.header};padding:14px 24px;border-radius:6px 6px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>${look.logo ? `<td style="padding-right:12px"><img src="${esc(look.logo)}" width="48" height="48" alt="" style="display:block;border:0;border-radius:6px"></td>` : ''}
        <td style="font:bold 20px Arial,Helvetica,sans-serif;color:${look.headerText}">${name}</td></tr></table></td></tr>`;
}

export function subject(sec, shopName) {
  const parts = [];
  if (sec.ready.length) parts.push(`${sec.ready.length} ready for pickup`);
  if (sec.soon.length) parts.push(`${sec.soon.length} coming this week`);
  if (!parts.length) parts.push(`${plural(sec.later.length, 'title')} coming up`);
  return `Your ${shopName} pull list: ${parts.join(', ')}`;
}

// A cover is 2:3. Its box has a fixed size, with a quiet fill, so the title and details sit in the same place before the picture
// loads (or while a mail app's preview holds it back) and nothing jumps when it arrives.
const COVER_W = 44;
const COVER_H = 66;
// The title's small thumbnail when it has one (a lighter file), else its cover; either only when it is on the shared images
// domain or in the shop's own Supabase Storage, so it can come from the shop's own domain.
const coverSrc = (e, siteUrl, mediaBase, storageBase) => {
  if (!/^https:\/\//.test(siteUrl)) return null;
  for (const url of [e.coverThumb, e.cover]) {
    const src = url ? ownDomainStorage(ownDomainImage(url, mediaBase, siteUrl), storageBase, siteUrl) : null;
    if (src && src !== url) return src;
  }
  return null;
};
/** Whether any title in the list has a cover served from the shop's own domain: only then do the rows get a cover column. */
const anyCover = (entries, siteUrl, mediaBase, storageBase) => entries.some((e) => coverSrc(e, siteUrl, mediaBase, storageBase));

/**
 * A title's cover box: the picture when it can come from the shop's own domain, else an empty box the same size (when the email
 * shows covers). Most mail apps get the picture filling the fixed box (object-fit: cover crops one that isn't 2:3). Outlook for
 * Windows (the Word engine, matched by [if mso]) ignores object-fit and stretches an image to its width AND height attributes,
 * so it gets the width alone and keeps the cover's own shape; the cell's height holds the row steady until it loads.
 */
function coverCell(e, look, siteUrl, mediaBase, storageBase, show) {
  if (!show) return '';
  const src = coverSrc(e, siteUrl, mediaBase, storageBase);
  const box = `display:block;width:${COVER_W}px;height:${COVER_H}px;background:${look.rule};border-radius:3px`;
  const inner = src
    ? `<!--[if mso]><img src="${esc(src)}" width="${COVER_W}" alt="" style="display:block;border:0"><![endif]--><!--[if !mso]><!--><img class="pw-fill" src="${esc(src)}" width="${COVER_W}" height="${COVER_H}" alt="" style="${box};border:0;object-fit:cover"><!--<![endif]-->`
    : `<div class="pw-fill" style="${box};font-size:0;line-height:0">&nbsp;</div>`;
  return `<td width="${COVER_W + 12}" height="${COVER_H}" valign="top" class="pw-rule" style="padding:8px 12px 8px 0;border-bottom:1px solid ${look.rule}">${inner}</td>`;
}
/** One title's row: [cover] details. The details cell carries the row's bottom rule. */
const titleRow = (cover, inner, look) => `<tr>${cover}<td class="pw-text pw-rule" style="padding:8px 0;border-bottom:1px solid ${look.rule};font:15px/1.4 Arial,Helvetica,sans-serif;color:${look.text}">${inner}</td></tr>`;

const line = (e, kind) => {
  const bits = [
    e.variant,
    e.quantity > 1 && `${e.quantity} copies`,
    kind === 'ready' && e.holdUntil && `held until ${dayLabel(e.holdUntil, { month: 'short', day: 'numeric' })}`,
    kind !== 'ready' && e.out && `out ${dayLabel(e.out)}`,
    e.changeBy && `change by ${dayLabel(e.changeBy)}`,
    e.note,
  ].filter(Boolean);
  return { head: e.title + (e.isNew ? '  [NEW]' : ''), bits: bits.join(' · '), isNew: e.isNew };
};

const SECTION_TITLES = {
  ready: 'Ready for pickup',
  soon: 'Coming this week',
  later: 'Coming up',
};

/** @returns {{ subject: string, html: string, text: string }} */
export function build({ customer, sections: sec, shop, today, manageUrl, unsubscribeUrl, app = true, skipUrl = null, siteUrl = '', mediaBase = '', storageBase = '' }) {
  const look = emailLook(shop, siteUrl);
  const accent = /^#[0-9a-f]{6}$/i.test(shop.colors?.accent ?? '') ? shop.colors.accent : '#ffd100';
  const subj = subject(sec, shop.shop_name);
  const hello = customer.first_name ? `Hi ${customer.first_name},` : 'Hi,';
  const addr = [shop.street, [shop.city, shop.region].filter(Boolean).join(', ') + (shop.postal_code ? ` ${shop.postal_code}` : '')].filter((l) => l && l.trim());
  const tier = tierNote(sec.series ?? 0, tiersFrom(shop));
  const appUrl = manageUrl.replace(/\/account\.html$/, '/app'); // the shop's pull list app, next to the account page
  const shipNote = customer.ship_arrivals ? 'We’ll ship your ready books to the address on your profile.' : null;

  const showCovers = anyCover([...sec.ready, ...sec.soon, ...sec.later], siteUrl, mediaBase, storageBase);
  const block = (key) => {
    if (!sec[key].length) return '';
    const rows = sec[key]
      .map((e) => {
        const l = line(e, key);
        const skip = skipUrl && e.skipId ? skipUrl(e.skipId) : null;
        return titleRow(coverCell(e, look, siteUrl, mediaBase, storageBase, showCovers), `<strong>${esc(e.title)}</strong>${e.isNew ? ` <span style="background:${accent};color:#161616;font-size:11px;font-weight:bold;padding:1px 6px;border-radius:3px">NEW</span>` : ''}
          ${l.bits ? `<br><span class="pw-muted" style="color:${look.muted};font-size:13px">${esc(l.bits)}</span>` : ''}
          ${skip ? `<br><a href="${esc(skip)}" class="pw-text" style="color:${look.text};font-size:13px;font-weight:bold">Skip this one</a> <span class="pw-muted" style="color:${look.muted};font-size:13px">(takes it off your list)</span>` : ''}`, look);
      })
      .join('');
    return `<h2 class="pw-title" style="margin:24px 0 4px;font:bold 17px Arial,Helvetica,sans-serif;color:${look.title}">${SECTION_TITLES[key]} (${sec[key].length})</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  };

  const html = `<!doctype html><html lang="en"><head>${emailHead(look, subj)}</head><body class="pw-page" style="margin:0;background:${look.page}">${preheader(sec.ready.length ? `${titlesBlurb(sec.ready)} ${sec.ready.length === 1 ? 'is' : 'are'} ready for pickup at ${shop.shop_name}` : sec.soon.length ? `Coming this week: ${titlesBlurb(sec.soon)}` : `Coming up: ${titlesBlurb(sec.later)}`)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pw-page" style="background:${look.page}"><tr><td align="center" class="pw-outer" style="padding:16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="pw-body" style="max-width:600px;width:100%;background:${look.body};border-radius:6px">
      ${header(shop, look)}
      <tr><td class="pw-pad" style="padding:24px">
        <p class="pw-text" style="margin:0 0 8px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${look.text}">${esc(hello)}</p>
        <p class="pw-text" style="margin:0;font:16px/1.5 Arial,Helvetica,sans-serif;color:${look.text}">Here’s your pull list for the week of ${esc(dayLabel(today, { month: 'long', day: 'numeric' }))}.${shipNote ? ` ${esc(shipNote)}` : ''}</p>
        ${block('ready')}${block('soon')}${block('later')}
        ${tier.line ? `<p class="pw-text" style="margin:20px 0 0;font:14px/1.4 Arial,Helvetica,sans-serif;color:${look.text}"><strong>${esc(tier.line)}</strong></p>` : ''}
        <p style="margin:28px 0 0;text-align:center"><a href="${esc(manageUrl)}" class="pw-btn" style="display:inline-block;background:${look.button};color:${look.buttonText};text-decoration:none;font:bold 16px Arial,Helvetica,sans-serif;padding:12px 22px;border-radius:4px">Log in to edit your pull list</a></p>
        <p class="pw-muted" style="margin:12px 0 0;text-align:center;font:13px/1.4 Arial,Helvetica,sans-serif;color:${look.muted}">Change quantities, remove titles, or follow a series or artist. Changes close at midnight the Saturday before each order cutoff.</p>
        ${app ? `<p class="pw-text" style="margin:16px 0 0;text-align:center;font:14px/1.4 Arial,Helvetica,sans-serif;color:${look.text}">On your phone? <a href="${esc(appUrl)}" class="pw-text" style="color:${look.text};font-weight:bold">Get ${esc(shop.shop_name)}’s app</a>: your list in one tap, and a notification when your books are in.</p>` : ''}
      </td></tr>
      <tr><td class="pw-muted pw-rule pw-pad" style="padding:16px 24px;border-top:1px solid ${look.rule};font:12px/1.5 Arial,Helvetica,sans-serif;color:${look.muted}">
        ${esc(shop.shop_name)}${addr.length ? ` · ${esc(addr.join(', '))}` : ''}${shop.phone ? ` · ${esc(shop.phone)}` : ''}<br>
        You’re getting this because you have a pull list at ${esc(shop.shop_name)}. <a href="${esc(unsubscribeUrl)}" class="pw-muted" style="color:${look.muted}">Unsubscribe</a> from this weekly email (you can also turn it off in your profile).
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const textBlock = (key) =>
    sec[key].length
      ? `${SECTION_TITLES[key].toUpperCase()} (${sec[key].length})\n${sec[key].map((e) => { const l = line(e, key); return `- ${l.head}${l.bits ? `\n  ${l.bits}` : ''}${skipUrl && e.skipId ? `\n  Skip this one: ${skipUrl(e.skipId)}` : ''}`; }).join('\n')}\n\n`
      : '';
  const text = `${hello}\n\nHere’s your pull list for the week of ${dayLabel(today, { month: 'long', day: 'numeric' })}.${shipNote ? ` ${shipNote}` : ''}\n\n${textBlock('ready')}${textBlock('soon')}${textBlock('later')}${tier.line ? `${tier.line}\n\n` : ''}Log in to edit your pull list: ${manageUrl}\n\n${app ? `On your phone? Get ${shop.shop_name}’s app (your list in one tap, and a notification when your books are in): ${appUrl}\n\n` : ''}--\n${shop.shop_name}${addr.length ? `, ${addr.join(', ')}` : ''}${shop.phone ? `, ${shop.phone}` : ''}\nUnsubscribe: ${unsubscribeUrl}\n`;

  return { subject: subj, html, text };
}

// ---------------------------------------------------------------------------
// "Your books are in": sent when titles on a customer's pull list become ready for pickup.
// ---------------------------------------------------------------------------

/**
 * Split a customer's lines into titles that just arrived (no email sent yet) and ones still waiting from
 * earlier. Returns null when nothing new has arrived.
 * `lines`: all the customer's active lines { quantity, status, arrived_on, arrival_notified_at, item: { title, issue_number, variant, price, series_key } }; only arrived ones are listed.
 * `follows`: the customer's subscriptions { kind, key }; their series follows set the discount tier.
 */
export function arrivalSections(lines, { holdDays = 30, follows = [] }) {
  const entry = (l) => ({
    title: titleOf(l.item),
    variant: l.item.variant,
    quantity: l.quantity,
    price: l.item.price,
    cover: l.item.cover_url ?? null,
    coverThumb: l.item.cover_thumb_url ?? null,
    holdUntil: l.arrived_on ? addDays(l.arrived_on, holdDays) : null,
  });
  const arrived = lines.filter((l) => l.item && l.status === 'arrived');
  const byTitle = (a, b) => a.title.localeCompare(b.title) || (a.variant ?? '').localeCompare(b.variant ?? '');
  const fresh = arrived.filter((l) => !l.arrival_notified_at).map(entry).sort(byTitle);
  const waiting = arrived.filter((l) => l.arrival_notified_at).map(entry).sort((a, b) => (a.holdUntil ?? '9').localeCompare(b.holdUntil ?? '9') || byTitle(a, b));
  return fresh.length ? { fresh, waiting, series: followedSeries(follows) } : null;
}

export const arrivalSubject = (n, shopName) => `Your books are in at ${shopName}: ${plural(n, 'title')} ready for pickup`;

const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = { Su: 'Sun', Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat' };
const time12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
/**
 * The shop's settings with the address, phone and hours of one location laid over them, so emails read "where" from the
 * location record. A shop with several locations (`multi`) goes by "Shop : Location" ("Area71 Comics & Toys : Elizabethtown").
 * Safe to apply twice: the plain shop name is kept in brand_name.
 */
export function withLocation(shop, location, { multi = false } = {}) {
  if (!location) return shop;
  const { street, city, region, postal_code, country, phone, hours, map_embed_url } = location;
  const brand = shop.brand_name ?? shop.shop_name;
  return { ...shop, street, city, region, postal_code, country, phone, hours, map_embed_url, location_name: location.name, brand_name: brand, shop_name: multi && location.name ? `${brand} : ${location.name}` : brand };
}

/** "Tue–Sat 11 AM – 7 PM", one line per row of the shop's opening hours. */
export function hoursLines(hours = []) {
  return hours
    .filter((h) => h.days?.length && h.open && h.close)
    .map((h) => {
      const idx = h.days.map((d) => DAY_CODES.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b);
      const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
      const label = idx.length > 2 && contiguous ? `${DAY_NAMES[DAY_CODES[idx[0]]]}–${DAY_NAMES[DAY_CODES[idx.at(-1)]]}` : idx.map((i) => DAY_NAMES[DAY_CODES[i]]).join(', ');
      return `${label} ${time12(h.open)} – ${time12(h.close)}`;
    });
}

const money = (n) => `$${Number(n).toFixed(2)}`;

/** @returns {{ subject: string, html: string, text: string }} */
export function buildArrival({ customer, arrival, shop, manageUrl, unsubscribeUrl, sample = false, siteUrl = '', mediaBase = '', storageBase = '' }) {
  const look = emailLook(shop, siteUrl);
  const accent = /^#[0-9a-f]{6}$/i.test(shop.colors?.accent ?? '') ? shop.colors.accent : '#ffd100';
  const { fresh, waiting } = arrival;
  const hello = customer.first_name ? `Hi ${customer.first_name},` : 'Hi,';
  const intro = customer.ship_arrivals
    ? `${plural(fresh.length, 'title')} on your pull list ${fresh.length === 1 ? 'has' : 'have'} arrived. We'll ship ${fresh.length === 1 ? 'it' : 'them'} to the address on your profile.`
    : `${plural(fresh.length, 'title')} on your pull list ${fresh.length === 1 ? 'is' : 'are'} in and ready for pickup. Pay when you pick ${fresh.length === 1 ? 'it' : 'them'} up.`;
  const addr = [shop.street, [shop.city, shop.region].filter(Boolean).join(', ') + (shop.postal_code ? ` ${shop.postal_code}` : '')].filter((l) => l && l.trim());
  const hours = hoursLines(shop.hours);
  const tier = tierNote(arrival.series ?? 0, tiersFrom(shop));
  const { subtotal, discount, total: estimate } = totals(fresh.map((e) => ({ status: 'open', quantity: e.quantity, item: { price: e.price } })), tier.pct);
  const off = tier.pct ? ` Less your ${tier.pct}% pull list discount (−${money(discount)}) from ${money(subtotal)}.` : '';
  const priced = fresh.filter((e) => e.price != null).length;

  const showCovers = anyCover([...fresh, ...waiting], siteUrl, mediaBase, storageBase);
  const bits = (e) => [e.variant, e.quantity > 1 && `${e.quantity} copies`, e.holdUntil && `held until ${dayLabel(e.holdUntil, { month: 'short', day: 'numeric' })}`].filter(Boolean).join(' · ');
  const rows = (list) =>
    list
      .map((e) => titleRow(coverCell(e, look, siteUrl, mediaBase, storageBase, showCovers), `<strong>${esc(e.title)}</strong>${bits(e) ? `<br><span class="pw-muted" style="color:${look.muted};font-size:13px">${esc(bits(e))}</span>` : ''}`, look))
      .join('');
  const block = (title, list, color, cls) =>
    list.length ? `<h2 class="${cls}" style="margin:24px 0 4px;font:bold 17px Arial,Helvetica,sans-serif;color:${color}">${esc(title)} (${list.length})</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows(list)}</table>` : '';

  const subj = `${sample ? '[Sample] ' : ''}${arrivalSubject(fresh.length, shop.shop_name)}`;
  const html = `<!doctype html><html lang="en"><head>${emailHead(look, subj)}</head><body class="pw-page" style="margin:0;background:${look.page}">${preheader(customer.ship_arrivals ? `${titlesBlurb(fresh)} ${fresh.length === 1 ? 'has' : 'have'} arrived and will be shipped to you` : `${titlesBlurb(fresh)} ${fresh.length === 1 ? 'is' : 'are'} ready for pickup at ${shop.shop_name}`)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pw-page" style="background:${look.page}"><tr><td align="center" class="pw-outer" style="padding:16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="pw-body" style="max-width:600px;width:100%;background:${look.body};border-radius:6px">
      ${header(shop, look)}
      <tr><td class="pw-pad" style="padding:24px">
        <p class="pw-text" style="margin:0 0 8px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${look.text}">${esc(hello)}</p>
        <p class="pw-text" style="margin:0;font:16px/1.5 Arial,Helvetica,sans-serif;color:${look.text}"><strong>Your books are in!</strong> ${esc(intro)}</p>
        ${block(customer.ship_arrivals ? 'Just arrived' : 'Ready for pickup', fresh, look.title, 'pw-title')}
        ${priced ? `<p class="pw-text" style="margin:12px 0 0;font:14px/1.4 Arial,Helvetica,sans-serif;color:${look.text}"><strong>Estimated total ${money(estimate)}</strong> <span class="pw-muted" style="color:${look.muted}">at cover price${priced < fresh.length ? ` (${fresh.length - priced} without a price not counted)` : ''}, before tax.${esc(off)}</span></p>` : ''}
        ${tier.line ? `<p class="pw-text" style="margin:8px 0 0;font:14px/1.4 Arial,Helvetica,sans-serif;color:${look.text}">${esc(tier.line)}</p>` : ''}
        ${block('Still waiting for you', waiting, look.muted, 'pw-muted')}
        ${hours.length ? `<p class="pw-text" style="margin:24px 0 4px;font:bold 14px Arial,Helvetica,sans-serif;color:${look.text}">Come by</p><p class="pw-text" style="margin:0;font:14px/1.5 Arial,Helvetica,sans-serif;color:${look.text}">${hours.map(esc).join('<br>')}${addr.length ? `<br>${esc(addr.join(', '))}` : ''}</p>` : ''}
        <p style="margin:28px 0 0;text-align:center"><a href="${esc(manageUrl)}" class="pw-btn" style="display:inline-block;background:${look.button};color:${look.buttonText};text-decoration:none;font:bold 16px Arial,Helvetica,sans-serif;padding:12px 22px;border-radius:4px">View my pull list</a></p>
      </td></tr>
      <tr><td class="pw-muted pw-rule pw-pad" style="padding:16px 24px;border-top:1px solid ${look.rule};font:12px/1.5 Arial,Helvetica,sans-serif;color:${look.muted}">
        ${esc(shop.shop_name)}${addr.length ? ` · ${esc(addr.join(', '))}` : ''}${shop.phone ? ` · ${esc(shop.phone)}` : ''}<br>
        You get this when titles on your pull list arrive. <a href="${esc(unsubscribeUrl)}" class="pw-muted" style="color:${look.muted}">Stop these “your books are in” emails</a> (you can also turn them off in your profile).
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const textList = (title, list) => (list.length ? `${title.toUpperCase()} (${list.length})\n${list.map((e) => `- ${e.title}${bits(e) ? `\n  ${bits(e)}` : ''}`).join('\n')}\n\n` : '');
  const text = `${hello}\n\nYour books are in! ${intro}\n\n${textList(customer.ship_arrivals ? 'Just arrived' : 'Ready for pickup', fresh)}${priced ? `Estimated total ${money(estimate)} at cover price, before tax.${off}\n\n` : ''}${tier.line ? `${tier.line}\n\n` : ''}${textList('Still waiting for you', waiting)}${hours.length ? `Come by:\n${hours.join('\n')}${addr.length ? `\n${addr.join(', ')}` : ''}\n\n` : ''}View my pull list: ${manageUrl}\n\n--\n${shop.shop_name}${shop.phone ? `, ${shop.phone}` : ''}\nStop these emails: ${unsubscribeUrl}\n`;
  return { subject: subj, html, text };
}

/** A one-to-one message from staff: the shop header (logo and colors), the text they wrote, and the shop's details. */
export function buildMessage({ shop, subject, message, siteUrl = '' }) {
  const look = emailLook(shop, siteUrl);
  const addr = [shop.street, [shop.city, shop.region].filter(Boolean).join(', '), shop.postal_code].filter(Boolean);
  const paragraphs = String(message).trim().split(/\n{2,}/).map((p) => `<p class="pw-text" style="margin:0 0 14px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${look.text}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<!doctype html><html lang="en"><head>${emailHead(look, subject)}</head><body class="pw-page" style="margin:0;background:${look.page}">${preheader(String(message).trim().replace(/\s+/g, ' ').slice(0, 110))}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pw-page" style="background:${look.page}"><tr><td align="center" class="pw-outer" style="padding:16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="pw-body" style="max-width:600px;width:100%;background:${look.body};border-radius:6px">
      ${header(shop, look)}
      <tr><td class="pw-pad" style="padding:24px">
        ${paragraphs}
        <p class="pw-muted pw-rule" style="margin:24px 0 0;border-top:1px solid ${look.rule};padding-top:14px;font:13px/1.5 Arial,Helvetica,sans-serif;color:${look.muted}">
          ${esc(shop.shop_name)}${addr.length ? ` · ${esc(addr.join(', '))}` : ''}${shop.phone ? ` · ${esc(shop.phone)}` : ''}<br>Just reply to this email to reach us.
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  const text = `${String(message).trim()}\n\n--\n${shop.shop_name}${addr.length ? `, ${addr.join(', ')}` : ''}${shop.phone ? `, ${shop.phone}` : ''}\nJust reply to this email to reach us.\n`;
  return { subject, html, text };
}

/**
 * A test or preview copy of a customer's email, for staff. It is built with a harmless unsubscribe link
 * (`placeholderUrl`, not the customer's), and gets a note at the top saying so: the real link would turn the
 * customer's emails off if staff clicked it, or if their mail app's Unsubscribe button used it.
 */
export function asTest(mail, customerLabel) {
  const note = `Test copy of the email ${customerLabel ? `${customerLabel} gets` : 'a customer gets'}. Its unsubscribe link is switched off.`;
  return {
    ...mail,
    html: mail.html.replace(/(<body[^>]*>)/, `$1<div style="padding:10px 16px;background:#fff4c2;font:13px/1.4 Arial,Helvetica,sans-serif;color:#161616;text-align:center">${esc(note)}</div>`),
    text: `[${note}]\n\n${mail.text}`,
  };
}

/**
 * "Your books are in" claims: `items` are this batch's emails, each with the `ids` of the titles it announces;
 * `claimedIds` are the titles this run managed to mark as announced (another run at the same time may have
 * marked some first). An email is sent only when every one of its titles is ours. One where another run got
 * some of them is skipped, and its titles that we did get are handed back (`release`) for the next run.
 */
export function splitClaims(items, claimedIds) {
  const mine = new Set(claimedIds);
  const send = [];
  const release = [];
  for (const m of items) {
    const got = m.ids.filter((id) => mine.has(id));
    if (got.length && got.length === m.ids.length) send.push(m);
    else release.push(...got);
  }
  return { send, release };
}

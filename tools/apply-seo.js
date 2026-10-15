#!/usr/bin/env node
// Bake the page titles and descriptions staff set on the Pages screen (admin) into the
// static HTML files, so browsers and Google get them in the HTML itself.
//
//   npm run apply-seo          # rewrite the HTML files; prints what changed
//
// Reads the public `pages` and `settings` tables with the anon key from js/config.js.
// Every title becomes "Shop name — text": the custom title if staff set one, else the
// page's own name (the home page uses the tagline). The original text is kept in
// <title data-default="…"> so clearing the field in the admin restores it.
// The GitHub Action in .github/workflows/apply-seo.yml runs this and commits.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { sizedImage, heroHeadlineHtml, HERO_WIDTH, LOGO_WIDTH } from '../js/util.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// HTML file → pages.slug. post.html is per-post and sets its own title.
const FILES = {
  'index.html': 'home', 'pre-orders.html': 'pre-orders', 'new-arrivals.html': 'new-arrivals', 'calendar.html': 'calendar',
  'blog.html': 'news', 'about.html': 'about', 'contact.html': 'visit', 'we-buy-comics.html': 'we-buy-comics', 'gift-cards.html': 'gift-cards', 'faq.html': 'faq', 'how-to.html': 'how-to',
  'privacy.html': 'privacy', 'terms.html': 'terms',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

if (!SUPABASE_URL) {
  console.error('js/config.js has no SUPABASE_URL.');
  process.exit(1);
}
const res = await fetch(`${SUPABASE_URL}/rest/v1/pages?select=slug,meta_title,meta_description`, {
  headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
});
if (!res.ok) {
  console.error(`Couldn't read pages: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = Object.fromEntries((await res.json()).map((r) => [r.slug, r]));

// Shop name and tagline, for the "Shop name — text" titles.
const shopRes = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=shop_name,tagline,logo_url,favicon_url,hero_image_url,hero_headline&id=eq.1`, {
  headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
});
const shop = shopRes.ok ? (await shopRes.json())[0] ?? {} : {};
const shopName = (shop.shop_name ?? '').trim();
const tagline = (shop.tagline ?? '').trim();
if (!shopName) console.warn("Couldn't read the shop name; titles will be written without it.");
// Every page title is "Shop name — text": the staff-set title when there is one, otherwise the
// page's own name from its HTML (the home page has none, so it uses the tagline).
const fullTitle = (custom, fallback) => {
  const t = custom?.trim() || fallback.trim();
  if (!t) return shopName;
  return shopName && !t.toLowerCase().includes(shopName.toLowerCase()) ? `${shopName} — ${t}` : t;
};

/** Set (or restore, when `value` is blank) one tag, remembering the original text in data-default. */
function setTag(html, { re, build, current, value }) {
  const m = html.match(re);
  if (!m) return html;
  const original = m[0].match(/data-default="([^"]*)"/)?.[1] ?? esc(current(m));
  return html.replace(re, value ? build(esc(value), original) : build(null, original));
}

let changed = 0;
for (const [file, slug] of Object.entries(FILES)) {
  const p = path.join(root, file);
  const before = fs.readFileSync(p, 'utf8');
  const { meta_title, meta_description: desc } = rows[slug] ?? {};
  const titleTag = before.match(/<title[^>]*>([\s\S]*?)<\/title>/);
  const original = titleTag ? (titleTag[0].match(/data-default="([^"]*)"/)?.[1] ?? esc(titleTag[1].trim())) : '';
  const title = fullTitle(meta_title, original ? unesc(original) : tagline);
  let html = titleTag ? before.replace(titleTag[0], `<title data-seo data-default="${original}">${esc(title)}</title>`) : before;
  html = setTag(html, {
    re: /<meta name="description"[^>]*>/,
    current: (m) => unesc(m[0].match(/content="([^"]*)"/)?.[1] ?? ''),
    value: desc?.trim(),
    build: (v, orig) => (v ? `<meta name="description" data-seo data-default="${orig}" content="${v}">` : `<meta name="description" content="${orig}">`),
  });
  // Link-preview tags (Facebook, iMessage, Slack…) follow the title/description.
  html = html.replace(/\n?[ \t]*<meta property="og:(title|description)"[^>]*>/g, '');
  const og = [
    title && `<meta property="og:title" content="${esc(title)}">`,
    desc?.trim() && `<meta property="og:description" content="${esc(desc.trim())}">`,
  ].filter(Boolean);
  if (og.length) html = html.replace(/(<meta name="description"[^>]*>)/, `$1\n  ${og.join('\n  ')}`);
  if (html !== before) {
    fs.writeFileSync(p, html);
    changed++;
    console.log(`updated ${file}`);
  }
}

// The home page banner (headline, tagline, photo), so it's in the HTML and paints with the first frame.
// The page's script re-applies the live settings on load, so a change in the admin shows right away
// and this copy catches up on the next run.
function bakeHero(html) {
  const photo = /^https:\/\//.test(shop.hero_image_url ?? '');
  const style = photo ? ` style="--hero-image: url(&quot;${esc(sizedImage(shop.hero_image_url, HERO_WIDTH))}&quot;)"` : '';
  return html
    .replace(/<section class="hero(?: hero--photo)?"(?: style="[^"]*")?>/, `<section class="hero${photo ? ' hero--photo' : ''}"${style}>`)
    .replace(/(<h1 id="hero-title">)[\s\S]*?(<\/h1>)/, (_, open, close) => `${open}${heroHeadlineHtml(shop)}${close}`)
    .replace(/(<p data-setting="tagline">)[\s\S]*?(<\/p>)/, (_, open, close) => `${open}${esc(tagline)}${close}`);
}

// Browser tab icon and first-screen images, written into every page's <head> so the browser starts fetching
// them before any script runs (the scripts only learn the addresses after the settings load).
const BAKED = /\n?[ \t]*<link [^>]*data-baked[^>]*>/g;
for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
  const p = path.join(root, file);
  const before = fs.readFileSync(p, 'utf8');
  const tags = [];
  if (shop.favicon_url || shop.logo_url) {
    tags.push(`<link rel="icon" data-baked href="${esc(sizedImage(shop.favicon_url || shop.logo_url, 64, { format: 'origin', square: true }))}">`);
  }
  if (shop.logo_url) {
    tags.push(`<link rel="preload" as="image" data-baked fetchpriority="high" href="${esc(sizedImage(shop.logo_url, LOGO_WIDTH))}">`);
  }
  if (file === 'index.html' && shop.hero_image_url) {
    tags.push(`<link rel="preload" as="image" data-baked fetchpriority="high" href="${esc(sizedImage(shop.hero_image_url, HERO_WIDTH))}">`);
  }
  let html = before.replace(BAKED, '');
  if (file === 'index.html') html = bakeHero(html);
  html = html.replace('</head>', `${tags.map((tag) => `  ${tag}\n`).join('')}</head>`);
  if (html !== before) {
    fs.writeFileSync(p, html);
    changed++;
    console.log(`updated ${file} (icon and preloads)`);
  }
}
console.log(changed ? `${changed} file(s) updated.` : 'Already up to date.');

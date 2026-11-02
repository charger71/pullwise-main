// What the Worker changes in a page for one shop: pure functions, no Workers APIs, so Node can test them
// (worker/shop-page.test.js). worker/index.js applies them with HTMLRewriter.

import { esc, sizedImage, heroHeadlineHtml, HERO_WIDTH, LOGO_WIDTH } from '../js/util.js';
import { themeCss, fontPreloads } from '../js/theme-vars.js';

/** The shop whose domain this is, or null (then the site runs on the static js/config.js: demo mode). */
export function findShop(shops, hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  return shops.find((s) => (s.domains ?? []).some((d) => d.toLowerCase() === host)) ?? null;
}

/** The shop's public site address: its first domain. */
export const siteUrl = (shop) => `https://${shop.domains[0]}`;

/** Where the pull list app lives on every shop's own domain (app.html; installed from there, see appManifest). */
export const APP_PATH = '/app';

/** Whether the shop has the pull list app: only shops marked "app": true in shops.json. The rest send /app to the
 * account page (the same pull list in the browser), have no install manifest, and hide every "Get the app" link. */
export const hasApp = (shop) => shop?.app === true;

/**
 * The address "app.<shop domain>" forwards to (the shop's app on its main domain, or its account page if the shop
 * has no app), or null. The app stays on the shop's own domain so a customer signed in on the website is signed in
 * in the app too; app.… is just the easy address to print on a flyer. Each one must be attached to the Worker as a
 * custom domain, like the shop's own.
 */
export function appRedirect(shops, hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  const shop = host.startsWith('app.') ? findShop(shops, host.slice(4)) : null;
  return shop ? `${siteUrl(shop)}${hasApp(shop) ? APP_PATH : NO_APP_PATH}` : null;
}

/** Where /app goes for a shop without the app: the account page, so old links and installs still reach the list. */
export const NO_APP_PATH = '/account.html';

const DEFAULT_PAPER = '#121212'; // css/site.css's --brand-paper
const hexColor = (v) => (/^#[0-9a-f]{6}$/i.test(v ?? '') ? v : null);

const https = (url) => (typeof url === 'string' && /^https:\/\//.test(url) ? url : null);

/** The app's home-screen icon at one size: the shop's tab icon (or logo), squared by Supabase's image service. */
const appIcon = (settings, size) => {
  const src = settings.favicon_url || settings.logo_url;
  return /^https:\/\//.test(src ?? '') ? sizedImage(src, size, { format: 'origin', square: true }) : null;
};

/**
 * /manifest.webmanifest for one shop: what "Add to Home Screen" installs. It's the shop's own app, under its name,
 * icon and page color, opening on its pull list.
 */
export function appManifest(settings = {}) {
  const name = (settings.shop_name ?? '').trim() || 'My Pull List';
  const paper = hexColor(settings.colors?.paper) ?? DEFAULT_PAPER;
  const icons = [192, 512].map((size) => appIcon(settings, size) && { src: appIcon(settings, size), sizes: `${size}x${size}`, purpose: 'any' }).filter(Boolean);
  // Uploaded in Shop Settings at exactly these sizes (admin/sections/settings.js), with room around the logo for the
  // phone to cut it to its own shape.
  const maskable = https(settings.app_icon_url);
  if (maskable) icons.push({ src: maskable, sizes: '512x512', purpose: 'maskable' });
  const screenshots = (Array.isArray(settings.app_screenshots) ? settings.app_screenshots : []).map(https).filter(Boolean).slice(0, 4)
    .map((src, i) => ({ src, sizes: '1080x2340', form_factor: 'narrow', label: `${name} app, screen ${i + 1}` }));
  return {
    id: APP_PATH,
    name,
    short_name: name,
    description: `Your pull list at ${name}`,
    start_url: APP_PATH,
    scope: APP_PATH,
    display: 'standalone',
    background_color: paper,
    theme_color: paper,
    ...(icons.length ? { icons } : {}),
    // With these, Android's install offer is a full sheet showing the app rather than a small bar.
    ...(screenshots.length ? { screenshots } : {}),
    // Tapping the icon, a shortcut or a link into the app while it's open brings that window forward (on the page the
    // link names) instead of opening a second copy of the app.
    launch_handler: { client_mode: ['navigate-existing', 'auto'] },
    // Long-press the icon (Android): straight to a tab, each with the tab bar's icon.
    shortcuts: APP_SHORTCUTS,
  };
}

const APP_SHORTCUTS = [
  { name: 'My List', key: 'list' },
  { name: 'Hot', key: 'hot' },
  { name: 'Shop', key: 'shop' },
].map(({ name, key }) => ({ name, url: `${APP_PATH}#${key}`, icons: [{ src: `/icons/shortcut-${key}.png`, sizes: '96x96', type: 'image/png' }] }));

/** The app's loading screen: the shop's logo (at the header's width) and name. */
export function appSplash(settings = {}) {
  const logo = /^https:\/\//.test(settings.logo_url ?? '') ? sizedImage(settings.logo_url, LOGO_WIDTH) : '';
  return { logo, name: (settings.shop_name ?? '').trim() };
}

/**
 * js/config.js for one shop: the same exports as the static file, filled in from shops.json. `settings` is the
 * Worker's last copy of the shop's settings (may be empty), for the name and timezone shown before they load.
 */
/** Where admin pages send covers and series images for shops whose media lives in R2 (worker/media.js). */
export const MEDIA_UPLOAD_PATH = '/__media';
/** Folders that go to R2; everything else (logo, banner, Media library…) stays in the shop's own Supabase storage. */
export const R2_FOLDERS = ['covers', 'series'];
const MEDIA_TYPES = { 'image/jpeg': /\.jpe?g$/, 'image/png': /\.png$/, 'image/webp': /\.webp$/, 'image/gif': /\.gif$/ };

/** A safe object path for an upload ("covers/lunar/ABC-1f2e.jpg"), or null. The file type must match the name. */
export function mediaPath(path, contentType) {
  if (typeof path !== 'string' || path.length > 300) return null;
  const parts = path.split('/');
  if (!R2_FOLDERS.includes(parts[0]) || parts.length < 2) return null;
  if (parts.some((p) => !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(p))) return null; // no "..", no hidden names
  const ext = MEDIA_TYPES[contentType];
  return ext && ext.test(parts.at(-1).toLowerCase()) ? path : null;
}

/** Public address of an object the Worker stored for a shop. */
export const mediaUrl = (publicBase, shop, path) => `${publicBase.replace(/\/+$/, '')}/${shop.id}/${path}`;

export function configJs(shop, settings = {}) {
  const line = (name, value) => `export const ${name} = ${JSON.stringify(value ?? '')};`;
  const fallback = { shop_name: (settings.shop_name ?? '').trim(), timezone: settings.timezone || 'America/New_York' };
  return [
    `// Generated by the site Worker for ${shop.id} (shops.json). The file in the repo is the local / demo version.`,
    line('SUPABASE_URL', shop.supabaseUrl),
    line('SUPABASE_ANON_KEY', shop.anonKey),
    line('GA_MEASUREMENT_ID', shop.gaMeasurementId),
    line('SITE_URL', siteUrl(shop)),
    // Covers and series images go to the shared R2 bucket through the Worker for shops marked "media": "r2".
    line('MEDIA_UPLOAD_URL', shop.media === 'r2' ? MEDIA_UPLOAD_PATH : ''),
    `export const APP_ENABLED = ${hasApp(shop)};`,
    `export const FALLBACK_SETTINGS = ${JSON.stringify(fallback).replace(/</g, '\\u003c')};`,
    '',
  ].join('\n');
}

/** Root-level HTML file a request path is served from ('/' → 'index.html', '/about' → 'about.html'), or null. */
export function fileOf(pathname) {
  const p = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (p === '' || p === 'index' || p === 'index.html') return 'index.html';
  if (p.includes('/')) return null; // admin/ and the rest set their own titles and icons
  return p.endsWith('.html') ? p : `${p}.html`;
}

// HTML file → pages.slug, for the staff-set titles and descriptions. post.html and friends set their own title.
export const PAGE_SLUGS = {
  'index.html': 'home', 'pre-orders.html': 'pre-orders', 'new-arrivals.html': 'new-arrivals', 'calendar.html': 'calendar',
  'blog.html': 'news', 'about.html': 'about', 'contact.html': 'visit', 'we-buy-comics.html': 'we-buy-comics', 'gift-cards.html': 'gift-cards', 'faq.html': 'faq', 'how-to.html': 'how-to',
  'privacy.html': 'privacy', 'terms.html': 'terms', 'search.html': 'search', 'survey.html': 'survey',
};

/** The page served, with a 404 status, for any address that has no file (wrangler.jsonc's not_found_handling). */
export const NOT_FOUND_FILE = '404.html';

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * "Shop name — text": the staff-set title when there is one, else the page's own name (`data-default` in its
 * HTML, still entity-encoded), else the tagline (the home page). The shop name isn't repeated if it's already in.
 */
export function pageTitle(settings, custom, htmlDefault) {
  const shopName = (settings.shop_name ?? '').trim();
  const t = custom?.trim() || unesc(htmlDefault ?? '').trim() || (settings.tagline ?? '').trim();
  if (!t) return shopName;
  return shopName && !t.toLowerCase().includes(shopName.toLowerCase()) ? `${shopName} — ${t}` : t;
}

/**
 * Tags added to the end of <head>: connect early to Supabase, the tab icon, the first-screen images and fonts, the
 * link-preview picture (the shop's banner) on the pages that have staff-set titles, and the shop's colors and
 * fonts, so the first paint already has them (js/site.js builds the same <style> and leaves it be when it matches).
 */
export function headTags(file, settings, supabaseUrl) {
  const tags = [];
  if (supabaseUrl) tags.push(`<link rel="preconnect" href="${esc(supabaseUrl)}" crossorigin>`);
  const icon = settings.favicon_url || settings.logo_url;
  if (icon) tags.push(`<link rel="icon" href="${esc(sizedImage(icon, 64, { format: 'origin', square: true }))}">`);
  if (file === 'app.html') {
    // The installed app's status bar color and its icon on an iPhone (which doesn't read the manifest's icons).
    tags.push(`<meta name="theme-color" content="${esc(hexColor(settings.colors?.paper) ?? DEFAULT_PAPER)}">`);
    if (settings.shop_name?.trim()) tags.push(`<meta name="apple-mobile-web-app-title" content="${esc(settings.shop_name.trim())}">`);
    // The app icon made for Home Screens (a full square with room around the logo) suits an iPhone's too.
    const touch = https(settings.app_icon_url) ? sizedImage(settings.app_icon_url, 180, { format: 'origin', square: true }) : appIcon(settings, 180);
    if (touch) tags.push(`<link rel="apple-touch-icon" href="${esc(touch)}">`);
  }
  if (settings.logo_url) tags.push(`<link rel="preload" as="image" fetchpriority="high" href="${esc(sizedImage(settings.logo_url, LOGO_WIDTH))}">`);
  if (file === 'index.html' && settings.hero_image_url) {
    tags.push(`<link rel="preload" as="image" fetchpriority="high" href="${esc(sizedImage(settings.hero_image_url, HERO_WIDTH))}">`);
  }
  if (PAGE_SLUGS[file] && file !== 'search.html' && /^https:\/\//.test(settings.hero_image_url ?? '')) {
    tags.push(`<meta property="og:image" content="${esc(sizedImage(settings.hero_image_url, HERO_WIDTH))}">`);
  }
  const theme = { storageOrigin: supabaseUrl };
  for (const href of fontPreloads(settings.fonts, theme)) tags.push(`<link rel="preload" href="${esc(href)}" as="font" type="font/${href.endsWith('.woff') ? 'woff' : 'woff2'}" crossorigin>`);
  // Every value in it is checked (colors are hex, fonts come from the library or the shop's own storage), so no
  // escaping is needed, and none could close the tag.
  const css = themeCss(settings, theme);
  if (css) tags.push(`<style id="shop-theme">${css}</style>`);
  return tags;
}

// The fixed public pages, for the sitemap. Posts, events and staff-made pages come and go with the database
// and aren't listed; search, account and survey pages aren't meant for search results.
export const SITEMAP_PAGES = ['', 'pre-orders.html', 'new-arrivals.html', 'we-buy-comics.html', 'calendar.html', 'blog.html', 'contact.html',
  'about.html', 'gift-cards.html', 'how-to.html', 'faq.html', 'privacy.html', 'terms.html'];

/** /sitemap.xml for one shop, on its main domain. */
export function sitemapXml(shop) {
  const urls = SITEMAP_PAGES.map((p) => `  <url><loc>${esc(`${siteUrl(shop)}/${p}`)}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

/** /robots.txt for one shop: the static file's rules plus its own sitemap address. */
export const robotsTxt = (shop, staticText) => `${staticText.trimEnd()}\n\nSitemap: ${siteUrl(shop)}/sitemap.xml\n`;

/** The home page banner, so it paints with the first frame (js/pages/home.js re-applies live settings on load). */
export function hero(settings) {
  const photo = /^https:\/\//.test(settings.hero_image_url ?? '');
  return {
    className: photo ? 'hero hero--photo' : 'hero',
    style: photo ? `--hero-image: url("${sizedImage(settings.hero_image_url, HERO_WIDTH)}")` : null,
    headlineHtml: heroHeadlineHtml(settings),
    tagline: (settings.tagline ?? '').trim(),
  };
}

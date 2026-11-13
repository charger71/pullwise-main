// The site Worker: serves every shop from one copy of the code. Cloudflare sends each shop's domain here;
// shops.json says which Supabase project that domain belongs to.
//
//  * /js/config.js is generated for the shop (its Supabase URL and anon key), so the browser code is shared.
//  * Root HTML pages get the shop's title, description, tab icon, colors, fonts and home page banner written in
//    on the way out (worker/shop-page.js), from its settings and pages tables. Those are cached for CACHE_SECONDS, so a
//    change in the admin shows up on the site within about a minute.
//  * /sitemap.xml is generated on the shop's main domain, and /robots.txt (the static file) gets its address.
//  * An address with no file gets 404.html (wrangler.jsonc's not_found_handling), branded like the other pages.
//  * PUT /__media stores covers and series images in R2 for shops using it (worker/media.js).
//  * GET /__backups lists and serves the shop's nightly backup files to its owners (worker/backups.js).
//  * /manifest.webmanifest is the shop's installable pull list app (app.html), under its name, icon and colors;
//    app.<shop domain> forwards to that app on the shop's main domain. Only shops marked "app": true in shops.json
//    have it: for the rest /app forwards to the account page and the manifest is a 404.
//  * Everything else is the static file as is. A domain that isn't in shops.json gets the plain files, which
//    run in demo mode.

import SHOPS from '../shops.json';
import { mediaUpload } from './media.js';
import { BACKUPS_PATH, backupFiles } from './backups.js';
import { MEDIA_UPLOAD_PATH, ASSET_LINKS_PATH, assetLinks, findShop, hasApp, NO_APP_PATH, appRedirect, appManifest, appSplash, configJs, fileOf, PAGE_SLUGS, NOT_FOUND_FILE, customSlugOf, customPageSlug, postSlugOf, pageTitle, headTags, hero, sitemapXml, robotsTxt, SITEMAP_MAX_POSTS, SITEMAP_MAX_EVENTS } from './shop-page.js';
import { unusedDefaultPreloads } from '../js/theme-vars.js';

const CACHE_SECONDS = 60;
const FETCH_TIMEOUT_MS = 3000;
const memo = new Map(); // shop id → { at, data }, per Worker instance, in front of the shared cache
const SITEMAP_SECONDS = 600;
const sitemapMemo = new Map(); // shop id → { at, data }: the posts and events the sitemap lists

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const shop = findShop(SHOPS.shops, url.hostname);
    if (!shop) {
      const app = appRedirect(SHOPS.shops, url.hostname);
      // Temporary for a shop without the app, so turning it on later isn't stuck behind a browser's cached redirect.
      return app ? Response.redirect(app, app.endsWith(NO_APP_PATH) ? 302 : 301) : env.ASSETS.fetch(request);
    }
    if (url.pathname === MEDIA_UPLOAD_PATH) return mediaUpload(request, shop, env);
    if (url.pathname === BACKUPS_PATH) return backupFiles(request, shop, env);
    if (url.pathname === '/js/config.js') return config(shop, request, await cachedShopData(shop));
    if (!hasApp(shop) && url.pathname === '/manifest.webmanifest') return new Response('Not found', { status: 404 }); // nothing to install
    if (!hasApp(shop) && (url.pathname === '/app' || url.pathname === '/app.html')) return Response.redirect(new URL(NO_APP_PATH, url).href, 302);
    if (url.pathname === '/manifest.webmanifest') return text(JSON.stringify(appManifest((await shopData(shop, ctx))?.settings)), 'application/manifest+json', request);
    if (url.pathname === ASSET_LINKS_PATH) {
      const links = assetLinks(shop);
      return links ? text(JSON.stringify(links), 'application/json', request) : new Response('Not found', { status: 404 });
    }
    if (url.pathname === '/sitemap.xml') {
      const off = (await shopData(shop, ctx))?.settings?.disabled_pages ?? [];
      return text(sitemapXml(shop, off, await sitemapData(shop, off)), 'application/xml', request);
    }
    if (url.pathname === '/robots.txt') {
      const res = await env.ASSETS.fetch(new Request(new URL('/robots.txt', url), { method: 'GET' }));
      return res.ok ? text(robotsTxt(shop, await res.text()), 'text/plain', request) : res;
    }

    const page = request.method === 'GET' || request.method === 'HEAD';
    let file = page ? fileOf(url.pathname) : null;
    let res;
    if (file) {
      // Ask for the whole file: a 304 would leave nothing to rewrite (and the browser's copy has the old titles).
      const headers = new Headers(request.headers);
      headers.delete('If-None-Match');
      headers.delete('If-Modified-Since');
      res = await env.ASSETS.fetch(new Request(request, { headers }));
    } else {
      res = await env.ASSETS.fetch(request);
      if (!page) return res;
    }
    // A staff-made page lives at /<slug>: no file by that name, so serve page.html (its script reads the slug from the
    // address). Unknown, switched-off and not-a-staff-page slugs stay 404.
    let customSlug = null;
    if (res.status === 404 && page && customSlugOf(url.pathname)) {
      const slugHere = customPageSlug(url.pathname, await shopData(shop, ctx));
      if (slugHere) {
        const headers = new Headers(request.headers); // the whole file, as above: a 304 would leave nothing to rewrite
        headers.delete('If-None-Match');
        headers.delete('If-Modified-Since');
        const pageRes = await env.ASSETS.fetch(new Request(new URL('/page.html', url), { method: request.method, headers }));
        if (pageRes.ok) {
          res = pageRes;
          file = 'page.html';
          customSlug = slugHere;
        }
      }
    }
    // A news post lives at /news/<slug>: serve post.html (its script finds the post), unless News is switched off.
    if (res.status === 404 && page && postSlugOf(url.pathname) && !((await shopData(shop, ctx))?.settings?.disabled_pages ?? []).includes('news')) {
      const headers = new Headers(request.headers);
      headers.delete('If-None-Match');
      headers.delete('If-Modified-Since');
      const postRes = await env.ASSETS.fetch(new Request(new URL('/post.html', url), { method: request.method, headers }));
      if (postRes.ok) {
        res = postRes;
        file = 'post.html';
      }
    }
    if (res.status === 404) file = NOT_FOUND_FILE;
    // Any other page outside the root (admin/ and its style guide) is served as is: the shop's theme uses the same
    // --brand-* names as the admin's own colors and would paint over them.
    if (!file) return res;
    if ((!res.ok && file !== NOT_FOUND_FILE) || !(res.headers.get('Content-Type') ?? '').includes('text/html')) return res;

    const data = await shopData(shop, ctx);
    if (!data) return res; // Supabase unreachable and nothing cached: the page's own script fills in the details
    const out = rewrite(res, file, data, shop, customSlug);
    const h = new Headers(out.headers);
    h.delete('ETag');
    h.set('Cache-Control', 'no-cache');
    return new Response(out.body, { status: out.status, headers: h });
  },
};

function text(body, type, request) {
  const headers = { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': `max-age=${CACHE_SECONDS * 60}` };
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}

// The name and timezone shown before the settings load come from the shop data the page request just cached
// (never a fresh database call: this file holds up every page's scripts); with none, neutral defaults.
function config(shop, request, data) {
  const body = configJs(shop, data?.settings);
  const etag = `"${hash(body)}"`;
  const headers = { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}

/** Whatever copy of the shop's data this instance or the shared cache already has, however old; or null. */
async function cachedShopData(shop) {
  const hit = memo.get(shop.id);
  if (hit) return hit.data;
  const cached = await caches.default.match(shopDataKey(shop));
  return cached ? cached.json() : null;
}

const shopDataKey = (shop) => new Request(`https://shop-data.internal/${encodeURIComponent(shop.id)}`);

/** The shop's settings and page titles, at most CACHE_SECONDS old; the last good copy if Supabase fails. */
/**
 * The published news posts and the upcoming (next six months), not-cancelled events for /sitemap.xml. Asked for only
 * when the sitemap is, kept ten minutes per Worker instance, and left out (the fixed pages still list) if the shop's
 * database is slow or down. Nothing here goes into shopData, which every page view reads.
 */
async function sitemapData(shop, off) {
  const now = Date.now();
  const hit = sitemapMemo.get(shop.id);
  if (hit && now - hit.at < SITEMAP_SECONDS * 1000) return hit.data;
  const iso = new Date(now).toISOString();
  const get = async (path) => {
    const r = await fetch(`${shop.supabaseUrl}/rest/v1/${path}`, {
      headers: { apikey: shop.anonKey, Authorization: `Bearer ${shop.anonKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  try {
    const [posts, events] = await Promise.all([
      off.includes('news') ? [] : get(`posts?select=slug,updated_at&published_at=lte.${iso}&order=published_at.desc&limit=${SITEMAP_MAX_POSTS}`),
      off.includes('calendar') ? [] : get(`events?select=id&cancelled_at=is.null&starts_at=gte.${iso}&starts_at=lt.${new Date(now + 183 * 864e5).toISOString()}&order=starts_at.asc&limit=${SITEMAP_MAX_EVENTS}`),
    ]);
    const data = { posts, events };
    sitemapMemo.set(shop.id, { at: now, data });
    return data;
  } catch (err) {
    console.error(`sitemap data for ${shop.id}: ${err.message}`);
    return hit?.data ?? {};
  }
}

async function shopData(shop, ctx) {
  const now = Date.now();
  const hit = memo.get(shop.id);
  if (hit && now - hit.at < CACHE_SECONDS * 1000) return hit.data;

  const key = shopDataKey(shop);
  const cached = await caches.default.match(key);
  if (cached) {
    const data = await cached.json();
    memo.set(shop.id, { at: now, data });
    return data;
  }
  try {
    const get = async (path) => {
      const r = await fetch(`${shop.supabaseUrl}/rest/v1/${path}`, {
        headers: { apikey: shop.anonKey, Authorization: `Bearer ${shop.anonKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // a slow database must not hold up the page
      });
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    };
    const [settings, pages] = await Promise.all([
      get('settings?select=shop_name,tagline,timezone,logo_url,favicon_url,app_icon_url,app_screenshots,hero_image_url,hero_headline,colors,fonts,disabled_pages&id=eq.1'),
      get('pages?select=slug,meta_title,meta_description,custom'),
    ]);
    const data = { settings: settings[0] ?? {}, pages: Object.fromEntries(pages.map((p) => [p.slug, p])) };
    memo.set(shop.id, { at: now, data });
    ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(data), { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` } })));
    return data;
  } catch (err) {
    console.error(`shop data for ${shop.id}: ${err.message}`);
    return hit?.data ?? null;
  }
}

function rewrite(res, file, { settings, pages }, shop, customSlug = null) {
  const slug = PAGE_SLUGS[file] ?? customSlug;
  const row = slug ? pages[slug] ?? {} : file === NOT_FOUND_FILE ? {} : null; // its title gets the shop name too
  const desc = row?.meta_description?.trim();
  let title = null;
  let rw = new HTMLRewriter();

  if (row) {
    rw = rw
      .on('title[data-seo]', {
        element(el) {
          title = pageTitle(settings, row.meta_title, el.getAttribute('data-default'));
          el.setInnerContent(title);
        },
      })
      .on('meta[property="og:title"]', { element(el) { if (title) el.setAttribute('content', escAttr(title)); } })
      .on('meta[property="og:description"]', { element(el) { if (desc) el.remove(); } })
      .on('meta[name="description"]', {
        element(el) {
          if (!desc) return;
          el.setAttribute('content', escAttr(desc));
          el.after(`<meta property="og:description" content="${escAttr(desc)}">`, { html: true });
        },
      });
  }
  rw = rw.on('head', { element(el) { el.append(headTags(file, settings, shop.supabaseUrl).map((t) => `  ${t}\n`).join(''), { html: true }); } });
  // The page's own font preloads, for a default font the shop has replaced: no download it won't use.
  const unused = new Set(unusedDefaultPreloads(settings.fonts, { storageOrigin: shop.supabaseUrl }));
  if (unused.size) rw = rw.on('link[rel="preload"][as="font"]', { element(el) { if (unused.has(el.getAttribute('href'))) el.remove(); } });

  if (file === 'app.html') {
    const splash = appSplash(settings);
    rw = rw
      .on('img[data-splash-logo]', {
        element(el) {
          if (!splash.logo) return;
          el.setAttribute('src', escAttr(splash.logo));
          el.removeAttribute('hidden');
        },
      })
      .on('[data-splash-name]', { element(el) { el.setInnerContent(splash.name); } });
  }
  if (file === 'index.html') {
    const h = hero(settings);
    rw = rw
      .on('section.hero', {
        element(el) {
          el.setAttribute('class', h.className);
          if (h.style) el.setAttribute('style', escAttr(h.style));
          else el.removeAttribute('style');
        },
      })
      .on('h1#hero-title', { element(el) { el.setInnerContent(h.headlineHtml, { html: true }); } })
      .on('p[data-setting="tagline"]', { element(el) { el.setInnerContent(h.tagline); } });
  }
  return rw.transform(res);
}

// HTMLRewriter's setAttribute only escapes quotes, so escape the rest here (and for after()'s raw HTML).
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Short, stable fingerprint for the ETag (FNV-1a). */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// node worker/shop-page.test.js
import assert from 'node:assert/strict';
import { findShop, siteUrl, appRedirect, appManifest, configJs, fileOf, pageTitle, headTags, hero, sitemapXml, robotsTxt } from './shop-page.js';

const shops = [
  { id: 'a', domains: ['a-comics.com', 'www.a-comics.com'], supabaseUrl: 'https://aaa.supabase.co', anonKey: 'key-a', gaMeasurementId: 'G-1' },
  { id: 'b', domains: ['B-Comics.com'], supabaseUrl: 'https://bbb.supabase.co', anonKey: 'key-b' },
];

// Shop lookup by domain
assert.equal(findShop(shops, 'a-comics.com').id, 'a');
assert.equal(findShop(shops, 'WWW.A-Comics.com').id, 'a');
assert.equal(findShop(shops, 'b-comics.com.').id, 'b', 'trailing dot and case are ignored');
assert.equal(findShop(shops, 'evil-a-comics.com'), null);
assert.equal(findShop(shops, 'localhost'), null);
assert.equal(findShop([], 'a-comics.com'), null);
assert.equal(siteUrl(shops[0]), 'https://a-comics.com');

// Generated config.js: same exports as the static file, values JSON-quoted
const cfg = configJs(shops[0]);
assert.match(cfg, /^export const SUPABASE_URL = "https:\/\/aaa\.supabase\.co";$/m);
assert.match(cfg, /^export const SUPABASE_ANON_KEY = "key-a";$/m);
assert.match(cfg, /^export const GA_MEASUREMENT_ID = "G-1";$/m);
assert.match(cfg, /^export const SITE_URL = "https:\/\/a-comics\.com";$/m);
assert.match(configJs(shops[1]), /^export const GA_MEASUREMENT_ID = "";$/m, 'missing GA id is an empty string');
assert.doesNotMatch(configJs({ ...shops[1], anonKey: 'x";alert(1)//' }), /"x";alert/, 'values cannot break out of the string');
// Name and timezone shown before the settings load: from the cached settings, else neutral.
assert.match(cfg, /^export const FALLBACK_SETTINGS = \{"shop_name":"","timezone":"America\/New_York"\};$/m);
assert.match(configJs(shops[0], { shop_name: ' A Comics ', timezone: 'America/Chicago' }), /FALLBACK_SETTINGS = \{"shop_name":"A Comics","timezone":"America\/Chicago"\}/);
assert.doesNotMatch(configJs(shops[0], { shop_name: '</script><b>' }), /<\//, 'the name cannot close a script tag');

// Request path → HTML file
assert.equal(fileOf('/'), 'index.html');
assert.equal(fileOf('/index.html'), 'index.html');
assert.equal(fileOf('/about'), 'about.html');
assert.equal(fileOf('/about.html'), 'about.html');
assert.equal(fileOf('/admin/'), null);
assert.equal(fileOf('/js/site.js'), null);
assert.equal(fileOf('/css/site.css'), null);

// Titles
const s = { shop_name: 'Main Street Comics', tagline: 'Comics & more' };
assert.equal(pageTitle(s, null, 'About'), 'Main Street Comics — About');
assert.equal(pageTitle(s, 'Our Story', 'About'), 'Main Street Comics — Our Story');
assert.equal(pageTitle(s, '  ', 'Visit &amp; Contact'), 'Main Street Comics — Visit & Contact', 'blank custom title falls back; entities decoded');
assert.equal(pageTitle(s, null, ''), 'Main Street Comics — Comics & more', 'home page uses the tagline');
assert.equal(pageTitle(s, 'Main Street Comics: New Books', 'x'), 'Main Street Comics: New Books', 'shop name not repeated');
assert.equal(pageTitle({ shop_name: '', tagline: '' }, null, 'FAQ'), 'FAQ');
assert.equal(pageTitle({ shop_name: 'Shop' }, null, ''), 'Shop');

// Staff text with String.replace patterns ($&, $', $1) comes out as typed (the Worker sets it with HTMLRewriter).
assert.equal(pageTitle({ shop_name: 'Shop' }, "Save $$ & get $& $' $1", 'Visit'), "Shop — Save $$ & get $& $' $1");

// Head tags
const MEDIA = 'https://aaa.supabase.co/storage/v1/object/public/media';
assert.deepEqual(headTags('about.html', {}, 'https://aaa.supabase.co'), ['<link rel="preconnect" href="https://aaa.supabase.co" crossorigin>']);
const tags = headTags('index.html', { logo_url: `${MEDIA}/logo.png`, hero_image_url: `${MEDIA}/hero.jpg` }, 'https://aaa.supabase.co');
assert.equal(tags.length, 5);
assert.match(tags[4], /^<meta property="og:image" content="[^"]*hero\.jpg\?width=1400/);
assert.match(tags[1], /rel="icon" href="https:\/\/aaa\.supabase\.co\/storage\/v1\/render\/image\/public\/media\/logo\.png\?width=64&amp;height=64/, 'icon falls back to the logo');
assert.match(tags[2], /logo\.png\?width=320/);
assert.match(tags[3], /hero\.jpg\?width=1400/);
assert.equal(headTags('about.html', { logo_url: `${MEDIA}/logo.png`, hero_image_url: `${MEDIA}/hero.jpg` }, '').filter((t) => t.includes('preload')).length, 1, 'hero preload on the home page only');
assert.match(headTags('x.html', { favicon_url: `${MEDIA}/fav.png`, logo_url: `${MEDIA}/logo.png` }, '')[0], /fav\.png/);
assert.match(headTags('x.html', { logo_url: 'https://x.com/a"b.png' }, '')[0], /a&quot;b\.png/, 'addresses are escaped');
// Link-preview picture: the banner, on the pages with staff-set titles (not search, not post.html)
assert.ok(headTags('about.html', { hero_image_url: `${MEDIA}/hero.jpg` }, '').some((t) => /^<meta property="og:image" content="[^"]*hero\.jpg\?width=1400/.test(t)));
assert.ok(!headTags('search.html', { hero_image_url: `${MEDIA}/hero.jpg` }, '').some((t) => t.includes('og:image')));
assert.ok(!headTags('post.html', { hero_image_url: `${MEDIA}/hero.jpg` }, '').some((t) => t.includes('og:image')));
// The shop's colors and fonts, in the first paint
const themed = headTags('about.html', { colors: { primary: '#982c21' }, fonts: { display: { font: 'bangers' }, body: { upload: 'https://aaa.supabase.co/storage/v1/object/public/media/fonts/a.woff2' } } }, 'https://aaa.supabase.co');
assert.ok(themed.includes('<link rel="preload" href="fonts/bangers-latin.woff2" as="font" type="font/woff2" crossorigin>'));
assert.ok(themed.includes('<link rel="preload" href="https://aaa.supabase.co/storage/v1/object/public/media/fonts/a.woff2" as="font" type="font/woff2" crossorigin>'));
assert.match(themed.at(-1), /^<style id="shop-theme">@font-face\{font-family:'Shop Display';[\s\S]*:root\{--brand-primary:#982c21;[^<]*\}<\/style>$/);
assert.ok(!headTags('about.html', { fonts: { body: { upload: 'https://evil.example/storage/v1/object/public/media/fonts/a.woff2' } } }, 'https://aaa.supabase.co').some((t) => /evil|shop-theme/.test(t)), 'another host’s font is left out');

// Sitemap and robots.txt on the shop's main domain
const map = sitemapXml(shops[0]);
assert.match(map, /<loc>https:\/\/a-comics\.com\/<\/loc>/);
assert.match(map, /<loc>https:\/\/a-comics\.com\/terms\.html<\/loc>/);
assert.doesNotMatch(map, /<loc>https:\/\/www\.|search\.html|account\.html/);
assert.equal(robotsTxt(shops[0], 'User-agent: *\nDisallow: /admin/\n'), 'User-agent: *\nDisallow: /admin/\n\nSitemap: https://a-comics.com/sitemap.xml\n');

// Home banner
assert.deepEqual(hero({ shop_name: 'Shop', tagline: ' Hi ' }), { className: 'hero', style: null, headlineHtml: 'Shop', tagline: 'Hi' });
const h = hero({ hero_headline: 'Comics. *Toys.* <b>', hero_image_url: `${MEDIA}/hero.jpg` });
assert.equal(h.className, 'hero hero--photo');
assert.match(h.style, /^--hero-image: url\("https:\/\/aaa\.supabase\.co\/storage\/v1\/render\/image\/public\/media\/hero\.jpg\?width=1400/);
assert.equal(h.headlineHtml, 'Comics. <span>Toys.</span> &lt;b&gt;');
assert.equal(hero({ hero_image_url: 'javascript:alert(1)' }).style, null, 'only https photos');

// The pull list app: app.<domain> forwards to /app on the shop's main domain; the manifest is the shop's own
assert.equal(appRedirect(shops, 'app.a-comics.com'), 'https://a-comics.com/app');
assert.equal(appRedirect(shops, 'APP.www.a-comics.com.'), 'https://a-comics.com/app', 'any of its domains, to the main one');
assert.equal(appRedirect(shops, 'app.evil.com'), null);
assert.equal(appRedirect(shops, 'a-comics.com'), null);
assert.equal(fileOf('/app'), 'app.html');
const app = appManifest({ shop_name: ' A Comics ', colors: { paper: '#f5f0e6' }, logo_url: `${MEDIA}/logo.png` });
assert.equal(app.name, 'A Comics');
assert.equal(app.start_url, '/app');
assert.equal(app.scope, '/app');
assert.equal(app.display, 'standalone');
assert.deepEqual(app.shortcuts.map((x) => x.url), ['/app#list', '/app#hot', '/app#following', '/app#shop']);
assert.equal(app.theme_color, '#f5f0e6');
assert.deepEqual(app.icons.map((i) => i.sizes), ['192x192', '512x512']);
assert.match(app.icons[1].src, /render\/image\/public\/media\/logo\.png\?width=512&height=512&resize=contain/);
const plain = appManifest({ colors: { paper: 'red' }, logo_url: 'javascript:x' });
assert.equal(plain.name, 'My Pull List', 'a name even before the shop has one');
assert.equal(plain.theme_color, '#121212', 'only a hex color');
assert.equal('icons' in plain, false, 'only https icons');
const appHead = headTags('app.html', { shop_name: 'A & B', colors: { paper: '#f5f0e6' }, logo_url: `${MEDIA}/logo.png` }).join('\n');
assert.match(appHead, /<meta name="apple-mobile-web-app-title" content="A &amp; B">/, 'the name under the home-screen icon');
assert.match(appHead, /<meta name="theme-color" content="#f5f0e6">/);
assert.match(appHead, /<link rel="apple-touch-icon" href="[^"]*width=180&amp;height=180/);
assert.doesNotMatch(headTags('index.html', { logo_url: `${MEDIA}/logo.png` }).join(''), /apple-touch-icon|theme-color/, 'only the app page');

console.log('shop page tests passed');

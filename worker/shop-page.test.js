// node worker/shop-page.test.js
import assert from 'node:assert/strict';
import { assetLinks, findShop, siteUrl, hasApp, hasLocations, appRedirect, appManifest, appSplash, configJs, fileOf, pageTitle, headTags, hero, sitemapXml, robotsTxt } from './shop-page.js';

const shops = [
  { id: 'a', domains: ['a-comics.com', 'www.a-comics.com'], supabaseUrl: 'https://aaa.supabase.co', anonKey: 'key-a', gaMeasurementId: 'G-1', app: true },
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
const mapOff = sitemapXml(shops[0], ['faq', 'news', 'my-page']);
assert.doesNotMatch(mapOff, /faq\.html|blog\.html/, 'switched-off pages are left out');
assert.match(mapOff, /calendar\.html/);
// Posts and events from the database
const mapDb = sitemapXml(shops[0], [], {
  posts: [{ slug: 'grand-opening', updated_at: '2026-11-02T10:00:00+00:00' }, { slug: 'bad slug<x>' }, { slug: 'two_words-ok' }],
  events: [{ id: 7 }, { id: '8; drop' }, { id: -1 }, { id: 12 }],
});
assert.match(mapDb, /<loc>https:\/\/a-comics\.com\/news\/grand-opening<\/loc><lastmod>2026-11-02<\/lastmod>/);
assert.match(mapDb, /\/news\/two_words-ok<\/loc><\/url>/, 'no lastmod when there is none');
assert.doesNotMatch(mapDb, /bad slug|drop|id=-1/, 'anything that is not a plain slug or number is skipped');
assert.match(mapDb, /<loc>https:\/\/a-comics\.com\/event\.html\?id=7<\/loc>/);
assert.match(mapDb, /event\.html\?id=12</);
assert.doesNotMatch(sitemapXml(shops[0], ['news'], { posts: [{ slug: 'a' }], events: [{ id: 1 }] }), /\/news\/a</, 'posts go with News');
assert.doesNotMatch(sitemapXml(shops[0], ['calendar'], { posts: [{ slug: 'a' }], events: [{ id: 1 }] }), /event\.html/, 'events go with Calendar');
assert.match(sitemapXml(shops[0], ['calendar'], { posts: [{ slug: 'a' }] }), /\/news\/a</);
assert.equal(sitemapXml(shops[0]), sitemapXml(shops[0], [], {}), 'no database rows: just the fixed pages');
const many = sitemapXml(shops[0], [], { posts: Array.from({ length: 1200 }, (_, i) => ({ slug: `p${i}` })), events: Array.from({ length: 700 }, (_, i) => ({ id: i + 1 })) });
assert.equal((many.match(/\/news\/p/g) ?? []).length, 1000, 'at most 1000 posts');
assert.equal((many.match(/event\.html\?id=/g) ?? []).length, 500, 'at most 500 events');
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
// Only shops marked "app": true have the app; app.<domain> of any other goes to its account page.
assert.equal(hasApp(shops[0]), true);
assert.equal(hasApp(shops[1]), false);
assert.equal(hasApp({ ...shops[1], app: 'yes' }), false, 'only true turns it on');
assert.equal(appRedirect(shops, 'app.b-comics.com'), 'https://B-Comics.com/account.html');
assert.match(configJs(shops[0]), /^export const APP_ENABLED = true;$/m);
assert.match(configJs(shops[1]), /^export const APP_ENABLED = false;$/m);
assert.match(configJs({ ...shops[0], catalog: true }), /^export const IS_CATALOG = true;$/m);
assert.match(configJs(shops[0]), /^export const IS_CATALOG = false;$/m);
// Only shops marked "locations": true can have several pickup locations.
assert.equal(hasLocations({ ...shops[0], locations: true }), true);
assert.equal(hasLocations(shops[0]), false);
assert.equal(hasLocations({ ...shops[0], locations: 'yes' }), false, 'only true turns it on');
assert.match(configJs({ ...shops[0], locations: true }), /^export const LOCATIONS_ENABLED = true;$/m);
assert.match(configJs(shops[0]), /^export const LOCATIONS_ENABLED = false;$/m);
assert.equal(fileOf('/app'), 'app.html');
const app = appManifest({ shop_name: ' A Comics ', colors: { paper: '#f5f0e6' }, logo_url: `${MEDIA}/logo.png` });
assert.equal(app.name, 'A Comics');
assert.equal(app.start_url, '/app');
assert.equal(app.scope, '/app');
assert.equal(app.display, 'standalone');
assert.deepEqual(app.shortcuts.map((x) => x.url), ['/app#list', '/app#hot', '/app#shop']);
assert.deepEqual(app.shortcuts.map((x) => x.icons[0].src), ['/icons/shortcut-list.png', '/icons/shortcut-hot.png', '/icons/shortcut-shop.png']);
assert.deepEqual(app.launch_handler, { client_mode: ['navigate-existing', 'auto'] }, 'one window: links bring the open app forward');
assert.equal(app.theme_color, '#f5f0e6');
assert.deepEqual(app.icons.map((i) => i.sizes), ['192x192', '512x512']);
assert.match(app.icons[1].src, /render\/image\/public\/media\/logo\.png\?width=512&height=512&resize=contain/);
// The app icon and screenshots uploaded in Shop Settings: a maskable icon (also the iPhone's) and the install sheet's pictures
const withApp = appManifest({ shop_name: 'A', logo_url: `${MEDIA}/logo.png`, app_icon_url: `${MEDIA}/brand/icon.png`, app_screenshots: [`${MEDIA}/brand/s1.jpg`, 'javascript:x', `${MEDIA}/brand/s2.jpg`] });
assert.deepEqual(withApp.icons.at(-1), { src: `${MEDIA}/brand/icon.png`, sizes: '512x512', purpose: 'maskable' });
assert.deepEqual(withApp.screenshots.map((x) => [x.src, x.sizes, x.form_factor]), [[`${MEDIA}/brand/s1.jpg`, '1080x2340', 'narrow'], [`${MEDIA}/brand/s2.jpg`, '1080x2340', 'narrow']]);
assert.equal('screenshots' in app, false, 'no screenshots key without any');
assert.equal(app.icons.some((i) => i.purpose === 'maskable'), false);
assert.match(headTags('app.html', { app_icon_url: `${MEDIA}/brand/icon.png`, logo_url: `${MEDIA}/logo.png` }).join(''), /apple-touch-icon" href="[^"]*brand\/icon\.png\?width=180/);
// The app's loading screen: the logo at the header's width, and the name; nothing for a picture that isn't https
assert.deepEqual(appSplash({ shop_name: ' A Comics ', logo_url: `${MEDIA}/logo.png` }), { logo: `https://aaa.supabase.co/storage/v1/render/image/public/media/logo.png?width=320&height=2500&resize=contain&quality=75`, name: 'A Comics' });
assert.deepEqual(appSplash({ logo_url: 'javascript:x' }), { logo: '', name: '' });
const plain = appManifest({ colors: { paper: 'red' }, logo_url: 'javascript:x' });
assert.equal(plain.name, 'My Pull List', 'a name even before the shop has one');
assert.equal(plain.theme_color, '#121212', 'only a hex color');
assert.equal('icons' in plain, false, 'only https icons');
const appHead = headTags('app.html', { shop_name: 'A & B', colors: { paper: '#f5f0e6' }, logo_url: `${MEDIA}/logo.png` }).join('\n');
assert.match(appHead, /<meta name="apple-mobile-web-app-title" content="A &amp; B">/, 'the name under the home-screen icon');
assert.match(appHead, /<meta name="theme-color" content="#f5f0e6">/);
assert.match(appHead, /<link rel="apple-touch-icon" href="[^"]*width=180&amp;height=180/);
assert.doesNotMatch(headTags('index.html', { logo_url: `${MEDIA}/logo.png` }).join(''), /apple-touch-icon|theme-color/, 'only the app page');

// Google Play: assetlinks.json from the shop's "android" entry, only with the app and a valid package and fingerprint
const FP = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const withAndroid = { app: true, android: { package: 'com.mainstreetcomics.pulllist', sha256: [FP.toLowerCase(), 'not-a-fingerprint'] } };
assert.deepEqual(assetLinks(withAndroid), [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.mainstreetcomics.pulllist', sha256_cert_fingerprints: [FP] } }], 'fingerprints upper-cased, bad ones dropped');
assert.equal(assetLinks({ ...withAndroid, app: false }), null, 'no app: no file');
assert.equal(assetLinks({ app: true }), null, 'no android entry: no file');
assert.equal(assetLinks({ app: true, android: { package: 'Not A Package', sha256: [FP] } }), null, 'a bad package name: no file');
assert.equal(assetLinks({ app: true, android: { package: 'com.shop.app', sha256: ['nope'] } }), null, 'no valid fingerprint: no file');

console.log('shop page tests passed');

// node js/layouts.test.js
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { LAYOUTS, layoutOf, heroCovers, heroView, HERO_COVERS, coversChanged } from './layouts.js';

// A shop's picks: saved settings, else (before settings load) what the Worker stamped on <body>, else today's look.
assert.deepEqual(layoutOf({}), { header: 'classic', hero: 'banner', footer: 'full' });
assert.deepEqual(layoutOf({ layout: { header: 'bold', hero: 'nope' } }), { header: 'bold', hero: 'banner', footer: 'full' });
assert.deepEqual(layoutOf({ shop_name: '' }, { header: 'centered', hero: 'slim', footer: 'simple' }), { header: 'centered', hero: 'slim', footer: 'simple' }, 'no layout key → stamped');
assert.equal(layoutOf({ layout: {} }, { header: 'centered' }).header, 'classic', 'saved settings win over stamp');
assert.equal(layoutOf({}, { header: 'nope' }).header, 'classic', 'unknown stamp → default');
assert.deepEqual(layoutOf(null), { header: 'classic', hero: 'banner', footer: 'full' });

// The covers hero takes the first six of New This Week; the shelf starts after them.
const items = Array.from({ length: 8 }, (_, i) => ({ id: i }));
assert.equal(HERO_COVERS, 6);
assert.deepEqual(heroCovers(items, 'covers').covers.map((i) => i.id), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(heroCovers(items, 'covers').shelf.map((i) => i.id), [6, 7]);
assert.deepEqual(heroCovers(items, 'banner'), { covers: [], shelf: items });
assert.deepEqual(heroCovers([], 'covers'), { covers: [], shelf: [] });
// New This Week is built from overlapping queries: a title listed twice shows once, in the hero or the shelf.
const dup = [8, 11, 8, 9, 16, 14, 15, 11, 13, 10, 8, 12].map((id) => ({ id }));
assert.deepEqual(heroCovers(dup, 'covers').covers.map((i) => i.id), [8, 11, 9, 16, 14, 15]);
assert.deepEqual(heroCovers(dup, 'covers').shelf.map((i) => i.id), [13, 10, 12]);
assert.deepEqual(heroCovers(dup, 'banner').shelf.map((i) => i.id), [8, 11, 9, 16, 14, 15, 13, 10, 12]);
// The shelf was split for one hero; live settings may pick another (a visitor's snapshot is days old). Only a change
// into or out of the covers hero moves titles between the hero and the shelf, so only that redraws.
assert.equal(coversChanged('banner', 'covers'), true, 'banner → covers: the hero needs its covers');
assert.equal(coversChanged('covers', 'banner'), true, 'covers → banner: the shelf needs its first six back');
assert.equal(coversChanged('banner', 'slim'), false);
assert.equal(coversChanged('covers', 'covers'), false);
assert.equal(coversChanged(undefined, 'covers'), true, 'nothing drawn yet counts as not covers');

// The hero as drawn (the Worker's first paint and js/pages/home.js share it): stamped picks count before settings load.
assert.equal(heroView({ shop_name: 'X' }, { hero: 'slim' }).layout, 'slim');
assert.equal(heroView({ layout: {} }, { hero: 'slim' }).layout, 'banner');
assert.equal(heroView({ layout: { hero: 'covers' } }).secondButton, true);

// The registry: ids unique, first entry is today's look, every option has a label and hint.
assert.deepEqual(Object.keys(LAYOUTS), ['header', 'hero', 'footer']);
for (const area of Object.keys(LAYOUTS)) {
  assert.equal(new Set(LAYOUTS[area].map((o) => o.id)).size, LAYOUTS[area].length, `${area} ids unique`);
  for (const o of LAYOUTS[area]) assert.ok(o.label && o.hint, `${area} ${o.id} has a label and hint`);
}
assert.deepEqual(LAYOUTS.header.map((o) => o.id), ['classic', 'centered', 'bold']);
assert.deepEqual(LAYOUTS.hero.map((o) => o.id), ['banner', 'split', 'covers', 'slim']);
assert.deepEqual(LAYOUTS.footer.map((o) => o.id), ['full', 'simple', 'signup']);

// Every option other than the default has its look in css/site.css: headers and footers keyed off the <body>
// attribute, heroes off the hero's own class (the hero drawn can differ from the pick: Split without a photo).
const css = readFileSync(new URL('../css/site.css', import.meta.url), 'utf8');
const selector = (area, id) => (area === 'hero' ? `.hero--${id}` : `[data-${area}="${id}"]`);
for (const area of Object.keys(LAYOUTS)) {
  for (const o of LAYOUTS[area].slice(1)) assert.ok(css.includes(selector(area, o.id)), `css/site.css has no rule for ${area} "${o.id}" (${selector(area, o.id)})`);
}

// Colors that follow their ground. The shop name's "&" (.brand__name span) is gold text, readable on the page but not
// on the Bold bar's accent fill or a footer colored apart from the page; the bar's hover must stay readable too.
const flat = css.replace(/\s+/g, ' ');
assert.match(flat, /\[data-header="bold"\] \.brand__name span[^{]*\{[^}]*color: inherit/, 'Bold bar: the "&" follows the bar text');
assert.match(flat, /\[data-header="bold"\] \.nav a:hover[^{]*\{[^}]*color: var\(--on-accent\)/, 'Bold bar: menu hover stays on-accent');
assert.match(flat, /\.footer__brand \.brand__name[^{]*\{[^}]*color: var\(--footer-text\)/, 'Simple footer: the shop name follows the footer text');

// Bold bar keyboard order: the menu button comes before the menu it opens (as in Classic and Centered); on desktop
// CSS puts the menu back between the logo and the search button.
const site = readFileSync(new URL('./site.js', import.meta.url), 'utf8');
const bold = site.slice(site.indexOf('<div class="header__bold">'), site.indexOf('id="header-search"'));
assert.ok(bold.indexOf('${menuBtn}') > 0 && bold.indexOf('${menuBtn}') < bold.indexOf('${nav}'), 'Bold bar: menu button before the menu');
assert.match(flat, /\[data-header="bold"\] \.nav \{[^}]*order:/, 'Bold bar: desktop order puts the menu before the search button');

// Every option has its picture for the admin picker (Shop Settings → Layout).
for (const [area, opts] of Object.entries(LAYOUTS)) {
  for (const o of opts) assert.ok(existsSync(new URL(`../admin/layouts/${area}-${o.id}.svg`, import.meta.url)), `admin/layouts/${area}-${o.id}.svg is missing`);
}

console.log('layouts ok');

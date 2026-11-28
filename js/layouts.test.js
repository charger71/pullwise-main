// node js/layouts.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYOUTS, layoutOf, heroCovers, heroView, HERO_COVERS } from './layouts.js';

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
for (const area of ['header', 'hero']) {
  for (const o of LAYOUTS[area].slice(1)) assert.ok(css.includes(selector(area, o.id)), `css/site.css has no rule for ${area} "${o.id}" (${selector(area, o.id)})`);
}

console.log('layouts ok');

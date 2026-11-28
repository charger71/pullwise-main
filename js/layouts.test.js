// node js/layouts.test.js
import assert from 'node:assert/strict';
import { LAYOUTS, layoutOf, heroCovers, HERO_COVERS } from './layouts.js';

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

// The registry: ids unique, first entry is today's look, every option has a label and hint.
assert.deepEqual(Object.keys(LAYOUTS), ['header', 'hero', 'footer']);
for (const area of Object.keys(LAYOUTS)) {
  assert.equal(new Set(LAYOUTS[area].map((o) => o.id)).size, LAYOUTS[area].length, `${area} ids unique`);
  for (const o of LAYOUTS[area]) assert.ok(o.label && o.hint, `${area} ${o.id} has a label and hint`);
}
assert.deepEqual(LAYOUTS.header.map((o) => o.id), ['classic', 'centered', 'bold']);
assert.deepEqual(LAYOUTS.hero.map((o) => o.id), ['banner', 'split', 'covers', 'slim']);
assert.deepEqual(LAYOUTS.footer.map((o) => o.id), ['full', 'simple', 'signup']);

console.log('layouts ok');

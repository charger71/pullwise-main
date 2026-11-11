// A staff-made page lives at /<slug>, and files are served before pages, so no slug may match a file or folder at the
// top of the site (js/optional-pages.js RESERVED_SLUGS). Also the address helpers the site and Worker share.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { RESERVED_SLUGS, customHref, customSlugHere, pageHref, postHref, postSlugHere } from './optional-pages.js';
import { customSlugOf, customPageSlug, postSlugOf } from '../worker/shop-page.js';

const root = new URL('..', import.meta.url);
for (const f of readdirSync(root, { withFileTypes: true })) {
  if (f.name.startsWith('.') || f.name === 'node_modules') continue;
  // Only what an address without a dot can reach: folders, HTML pages (/about serves about.html) and extensionless files.
  if (!f.isDirectory() && /\./.test(f.name) && !f.name.endsWith('.html')) continue;
  const name = f.name.replace(/\.html$/, '');
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) assert(RESERVED_SLUGS.includes(name.toLowerCase()), `${f.name} at the top of the site needs "${name.toLowerCase()}" in RESERVED_SLUGS`);
}

assert.equal(customHref('ambassador-program'), '/ambassador-program');
assert.equal(pageHref('ambassador-program'), '/ambassador-program');
assert.equal(pageHref('about'), 'about.html');
assert.equal(customSlugHere('/ambassador-program', ''), 'ambassador-program');
assert.equal(customSlugHere('/ambassador-program/', ''), 'ambassador-program');
assert.equal(customSlugHere('/page.html', '?slug=old-one'), 'old-one');
assert.equal(customSlugHere('/page.html', ''), null);
assert.equal(customSlugHere('/page', ''), null);
assert.equal(customSlugOf('/ambassador-program'), 'ambassador-program');
assert.equal(customSlugOf('/ambassador-program/'), 'ambassador-program');
assert.equal(customSlugOf('/a/b'), null);
assert.equal(customSlugOf('/Not_A_Slug'), null);
assert.equal(customSlugOf('/'), null);
const data = { settings: { disabled_pages: ['off-page'] }, pages: { 'ambassador-program': { custom: true }, 'off-page': { custom: true }, about: { custom: false } } };
assert.equal(customPageSlug('/ambassador-program', data), 'ambassador-program');
assert.equal(customPageSlug('/off-page', data), null, 'a switched-off page stays 404');
assert.equal(customPageSlug('/about', data), null, 'a built-in page name is not a staff page');
assert.equal(customPageSlug('/missing', data), null);
assert.equal(customPageSlug('/ambassador-program', null), null);
assert.equal(postHref('grand-opening'), '/news/grand-opening');
assert.equal(postSlugHere('/news/grand-opening', ''), 'grand-opening');
assert.equal(postSlugHere('/news/grand-opening/', ''), 'grand-opening');
assert.equal(postSlugHere('/post.html', '?slug=old-post'), 'old-post');
assert.equal(postSlugHere('/post.html', ''), null);
assert.equal(postSlugHere('/news', ''), null);
assert.equal(postSlugOf('/news/grand-opening'), 'grand-opening');
assert.equal(postSlugOf('/news/a/b'), null);
assert.equal(postSlugOf('/news'), null);
assert.equal(postSlugOf('/blog/x'), null);
console.log('slug tests passed');

// Storefront stylesheet checks: static, no browser. Run by `npm test`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/site.css'), 'utf8');
const scripts = ['js', 'js/pages'].flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));

// The storefront's breakpoints (see the comment at the top of css/site.css). A layout that needs a new width uses the
// nearest of these instead, so the site changes shape at a few known widths.
const MIN = [480, 600, 700, 800, 1100];
const MAX = MIN.map((n) => n - 1);
const bad = [];
for (const m of css.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)) {
  const n = Number(m[2]);
  if (!(m[1] === 'min' ? MIN : MAX).includes(n)) bad.push(`css/site.css: (${m[1]}-width: ${m[2]}px)`);
}
for (const f of scripts) {
  const src = readFileSync(join(root, f), 'utf8');
  for (const m of src.matchAll(/matchMedia\(\s*['"`]\((min|max)-width:\s*([\d.]+)px\)/g)) {
    if (!(m[1] === 'min' ? MIN : MAX).includes(Number(m[2]))) bad.push(`${f}: (${m[1]}-width: ${m[2]}px)`);
  }
}
assert.equal(bad.length, 0, `Use the storefront breakpoints (min-width ${MIN.join(' / ')}px, max-width ${MAX.join(' / ')}px):\n${bad.join('\n')}`);
console.log('storefront stylesheet tests passed');

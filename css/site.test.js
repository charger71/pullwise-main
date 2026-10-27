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
// Colors: every color that depends on the page is a variable in :root (the shop's settings, or a role js/theme-vars.js
// can swap for a light page). Outside :root only page-independent ones may be written out: black, white, their
// translucent shades (scrims, shadows, dot screens) and #161616, the dark text on the always-light callout.
const PAGE_FREE = /^(#000|#000c|#fff|#ffffff[0-9a-f]{2}|#161616|rgb\((0 0 0|255 255 255) \/ [\d.]+\))$/i;
const rules = css.slice(css.indexOf('\n}', css.indexOf(':root {'))) // after the :root block
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/url\("data:[^"]*"\)/g, '')
  .replace(/\[style\*=(["'])[^\]]*?\1\]/g, ''); // staff text matched by its inline color
const literals = [...rules.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map((m) => m[0]).filter((c) => !PAGE_FREE.test(c));
assert.equal(literals.length, 0, `Put these colors in :root as a role (and give it a light-page value in js/theme-vars.js if it is text or a badge):\n${[...new Set(literals)].join('\n')}`);

// Text on a gold (accent) fill follows the accent, not the page: on a light page the page color is light too.
const onGold = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter(([, , body]) => /background(-color)?:\s*var\(--gold\)/.test(body) && /(^|[;\s])color:\s*var\(--paper\)/.test(body))
  .map(([, sel]) => sel.trim());
assert.equal(onGold.length, 0, `Text on a gold fill uses --on-accent:\n${onGold.join('\n')}`);

console.log('storefront stylesheet tests passed');

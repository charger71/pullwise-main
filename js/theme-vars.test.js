// node js/theme-vars.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { colorVars, themeCss, resolveFonts, fontPreloads, unusedDefaultPreloads, isFontUpload, FONT_LIBRARY, FONT_SLOTS, linkColor, contrast, accentText, letterSpacing, sizeScale, fontScale, schemeCss, pageIs, LIGHT_PAGE, DARK_PAGE, DARK_PAGE_VARS } from './theme-vars.js';

const SB = 'https://abc.supabase.co';
const upload = (name) => `${SB}/storage/v1/object/public/media/fonts/${name}`;
const vars = (colors) => Object.fromEntries(colorVars(colors));

// Colors: the five brand colors, and what follows from them
const dark = vars({ primary: '#982c21', accent: '#e7b84b', ink: '#f4f0ea', paper: '#121212', footer: '#121212' });
assert.equal(dark['--brand-primary'], '#982c21');
assert.equal(dark['--on-primary'], '#ffffff', 'white text on a dark main color');
assert.equal(dark['--teal'], '#91bbdd', 'the first readable blue on a dark page');
assert.equal(dark['color-scheme'], undefined, 'a dark page keeps the stylesheet’s dark scheme');
assert.equal(dark['--cream'], undefined);
const light = vars({ primary: '#ffd100', paper: '#ffffff', footer: '#f4f4f4' });
assert.equal(light['--on-primary'], '#161616', 'dark text on a light main color');
assert.equal(dark['--on-accent'], '#161616', 'dark text on the default gold');
assert.equal(vars({ accent: '#2a4d8f' })['--on-accent'], '#ffffff', 'white text on a dark accent');
assert.equal(light['color-scheme'], 'light');
assert.equal(light['--teal'], '#0b4f8a');
assert.equal(light['--cream'], 'var(--ink)');
for (const v of ['--error', '--ok', '--warn', '--clearance', '--violet']) {
  assert.ok(contrast(light[v], '#ffffff') >= 4.5, `${v} reads on a light page (and the page color reads on it as a badge)`);
}
assert.equal(dark['--warn'], undefined, 'a dark page keeps the stylesheet’s orange');
assert.equal(dark['--gold-text'], undefined, 'gold reads on the default dark page as it is');
assert.ok(contrast(light['--gold-text'], '#ffffff') >= 4.5, 'gold text is darkened until it reads on a white page');
assert.equal(accentText('#7a3fb0', '#ffffff'), '#7a3fb0', 'an accent that already reads is kept');
assert.ok(contrast(vars({ accent: '#2a2a40' })['--gold-text'], '#121212') >= 4.5, 'a dark accent is lightened on the dark page');
assert.ok(contrast(accentText('#e7b84b', '#f6f1e7'), '#f6f1e7') >= 4.5);
assert.equal(light['--footer-text'], '#161616');
assert.equal(vars({ paper: '#ffffff', link: '#123456' })['--teal'], '#123456', 'a picked link color wins');
assert.equal(linkColor({}), null);
assert.deepEqual(colorVars(null), []);
assert.deepEqual(colorVars({ primary: 'red', 'x;}body{': '#fff', paper: '#12121z' }), [], 'only hex colors on plain keys');

// Fonts: built-in and uploaded, checked
assert.equal(new Set(FONT_LIBRARY.map((f) => f.id)).size, FONT_LIBRARY.length, 'library ids are unique');
for (const f of FONT_LIBRARY) assert.ok(fs.existsSync(new URL(`../fonts/${f.file}`, import.meta.url)), `fonts/${f.file} exists`);
for (const s of FONT_SLOTS) assert.ok(FONT_LIBRARY.find((f) => f.id === s.default)?.slots.includes(s.slot), `${s.slot} default is in the library`);

assert.deepEqual(resolveFonts(undefined), []);
assert.deepEqual(resolveFonts({ display: { font: 'archivo-black' }, body: { font: 'source-sans-3' } }), [], 'a default pick changes nothing');
assert.deepEqual(resolveFonts({ display: { font: 'nope' } }), [], 'unknown fonts are ignored');
assert.deepEqual(resolveFonts({ body: { font: 'bangers' } }), [], 'a display face is not offered for body text');
const [bangers] = resolveFonts({ display: { font: 'bangers' } });
assert.equal(bangers.family, 'Shop Display');
assert.equal(bangers.src, 'fonts/bangers-latin.woff2');
assert.equal(bangers.weight, '100 900', 'a single-weight face covers every weight, so nothing is faked bold');
assert.equal(resolveFonts({ body: { font: 'inter' } })[0].weight, '400 800');

assert.ok(isFontUpload(upload('1a-my-font.woff2'), SB));
assert.ok(isFontUpload(upload('x.woff'), `${SB}/`));
assert.ok(!isFontUpload(upload('x.ttf'), SB), 'only web font files');
assert.ok(!isFontUpload(upload('../x.woff2'), SB));
assert.ok(!isFontUpload(upload("x');}body{color:red}/*.woff2"), SB));
assert.ok(!isFontUpload('https://evil.example/storage/v1/object/public/media/fonts/x.woff2', SB), 'only the shop’s own storage');
assert.ok(!isFontUpload(upload('x.woff2'), ''), 'no storage, no uploads (demo)');
assert.ok(!isFontUpload(upload('x.woff2'), "https://abc.supabase.co'"));
assert.equal(resolveFonts({ heading: { upload: upload('a.woff2') } }, { storageOrigin: SB })[0].src, upload('a.woff2'));
assert.deepEqual(resolveFonts({ heading: { upload: upload('a.woff2') } }), [], 'uploads need the storage address to check against');

// Preloads: the new files, and the page's built-in ones that are no longer used
assert.deepEqual(fontPreloads({ display: { font: 'bangers' }, heading: { font: 'bangers' } }), ['fonts/bangers-latin.woff2'], 'one file, one preload');
assert.deepEqual(unusedDefaultPreloads({ display: { font: 'bangers' } }), ['fonts/archivo-black-latin.woff2']);
assert.deepEqual(unusedDefaultPreloads({ body: { font: 'inter' }, display: { font: 'source-sans-3' } }), ['fonts/archivo-black-latin.woff2'], 'a default file still used elsewhere stays');
assert.deepEqual(unusedDefaultPreloads({ heading: { font: 'inter' } }), [], 'the heading font has no preload of its own');

// The CSS block
assert.equal(themeCss({}), '');
assert.equal(themeCss({ colors: {}, fonts: {} }), '');
const css = themeCss({ colors: { primary: '#982c21' }, fonts: { display: { font: 'bebas-neue', caps: false }, body: { font: 'lora' } } });
assert.match(css, /^@font-face\{font-family:'Shop Display';font-style:normal;font-weight:100 900;font-display:swap;src:url\(fonts\/bebas-neue-latin\.woff2\) format\('woff2'\)\}$/m);
assert.match(css, /@font-face\{font-family:'Shop Body';[^}]*font-weight:400 700;/);
assert.match(css, /^:root\{--brand-primary:#982c21;--on-primary:#ffffff;--font-display:'Shop Display', Impact, 'Arial Narrow', sans-serif;--display-weight:400;--display-tracking:0\.01em;--display-scale:1\.3;--font-body:'Shop Body', Georgia, serif;--body-scale:0\.97;--display-case:none\}$/m);

// Letter spacing: Tight / Wide move the font's own
assert.equal(letterSpacing('display', 'normal'), -0.045, 'the default headline font keeps its preset');
assert.equal(letterSpacing('display', 'tight', [400, '.01em']).toFixed(3), '-0.020');
assert.equal(letterSpacing('body', 'wide'), 0.03);
assert.equal(letterSpacing('heading', 'sideways'), 0, 'unknown choices are normal');
assert.equal(themeCss({ fonts: { display: { spacing: 'wide' } } }), ':root{--display-tracking:0.005em}', 'Wide on the default headline font');
assert.equal(themeCss({ fonts: { heading: { font: 'archivo', spacing: 'tight' }, body: { spacing: 'wide' } } }), ':root{--heading-tracking:-0.02em;--body-tracking:0.03em}');
assert.equal(themeCss({ fonts: { body: { spacing: 'normal' } } }), '');
assert.equal(themeCss({ fonts: { body: { spacing: 'constructor' } } }), '', 'only the listed choices');
assert.match(themeCss({ fonts: { display: { font: 'inter', spacing: 'tight' } } }), /--display-tracking:-0\.07em/);
assert.equal(themeCss({ fonts: { display: { caps: false } } }), ':root{--display-case:none}', 'caps can be turned off on the default headline font');
assert.match(themeCss({ fonts: { body: { upload: upload('a.woff') } } }, { storageOrigin: SB }), /format\('woff'\)/);
assert.doesNotMatch(themeCss({ colors: { primary: '#fff</style>' }, fonts: { body: { upload: '</style><script>' } } }, { storageOrigin: SB }), /</, 'nothing can close the <style> tag');

// Sizes: Small / Large scale the slot's sizes; Medium is as designed
assert.equal(sizeScale('display', 'large'), 1.2);
assert.equal(sizeScale('body', 'small'), 0.92);
assert.equal(sizeScale('heading', 'medium'), 1);
assert.equal(sizeScale('heading', 'toString'), 1, 'only the listed choices');
assert.equal(themeCss({ fonts: { body: { size: 'medium' } } }), '');
assert.equal(themeCss({ fonts: { display: { size: 'large' }, body: { size: 'small', spacing: 'wide' } } }), ':root{--display-scale:1.2;--body-tracking:0.03em;--body-scale:0.92}');

// Each font's own size adjustment, so it looks as big as the default at Medium
for (const f of FONT_LIBRARY) assert.equal(f.metrics?.length, 3, `${f.id} has metrics`);
for (const s of FONT_SLOTS) assert.equal(fontScale(s.slot, s.default), 1, `${s.slot} default is 1`);
assert.equal(fontScale('display', 'bebas-neue'), 1.3, 'a narrow headline face is set bigger (capped at 1.3)');
assert.equal(fontScale('heading', 'bangers'), 1.24, 'display faces are matched by their capitals anywhere');
assert.equal(fontScale('body', 'inter'), 0.89, 'body text is matched by x-height');
assert.equal(fontScale('body', 'nope'), 1, 'unknown or uploaded fonts stay as they are');
for (const s of FONT_SLOTS) for (const f of FONT_LIBRARY.filter((x) => x.slots.includes(s.slot))) {
  const r = fontScale(s.slot, f.id);
  assert.ok(r >= 0.8 && r <= 1.3, `${f.id} in ${s.slot}: ${r}`);
}
assert.match(themeCss({ fonts: { display: { font: 'bebas-neue', size: 'large' } } }), /--display-scale:1\.56[;}]/, 'own size times Large');
assert.match(themeCss({ fonts: { body: { font: 'inter' } } }), /--body-scale:0\.89[;}]/);
assert.doesNotMatch(themeCss({ fonts: { body: { upload: upload('a.woff2') } } }, { storageOrigin: SB }), /--body-scale/, 'an uploaded font keeps the default size');

// The app's Light and Dark appearance: the shop's colors on the other kind of page
const scheme = (colors, s) => Object.fromEntries(schemeCss(colors, s).replace(/^:root:root\{|\}$/g, '').split(';').filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]));
assert.equal(schemeCss({}, 'dark'), '', 'the stylesheet’s page is already dark');
assert.equal(schemeCss({ paper: '#f5f0e6' }, 'light'), '', 'a light shop page is already light');
assert.equal(schemeCss({}, 'shop'), '', 'only light or dark');
assert.ok(pageIs({ paper: '#ffffff' }, 'light') && pageIs(undefined, 'dark'));
assert.match(schemeCss({}, 'light'), /^:root:root\{/, 'outranks the shop’s :root wherever it sits');
const toLight = scheme({ primary: '#982c21', accent: '#e7b84b', ink: '#e9e1d3', paper: '#101010', link: '#91bbdd', footer: '#000000' }, 'light');
assert.equal(toLight['--brand-paper'], LIGHT_PAGE.paper);
assert.equal(toLight['--brand-ink'], LIGHT_PAGE.ink);
assert.equal(toLight['--brand-primary'], '#982c21', 'the shop’s main color stays');
assert.equal(toLight['color-scheme'], 'light');
assert.ok(!('--brand-footer' in toLight), 'the app has no footer');
assert.ok(contrast(toLight['--teal'], LIGHT_PAGE.paper) >= 4.5, 'the dark page’s link color is swapped for a readable one');
assert.ok(contrast(toLight['--gold-text'], LIGHT_PAGE.paper) >= 4.5, 'gold text reads on the light page');
for (const k of ['--error', '--ok', '--warn', '--clearance', '--violet']) assert.ok(contrast(toLight[k], LIGHT_PAGE.paper) >= 4.5, `${k} on the light page`);
assert.ok(contrast(LIGHT_PAGE.ink, LIGHT_PAGE.paper) >= 7 && contrast(DARK_PAGE.ink, DARK_PAGE.paper) >= 7, 'text on each page');
const toDark = scheme({ primary: '#1d4ed8', accent: '#b45309', ink: '#222222', paper: '#ffffff', link: '#0b4f8a' }, 'dark');
assert.equal(toDark['--brand-paper'], DARK_PAGE.paper);
assert.equal(toDark['color-scheme'], 'dark');
assert.equal(toDark['--cream'], '#e9e1d3', 'the light page’s colors go back to the stylesheet’s dark-page ones');
assert.ok(contrast(toDark['--teal'], DARK_PAGE.paper) >= 4.5 && contrast(toDark['--gold-text'], DARK_PAGE.paper) >= 4.5);
assert.equal(scheme({ accent: '#e7b84b', paper: '#ffffff' }, 'dark')['--gold-text'], 'var(--gold)', 'the shop page’s darkened gold is undone');
// Dark puts back css/site.css's own dark-page colors, so they must be the stylesheet's.
const rootCss = fs.readFileSync(new URL('../css/site.css', import.meta.url), 'utf8').match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const rootVar = (name) => rootCss.match(new RegExp(`(?:^|[\\s;])${name}:\\s*([^;]+);`))?.[1].trim();
for (const [name, value] of DARK_PAGE_VARS) assert.equal(rootVar(name), value, `${name} matches css/site.css`);
assert.equal(rootVar('--brand-paper'), DARK_PAGE.paper, 'Dark’s page is the stylesheet’s');
assert.equal(rootVar('--brand-ink'), DARK_PAGE.ink, 'Dark’s text is the stylesheet’s');

console.log('theme-vars tests passed');

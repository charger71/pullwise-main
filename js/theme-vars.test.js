// node js/theme-vars.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { colorVars, themeCss, resolveFonts, fontPreloads, unusedDefaultPreloads, isFontUpload, FONT_LIBRARY, FONT_SLOTS, linkColor } from './theme-vars.js';

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
assert.equal(light['color-scheme'], 'light');
assert.equal(light['--teal'], '#0b4f8a');
assert.equal(light['--cream'], 'var(--ink)');
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
assert.match(css, /^:root\{--brand-primary:#982c21;--on-primary:#ffffff;--font-display:'Shop Display', Impact, 'Arial Narrow', sans-serif;--display-weight:400;--display-tracking:\.01em;--font-body:'Shop Body', Georgia, serif;--display-case:none\}$/m);
assert.equal(themeCss({ fonts: { display: { caps: false } } }), ':root{--display-case:none}', 'caps can be turned off on the default headline font');
assert.match(themeCss({ fonts: { body: { upload: upload('a.woff') } } }, { storageOrigin: SB }), /format\('woff'\)/);
assert.doesNotMatch(themeCss({ colors: { primary: '#fff</style>' }, fonts: { body: { upload: '</style><script>' } } }, { storageOrigin: SB }), /</, 'nothing can close the <style> tag');

console.log('theme-vars tests passed');

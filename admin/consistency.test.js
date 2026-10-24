// Guards the admin's look so the fixes in the style guide cannot quietly slip back. Static checks only (no browser, no
// dependencies), so it runs in `npm test` and CI. When a check fails, the message says what to do.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), 'utf8');
const base = read('base.css');
const css = read('admin.css');
const guide = read('style-guide.html');
const lib = read('lib.js');
const sectionFiles = readdirSync(join(dir, 'sections')).filter((f) => f.endsWith('.js'));
const sections = Object.fromEntries(sectionFiles.map((f) => [f, read(`sections/${f}`)]));
const allCss = `${base}\n${css}`;

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}\n  ${String(e.message).split('\n').join('\n  ')}`);
  }
};
const uniq = (a) => [...new Set(a)].sort();

// ---- Colors: pairs of tokens that must stay readable in both themes --------------------------------------------------
const block = (selector) => {
  const start = base.indexOf(selector);
  assert.ok(start >= 0, `${selector} not found in base.css`);
  return base.slice(start, base.indexOf('\n}', start));
};
const tokens = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2]]));
const light = tokens(block(':root {'));
const dark = { ...light, ...tokens(block(":root[data-theme='dark'] {")) };
const lum = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const PAIRS = [
  // [text, background]; '#fff' is literal white
  ['brand-ink', 'brand-paper'], ['brand-ink', 'surface'], ['muted', 'brand-paper'], ['muted', 'surface'], ['muted', 'stripe'],
  ['muted', 'head-bg'], ['muted', 'hover-bg'], ['danger-ink', 'surface'], ['danger-ink', 'stripe'], ['danger-ink', 'brand-paper'],
  ['#fff', 'fold-head-bg'], ['#fff', 'brand-primary'], ['#fff', 'success'], ['#fff', 'info'], ['#fff', 'danger'],
  ['on-accent', 'brand-accent'],
];
for (const [name, theme] of [['light', light], ['dark', dark]]) {
  check(`text contrast in the ${name} theme`, () => {
    const bad = [];
    for (const [fg, bg] of PAIRS) {
      const f = fg === '#fff' ? '#ffffff' : theme[fg];
      const b = theme[bg];
      assert.ok(f && b, `a token in ${fg} / ${bg} is not defined as a hex color`);
      const r = ratio(f, b);
      if (r < 4.5) bad.push(`${fg} (${f}) on ${bg} (${b}) is ${r.toFixed(2)}:1, needs 4.5:1`);
    }
    assert.equal(bad.length, 0, bad.join('\n'));
  });
}

check('every color token has a dark twin (or is on the same-in-both list)', () => {
  const SAME_IN_BOTH = ['brand-primary', 'brand-accent', 'on-accent', 'pill-off-text', 'success', 'danger', 'fold-head-bg', 'pill-pink'];
  const missing = Object.keys(light).filter((t) => !(t in tokens(block(":root[data-theme='dark'] {"))) && !SAME_IN_BOTH.includes(t));
  assert.equal(missing.length, 0, `these tokens have no dark value in base.css: ${missing.join(', ')}.\nAdd them to the dark block, or to SAME_IN_BOTH here if they really are identical.`);
});

// ---- No stray colors in components ---------------------------------------------------------------------------------
check('admin.css uses tokens, not new raw colors', () => {
  const ALLOWED = ['#fff', '#ffffff', '#000', '#000000', '#161616', '#f6d365', '#1f1d19', '#f1ead8', '#ddd', '#ccc', '#c8102e', '#ffd100', '#a4001d', '#16723a', '#e0303f', '#b45f06', '#434f62', '#fff3', '#fff4'];
  const found = [];
  css.split('\n').forEach((line, i) => {
    if (/^\s*(\/\*|\*)/.test(line)) return;
    for (const m of line.replace(/\/\*.*?\*\//g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      if (!ALLOWED.includes(m[0].toLowerCase())) found.push(`admin.css:${i + 1} ${m[0]}`);
    }
  });
  assert.equal(found.length, 0, `${found.join('\n')}\nUse a variable from base.css (add one, with a dark value, if none fits).`);
});

// ---- Buttons ------------------------------------------------------------------------------------------------------
check('button heights come from one rule, not per-screen overrides', () => {
  const bad = [];
  css.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*([^{]*\.btn\b[^{]*)\{([^}]*)\}/);
    if (!m || /icon-btn|link-button/.test(m[1])) return;
    if (/min-height:\s*(40|44|48)px/.test(m[2]) && !/^\s*(\.btn|\.btn\.btn--small)\s*$/.test(m[1])) bad.push(`admin.css:${i + 1} ${m[1].trim()}`);
  });
  assert.equal(bad.length, 0, `${bad.join('\n')}\nButtons are 48px (small 44px) on phones from the one rule near "every button is a 48px tap target". Remove the override.`);
});

check('every button variant used exists in the CSS', () => {
  const used = uniq([...Object.values(sections), guide].flatMap((t) => [...t.matchAll(/(?<![\w-])btn--([a-z]+)\b/g)].map((m) => m[1])));
  const missing = used.filter((v) => !new RegExp(`\\.btn--${v}\\b`).test(allCss));
  assert.equal(missing.length, 0, `btn--${missing.join(', btn--')} used but not defined`);
});

// ---- Pills --------------------------------------------------------------------------------------------------------
check('every pill tone used exists in the CSS', () => {
  const used = uniq([...Object.values(sections), guide].flatMap((t) => [...t.matchAll(/\bpill--([a-z_]+)\b/g)].map((m) => m[1])));
  const missing = used.filter((v) => !new RegExp(`\\.pill--${v}\\b`).test(allCss));
  assert.equal(missing.length, 0, `pill--${missing.join(', pill--')} used but not defined (an unstyled pill is invisible)`);
});

// ---- Folds and hints ------------------------------------------------------------------------------------------------
check('clickable fold headers hold no buttons', () => {
  const bad = [];
  for (const [file, text] of Object.entries(sections)) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('<summary class="fold__head"')) return;
      const context = `${lines[i - 1] ?? ''}${line}`;
      if (context.includes('fold--static')) return;
      const summary = line.slice(line.indexOf('<summary'), line.includes('</summary>') ? line.indexOf('</summary>') : undefined);
      if (/<button|class="btn|<a class="btn/.test(summary)) bad.push(`sections/${file}:${i + 1}`);
    });
  }
  assert.equal(bad.length, 0, `${bad.join('\n')}\nA button inside a header you click to open makes it hard to tap. Put it in the fold body, or make the fold static.`);
});

check('"How this works" starts closed', () => {
  const m = lib.match(/export const hintFold = [^\n]*/);
  assert.ok(m, 'hintFold not found in lib.js');
  assert.ok(!/\bopen\b/.test(m[0]), 'hintFold must not render the details open; the boxes start closed to save space');
});

check('clickable fold headers keep their minimum height', () => {
  assert.match(css, /\.fold:not\(\.fold--static\)[^{]*\.fold__head\s*\{[^}]*min-height:\s*52px/, 'clickable fold headers must be at least 52px tall');
  assert.match(css, /\.admin-table th\s*\{[^}]*var\(--fold-head-bg\)/, 'table header rows must use --fold-head-bg');
  assert.match(css, /\.fold__head\s*\{[^}]*var\(--fold-head-bg\)/, 'fold headers must use --fold-head-bg');
});

// ---- The style guide must show the shared components ---------------------------------------------------------------
check('the style guide shows every shared component', () => {
  const COMPONENTS = ['btn--primary', 'btn--ghost', 'btn--green', 'btn--blue', 'btn--danger', 'btn--add', 'btn--small', 'icon-btn', 'admin-tab', 'admin-tab__badge', 'chip',
    'admin-table', 'cards', 'card-title', 'card-key', 'card-wide', 'card-foot', 'pill', 'fold', 'fold--static', 'admin-hint-fold', 'panel', 'dash-tile', 'dash-card', 'dialog__head',
    'toast', 'notice', 'dropzone', 'sticky-actions', 'form-grid--pairs', 'field--check', 'admin-pager', 'admin-status', 'admin-hint', 'empty', 'form-error'];
  const hasClass = (c) => [...guide.matchAll(/class="([^"]*)"/g)].some((m) => m[1].split(/\s+/).includes(c));
  const missing = COMPONENTS.filter((c) => !hasClass(c));
  assert.equal(missing.length, 0, `style-guide.html has no example of: ${missing.join(', ')}.\nAdd it to the guide in the same change.`);
});

check('every "How this works" box is built with hintFold', () => {
  const bad = Object.entries(sections).filter(([, t]) => /<details class="admin-hint-fold[^>]*>\s*<summary>[^<]*How this works/.test(t)).map(([f]) => f);
  assert.equal(bad.length, 0, `${bad.join(', ')} build the hint box by hand; use hintFold() from lib.js`);
});

if (failures) {
  console.error(`\n${failures} admin consistency check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('admin consistency tests passed');

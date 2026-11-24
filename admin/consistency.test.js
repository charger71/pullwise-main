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
// The shared helpers: lib.js and the two files split from it (the editor and pictures), checked as one.
const lib = ['lib.js', 'editor.js', 'images.js'].map(read).join('\n');
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
  ['success-ink', 'surface'], ['success-ink', 'stripe'], ['success-ink', 'brand-paper'],
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

// Field borders and the focus ring are UI parts, not text: WCAG 1.4.11 needs 3:1 against what they sit on.
const UI_PAIRS = [['field-line', 'surface'], ['field-line', 'brand-paper'], ['focus', 'surface'], ['focus', 'brand-paper']];
for (const [name, theme] of [['light', light], ['dark', dark]]) {
  check(`field borders and focus ring contrast in the ${name} theme`, () => {
    const bad = UI_PAIRS.map(([fg, bg]) => [fg, bg, ratio(theme[fg], theme[bg])]).filter(([, , r]) => r < 3);
    assert.equal(bad.length, 0, bad.map(([fg, bg, r]) => `${fg} (${theme[fg]}) on ${bg} (${theme[bg]}) is ${r.toFixed(2)}:1, needs 3:1`).join('\n'));
  });
}
// --success and --danger are fills (white text on them); as text or an icon they drop below 3:1 in the dark theme.
check('green and red text use the -ink tokens', () => {
  const bad = [...allCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^}]*(?<![\w-])color:\s*var\(--(success|danger)\)/g)].map((m) => `${m[1].trim()} uses --${m[2]} as a text color; use --${m[2]}-ink`);
  assert.equal(bad.length, 0, bad.join('\n'));
});
check('fold headers use the shared focus ring', () => {
  assert.match(css, /\.fold__head:focus-visible\s*\{[^}]*var\(--focus\)/, 'the fold header focus ring must be var(--focus); the accent yellow is 1.3:1 on the page');
});

check('every color token has a dark twin (or is on the same-in-both list)', () => {
  const SAME_IN_BOTH = ['brand-primary', 'brand-accent', 'on-accent', 'pill-off-text', 'success', 'danger', 'fold-head-bg', 'pill-pink'];
  const missing = Object.keys(light).filter((t) => !(t in tokens(block(":root[data-theme='dark'] {"))) && !SAME_IN_BOTH.includes(t));
  assert.equal(missing.length, 0, `these tokens have no dark value in base.css: ${missing.join(', ')}.\nAdd them to the dark block, or to SAME_IN_BOTH here if they really are identical.`);
});

// ---- No stray colors in components ---------------------------------------------------------------------------------
// Literal colors that are the same whatever the theme: white and black (with their see-through shades for the image
// tools and the dialog backdrop), the dark text used on light fills, and the Super admin pill's black and gold.
const PAGE_FREE_COLORS = ['#fff', '#ffffff', '#000', '#000000', '#000a', '#fff3', '#fff4', '#161616', '#f6d365'];
// The stylesheets without their comments and :root token blocks (where the values are defined).
const rulesOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root(\[data-theme=['"]dark['"]\])?\s*\{[^}]*\}/g, '');
const declarations = (t) => [...rulesOnly(t).matchAll(/(?<![-\w])([a-z-]+)\s*:\s*([^;{}]+)/g)].map((m) => [m[1], m[2].trim()]);
const outsideCalc = (v) => v.replace(/calc\((?:[^()]|\([^()]*\))*\)/g, '');

check('the admin CSS uses tokens, not new raw colors', () => {
  const found = Object.entries({ 'base.css': base, 'admin.css': css }).flatMap(([f, t]) =>
    [...rulesOnly(t).replace(/url\("data:[^"]*"\)/g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
      .filter((m) => !PAGE_FREE_COLORS.includes(m[0].toLowerCase())).map((m) => `${f}: ${m[0]}`));
  assert.equal(found.length, 0, `${found.join('\n')}\nUse a variable from base.css (add one, with a dark value, if none fits).`);
});

// --border is a whole border (1px solid var(--line)); used where a color belongs, the declaration is dropped and no
// border shows.
check('--border is used as a whole border, not as a color', () => {
  const bad = Object.entries({ 'base.css': base, 'admin.css': css, ...Object.fromEntries(Object.entries(sections).map(([f, t]) => [`sections/${f}`, t])) })
    .flatMap(([f, t]) => [...t.matchAll(/(?:solid|dashed|dotted)\s+var\(--border\b[^)]*\)|var\(--border\s*,/g)].map((m) => `${f}: ${m[0]}`));
  assert.equal(bad.length, 0, `${bad.join('\n')}\nWrite border: var(--border), or 1px solid var(--line) for a different width.`);
});

// ---- Spacing and corners from tokens --------------------------------------------------------------------------------
// Margin, padding and gap use the --sp-* scale. Allowed besides: 0, auto, em/ch/% (text-relative), negative offsets that
// line edges up (geometry, not spacing), and anything inside calc().
check('spacing uses the --sp-* scale', () => {
  const bad = Object.entries({ 'base.css': base, 'admin.css': css }).flatMap(([f, t]) => declarations(t)
    .filter(([p]) => /^(margin|padding|gap|row-gap|column-gap)(-|$)/.test(p))
    .filter(([, v]) => /(?<![\w.-])\d*\.?\d+(px|rem)\b/.test(outsideCalc(v)))
    .map(([p, v]) => `${f}: ${p}: ${v}`));
  assert.equal(bad.length, 0, `Bare spacing:\n${bad.join('\n')}\nUse a --sp-* step from base.css (2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 64).`);
});

check('corners use the --radius-* tokens', () => {
  const bad = Object.entries({ 'base.css': base, 'admin.css': css }).flatMap(([f, t]) => declarations(t)
    .filter(([p, v]) => /^border(-[a-z]+)*-radius$/.test(p) && /(?<![\w.-])\d*\.?\d+(px|rem)\b/.test(outsideCalc(v)))
    .map(([p, v]) => `${f}: ${p}: ${v}`));
  assert.equal(bad.length, 0, `Bare corner radii:\n${bad.join('\n')}\nUse --radius, --radius-xs|sm|lg|xl or --radius-pill (50% for circles).`);
});

// ---- Buttons ------------------------------------------------------------------------------------------------------
check('button heights come from one rule, not per-screen overrides', () => {
  const bad = [];
  css.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*([^{]*\.btn\b[^{]*)\{([^}]*)\}/);
    if (!m || /icon-btn|link-button/.test(m[1])) return;
    if (/min-height:\s*((40|44|48)px|var\(--tap(-btn)?\))/.test(m[2]) && !/^\s*(\.btn|\.btn\.btn--small)\s*$/.test(m[1])) bad.push(`admin.css:${i + 1} ${m[1].trim()}`);
  });
  assert.equal(bad.length, 0, `${bad.join('\n')}\nButtons are 48px (small 44px) on phones from the one rule near "every button is a 48px tap target". Remove the override.`);
});

check('buttons drop their minimum width through the natural-width list, not a per-selector reset', () => {
  const bad = [];
  css.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*([^{]*\.btn\b[^{]*)\{([^}]*)\}/);
    if (m && /(^|[;\s])min-width:\s*0\b/.test(m[2])) bad.push(`admin.css:${i + 1} ${m[1].trim()}`);
  });
  assert.equal(bad.length, 0, `${bad.join('\n')}\nAdd the place to the "Natural-width buttons" list at the end of admin.css (it sets --btn-w and --btn-w-sm to 0) instead of resetting min-width on .btn.`);
});

check('every button variant used exists in the CSS', () => {
  const used = uniq([...Object.values(sections), guide].flatMap((t) => [...t.matchAll(/(?<![\w-])btn--([a-z]+)\b/g)].map((m) => m[1])));
  const missing = used.filter((v) => !new RegExp(`\\.btn--${v}\\b`).test(allCss));
  assert.equal(missing.length, 0, `btn--${missing.join(', btn--')} used but not defined`);
});

// ---- Dead CSS ------------------------------------------------------------------------------------------------------
check('every class in the admin CSS is used by some screen', () => {
  // Any word in the admin's own files or the shared site scripts counts as a use, which also covers classes built from
  // a value (pill--${status}); the dashboard's is-${level} dots are listed by name. Names built another way go in BY_DESIGN.
  const readAll = (d) => readdirSync(join(dir, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? readAll(join(d, e.name)) : e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [read(join(d, e.name))] : []));
  const words = new Set(`${readAll('.').join('\n')}\n${read('index.html')}\n${read('style-guide.html')}\n${readdirSync(join(dir, '..', 'js')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, '..', 'js', f), 'utf8')).join('\n')}`.match(/[A-Za-z_][\w-]*/g));
  const BY_DESIGN = /^(ql-|img-align-|pill--|is-(ok|warn|bad|off)$|(m[tbl]?|gap)-\d+$|ml-auto$|text-(muted|danger|success|right)$|items-|justify-|flex-1$|font-mono$|nowrap$|center$)/;
  const defined = new Set([...allCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^}]*\}/g, '{}').matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
  const dead = [...defined].filter((c) => !words.has(c) && !BY_DESIGN.test(c)).sort();
  assert.equal(dead.length, 0, `${dead.join(', ')} are defined in the admin CSS but no screen, script or the style guide uses them.\nDelete the rules, or add the name to BY_DESIGN here if it is built some other way.`);
});

check('every CSS variable that is used is defined', () => {
  const stripped = allCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set([...stripped.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const inScripts = Object.values(sections).join('\n');
  const missing = [...new Set([...stripped.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !defined.has(v) && !inScripts.includes(v));
  assert.equal(missing.length, 0, `${missing.join(', ')} used but never defined (a fallback value hides it, and then it never follows the theme).`);
});

// ---- Pills --------------------------------------------------------------------------------------------------------
check('every pill tone used exists in the CSS', () => {
  const used = uniq([...Object.values(sections), guide].flatMap((t) => [...t.matchAll(/\bpill--([a-z_]+)\b/g)].map((m) => m[1])));
  const missing = used.filter((v) => !new RegExp(`\\.pill--${v}\\b`).test(allCss));
  assert.equal(missing.length, 0, `pill--${missing.join(', pill--')} used but not defined (an unstyled pill is invisible)`);
});

// ---- Folds and hints ------------------------------------------------------------------------------------------------
check('no <summary> holds a control, and static folds are not <details>', () => {
  const files = { ...Object.fromEntries(Object.entries(sections).map(([f, t]) => [`sections/${f}`, t])), 'lib.js': lib, 'style-guide.html': guide };
  const bad = Object.entries(files).flatMap(([f, t]) => [
    // a control inside a summary can't be reached reliably and fights the summary's own toggle
    ...[...t.matchAll(/<summary\b[\s\S]*?<\/summary>/g)].filter((m) => /<(button|input|select|textarea)\b|<a\b|class="btn/.test(m[0])).map((m) => `${f}: ${m[0].slice(0, 70)}…`),
    // an always-open fold is a <section>, so its header isn't a tab stop that opens nothing
    ...[...t.matchAll(/<details[^>]*fold--static[^>]*>/g)].map((m) => `${f}: ${m[0]}`),
  ]);
  assert.equal(bad.length, 0, `${bad.join('\n')}\nPut controls beside or below the header, and build a static fold as <section class="fold fold--static"><div class="fold__head">.`);
});

check('the screen area is not a live region', () => {
  const index = read('index.html');
  assert.doesNotMatch(index.match(/<section id="section"[^>]*>/)?.[0] ?? '', /aria-live/, 'aria-live on #section reads the whole screen aloud on every change; use role="status" on the message instead');
});

check('"How this works" starts closed', () => {
  const m = lib.match(/export const hintFold = [^\n]*/);
  assert.ok(m, 'hintFold not found in lib.js');
  assert.ok(!/\bopen\b/.test(m[0]), 'hintFold must not render open; How this works is a ? that opens a dialog');
});

check('clickable fold headers keep their minimum height', () => {
  assert.match(base, /--tap-head:\s*52px/, '--tap-head must stay 52px');
  assert.match(css, /\n\.fold__head\s*\{[^}]*min-height:\s*var\(--tap-head\)/, 'every fold header is at least --tap-head (52px) tall');
  assert.doesNotMatch(css, /\.fold--compact[^{,]*\.fold__head\s*\{[^}]*padding/, 'compact folds use the shared header padding');
  assert.match(css, /\.admin-table th\s*\{[^}]*var\(--fold-head-bg\)/, 'table header rows must use --fold-head-bg');
  assert.match(css, /\.fold__head\s*\{[^}]*var\(--fold-head-bg\)/, 'fold headers must use --fold-head-bg');
});

// ---- The style guide must show the shared components ---------------------------------------------------------------
check('the style guide shows every shared component', () => {
  const COMPONENTS = ['btn--primary', 'btn--ghost', 'btn--green', 'btn--blue', 'btn--danger', 'btn--add', 'btn--small', 'icon-btn', 'icon-btn--info', 'admin-tab', 'admin-tab__badge', 'admin-nav__badge', 'view-switch', 'account-menu', 'chip',
    'admin-table', 'cards', 'card-title', 'card-key', 'card-wide', 'card-foot', 'pill', 'fold', 'fold--static', 'icon-btn--hint', 'panel', 'dash-tile', 'dash-card', 'dialog__head',
    'toast', 'toast__link', 'notice', 'dropzone', 'sticky-actions', 'form-grid--pairs', 'field--check', 'admin-pager', 'admin-status', 'admin-hint', 'empty', 'form-error',
    'select--small', 'cust-export-opt', 'color-grid', 'color-row', 'font-pick', 'font-preview', 'hours-row', 'holiday-row', 'media-grid', 'media-item', 'thumb', 'thumb--fix', 'thumb--sm', 'thumb--lg', 'info-list', 'job-log', 'faq-item__move', 'is-hidden', 'is-overdue', 'chat-thread', 'chat-msg', 'chat-msg--staff', 'chat-msg__meta', 'chat-compose', 'push-compose', 'push-preview', 'switch', 'switch__track', 'switch__text', 'choice-list', 'choice-list__option',
    'help-topics', 'help-topic', 'help-topic__video', 'help-article', 'help-steps', 'help-tip', 'help-shot', 'help-video', 'help-open', 'help-pager', 'help-pager__link--next', 'help-link'];
  const hasClass = (c) => [...guide.matchAll(/class="([^"]*)"/g)].some((m) => m[1].split(/\s+/).includes(c));
  const missing = COMPONENTS.filter((c) => !hasClass(c));
  assert.equal(missing.length, 0, `style-guide.html has no example of: ${missing.join(', ')}.\nAdd it to the guide in the same change.`);
});

// ---- Row colours ---------------------------------------------------------------------------------------------------
// Rows are painted, never their cells, from one block in priority order; an !important or a cell colour starts the fight again.
check('table row colours paint the row, without !important', () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const bad = rules.filter(([sel, body]) => /background/.test(body) && (/\btd\b/.test(sel) || (/\btr\b/.test(sel) && /!important/.test(body))));
  assert.equal(bad.length, 0, `Paint table rows (tr) from the "Row colours" block, not cells or !important:\n${bad.map(([s]) => s).join('\n')}`);
});

// ---- Sizes from tokens ---------------------------------------------------------------------------------------------
// Text sizes and stacking order come from the named steps in base.css (:root), not bare numbers.
check('font sizes and z-index use the tokens', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[^}]*\}/, '');
  const bad = Object.entries({ 'base.css': base, 'admin.css': css }).flatMap(([f, t]) => [
    ...[...strip(t).matchAll(/font-size:\s*[\d.]+(?:rem|px)|font:\s*(?:\d{3}\s+)?[\d.]+(?:rem|px)/g)].map((m) => `${f}: ${m[0]}`),
    ...[...strip(t).matchAll(/z-index:\s*\d+/g)].map((m) => `${f}: ${m[0]}`),
  ]);
  assert.equal(bad.length, 0, `Bare sizes:\n${bad.join('\n')}\nUse a --fs-* step or a --z-* level from base.css.`);
});

// Motion and shadows come from base.css too. A shadow may be written out only as an inset edge, or built from tokens
// with zero offsets (the sticky Save button's halo).
check('durations and shadows use the tokens', () => {
  const bad = Object.entries({ 'base.css': base, 'admin.css': css }).flatMap(([f, t]) => declarations(t)
    .filter(([p, v]) => (/^(transition|animation)(-duration|-delay)?$/.test(p) && /(?<![\w.-])\d*\.?\d+m?s\b/.test(outsideCalc(v)))
      || (p === 'box-shadow' && v.split(/,(?![^(]*\))/).some((part) => !/^\s*(inset\b|none\s*$)/.test(part) && /[^\s0]/.test(part.replace(/var\([^)]*\)/g, '')))))
    .map(([p, v]) => `${f}: ${p}: ${v}`));
  assert.equal(bad.length, 0, `${bad.join('\n')}\nUse a --dur-* step, or --shadow, --shadow-lg or a --shadow-* role from base.css.`);
});

// Under prefers-reduced-motion every transition stops, and every animation has its own rule that stops or slows it.
check('animations stop or slow under prefers-reduced-motion', () => {
  const plain = allCss.replace(/\/\*[\s\S]*?\*\//g, '');
  let calm = '';
  let moving = plain;
  for (let at = plain.indexOf('prefers-reduced-motion'); at !== -1; at = plain.indexOf('prefers-reduced-motion', at + 1)) {
    let i = plain.indexOf('{', at) + 1;
    const start = i;
    for (let depth = 1; depth; i++) depth += plain[i] === '{' ? 1 : plain[i] === '}' ? -1 : 0;
    calm += plain.slice(start, i - 1) + '\n';
    moving = moving.replace(plain.slice(start, i - 1), '');
  }
  const selectors = (text) => text.split(/,(?![^(]*\))/).map((x) => x.trim().replace(/\s+/g, ' '));
  const calmed = new Set([...calm.matchAll(/([^{};]+)\{([^{}]*)\}/g)].filter(([, , b]) => /animation/.test(b)).flatMap(([, sel]) => selectors(sel)));
  assert.match(calm, /\*\s*\{\s*transition:\s*none !important;?\s*\}/, 'Keep `* { transition: none !important; }` under prefers-reduced-motion in base.css.');
  const restless = [...moving.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
    .filter(([sel, , b]) => !/^\s*(@|\d|from|to)/.test(sel) && /(?<![-\w])animation:\s*(?!none)/.test(b))
    .flatMap(([, sel]) => selectors(sel)).filter((sel) => !calmed.has(sel));
  assert.equal(restless.length, 0, `Stop or slow these animations under @media (prefers-reduced-motion: reduce):\n${restless.join('\n')}`);
});

// ---- Markup habits --------------------------------------------------------------------------------------------------
// A screen's look is a class in admin.css, where the checks above see it. An inline style is only for a value worked
// out at run time (a bar's width, a contrast sample's colors), so it must contain a ${…}.
check('markup carries no fixed inline styles', () => {
  const scripts = { 'lib.js': lib, 'admin.js': read('admin.js'), ...Object.fromEntries(Object.entries(sections).map(([f, t]) => [`sections/${f}`, t])) };
  const bad = Object.entries(scripts).flatMap(([f, t]) => [...t.matchAll(/\sstyle=\\?(["'])((?:(?!\1).)*)\1/g)]
    .filter((m) => !m[2].includes('${')).map((m) => `${f}: ${m[0].trim()}`));
  assert.equal(bad.length, 0, `${bad.join('\n')}\nMove these into a class in admin.css (or use a helper such as font-mono).`);
});

check('no empty spacer labels, and ids come from uid()', () => {
  const files = { ...Object.fromEntries(Object.entries(sections).map(([f, t]) => [`sections/${f}`, t])), 'lib.js': lib, 'style-guide.html': guide };
  const bad = Object.entries(files).flatMap(([f, t]) => [
    // a filter row lines its fields up along the bottom; an empty label to push a button down is not needed
    ...(/<span class="label">(&nbsp;|\s)*<\/span>/.test(t) ? [`${f}: empty <span class="label"> spacer`] : []),
    // label / field ids: uid('prefix') from lib.js (surveys.js's newQuestionId is a saved question id, not an element id)
    ...[...t.matchAll(/^.*Math\.random\(\)\.toString.*$/gm)].filter((m) => !/newQuestionId/.test(m[0])).map((m) => `${f}: ${m[0].trim().slice(0, 80)}`),
  ]);
  assert.equal(bad.length, 0, bad.join('\n'));
});

// ---- Breakpoints ---------------------------------------------------------------------------------------------------
// Phone < 600, tablet 600-899, desktop >= 900, wide >= 1200; 700 splits small tablets and 380 the narrowest phones.
check('media queries only use the shared breakpoints', () => {
  const ALLOWED = new Set([380, 599, 600, 699, 700, 899, 900, 1199, 1200]);
  const files = { 'base.css': base, 'admin.css': css, 'style-guide.html': guide, 'lib.js': lib, ...sections };
  const bad = Object.entries(files).flatMap(([f, t]) => [...t.matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)]
    .filter((m) => !ALLOWED.has(+m[1])).map((m) => `${f}: ${m[0]}`));
  const calls = Object.entries(sections).flatMap(([f, t]) => [...t.matchAll(/isPhone\((\d+)\)/g)].filter((m) => !ALLOWED.has(+m[1])).map((m) => `${f}: ${m[0]}`));
  assert.equal(bad.length + calls.length, 0, `Off-scale breakpoints:\n${[...bad, ...calls].join('\n')}\nUse one of ${[...ALLOWED].join(', ')}px.`);
});

check('every "How this works" box is built with hintFold', () => {
  const bad = Object.entries(sections).filter(([, t]) => /<details class="admin-hint-fold[^>]*>\s*<summary>[^<]*How this works/.test(t)).map(([f]) => f);
  assert.equal(bad.length, 0, `${bad.join(', ')} build the hint box by hand; use hintFold() from lib.js`);
});

// Every screen's top, in this order: the title row (the h1 and at most two buttons), How this works (hintFold, or the
// hintSlot that setHint / setupTabs' hints fill), the tabs, then everything else. A screen-level hint is never under
// the tabs: a tab's own hint goes in the slot.
check('screen tops: title row, How this works, tabs, then everything else', () => {
  const bad = [];
  for (const [f, t] of Object.entries(sections)) {
    for (const m of t.matchAll(/class="admin-tabs[^"]*" role="tablist"/g)) {
      const h1 = t.lastIndexOf('<h1', m.index);
      if (h1 < 0 || m.index - h1 > 2000) continue; // tabs inside a dialog or a panel, not a screen's top
      const top = t.slice(h1, m.index);
      // Between the title and the tabs: only the title row's own pieces and the hint.
      const extra = top
        .replace(/\$\{hintFold\((`[\s\S]*?`|'[^']*')\)\}/g, '')
        .replace(/\$\{hintSlot\(\)\}/g, '');
      if (/<(form|details|section|table|ul|ol)\b|class="(admin-hint|admin-toolbar|filters)\b/.test(extra)) bad.push(`${f}: something other than the title row and How this works sits above the tabs`);
      const row = top.match(/class="admin-title-row[\s\S]*/)?.[0] ?? '';
      const buttons = (row.match(/class="btn\b/g) ?? []).length;
      if (buttons > 2) bad.push(`${f}: ${buttons} buttons in the title row (two at most; the rest go below the tabs)`);
      const end = t.indexOf('`;', m.index);
      const below = t.slice(m.index, end < 0 ? undefined : end);
      // A form's own hint inside a fold (Staff → My account's colours) is fine; a loose one under the tabs is not.
      const loose = [...below.matchAll(/\$\{hintFold\(/g)].some((h) => {
        const before = below.slice(0, h.index);
        return (before.match(/<details\b/g) ?? []).length <= (before.match(/<\/details>/g) ?? []).length;
      });
      if (loose) bad.push(`${f}: How this works sits below the tabs (put it above them, or in the hintSlot for a tab's own hint)`);
    }
  }
  assert.equal(bad.length, 0, bad.join('\n'));
});

// Every screen explains itself: a How this works right under its title (hintFold, or the hintSlot setHint fills).
check('every admin screen has a How this works under its title', () => {
  // A screen exports mount(); a tab another screen mounts (import-pull-lists.js) sits under that screen's title.
  const missing = Object.entries(sections)
    .filter(([, t]) => /export (async )?function mount\(/.test(t))
    .filter(([, t]) => ![...t.matchAll(/<h1\b/g)].some((m) => /\$\{hint(Fold\(|Slot\(\))/.test(t.slice(m.index, m.index + 1500))))
    .map(([f]) => f);
  assert.equal(missing.length, 0, `No How this works under the title: ${missing.join(', ')}`);
});

if (failures) {
  console.error(`\n${failures} admin consistency check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('admin consistency tests passed');

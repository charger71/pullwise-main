// Storefront (shop-*) and staff admin (admin-*) tokens, read from the repo and merged into the existing tokens.json.
import { read, varsOf, usedBy, hex6, ratio, mix, fmt } from './css.mjs';
import { REPO } from './config.mjs';

/** Things a person should look at after a run: new variables the generator has no note for. */
export const warnings = [];

const base = read(`${REPO}admin/base.css`);
const adminCss = read(`${REPO}admin/admin.css`);
const site = read(`${REPO}css/site.css`);
const allAdmin = `${base}\n${adminCss}`;

const isColor = (v) => /^#[0-9a-f]{3,8}$/i.test(v);
const isVarRef = (v) => /^var\(--[\w-]+\)$/.test(v);
const refName = (v) => v.slice(6, -1);
const rgbaOf = (v) => v.replace(/rgb\((\d+) (\d+) (\d+) \/ (\.?\d+)\)/g, (_, r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${Number(a)})`);

// ---------------------------------------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------------------------------------
const aLight = varsOf(base, ':root {');
const aDark = Object.fromEntries(varsOf(base, ":root[data-theme='dark'] {"));
const aBtn = varsOf(adminCss, ':root {');

const ADMIN_NOTE = {
  'brand-primary': 'Main color: the tab row underline, primary buttons, link hover, tick boxes and radios, the Sale pill. White text on it.',
  'brand-accent': 'Accent yellow: the default button, notices, the Arrived / New / Pull list pills and the shop name in the header. Text on it is admin-on-accent. Never text on paper (1.3:1).',
  'on-accent': 'Text on admin-brand-accent in both themes (admin-ink turns light in the dark theme).',
  'brand-ink': 'Text color source; admin-ink aliases it.',
  'brand-paper': 'Page background source; admin-paper aliases it.',
  ink: 'Body text and headings on admin-paper, admin-surface and admin-stripe.',
  paper: 'Page background behind panels, folds and tables.',
  surface: 'Panels, fold bodies, inputs, dialogs and table rows.',
  muted: 'Secondary text: hints, meta lines, captions and counts.',
  line: 'Soft dividers and card edges (the --border shorthand: 1px solid admin-line).',
  'field-line': 'Outlines of inputs, selects, ghost buttons and the dialog close button: 3:1 against admin-surface and admin-paper.',
  focus: 'Focus ring, 3px solid with a 2px offset, on every interactive element.',
  danger: 'Solid red fills: Delete and Remove buttons, the Failed pill. White text on it.',
  'danger-ink': 'Red as text or an outline: form errors, the Remove icon button, overdue warnings.',
  'danger-soft': 'Background of an overdue, failed or blocked row (tr.is-overdue).',
  success: 'Green fills: Mark ordered and other progress buttons. White text on it. Never text or an icon: that is admin-success-ink.',
  'success-ink': 'Green as text or an icon: "Saved." (.admin-status--ok), .text-success, the Add icon button.',
  'success-hover': 'Hover fill of green buttons.',
  info: 'Blue buttons. White text on it.',
  'info-hover': 'Hover fill of blue buttons.',
  stripe: 'Every other table row, and callout backgrounds.',
  'head-bg': 'Soft header tint: icon-button hover, sort-button hover.',
  'fold-head-bg': 'The slate band at the top of every fold and table: white text on it in both themes.',
  'header-bg': 'The sticky admin header bar.',
  'header-fg': 'Text and links in the admin header.',
  'tab-bg': 'An unselected tab.',
  'tab-hover': 'A tab under the pointer.',
  'hover-bg': 'Hover fill of rows and list items that are not table rows.',
  raised: 'Slightly raised fills inside a card (toolbars, inline editors).',
  'code-bg': 'Inline code and the style guide\'s code boxes.',
  'neutral-bg': 'The plain pill (Guest order) and neutral chips.',
  'neutral-bg-2': 'Quiet fills behind secondary groups.',
  'hover-row': 'A table row under the pointer.',
  'hover-row-danger': 'An overdue row under the pointer.',
  'merge-bg': 'Series merge: a row folding into another (tr.is-merge).',
  'keep-bg': 'Series merge: the row to keep (tr.is-keep).',
  'select-bg': 'The open order row (tr.is-open) and selected items.',
  'select-bg-light': 'Alternate rows inside an open order.',
  'dropzone-bg': 'File drop zone at rest.',
  'dropzone-hover': 'File drop zone while a file is over it.',
  'pill-open': 'Open and Pre-order pills.',
  'pill-ordered': 'Ordered, Backorder and Info pills.',
  'pill-done': 'Picked up, Available and Done pills.',
  'pill-warn': 'Not ordered, Low stock and Warn pills.',
  'pill-off': 'Released, Cancelled, Sold out and Staff pills.',
  'pill-off-text': 'Text on admin-pill-off.',
  'card-tint': 'Tinted card backgrounds on the dashboard.',
  'group-bg': 'Group header rows inside a list (Ready / Open / Past).',
  'track-bg': 'The empty part of progress and bar tracks.',
  'media-bg': 'Behind pictures in the media library.',
  'line-strong': 'Borders that must read more than admin-line (chips, sortable headers).',
  'line-dash': 'Dashed outline of empty states.',
  'line-dash-2': 'Dashed outline of the drop zone.',
  'select-edge': 'Edge of a selected item or row.',
  'warn-text': 'Amber warning text (cust-warn).',
  bar: 'Bars in dashboard charts.',
  'ok-dot': 'Healthy status dot on the dashboard.',
  'warn-dot': 'Warning status dot on the dashboard.',
  'alert-icon': 'Red status icons: something staff should act on.',
  'minor-icon': 'Amber status icons: a minor issue.',
  'danger-hover': 'Hover fill of red buttons.',
  'tool-bg': 'Editor and image tool bars.',
  'pill-pink': 'The Clearance pill.',
};

// Text tokens and the grounds they read on (the pairs admin/consistency.test.js guards, plus white on fills).
const ADMIN_PAIRS = {
  'brand-ink': ['brand-paper', 'surface'],
  muted: ['brand-paper', 'surface', 'stripe', 'head-bg', 'hover-bg'],
  'danger-ink': ['surface', 'stripe', 'brand-paper'],
  'success-ink': ['surface', 'stripe', 'brand-paper'],
  'on-accent': ['brand-accent'],
  'field-line': ['surface', 'brand-paper'],
  focus: ['surface', 'brand-paper'],
};
const ADMIN_WHITE_ON = ['fold-head-bg', 'brand-primary', 'success', 'info', 'danger'];

const lightMap = Object.fromEntries(aLight);
const resolveA = (name, theme) => {
  let v = theme === 'dark' ? aDark[name] ?? lightMap[name] : lightMap[name];
  for (let n = 0; n < 8 && v && isVarRef(v); n++) {
    const r = refName(v);
    v = theme === 'dark' ? aDark[r] ?? lightMap[r] : lightMap[r];
  }
  return v;
};

const contrastNote = (fg, bgs, res) => bgs.map((bg) => {
  const l = ratio(hex6(res(fg, 'light')), hex6(res(bg, 'light')));
  const d = ratio(hex6(res(fg, 'dark')), hex6(res(bg, 'dark')));
  return `${fmt(l)} light / ${fmt(d)} dark on admin-${bg}`;
}).join('; ');

const SIZE_A = { tap: 'Smallest touch target: fields, small buttons and toggles on phones.', 'tap-btn': 'A button on a phone.', 'tap-head': 'A fold header you click or tap open.', 'header-h': 'The sticky admin header; things that stick sit at top: admin-header-h.', 'field-h': 'Height of every input, select and search box (= admin-tap).', gutter: 'Side padding of the page container.', max: 'Widest the page content gets.', 'btn-w': 'Minimum width of a button, so Save / Delete pairs and pagers match.', 'btn-w-sm': 'Minimum width of a small button.' };
const Z_A = { 'z-raised': 'Above neighbouring content (editor image tools, a dialog\'s action bar).', 'z-sticky': 'Sticky bars and headers inside the page.', 'z-header': 'The admin header.', 'z-float': 'Toasts and the update banner.', 'z-busy': 'The loading dimmer; its spinner sits one above.' };
const FS_A = { 'fs-title': 'Panel, month, post and dialog titles.', 'fs-sub': 'Sub-headings: h3, group headings.', 'fs-card': 'The heading of a card, panel or fold.', 'fs-h1': 'Page title (h1).', 'fs-compact': 'Titles inside dense lists.', 'fs-2xs': 'Badges, pills, counts.', 'fs-xs': 'Small uppercase labels and captions.', 'fs-sm': 'Notes, meta lines, field hints.', 'fs-ui': 'Dense UI: tables, small buttons, filters, admin hints.', 'fs-md': 'Card text a little under body size.', 'fs-base': 'Body size; also stops phones zooming into fields.', 'fs-lg': 'Editor h2.', 'fs-xl': 'Big numbers and the sign-in page title.', 'fs-page': 'Admin page title inside a section.', 'fs-stat': 'Dashboard tile numbers.' };
const RADIUS_A = { radius: 'Default for panels, folds, fields and buttons.', 'radius-xs': 'Small inner corners (calendar picker button).', 'radius-sm': 'Chips and do / don\'t notes.', 'radius-lg': 'Media tiles and larger cards.', 'radius-xl': 'Dialogs.', 'radius-pill': 'Pills and count badges.' };

export function adminTokens() {
  const color = [], spacing = [], radius = [], shadow = [], size = [], zIndex = [], fontSize = [], duration = [];
  const families = {};
  // The comment after a variable in :root is its note. A shadow token holds plain values, so the variables inside one
  // (--shadow, a color) are written out for each theme.
  const note = (n) => (base.match(new RegExp(`--${n}:[^;]*;\\s*/\\*\\s*([^*]+?)\\s*\\*/`))?.[1] ?? '').replace(/^./, (c) => c.toUpperCase());
  const plainShadow = (v, theme) => rgbaOf(v.replace(/var\(--([\w-]+)\)/g, (_, r) => plainShadow(resolveA(r, theme) ?? '', theme)));
  for (const [name, v] of [...aLight, ...aBtn]) {
    const d = aDark[name];
    const t = `admin-${name}`;
    const where = usedBy(allAdmin, name);
    const used = where.length ? ` Used by ${where.join(', ')}.` : '';
    if (isColor(v) || (isVarRef(v) && (isColor(resolveA(name, 'light') ?? '')))) {
      const val = (x) => (isVarRef(x) ? `{admin-${refName(x)}}` : x.toLowerCase());
      const value = d && d !== v ? { dark: val(d), light: val(v) } : val(v);
      if (!ADMIN_NOTE[name]) warnings.push(`admin/base.css --${name}: a new color with no note in tokens.mjs ADMIN_NOTE (its note only says where it is used)`);
      let usage = (ADMIN_NOTE[name] ?? '') + used;
      if (ADMIN_PAIRS[name]) usage += ` Contrast: ${contrastNote(name, ADMIN_PAIRS[name], resolveA)}.`;
      if (ADMIN_WHITE_ON.includes(name)) {
        usage += ` White text on it: ${fmt(ratio('#ffffff', hex6(resolveA(name, 'light'))))} light / ${fmt(ratio('#ffffff', hex6(resolveA(name, 'dark'))))} dark.`;
      }
      color.push({ name: t, value, usage: usage.trim() });
    } else if (/^sp-/.test(name)) spacing.push({ name: t, value: v, usage: `Spacing step (${v}) for margin, padding and gap in the admin; never a bare pixel value.` });
    else if (/^radius/.test(name)) radius.push({ name: t, value: v, usage: RADIUS_A[name] + used });
    else if (name === 'shadow' || name === 'shadow-lg') shadow.push({ name: t, value: d && d !== v ? { dark: rgbaOf(d), light: rgbaOf(v) } : rgbaOf(v), usage: (name === 'shadow' ? 'Resting cards, panels, folds and buttons.' : 'Dialogs and floating panels.') + used });
    else if (/^shadow-/.test(name)) {
      const [light, dark] = [plainShadow(v, 'light'), plainShadow(v, 'dark')];
      shadow.push({ name: t, value: light === dark ? light : { dark, light }, usage: `${note(name)}.` + used });
    } else if (/^dur(-|$)/.test(name)) duration.push({ name: t, value: v, usage: `${note(name)}.` });
    else if (/^z-/.test(name)) zIndex.push({ name: t, value: v, usage: Z_A[name] });
    else if (/^fs-/.test(name)) fontSize.push({ name: t, value: v, usage: FS_A[name] });
    else if (SIZE_A[name]) size.push({ name: t, value: isVarRef(v) ? lightMap[refName(v)] : v, usage: SIZE_A[name] });
    else if (/^font-/.test(name)) families[`admin-${name.slice(5)}`] = v.replace(/'/g, '"');
    // --border (a shorthand) stays in the stylesheet.
  }
  return { color, spacing, radius, shadow, size, zIndex, fontSize, duration, families };
}

// ---------------------------------------------------------------------------------------------------------------------
// Storefront
// ---------------------------------------------------------------------------------------------------------------------
const sVars = varsOf(site, ':root {');
const sMap = Object.fromEntries(sVars);
const SHOP_NOTE = {
  'brand-primary': 'SHOP SETTING "Main color": primary buttons (Reserve), the top bar, sale badges, nav count badges, the event month strip. Text on it is shop-on-primary.',
  'brand-accent': 'SHOP SETTING "Accent": gold for the current nav item, ghost buttons, Staff Pick and New badges, collector chips, headline highlights, footer headings. Text on it is shop-paper.',
  'brand-ink': 'SHOP SETTING "Text": body text; every neutral (surface, raised, line, field-line, muted) is mixed from it and shop-brand-paper.',
  'brand-paper': 'SHOP SETTING "Page background". A light pick switches links, errors and success to their light-page values (js/theme-vars.js).',
  'brand-footer': 'SHOP SETTING "Footer background"; footer text and links switch to stay readable on it.',
  'on-primary': 'Text on shop-brand-primary: white, or #161616 when the shop picks a light main color.',
  'footer-heading': 'Footer column headings.',
  'footer-link': 'Footer links.',
  'footer-link-hover': 'Footer links under the pointer.',
  ink: 'Body text on shop-paper and the surfaces mixed from it.',
  paper: 'Page background; also the text on gold and blue fills.',
  gold: 'The accent in use (alias of shop-brand-accent).',
  'red-btn': 'Primary button fill (alias of shop-brand-primary).',
  cream: 'Warm off-white for the shop name, nav links and hero text on a dark page.',
  teal: 'Dusty blue: links, the default button, focus rings, ticked boxes, the multi-select hover edge. On a light page it is replaced by the first readable blue.',
  'teal-hover': 'Links and the default button under the pointer.',
  'teal-dark': 'Notice background (with a 3px shop-teal left edge).',
  error: 'Form errors and a FOC date that is close.',
  ok: 'Success text (Saved, Following), the Available badge fill.',
  focus: 'Focus ring, 3px solid with a 3px offset (alias of shop-teal).',
  'on-accent': 'Text on shop-gold fills (badges, Staff Pick, New, Done, picked choices, highlights, staff quotes): #161616, or white when the shop picks a dark accent.',
  'gold-text': 'The accent as text or an edge: current menu item, ghost buttons, chips, event types, the headline highlight. The accent itself on the default dark page; on a light page js/theme-vars.js darkens it until it reads (default gold on white: #8b6e2d, 4.8:1).',
  warn: 'Orange: the Low Stock badge and staff orange text. A dark orange on a light page.',
  clearance: 'Pink: the Clearance badge. A dark rose on a light page.',
  violet: 'Purple for staff purple text. A dark violet on a light page.',
  'sold-out': 'The Sold Out badge: a dark chip on any page, with shop-on-sold-out text.',
  'on-sold-out': 'Text on shop-sold-out.',
};

const DERIVED = {
  surface: ['paper', 'ink', 0.04], raised: ['paper', 'ink', 0.09], line: ['paper', 'ink', 0.17],
  'field-line': ['paper', 'ink', 0.52], muted: ['paper', 'ink', 0.76],
};
const resolveS = (name) => {
  if (DERIVED[name]) { const [a, b, p] = DERIVED[name]; return mix(resolveS(a), resolveS(b), p); }
  let v = sMap[name];
  for (let n = 0; n < 8 && v && isVarRef(v); n++) v = sMap[refName(v)];
  if (name === 'on-primary') return '#ffffff';
  return v && isColor(v) ? hex6(v) : null;
};
export const shopDerived = () => Object.fromEntries(Object.keys(DERIVED).map((k) => [k, resolveS(k)]));

const SHOP_PAIRS = {
  ink: ['paper', 'surface', 'raised'], cream: ['paper', 'surface'], teal: ['paper', 'surface'],
  error: ['paper', 'surface'], ok: ['paper', 'surface'], 'on-primary': ['brand-primary'],
  paper: ['teal', 'ok', 'warn', 'clearance'],
  'on-accent': ['gold'], 'gold-text': ['paper', 'surface'], 'on-sold-out': ['sold-out'], violet: ['paper'],
};

export function shopTokens() {
  const color = [];
  const families = {};
  const other = { spacing: [], radius: [], shadow: [], size: [], fontSize: [], zIndex: [], duration: [] };
  // The comment after a variable in :root is its note ("--fs-sm: .85rem;  /* hints, notes */").
  const note = (n) => (site.match(new RegExp(`--${n}:[^;]*;\\s*/\\*\\s*([^*]+?)\\s*\\*/`))?.[1] ?? '').replace(/^./, (c) => c.toUpperCase());
  // A shadow token holds plain values: a color-mix of a color with transparent becomes that color at the same alpha.
  const plainShadow = (v) => rgbaOf(v).replace(/color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, transparent\)/g, (_, c, pc) => {
    const h = resolveS(c);
    return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${Number(pc) / 100})`;
  });
  for (const [name, v] of sVars) {
    const t = `shop-${name}`;
    const where = usedBy(site, name);
    const used = where.length ? ` Used by ${where.join(', ')}.` : '';
    if (isColor(v) || (isVarRef(v) && resolveS(refName(v)) && !DERIVED[refName(v)] && refName(v) !== 'muted')) {
      if (!SHOP_NOTE[name]) { warnings.push(`css/site.css --${name}: a new color with no note in tokens.mjs SHOP_NOTE, so it is left out of the system`); continue; }
      let usage = SHOP_NOTE[name] + used;
      if (SHOP_PAIRS[name]) usage += ` Contrast: ${SHOP_PAIRS[name].map((bg) => `${fmt(ratio(resolveS(name), resolveS(bg)))} on ${bg}`).join(', ')}.`;
      color.push({ name: t, value: isVarRef(v) ? `{shop-${refName(v)}}` : v.toLowerCase(), usage });
    } else if (/^font-/.test(name)) families[`shop-${name.slice(5)}`] = v.replace(/'/g, '"');
    else if (name === 'radius') other.radius.push({ name: t, value: v, usage: 'Panels, cards, filters, maps and editor images.' + used });
    else if (/^radius-/.test(name)) other.radius.push({ name: t, value: v, usage: (note(name) ? `${note(name)}.` : '') + used });
    else if (/^sp-\d+$/.test(name)) other.spacing.push({ name: t, value: v, usage: `Spacing step (${v}) for margin, padding and gap on the storefront; never a bare pixel value.` });
    else if (/^fs-/.test(name) && !/var\(/.test(v)) other.fontSize.push({ name: t, value: v, usage: (note(name) ? `${note(name)}.` : '') + ' Fixed: does not follow Shop Settings → Fonts → Size.' });
    else if (name === 'list-bar-h') other.size.push({ name: t, value: v, usage: 'Height of the pull-list bar at the foot of the screen; the page leaves this much room under it.' });
    else if (name === 'shadow') other.shadow.push({ name: t, value: v, usage: 'Resting cards and panels carry no shadow: borders in shop-line separate them.' });
    else if (name === 'shadow-lg') other.shadow.push({ name: t, value: rgbaOf(v), usage: 'Dialogs and the open multi-select panel.' });
    else if (/^shadow-/.test(name)) other.shadow.push({ name: t, value: plainShadow(v), usage: `${note(name)}.` + used });
    else if (/^z-/.test(name)) other.zIndex.push({ name: t, value: /var\(/.test(v) ? v : String(Number(v)), usage: `${note(name)}.` });
    else if (/^dur(-|$)/.test(name)) other.duration.push({ name: t, value: v, usage: `${note(name)}.` });
    else if (name === 'space-block') other.spacing.push({ name: t, value: v, usage: 'Gap under a page title block (section head, How it works).' });
    else if (name === 'field-h') other.size.push({ name: t, value: v, usage: 'Height of every input, select and multi-select button.' });
    else if (name === 'gutter') other.size.push({ name: t, value: v, usage: 'Side padding of the page container.' });
    else if (name === 'max') other.size.push({ name: t, value: v, usage: 'Widest the page content gets.' });
  }
  return { color, families, ...other };
}

// The shop's colors and fonts (Shop Settings → Logo, Colors & Fonts) as one block of CSS. The site Worker writes it
// into each page's <head> (worker/shop-page.js), so the very first paint already has the shop's look; js/site.js
// builds the same text from the settings it loads and only touches the page when the two differ.
// Pure functions, no DOM: Node tests them (js/theme-vars.test.js), and the Worker imports them.

// Link/focus blues to try, best first, on a dark and on a light background; the first that reads at 4.5:1 is used.
export const LINKS_ON_DARK = ['#91bbdd', '#b9d5ec', '#ffffff'];
export const LINKS_ON_LIGHT = ['#0b4f8a', '#08396a', '#000000'];

export const isHex6 = (v) => /^#[0-9a-f]{6}$/i.test(v ?? '');

/** Relative luminance (WCAG formula) of a #rrggbb color. */
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True for light colors. */
export const isLight = (hex) => luminance(hex) > 0.4;

/** WCAG contrast ratio between two #rrggbb colors. */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The first of `choices` that reads at 4.5:1 on `bg`, else the last one. */
export const readableOn = (bg, choices) => choices.find((c) => contrast(c, bg) >= 4.5) ?? choices.at(-1);

/** The link color the site uses on this page background: the shop's own pick, else the first readable blue. */
export const linkColor = (colors = {}) =>
  isHex6(colors.link) ? colors.link : isHex6(colors.paper) ? readableOn(colors.paper, isLight(colors.paper) ? LINKS_ON_LIGHT : LINKS_ON_DARK) : null;

/**
 * CSS properties for the shop's colors, as [property, value] pairs; anything left out keeps the stylesheet's own.
 * Text on the main color, links and the footer's text follow their backgrounds so any color stays readable.
 */
export function colorVars(colors) {
  colors ??= {};
  const out = [];
  for (const [key, value] of Object.entries(colors)) {
    if (/^[a-z]+$/.test(key) && /^#[0-9a-f]{3,8}$/i.test(value)) out.push([`--brand-${key}`, value]);
  }
  if (isHex6(colors.primary)) out.push(['--on-primary', isLight(colors.primary) ? '#161616' : '#ffffff']);
  const paper = isHex6(colors.paper) ? colors.paper : null;
  const lightPage = !!paper && isLight(paper);
  // Links and focus rings follow the page background (the stylesheet's blue is for the default dark page), as do
  // the browser's own form controls and scrollbars, and the few fixed light colors meant for a dark page.
  if (lightPage) out.push(['color-scheme', 'light']);
  const link = linkColor(colors);
  if (link) {
    out.push(['--teal', link]);
    out.push(['--teal-hover', `color-mix(in srgb, ${link} 80%, ${lightPage ? 'black' : 'white'})`]);
    out.push(['--teal-dark', `color-mix(in srgb, ${paper ?? 'var(--brand-paper)'}, ${link} 14%)`]); // notice background
  }
  if (lightPage) {
    out.push(['--cream', 'var(--ink)']);
    out.push(['--error', readableOn(paper, ['#b3261e', '#7f1b15'])]);
    out.push(['--ok', readableOn(paper, ['#1e6b3a', '#124424'])]);
  }
  const footer = isHex6(colors.footer) ? colors.footer : null;
  if (footer) {
    const lightFooter = isLight(footer);
    const footerLink = readableOn(footer, lightFooter ? LINKS_ON_LIGHT : LINKS_ON_DARK);
    if (lightFooter) out.push(['--footer-text', '#161616'], ['--footer-heading', '#161616']);
    out.push(['--footer-link', footerLink]);
    out.push(['--footer-link-hover', `color-mix(in srgb, ${footerLink} 80%, ${lightFooter ? 'black' : 'white'})`]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * The fonts that come with the site, all in fonts/ (Latin subset, SIL Open Font License). `weight` is what the
 * file holds; a single-weight face is declared for every weight so the browser never fakes a bold. `display` is
 * how the font sets the big headlines: its weight and letter spacing. `slots` are the places it suits.
 */
export const FONT_LIBRARY = [
  { id: 'archivo-black', name: 'Archivo Black', group: 'Display', file: 'archivo-black-latin.woff2', weight: null, fallback: "'Arial Black', sans-serif", display: [400, '-.045em'], slots: ['display', 'heading'] },
  { id: 'bangers', name: 'Bangers', group: 'Display', file: 'bangers-latin.woff2', weight: null, fallback: 'Impact, sans-serif', display: [400, '.03em'], slots: ['display', 'heading'] },
  { id: 'bebas-neue', name: 'Bebas Neue', group: 'Display', file: 'bebas-neue-latin.woff2', weight: null, fallback: "Impact, 'Arial Narrow', sans-serif", display: [400, '.01em'], slots: ['display', 'heading'] },
  { id: 'anton', name: 'Anton', group: 'Display', file: 'anton-latin.woff2', weight: null, fallback: "Impact, 'Arial Narrow', sans-serif", display: [400, '0em'], slots: ['display', 'heading'] },
  { id: 'alfa-slab-one', name: 'Alfa Slab One', group: 'Display', file: 'alfa-slab-one-latin.woff2', weight: null, fallback: 'Rockwell, Georgia, serif', display: [400, '-.01em'], slots: ['display', 'heading'] },
  { id: 'oswald', name: 'Oswald', group: 'Sans serif', file: 'oswald-latin.woff2', weight: '400 700', fallback: "'Arial Narrow', sans-serif", display: [700, '0em'], slots: ['display', 'heading', 'body'] },
  { id: 'archivo', name: 'Archivo', group: 'Sans serif', file: 'archivo-latin.woff2', weight: '600 800', fallback: 'Arial, sans-serif', display: [800, '-.03em'], slots: ['display', 'heading'] },
  { id: 'source-sans-3', name: 'Source Sans 3', group: 'Sans serif', file: 'source-sans-3-latin.woff2', weight: '400 700', fallback: 'system-ui, sans-serif', display: [700, '-.02em'], slots: ['display', 'heading', 'body'] },
  { id: 'inter', name: 'Inter', group: 'Sans serif', file: 'inter-latin.woff2', weight: '400 800', fallback: 'system-ui, sans-serif', display: [800, '-.04em'], slots: ['display', 'heading', 'body'] },
  { id: 'work-sans', name: 'Work Sans', group: 'Sans serif', file: 'work-sans-latin.woff2', weight: '400 800', fallback: 'system-ui, sans-serif', display: [800, '-.03em'], slots: ['display', 'heading', 'body'] },
  { id: 'rubik', name: 'Rubik', group: 'Sans serif', file: 'rubik-latin.woff2', weight: '400 800', fallback: 'system-ui, sans-serif', display: [800, '-.02em'], slots: ['display', 'heading', 'body'] },
  { id: 'lora', name: 'Lora', group: 'Serif', file: 'lora-latin.woff2', weight: '400 700', fallback: 'Georgia, serif', display: [700, '-.02em'], slots: ['display', 'heading', 'body'] },
  { id: 'roboto-slab', name: 'Roboto Slab', group: 'Serif', file: 'roboto-slab-latin.woff2', weight: '400 800', fallback: 'Rockwell, Georgia, serif', display: [800, '-.02em'], slots: ['display', 'heading', 'body'] },
];

/**
 * The three places a font is used: their CSS variables (font, letter spacing, size), the font css/site.css uses by
 * default, and its preload. `spacing` is how far Tight and Wide move the font's own letter spacing, in em, and
 * `sizes` what Small and Large multiply the site's sizes by: both gentler for body text, which has to stay easy to read.
 */
export const FONT_SLOTS = [
  { slot: 'display', label: 'Headlines', hint: 'Page titles and the shop name', variable: '--font-display', tracking: '--display-tracking', scale: '--display-scale', default: 'archivo-black', preload: 'fonts/archivo-black-latin.woff2', spacing: { tight: -0.03, wide: 0.05 }, sizes: { small: 0.85, large: 1.2 } },
  { slot: 'heading', label: 'Sub-headings', hint: 'Section headings, card titles, footer headings', variable: '--font-heading', tracking: '--heading-tracking', scale: '--heading-scale', default: 'archivo', preload: null, spacing: { tight: -0.02, wide: 0.04 }, sizes: { small: 0.9, large: 1.15 } },
  { slot: 'body', label: 'Body text', hint: 'Paragraphs, menus, buttons and forms', variable: '--font-body', tracking: '--body-tracking', scale: '--body-scale', default: 'source-sans-3', preload: 'fonts/source-sans-3-latin.woff2', spacing: { tight: -0.01, wide: 0.03 }, sizes: { small: 0.92, large: 1.1 } },
];

/** Letter spacing choices, relative to each font's own. */
export const SPACING = [['tight', 'Tight'], ['normal', 'Normal'], ['wide', 'Wide']];
/** Size choices, relative to the sizes the site is designed with. */
export const SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];

/** What a slot's sizes are multiplied by: 1 for Medium (or anything unknown). */
export function sizeScale(slot, size) {
  const s = FONT_SLOTS.find((x) => x.slot === slot);
  return Object.hasOwn(s.sizes, size ?? '') ? s.sizes[size] : 1;
}

/**
 * A slot's letter spacing in em: the font's own (a headline font's preset, else 0), moved by Tight or Wide.
 * `display` is the [weight, tracking] pair of the headline font in use.
 */
export function letterSpacing(slot, spacing, display) {
  const s = FONT_SLOTS.find((x) => x.slot === slot);
  const base = slot === 'display' ? parseFloat(display?.[1] ?? FONT_LIBRARY.find((f) => f.id === s.default).display[1]) : 0;
  return base + (Object.hasOwn(s.spacing, spacing) ? s.spacing[spacing] : 0);
}
const em = (n) => `${Number(n.toFixed(3))}em`;

const UPLOAD_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.woff2?$/;
/** Where staff-uploaded fonts live in the shop's own storage (Admin → Shop Settings uploads them there). */
export const fontUploadBase = (storageOrigin) => `${String(storageOrigin ?? '').replace(/\/+$/, '')}/storage/v1/object/public/media/fonts/`;

/** A safe uploaded-font address: a .woff2/.woff in the shop's own storage, fonts/ folder, plain file name. */
export function isFontUpload(url, storageOrigin) {
  if (!storageOrigin || typeof url !== 'string' || !/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(String(storageOrigin).replace(/\/+$/, ''))) return false;
  const base = fontUploadBase(storageOrigin);
  return url.startsWith(base) && UPLOAD_FILE.test(url.slice(base.length));
}

/**
 * What each slot actually uses, checked: [{ slot, family, src, weight, fallback, display }] for the slots that
 * differ from the stylesheet. Unknown fonts, other hosts and odd file names are dropped (the slot keeps its default).
 */
export function resolveFonts(fonts, { storageOrigin } = {}) {
  const out = [];
  for (const s of FONT_SLOTS) {
    const pick = fonts?.[s.slot];
    if (!pick || typeof pick !== 'object') continue;
    const lib = FONT_LIBRARY.find((f) => f.id === pick.font && f.slots.includes(s.slot));
    const family = `Shop ${s.slot[0].toUpperCase()}${s.slot.slice(1)}`;
    if (lib && lib.id !== s.default) {
      out.push({ slot: s.slot, family, src: `fonts/${lib.file}`, weight: lib.weight ?? '100 900', fallback: lib.fallback, display: lib.display });
    } else if (!lib && isFontUpload(pick.upload, storageOrigin)) {
      // An uploaded file may hold one weight or many; declared for every weight, it is never faked bold.
      const dflt = FONT_LIBRARY.find((f) => f.id === s.default);
      out.push({ slot: s.slot, family, src: pick.upload, weight: '100 900', fallback: dflt.fallback, display: [700, '0em'] });
    }
  }
  return out;
}

/** The font files the page should start downloading at once (they're used above the fold). */
export const fontPreloads = (fonts, opts) => [...new Set(resolveFonts(fonts, opts).map((f) => f.src))];

/** The pages' built-in font preloads that a shop's choice makes unneeded (the Worker drops those tags). */
export function unusedDefaultPreloads(fonts, opts) {
  const used = resolveFonts(fonts, opts);
  return FONT_SLOTS.filter((s) => s.preload && used.some((f) => f.slot === s.slot) && !used.some((f) => f.src === s.preload)).map((s) => s.preload);
}

/** The CSS for the shop's colors and fonts ('' when everything is the stylesheet's default). */
export function themeCss({ colors, fonts } = {}, opts = {}) {
  const used = resolveFonts(fonts, opts);
  const faces = used.map((f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${f.src}) format('${f.src.endsWith('.woff') ? 'woff' : 'woff2'}')}`);
  const vars = colorVars(colors);
  for (const s of FONT_SLOTS) {
    const f = used.find((u) => u.slot === s.slot);
    const spacing = fonts?.[s.slot]?.spacing;
    if (f) vars.push([s.variable, `'${f.family}', ${f.fallback}`]);
    if (f && s.slot === 'display') vars.push(['--display-weight', String(f.display[0])]);
    // A new headline font brings its own spacing; any slot's Tight or Wide moves it.
    if ((f && s.slot === 'display') || Object.hasOwn(s.spacing, spacing ?? '')) vars.push([s.tracking, em(letterSpacing(s.slot, spacing, f?.display))]);
    const scale = sizeScale(s.slot, fonts?.[s.slot]?.size);
    if (scale !== 1) vars.push([s.scale, String(scale)]);
  }
  if (fonts?.display?.caps === false) vars.push(['--display-case', 'none']);
  const root = vars.length ? `:root{${vars.map(([p, v]) => `${p}:${v}`).join(';')}}` : '';
  return [...faces, root].filter(Boolean).join('\n');
}

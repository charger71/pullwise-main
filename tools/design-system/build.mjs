// Builds the storefront and admin layers of the Pullwise design system into ../ds/project.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { read, varsOf, scope } from './css.mjs';
import { adminTokens, shopTokens } from './tokens.mjs';
import { SOCIAL_ICONS } from '../../js/social-icons.js';
import { REPO, FROM as ORIG, OUT, REF, TODAY } from './config.mjs';

const write = (p, s) => { mkdirSync(dirname(OUT + p), { recursive: true }); writeFileSync(OUT + p, s); };

// ---------------------------------------------------------------------------------------------------------------------
// tokens.json: the existing marketing tokens stay first and unchanged; storefront then admin follow.
// ---------------------------------------------------------------------------------------------------------------------
const tokens = JSON.parse(readFileSync(ORIG + 'tokens.json', 'utf8'));
const A = adminTokens();
const S = shopTokens();

tokens.meta = {
  ...tokens.meta,
  'pullwise-main': {
    source: 'github', repo: 'charger71/pullwise-main', ref: REF, synced: TODAY,
    paths: { storefront: ['css/site.css', 'js/theme-vars.js'], admin: ['admin/base.css', 'admin/admin.css', 'admin/style-guide.html'], fonts: ['fonts/'], icons: ['admin/tab-icons.js', 'admin/lib.js', 'js/social-icons.js'] },
    prefixes: { 'shop-': 'storefront (css/site.css)', 'admin-': 'staff admin (admin/base.css, admin/admin.css)' },
  },
};
tokens.color.themes = [{ id: 'dark', name: 'Dark' }, { id: 'light', name: 'Light' }];
tokens.color.tokens = [...tokens.color.tokens.filter((t) => !/^(shop|admin)-/.test(t.name)), ...S.color, ...A.color];

const FONTS = [
  ['Archivo Black', 'archivo-black-latin.woff2', '400'],
  ['Source Sans 3', 'source-sans-3-latin.woff2', '400 700'],
  ['Bangers', 'bangers-latin.woff2', '400'],
  ['Bebas Neue', 'bebas-neue-latin.woff2', '400'],
  ['Anton', 'anton-latin.woff2', '400'],
  ['Alfa Slab One', 'alfa-slab-one-latin.woff2', '400'],
  ['Oswald', 'oswald-latin.woff2', '400 700'],
  ['Work Sans', 'work-sans-latin.woff2', '400 800'],
  ['Rubik', 'rubik-latin.woff2', '400 800'],
  ['Lora', 'lora-latin.woff2', '400 700'],
  ['Roboto Slab', 'roboto-slab-latin.woff2', '400 800'],
];
const keepFonts = tokens.type.fonts.filter((f) => !FONTS.some(([fam]) => fam === f.family));
tokens.type.fonts = [...keepFonts, ...FONTS.map(([family, file, weight]) => ({ family, file: `fonts/${file}`, weight }))];
for (const [, file] of FONTS) { mkdirSync(OUT + 'fonts', { recursive: true }); copyFileSync(`${REPO}fonts/${file}`, `${OUT}fonts/${file}`); }
Object.assign(tokens.type.families, S.families, A.families);

const st = (name, fontSize, lineHeight, fontWeight, extra = {}) => ({ name, fontSize, lineHeight, fontWeight, ...extra });
tokens.type.groups = [
  ...tokens.type.groups.filter((g) => !/^(Storefront|Admin)/.test(g.name)),
  { name: 'Storefront · Display', family: 'shop-display', styles: [
    st('shop-type-h1', '64px', 0.96, 400, { letterSpacing: '-0.045em', sample: 'NEW THIS WEDNESDAY', usage: 'Page titles (h1) and the hero headline: clamp(34px, 5vw, 64px) × the display scale, upper case, shop-ink (a highlighted span in shop-gold). Shop Settings can swap the font, size, spacing and turn capitals off.' }),
    st('shop-type-shop-name', '24px', 1.1, 400, { letterSpacing: '-0.045em', sample: 'Your Comic Shop', usage: 'The shop name in the header when there is no logo, in shop-cream.' }),
    st('shop-type-date', '25.6px', 1.15, 400, { sample: '29', usage: 'The day in an event date block (1.6rem) and the big line of a confirmation (in shop-gold).' }),
  ] },
  { name: 'Storefront · Headings', family: 'shop-heading', styles: [
    st('shop-type-h2', '24px', 1.2, 700, { sample: 'New this week', usage: 'Section headings (h2), 1.5rem × the heading scale.' }),
    st('shop-type-title', '20px', 1.15, 700, { sample: 'November 2026', usage: 'Panel, month, post and dialog titles (fs-title, 1.25rem).' }),
    st('shop-type-h3', '17.6px', 1.15, 700, { sample: 'Ready for pickup', usage: 'Sub-headings (h3, 1.1rem): account groups, follow groups, list dialog sections.' }),
    st('shop-type-card-title', '16px', 1.25, 700, { sample: 'Absolute Batman #12', usage: 'The title on a catalog card; 14.4px in the six-across desktop grid.' }),
    st('shop-type-footer-heading', '12.8px', 1.15, 700, { letterSpacing: '0.14em', sample: 'VISIT US', usage: 'Footer column headings, upper case, in shop-footer-heading.' }),
  ] },
  { name: 'Storefront · Text', family: 'shop-body', styles: [
    st('shop-type-body', '18px', 1.5, 400, { sample: 'Reserve this week’s books and pick them up at the counter.', usage: 'Running text (18px × the body scale) in shop-ink.' }),
    st('shop-type-lede', '17.6px', 1.5, 400, { sample: 'Pre-order anything in the catalog. We hold it for 30 days after it arrives.', usage: 'The intro under a page title (.lede), in muted, at most 84ch.' }),
    st('shop-type-label', '15.2px', 1.2, 600, { sample: 'Phone number', usage: 'Field labels, above the field.' }),
    st('shop-type-button', '14px', 1, 700, { letterSpacing: '0.04em', sample: 'RESERVE', usage: 'Button labels: always upper case.' }),
    st('shop-type-meta', '13.6px', 1.5, 400, { sample: 'DC Comics · Out Nov 4', usage: 'Meta lines on cards, field hints and dates (.85rem), in muted.' }),
    st('shop-type-badge', '11.2px', 1, 700, { letterSpacing: '0.06em', sample: 'JUST ARRIVED', usage: 'Status badges and collector chips (.7rem), upper case.' }),
  ] },
  { name: 'Admin · Display', family: 'admin-display', styles: [
    st('admin-type-h1', '48px', 1.15, 400, { letterSpacing: '0.01em', sample: 'Customers', usage: 'Page title (h1): clamp(1.9rem, 6vw, 3rem). The display face is for page titles and big numbers only.' }),
    st('admin-type-page', '28.8px', 1.15, 400, { letterSpacing: '0.01em', sample: 'Place Order', usage: 'The page title inside a section (fs-page, 1.8rem).' }),
    st('admin-type-stat', '35.2px', 1.1, 400, { sample: '12', usage: 'Dashboard tile numbers (fs-stat, 2.2rem).' }),
  ] },
  { name: 'Admin · Text', family: 'admin-body', styles: [
    st('admin-type-title', '20px', 1.15, 700, { sample: 'Email Jane Smith', usage: 'Dialog and panel titles (fs-title, 1.25rem).' }),
    st('admin-type-card', '18.4px', 1.15, 700, { sample: 'Cutoff Thu, Oct 29', usage: 'Card, panel and fold headings (fs-card, 1.15rem) in the bold body font, never the display face.' }),
    st('admin-type-body', '16px', 1.55, 400, { sample: 'Pickup preferences, anything worth remembering.', usage: 'Body text and field values (fs-base).' }),
    st('admin-type-label', '16px', 1.55, 700, { sample: 'Phone', usage: 'Field labels and tab labels (bold, above the field).' }),
    st('admin-type-ui', '14.4px', 1.5, 400, { sample: '42 orders', usage: 'Tables, small buttons, filters and admin hints (fs-ui, .9rem).' }),
    st('admin-type-hint', '13.6px', 1.5, 400, { sample: 'Hint under a field: small and muted.', usage: 'Field hints and meta lines (fs-sm, .85rem), in admin-muted.' }),
    st('admin-type-pill', '11.52px', 1.4, 700, { letterSpacing: '0.04em', sample: 'PICKED UP', usage: 'Pills, badges and counts (fs-2xs, .72rem), upper case.' }),
  ] },
];

const fam = (key, list) => { tokens[key] ??= { tokens: [] }; tokens[key].tokens = [...tokens[key].tokens.filter((t) => !/^(shop|admin)-/.test(t.name)), ...list]; };
fam('spacing', [...S.spacing, ...A.spacing]);
fam('radius', [...S.radius, ...A.radius]);
fam('shadow', [...S.shadow, ...A.shadow]);
tokens.size = { note: 'Fixed sizes: touch targets, field heights, the sticky header and list bar, page width.', tokens: [...S.size, ...A.size] };
tokens.fontSize = { note: 'Text-size steps: the storefront\'s fixed sizes (the headline, sub-heading and body sizes follow Shop Settings and are type styles) and the admin\'s. The tests reject bare px or rem sizes in both.', tokens: [...S.fontSize, ...A.fontSize] };
tokens.zIndex = { note: 'The admin\'s stacking order. Never a bare z-index.', tokens: A.zIndex };
write('tokens.json', JSON.stringify(tokens, null, 2) + '\n');

// ---------------------------------------------------------------------------------------------------------------------
// bundle.css: the repo's own stylesheets, each under one wrapper, reading their values from the tokens.
// ---------------------------------------------------------------------------------------------------------------------
const tokenNames = new Set([...tokens.color.tokens, ...tokens.spacing.tokens, ...tokens.radius.tokens, ...tokens.shadow.tokens, ...tokens.size.tokens, ...tokens.fontSize.tokens, ...tokens.zIndex.tokens].map((t) => t.name));
const mapping = (vars, prefix) => vars.map(([n, v]) => {
  if (tokenNames.has(`${prefix}-${n}`)) return `--${n}: var(--${prefix}-${n});`;
  if (/^font-/.test(n)) return `--${n}: var(--font-${prefix}-${n.slice(5)});`;
  return `--${n}: ${v};`;
});
const skip = (s) => s === ':root' || /^:root\[data-theme=['"]dark['"]\]$/.test(s) || s.startsWith('body:has');
const wrapperDrop = ['display', 'flex-direction', 'min-height', 'margin'];
const site = read(`${REPO}css/site.css`);
const base = read(`${REPO}admin/base.css`);
const adminCss = read(`${REPO}admin/admin.css`);

const shopMap = mapping(varsOf(site, ':root {'), 'shop');
const adminMap = mapping([...varsOf(base, ':root {'), ...varsOf(adminCss, ':root {')], 'admin');

const orig = readFileSync(ORIG + 'components/bundle.css', 'utf8').replace(/\n*\/\* =====[\s\S]*$/, '');
const bundle = `${orig.trimEnd()}

/* ===== Storefront: css/site.css (charger71/pullwise-main, ${REF}), scoped to .pw-shop =====
   Wrap storefront markup in <div class="pw-shop">. The wrapper gives the site's own variable names their values from
   the shop-* tokens; the neutrals are mixed from shop-brand-paper and shop-brand-ink exactly as the site does, so a
   change to either token re-tints every surface. Class names and rules below are the site's, unchanged. */
body:has(> .pw-shop) { background: var(--shop-brand-paper); }
.pw-shop {
  color-scheme: dark;
  ${shopMap.join('\n  ')}
}
${scope(site, '.pw-shop', { skip, wrapperDrop })}

/* ===== Staff admin: admin/base.css + admin/admin.css (charger71/pullwise-main, ${REF}), scoped to .pw-admin =====
   Wrap admin markup in <div class="pw-admin">. Light and dark come from the admin-* tokens' two themes. */
body:has(> .pw-admin) { background: var(--admin-paper); }
.pw-admin {
  ${adminMap.join('\n  ')}
}
[data-theme="dark"] .pw-admin { color-scheme: dark; }
${scope(base, '.pw-admin', { skip, wrapperDrop })}
${scope(adminCss, '.pw-admin', { skip, wrapperDrop })}

/* ===== Preview helpers (design-system pages only, not part of either app) ===== */
.pw-shop.pw-pad, .pw-admin.pw-pad { padding: 20px; }
.pw-shop .pw-row, .pw-admin .pw-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.pw-shop .pw-col, .pw-admin .pw-col { display: grid; gap: 12px; }
.pw-admin .pw-dialog { width: min(520px, 100%); border-radius: 10px; box-shadow: var(--shadow-lg); background: var(--surface); }
`;
write('components/bundle.css', bundle);

// ---------------------------------------------------------------------------------------------------------------------
// Icons as files: the admin's line tab icons and solid action icons, and the storefront's social icons.
// ---------------------------------------------------------------------------------------------------------------------
const tabSrc = read(`${REPO}admin/tab-icons.js`);
const TAB = Object.fromEntries([...tabSrc.matchAll(/^  (\w+): '([^']+)',$/gm)].map((m) => [m[1], m[2]]));
const libSrc = read(`${REPO}admin/lib.js`);
const SOLID = Object.fromEntries([...libSrc.slice(libSrc.indexOf('const SOLID_ICONS')).split('};')[0].matchAll(/^  (\w+): '([^']+)',$/gm)].map((m) => [m[1], m[2]]));
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
export const icons = { 'Admin tab icons': [], 'Admin action icons': [], 'Social icons': [] };
for (const [k, body] of Object.entries(TAB)) {
  const f = `${kebab(k)}.svg`;
  write(`assets/Admin tab icons/${f}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`);
  icons['Admin tab icons'].push(f);
}
for (const [k, d] of Object.entries(SOLID)) {
  const f = `${kebab(k)}.svg`;
  write(`assets/Admin action icons/${f}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>\n`);
  icons['Admin action icons'].push(f);
}
for (const [k, { path }] of Object.entries(SOCIAL_ICONS)) {
  const f = `${k}.svg`;
  write(`assets/Social icons/${f}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="${path}"/></svg>\n`);
  icons['Social icons'].push(f);
}

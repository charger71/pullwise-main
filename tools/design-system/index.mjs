// npm run design-system -- --from <folder> [--out <folder>]
// Rebuilds the storefront (shop-*) and staff admin (admin-*) layers of the Pullwise design system from this repo and
// writes an updated copy of the whole system to --out, then lists the files to publish. See README.md.
import { cpSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FROM as ORIG, OUT, REF, REPO } from './config.mjs';

// Start from the system as it is now, so the marketing layer and anything changed on the page are kept.
cpSync(ORIG, OUT, { recursive: true });

const { warnings } = await import('./tokens.mjs');
const { icons } = await import('./build.mjs'); // tokens.json, bundle.css, fonts, icon files
const { SHOP } = await import('./shop-components.mjs');
const { ADMIN } = await import('./admin-components.mjs');
const { THREE_SURFACES, STOREFRONT, ADMIN_MD } = await import('./docs.mjs');

const write = (p, s) => { mkdirSync((OUT + p).replace(/\/[^/]*$/, ''), { recursive: true }); writeFileSync(OUT + p, s); };

for (const c of [...SHOP, ...ADMIN]) {
  write(`components/${c.name}/README.md`, c.readme.trim() + '\n');
  if (c.html) {
    const attrs = [`group="${c.group}"`, `height=${c.height}`, c.width ? `width=${c.width}` : ''].filter(Boolean).join(' ');
    write(`components/${c.name}/preview.html`, `<!-- @dsCard ${attrs} -->\n${c.html}`);
  }
}

// Marketing components keep their files; only their group gains the surface name so the three sets sort apart.
const MARKETING = ['Button', 'Callout', 'CaptionBox', 'Checklist', 'ClosingBand', 'Eyebrow', 'FAQ', 'Header', 'Panel', 'PricingPlan', 'StepBadge'];
for (const n of MARKETING) {
  const p = `components/${n}/preview.html`;
  if (!existsSync(ORIG + p)) continue;
  const s = readFileSync(ORIG + p, 'utf8');
  write(p, s.replace(/^<!-- @dsCard group="(?!Marketing · )([^"]+)"/, (_, g) => `<!-- @dsCard group="Marketing · ${g}"`));
}

// README: the three-surface overview before "## Brand idea" (replaced in place on later runs), and two lines scoped
// to the marketing site.
let readme = readFileSync(ORIG + 'README.md', 'utf8');
const start = readme.indexOf('## Three surfaces, one system');
const cut = readme.indexOf('## Brand idea');
readme = start >= 0 ? readme.slice(0, start) + THREE_SURFACES + '\n' + readme.slice(cut) : readme.slice(0, cut) + THREE_SURFACES + '\n' + readme.slice(cut);
const swap = (a, b) => {
  if (readme.includes(b)) return;
  if (!readme.includes(a)) return warnings.push(`README: expected text not found, left as is: "${a.slice(0, 60)}…"`);
  readme = readme.replace(a, b);
};
swap('Dark is the only scheme. A cyan-tinted black ground', 'The marketing site is dark only (its tokens keep their values in the Light theme, which exists for the admin): a cyan-tinted black ground');
swap('Use the Pullwise icon set (the **Icons** asset group; `assets/icons/` and `sprite.svg` in the site repo). Never mix in another set.',
  'On the marketing site, use the Pullwise icon set (the **Icons** asset group; `assets/icons/` and `sprite.svg` in the site repo) and never mix in another set. The storefront and the admin have their own sets (**Social icons**, **Admin tab icons**, **Admin action icons**); each surface uses only its own.');
write('README.md', readme);
write('storefront.md', STOREFRONT);
write('admin.md', ADMIN_MD);

write('assets/Admin tab icons/README.md', `# Admin tab icons

${icons['Admin tab icons'].length} line icons from admin/tab-icons.js: 24px grid, 2px stroke, round caps and joins, no fills. One goes in front of every admin tab label, matched to the label (or named with \`data-icon\`); on phones the icon stands alone.

The files stroke in \`currentColor\`, which renders black inside an \`<img>\`; inline the SVG and let it take the tab's text color (\`admin-muted\`, or white on the selected tab).
`);
write('assets/Admin action icons/README.md', `# Admin action icons

${icons['Admin action icons'].length} solid icons from \`SOLID_ICONS\` in admin/lib.js, cut with even-odd fill. Use them through \`solidIcon(name, size)\`: 22px in an icon-only \`.icon-btn\` inside table rows, 16–18px before a word in buttons, 14px in role pills, 20px as status icons.

The files fill in \`currentColor\`, which renders black inside an \`<img>\`; inline them so they take the button's color (\`admin-success\` for Add, \`admin-danger-ink\` for Remove, \`admin-alert-icon\` / \`admin-minor-icon\` for status).
`);
// The networks and the Simple Icons version, as js/social-icons.js lists them.
const socialSrc = readFileSync(join(REPO, 'js/social-icons.js'), 'utf8');
const networks = [...socialSrc.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]).join(', ');
const simpleIcons = socialSrc.match(/simpleicons\.org, (v[\d.]+)/)?.[1];
write('assets/Social icons/README.md', `# Social icons

${icons['Social icons'].length} network marks for the storefront footer and Visit page, from js/social-icons.js (Simple Icons${simpleIcons ? ' ' + simpleIcons : ''}, CC0): ${networks}.

Single color in \`currentColor\` (black inside an \`<img>\`): inline at 20px in a 44px tap area and let it take the footer's text color, \`shop-footer-link-hover\` on hover. Never recolor them in the networks' own brand colors, and always give the link an \`aria-label\` with the network's name.
`);

// ---- Report: what changed, and what needs a person -----------------------------------------------------------------
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const index = JSON.parse(readFileSync(ORIG + 'design-system.json', 'utf8'));
const changed = [];
const newIcons = [];
for (const f of files(OUT)) {
  const rel = relative(OUT, f);
  if (rel === 'design-system.json') continue;
  const [, group, name] = rel.match(/^assets\/([^/]+)\/(.+\.svg)$/) ?? [];
  if (group) {
    if (!index.assetGroups?.[group]?.files?.[name]) newIcons.push(`project/${rel}`);
    continue; // icons are uploads, recorded in the index, never published as files
  }
  const before = join(ORIG, rel);
  if (!existsSync(before) || !readFileSync(before).equals(readFileSync(f))) changed.push(`project/${rel}`);
}
console.log(`Built from ${REF} into ${OUT}`);
console.log(`\n${changed.length} file(s) to publish:\n${changed.map((f) => `  ${f}`).join('\n') || '  (none)'}`);
if (newIcons.length) console.log(`\n${newIcons.length} new icon(s) to upload and record in design-system.json:\n${newIcons.map((f) => `  ${f}`).join('\n')}`);
if (warnings.length) console.log(`\nCheck by hand:\n${warnings.map((w) => `  ${w}`).join('\n')}`);
console.log('\nThen set lastChange in design-system.json and publish it last (README.md, "Publishing").');

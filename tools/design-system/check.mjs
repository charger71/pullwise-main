// npm run design-system:check [-- --out <folder>] [-- --only <RegExp>]
// Renders every storefront and admin preview in the built copy, dark and light, as the design system page would:
// reports horizontal overflow and each card's real height, and saves screenshots to <out>/check/. Needs Playwright
// (not a dependency of this repo: install it globally or run where it is available).
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const OUTDIR = resolve(arg('out') ?? new URL('./out', import.meta.url).pathname);
const P = `${OUTDIR}/project/`;
const CHECK = `${OUTDIR}/check/`;
mkdirSync(CHECK, { recursive: true });
let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  try { ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? 'playwright')); } catch {
    console.error('Playwright is not installed. Install it (npm i -g playwright) or set PLAYWRIGHT_PATH.'); process.exit(1);
  }
}
const t = JSON.parse(readFileSync(P + 'tokens.json', 'utf8'));
const val = (v, th) => { const x = typeof v === 'string' ? v : (v[th] ?? v[t.color.themes[0].id]); return x.replace(/^\{(.+)\}$/, 'var(--$1)'); };
let css = '';
for (const th of ['dark', 'light']) {
  css += `${th === 'dark' ? ':root, ' : ''}[data-theme="${th}"] {` + [...t.color.tokens, ...t.shadow.tokens].map((k) => `--${k.name}:${val(k.value, th)};`).join('') + '}\n';
}
css += ':root{' + ['spacing', 'radius', 'size', 'fontSize', 'zIndex', 'border'].flatMap((f) => t[f]?.tokens ?? []).map((k) => `--${k.name}:${k.value};`).join('') + Object.entries(t.type.families).map(([k, v]) => `--font-${k}:${v};`).join('') + '}\n';
css += t.type.fonts.map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url("file://${P}${f.file}")}`).join('\n');
const bundle = readFileSync(P + 'components/bundle.css', 'utf8');
const only = arg('only') ? new RegExp(arg('only')) : /^(Shop|Admin)/;
const comps = readdirSync(P + 'components').filter((c) => only.test(c) && existsSync(`${P}components/${c}/preview.html`));
const browser = await chromium.launch();
const report = [];
for (const theme of ['dark', 'light']) for (const c of comps) {
  const src = readFileSync(`${P}components/${c}/preview.html`, 'utf8');
  const w = Number(/width=(\d+)/.exec(src.split('\n')[0])?.[1] ?? 720);
  const page = await browser.newPage({ viewport: { width: w, height: 40 } });
  const html = src.replace('<head>', `<head><style>${css}\n${bundle}</style>`).replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`);
  const f = `${CHECK}${theme}-${c}.html`; writeFileSync(f, html); await page.goto('file://' + f, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));
  if (info.sw > info.cw + 1) report.push(`${theme} ${c}: overflow ${info.sw} > ${info.cw}`);
  report.push(`${theme} ${c}: height ${info.h} (card ${/height=(\d+)/.exec(src)[1]})`);
  await page.screenshot({ path: `${CHECK}${theme}-${c}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(report.join('\n'));

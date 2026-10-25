// Screenshot check for the staff admin: renders every screen and tab from two copies of the code (the change, and
// the branch it goes into) against the same made-up data, and reports every view that looks different.
//
//   node tools/visual/capture.mjs --base <dir> [--head <dir>] [--out <dir>] [--only titles,faq] [--accept]
//
// --base is a checkout of the branch to compare with (CI: a git worktree of the PR's base); --head defaults to
// this checkout. Each view is shot at phone, tablet and desktop width (light), and phone and desktop (dark), with its
// folds closed and then all open. Exits 1 when anything changed, unless --accept (a PR labelled visual-change).
// The report and a before / after / difference picture of each changed view go to --out (default tools/visual/out).
//
// Needs Playwright with Chromium: npm i --no-save playwright && npx playwright install chromium. Set PLAYWRIGHT to
// the module's path to use one installed elsewhere.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s+--/).filter(Boolean).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split(/\s+/);
  return [k, v.join(' ') || true];
}));
if (!args.base) {
  console.error('usage: node tools/visual/capture.mjs --base <dir> [--head <dir>] [--out <dir>] [--only a,b] [--accept]');
  process.exit(2);
}
const ROOTS = { head: resolve(args.head ?? join(HERE, '..', '..')), base: resolve(args.base) };
const OUT = resolve(args.out ?? join(HERE, 'out'));
const SCREENS = ['dashboard', 'reservations', 'customers', 'titles', 'series', 'import', 'emails', 'pages', 'news', 'events', 'media', 'faq', 'qr', 'surveys', 'settings', 'locations', 'staff', 'backup', 'restore']
  .filter((s) => !args.only || String(args.only).split(',').includes(s));
const VIEWS = [[390, 'light'], [768, 'light'], [1200, 'light'], [390, 'dark'], [1200, 'dark']];
const PARALLEL = 4;
const CLOCK = new Date('2026-10-25T14:00:00Z'); // every date on screen is relative to this
const MIN_PIXELS = 25; // fewer is anti-aliasing (a rotated chevron can differ by a few pixels); a real change, even a 1px border, is far more

// ---- The admin's two CDN libraries, fetched once and served locally ---------------------------------------------------
const VENDOR = { 'quill.js': 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js', 'quill.snow.css': 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css', 'qrcode.js': 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js' };
const CACHE = join(HERE, '.cache');
await mkdir(CACHE, { recursive: true });
for (const [f, url] of Object.entries(VENDOR)) {
  if (existsSync(join(CACHE, f))) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await writeFile(join(CACHE, f), Buffer.from(await res.arrayBuffer()));
}

// ---- A static server: /head and /base are the two copies, /visual this folder, /vendor the cached libraries -------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const [, top, ...rest] = path.split('/');
  const dir = { head: ROOTS.head, base: ROOTS.base, visual: HERE, vendor: CACHE }[top];
  const file = dir && resolve(dir, rest.join('/'));
  if (!file || !file.startsWith(dir)) return res.writeHead(404).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const browser = await chromium.launch();
// Each shot gets its own context: Playwright's fake clock belongs to the context, and shots run side by side.
const newContext = () => browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 1 }); // no transitions caught mid-way

// ---- Shoot one screen at one width / theme: every tab, folds closed then open ----------------------------------------
async function shoot(root, screen, width, theme) {
  const context = await newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.clock.install({ time: CLOCK });
  const shots = {};
  try {
    await page.goto(`${ORIGIN}/visual/harness.html?root=${root}&s=${screen}`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 15000 });
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    const tabs = () => page.$$('#section .admin-tabs .admin-tab');
    const n = (await tabs()).length || 1;
    for (let i = 0; i < n; i++) {
      if (i > 0 || n > 1) {
        await (await tabs())[i]?.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(250);
      }
      await page.mouse.move(0, 0);
      const key = `${screen}-${i}-${width}-${theme}`;
      shots[`${key}-closed`] = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
      await page.evaluate(() => document.querySelectorAll('#section details').forEach((d) => ((d.dataset.wasOpen = d.open ? '1' : ''), (d.open = true))));
      await page.waitForTimeout(150);
      shots[`${key}-open`] = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
      await page.evaluate(() => document.querySelectorAll('#section details').forEach((d) => (d.open = d.dataset.wasOpen === '1'))); // as it was, for the next tab
    }
  } finally {
    await context.close();
  }
  return shots;
}

async function shootAll(root, jobs) {
  const all = {};
  const queue = [...jobs];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let job; (job = queue.shift()); ) Object.assign(all, await shoot(root, ...job));
  }));
  return all;
}

// ---- Compare pictures in the browser (no image library needed) --------------------------------------------------------
const cmp = await (await newContext()).newPage();
const pixelDiff = (a, b, picture = false) => cmp.evaluate(async ([a, b, picture]) => {
  const load = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  const px = (img) => { const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h); };
  const da = px(ia), db = px(ib);
  const mark = new ImageData(w, h);
  let n = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
    const grey = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 12 + 170;
    if (d > 24) { n++; mark.data.set([230, 0, 60, 255], i); } else mark.data.set([grey, grey, grey, 255], i); // ignore anti-aliasing noise
  }
  if (!picture) return { n, size: `${ia.width}×${ia.height} → ${ib.width}×${ib.height}` };
  const gap = 12, c = new OffscreenCanvas(w * 3 + gap * 2, h), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(ia, 0, 0); g.drawImage(ib, w + gap, 0); g.putImageData(mark, (w + gap) * 2, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const png = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
  return { n, png };
}, [a.toString('base64'), b.toString('base64'), picture]);

// ---- Run ----------------------------------------------------------------------------------------------------------------
const jobs = VIEWS.flatMap(([w, t]) => SCREENS.map((s) => [s, w, t]));
const started = Date.now();
const [base, head] = [await shootAll('base', jobs), await shootAll('head', jobs)];
const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
const changed = [];
const suspects = keys.filter((k) => base[k] && head[k] && !base[k].equals(head[k]));
// A view that differs is shot again on both sides; it counts only if it still differs (a slow page is not a change).
const retake = suspects.length ? { base: await shootAll('base', uniqJobs(suspects)), head: await shootAll('head', uniqJobs(suspects)) } : null;
for (const k of suspects) {
  const first = await pixelDiff(base[k], head[k]);
  if (first.n < MIN_PIXELS) continue;
  const again = retake.base[k] && retake.head[k] ? await pixelDiff(retake.base[k], retake.head[k]) : first;
  if (again.n >= MIN_PIXELS) changed.push({ k, n: again.n, size: again.size });
}
const added = keys.filter((k) => !base[k]);
const removed = keys.filter((k) => !head[k]);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const c of changed) {
  const { png } = await pixelDiff(retake.base[c.k] ?? base[c.k], retake.head[c.k] ?? head[c.k], true);
  await writeFile(join(OUT, `${c.k}.png`), Buffer.from(png, 'base64'));
}
await browser.close();
server.close();

const lines = [
  `## Admin screenshots: ${changed.length + added.length + removed.length ? `${changed.length} changed, ${added.length} new, ${removed.length} gone` : 'no visible change'}`,
  `${keys.length} views compared (${SCREENS.length} screens; 390 / 768 / 1200px light, 390 / 1200px dark; folds closed and open) in ${Math.round((Date.now() - started) / 1000)}s.`,
  ...(changed.length ? ['', '| View | Pixels changed | Size (before → after) |', '|---|---|---|', ...changed.map((c) => `| \`${c.k}\` | ${c.n} | ${c.size} |`)] : []),
  ...(added.length ? ['', `New views: ${added.map((k) => `\`${k}\``).join(', ')}`] : []),
  ...(removed.length ? ['', `Views no longer there: ${removed.map((k) => `\`${k}\``).join(', ')}`] : []),
  ...(changed.length ? ['', 'Each changed view is in the `admin-screenshots` artifact as before | after | difference (red).'] : []),
];
const report = lines.join('\n') + '\n';
await writeFile(join(OUT, 'report.md'), report);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report, { flag: 'a' });
console.log(report);
if (changed.length + added.length + removed.length && !args.accept) {
  console.log('If these changes are intended, add the visual-change label to the pull request.');
  process.exit(1);
}

function uniqJobs(viewKeys) {
  return [...new Set(viewKeys.map((k) => k.split('-').filter((_, i) => i !== 1).slice(0, 3).join('|')))].map((j) => {
    const [s, w, t] = j.split('|');
    return [s, Number(w), t];
  });
}

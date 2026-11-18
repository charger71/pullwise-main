#!/usr/bin/env node
// Makes the Help screen's screenshots and captioned walk-through videos by driving the real admin in a browser.
// The steps are in walkthroughs.mjs; everything lands in admin/help/media, and admin/help/media/captured.js lists it.
//
//   HELP_EMAIL=you@example.com HELP_PASSWORD=… npm run help:capture                # every walk-through
//   … npm run help:capture -- --only=dashboard,place-order                         # just these
//   … npm run help:capture -- --shots-only                                         # pictures, no videos
//   … npm run help:capture -- --url=http://localhost:8080                          # another shop (see below)
//
// First time on a computer: npm i --no-save playwright && npx playwright install chromium
// Video conversion needs ffmpeg (brew install ffmpeg); without it the videos are skipped and the shots still made.
//
// Read-only by design. It signs in as staff on the demo shop (a shop marked "canary" in shops.json; anything else needs
// --not-demo), and every request that could change data is stopped before it leaves the browser: only reads, the
// sign-in itself and the read-only database functions listed in READ_RPCS get through. Stopped requests are listed at
// the end, so a walk-through that needs one shows up as a gap instead of a change to the shop.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { WALKTHROUGHS as ALL, VIEWPORT } from './walkthroughs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MEDIA = join(ROOT, 'admin', 'help', 'media');

/** Database functions the admin calls only to read. Anything else (and every insert, update or delete) is stopped. */
export const READ_RPCS = new Set([
  'is_owner', 'staff_health', 'staff_list', 'staff_pickup_summary', 'staff_order_rows', 'staff_order_cutoffs', 'staff_past_cutoffs',
  'staff_line_summary', 'staff_item_week_counts', 'staff_over_cap_lines', 'staff_waiting_accounts', 'staff_waiting_guest_orders',
  'staff_list_series', 'staff_list_artists', 'staff_series_catalog_count', 'staff_artist_titles', 'staff_import_find_series',
  'series_follow_preview', 'unfollow_preview', 'search_series', 'search_artists', 'top_reserved_items', 'rank_by_pulls',
  'search_log_top', 'search_log_reservations', 'search_log_no_results', 'drifting_customers', 'media_usage', 'item_cover_artists',
  'event_spots_taken', 'catalog_publishers', 'catalog_foc_dates', 'my_account_notice', 'backup_meta',
  'analytics_stock_alert_titles', 'analytics_series_demand', 'analytics_publisher_demand', 'analytics_customer_growth',
]);

/** Email previews build the email and send nothing (weekly-pull-list's preview modes); test and send are stopped. */
const PREVIEW_MODES = new Set(['preview', 'arrivals_preview', 'pickup_preview']);

/** Does this request only read? (Pure, so it can be tested.) `body` is the request's text, for the email preview. */
export function allowed(method, url, body = '') {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  if (m !== 'POST') return false;
  const { pathname, searchParams } = new URL(url);
  if (pathname === '/auth/v1/token') return ['password', 'refresh_token'].includes(searchParams.get('grant_type'));
  const rpc = pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
  if (rpc) return READ_RPCS.has(rpc[1]);
  if (pathname === '/functions/v1/weekly-pull-list') {
    try {
      return PREVIEW_MODES.has(JSON.parse(body || '{}').mode);
    } catch {
      return false;
    }
  }
  return false;
}

/** Seconds as a WebVTT time: 75.5 → "00:01:15.500". */
export const vttTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
};

/** Captions as a .vtt file, each cue moved back by `offset` seconds (the trimmed start of the video). */
export const toVtt = (cues, offset = 0) =>
  `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${vttTime(c.start - offset)} --> ${vttTime(c.end - offset)}\n${c.text}\n`).join('\n')}`;

/** How long a caption stays up before the next step: long enough to read at a relaxed pace. */
export const readMs = (text) => Math.min(6000, Math.max(1800, String(text).split(/\s+/).length * 330));

/** The media files in the folder, as captured.js lists them. */
export function mediaList(dir = MEDIA) {
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const stems = (ext) => files.filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();
  return { shots: stems('.png'), videos: stems('.mp4').filter((v) => files.includes(`${v}.jpg`)) };
}

function writeCaptured(from) {
  const { shots, videos } = mediaList();
  const body = `// Written by tools/help-capture (npm run help:capture): the screenshots and videos in this folder, so the Help screen
// only shows media that exists. Don't edit by hand; run the capture again instead.
export const CAPTURED = ${JSON.stringify({ from, at: new Date().toISOString().slice(0, 10), shots, videos }, null, 2)};
`;
  writeFileSync(join(MEDIA, 'captured.js'), body);
  return { shots, videos };
}

function args(argv) {
  const out = { only: null, shotsOnly: false, notDemo: false, url: process.env.HELP_URL || 'https://demo.pullwise.shop', headed: false };
  for (const a of argv) {
    if (a.startsWith('--only=')) out.only = a.slice(7).split(',').filter(Boolean);
    else if (a === '--shots-only') out.shotsOnly = true;
    else if (a === '--not-demo') out.notDemo = true;
    else if (a === '--headed') out.headed = true;
    else if (a.startsWith('--url=')) out.url = a.slice(6);
    else if (a.startsWith('--steps=')) out.steps = new URL(a.slice(8), `file://${process.cwd()}/`).href; // other walk-throughs (tests)
    else throw new Error(`Unknown option ${a}`);
  }
  out.url = out.url.replace(/\/+$/, '');
  return out;
}

/** Is the address the demo shop (canary in shops.json) or this computer? */
function isDemo(url) {
  const host = new URL(url).hostname;
  if (['localhost', '127.0.0.1'].includes(host)) return true;
  const { shops } = JSON.parse(readFileSync(join(ROOT, 'shops.json'), 'utf8'));
  return shops.some((s) => s.canary && s.domains.includes(host));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ffmpeg from the PATH, or HELP_FFMPEG (e.g. the ffmpeg-static npm package's binary, for a Mac without Homebrew).
const FFMPEG = process.env.HELP_FFMPEG || 'ffmpeg';
const ffmpeg = (a) => spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' }).status === 0;

async function main() {
  const opt = args(process.argv.slice(2));
  const email = process.env.HELP_EMAIL;
  const password = process.env.HELP_PASSWORD;
  if (!email || !password) throw new Error('Set HELP_EMAIL and HELP_PASSWORD to a staff login on the demo shop (an owner sees every screen).');
  if (!isDemo(opt.url) && !opt.notDemo) throw new Error(`${opt.url} isn't the demo shop. Pictures from a real shop show real customers: use the demo shop, or add --not-demo if you're sure.`);

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright isn’t installed. Run: npm i --no-save playwright ffmpeg-static (both at once: --no-save removes packages it isn’t given), then npx playwright install chromium if you haven’t before.');
  }
  const canVideo = !opt.shotsOnly && spawnSync(FFMPEG, ['-version']).status === 0;
  if (!opt.shotsOnly && !canVideo) console.warn('ffmpeg not found: making screenshots only. For videos: brew install ffmpeg, or npm i --no-save playwright ffmpeg-static and run with HELP_FFMPEG="$(node -p "require(\'ffmpeg-static\')")".');

  const WALKTHROUGHS = opt.steps ? (await import(opt.steps)).WALKTHROUGHS : ALL;
  const list = WALKTHROUGHS.filter((w) => !opt.only || opt.only.includes(w.id));
  if (!list.length) throw new Error(`No walk-through called ${opt.only.join(', ')}. Known: ${WALKTHROUGHS.map((w) => w.id).join(', ')}`);
  mkdirSync(MEDIA, { recursive: true });
  const work = join(tmpdir(), `help-capture-${Date.now()}`);
  mkdirSync(work, { recursive: true });

  const browser = await chromium.launch({ headless: !opt.headed, executablePath: process.env.HELP_CHROME || undefined });
  const blocked = new Map(); // "POST /rest/v1/…" → walk-throughs
  const failed = [];

  // Sign in once and reuse the session, so the videos start on the admin, not the sign-in form.
  const login = await browser.newContext({ viewport: VIEWPORT });
  const lp = await login.newPage();
  await lp.goto(`${opt.url}/admin/`);
  await lp.fill('#login-email', email);
  await lp.fill('#login-password', password);
  await lp.click('#login-form button[type="submit"]');
  await lp.waitForSelector('#app:not([hidden])', { timeout: 20000 }).catch(async () => {
    throw new Error(`Couldn’t sign in: ${(await lp.textContent('#login-error').catch(() => '')) || 'no answer'}`);
  });
  const storageState = await login.storageState();
  await login.close();

  for (const w of list) {
    const record = canVideo && w.video;
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      storageState,
      colorScheme: 'light',
      ...(record ? { recordVideo: { dir: work, size: VIEWPORT } } : {}),
    });
    const t0 = Date.now();
    const now = () => (Date.now() - t0) / 1000;
    await ctx.addInitScript({ path: join(HERE, 'overlay.js') });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('admin-theme', 'light');
      } catch {
        /* the theme follows colorScheme anyway */
      }
    });
    await ctx.route('**/*', (route) => {
      const r = route.request();
      if (allowed(r.method(), r.url(), r.postData() ?? '')) return route.continue();
      const key = `${r.method()} ${new URL(r.url()).pathname}`;
      blocked.set(key, [...new Set([...(blocked.get(key) ?? []), w.id])]);
      return route.abort('blockedbyclient');
    });
    const page = await ctx.newPage();
    const cues = [];
    let open = null; // the caption on screen
    const say = async (text) => {
      if (open) open.end = now();
      open = text ? { start: now(), end: null, text } : null;
      if (open) cues.push(open);
      await page.evaluate((t) => window.__help.say(t), text ?? '');
    };
    const settle = async () => {
      await page.waitForFunction(() => !document.querySelector('#section .loading, #section [aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
      await sleep(500);
    };
    let step = {};
    const target = async (sel) => {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: step.optional ? 2500 : 10000 });
      await loc.scrollIntoViewIfNeeded();
      return { loc, box: await loc.boundingBox() };
    };
    const point = async (box) => {
      const [x, y] = [box.x + Math.min(box.width / 2, 40), box.y + box.height / 2];
      await page.evaluate(([px, py, b]) => (window.__help.pointer(px, py), window.__help.ring(b)), [x, y, box]);
      await sleep(record ? 800 : 0);
      return [x, y];
    };

    let firstCue = null;
    try {
      await page.goto(`${opt.url}/admin/${w.start ?? '#dashboard'}`);
      await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
      await settle();
      for (const [i, s] of w.steps.entries()) {
        const where = `${w.id} step ${i + 1}`;
        step = s;
        try {
          if (s.say !== undefined) {
            firstCue ??= now();
            await say(s.say);
          }
          if (s.go) {
            await page.evaluate((h) => (location.hash = h), s.go);
            await settle();
          }
          if (s.click) {
            const { loc, box } = await target(s.click);
            const [x, y] = await point(box);
            if (record) await page.evaluate(([px, py]) => window.__help.pulse(px, py), [x, y]);
            await loc.click();
            await page.evaluate(() => window.__help.ring(null));
            await settle();
          }
          if (s.type) {
            const { loc, box } = await target(s.type);
            await point(box);
            await loc.click();
            await loc.pressSequentially(s.text, { delay: record ? 90 : 0 });
            await page.evaluate(() => window.__help.ring(null));
            await settle();
          }
          if (s.select) {
            const { loc, box } = await target(s.select);
            await point(box);
            const values = await loc.evaluate((el) => [...el.options].map((o) => o.value));
            await loc.selectOption(s.value ?? values[s.index ?? 1]);
            await page.evaluate(() => window.__help.ring(null));
            await settle();
          }
          if (s.press) await page.keyboard.press(s.press);
          if (s.point) await point((await target(s.point)).box);
          if (s.scroll) await (await target(s.scroll)).loc.scrollIntoViewIfNeeded();
          if (s.shot) {
            let ringed = s.point ? (await target(s.point)).box : null; // put back after the picture, for the video
            if (s.highlight) {
              const { box } = await target(s.highlight);
              ringed = box;
              await page.evaluate((b) => window.__help.ring(b, { forShot: true }), box);
            }
            await page.evaluate(() => window.__help.hide(true));
            await sleep(250);
            const clip = s.area ? await (await target(s.area)).loc.boundingBox() : undefined;
            await page.screenshot({ path: join(MEDIA, `${s.shot}.png`), clip });
            await page.evaluate((b) => (window.__help.hide(false), window.__help.ring(b)), record ? ringed : null);
            console.log(`  ✓ ${s.shot}.png`);
          }
          if (s.unpoint) await page.evaluate(() => window.__help.ring(null));
          if (record) await sleep(s.wait ?? (s.say ? readMs(s.say) : 400));
          else if (s.wait) await sleep(Math.min(s.wait, 800));
        } catch (err) {
          const why = `${where} (${JSON.stringify(s).slice(0, 80)}): ${err.message.split('\n')[0]}`;
          if (!s.optional) throw new Error(why);
          console.warn(`  · skipped optional ${why}`); // e.g. a tab the demo shop has switched off
          await page.evaluate(() => window.__help.ring(null)).catch(() => {});
        }
      }
      await say(null);
      if (record) await sleep(700);
    } catch (err) {
      failed.push(err.message);
      console.error(`  ✗ ${err.message}`);
    }
    const video = record ? page.video() : null;
    await ctx.close();
    if (!video) continue;
    const raw = await video.path();
    if (failed.some((f) => f.startsWith(`${w.id} `))) {
      rmSync(raw, { force: true });
      continue;
    }
    // Start the video just before the first caption (the screen loading isn't worth watching).
    const trim = Math.max(0, (firstCue ?? 0) - 0.4);
    const out = join(MEDIA, `${w.id}.mp4`);
    const ok = ffmpeg(['-ss', trim.toFixed(2), '-i', raw, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out])
      && ffmpeg(['-ss', String(w.poster ?? 2), '-i', out, '-frames:v', '1', '-q:v', '4', join(MEDIA, `${w.id}.jpg`)]);
    if (ok) {
      writeFileSync(join(MEDIA, `${w.id}.vtt`), toVtt(cues.filter((c) => c.end), trim));
      console.log(`  ✓ ${w.id}.mp4 (${Math.round(now() - trim)}s)`);
    } else failed.push(`${w.id}: ffmpeg couldn’t convert the video`);
    rmSync(raw, { force: true });
  }

  await browser.close();
  rmSync(work, { recursive: true, force: true });
  const { shots, videos } = writeCaptured(new URL(opt.url).hostname);
  console.log(`\n${shots.length} screenshots and ${videos.length} videos in admin/help/media (captured.js updated).`);
  if (blocked.size) {
    console.log('\nStopped (would have changed data, or not on the read-only list):');
    for (const [k, ws] of blocked) console.log(`  ${k}  (${ws.join(', ')})`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} walk-through${failed.length === 1 ? '' : 's'} failed: the screen may have changed. Fix the step in tools/help-capture/walkthroughs.mjs and run again with --only.`);
    failed.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

// The pull list app's appearance (App → Account → Appearance): Light, Dark or the phone's own setting, in the shop's
// colors. Until someone picks one the app keeps the shop's own page. The pick and the CSS for each appearance are kept
// on this phone, so app.html's first script paints the right one before anything else loads; js/theme-vars.js
// schemeCss works out the colors.

import { schemeCss, pageIs } from './theme-vars.js';

const KEY = 'pc-app-theme';
export const APPEARANCES = [['device', 'Match my phone'], ['light', 'Light'], ['dark', 'Dark']];
const phoneDark = matchMedia('(prefers-color-scheme: dark)');

let colors = null; // the shop's, once the settings arrive (until then, the CSS saved last time)

function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {}; // private mode, or not ours
  }
}
function save(changes) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...saved(), ...changes }));
  } catch {
    /* private mode: the pick lasts until the app closes */
  }
}

let pick = APPEARANCES.some(([k]) => k === saved().pick) ? saved().pick : null;
/** 'light' or 'dark' as picked (the phone's setting worked out), or null for the shop's own page. */
const scheme = () => (pick === 'device' ? (phoneDark.matches ? 'dark' : 'light') : pick);

/** Write the picked appearance into the page, and the phone's status bar color to match. */
function paint() {
  const want = scheme();
  const css = !want ? '' : colors ? schemeCss(colors, want) : (saved().css?.[want] ?? '');
  let el = document.getElementById('app-theme');
  if (!css) el?.remove();
  else {
    if (!el) document.head.append((el = Object.assign(document.createElement('style'), { id: 'app-theme' })));
    if (el.textContent !== css) el.textContent = css;
  }
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) document.head.append((meta = Object.assign(document.createElement('meta'), { name: 'theme-color' })));
  meta.content = getComputedStyle(document.documentElement).getPropertyValue('--brand-paper').trim();
}

/** The shop's colors (Shop Settings): work out both appearances, keep them for next time, and paint. */
export function setShopColors(c) {
  colors = c ?? {};
  save({ css: { light: schemeCss(colors, 'light'), dark: schemeCss(colors, 'dark') } });
  paint();
  mark(); // with nothing picked, the choice is whichever the shop's page is
}

/** The picker's choice: the one picked, else whichever the shop's page already is. */
export const appearance = () => pick ?? (pageIs(colors ?? {}, 'light') ? 'light' : 'dark');

export function setAppearance(value) {
  if (!APPEARANCES.some(([k]) => k === value)) return;
  pick = value;
  save({ pick });
  paint();
}

let picker = null;
const mark = () => picker?.querySelectorAll('input').forEach((el) => (el.checked = el.value === appearance()));

/** Fill `host` with the Appearance choices (App → Account). */
export function setupAppearance(host) {
  picker = host;
  host.innerHTML = `<div role="radiogroup" aria-label="Appearance">${APPEARANCES.map(([k, label]) => `
    <div class="field field--check">
      <input id="look-${k}" type="radio" name="appearance" value="${k}"${appearance() === k ? ' checked' : ''}>
      <label for="look-${k}">${label}</label>
    </div>`).join('')}</div>
    <p class="field__hint">Light and Dark keep the shop’s colors on a light or a dark page. Match my phone follows your phone’s setting.</p>`;
  host.addEventListener('change', (e) => setAppearance(e.target.value));
}

phoneDark.addEventListener('change', () => pick === 'device' && paint());
paint();

// Admin appearance: "auto" follows the device, or force "light" / "dark". The choice is saved on the
// staff member's sign-in (user metadata) so it follows them to any device, and cached in
// localStorage so the page can paint in the right theme before anything loads (see the snippet in
// the <head> of index.html and style-guide.html, which does the same lookup).

const KEY = 'admin-theme';
const CHOICES = ['auto', 'light', 'dark'];
const dark = matchMedia('(prefers-color-scheme: dark)');

export const getTheme = () => {
  try {
    const t = localStorage.getItem(KEY);
    return CHOICES.includes(t) ? t : 'auto';
  } catch {
    return 'auto';
  }
};

function paint(choice) {
  document.documentElement.dataset.theme = choice === 'dark' || (choice === 'auto' && dark.matches) ? 'dark' : 'light';
  paintColors();
}

// ---- Custom colors -------------------------------------------------------------------------------
// Staff can override the main admin color variables, separately for the light and the dark theme.
// Inline styles on <html> beat both :root rules in base.css, so clearing them restores the defaults.
const COLORS_KEY = 'admin-colors';
export const COLOR_VARS = [
  ['--brand-primary', 'Main color', 'Tabs, charts, alerts and primary buttons'],
  ['--brand-accent', 'Accent', 'Highlights, the menu\u2019s current page, badges'],
  ['--brand-ink', 'Text', 'Body text'],
  ['--brand-paper', 'Page background', 'Behind everything'],
  ['--surface', 'Cards and panels', 'Boxes sitting on the page'],
  ['--header-bg', 'Top bar', 'Background of the bar at the very top'],
  ['--header-fg', 'Top bar text', 'Text and icons on the top bar'],
];
const isHex6 = (v) => /^#[0-9a-f]{6}$/i.test(v ?? '');
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

/** All saved overrides: { light: {'--var': '#rrggbb'}, dark: {...} }. */
export function getColors() {
  try {
    const c = JSON.parse(localStorage.getItem(COLORS_KEY));
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

/** The theme in effect right now: 'light' or 'dark'. */
export const currentMode = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function paintColors() {
  const root = document.documentElement.style;
  const mine = getColors()[currentMode()] ?? {};
  for (const [v] of COLOR_VARS) isHex6(mine[v]) ? root.setProperty(v, mine[v]) : root.removeProperty(v);
  // Text on the accent follows it so any pick stays readable.
  isHex6(mine['--brand-accent']) ? root.setProperty('--on-accent', contrast(mine['--brand-accent'], '#161616') >= contrast(mine['--brand-accent'], '#ffffff') ? '#161616' : '#ffffff') : root.removeProperty('--on-accent');
}

/** Show these overrides now and remember them on this device. */
export function applyColors(colors) {
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
  } catch {}
  paintColors();
}

/** Save the overrides on the account. Resolves to an error (or null). */
export async function saveColors(sb, user, colors) {
  applyColors(colors);
  const { error } = await sb.auth.updateUser({ data: { ...user.user_metadata, admin_colors: colors } });
  return error;
}

/** Show a choice now and remember it on this device. */
export function applyTheme(choice) {
  if (!CHOICES.includes(choice)) choice = 'auto';
  try {
    localStorage.setItem(KEY, choice);
  } catch {}
  paint(choice);
}

// Follow the device when the choice is "auto".
dark.addEventListener('change', () => getTheme() === 'auto' && paint('auto'));

/** On sign-in: the saved choice on the account wins over whatever this device remembered. */
export function syncTheme(user) {
  const meta = user?.user_metadata?.admin_colors;
  if (meta && typeof meta === 'object') try { localStorage.setItem(COLORS_KEY, JSON.stringify(meta)); } catch {}
  const saved = user?.user_metadata?.admin_theme;
  if (CHOICES.includes(saved)) applyTheme(saved);
  else paint(getTheme());
}

/** Choose a theme and save it on the account. Resolves to an error (or null). */
export async function saveTheme(sb, user, choice) {
  applyTheme(choice);
  const { error } = await sb.auth.updateUser({ data: { ...user.user_metadata, admin_theme: choice } });
  return error;
}

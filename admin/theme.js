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

// The admin address is "#section" or "#section/detail": the detail names one thing inside the section, e.g.
// "#qr/ab12cd" opens that QR code. A section the admin doesn't know falls back to the dashboard.

/** Splits location.hash into { name, arg }. `arg` is the decoded detail, or '' when there is none. */
export function parseAdminHash(hash, sections, fallback = 'dashboard') {
  const [head = '', ...rest] = String(hash).replace(/^#/, '').split('/');
  const name = sections.includes(head) ? head : fallback;
  let arg = '';
  if (name === head && rest.length) {
    try {
      arg = decodeURIComponent(rest.join('/'));
    } catch {
      arg = ''; // a broken escape just means "no detail"
    }
  }
  return { name, arg };
}

/** The hash for a section, with an optional detail: adminHash('qr', 'ab12') -> '#qr/ab12'. */
export const adminHash = (name, arg = '') => `#${name}${arg ? `/${encodeURIComponent(arg)}` : ''}`;

// The rules for managing staff, kept apart from the database calls so they can be tested.

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
// No 0/O, 1/l/I: easy to read aloud or type from a note.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random starting password, 14 characters. */
export function generatePassword(length = 14) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 isn't a multiple of the alphabet size, so drop the biased top slice.
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  for (const b of bytes) if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
  return out.length === length ? out : out + generatePassword(length - out.length);
}

/** Cleaned-up name and email for a new staff member, or an error message. */
export function checkNewStaff({ name, email, password }) {
  const n = String(name ?? '').trim();
  const e = String(email ?? '').trim().toLowerCase();
  if (!n || n.length > 80) return { error: 'Please enter their name (80 characters at most).' };
  if (!EMAIL.test(e) || e.length > 254) return { error: 'That email address doesn’t look right.' };
  if (password != null && String(password) !== '' && String(password).length < 10) return { error: 'A password needs at least 10 characters. Leave it blank to generate one.' };
  return { name: n, email: e };
}

/**
 * Can `actorId` do `action` (remove, set_owner, reset_password) to `targetId`? `staff` is every staff row
 * ({ user_id, is_owner, is_super }). Nobody removes themselves, and there must always be at least one owner.
 * A Super Admin can't be removed or demoted by anyone here, and only a Super Admin can reset a Super Admin's password.
 */
export function checkChange({ action, actorId, targetId, staff, makeOwner }) {
  const target = staff.find((s) => s.user_id === targetId);
  if (!target) return { error: 'That person isn’t on the staff list.' };
  const owners = staff.filter((s) => s.is_owner).length;
  const actor = staff.find((s) => s.user_id === actorId);
  if (target.is_super) {
    if (action === 'remove') return { error: 'A Super Admin can’t be removed.' };
    if (action === 'set_owner' && !makeOwner) return { error: 'A Super Admin can’t be demoted.' };
    if (action === 'reset_password' && targetId !== actorId && !actor?.is_super) return { error: 'Only a Super Admin can reset a Super Admin’s password.' };
  }
  if (action === 'remove') {
    if (targetId === actorId) return { error: 'You can’t remove yourself. Ask another owner to do it.' };
    if (target.is_owner && owners <= 1) return { error: 'There has to be at least one owner.' };
  }
  if (action === 'set_owner' && !makeOwner && target.is_owner && owners <= 1) return { error: 'There has to be at least one owner.' };
  return { ok: true };
}

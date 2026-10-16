// Building blocks for PostgREST `.or()` filters in the admin. Text that comes from a search box or a customer
// record goes into a filter string like "email.ilike.x,phone_digits.eq.y", so a comma, bracket or quote in it
// could change what the filter means. Everything here makes values safe, or leaves the clause out.

import { searchWords } from '../js/util.js';

/** A search box's text made safe to put inside a filter. */
export const searchTerm = (q) => String(q ?? '').trim().replace(/[%_,()"\\]/g, ' ').trim();

/** Filter matching customers by name, email or phone digits; `words` also matches each word of a "Last First" search. */
export function customerFilter(q, { words = false } = {}) {
  const text = searchTerm(q);
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  const ors = [`name.ilike.%${text}%`, `email.ilike.%${text}%`];
  if (words) for (const w of text.split(/\s+/).filter((w) => w.length >= 2)) ors.push(`first_name.ilike.%${w}%`, `last_name.ilike.%${w}%`);
  if (digits.length >= 3) ors.push(`phone_digits.like.%${digits}%`);
  return ors.join(',');
}

/**
 * One email address as an exact, case-insensitive match: "<column>.ilike.<email>". Returns '' (leave it out) when the
 * address has a character that could break the filter (comma, bracket, quote, backslash, space, % or *).
 * An underscore is escaped so it matches only itself, not any character.
 */
export function emailMatch(column, email) {
  const e = String(email ?? '').trim();
  if (!e || /[,()"\\%*\s]/.test(e)) return '';
  return `${column}.ilike.${e.replace(/_/g, '\\_')}`;
}

/** Phone digits as an exact match: "<column>.eq.<digits>", or '' unless it really is only digits. */
export const digitsMatch = (column, digits) => (/^\d+$/.test(String(digits ?? '')) ? `${column}.eq.${digits}` : '');

/** Join clauses into one `.or()` string, dropping the empty ones. Returns '' when nothing is left. */
export const anyOf = (...clauses) => clauses.flat().filter(Boolean).join(',');

/**
 * Filter for a title search, matched like the site search: every word of the search (case, accents and punctuation
 * ignored, any order) in the title, cover, creators or issue number, so "spiderman 7" finds SPIDER-MAN #7.
 * `codes` also matches the search as typed against SKU, UPC and ISBN.
 */
export function titleFilter(q, { codes = false } = {}) {
  const words = searchWords(q);
  const text = searchTerm(q);
  const byWords = words.map((w) => `search_norm.like.%${w}%`); // letters and digits only, nothing to escape
  const clauses = [];
  if (byWords.length) clauses.push(byWords.length === 1 ? byWords[0] : `and(${byWords.join(',')})`);
  if (codes && text) clauses.push(...['sku', 'upc', 'isbn'].map((c) => `${c}.ilike.%${text}%`));
  return clauses.join(',');
}

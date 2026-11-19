// A shareable "follow this series" link, for a shop's posts and newsletters: account.html?follow=<series key>.
// Signed in, the page asks "Follow this series?" straight away. Signed out, it keeps the series on this device, asks
// them to sign in, and asks once they're back (the emailed sign-in link returns to account.html without the address).
// A series also has its own page, series.html?s=<key with dashes> (js/pages/series.js): what staff copy from
// Admin → Series, and where series names on the site lead.

export const FOLLOW_PARAM = 'follow';
const PENDING = 'pw-follow-pending';
const KEEP_MS = 24 * 60 * 60 * 1000; // long enough to find the sign-in email

const SERIES_PARAM = 's';
const slug = (key) => String(key).trim().replace(/\s+/g, '-');
const site = (siteUrl) => String(siteUrl).replace(/\/$/, '');

/** The follow link for one series, relative (for links on the site itself). */
export const followHref = (key) => `account.html?${FOLLOW_PARAM}=${encodeURIComponent(key)}`;

/** The follow link for one series on this shop's site. */
export const followLink = (siteUrl, key) => `${site(siteUrl)}/${followHref(key)}`;

/** A series' page, relative: series.html?s=absolute-justice. */
export const seriesHref = (key) => `series.html?${SERIES_PARAM}=${encodeURIComponent(slug(key))}`;

/** A series' page on this shop's site. */
export const seriesLink = (siteUrl, key) => `${site(siteUrl)}/${seriesHref(key)}`;

/** A readable name from a series key ("absolute justice" → "Absolute Justice"), for before the real one can be loaded. */
export const nameFromKey = (key) => String(key ?? '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** A series key from an address: lower-case words and digits, single spaces ("Absolute-Justice" → "absolute justice"). */
const keyOf = (raw) => raw?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null;

/** The series key in a follow link's query (location.search), or null. */
export const followKeyIn = (search) => keyOf(new URLSearchParams(search).get(FOLLOW_PARAM));

/** The series key in a series page's query (location.search), or null. */
export const seriesKeyIn = (search) => keyOf(new URLSearchParams(search).get(SERIES_PARAM));

/** Keep the series to follow on this device. */
export function keepPending(key, storage = globalThis.localStorage, now = Date.now()) {
  try {
    storage.setItem(PENDING, JSON.stringify({ key, at: now }));
  } catch {
    /* nowhere to keep it: a signed-out customer just follows it by hand after signing in */
  }
}

/** The series waiting to be followed, if it was kept within the last day. Leaves it in place. */
export function peekPending(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const kept = JSON.parse(storage.getItem(PENDING) ?? 'null');
    return kept?.key && now - kept.at < KEEP_MS ? kept.key : null;
  } catch {
    return null;
  }
}

/** The series waiting to be followed (see peekPending), taken off the device so it's only asked once. */
export function takePending(storage = globalThis.localStorage, now = Date.now()) {
  const key = peekPending(storage, now);
  try {
    storage.removeItem(PENDING);
  } catch {
    /* asked again next time, at worst */
  }
  return key;
}

// Per-item <title>, description and link-preview tags for the detail pages (news posts, events, staff-made
// pages), and noindex on their "not found" / "couldn't load" versions so search engines don't keep those.
import { htmlToText } from './ics.js';

/** Plain text cut to about `max` characters at a word break, for a meta description. */
export const snippet = (text, max = 155) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
};

/** The same, from the admin editor's HTML. */
export const htmlSnippet = (html, max) => snippet(htmlToText(html), max);

function meta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) el = document.head.appendChild(document.createElement('meta'));
  el.setAttribute(attr, key);
  el.setAttribute('content', content);
}

export function setPageMeta({ title, description, noindex = false }) {
  if (title) {
    document.title = title;
    meta('property', 'og:title', title);
  }
  if (description) {
    meta('name', 'description', description);
    meta('property', 'og:description', description);
  }
  if (noindex) meta('name', 'robots', 'noindex');
}

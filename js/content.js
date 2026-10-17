// Staff-editable rich text (page ledes/bodies, FAQ answers) from the database.
// The HTML comes from the admin WYSIWYG editor; it's sanitized before display
// and {placeholders} are filled from shop settings.

import { getPageContent } from './data.js';
import { esc, formatPhone } from './util.js';
import { readCache, writeCache } from './cache.js';

// Videos staff can embed: only these players, nothing else in an <iframe>.
const VIDEO_SRC = /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)[\w-]+(\?[\w=&-]*)?$/;

// DOMPurify is served from this site (js/vendor/, unchanged from the npm package) so a slow or blocked CDN can't
// stop page text from showing. Still loaded on first use: pages without rich text never fetch it.
let purifier;
const purify = () =>
  (purifier ??= import('./vendor/purify.es.mjs').then((m) => {
    const DOMPurify = m.default;
    DOMPurify.addHook('uponSanitizeElement', (node, data) => {
      if (data.tagName === 'iframe' && !VIDEO_SRC.test(node.getAttribute('src') ?? '')) node.remove();
    });
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'IFRAME') {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media');
        node.setAttribute('title', node.getAttribute('title') || 'Video');
      }
    });
    return DOMPurify;
  }));

/** Placeholders staff can type in the editor, filled from settings. */
export const PLACEHOLDERS = ['shop_name', 'phone', 'email', 'max_copies_per_title', 'hold_days', 'founded_year'];

/** Plain-text fallback for rich text that couldn't be sanitized: tags dropped, paragraphs kept, everything escaped. */
const asPlainText = (html) => {
  const text = String(html)
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
  return text
    .split(/\s*\n\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
};

/**
 * Settings-filled, sanitized HTML ready to insert. If the sanitizer can't load (or throws), the text is shown
 * as plain escaped paragraphs instead — never as raw HTML — so callers always get something safe to show.
 */
export async function renderRich(html, settings = {}) {
  const filled = String(html ?? '').replace(/\{(\w+)\}/g, (m, key) => (PLACEHOLDERS.includes(key) ? esc(key === 'phone' ? formatPhone(settings?.[key]) : settings?.[key]) : m));
  try {
    return (await purify()).sanitize(filled, { ADD_TAGS: ['iframe'], ADD_ATTR: ['target', 'allowfullscreen', 'frameborder'] });
  } catch (err) {
    console.error('Rich text sanitizer failed; showing plain text', err);
    purifier = undefined; // try loading it again next time
    return asPlainText(filled);
  }
}

/**
 * Fill every <… data-content="slug:lede|body"> on the page. Blocks with no
 * text are hidden rather than left as empty space.
 *
 * `settings` may be the settings object or a promise for it, so the text can be
 * fetched while the settings are still loading. The last visit's sanitized HTML is
 * shown straight away when there is one, then replaced if the text has changed;
 * with a snapshot for every block this returns at once and the refresh runs behind.
 */
export async function fillContent(settings) {
  const els = [...document.querySelectorAll('[data-content]')];
  if (!els.length) return;
  const slugs = [...new Set(els.map((el) => el.dataset.content.split(':')[0]))];
  const show = (el, html) => {
    el.innerHTML = html;
    el.hidden = !el.textContent.trim();
  };
  const shown = new Map();
  for (const el of els) {
    const html = readCache(`html:${el.dataset.content}`);
    if (html == null) continue;
    shown.set(el, html);
    show(el, html);
  }
  const refresh = (async () => {
    const [content, s] = await Promise.all([getPageContent(slugs), settings]);
    await Promise.all(
      els.map(async (el) => {
        const [slug, field] = el.dataset.content.split(':');
        const html = content[slug]?.[`${field}_html`];
        const out = html ? await renderRich(html, s) : '';
        writeCache(`html:${el.dataset.content}`, out);
        if (out !== shown.get(el)) show(el, out);
      }),
    );
  })();
  if (shown.size === els.length) refresh.catch((err) => console.error('Page content failed to refresh', err));
  else await refresh;
}

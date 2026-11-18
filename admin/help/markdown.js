// A small Markdown reader for the Help articles (admin/help/articles/*.js). Only what the articles use, and nothing
// that lets an article write its own HTML: every bit of text is escaped.
//
//   ## Heading / ### Smaller heading
//   Paragraphs, separated by a blank line
//   - bullets            1. numbered steps
//   **bold**, *italic*, `code`, [a link](#ordering) or [a page](https://…), Ordering → Place Order
//   ![What the picture shows](place-order-export)   a screenshot from admin/help/media/<name>.png
//   > **Tip:** …          a tip, drawn as a callout
//
// Links that start with # stay in the admin ("#help/place-order", "#customers"); http(s) links open a new tab.

import { esc } from '../../js/util.js';

/** Where screenshots and videos live, from the admin page. */
export const MEDIA = 'help/media/';

const LINK = /^(#[\w/-]*|https:\/\/[^\s)]+|mailto:[^\s)]+)$/;
const SHOT = /^[a-z0-9][a-z0-9-]*$/;

/** Inline marks inside one line of text: links, code, bold, italic. */
export function inline(text) {
  const parts = [];
  // Code first, so nothing inside backticks is read as a mark.
  String(text).split(/(`[^`]+`)/).forEach((piece) => {
    if (/^`[^`]+`$/.test(piece)) return parts.push(`<code>${esc(piece.slice(1, -1))}</code>`);
    let out = esc(piece);
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, href) => {
      const url = href.replace(/&amp;/g, '&');
      if (!LINK.test(url)) return label;
      const outside = /^https:/.test(url) ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${esc(url)}"${outside}>${label}</a>`;
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
    parts.push(out);
  });
  return parts.join('');
}

/**
 * The article as HTML. `shots` lists the screenshots that exist (names without .png); a picture whose file hasn't
 * been captured yet is left out rather than drawn broken. Pass null to keep every picture.
 */
export function render(md, { shots = null } = {}) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let para = [];
  let list = null; // { tag, items: [] }
  let tip = null; // lines of a > block
  const flushPara = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.tag} class="help-steps">${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushTip = () => {
    if (tip) html.push(`<aside class="help-tip"><p>${inline(tip.join(' '))}</p></aside>`);
    tip = null;
  };
  const flush = () => (flushPara(), flushList(), flushTip());

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flush();
    } else if ((m = line.match(/^(#{2,3})\s+(.+)$/))) {
      flush();
      const level = m[1].length;
      html.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
      flush();
      const [, alt, name] = m;
      if (SHOT.test(name) && (!shots || shots.includes(name))) {
        html.push(`<figure class="help-shot"><a href="${MEDIA}${name}.png" target="_blank" rel="noopener"><img src="${MEDIA}${name}.png" alt="${esc(alt)}" loading="lazy" width="1280" height="800"></a>${alt ? `<figcaption>${inline(alt)}</figcaption>` : ''}</figure>`);
      }
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      (tip ??= []).push(m[1]);
    } else if ((m = line.match(/^\s*(-|\d+\.)\s+(.+)$/))) {
      flushPara();
      flushTip();
      const tag = m[1] === '-' ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      (list ??= { tag, items: [] }).items.push(m[2]);
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`; // a step that runs onto the next line
    } else {
      flushList();
      flushTip();
      para.push(line.trim());
    }
  }
  flush();
  return html.join('\n');
}

/** The article's words without marks, for search. */
export const plain = (md) =>
  String(md)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

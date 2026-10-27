// Reading the repo's CSS: custom properties, rules, and a scoper that puts a stylesheet under one wrapper class.
import { readFileSync } from 'node:fs';

export const read = (p) => readFileSync(p, 'utf8');

/** Strip comments (none of the sources put comment markers inside strings). */
export const uncomment = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first block that starts with `head` (e.g. ":root {"). */
export function varsOf(css, head) {
  const i = css.indexOf(head);
  if (i < 0) throw new Error(`${head} not found`);
  const body = css.slice(i + head.length, css.indexOf('}', i));
  const out = [];
  for (const m of uncomment(body).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out.push([m[1], m[2].trim()]);
  return out;
}

/** Parse into [{sel, body}] and [{at, children}] (nested once for @media/@supports), keeping order. */
export function parse(css) {
  css = uncomment(css);
  let i = 0;
  const parseList = (end) => {
    const items = [];
    while (i < css.length) {
      while (i < css.length && /\s/.test(css[i])) i++;
      if (css[i] === '}' ) { i++; return items; }
      if (i >= css.length) break;
      const start = i;
      let depthParen = 0, q = null;
      while (i < css.length) {
        const c = css[i];
        if (q) { if (c === q) q = null; }
        else if (c === '"' || c === "'") q = c;
        else if (c === '(') depthParen++;
        else if (c === ')') depthParen--;
        else if (depthParen === 0 && (c === '{' || c === ';')) break;
        i++;
      }
      const head = css.slice(start, i).trim();
      if (css[i] === ';') { i++; items.push({ stmt: head }); continue; }
      i++; // past {
      if (/^@(media|supports)/.test(head)) {
        items.push({ at: head, children: parseList() });
      } else {
        // a plain block: read to the matching brace
        const b = i; let d = 1; q = null;
        while (i < css.length && d) {
          const c = css[i];
          if (q) { if (c === q) q = null; }
          else if (c === '"' || c === "'") q = c;
          else if (c === '{') d++;
          else if (c === '}') d--;
          i++;
        }
        items.push({ sel: head, body: css.slice(b, i - 1).trim() });
      }
    }
    return items;
  };
  return parseList();
}

/** Split a selector list on top-level commas. */
export function splitSel(sel) {
  const out = []; let d = 0, cur = '';
  for (const c of sel) {
    if (c === '(' || c === '[') d++;
    if (c === ')' || c === ']') d--;
    if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Re-scope a stylesheet under `w` (".pw-admin"). :root / html / body become the wrapper; `:root[data-theme='dark'] x`
 * becomes `[data-theme="dark"] w x`. Rules `skip(sel)` returns true for are dropped, as are @media print and
 * @font-face (the design system declares fonts from tokens.json).
 */
export function scope(css, w, { skip = () => false, wrapperDrop = [] } = {}) {
  const fix = (s) => {
    if (/^:root\[data-theme=['"]dark['"]\]/.test(s)) return `[data-theme="dark"] ${w}${s.replace(/^:root\[data-theme=['"]dark['"]\]/, '')}`;
    if (s === ':root' || s === 'html' || s === 'body') return w;
    if (/^body[.:[]/.test(s)) return w + s.slice(4);
    if (/^(html|body)\s/.test(s)) return w + s.replace(/^(html|body)/, '');
    return `${w} ${s}`;
  };
  const decl = (sel, body) => {
    const sels = splitSel(sel);
    if (sels.some(skip)) return '';
    const mapped = sels.map(fix);
    if (mapped.length === 1 && mapped[0] === w && wrapperDrop.length) {
      body = body.split(';').map((d) => d.trim()).filter((d) => d && !wrapperDrop.includes(d.split(':')[0].trim())).join('; ');
      if (!body) return '';
    }
    return `${mapped.join(', ')} { ${body.replace(/\s*\n\s*/g, ' ').trim()} }`;
  };
  const walk = (items, indent = '') => items.map((it) => {
    if (it.stmt) return '';
    if (it.at) {
      if (/^@media print/.test(it.at)) return '';
      const inner = walk(it.children, indent + '  ').filter(Boolean);
      return inner.length ? `${it.at} {\n${inner.map((l) => '  ' + l).join('\n')}\n}` : '';
    }
    if (/^@font-face/.test(it.sel)) return '';
    if (/^@keyframes/.test(it.sel)) return `${it.sel} { ${it.body.replace(/\s*\n\s*/g, ' ')} }`;
    return decl(it.sel, it.body);
  });
  return walk(parse(css)).filter(Boolean).join('\n');
}

/** Selectors whose declarations use var(--name): the "Used by" part of a token's note. */
export function usedBy(css, name, limit = 4) {
  const out = [];
  const visit = (items) => items.forEach((it) => {
    if (it.at) return visit(it.children);
    if (!it.sel || it.sel.startsWith('@') || it.sel.startsWith(':root')) return;
    if (new RegExp(`var\\(--${name}[),\\s]`).test(it.body)) {
      const s = /\[style\*=/.test(it.sel) ? 'staff-colored editor text' : splitSel(it.sel)[0];
      if (!out.includes(s)) out.push(s);
    }
  });
  visit(parse(css));
  return out.slice(0, limit);
}

// ---- Colour maths (WCAG 2) ----
export const hex6 = (h) => { h = h.toLowerCase(); return h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h.slice(0, 7); };
const ch = (h, i) => parseInt(hex6(h).slice(1 + i * 2, 3 + i * 2), 16);
export const lum = (h) => {
  const [r, g, b] = [0, 1, 2].map((i) => ch(h, i) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** color-mix(in srgb, a, b p%) */
export const mix = (a, b, p) => '#' + [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - p) + ch(b, i) * p).toString(16).padStart(2, '0')).join('');
export const fmt = (r) => `${r.toFixed(1)}:1`;

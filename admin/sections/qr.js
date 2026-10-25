// QR Codes: create, edit, download (PNG / SVG) and print QR codes (qr_codes table).
// A code either holds its web address directly, or holds a shop link (go.html?c=<slug>) that forwards to the
// saved address, so the address can be changed later without reprinting. Drawn in the browser with
// qrcode-generator (loaded from a CDN on first use).

import { $, $$, esc, must, hintFold, setStatus, toast, solidIcon, friendlyError, loadScript, fmtDate } from '../lib.js';
import { SITE_URL } from '../../js/config.js';

export const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const QUIET = 4; // blank border, in modules, that scanners need

let items = []; // { id|null, slug, el, dirty }
let qrTab = 'all'; // all | forward | direct
export const hasUnsavedChanges = () => items.some((i) => i.dirty);

export const newSlug = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

/** Accept "example.com/x" as well as "https://…"; returns '' if it isn't a web address. */
export function cleanUrl(raw) {
  let u = String(raw ?? '').trim();
  if (!u || /\s/.test(u)) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.') ? u : '';
  } catch {
    return '';
  }
}

/** The text the code actually holds. */
export const encodedText = (c) => (c.forward ? `${SITE_URL}/go.html?c=${c.slug}` : c.target_url);

function matrix(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return { n: qr.getModuleCount(), dark: (r, c) => qr.isDark(r, c) };
}

export function svgFor(text, fg, bg) {
  const { n, dark } = matrix(text);
  const total = n + QUIET * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}

export function pngFor(text, fg, bg, size = 1024) {
  const { n, dark } = matrix(text);
  const total = n + QUIET * 2;
  const px = Math.max(1, Math.floor(size / total));
  const canvas = Object.assign(document.createElement('canvas'), { width: total * px, height: total * px });
  const g = canvas.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = fg;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) g.fillRect((c + QUIET) * px, (r + QUIET) * px, px, px);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

export function download(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** WCAG contrast ratio of two #rrggbb colors. */
function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export async function mount(el, { sb, arg = '' }) {
  items = [];
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>QR Codes</h1>
      <button class="btn btn--add" type="button" data-add>${solidIcon('add', 18)} New QR code</button>
    </div>
    ${hintFold(`Make a code for a web page, then download it (PNG for printing, SVG for sign makers) or print it.
      Leave <strong>Forward through our site</strong> on and you can change where the code goes later, even after it’s printed.
      Turn it off for a code that holds the address itself (simpler, but it can’t be changed once printed).`)}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-qrtab="all">All</button>
      <button type="button" class="admin-tab" role="tab" data-qrtab="forward">Forwarding</button>
      <button type="button" class="admin-tab" role="tab" data-qrtab="direct">Direct</button>
    </div>
    <div class="qr-list"></div>`;
  const list = $('.qr-list', el);
  // Show only the codes for the chosen tab (forwarding codes can be re-pointed after printing; direct ones can't).
  const applyTab = () => {
    $$('[data-qrtab]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.qrtab === qrTab));
    let shown = 0;
    for (const it of items) {
      it.el.hidden = !!it.id && qrTab !== 'all' && (qrTab === 'forward') !== it.forward;
      if (!it.el.hidden) shown++;
    }
    $('[data-tab-empty]', list)?.remove();
    if (!shown && items.length) list.insertAdjacentHTML('beforeend', `<p class="empty" data-tab-empty>No ${qrTab === 'forward' ? 'forwarding' : 'direct'} codes.</p>`);
  };
  try {
    qrTab = sessionStorage.getItem('admin-qr-tab') || qrTab;
  } catch {
    /* start on All */
  }
  $$('[data-qrtab]', el).forEach((b) =>
    b.addEventListener('click', () => {
      qrTab = b.dataset.qrtab;
      try {
        sessionStorage.setItem('admin-qr-tab', qrTab);
      } catch {
        /* remembering the tab is optional */
      }
      applyTab();
    }),
  );
  try {
    await loadScript(QR_LIB, 'Couldn’t load the QR code library. Check your connection and reload.');
    const rows = await must(sb.from('qr_codes').select('*').order('created_at', { ascending: false }));
    if (!rows.length) list.innerHTML = '<p class="empty" data-empty>No QR codes yet. Click “New QR code” to make one.</p>';
    // "#qr/<slug>" (e.g. from a survey's View QR code button) opens just that code and scrolls to it.
    const target = arg && rows.some((r) => r.slug === arg) ? arg : '';
    if (target) qrTab = 'all';
    rows.forEach((r, i) => addItem(sb, list, r, target ? r.slug === target : i === 0));
    applyTab();
    const found = items.find((it) => it.slug === target);
    if (found) {
      found.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      found.el.classList.add('is-flash');
      setTimeout(() => found.el.classList.remove('is-flash'), 2500);
    }
  } catch (err) {
    list.innerHTML = `<p class="form-error">Couldn’t load QR codes: ${esc(friendlyError(err))}</p>`;
    return;
  }
  $('[data-add]', el).addEventListener('click', () => {
    $('[data-empty]', list)?.remove();
    $('[data-tab-empty]', list)?.remove();
    const item = addItem(sb, list, { id: null, name: '', target_url: '', forward: true, slug: newSlug(), fg: '#000000', bg: '#ffffff', notes: '' }, true, true);
    item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('[name=name]', item.el).focus();
  });
}

/** "12 scans, last Oct 13" for forwarding codes; direct codes can't be counted. */
function scanText(c) {
  if (!c.id) return '';
  if (!c.forward) return 'Scans aren’t counted for codes that hold the address directly.';
  const n = Number(c.scan_count || 0);
  const last = c.last_scan_at ? `, last ${fmtDate(c.last_scan_at)}` : '';
  return `${n} ${n === 1 ? 'scan' : 'scans'}${last}`;
}

function addItem(sb, list, c, open = false, prepend = false) {
  const el = document.createElement('div');
  const uid = Math.random().toString(36).slice(2);
  el.className = 'fold qr-item';
  el.innerHTML = `
    <details${open ? ' open' : ''}>
      <summary class="fold__head"><span data-title></span></summary>
      <div class="fold__body qr-item__body">
        <div class="qr-item__form">
          <div class="field"><label for="n-${uid}">Name (just for you)</label>
            <input id="n-${uid}" name="name" maxlength="120" value="${esc(c.name)}" placeholder="Free Comic Book Day flyer"></div>
          <div class="field"><label for="u-${uid}">Web address it opens</label>
            <input id="u-${uid}" name="url" type="text" inputmode="url" maxlength="2000" value="${esc(c.target_url)}" placeholder="https://example.com/pre-orders.html"></div>
          <div class="checks"><label><input type="checkbox" name="forward"${c.forward ? ' checked' : ''}> Forward through our site (lets you change the address later)</label></div>
          <div class="qr-item__colors">
            <div class="field"><label for="f-${uid}">Code color</label><input id="f-${uid}" name="fg" type="color" value="${c.fg}"></div>
            <div class="field"><label for="b-${uid}">Background</label><input id="b-${uid}" name="bg" type="color" value="${c.bg}"></div>
          </div>
          <div class="field"><label for="t-${uid}">Notes (optional)</label>
            <input id="t-${uid}" name="notes" maxlength="500" value="${esc(c.notes)}" placeholder="Where it’s printed, when it expires…"></div>
          <p class="admin-hint" data-warn hidden>These colors are too close, so phones may not scan this. Use a dark code on a light background.</p>
          <div class="qr-item__actions sticky-actions">
            <button class="btn btn--primary" type="button" data-save>Save</button>
            <button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>
            <span class="admin-status" role="status"></span>
          </div>
        </div>
        <div class="qr-item__preview">
          <div class="qr-item__img" data-img role="img" aria-label="QR code preview"></div>
          <p class="admin-hint" data-holds></p>
          <p class="admin-hint" data-scans></p>
          <div class="qr-item__downloads">
            <button class="btn btn--ghost btn--small" type="button" data-png>Download PNG</button>
            <button class="btn btn--ghost btn--small" type="button" data-svg>Download SVG</button>
            <button class="btn btn--ghost btn--small" type="button" data-print>Print</button>
          </div>
        </div>
      </div>
    </details>`;
  prepend ? list.prepend(el) : list.append(el);
  const item = { id: c.id, slug: c.slug, el, dirty: !c.id, forward: !!c.forward, scans: Number(c.scan_count || 0) };
  items.push(item);

  const status = $('.admin-status', el);
  const read = () => ({
    name: $('[name=name]', el).value.trim(),
    target_url: cleanUrl($('[name=url]', el).value),
    forward: $('[name=forward]', el).checked,
    slug: item.slug,
    fg: $('[name=fg]', el).value,
    bg: $('[name=bg]', el).value,
    notes: $('[name=notes]', el).value.trim(),
  });
  const render = () => {
    const v = read();
    $('[data-title]', el).textContent = v.name || '(new QR code)';
    $('[data-warn]', el).hidden = contrast(v.fg, v.bg) >= 4;
    const img = $('[data-img]', el);
    if (!v.target_url) {
      img.innerHTML = '<span class="admin-hint">Enter a web address to see the code.</span>';
      $('[data-holds]', el).textContent = '';
      return;
    }
    const text = encodedText(v);
    img.innerHTML = svgFor(text, v.fg, v.bg);
    $('[data-holds]', el).textContent = v.forward ? `Code holds ${text}, which forwards to ${v.target_url}` : `Code holds ${text}`;
  };
  render();
  $('[data-scans]', el).textContent = scanText(c);
  el.addEventListener('input', () => {
    item.dirty = true;
    setStatus(status, 'Unsaved changes');
    render();
  });

  const current = () => {
    const v = read();
    if (!v.target_url) setStatus(status, 'Please enter a web address (like example.com/events).', 'error');
    return v.target_url ? v : null;
  };
  const fileBase = () => (read().name || 'qr-code').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'qr-code';
  $('[data-png]', el).addEventListener('click', async () => {
    const v = current();
    if (v) download(await pngFor(encodedText(v), v.fg, v.bg), `${fileBase()}.png`);
  });
  $('[data-svg]', el).addEventListener('click', () => {
    const v = current();
    if (v) download(new Blob([svgFor(encodedText(v), v.fg, v.bg)], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  });
  $('[data-print]', el).addEventListener('click', () => {
    const v = current();
    if (!v) return;
    const w = window.open('', '_blank');
    if (!w) return setStatus(status, 'Your browser blocked the print window. Allow pop-ups for this page and try again.', 'error');
    w.document.write(`<!doctype html><title>${esc(v.name || 'QR code')}</title><style>body{font:20px system-ui;text-align:center;margin:40px}svg{width:min(80vw,600px);height:auto}</style>
      ${v.name ? `<h1>${esc(v.name)}</h1>` : ''}${svgFor(encodedText(v), v.fg, v.bg)}<script>onload=()=>print()<\/script>`);
    w.document.close();
  });
  $('[data-save]', el).addEventListener('click', () => save(sb, item, read, status, render));
  $('[data-delete]', el).addEventListener('click', () => remove(sb, item, read, status));
  return item;
}

async function save(sb, item, read, status, render) {
  const v = read();
  if (!v.name) return setStatus(status, 'Please give the code a name.', 'error');
  if (!v.target_url) return setStatus(status, 'Please enter a web address (like example.com/events).', 'error');
  // A saved forwarding code is printed as our site's /go address; holding the web address directly instead makes a
  // different code, and the printed copies stop working (they only forward while forwarding is on).
  if (item.id && item.forward && !v.forward) {
    const scanned = item.scans ? `It has been scanned ${item.scans.toLocaleString()} ${item.scans === 1 ? 'time' : 'times'}, so copies are out there. ` : '';
    if (!confirm(`Turn off “Forward through our site” for “${v.name}”?\n\n${scanned}Any printed copies of this code will stop working, and you’ll need to print the new code. Leave forwarding on to change where printed codes go instead.`)) return;
  }
  const row = { name: v.name, target_url: v.target_url, forward: v.forward, slug: v.slug, fg: v.fg, bg: v.bg, notes: v.notes };
  setStatus(status, 'Saving…');
  try {
    const saved = item.id
      ? await must(sb.from('qr_codes').update(row).eq('id', item.id).select('id').single())
      : await must(sb.from('qr_codes').insert(row).select('id').single());
    item.id = saved.id;
    item.forward = v.forward;
    item.dirty = false;
    if (!$('[data-scans]', item.el).textContent) $('[data-scans]', item.el).textContent = v.forward ? '0 scans' : scanText({ id: item.id, forward: false });
    $('[name=url]', item.el).value = v.target_url; // show the cleaned-up address
    render();
    setStatus(status, v.forward ? 'Saved. Printed copies of this code follow the new address.' : 'Saved.', 'ok');
  } catch (err) {
    setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
  }
}

async function remove(sb, item, read, status) {
  const v = read();
  const warning = v.forward && item.id ? ' Any printed copies will stop working.' : '';
  if (!confirm(`Delete “${v.name || 'this QR code'}”?${warning} This can’t be undone.`)) return;
  try {
    if (item.id) await must(sb.from('qr_codes').delete().eq('id', item.id));
    items.splice(items.indexOf(item), 1);
    item.el.remove();
    toast('QR code deleted');
  } catch (err) {
    setStatus(status, `Not deleted: ${friendlyError(err)}`, 'error');
  }
}

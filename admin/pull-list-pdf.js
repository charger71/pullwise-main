// A customer's pull list as a printable PDF: shop header, the customer's name once, then their
// titles grouped as "Ready for pickup" and "Coming up". Built in the browser with jsPDF (loaded
// from a CDN on first use, so the admin stays light until someone exports).

import { holdUntil } from '../js/dates.js';
import { itemTitle, sizedImage, formatPhone } from '../js/util.js';
import { SITE_URL } from '../js/config.js';
import { followedSeries, discountFor, totals, tiersFrom } from '../js/discount.js';
import { loadScript } from './lib.js';

const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const AUTOTABLE = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

const loadPdfScript = (src) => loadScript(src, 'Couldn’t load the PDF library. Check your connection and try again.');

export async function jsPDF() {
  if (!window.jspdf?.jsPDF) await loadPdfScript(JSPDF);
  if (!window.jspdf.jsPDF.API.autoTable) await loadPdfScript(AUTOTABLE);
  return window.jspdf.jsPDF;
}

// jsPDF's built-in fonts cover Western European text only; swap anything else for a close match.
export const clean = (s) =>
  String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E -ÿ]/g, '');

export const rgb = (hex, fallback) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  const v = m ? m[1] : fallback;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};

/**
 * The shop logo as a PNG jsPDF can place: { data, ratio } (ratio = width / height), or null when there's no logo
 * or it can't be loaded (the PDF is then made without it).
 */
export async function loadLogo(url) {
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = sizedImage(url, 160, { format: 'origin' });
    // Never hold up the PDF for a logo that is slow or won't load.
    await Promise.race([img.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('logo timed out')), 5000))]);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { data: canvas.toDataURL('image/png'), ratio: img.naturalWidth / img.naturalHeight };
  } catch {
    return null;
  }
}

const money = (n) => `$${Number(n).toFixed(2)}`;
export const day = (iso, opts = { month: 'short', day: 'numeric' }) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts) : '');

/**
 * @param {object} o
 * @param {{ shop_name: string, colors?: object, phone?: string }} o.shop
 * @param {string} o.customerName
 * @param {string} [o.customerPhone]  printed on the right of the name line
 * @param {Array}  o.lines    pull-list lines: { quantity, status, arrived_on, item: { title, issue_number, variant, publisher, price, release_date } }
 * @param {Array}  [o.follows] the customer's subscriptions { kind, key }: their series follows set the discount
 * @param {number} o.holdDays
 * @param {string} o.today    YYYY-MM-DD in shop time
 * @param {string} [o.lastUpdated] e.g. "Last updated Thu, Oct 1, 6:43 PM by Jane Smith (customer)"
 * @returns {{ count: number }} titles drawn
 */
/**
 * What a pull-list PDF prints: everything ready for pickup, plus the customer's next FOC list, meaning the
 * not-yet-arrived titles whose FOC date is the soonest one that hasn't passed. Later FOC dates, titles with
 * no FOC date, and titles already ordered (their FOC has gone by) are left off.
 */
export function selectPullListLines(lines, today) {
  const hold = (l) => l.item && ['open', 'ordered', 'reordered', 'arrived'].includes(l.status);
  const byRelease = (a, b) => (a.item.release_date ?? '9').localeCompare(b.item.release_date ?? '9') || itemTitle(a.item).localeCompare(itemTitle(b.item)) || (a.item.variant ?? '').localeCompare(b.item.variant ?? '');
  const live = lines.filter(hold);
  const ready = live.filter((l) => l.status === 'arrived').sort(byRelease);
  const pending = live.filter((l) => l.status !== 'arrived' && l.item.foc_date && l.item.foc_date >= today);
  const nextFoc = pending.map((l) => l.item.foc_date).sort()[0];
  const coming = pending.filter((l) => l.item.foc_date === nextFoc).sort(byRelease);
  return { ready, coming, printed: [...ready, ...coming] };
}

function drawPullList(doc, { shop, customerName, customerPhone = '', lines, follows = [], holdDays = 30, today, lastUpdated = '', logo = null }) {
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const primary = rgb(shop.colors?.primary, 'c8102e');
  const ink = [22, 22, 22];
  const grey = [110, 110, 110];

  const hold = (l) => holdUntil(l.arrived_on, holdDays);
  const { ready, coming, printed } = selectPullListLines(lines, today);

  // Header
  doc.setFillColor(...primary);
  doc.rect(0, 0, W, 54, 'F');
  // The logo sits on a white tile so it reads on any header color.
  let nameX = M;
  if (logo) {
    const tile = 42;
    const fit = tile - 8;
    const w = logo.ratio >= 1 ? fit : fit * logo.ratio;
    const h = logo.ratio >= 1 ? fit / logo.ratio : fit;
    doc.setFillColor(255, 255, 255).roundedRect(M, 6, tile, tile, 6, 6, 'F');
    doc.addImage(logo.data, 'PNG', M + (tile - w) / 2, 6 + (tile - h) / 2, w, h);
    nameX = M + tile + 12;
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold').setFontSize(18).text(clean(shop.shop_name), nameX, 34);
  doc.setFont('helvetica', 'normal').setFontSize(10).text(`Prepared ${day(today, { month: 'long', day: 'numeric', year: 'numeric' })}`, W - M, 34, { align: 'right' });

  doc.setTextColor(...grey).setFont('helvetica', 'bold').setFontSize(10).text('PULL LIST', M, 90);
  // Name on the left, phone on the right of the same line; a long name shrinks rather than running into the phone.
  const phone = clean(formatPhone(customerPhone));
  doc.setFont('helvetica', 'normal').setFontSize(14);
  const phoneW = phone ? doc.getTextWidth(phone) + 16 : 0;
  const name = clean(customerName || 'Customer');
  let nameSize = 24;
  doc.setFont('helvetica', 'bold').setFontSize(nameSize);
  while (nameSize > 14 && doc.getTextWidth(name) > W - 2 * M - phoneW) doc.setFontSize(--nameSize);
  doc.setTextColor(...ink).text(name, M, 114);
  // If even the smallest name size would touch the phone, the phone drops to the line below instead.
  const phoneY = doc.getTextWidth(name) > W - 2 * M - phoneW ? 132 : 114;
  if (phone) doc.setTextColor(...ink).setFont('helvetica', 'normal').setFontSize(14).text(phone, W - M, phoneY, { align: 'right' });

  if (lastUpdated) doc.setTextColor(...grey).setFont('helvetica', 'normal').setFontSize(9).text(clean(lastUpdated), M, 130);

  let y = lastUpdated ? 144 : 134;
  const H = doc.internal.pageSize.getHeight();
  /** Start a new page if there isn't room for `need` more points, so a heading isn't stranded at the bottom. */
  const room = (need) => {
    if (y > H - need) {
      doc.addPage();
      y = M;
    }
  };
  /** One table of titles from `startY`; returns where it ends. */
  const grid = (startY, rows, dateLabel, dateOf) => {
    doc.autoTable({
      startY,
      margin: { left: M, right: M, bottom: 50 },
      head: [['Title', 'Cover', 'Publisher', 'Qty', 'Price', dateLabel]],
      body: rows.map((l) => [clean(itemTitle(l.item)), clean(l.item.variant ?? ''), clean(l.item.publisher ?? ''), String(l.quantity), l.item.price != null ? money(l.item.price) : '', dateOf(l)]),
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 5, bottom: 5, left: 5, right: 5 }, textColor: ink, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: primary, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 244, 237] },
      columnStyles: {
        0: { cellWidth: 150, fontStyle: 'bold' },
        1: { cellWidth: 130, textColor: grey },
        2: { cellWidth: 64 },
        3: { cellWidth: 28, halign: 'center' },
        4: { cellWidth: 44, halign: 'right' },
        5: { cellWidth: 'auto', halign: 'right' },
      },
      // Headers line up with their columns (autoTable only aligns body cells from columnStyles).
      didParseCell: (d) => {
        if (d.section === 'head') d.cell.styles.halign = { 3: 'center', 4: 'right', 5: 'right' }[d.column.index] ?? 'left';
      },
      rowPageBreak: 'avoid',
    });
    return doc.lastAutoTable.finalY;
  };
  /** `groupOf(line)` → [sort key, label]: when given, the titles are split into a sub-table per group, in key order. */
  const table = (heading, rows, dateLabel, dateOf, groupOf) => {
    if (!rows.length) return;
    room(150);
    doc.setTextColor(...primary).setFont('helvetica', 'bold').setFontSize(13).text(`${heading} (${rows.length})`, M, y + 14);
    if (!groupOf) {
      y = grid(y + 22, rows, dateLabel, dateOf) + 18;
      return;
    }
    y += 22;
    const groups = new Map();
    for (const l of rows) {
      const [key, label] = groupOf(l);
      groups.set(key, { label, rows: [...(groups.get(key)?.rows ?? []), l] });
    }
    for (const [, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      room(120);
      doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(10.5).text(`${g.label} (${g.rows.length})`, M, y + 10);
      y = grid(y + 16, g.rows, dateLabel, dateOf) + 12;
    }
    y += 6;
  };

  table('Ready for pickup', ready, 'Hold until', (l) => day(hold(l)));
  // Titles still to arrive are split by their FOC (final order cutoff) date, soonest first; titles with no date come last.
  const focGroup = (l) => {
    const foc = l.item.foc_date;
    return foc ? [foc, `FOC ${day(foc, { weekday: 'short', month: 'short', day: 'numeric' })}`] : ['9999', 'No FOC date'];
  };
  table('Coming up', coming, 'Out', (l) => day(l.item.release_date) || 'TBA', focGroup);

  if (!ready.length && !coming.length) {
    doc.setTextColor(...grey).setFont('helvetica', 'normal').setFontSize(12).text('Nothing ready for pickup and nothing due at the next FOC.', M, y + 14);
  } else {
    // Totals are per group (ready for pickup, then each FOC date), not one order total.
    const groups = [['Ready for pickup', ready]];
    const byFoc = new Map();
    for (const l of coming) byFoc.set(focGroup(l)[1], [...(byFoc.get(focGroup(l)[1]) ?? []), l]);
    groups.push(...byFoc);
    const shownGroups = groups.filter(([, ls]) => ls.length);
    const priced = printed.filter((l) => l.item.price != null);
    // The pull-list discount is set by the series the customer follows, not by what's on the list.
    const seriesN = followedSeries(follows);
    const tiers = tiersFrom(shop);
    const { pct } = discountFor(seriesN, tiers);
    if (y > doc.internal.pageSize.getHeight() - (72 + shownGroups.length * 16)) {
      doc.addPage();
      y = M;
    }
    doc.setDrawColor(...primary).setLineWidth(1).line(M, y, W - M, y);
    let rowY = y + 18;
    for (const [label, ls] of shownGroups) {
      const copies = ls.reduce((n, l) => n + l.quantity, 0);
      doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(11).text(`${label} total`, M, rowY);
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...grey).text(`${ls.length} ${ls.length === 1 ? 'title' : 'titles'} · ${copies} ${copies === 1 ? 'copy' : 'copies'}`, M + 210, rowY);
      doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(11).text(money(totals(ls, pct).total), W - M, rowY, { align: 'right' });
      rowY += 16;
    }
    doc.setTextColor(...grey).setFont('helvetica', 'normal').setFontSize(8.5);
    // While the discount program is on, every printout says the shop can adjust it at the register.
    const note = `Based on cover prices${pct ? `, less ${pct}% pull list discount (${seriesN} series followed)` : ''}${priced.length < printed.length ? ` (${printed.length - priced.length} without a price are not counted)` : ''}; tax not included. Pay at pickup.${tiers.length ? ` ${clean(shop.shop_name) || 'The shop'} reserves the right to adjust or remove pull list discounts based on actual purchases.` : ''}`;
    doc.text(doc.splitTextToSize(note, W - 2 * M), M, rowY + 2);
  }

  return { count: printed.length };
}

/** Footer on every page: shop details, and "Page n of m" within each customer's own pages. */
function addFooters(doc, shop, ranges) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  for (const [from, to] of ranges) {
    for (let p = from; p <= to; p++) {
      doc.setPage(p);
      doc.setTextColor(110, 110, 110).setFont('helvetica', 'normal').setFontSize(8.5);
      doc.text(clean([new URL(SITE_URL).host, formatPhone(shop.phone)].filter(Boolean).join(' · ')), M, H - 24);
      doc.text(`Page ${p - from + 1} of ${to - from + 1}`, W - M, H - 24, { align: 'right' });
    }
  }
}

/** One customer's pull list as a PDF (options as above). */
export async function buildPullListPdf(opts) {
  const PDF = await jsPDF();
  const doc = new PDF({ unit: 'pt', format: 'letter' });
  const { count } = drawPullList(doc, { ...opts, logo: opts.logo ?? (await loadLogo(opts.shop.logo_url)) });
  addFooters(doc, opts.shop, [[1, doc.getNumberOfPages()]]);
  return { blob: doc.output('blob'), save: (name) => doc.save(name), count };
}

/**
 * Everyone's pull list in one PDF, each customer starting on a new page (to print and put in their bag).
 * Customers with nothing on their list are left out.
 * @param {object} o
 * @param {Array}  o.customers  in print order: { name, phone, lines, follows } (as for buildPullListPdf)
 * @returns {Promise<{ blob: Blob, save: (name: string) => void, customers: number, titles: number }>}
 */
export async function buildAllPullListsPdf(opts) {
  const { shop, customers, holdDays = 30, today } = opts;
  const PDF = await jsPDF();
  const doc = new PDF({ unit: 'pt', format: 'letter' });
  const logo = opts.logo ?? (await loadLogo(shop.logo_url));
  const ranges = [];
  let titles = 0;
  for (const c of customers) {
    if (!selectPullListLines(c.lines, today).printed.length) continue;
    if (ranges.length) doc.addPage();
    const from = doc.getNumberOfPages();
    titles += drawPullList(doc, { shop, customerName: c.name, customerPhone: c.phone, lines: c.lines, follows: c.follows, holdDays, today, logo }).count;
    ranges.push([from, doc.getNumberOfPages()]);
  }
  addFooters(doc, shop, ranges);
  return { blob: doc.output('blob'), save: (name) => doc.save(name), customers: ranges.length, titles };
}

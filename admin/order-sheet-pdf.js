// The distributor order sheet as a printable PDF: titles and copy counts to order, one section
// per distributor, with the product code to key into the distributor's ordering site.

import { jsPDF, clean, rgb, day } from './pull-list-pdf.js';

/**
 * @param {object} o
 * @param {{ shop_name: string, colors?: object }} o.shop
 * @param {string} o.subtitle   e.g. "Cutoff Mon, Oct 12 · Lunar"
 * @param {string} o.today      YYYY-MM-DD
 * @param {Array<{ name: string, rows: Array<{ code: string, title: string, variant: string, publisher: string, price: number|null, release: string, copies: number, customers?: number, store?: number }> }>} o.groups
 *   With store set (Place Order), the sheet adds Cust and Store columns before Qty, their total.
 */
export async function buildOrderSheetPdf({ shop, subtitle, today, groups }) {
  const PDF = await jsPDF();
  const doc = new PDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const primary = rgb(shop.colors?.primary, 'c8102e');
  const ink = [22, 22, 22];
  const grey = [110, 110, 110];

  doc.setFillColor(...primary);
  doc.rect(0, 0, W, 54, 'F');
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(18).text(clean(shop.shop_name), M, 34);
  doc.setFont('helvetica', 'normal').setFontSize(10).text(`Prepared ${day(today, { month: 'long', day: 'numeric', year: 'numeric' })}`, W - M, 34, { align: 'right' });
  doc.setTextColor(...grey).setFont('helvetica', 'bold').setFontSize(10).text('DISTRIBUTOR ORDER', M, 90);
  doc.setTextColor(...ink).setFontSize(20).text(clean(subtitle), M, 112);

  // Place Order's rows carry customer and store copies (Qty is their total); the Re-order sheet's rows don't.
  const split = groups.some((g) => g.rows.some((r) => r.store != null));
  const qty = split ? 8 : 6;
  let y = 130;
  let grandTitles = 0;
  let grandCopies = 0;
  for (const g of groups) {
    const copies = g.rows.reduce((n, r) => n + r.copies, 0);
    grandTitles += g.rows.length;
    grandCopies += copies;
    if (y > H - 150) {
      doc.addPage();
      y = M;
    }
    doc.setTextColor(...primary).setFont('helvetica', 'bold').setFontSize(13).text(`${clean(g.name)} - ${g.rows.length} ${g.rows.length === 1 ? 'title' : 'titles'}, ${copies} ${copies === 1 ? 'copy' : 'copies'}`, M, y + 14);
    doc.autoTable({
      startY: y + 22,
      margin: { left: M, right: M, bottom: 50 },
      head: [['Code', 'Title', 'Cover', 'Publisher', 'Price', 'Out', ...(split ? ['Cust', 'Store'] : []), 'Qty']],
      body: g.rows.map((r) => [clean(r.code), clean(r.title), clean(r.variant), clean(r.publisher), r.price != null ? `$${Number(r.price).toFixed(2)}` : '', day(r.release), ...(split ? [String(r.customers ?? 0), String(r.store ?? 0)] : []), String(r.copies)]),
      foot: [['', '', '', '', '', 'Total', ...(split ? [String(g.rows.reduce((n, r) => n + (r.customers ?? 0), 0)), String(g.rows.reduce((n, r) => n + (r.store ?? 0), 0))] : []), String(copies)]],
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: ink, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: primary, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 236, 226], textColor: ink, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 244, 237] },
      showFoot: 'lastPage',
      columnStyles: {
        0: { cellWidth: 84, font: 'courier' },
        1: { cellWidth: 138, fontStyle: 'bold' },
        2: { cellWidth: split ? 74 : 108, textColor: grey },
        3: { cellWidth: 58 },
        4: { cellWidth: 40, halign: 'right' },
        5: { cellWidth: 38, halign: 'right' },
        ...(split ? { 6: { cellWidth: 34, halign: 'center' }, 7: { cellWidth: 34, halign: 'center' } } : {}),
        [qty]: { cellWidth: 'auto', halign: 'center', fontStyle: 'bold' },
      },
      didParseCell: (d) => {
        const i = d.column.index;
        if (d.section === 'head') d.cell.styles.halign = i === 4 || i === 5 ? 'right' : i > 5 ? 'center' : 'left';
        if (d.section === 'foot') d.cell.styles.halign = i === 5 ? 'right' : i > 5 ? 'center' : 'left';
      },
      rowPageBreak: 'avoid',
    });
    y = doc.lastAutoTable.finalY + 22;
  }

  if (groups.length > 1) {
    if (y > H - 80) {
      doc.addPage();
      y = M;
    }
    doc.setDrawColor(...primary).setLineWidth(1).line(M, y, W - M, y);
    doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(11);
    doc.text(`All distributors: ${grandTitles} ${grandTitles === 1 ? 'title' : 'titles'}, ${grandCopies} ${grandCopies === 1 ? 'copy' : 'copies'}`, M, y + 18);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setTextColor(...grey).setFont('helvetica', 'normal').setFontSize(8.5);
    doc.text(split ? 'Qty is customer reservations plus the store’s own copies (Store Order).' : 'Customer reservations only: add any extra copies for the shop shelf before ordering.', M, H - 24);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 24, { align: 'right' });
  }
  return { save: (name) => doc.save(name), blob: doc.output('blob'), titles: grandTitles, copies: grandCopies };
}

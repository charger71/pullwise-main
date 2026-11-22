// Import → Left Out (master catalog only): the titles the daily PRH and Lunar imports didn't take into the catalog,
// and why, as the latest run of each saw them (import_left_out, filled by tools/*-auto-import.mjs through
// js/import/left-out.js). Filter by words, distributor and reason; export what's shown as a CSV.

import { $, esc, must, fmtDate, debounce, downloadCsv, toListTop, sortableTable, friendlyError } from '../lib.js';
import { filterLeftOut, reasonChoices } from '../../js/import/left-out.js';

const SOURCE = { prh: 'PRH', lunar: 'Lunar' };
const PAGE = 50;
const DB_PAGE = 1000; // PostgREST's most rows per request

/** Every row, a thousand at a time. */
async function loadAll(sb) {
  const rows = [];
  for (let from = 0; ; from += DB_PAGE) {
    const page = await must(sb.from('import_left_out').select('source,sku,title,reason,detail,seen_at').order('title').order('sku').range(from, from + DB_PAGE - 1));
    rows.push(...page);
    if (page.length < DB_PAGE) return rows;
  }
}

const rowHtml = (r) => `<tr>
  <td class="card-title"><strong>${esc(r.title)}</strong></td>
  <td class="card-wide">${esc(r.reason)}${r.detail ? `<br><span class="card__meta">${esc(r.detail)}</span>` : ''}</td>
  <td class="card-line card-label">${esc(SOURCE[r.source] ?? r.source)}</td>
  <td class="nowrap card-line card-label">${esc(r.sku)}</td>
  <td class="card__meta nowrap card-line card-label">${esc(fmtDate(r.seen_at))}</td>
</tr>`;

export async function mountLeftOut(box, { sb }) {
  box.innerHTML = `
    <form class="filters admin-filters" role="search" aria-label="Find left-out titles" data-left-filters>
      <div class="field field--search"><label for="lo-q">Title or code</label><input id="lo-q" name="q" type="search" placeholder="e.g. Ben 10 or 75960621443301021"></div>
      <div class="field"><label for="lo-source">From</label><select id="lo-source" name="source"><option value="">PRH and Lunar</option><option value="prh">PRH</option><option value="lunar">Lunar</option></select></div>
      <div class="field"><label for="lo-reason">Why</label><select id="lo-reason" name="reason"><option value="">Any reason</option></select></div>
      <div class="field"><button class="btn btn--ghost" type="button" data-left-export>Export CSV</button></div>
    </form>
    <p class="results-count" role="status" data-left-count>Loading…</p>
    <div class="admin-table-wrap" data-loading><table class="admin-table cards">
      <thead><tr><th scope="col" data-sort="title">Title</th><th scope="col" data-sort="reason">Why</th><th scope="col" data-sort="source">From</th><th scope="col" data-sort="sku">Code</th><th scope="col" data-sort="seen_at" data-first="desc">Seen</th></tr></thead>
      <tbody data-left-rows></tbody>
    </table></div>
    <div class="admin-pager" hidden><button class="btn btn--ghost" type="button" data-prev>← Previous</button><span data-page></span><button class="btn btn--ghost" type="button" data-next>Next →</button></div>`;

  const form = $('[data-left-filters]', box);
  const count = $('[data-left-count]', box);
  const wrap = $('.admin-table-wrap', box);
  const tbody = $('[data-left-rows]', box);
  const pager = $('.admin-pager', box);
  let rows = [];
  let shown = [];
  let page = 0;
  let order = { key: 'title', dir: 'asc' };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // Sorting orders the whole filtered list, not just the page on screen, and a new filter keeps the sort.
  const sort = () => {
    const { key, dir } = order;
    shown.sort((a, b) => (dir === 'asc' ? 1 : -1) * collator.compare(String(a[key] ?? ''), String(b[key] ?? '')));
  };

  const draw = () => {
    const pages = Math.ceil(shown.length / PAGE);
    page = Math.min(page, Math.max(0, pages - 1));
    const start = page * PAGE;
    tbody.innerHTML = shown.slice(start, start + PAGE).map(rowHtml).join('');
    pager.hidden = pages < 2;
    $('[data-page]', pager).textContent = shown.length ? `${start + 1}–${Math.min(start + PAGE, shown.length)} of ${shown.length.toLocaleString()}` : '';
    $('[data-prev]', pager).disabled = page === 0;
    $('[data-next]', pager).disabled = page >= pages - 1;
  };
  const apply = () => {
    const f = Object.fromEntries(new FormData(form));
    shown = filterLeftOut(rows, f);
    sort();
    page = 0;
    const filtered = f.q || f.source || f.reason;
    count.textContent = !rows.length
      ? 'Nothing left out yet. The list fills in after the next daily PRH or Lunar import.'
      : `${shown.length.toLocaleString()} ${shown.length === 1 ? 'title' : 'titles'}${filtered ? ` of ${rows.length.toLocaleString()}` : ''} left out`;
    draw();
  };

  form.addEventListener('input', debounce(apply, 200));
  form.addEventListener('submit', (e) => e.preventDefault());
  const turn = (step) => ((page += step), toListTop(count), draw());
  $('[data-prev]', pager).addEventListener('click', () => turn(-1));
  $('[data-next]', pager).addEventListener('click', () => turn(1));
  sortableTable($('table', box), {
    sort: order.key,
    dir: order.dir,
    onSort: (key, dir) => {
      order = { key, dir };
      sort();
      page = 0;
      draw();
    },
  });
  $('[data-left-export]', box).addEventListener('click', () =>
    downloadCsv('left-out-of-catalog.csv', ['Title', 'Why', 'Detail', 'From', 'Code', 'Seen'], shown.map((r) => [r.title, r.reason, r.detail ?? '', SOURCE[r.source] ?? r.source, r.sku, (r.seen_at ?? '').slice(0, 10)]), { textColumns: ['Code'] }),
  );

  try {
    rows = await loadAll(sb);
    $('#lo-reason', box).insertAdjacentHTML('beforeend', reasonChoices(rows).map(({ reason, n }) => `<option value="${esc(reason)}">${esc(reason)} (${n.toLocaleString()})</option>`).join(''));
    apply();
  } catch (err) {
    count.textContent = `Couldn’t load the list: ${friendlyError(err)}`;
  } finally {
    delete wrap.dataset.loading;
  }
}

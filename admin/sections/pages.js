// Pages: a sortable list of every page (switch the optional ones off), and each page's intro (lede) and, for the
// longer pages, body text. #pages is the list; #pages/<key> opens one page.

import { PAGE_BLOCKS } from '../../js/page-defaults.js';
import { PLACEHOLDERS } from '../../js/content.js';
import { OPTIONAL_PAGES } from '../../js/optional-pages.js';
import { $, esc, must, hintFold, setStatus, makeEditor, setHtml, getHtml, toast, solidIcon, friendlyError, setupTabs, fmtTime, fmtDateTime, sortableTable, switchHtml } from '../lib.js';
import { adminHash } from '../route.js';

// Where each block shows on the public site, for the "View page" link.
const PAGE_URLS = {
  home: 'index.html', 'home-preorders': 'index.html', 'home-funko': 'index.html',
  'pre-orders': 'pre-orders.html', 'new-arrivals': 'new-arrivals.html', calendar: 'calendar.html', news: 'blog.html',
  about: 'about.html', visit: 'contact.html', 'we-buy-comics': 'we-buy-comics.html', 'gift-cards': 'gift-cards.html', faq: 'faq.html', 'how-to': 'how-to.html',
  privacy: 'privacy.html', terms: 'terms.html',
};

// One admin screen per page; blocks sharing a `group` (the homepage sections) edit together.
// Pages staff added (the `custom` rows) follow the built-in ones.
let SCREENS = [];
function buildScreens(customRows) {
  SCREENS = [];
  for (const b of [...PAGE_BLOCKS, ...customRows.map((r) => ({ slug: r.slug, label: r.title || r.slug, fields: ['lede', 'body'], custom: true }))]) {
    const key = b.group ?? b.slug;
    let screen = SCREENS.find((s) => s.key === key);
    if (!screen) SCREENS.push((screen = { key, label: b.group ?? b.label, blocks: [], custom: !!b.custom }));
    screen.blocks.push(b);
  }
}
const slugify = (t) => t.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

let dirty = false;
let editors = {};
let isOwner = false;
let disabled = []; // settings.disabled_pages: the slugs of pages switched off
export const hasUnsavedChanges = () => dirty;

// Where each built-in page is linked from on the site (js/site.js NAV and FOOTER_LINKS).
const MENU = ['pre-orders', 'new-arrivals', 'we-buy-comics', 'calendar', 'news', 'visit'];
const PLACES = { menu: 'Main menu', footer: 'Footer', hidden: 'Not linked' };
const linkedFrom = (screen) => {
  if (screen.custom) return PLACES[screen.place] ?? 'Footer';
  if (screen.key === 'Home') return 'Home page';
  return MENU.includes(screen.blocks[0].slug) ? 'Main menu' : 'Footer';
};
// Built-in pages the shop can switch off (js/optional-pages.js); staff-made pages always can.
const canSwitch = (screen) => screen.custom || !!OPTIONAL_PAGES[screen.blocks[0].slug];
const isOn = (screen) => !disabled.includes(screen.blocks[0].slug);

export async function mount(el, { sb, isOwner: owner, arg }) {
  dirty = false;
  isOwner = owner;
  let custom = [];
  try {
    custom = await must(sb.from('pages').select('slug,title,placement').eq('custom', true).order('sort').order('title'));
  } catch (err) {
    console.error(err); // before the custom-pages migration is applied
  }
  buildScreens(custom);
  for (const r of custom) screenOf(r.slug).place = r.placement;
  disabled = (await sb.from('settings').select('disabled_pages').eq('id', 1).maybeSingle()).data?.disabled_pages ?? [];
  if (arg && screenOf(arg)) return showEditor(el, sb, arg);
  await showList(el, sb);
}

// The list of every page: sortable, with an on/off switch where the page can be switched off.
async function showList(el, sb) {
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Pages</h1>
      <button class="btn btn--add" type="button" id="page-new">${solidIcon('add', 18)} New page</button>
    </div>
    ${hintFold('Every page on the website. Sort by any column, and press Edit to change a page’s text. Switch a page off to take it off the site: its links leave the menu, footer and search, and its address shows “page not found”. Its text is kept for when you switch it back on. Home, Pre-Orders, New Arrivals, Calendar, News, Privacy and Terms are always on, because the shop runs on them.')}
    <div data-list><p class="card__meta">Loading the pages…</p></div>`;
  $('#page-new', el).addEventListener('click', () => newPage(el, sb));
  let saved = {};
  try {
    const rows = await must(sb.from('pages').select('slug,updated_at'));
    for (const r of rows) {
      const key = screenOfSlug(r.slug)?.key;
      if (key && (!saved[key] || r.updated_at > saved[key])) saved[key] = r.updated_at;
    }
  } catch {
    // the dates are a nicety; the list works without them
  }
  const list = $('[data-list]', el);
  list.innerHTML = `<table class="admin-table cards">
    <thead><tr><th scope="col" data-sort="text">Page</th><th scope="col" data-sort="text">Linked from</th><th scope="col" data-sort="text" data-first="desc">Last saved</th><th scope="col" data-sort="text">On the site</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead>
    <tbody>${SCREENS.map((sc) => `<tr>
      <td class="card-title"><strong>${esc(sc.label)}</strong>${sc.custom ? ' <span class="pill pill--accent">Added</span>' : ''}</td>
      <td class="card__meta card-line card-label">${esc(linkedFrom(sc))}</td>
      <td class="card__meta nowrap card-line card-label" data-sort="${saved[sc.key] ?? ''}">${saved[sc.key] ? esc(fmtDateTime(saved[sc.key])) : '—'}</td>
      <td class="card-wide" data-sort="${isOn(sc) ? 'on' : 'off'}">${canSwitch(sc)
        ? switchHtml(isOn(sc) ? 'On' : 'Off', { checked: isOn(sc), attrs: `data-switch="${esc(sc.blocks[0].slug)}" aria-label="${esc(sc.label)} on the site"` })
        : '<span class="card__meta">Always on</span>'}</td>
      <td class="nowrap card-foot"><a class="btn btn--ghost btn--small" href="${adminHash('pages', sc.key)}">${solidIcon('edit', 16)} Edit<span class="visually-hidden"> ${esc(sc.label)}</span></a></td>
    </tr>`).join('')}</tbody>
  </table>`;
  sortableTable($('table', list));
  list.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-switch]');
    if (!box) return;
    const slug = box.dataset.switch;
    const next = box.checked ? disabled.filter((x) => x !== slug) : [...new Set([...disabled, slug])];
    box.disabled = true;
    try {
      await must(sb.from('settings').update({ disabled_pages: next }).eq('id', 1));
      disabled = next;
      box.closest('td').dataset.sort = box.checked ? 'on' : 'off';
      box.closest('.switch').querySelector('.switch__text').textContent = box.checked ? 'On' : 'Off';
      toast(`${screenOfSlug(slug).label} is ${box.checked ? 'back on the site' : 'off the site'}.`, 'ok');
    } catch (err) {
      box.checked = !box.checked;
      toast(`Couldn’t change it: ${friendlyError(err)}`, 'error');
    }
    box.disabled = false;
  });
}

async function newPage(el, sb) {
  const title = prompt('Name of the new page:', '')?.trim();
  if (!title) return;
  const slug = slugify(title);
  if (!slug) return toast('Use some letters or numbers in the name.', 'error');
  try {
    if (screenOf(slug) || PAGE_BLOCKS.some((b) => b.slug === slug) || (await must(sb.from('pages').select('slug').eq('slug', slug).maybeSingle()))) {
      return toast('There’s already a page with that name.', 'error');
    }
    await must(sb.from('pages').insert({ slug, title, custom: true, placement: 'footer' }));
  } catch (err) {
    return toast(`Couldn’t create the page: ${friendlyError(err)}`, 'error');
  }
  location.hash = adminHash('pages', slug);
}

// One page's text, Google fields and (for pages staff added) its settings.
async function showEditor(el, sb, key) {
  const screen = screenOf(key);
  el.innerHTML = `
    <p><a class="btn btn--ghost btn--small" href="${adminHash('pages')}" data-back>← All pages</a></p>
    <div class="admin-title-row">
      <h1>${esc(screen.label)}</h1>
      <div class="admin-actions">
        <a id="page-view" class="btn btn--ghost" target="_blank" rel="noopener">View page ↗</a>
        ${screen.custom && isOwner ? `<button class="btn btn--danger" type="button" id="page-delete">${solidIcon('trash', 16)} Delete</button>` : ''}
      </div>
    </div>
    ${hintFold(`Placeholders are filled in from shop settings: ${PLACEHOLDERS.map((p) => `<code>{${p}}</code>`).join(' ')}. The <strong>quote</strong> button makes a highlighted callout box.`)}
    <div id="page-editors"></div>
    <div class="admin-actions sticky-actions">
      <button class="btn btn--primary" type="button" id="page-save">Save</button>
      <span class="admin-status" id="page-status" role="status"></span>
    </div>`;
  $('#page-delete', el)?.addEventListener('click', async () => {
    if (!confirm(`Delete “${screen.label}”? Its text is removed for good and the page stops working.`)) return;
    try {
      await must(sb.from('pages').delete().eq('slug', screen.blocks[0].slug));
      if (disabled.includes(screen.blocks[0].slug)) await sb.from('settings').update({ disabled_pages: disabled.filter((x) => x !== screen.blocks[0].slug) }).eq('id', 1);
    } catch (err) {
      return toast(`Couldn’t delete: ${friendlyError(err)}`, 'error');
    }
    dirty = false;
    location.hash = adminHash('pages');
  });
  $('#page-save', el).addEventListener('click', () => save(el, sb, key));
  await load(el, sb, key);
}

const screenOf = (key) => SCREENS.find((s) => s.key === key);
const screenOfSlug = (slug) => SCREENS.find((s) => s.blocks.some((b) => b.slug === slug));
// Home’s sections (Funko Pops etc.) have no page title of their own; only the page-level block does.
const hasSeo = (block, screen) => screen.blocks.length === 1 || !block.fields.length;

async function load(el, sb, key) {
  const screen = screenOf(key);
  const status = $('#page-status', el);
  setStatus(status, '');
  const first = screen.blocks[0];
  $('#page-view', el).href = screen.custom ? `../page.html?slug=${encodeURIComponent(first.slug)}` : `../${PAGE_URLS[first.slug]}`;
  let rows;
  try {
    rows = await must(sb.from('pages').select('slug,title,placement,lede_html,body_html,meta_title,meta_description,updated_at').in('slug', screen.blocks.map((b) => b.slug)));
  } catch (err) {
    return setStatus(status, `Couldn’t load: ${friendlyError(err)}`, 'error');
  }
  const wrap = $('#page-editors', el);
  const multi = screen.blocks.length > 1;
  const seoHtml = (block, row) => `
      <div class="field"><label for="seo-title">Page title</label>
        <input id="seo-title" maxlength="120" value="${esc(row?.meta_title)}" placeholder="Leave blank to use the standard title">
        <p class="field__hint">Shown in the browser tab and as the headline in Google results. The shop name is added in front, followed by an em dash (“Shop name — Your title”), so leave it out. Aim for about 60 characters. Live on the site about a minute after you save. <span data-count="seo-title"></span></p></div>
      <div class="field"><label for="seo-desc">Description</label>
        <textarea id="seo-desc" rows="3" maxlength="320" placeholder="Leave blank to use the standard description">${esc(row?.meta_description)}</textarea>
        <p class="field__hint">The summary under your link in Google results. Aim for 120–155 characters. <span data-count="seo-desc"></span></p></div>
    `;
  const settingsHtml = () => {
    const row = rows.find((r) => r.slug === first.slug);
    const place = row?.placement ?? 'footer';
    return `
      <div class="field"><label for="cp-title">Page name <span class="req" aria-hidden="true">*</span></label>
        <input id="cp-title" maxlength="80" required value="${esc(row?.title)}">
        <p class="field__hint">The heading on the page and the text of its link.</p></div>
      <div class="field"><label for="cp-slug">Page address <span class="req" aria-hidden="true">*</span></label>
        <input id="cp-slug" maxlength="60" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${esc(first.slug)}">
        <p class="field__hint">The page lives at <code>page.html?slug=<span data-slug-preview>${esc(first.slug)}</span></code>. Lowercase letters, numbers and dashes. Changing it breaks any link or printed QR code that still uses the old address, so only change it if you haven’t shared the page yet (menu and footer links update by themselves).</p></div>
      <div class="field"><label for="cp-place">Link from</label>
        <select id="cp-place">${[['footer', 'The footer (More)'], ['menu', 'The main menu'], ['hidden', 'Nowhere — share the address yourself']]
          .map(([v, l]) => `<option value="${v}"${v === place ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    `;
  };
  // Collapsible sections (the first one open): page settings, each block's text, and the Google & browser tab fields.
  const panels = screen.custom ? [{ title: 'Page Settings', html: settingsHtml() }] : [];
  for (const block of screen.blocks) {
    const row = rows.find((r) => r.slug === block.slug);
    const fields = block.fields
      .map(
        (f) => `<div class="editor-block">
        <span class="label" id="lbl-${block.slug}-${f}">${f === 'lede' ? (multi ? 'Intro text' : 'Intro (lede)') : (multi ? 'Text' : 'Body text')}</span>
        <p class="editor-block__hint">${f === 'lede' ? (multi ? 'The short text under this section’s heading.' : 'The short introduction under the page heading.') : (multi ? 'A free-form text area on the homepage. Leave it empty to hide it.' : 'The main content of the page.')}</p>
        <div class="editor--${f}"><div data-field="${block.slug}:${f}"></div></div>
      </div>`,
      )
      .join('');
    if (fields) {
      // Homepage sections share two tabs: the free-form text areas, and the short intros under each shelf's heading.
      const title = !multi ? 'Page Text' : block.fields.includes('body') ? 'Page Text' : 'Shelf Intros';
      const html = multi ? `<h3>${esc(block.label)}</h3>${fields}` : fields;
      const have = panels.find((p) => p.title === title);
      if (have) have.html += html;
      else panels.push({ title, html });
    }
    if (hasSeo(block, screen) && !(multi && fields)) panels.push({ title: 'Google & Browser Tab', html: seoHtml(block, row) });
  }
  // One tab per section (page settings, each block's text, Google & browser tab); only shown when there is more than one.
  wrap.innerHTML = `${panels.length > 1 ? `<div class="admin-tabs" role="tablist">${panels.map((p, i) => `<button type="button" class="admin-tab" role="tab" data-tab="p${i}">${esc(p.title)}</button>`).join('')}</div>` : ''}${isOn(screen) ? '' : '<p class="admin-hint"><strong>This page is switched off.</strong> Customers can’t open it until you switch it back on in the <a href="#pages">list of pages</a>.</p>'}${panels
    .map((p, i) => `<div data-tabpane="p${i}"><section class="fold fold--compact fold--static"><div class="fold__head"><h2>${esc(p.title)}</h2></div><div class="fold__body">${p.html}</div></section></div>`)
    .join('')}`;
  for (const id of ['cp-title', 'cp-place']) $(`#${id}`, wrap)?.addEventListener('input', () => (dirty = true));
  $('#cp-slug', wrap)?.addEventListener('input', (e) => ($('[data-slug-preview]', wrap).textContent = e.target.value.trim() || '…'));
  for (const id of ['seo-title', 'seo-desc']) {
    const input = $(`#${id}`, wrap), out = $(`[data-count="${id}"]`, wrap);
    if (!input) continue;
    const update = () => (out.textContent = `(${input.value.length} characters)`);
    input.addEventListener('input', () => { dirty = true; update(); });
    update();
  }
  editors = {};
  for (const block of screen.blocks) {
    const row = rows.find((r) => r.slug === block.slug);
    for (const f of block.fields) {
      const quill = makeEditor($(`[data-field="${block.slug}:${f}"]`, wrap), f, $(`#lbl-${block.slug}-${f}`, wrap));
      setHtml(quill, row?.[`${f}_html`]);
      quill.on('text-change', () => (dirty = true));
      editors[`${block.slug}:${f}`] = quill;
    }
  }
  setupTabs(wrap, 'admin-pages-tab', 'p0');
  dirty = false;
  const saved = rows.map((r) => r.updated_at).filter(Boolean).sort().pop();
  if (saved) setStatus(status, `Last saved ${fmtDateTime(saved)}`);
}

async function save(el, sb, key) {
  const screen = screenOf(key);
  const status = $('#page-status', el);
  const button = $('#page-save', el);
  if (screen.custom && !$('#cp-title', el).value.trim()) {
    setStatus(status, 'Give the page a name first.', 'error');
    return false;
  }
  // A custom page's address can be changed: move the row to the new slug first, then save the text under it.
  let newSlug = screen.blocks[0].slug;
  if (screen.custom) {
    newSlug = $('#cp-slug', el).value.trim();
    if (!newSlug || slugify(newSlug) !== newSlug) {
      setStatus(status, 'The page address can only use lowercase letters, numbers and single dashes.', 'error');
      return false;
    }
    if (newSlug !== screen.blocks[0].slug) {
      try {
        if (PAGE_BLOCKS.some((b) => b.slug === newSlug) || (await must(sb.from('pages').select('slug').eq('slug', newSlug).maybeSingle()))) {
          setStatus(status, 'There’s already a page with that address.', 'error');
          return false;
        }
        await must(sb.from('pages').update({ slug: newSlug }).eq('slug', screen.blocks[0].slug));
        if (disabled.includes(screen.blocks[0].slug)) {
          disabled = disabled.map((x) => (x === screen.blocks[0].slug ? newSlug : x));
          await must(sb.from('settings').update({ disabled_pages: disabled }).eq('id', 1));
        }
        // The row is at the new address now, so this screen is too: if saving the text below fails, a retry
        // saves it under the new address instead of trying to move the page again ("already a page with that address").
        const block = screen.blocks[0];
        for (const f of block.fields) editors[`${newSlug}:${f}`] = editors[`${block.slug}:${f}`];
        block.slug = newSlug;
        $('#page-view', el).href = `../page.html?slug=${encodeURIComponent(newSlug)}`;
      } catch (err) {
        setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
        return false;
      }
    }
  }
  const rows = screen.blocks.map((block) => {
    const row = { slug: screen.custom ? newSlug : block.slug };
    for (const f of block.fields) row[`${f}_html`] = getHtml(editors[`${block.slug}:${f}`]);
    if (screen.custom) {
      row.title = $('#cp-title', el).value.trim();
      row.placement = $('#cp-place', el).value;
    }
    if (hasSeo(block, screen)) {
      row.meta_title = $('#seo-title', el).value.trim() || null;
      row.meta_description = $('#seo-desc', el).value.trim() || null;
    }
    return row;
  });
  button.disabled = true;
  setStatus(status, 'Saving…');
  try {
    await must(sb.from('pages').upsert(rows, { onConflict: 'slug' }));
    dirty = false;
    if (screen.custom && newSlug !== screen.key) {
      history.replaceState(null, '', adminHash('pages', newSlug));
      await mount(el, { sb, isOwner, arg: newSlug });
      setStatus($('#page-status', el), `Saved ${fmtTime()} — the page is now at page.html?slug=${newSlug}.`, 'ok');
      return true;
    }
    setStatus(status, `Saved ${fmtTime()} — page titles and descriptions are live on the site in about a minute.`, 'ok');
    return true;
  } catch (err) {
    setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    return false;
  } finally {
    button.disabled = false;
  }
}

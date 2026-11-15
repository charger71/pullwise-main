// The rich text editor (Quill, loaded globally by index.html): toolbars, the picture, table, gallery and columns tools,
// and reading and writing its HTML. Only the screens that edit page text load this file.

import { $, $$, uid, esc, toast, setStatus, solidIcon, openDialog, friendlyError } from './lib.js';
import { isLibraryFile, uploadImage, libraryFiles, libraryImages } from './images.js';

// Text and highlight colors staff can pick (kept small so pages stay on-brand).
const TEXT_COLORS = ['#161616', '#5b5b5b', '#c8102e', '#a4001d', '#16723a', '#1a5fff', '#7a3fb0', '#b35900'];
const HIGHLIGHTS = ['#ffd100', '#fff3b0', '#d9f5df', '#e3ecff', '#f1e3ff', '#ffe6cc', '#ffd6de', '#eeeeee'];

const TOOLBARS = {
  lede: [['bold', 'italic', 'underline', 'link'], [{ color: TEXT_COLORS }, { background: HIGHLIGHTS }], ['blockquote'], ['clean']],
  // One column of a Columns row: the body's tools without the blocks that make their own layout.
  cell: [[{ header: [2, 3, 4, false] }], ['bold', 'italic', 'underline'], ['link', 'file', 'image', 'video', 'divider'], [{ list: 'ordered' }, { list: 'bullet' }], [{ align: [] }], ['clean']],
  body: [
    [{ header: [2, 3, 4, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: TEXT_COLORS }, { background: HIGHLIGHTS }],
    ['link', 'file', 'image', 'video', 'table', 'divider', 'gallery', 'columns'],
    [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
    [{ align: [] }],
    ['blockquote'],
    ['clean'],
  ],
};

const IMG_ALIGNS = ['left', 'center', 'right'];

/** Horizontal rule (<hr>) as an editor block, with its own toolbar button. */
let registered = false;
function registerFormats() {
  if (registered) return;
  registered = true;
  const BlockEmbed = Quill.import('blots/block/embed');
  class Divider extends BlockEmbed {
    static blotName = 'divider';
    static tagName = 'hr';
  }
  Quill.register(Divider);
  // A picture gallery: <div class="gallery"><figure><a href data-lightbox><img><figcaption>…</figure>…</div>. Shown as a
  // grid on the site (js/site.js opens it in the lightbox with next/previous); edited as a whole in a dialog.
  class Gallery extends BlockEmbed {
    static blotName = 'gallery';
    static tagName = 'div';
    static className = 'gallery';
    static create(value) {
      const node = super.create();
      node.setAttribute('contenteditable', 'false');
      for (const it of value?.items ?? []) {
        const fig = document.createElement('figure');
        const a = Object.assign(document.createElement('a'), { href: it.src });
        a.setAttribute('data-lightbox', '');
        a.append(Object.assign(document.createElement('img'), { src: it.src, alt: it.alt || it.caption || '', loading: 'lazy' }));
        fig.append(a);
        if (it.caption) fig.append(Object.assign(document.createElement('figcaption'), { textContent: it.caption }));
        node.append(fig);
      }
      return node;
    }
    static value(node) {
      return { items: galleryItems(node) };
    }
    html() {
      const copy = this.domNode.cloneNode(true);
      copy.removeAttribute('contenteditable');
      return copy.outerHTML;
    }
  }
  Quill.register(Gallery);
  // A row of columns: <div class="cols cols--2"><div class="col">…text…</div>…</div>. Stacks on phones (css/site.css);
  // each column is its own small editor in a dialog, and the whole row is edited from there.
  class Columns extends BlockEmbed {
    static blotName = 'columns';
    static tagName = 'div';
    static className = 'cols';
    static create(value) {
      const node = super.create();
      node.setAttribute('contenteditable', 'false');
      const layout = COLS_LAYOUTS[value?.layout] ? value.layout : '2';
      node.classList.add(`cols--${layout}`);
      for (const html of value?.cols ?? []) {
        const col = document.createElement('div');
        col.className = 'col';
        col.innerHTML = cleanCellHtml(html);
        node.append(col);
      }
      return node;
    }
    static value(node) {
      const layout = Object.keys(COLS_LAYOUTS).find((k) => node.classList.contains(`cols--${k}`)) ?? '2';
      return { layout, cols: [...node.children].filter((c) => c.classList.contains('col')).map((c) => c.innerHTML) };
    }
    html() {
      const copy = this.domNode.cloneNode(true);
      copy.removeAttribute('contenteditable');
      return copy.outerHTML;
    }
  }
  Quill.register(Columns);
  // Quill saves videos as plain links by default; keep the player instead.
  const Video = Quill.import('formats/video');
  class VideoPlayer extends Video {
    html() {
      const src = esc(this.value().video);
      return `<iframe class="ql-video" src="${src}" frameborder="0" allowfullscreen="true"></iframe>`;
    }
  }
  Quill.register(VideoPlayer, true);

  // Images keep a width (percent of the text column) and an alignment class.
  const Image = Quill.import('formats/image');
  class SizedImage extends Image {
    static formats(node) {
      const f = super.formats(node);
      if (node.style.width) f.width = node.style.width;
      const align = IMG_ALIGNS.find((a) => node.classList.contains(`img-align-${a}`));
      if (align) f.imgalign = align;
      return f;
    }
    format(name, value) {
      if (name === 'width') {
        if (value) this.domNode.style.width = value;
        else this.domNode.style.removeProperty('width');
        if (!this.domNode.getAttribute('style')) this.domNode.removeAttribute('style');
      } else if (name === 'imgalign') {
        IMG_ALIGNS.forEach((a) => this.domNode.classList.remove(`img-align-${a}`));
        if (IMG_ALIGNS.includes(value)) this.domNode.classList.add(`img-align-${value}`);
        if (!this.domNode.className) this.domNode.removeAttribute('class');
      } else super.format(name, value);
    }
  }
  Quill.register(SizedImage, true);

  const icons = Quill.import('ui/icons');
  icons.table ??=
    '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="12" x="3" y="3" rx="1"></rect><line class="ql-stroke" x1="3" x2="15" y1="7" y2="7"></line><line class="ql-stroke" x1="3" x2="15" y1="11" y2="11"></line><line class="ql-stroke" x1="7" x2="7" y1="7" y2="15"></line><line class="ql-stroke" x1="11" x2="11" y1="7" y2="15"></line></svg>';
  icons.file =
    '<svg viewBox="0 0 18 18"><path class="ql-stroke" d="M4.5 2.5h6l3 3v10h-9z" fill="none"></path><polyline class="ql-stroke" points="10.5 2.5 10.5 5.5 13.5 5.5" fill="none"></polyline><line class="ql-stroke" x1="6.5" x2="11.5" y1="9" y2="9"></line><line class="ql-stroke" x1="6.5" x2="11.5" y1="12" y2="12"></line></svg>';
  icons.columns =
    '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="4.5" x="2.5" y="3" rx="1"></rect><rect class="ql-stroke" height="12" width="4.5" x="9" y="3" rx="1"></rect><line class="ql-stroke" x1="16" x2="16" y1="3" y2="15"></line></svg>';
  icons.gallery =
    '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="5" width="5" x="2.5" y="2.5" rx="1"></rect><rect class="ql-stroke" height="5" width="5" x="10.5" y="2.5" rx="1"></rect><rect class="ql-stroke" height="5" width="5" x="2.5" y="10.5" rx="1"></rect><rect class="ql-stroke" height="5" width="5" x="10.5" y="10.5" rx="1"></rect></svg>';
  Quill.import('ui/icons').divider =
    '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="2" x2="16" y1="9" y2="9"></line><line class="ql-stroke ql-thin" x1="5" x2="13" y1="4" y2="4" opacity=".4"></line><line class="ql-stroke ql-thin" x1="5" x2="13" y1="14" y2="14" opacity=".4"></line></svg>';
}

/** YouTube / Vimeo page link → embeddable player URL, or null. */
function videoEmbedUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1];
  if (id && /^[\w-]{6,}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.match(/(\d{6,})/)?.[1];
    if (v) return `https://player.vimeo.com/video/${v}`;
  }
  return null;
}

/** Upload image files into the editor at `index` (toolbar button, paste or drop). */
async function insertImages(quill, files, index) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    toast(`Uploading ${file.name}…`);
    try {
      const { url } = await uploadImage(file, 'content', { maxSize: 1600 });
      const alt = prompt('Describe this image for people who can’t see it (optional):', '') ?? '';
      quill.insertEmbed(index, 'image', url, 'user');
      if (alt.trim()) quill.formatText(index, 1, 'alt', alt.trim(), 'user');
      quill.setSelection(++index, 0, 'user');
    } catch (err) {
      toast(`Image not added: ${friendlyError(err)}`, 'error');
    }
  }
}

const COLS_LAYOUTS = { 2: '2 equal columns', 3: '3 equal columns', 4: '4 equal columns', '1-2': 'Narrow column, then wide', '2-1': 'Wide column, then narrow' };
const COLS_COUNT = { 2: 2, 3: 3, 4: 4, '1-2': 2, '2-1': 2 };
const CELL_TAGS = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'S', 'A', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'IMG', 'HR', 'SPAN', 'IFRAME', 'B', 'I']);
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|[\w./?=&%-]+$)/i;

/** A column's saved HTML with only what the editor itself writes: no scripts, handlers or odd addresses. */
function cleanCellHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}`, 'text/html');
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!CELL_TAGS.has(el.tagName) || (el.tagName === 'IFRAME' && !videoEmbedUrl(el.getAttribute('src') ?? '') && !/^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(el.getAttribute('src') ?? ''))) {
      el.remove();
      continue;
    }
    for (const a of [...el.attributes]) {
      const keep = ['class', 'href', 'src', 'alt', 'target', 'rel', 'allowfullscreen', 'frameborder', 'style'].includes(a.name);
      if (!keep || (['href', 'src'].includes(a.name) && !SAFE_URL.test(a.value.trim())) || (a.name === 'style' && /url\(|expression|javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
  return doc.body.innerHTML;
}

/**
 * The columns editor: pick a layout and write each column in its own small editor.
 * Resolves with { layout, cols: [html, …] }, or null if the dialog was dismissed.
 */
function editColumns(initial) {
  return new Promise((resolve) => {
    const u = uid('cols');
    let layout = COLS_LAYOUTS[initial?.layout] ? initial.layout : '2';
    const start = initial?.cols?.length ? initial.cols : ['', ''];
    const editors = []; // made when a column is first shown
    const d = openDialog('Columns', `
      <div class="field"><label for="${u}-layout">Layout</label><select id="${u}-layout">${Object.entries(COLS_LAYOUTS).map(([k, l]) => `<option value="${k}"${k === layout ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <p class="field__hint">On phones the columns stack, the first on top. For more rows, add another Columns block under this one.</p></div>
      <div data-cols>${[0, 1, 2, 3].map((i) => `<div class="cols-edit__col" data-col-box="${i}"><span class="label" id="${u}-l${i}">Column ${i + 1}</span><div class="editor--cell"><div data-col="${i}"></div></div></div>`).join('')}</div>
      <p class="admin-status" role="status" data-status></p>
      <div class="admin-actions"><button class="btn btn--primary" type="button" data-done>Done</button> <button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>`, { wide: true });
    const status = $('[data-status]', d);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
      d.close();
    };
    const draw = () => {
      const n = COLS_COUNT[layout];
      for (let i = 0; i < 4; i++) {
        $(`[data-col-box="${i}"]`, d).hidden = i >= n;
        if (i < n && !editors[i]) {
          editors[i] = makeEditor($(`[data-col="${i}"]`, d), 'cell', $(`#${u}-l${i}`, d));
          setHtml(editors[i], start[i] ?? '');
        }
      }
      const lost = editors.map((q, i) => (i >= n && q && getHtml(q) ? i + 1 : 0)).filter(Boolean);
      setStatus(status, lost.length ? `Column ${lost.join(', ')} has text and is removed when you press Done.` : '', lost.length ? 'error' : undefined);
    };
    draw();
    $(`#${u}-layout`, d).addEventListener('change', (e) => {
      layout = e.target.value;
      draw();
    });
    d.addEventListener('close', () => finish(null));
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-done]')) finish({ layout, cols: editors.slice(0, COLS_COUNT[layout]).map((q) => (q ? getHtml(q) ?? '' : '')) });
      else if (e.target.closest('[data-cancel]')) finish(null);
    });
  });
}

const GALLERY_MAX = 24;
/** The pictures of a gallery block's markup, as [{ src, caption, alt }]. An alt that only repeats the caption counts as none. */
const galleryItems = (node) =>
  [...node.querySelectorAll('figure')]
    .map((f) => {
      const caption = f.querySelector('figcaption')?.textContent ?? '';
      const alt = f.querySelector('img')?.getAttribute('alt') ?? '';
      return { src: f.querySelector('img')?.getAttribute('src') ?? '', caption, alt: alt === caption ? '' : alt };
    })
    .filter((i) => i.src);


/** Pick one document, audio or video file from the Media Library; resolves { url, name } or null. */
async function pickLibraryFile() {
  const shown = (await libraryFiles(isLibraryFile)).map((f) => ({ name: f.name.replace(/^[a-z0-9]+-/, ''), url: f.url }));
  return new Promise((resolve) => {
    const d = openDialog('Link to a file', shown.length
      ? `<p class="field__hint">Pick a file from the Media Library. Your text links to it.</p>
        <ul class="file-pick">${shown.map((f, i) => `<li><button class="btn btn--ghost file-pick__btn" type="button" data-pick="${i}">${esc(f.name)}</button></li>`).join('')}</ul>`
      : '<p class="empty">No files yet. Upload documents under Media first.</p>', { wide: true });
    let picked = null;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      picked = shown[Number(b.dataset.pick)];
      d.close();
    });
    d.addEventListener('close', () => resolve(picked));
  });
}

/** Pick pictures from the Media Library (several at once); resolves with their addresses, or [] if none. */
async function pickLibraryImages() {
  const files = await libraryImages();
  const urls = files.map((f) => f.url);
  return new Promise((resolve) => {
    const d = openDialog('Choose from Media', files.length
      ? `<p class="field__hint">Tap the pictures to add, then press Add. They are linked, not copied.</p>
        <ul class="media-grid media-pick">${urls.map((u, i) => `<li class="media-item"><button type="button" class="media-pick__btn" data-url="${esc(u)}" aria-pressed="false" aria-label="${esc(files[i].name)}"><img src="${esc(u)}" alt="" loading="lazy"></button></li>`).join('')}</ul>
        <div class="admin-actions"><button class="btn btn--primary" type="button" data-add>Add selected</button></div>`
      : '<p class="empty">The Media Library is empty. Upload images under Media first.</p>', { wide: true });
    let picked = [];
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-url]');
      if (b) return b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      if (e.target.closest('[data-add]')) {
        picked = $$('[data-url][aria-pressed="true"]', d).map((x) => x.dataset.url);
        d.close();
      }
    });
    d.addEventListener('close', () => resolve(picked));
  });
}

/**
 * The gallery editor: add pictures (upload, or from Media), caption them, put them in order, remove some.
 * Resolves with the new list of { src, caption }, or null if the dialog was dismissed.
 */
function editGallery(initial) {
  return new Promise((resolve) => {
    let items = initial.map((i) => ({ ...i }));
    const u = uid('gal');
    const d = openDialog('Picture Gallery', `
      <p class="field__hint">A grid of pictures that opens larger when tapped. The caption (optional) shows over the picture. The description (alt text) isn’t shown; screen readers read it to people who can’t see the picture, and search engines use it. The description is required.</p>
      <ul class="gallery-edit" data-items></ul>
      <div class="admin-actions">
        <input id="${u}" type="file" accept="image/*" multiple class="visually-hidden">
        <label class="btn btn--ghost" for="${u}">Upload pictures…</label>
        <button class="btn btn--ghost" type="button" data-library>Choose from Media…</button>
      </div>
      <p class="admin-status" role="status" data-status></p>
      <div class="admin-actions"><button class="btn btn--primary" type="button" data-done>Done</button> <button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>`, { wide: true });
    const list = $('[data-items]', d);
    const status = $('[data-status]', d);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
      d.close();
    };
    const draw = () => {
      list.innerHTML = items.length
        ? items.map((it, i) => `<li class="gallery-edit__item">
            <img src="${esc(it.src)}" alt="">
            <div class="gallery-edit__fields">
              <div class="field"><label class="visually-hidden" for="${u}-c${i}">Caption for picture ${i + 1}</label><input id="${u}-c${i}" data-caption="${i}" maxlength="200" autocomplete="off" placeholder="Caption (optional)" value="${esc(it.caption)}"></div>
              <div class="field"><label class="visually-hidden" for="${u}-a${i}">Description (alt text) for picture ${i + 1}</label><input id="${u}-a${i}" data-alt="${i}" maxlength="250" autocomplete="off" required aria-required="true" placeholder="Description of the picture (required)" value="${esc(it.alt)}"></div>
            </div>
            <span class="gallery-edit__move">
              <button class="btn btn--ghost btn--small" type="button" data-move="-1" data-i="${i}" aria-label="Move picture ${i + 1} earlier"${i === 0 ? ' disabled' : ''}>↑</button>
              <button class="btn btn--ghost btn--small" type="button" data-move="1" data-i="${i}" aria-label="Move picture ${i + 1} later"${i === items.length - 1 ? ' disabled' : ''}>↓</button>
              <button class="icon-btn icon-btn--remove" type="button" data-remove="${i}" aria-label="Remove picture ${i + 1}" title="Remove">${solidIcon('remove', 18)}</button>
            </span></li>`).join('')
        : '<li class="empty">No pictures yet.</li>';
    };
    const add = (urls) => {
      const room = GALLERY_MAX - items.length;
      items.push(...urls.slice(0, room).map((src) => ({ src, caption: '', alt: '' })));
      if (urls.length > room) setStatus(status, `A gallery holds up to ${GALLERY_MAX} pictures.`, 'error');
      draw();
    };
    draw();
    d.addEventListener('close', () => finish(null));
    d.addEventListener('input', (e) => {
      const c = e.target.closest('[data-caption]');
      if (c) items[Number(c.dataset.caption)].caption = c.value;
      const a = e.target.closest('[data-alt]');
      if (a) items[Number(a.dataset.alt)].alt = a.value;
    });
    d.addEventListener('click', async (e) => {
      const mv = e.target.closest('[data-move]');
      const rm = e.target.closest('[data-remove]');
      if (mv) {
        const i = Number(mv.dataset.i);
        const j = i + Number(mv.dataset.move);
        [items[i], items[j]] = [items[j], items[i]];
        draw();
        const mine = $$(`[data-move][data-i="${j}"]`, d).filter((b) => !b.disabled); // the arrow just used, or the other once at an end
        (mine.find((b) => b.dataset.move === mv.dataset.move) ?? mine[0])?.focus();
      } else if (rm) {
        items.splice(Number(rm.dataset.remove), 1);
        draw();
      } else if (e.target.closest('[data-library]')) {
        try {
          add(await pickLibraryImages());
        } catch (err) {
          setStatus(status, friendlyError(err), 'error');
        }
      } else if (e.target.closest('[data-done]')) {
        const missing = items.findIndex((i) => !i.alt.trim());
        if (missing >= 0) {
          setStatus(status, `Add a description (alt text) for picture ${missing + 1}. It’s how people who can’t see the picture know what it shows.`, 'error');
          $(`[data-alt="${missing}"]`, d).focus();
          return;
        }
        finish(items.map((i) => ({ src: i.src, caption: i.caption.trim(), alt: i.alt.trim() })));
      } else if (e.target.closest('[data-cancel]')) {
        finish(null);
      }
    });
    $(`#${u}`, d).addEventListener('change', async (e) => {
      const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
      e.target.value = '';
      const urls = [];
      for (const [n, file] of files.entries()) {
        setStatus(status, `Uploading ${n + 1} of ${files.length}…`);
        try {
          urls.push((await uploadImage(file, 'content', { maxSize: 1600 })).url);
        } catch (err) {
          setStatus(status, `${file.name} not added: ${friendlyError(err)}`, 'error');
        }
      }
      if (urls.length) setStatus(status, '');
      add(urls);
    });
  });
}

/** Editor inside `el`. `labelEl` gives the editable area its accessible name. */
export function makeEditor(el, kind = 'body', labelEl = null) {
  registerFormats();
  const handlers = {
    image() {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
      input.addEventListener('change', () => insertImages(this.quill, [...input.files], this.quill.getSelection(true).index));
      input.click();
    },
    async file() {
      const q = this.quill;
      const range = q.getSelection(true);
      let picked;
      try {
        picked = await pickLibraryFile();
      } catch (err) {
        return toast(friendlyError(err), 'error');
      }
      if (!picked) return;
      if (range.length) q.formatText(range.index, range.length, 'link', picked.url, 'user'); // the selected words link to it
      else {
        q.insertText(range.index, picked.name, 'link', picked.url, 'user'); // nothing selected: its name, linked
        q.setSelection(range.index + picked.name.length, 0, 'user');
      }
    },
    video() {
      const url = prompt('Paste a YouTube or Vimeo link:', '');
      if (!url) return;
      const src = videoEmbedUrl(url);
      if (!src) return toast('That isn’t a YouTube or Vimeo link.', 'error');
      const { index } = this.quill.getSelection(true);
      this.quill.insertEmbed(index, 'video', src, 'user');
      this.quill.setSelection(index + 1, 0, 'user');
    },
    table() {
      const q = this.quill;
      if (q.getModule('table').getTable()[0]) return toast('Put the cursor outside the table to add another.', 'error');
      // Start the table on a new line; Quill puts it above that (empty) line, which
      // stays below the table for typing after it.
      const [line] = q.getLine(q.getSelection(true).index);
      let at = q.getIndex(line) + line.length() - 1;
      if (line.length() > 1) q.insertText(at++, '\n', 'user');
      q.setSelection(at, 0, 'silent');
      q.getModule('table').insertTable(3, 3);
    },
    async columns() {
      const q = this.quill;
      const { index } = q.getSelection(true);
      const out = await editColumns(null);
      if (!out) return;
      q.insertEmbed(index, 'columns', out, 'user');
      q.setSelection(index + 1, 0, 'user');
    },
    async gallery() {
      const q = this.quill;
      const { index } = q.getSelection(true);
      const items = await editGallery([]);
      if (!items?.length) return;
      q.insertEmbed(index, 'gallery', { items }, 'user');
      q.setSelection(index + 1, 0, 'user');
    },
    divider() {
      const { index } = this.quill.getSelection(true);
      this.quill.insertEmbed(index, 'divider', true, 'user');
      this.quill.setSelection(index + 1, 0, 'user');
    },
  };
  const quill = new Quill(el, {
    theme: 'snow',
    modules: {
      toolbar: { container: TOOLBARS[kind], handlers },
      table: kind === 'body',
      // Pasted or dropped pictures are uploaded instead of stored inside the text.
      // (`this` is the uploader module here.)
      uploader: {
        mimetypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        handler(range, files) { insertImages(this.quill, files, range.index); },
      },
    },
  });
  if (labelEl) {
    quill.root.setAttribute('role', 'textbox');
    quill.root.setAttribute('aria-multiline', 'true');
    quill.root.setAttribute('aria-labelledby', (labelEl.id ||= uid('lbl')));
  }
  // Name the icon-only toolbar buttons for screen readers and tooltips.
  const names = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', link: 'Link', file: 'Link to a file from Media', image: 'Insert image', video: 'Insert video', table: 'Insert table', divider: 'Divider line', gallery: 'Insert picture gallery', columns: 'Insert columns', blockquote: 'Quote', clean: 'Clear formatting' };
  quill.getModule('toolbar').container.querySelectorAll('button').forEach((b) => {
    const f = [...b.classList].find((c) => c.startsWith('ql-'))?.slice(3);
    const label = f === 'list' ? (b.value === 'ordered' ? 'Numbered list' : 'Bulleted list') : f === 'indent' ? (b.value === '+1' ? 'Indent' : 'Outdent') : names[f];
    if (label) b.setAttribute('aria-label', label), (b.title = label);
  });
  const pickers = { header: 'Text style', color: 'Text color', background: 'Highlight color', align: 'Alignment' };
  quill.getModule('toolbar').container.querySelectorAll('.ql-picker').forEach((p) => {
    const f = [...p.classList].find((c) => c.startsWith('ql-') && c !== 'ql-picker' && c !== 'ql-color-picker' && c !== 'ql-icon-picker')?.slice(3);
    const label = p.querySelector('.ql-picker-label');
    if (pickers[f] && label) label.setAttribute('aria-label', pickers[f]), (label.title = pickers[f]);
  });
  if (kind === 'body') {
    // A gallery in the text is edited as a whole: click it to change its pictures and captions.
    quill.root.addEventListener('click', async (e) => {
      const node = e.target.closest?.('.gallery');
      if (!node) return;
      e.preventDefault();
      const blot = Quill.find(node);
      if (!blot) return;
      const index = quill.getIndex(blot);
      const items = await editGallery(galleryItems(node));
      if (items === null) return;
      quill.deleteText(index, 1, 'user');
      if (items.length) quill.insertEmbed(index, 'gallery', { items }, 'user');
    });
    // A row of columns is edited the same way.
    quill.root.addEventListener('click', async (e) => {
      const node = e.target.closest?.('.cols');
      if (!node) return;
      e.preventDefault();
      const blot = Quill.find(node);
      if (!blot) return;
      const index = quill.getIndex(blot);
      const out = await editColumns(blot.constructor.value(node));
      if (out === null) return;
      quill.deleteText(index, 1, 'user');
      quill.insertEmbed(index, 'columns', out, 'user');
    });
    imageTools(quill);
    tableTools(quill);
  } else if (kind === 'cell') {
    imageTools(quill); // a column's pictures get the same bar: alignment, size, alt text, link
  }
  quill.on('text-change', () => keepLineAbove(quill));
  keepLineAbove(quill);
  return quill;
}

/** A web address typed for a picture's link, made complete (example.com becomes https://example.com); '' for none, null if it isn't an address. */
export function imageLinkUrl(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/^(https?:\/\/\S+|mailto:\S+|tel:[\d+()\s-]+)$/i.test(v) || /^[/#]\S*$/.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return null;
}

/**
 * Click (or select) an image in the editor to get alignment, size presets, alt
 * text, a link and a corner handle for free resizing. Width is stored as a percentage
 * of the text column so pictures scale on phones.
 */
function imageTools(quill) {
  const box = document.createElement('div');
  box.className = 'img-tools';
  box.hidden = true;
  box.innerHTML = `
    <div class="img-tools__bar" role="toolbar" aria-label="Image">
      <button type="button" data-align="left" title="Left, text wraps">⇤ Left</button>
      <button type="button" data-align="center" title="Centered">↔ Center</button>
      <button type="button" data-align="right" title="Right, text wraps">Right ⇥</button>
      <button type="button" data-align="" title="In line with text">Inline</button>
      <span class="img-tools__sep"></span>
      ${[25, 50, 75, 100].map((w) => `<button type="button" data-width="${w}">${w}%</button>`).join('')}
      <button type="button" data-width="" title="Original size">Auto</button>
      <span class="img-tools__sep"></span>
      <button type="button" data-alt>Alt text</button>
      <button type="button" data-link title="Make the picture a link">Link</button>
    </div>
    <span class="img-tools__size"></span>
    <span class="img-tools__handle" title="Drag to resize"></span>`;
  quill.container.append(box);
  let img = null;

  const blotIndex = () => quill.getIndex(Quill.find(img));
  const place = () => {
    if (!img || !img.isConnected) return hide();
    const c = quill.container.getBoundingClientRect(), r = img.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - c.left}px`, top: `${r.top - c.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    // Not enough room above the picture (it's at the top of the editor): show the bar inside it.
    box.classList.toggle('img-tools--inside', r.top - c.top < $('.img-tools__bar', box).offsetHeight + 8);
    $('.img-tools__size', box).textContent = img.style.width || 'Auto';
    $('[data-link]', box).setAttribute('aria-pressed', String(!!img.closest('a')));
    $$('[data-align]', box).forEach((b) => b.setAttribute('aria-pressed', IMG_ALIGNS.find((a) => img.classList.contains(`img-align-${a}`)) === (b.dataset.align || undefined) || (!b.dataset.align && !IMG_ALIGNS.some((a) => img.classList.contains(`img-align-${a}`)))));
  };
  const show = (el) => { img = el; box.hidden = false; place(); };
  function hide() { img = null; box.hidden = true; }
  const apply = (formats) => {
    quill.formatText(blotIndex(), 1, formats, 'user');
    requestAnimationFrame(place);
  };

  quill.root.addEventListener('click', (e) => (e.target.tagName === 'IMG' && !e.target.closest('.gallery, .cols') ? show(e.target) : hide()));
  quill.on('selection-change', (range) => {
    if (!range) return;
    const [leaf] = quill.getLeaf(range.index + 1);
    if (range.length === 1 && leaf?.domNode?.tagName === 'IMG') show(leaf.domNode);
    else if (img && !(range.length === 1 && Quill.find(img) === leaf)) hide();
  });
  quill.on('text-change', () => requestAnimationFrame(place));
  quill.root.addEventListener('scroll', place);
  // Follows the editor's own size (a window resize changes it too). An observer goes when the editor does, where a
  // listener on the window would keep every editor ever opened alive.
  new ResizeObserver(place).observe(quill.container);

  box.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !img) return;
    if ('align' in b.dataset) apply({ imgalign: b.dataset.align || false });
    else if ('width' in b.dataset) apply({ width: b.dataset.width ? `${b.dataset.width}%` : false });
    else if ('alt' in b.dataset) {
      const alt = prompt('Describe this image for people who can’t see it:', img.getAttribute('alt') ?? '');
      if (alt != null) apply({ alt: alt.trim() || false });
    } else if ('link' in b.dataset) {
      const raw = prompt('Where should this picture link to? Paste a web address, or leave empty to remove the link.', img.closest('a')?.getAttribute('href') ?? '');
      if (raw == null) return;
      const url = imageLinkUrl(raw);
      if (raw.trim() && !url) return toast('That doesn’t look like a web address.', 'error');
      apply({ link: url || false });
    }
  });

  // Drag the corner to resize; saved as a whole-number percentage on release.
  const handle = $('.img-tools__handle', box);
  handle.addEventListener('pointerdown', (e) => {
    if (!img) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = img.getBoundingClientRect().width;
    const column = quill.root.clientWidth - parseFloat(getComputedStyle(quill.root).paddingLeft) - parseFloat(getComputedStyle(quill.root).paddingRight);
    const pct = (x) => Math.max(10, Math.min(100, Math.round(((startW + x - startX) / column) * 100)));
    const move = (ev) => { img.style.width = `${pct(ev.clientX)}%`; place(); };
    const up = (ev) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      apply({ width: `${pct(ev.clientX)}%` });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

/** Row/column controls shown while the cursor is in a table. */
function tableTools(quill) {
  const table = quill.getModule('table');
  const bar = document.createElement('div');
  bar.className = 'table-tools';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Table');
  bar.hidden = true;
  const actions = [
    ['insertRowAbove', '+ Row above'], ['insertRowBelow', '+ Row below'], ['insertColumnLeft', '+ Column left'], ['insertColumnRight', '+ Column right'],
    ['deleteRow', '− Row'], ['deleteColumn', '− Column'], ['deleteTable', 'Delete table'],
  ];
  bar.innerHTML = `<span class="table-tools__label">Table:</span>${actions.map(([a, l]) => `<button type="button" data-act="${a}"${a.startsWith('delete') ? ' class="is-danger"' : ''}>${l}</button>`).join('')}`;
  quill.getModule('toolbar').container.after(bar);
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'deleteTable' && !confirm('Delete this whole table?')) return;
    table[act]();
    update(quill.getSelection());
  });
  const update = (range) => {
    if (!range) return;
    const [inTable] = table.getTable(range);
    bar.hidden = !inTable;
  };
  quill.on('selection-change', update);
  quill.on('text-change', () => update(quill.getSelection()));
}

/**
 * A picture, gallery, columns row, divider, video or table that starts the text leaves no line above it to put the cursor
 * on. Keep one empty line there (getHtml drops it again when saving, so the page gets no stray gap).
 */
export function keepLineAbove(quill) {
  const [line] = quill.getLine(0);
  if (!line) return;
  const BlockEmbed = Quill.import('blots/block/embed');
  if (line instanceof BlockEmbed || line.domNode.closest?.('td, th')) quill.insertText(0, '\n', 'silent');
}

export function setHtml(quill, html) {
  quill.setContents([], 'silent');
  if (html) quill.clipboard.dangerouslyPasteHTML(html, 'silent');
  keepLineAbove(quill);
}

/** Clean HTML for storage, or null when the editor is empty. */
export function getHtml(quill) {
  if (!quill.getText().trim() && !quill.getContents().ops.some((op) => typeof op.insert !== 'string')) return null;
  const doc = document.createElement('div');
  doc.innerHTML = quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
  // Quill opens every link in a new tab; keep that only for other websites.
  doc.querySelectorAll('a[href]').forEach((a) => {
    if (!/^https?:\/\//i.test(a.getAttribute('href')) || new URL(a.href, location.href).host === location.host) {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
  });
  // Quill writes a hard black border onto tables; the site's stylesheet styles them.
  doc.querySelectorAll('table[style]').forEach((t) => t.removeAttribute('style'));
  // The empty line kept above a first gallery, row, divider, video or table (see keepLineAbove) isn't saved.
  const first = doc.firstElementChild;
  if (first?.tagName === 'P' && !first.textContent && first.children.length <= 1 && first.nextElementSibling?.matches('.gallery, .cols, hr, iframe, table')) first.remove();
  return doc.innerHTML;
}

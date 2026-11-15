// Media library: images for news posts, emails, socials… and documents, audio and video to link to. Upload several at
// once (pictures are resized and optionally cropped in the browser; other files are stored as they are), copy each one's link,
// delete ones no longer needed. Stored in Storage under media/library/.

import { $, esc, must, toast, hintFold, setStatus, solidIcon, friendlyError, listAllFiles } from '../lib.js';
import { uploadImage, replaceImage, thumbPath, CROPS, uploadFile, isLibraryImage, isLibraryFile, fileExt, FILE_ACCEPT } from '../images.js';

const FOLDER = 'library';
let sb;
let isOwner = false;
let files = []; // the Library's images as last listed
let bustAt = 0; // after a Replace, the previews skip the browser's copy (one stamp per load, so re-sorting reuses them)

/** Library sort orders; Newest first is the default. */
const SORTS = {
  newest: { label: 'Newest first', cmp: (a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') },
  oldest: { label: 'Oldest first', cmp: (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') },
  name: { label: 'Name A–Z', cmp: (a, b) => shortName(a.name).localeCompare(shortName(b.name), undefined, { numeric: true, sensitivity: 'base' }) },
  largest: { label: 'Largest first', cmp: (a, b) => (b.metadata?.size ?? 0) - (a.metadata?.size ?? 0) },
};
const shortName = (name) => name.replace(/^[a-z0-9]+-/, ''); // without the random prefix uploads get
let sort = 'newest';

/** What media_usage() found, as short plain-English lines. */
const PLACES = {
  'settings.logo_url': 'the shop logo', 'settings.favicon_url': 'the browser icon', 'settings.hero_image_url': 'the home page picture',
  'settings.email_logo_url': 'the logo in emails', 'settings.about_html': 'the About text',
  'series_catalog.cover_url': 'series covers', 'items.cover_url': 'title covers', 'items.cover_thumb_url': 'title covers', 'items.description': 'title descriptions',
  'events.image_url': 'events', 'events.description': 'events', 'posts.cover_url': 'news posts', 'posts.body': 'news posts',
  'pages.body_html': 'page text', 'pages.lede_html': 'page text', 'faqs.answer_html': 'the FAQ', 'surveys.questions': 'surveys',
};
function describeUsage(used) {
  const byPlace = new Map();
  for (const u of used) {
    const label = PLACES[`${u.table}.${u.column}`] ?? `${u.table} (${u.column})`;
    const cur = byPlace.get(label) ?? { n: 0, examples: [] };
    cur.n = Math.max(cur.n, u.count); // the same rows can appear under two columns
    for (const e of u.examples ?? []) if (!cur.examples.includes(e)) cur.examples.push(e);
    byPlace.set(label, cur);
  }
  return [...byPlace].map(([label, { n, examples }]) => (n === 1 && /^the /.test(label) ? label : `${n} ${label}${examples.length ? ` (${examples.slice(0, 3).join(', ')}${n > 3 ? ', …' : ''})` : ''}`));
}

export async function mount(el, ctx) {
  sb = ctx.sb;
  isOwner = ctx.isOwner === true;
  el.innerHTML = `
    <h1>Media Library</h1>
    ${hintFold(`Images for news posts, emails, social media and series covers, plus files to link to (PDF, Word, Excel, PowerPoint, text, CSV, MP3 and MP4, up to 50 MB each; in the page editor, the file button links text to one). Each picture is resized to the chosen size — the original file is never changed. To fix or update a picture without breaking anything that uses it, press <strong>Replace</strong> on it (pictures only; to change a file, upload the new one and link to that): the new image takes the old one’s place under the same link (it uses the Crop and Longest side chosen below, and can take up to an hour to show for people who already loaded the old one).`)}
    <div class="panel media-upload">
      <div class="form-grid form-grid--pairs">
        <div class="field"><label for="m-crop">Crop</label><select id="m-crop">${Object.entries(CROPS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}</select></div>
        <div class="field"><label for="m-size">Longest side</label><select id="m-size"><option value="2000">Large (2000px)</option><option value="1600" selected>Medium (1600px)</option><option value="1080">Social (1080px)</option><option value="800">Small (800px)</option><option value="400">Extra Small (400px)</option></select></div>
      </div>
      <label class="dropzone" for="m-files">
        <input id="m-files" type="file" accept="image/*,${FILE_ACCEPT}" multiple class="visually-hidden">
        <strong>Choose images or files</strong> or drop them here — several at once is fine
      </label>
      <p class="admin-status" role="status" data-upload-status></p>
    </div>
    <div class="media-toolbar">
      <p class="results-count" data-count></p>
      <label class="visually-hidden" for="m-sort">Sort files</label>
      <select id="m-sort" class="select--small media-toolbar__sort">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select>
      <div class="view-switch" role="group" aria-label="Show files as">
        <button class="icon-btn" type="button" data-view="grid" aria-pressed="false" aria-label="Grid" title="Grid">${solidIcon('grid', 20)}</button>
        <button class="icon-btn" type="button" data-view="list" aria-pressed="false" aria-label="List" title="List">${solidIcon('list', 20)}</button>
      </div>
    </div>
    <ul class="media-grid" data-grid></ul>`;

  // Grid or list, remembered on this device.
  const setView = (view) => {
    $('[data-grid]', el).classList.toggle('media-grid--list', view === 'list');
    el.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    try {
      localStorage.setItem('admin-media-view', view);
    } catch {
      /* remembering the view is optional */
    }
  };
  let view = 'grid';
  try {
    view = localStorage.getItem('admin-media-view') === 'list' ? 'list' : 'grid';
  } catch {
    /* start on the grid */
  }
  setView(view);

  // Sort order, remembered on this device; Newest first until changed.
  try {
    const saved = localStorage.getItem('admin-media-sort');
    if (SORTS[saved]) sort = saved;
  } catch {
    /* start on Newest first */
  }
  const sortSelect = $('#m-sort', el);
  sortSelect.value = sort;
  sortSelect.addEventListener('change', () => {
    sort = SORTS[sortSelect.value] ? sortSelect.value : 'newest';
    try {
      localStorage.setItem('admin-media-sort', sort);
    } catch {
      /* remembering the sort is optional */
    }
    render(el);
  });
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  const input = $('#m-files', el);
  const zone = $('.dropzone', el);
  input.addEventListener('change', () => upload(el, input.files).then(() => (input.value = '')));
  zone.addEventListener('dragover', (e) => (e.preventDefault(), zone.classList.add('is-over')));
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    upload(el, e.dataTransfer.files);
  });

  $('[data-grid]', el).addEventListener('change', async (e) => {
    const input = e.target.closest('[data-replace]');
    const file = input?.files[0];
    if (!file) return;
    const path = input.dataset.replace;
    input.value = '';
    if (!confirm(`Replace ${path.split('/').pop().replace(/^[a-z0-9]+-/, '')} with ${file.name}? Everywhere this image is used will show the new picture.`)) return;
    const status = $('[data-upload-status]', el);
    setStatus(status, 'Replacing…');
    try {
      await replaceImage(file, path, { crop: $('#m-crop', el).value, maxSize: Number($('#m-size', el).value), thumb: true });
      setStatus(status, 'Image replaced. The link is unchanged.', 'ok');
      toast('Image replaced');
      load(el, true);
    } catch (err) {
      setStatus(status, `Not replaced: ${friendlyError(err)}`, 'error');
    }
  });

  $('[data-grid]', el).addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    const del = e.target.closest('[data-delete]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast('Link copied');
      } catch {
        prompt('Copy this link:', copy.dataset.copy);
      }
    }
    if (del) {
      let used = null;
      try {
        used = await must(sb.rpc('media_usage', { p_path: del.dataset.delete }));
      } catch {
        /* the check is advice only: fall back to the plain warning */
      }
      const places = describeUsage(used ?? []);
      const question = used === null
        ? 'Delete this file? Anything that links to it will show a broken image or a dead link.'
        : places.length
          ? `This file is in use:\n\n${places.map((p) => `• ${p}`).join('\n')}\n\nIf you delete it, those will show a broken image or a dead link. Delete it anyway?`
          : 'Nothing in the shop uses this file. Delete it?';
      if (!confirm(question)) return;
      try {
        await must(sb.storage.from('media').remove([del.dataset.delete, thumbPath(del.dataset.delete)]));
        sb.rpc('log_media_delete', { p_paths: [del.dataset.delete] }).then(() => {}, () => {});
        toast('File deleted');
        load(el);
      } catch (err) {
        toast(`Not deleted: ${friendlyError(err)}`, 'error');
      }
    }
  });
  load(el);
}

async function upload(el, files) {
  const chosen = [...files];
  const images = chosen.filter((f) => f.type.startsWith('image/'));
  const others = chosen.filter((f) => !f.type.startsWith('image/'));
  if (!chosen.length) return;
  const status = $('[data-upload-status]', el);
  const crop = $('#m-crop', el).value;
  const maxSize = Number($('#m-size', el).value);
  const all = [...images, ...others];
  let done = 0;
  const failed = [];
  for (const file of all) {
    setStatus(status, `Uploading ${++done} of ${all.length}…`);
    try {
      if (images.includes(file)) await uploadImage(file, FOLDER, { crop, maxSize, cacheControl: '3600', thumb: true });
      else await uploadFile(file, FOLDER);
    } catch (err) {
      failed.push(`${file.name}: ${friendlyError(err)}`);
    }
  }
  setStatus(status, failed.length ? `Uploaded ${all.length - failed.length}; failed: ${failed.join('; ')}` : `Uploaded ${all.length} ${all.length === 1 ? 'file' : 'files'}.`, failed.length ? 'error' : 'ok');
  load(el);
}

async function load(el, fresh = false) {
  const grid = $('[data-grid]', el);
  let data;
  try {
    // Every page of the folder: the small -sm.jpg copies count toward a listing's limit too.
    data = await listAllFiles(sb, 'media', FOLDER, { sortBy: { column: 'created_at', order: 'desc' } });
  } catch (error) {
    return (grid.innerHTML = `<li class="form-error">${esc(friendlyError(error))}</li>`);
  }
  files = data.filter((f) => f.id && (isLibraryImage(f.name) ? !/-sm\.jpg$/.test(f.name) : isLibraryFile(f.name))); // skip folder placeholders and the small copies
  bustAt = fresh ? Date.now() : 0;
  const pictures = files.filter((f) => isLibraryImage(f.name)).length;
  const docs = files.length - pictures;
  $('[data-count]', el).textContent = [pictures && `${pictures} ${pictures === 1 ? 'image' : 'images'}`, docs && `${docs} ${docs === 1 ? 'file' : 'files'}`].filter(Boolean).join(' · ') || '0 files';
  render(el);
}

/** Draw the Library in the chosen order. */
function render(el) {
  const grid = $('[data-grid]', el);
  grid.innerHTML = files.length
    ? [...files]
        .sort(SORTS[sort].cmp)
        .map((f) => {
          const path = `${FOLDER}/${f.name}`;
          const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
          const shown = bustAt ? `${url}?v=${bustAt}` : url; // preview only; the copied link stays clean
          const kb = Math.round((f.metadata?.size ?? 0) / 1024);
          const picture = isLibraryImage(f.name);
          const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
          return `<li class="media-item">
            <p class="card__meta media-item__name" title="${esc(f.name)}">${esc(shortName(f.name))} · ${size}</p>
            ${picture
              ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(shown)}" alt="${esc(f.name)}" loading="lazy"></a>`
              : `<a class="media-item__file" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Open ${esc(f.name)}"><span>${esc(fileExt(f.name).toUpperCase())}</span></a>`}
            <div class="media-item__actions">
              <button class="icon-btn" type="button" data-copy="${esc(url)}" aria-label="Copy link to ${esc(f.name)}" title="Copy link">${solidIcon('link', 20)}</button>
              ${picture ? `<label class="icon-btn media-replace" title="Replace">${solidIcon('swap', 20)}<input type="file" accept="image/*" class="visually-hidden" data-replace="${esc(path)}" aria-label="Replace ${esc(f.name)} with a new image"></label>` : ''}
              ${isOwner ? `<button class="icon-btn icon-btn--remove" type="button" data-delete="${esc(path)}" aria-label="Delete ${esc(f.name)}" title="Delete">${solidIcon('trash', 20)}</button>` : ''}
            </div>
          </li>`;
        })
        .join('')
    : '<li class="empty">Nothing here yet.</li>';
}

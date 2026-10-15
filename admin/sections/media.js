// Media library: images for news posts, emails, socials… Upload several at
// once (resized and optionally cropped in the browser), copy each one's link,
// delete ones no longer needed. Stored in Storage under media/library/.

import { $, esc, must, toast, uploadImage, replaceImage, thumbPath, CROPS, setStatus, solidIcon, friendlyError, setupTabs } from '../lib.js';

const FOLDER = 'library';
let sb;
let isOwner = false;
let showTab = () => {};

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
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="library">Library <span class="admin-tab__badge" data-image-count hidden></span></button>
      <button type="button" class="admin-tab" role="tab" data-tab="upload">Upload</button>
    </div>
    <p class="admin-hint">Images for news posts, emails, social media and series covers. Each upload is resized to the chosen size — the original file is never changed. To fix or update a picture without breaking anything that uses it, press <strong>Replace</strong> on it: the new image takes the old one’s place under the same link (it uses the Crop and Longest side chosen below, and can take up to an hour to show for people who already loaded the old one).</p>
    <div data-tabpane="upload">
    <div class="panel media-upload">
      <div class="form-grid">
        <div class="field"><label for="m-crop">Crop</label><select id="m-crop">${Object.entries(CROPS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}</select></div>
        <div class="field"><label for="m-size">Longest side</label><select id="m-size"><option value="2000">Large (2000px)</option><option value="1600" selected>Medium (1600px)</option><option value="1080">Social (1080px)</option><option value="800">Small (800px)</option><option value="400">Extra Small (400px)</option></select></div>
      </div>
      <label class="dropzone" for="m-files">
        <input id="m-files" type="file" accept="image/*" multiple class="visually-hidden">
        <strong>Choose images</strong> or drop them here — several at once is fine
      </label>
      <p class="admin-status" role="status" data-upload-status></p>
    </div>
    </div>
    <div data-tabpane="library">
    <p class="results-count" data-count></p>
    <ul class="media-grid" data-grid></ul>
    </div>`;
  showTab = setupTabs(el, 'admin-media-tab', 'library');

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
        ? 'Delete this image? Anything that links to it will show a broken image.'
        : places.length
          ? `This image is in use:\n\n${places.map((p) => `• ${p}`).join('\n')}\n\nIf you delete it, those will show a broken image. Delete it anyway?`
          : 'Nothing in the shop uses this image. Delete it?';
      if (!confirm(question)) return;
      try {
        await must(sb.storage.from('media').remove([del.dataset.delete, thumbPath(del.dataset.delete)]));
        sb.rpc('log_media_delete', { p_paths: [del.dataset.delete] }).then(() => {}, () => {});
        toast('Image deleted');
        load(el);
      } catch (err) {
        toast(`Not deleted: ${friendlyError(err)}`, 'error');
      }
    }
  });
  load(el);
}

async function upload(el, files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  const status = $('[data-upload-status]', el);
  const crop = $('#m-crop', el).value;
  const maxSize = Number($('#m-size', el).value);
  let done = 0;
  const failed = [];
  for (const file of images) {
    setStatus(status, `Uploading ${++done} of ${images.length}…`);
    try {
      await uploadImage(file, FOLDER, { crop, maxSize, cacheControl: '3600', thumb: true });
    } catch (err) {
      failed.push(`${file.name}: ${friendlyError(err)}`);
    }
  }
  if (!failed.length) showTab('library');
  setStatus(status, failed.length ? `Uploaded ${images.length - failed.length}; failed: ${failed.join('; ')}` : `Uploaded ${images.length} ${images.length === 1 ? 'image' : 'images'}.`, failed.length ? 'error' : 'ok');
  load(el);
}

async function load(el, bust = false) {
  const grid = $('[data-grid]', el);
  const { data, error } = await sb.storage.from('media').list(FOLDER, { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return (grid.innerHTML = `<li class="form-error">${esc(friendlyError(error))}</li>`);
  const files = data.filter((f) => f.id && !/-sm\.jpg$/.test(f.name)); // skip folder placeholders and the small copies
  $('[data-count]', el).textContent = `${files.length} ${files.length === 1 ? 'image' : 'images'}`;
  const badge = $('[data-image-count]', el);
  if (badge) (badge.textContent = files.length), (badge.hidden = !files.length);
  grid.innerHTML = files.length
    ? files
        .map((f) => {
          const path = `${FOLDER}/${f.name}`;
          const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
          const shown = bust ? `${url}?v=${Date.now()}` : url; // preview only; the copied link stays clean
          const kb = Math.round((f.metadata?.size ?? 0) / 1024);
          return `<li class="media-item">
            <a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(shown)}" alt="${esc(f.name)}" loading="lazy"></a>
            <p class="card__meta media-item__name" title="${esc(f.name)}">${esc(f.name.replace(/^[a-z0-9]+-/, ''))} · ${kb} KB</p>
            <div class="media-item__actions">
              <button class="btn btn--ghost btn--small" type="button" data-copy="${esc(url)}">${solidIcon('link', 16)} Copy link</button>
              <label class="btn btn--ghost btn--small media-replace">${solidIcon('swap', 16)} Replace<input type="file" accept="image/*" class="visually-hidden" data-replace="${esc(path)}" aria-label="Replace ${esc(f.name)} with a new image"></label>
              ${isOwner ? `<button class="btn btn--danger btn--small" type="button" data-delete="${esc(path)}" aria-label="Delete ${esc(f.name)}">${solidIcon('trash', 16)} Delete</button>` : ''}
            </div>
          </li>`;
        })
        .join('')
    : '<li class="empty">No images yet.</li>';
}

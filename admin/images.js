// Pictures and files: resize and crop in the browser, upload to Storage, the Media Library listing and the image field.

import { $, uid, esc, db, setStatus, solidIcon, openDialog, friendlyError, listAllFiles, slugify } from './lib.js';
import { putMedia } from '../js/media-store.js';

export const CROPS = {
  original: { label: 'Original shape', ratio: null },
  cover: { label: 'Cover (2:3)', ratio: 2 / 3 },
  square: { label: 'Square (1:1)', ratio: 1 },
  wide: { label: 'Wide (16:9)', ratio: 16 / 9 },
};

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(Object.assign(img, { _url: url }));
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} isn't an image this browser can read`));
    };
    img.src = url;
  });
}

/**
 * Resize (and optionally center-crop) an image file, or with `exact` crop it to that shape at exactly that size. Keeps PNG for images with
 * transparency (logos, Funko renders); everything else becomes JPEG.
 * @returns {Promise<{ blob: Blob, type: string, ext: string, width: number, height: number }>}
 */
export async function processImage(file, { maxSize = 1600, crop = 'original', quality = 0.86, flatten = false, exact = null } = {}) {
  if (file.type === 'image/svg+xml') {
    if (exact) throw new Error('Upload a PNG or JPEG picture here, not an SVG.');
    return { blob: file, type: file.type, ext: 'svg' };
  }
  const img = await loadImage(file);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  const ratio = exact ? exact[0] / exact[1] : CROPS[crop]?.ratio;
  if (ratio) {
    if (sw / sh > ratio) { const w = sh * ratio; sx = (sw - w) / 2; sw = w; }
    else { const h = sw / ratio; sy = (sh - h) / 2; sh = h; }
  }
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  // `exact` [width, height]: cropped to that shape and saved at exactly that size, so the size can be stated where
  // it's used (the app's manifest)
  const [width, height] = exact ?? [Math.round(sw * scale), Math.round(sh * scale)];
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  if (flatten) {
    ctx.fillStyle = '#161616'; // transparent areas become the site's dark background (the small copy is always a JPEG)
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  URL.revokeObjectURL(img._url);
  const keepPng = !flatten && file.type === 'image/png' && hasTransparency(ctx, width, height);
  const type = keepPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((r) => canvas.toBlob(r, type, quality));
  return { blob, type, ext: keepPng ? 'png' : 'jpg', width, height };
}

function hasTransparency(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * 7) if (data[i] < 250) return true;
  return false;
}

/** Files other than pictures the Media Library takes (by extension; the type sent to Storage comes from here, never from the browser). */
export const FILE_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', mp3: 'audio/mpeg', mp4: 'video/mp4',
};
export const FILE_ACCEPT = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(',');
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const fileExt = (name) => /\.([a-z0-9]+)$/i.exec(String(name ?? ''))?.[1].toLowerCase() ?? '';
/** Is this Library file a picture (as opposed to a document, audio or video)? */
export const isLibraryImage = (name) => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(name);
/** Is this a file the Library takes besides pictures? */
export const isLibraryFile = (name) => fileExt(name) in FILE_TYPES;

/** Upload a document, audio or video file as it is (no resizing) under `folder`; returns { url, path }. */
export async function uploadFile(file, folder, { cacheControl = '3600' } = {}) {
  const ext = fileExt(file.name);
  if (!(ext in FILE_TYPES)) throw new Error(`.${ext || 'this'} files can’t be uploaded. Use ${Object.keys(FILE_TYPES).join(', ')}.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`That file is too large (${Math.round(MAX_FILE_BYTES / 1048576)} MB at most).`);
  const sb = await db();
  let base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'file';
  if (base.endsWith('-sm')) base += '-file';
  const path = `${folder}/${Date.now().toString(36)}-${base}.${ext}`;
  const url = await putMedia(sb, path, file, { contentType: FILE_TYPES[ext], cacheControl });
  return { url, path };
}

/** Long side of the small copy used on cards and lists (about 2x a phone card). */
const THUMB_SIZE = 560;

/** Where the small copy of the picture at `path` lives: the same name with "-sm.jpg" (see thumbOf in js/util.js). */
export const thumbPath = (path) => path.replace(/\.\w+$/, '-sm.jpg');

/** Save the small copy of `file` (same crop) next to the picture at `path`. Returns its public URL, or null for SVGs. */
async function saveThumb(sb, file, path, { crop, cacheControl }) {
  if (file.type === 'image/svg+xml') return null;
  const small = await processImage(file, { maxSize: THUMB_SIZE, crop, quality: 0.65, flatten: true });
  return putMedia(sb, thumbPath(path), small.blob, { contentType: small.type, cacheControl, upsert: true });
}

/**
 * Upload a processed image to Storage under `folder`; returns its public URL.
 * With `opts.thumb` it also saves the small copy next to it and returns that as `thumbUrl`.
 */
export async function uploadImage(file, folder, opts = {}) {
  const sb = await db();
  const out = await processImage(file, opts);
  let base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'image';
  if (base.endsWith('-sm')) base += '-img'; // "-sm" at the end of a name is how small copies are recognised
  const path = `${folder}/${Date.now().toString(36)}-${base}.${out.ext}`;
  const cacheControl = opts.cacheControl ?? '604800';
  const url = await putMedia(sb, path, out.blob, { contentType: out.type, cacheControl });
  const thumbUrl = opts.thumb ? await saveThumb(sb, file, path, { crop: opts.crop, cacheControl }) : null;
  return { url, thumbUrl, path, ...out };
}

/**
 * Put a new image at an existing Storage path, so its link (and everything using it) stays the same.
 * Kept to a short browser cache so visitors see the new picture within the hour.
 */
export async function replaceImage(file, path, opts = {}) {
  const sb = await db();
  const out = await processImage(file, opts);
  const url = await putMedia(sb, path, out.blob, { contentType: out.type, cacheControl: '3600', upsert: true });
  if (opts.thumb) await saveThumb(sb, file, path, { crop: opts.crop, cacheControl: '3600' }); // same picture, so the small copy follows it
  return { url, path, ...out };
}

/**
 * An image field: preview + Upload/Remove buttons, writing the URL into a hidden input.
 * Returns { get(), getThumb(), set(url, thumbUrl) }. With `thumb`, an upload also makes a small copy;
 * getThumb() is its address (null when the picture was chosen from Media or removed).
 */
export function imageField(root, { folder, crop = 'original', maxSize = 1600, label = 'Image', library = false, thumb = false, exact = null }) {
  const id = uid('img');
  // Several image fields can share a screen (Shop Settings has eight), so each button says which picture it's for to a
  // screen reader: "Upload… App icon", not one of eight bare "Upload…".
  const forWhat = `<span class="visually-hidden"> ${esc(label)}</span>`;
  root.innerHTML = `
    <span class="label">${esc(label)}</span>
    <div class="image-field">
      <div class="image-field__preview"></div>
      <div class="image-field__controls">
        <input id="${id}" type="file" accept="image/*" class="visually-hidden">
        <label class="btn btn--ghost btn--small" for="${id}">Upload…${forWhat}</label>
        ${library ? `<button type="button" class="btn btn--ghost btn--small" data-library>Choose from Media…${forWhat}</button>` : ''}
        <button type="button" class="btn btn--danger btn--small" data-remove>${solidIcon('remove', 16)} Remove${forWhat}</button>
        <span class="admin-status" role="status"></span>
      </div>
    </div>`;
  let url = null;
  let thumbUrl = null;
  const preview = $('.image-field__preview', root);
  const status = $('.admin-status', root);
  const render = () => {
    preview.innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span class="image-field__none">No image</span>';
    $('[data-remove]', root).hidden = !url;
  };
  $('input[type=file]', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus(status, 'Uploading…');
    try {
      const saved = await uploadImage(file, folder, { crop, maxSize, thumb, exact });
      url = saved.url;
      thumbUrl = saved.thumbUrl;
      setStatus(status, '');
      render();
      root.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
    e.target.value = '';
  });
  $('[data-library]', root)?.addEventListener('click', async () => {
    try {
      const files = await libraryImages();
      const urls = files.map((f) => f.url);
      const d = openDialog('Choose from Media', files.length
        ? `<p class="field__hint">Pick an image from the Media Library. It is linked, not copied, so the same image can be used again and again.</p>
          <ul class="media-grid media-pick">${urls.map((u, i) => `<li class="media-item"><button type="button" class="media-pick__btn" data-url="${esc(u)}" aria-label="Use ${esc(files[i].name)}"><img src="${esc(u)}" alt="" loading="lazy"></button>
          </li>`).join('')}</ul>`
        : '<p class="empty">The Media Library is empty. Upload images under Media first.</p>', { wide: true });
      d.addEventListener('click', (e) => {
        const b = e.target.closest('[data-url]');
        if (!b) return;
        url = b.dataset.url;
        thumbUrl = null; // a Media Library picture has its own small copy, found by name
        render();
        root.dispatchEvent(new Event('change', { bubbles: true }));
        d.close();
      });
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
  });
  $('[data-remove]', root).addEventListener('click', () => {
    if (!confirm('Remove this image? It stops showing once you save.')) return;
    url = null;
    thumbUrl = null;
    render();
    root.dispatchEvent(new Event('change', { bubbles: true }));
  });
  render();
  return { get: () => url, getThumb: () => (url ? thumbUrl : null), set: (u, t) => ((url = u || null), (thumbUrl = url ? t || null : null), render()) };
}

/** The Media Library's files that pass `keep(name)`, newest first, as [{ name, url }]. */
export async function libraryFiles(keep) {
  const sb = await db();
  const files = await listAllFiles(sb, 'media', 'library', { sortBy: { column: 'created_at', order: 'desc' } });
  return files.filter((f) => f.id && keep(f.name)).map((f) => ({ name: f.name, url: sb.storage.from('media').getPublicUrl(`library/${f.name}`).data.publicUrl }));
}
/** The Library's pictures: small copies ("-sm.jpg") and documents aren't listed as pictures. */
export const libraryImages = () => libraryFiles((name) => isLibraryImage(name) && !/-sm\.jpg$/.test(name));

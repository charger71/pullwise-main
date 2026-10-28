// We Buy Comics: the page text comes from Pages in the admin; this adds the "send us photos" form.
import { initPage, $ } from '../site.js';
import { sendSellInquiry } from '../data.js';

await initPage();
mountSellForm($('#sell-col'));

/** Shrink a phone photo to ~1600px JPEG so a handful of them upload quickly. Falls back to the original. */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file; // e.g. HEIC the browser can't decode
  }
}

function mountSellForm(root) {
  root.insertAdjacentHTML('beforeend', `
    <h2 id="sell-form-h" class="mt-0">Send us a few pictures</h2>
    <p>Not ready to haul everything in? Tell us what you have and attach a few photos (up to 8) of the covers, the boxes, or the best books. We'll reply with our interest and next steps.</p>
    <form id="sell-form" class="panel" novalidate aria-labelledby="sell-form-h">
      <div hidden aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <div class="field"><label for="sf-name">Your name <span aria-hidden="true">*</span></label><input id="sf-name" name="name" autocomplete="name" maxlength="100" required></div>
      <div class="field"><label for="sf-email">Email <span aria-hidden="true">*</span></label><input id="sf-email" name="email" type="email" autocomplete="email" maxlength="200" required></div>
      <div class="field"><label for="sf-phone">Phone (optional)</label><input id="sf-phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div>
      <div class="field"><label for="sf-loc">Town or area (optional)</label><input id="sf-loc" name="location" maxlength="200"><p class="field__hint">Helps us tell whether a house call makes sense.</p></div>
      <div class="field"><label for="sf-details">What do you have?</label><textarea id="sf-details" name="details" rows="5" maxlength="4000" placeholder="Roughly how many books, titles or eras, condition, anything graded or special…"></textarea></div>
      <div class="field"><label for="sf-photos">Photos</label><input id="sf-photos" name="photos" type="file" accept="image/*" multiple><p class="field__hint" id="sf-photo-note">Up to 8 pictures.</p></div>
      <p class="form-error" role="alert" id="sf-err"></p>
      <button class="btn btn--primary" type="submit">Send</button>
    </form>`);
  const form = $('#sell-form', root);
  const err = $('#sf-err', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const photos = [...form.elements.photos.files];
    if (!form.elements.name.value.trim()) return (err.textContent = 'Please tell us your name.'), form.elements.name.focus();
    if (!form.elements.email.validity.valid || !form.elements.email.value.trim()) return (err.textContent = 'Please enter a valid email address so we can reply.'), form.elements.email.focus();
    if (!form.elements.details.value.trim() && !photos.length) return (err.textContent = 'Please describe your collection or add a few photos.'), form.elements.details.focus();
    if (photos.length > 8) return (err.textContent = 'Please choose no more than 8 photos.');
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = photos.length ? 'Sending photos…' : 'Sending…';
    try {
      const data = new FormData(form);
      data.delete('photos');
      for (const f of await Promise.all(photos.map(shrink))) data.append('photos', f, f.name);
      await sendSellInquiry(data);
      form.innerHTML = '<h2>Thank you!</h2><p>We got your message and will reply by email soon.</p>';
      form.focus?.();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  });
}

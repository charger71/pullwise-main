// Help: guides for every admin screen, with screenshots and short captioned walk-through videos.
// "#help" lists the topics (admin/help/topics.js); "#help/<topic>" opens one. The words are admin/help/articles/<id>.js;
// the pictures and videos are made by tools/help-capture (npm run help:capture) and listed in admin/help/media/captured.js,
// so a topic whose media hasn't been captured yet shows its words without broken pictures.

import { $, $$, esc, hintFold, debounce } from '../lib.js';
import { GROUPS, TOPICS, CAPTURED } from '../help/topics.js';
import { render, plain, MEDIA } from '../help/markdown.js';

const SCREEN_NAMES = {
  dashboard: 'Dashboard', analytics: 'Analytics', reservations: 'Ordering', customers: 'Customers', chat: 'Chat', titles: 'Titles',
  series: 'Series', emails: 'Emails', pages: 'Pages', news: 'News', events: 'Events', media: 'Media', faq: 'FAQ', qr: 'QR Codes',
  surveys: 'Surveys', import: 'Import', settings: 'Shop Settings', locations: 'Locations', staff: 'Staff', backup: 'Backup',
};
const OWNER_ONLY = ['import', 'settings', 'locations', 'backup'];

const articles = new Map(); // id → markdown
const article = async (id) => {
  if (!articles.has(id)) articles.set(id, (await import(`../help/articles/${id}.js`)).default);
  return articles.get(id);
};
const hasVideo = (t) => !!t.video && CAPTURED.videos.includes(t.video);

export async function mount(el, { arg, isOwner }) {
  const topic = TOPICS.find((t) => t.id === arg);
  if (topic) return showTopic(el, topic, isOwner);
  showIndex(el);
}

function showIndex(el) {
  el.innerHTML = `
    <div class="admin-title-row"><h1>Help</h1></div>
    ${hintFold('Step-by-step guides for every screen, with pictures and short videos. The <strong>?</strong> beside any screen’s title opens a quick summary of that screen, with a link to its full guide here.')}
    <form class="help-search" role="search" data-search>
      <div class="field field--search"><label for="help-q">Search help</label><input id="help-q" name="q" type="search" placeholder="For example: export, approve, password, cutoff" autocomplete="off"></div>
    </form>
    <p class="admin-status" role="status" data-count></p>
    ${GROUPS.map(([key, name]) => `
      <section class="panel help-group" data-group="${key}">
        <h2>${esc(name)}</h2>
        <ul class="help-topics">${TOPICS.filter((t) => t.group === key).map((t) => `
          <li data-topic="${t.id}"><a class="help-topic" href="#help/${t.id}">
            <span class="help-topic__title">${esc(t.title)}</span>
            <span class="help-topic__summary">${esc(t.summary)}</span>
            ${hasVideo(t) ? '<span class="help-topic__video">Video</span>' : ''}
          </a></li>`).join('')}
        </ul>
      </section>`).join('')}
    <p class="empty" data-none hidden>No guide mentions that. Try a shorter word, or the name of the screen.</p>`;

  const form = $('[data-search]', el);
  form.addEventListener('submit', (e) => e.preventDefault());
  let words = null; // id → searchable text, loaded on the first search
  const search = debounce(async () => {
    const q = form.elements.q.value.trim().toLowerCase();
    if (q && !words) {
      words = new Map(await Promise.all(TOPICS.map(async (t) => [t.id, `${t.title} ${t.summary} ${plain(await article(t.id).catch(() => ''))}`.toLowerCase()])));
    }
    const terms = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    $$('[data-topic]', el).forEach((li) => {
      const hit = !terms.length || terms.every((w) => words.get(li.dataset.topic).includes(w));
      li.hidden = !hit;
      shown += hit;
    });
    $$('[data-group]', el).forEach((g) => (g.hidden = !$('[data-topic]:not([hidden])', g)));
    $('[data-none]', el).hidden = shown > 0;
    $('[data-count]', el).textContent = terms.length ? `${shown} ${shown === 1 ? 'guide' : 'guides'} found` : '';
  }, 150);
  form.elements.q.addEventListener('input', search);
}

async function showTopic(el, topic, isOwner) {
  const i = TOPICS.indexOf(topic);
  const [prev, next] = [TOPICS[i - 1], TOPICS[i + 1]];
  let body;
  try {
    body = render(await article(topic.id), { shots: CAPTURED.shots });
  } catch {
    body = '<p class="form-error">Couldn’t open this guide. Reload the page and try again.</p>';
  }
  const screens = topic.screens.filter((s) => isOwner || !OWNER_ONLY.includes(s));
  const v = hasVideo(topic) ? topic.video : null;
  el.innerHTML = `
    <p><a class="btn btn--ghost btn--small" href="#help">← All help</a></p>
    <div class="admin-title-row"><h1>${esc(topic.title)}</h1></div>
    ${hintFold(`${esc(topic.summary)} Pictures and videos come from the Pullwise demo shop, so names and numbers won’t match yours.`)}
    ${v ? `
      <figure class="help-video">
        <video controls preload="metadata" playsinline poster="${MEDIA}${v}.jpg" width="1280" height="800">
          <source src="${MEDIA}${v}.mp4" type="video/mp4">
          <track kind="captions" src="${MEDIA}${v}.vtt" srclang="en" label="English">
        </video>
        <figcaption>Walk-through video, no sound. The steps are written out below.</figcaption>
      </figure>` : ''}
    <article class="help-article">${body}</article>
    ${screens.length ? `<p class="help-open">${screens.map((s) => `<a class="btn btn--primary" href="#${s}">Open ${esc(SCREEN_NAMES[s] ?? s)}</a>`).join(' ')}</p>` : ''}
    <nav class="help-pager" aria-label="More help">
      ${prev ? `<a class="help-pager__link" href="#help/${prev.id}"><span class="help-pager__dir">Previous</span>${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="help-pager__link help-pager__link--next" href="#help/${next.id}"><span class="help-pager__dir">Next</span>${esc(next.title)}</a>` : ''}
    </nav>`;
  // Opened from a link inside the guide or the pager: start at the top, not where the last guide was scrolled to.
  window.scrollTo({ top: 0 });
}

// A page staff created in the admin: page.html?slug=…
import { initPage, $, esc } from '../site.js';
import { getCustomPage } from '../data.js';
import { renderRich } from '../content.js';

// The We Buy Comics page (once a staff-made page) is now we-buy-comics.html; keep old shared links working.
if (['sell-your-stuff', 'we-buy-comics'].includes(new URLSearchParams(location.search).get('slug'))) location.replace('we-buy-comics.html');

const s = await initPage();
const page = await getCustomPage(new URLSearchParams(location.search).get('slug') ?? '').catch((err) => (console.error(err), null));
const el = $('#custom-page');

if (!page) {
  document.title = `${s.shop_name} — Page Not Found`;
  el.innerHTML = '<h1>Page Not Found</h1><p><a href="index.html">← Home</a></p>';
} else {
  document.title = `${s.shop_name} — ${page.meta_title || page.title}`;
  if (page.meta_description) {
    const meta = document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'description', content: page.meta_description }));
    meta.dataset.seo = '';
  }
  const [lede, body] = await Promise.all([renderRich(page.lede_html, s), renderRich(page.body_html, s)]);
  el.innerHTML = `
    <h1>${esc(page.title)}</h1>
    ${lede.trim() ? `<div class="lede">${lede}</div>` : ''}
    ${body.trim() ? `<div class="page-body">${body}</div>` : ''}`;
}

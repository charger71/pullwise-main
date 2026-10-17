// A page staff created in the admin: page.html?slug=…
import { initPage, $, esc } from '../site.js';
import { getCustomPage } from '../data.js';
import { renderRich } from '../content.js';
import { setPageMeta, snippet, htmlSnippet } from '../page-meta.js';

// The We Buy Comics page (once a staff-made page) is now we-buy-comics.html; keep old shared links working.
if (['sell-your-stuff', 'we-buy-comics'].includes(new URLSearchParams(location.search).get('slug'))) location.replace('we-buy-comics.html');

const s = await initPage();
// undefined = couldn't load (network, database), null = no such page.
const page = await getCustomPage(new URLSearchParams(location.search).get('slug') ?? '').catch((err) => (console.error(err), undefined));
const el = $('#custom-page');

if (page === undefined) {
  setPageMeta({ title: s.shop_name, noindex: true });
  el.innerHTML = `<h1>We Couldn't Load This Page</h1><p>Please check your connection and try again in a moment.</p><p><a href="index.html">← Home</a></p>`;
} else if (!page) {
  setPageMeta({ title: `${s.shop_name} — Page Not Found`, noindex: true });
  el.innerHTML = '<h1>Page Not Found</h1><p><a href="index.html">← Home</a></p>';
} else {
  setPageMeta({
    title: `${s.shop_name} — ${page.meta_title || page.title}`,
    description: page.meta_description?.trim() || htmlSnippet(page.lede_html) || htmlSnippet(page.body_html),
  });
  const failed = '<p>Sorry, this page couldn’t be shown right now. Please try again in a moment.</p>';
  const [lede, body] = await Promise.all([renderRich(page.lede_html, s), renderRich(page.body_html, s)]).catch((err) => (console.error(err), ['', failed]));
  el.innerHTML = `
    <h1>${esc(page.title)}</h1>
    ${lede.trim() ? `<div class="lede">${lede}</div>` : ''}
    ${body.trim() ? `<div class="page-body">${body}</div>` : ''}`;
}

import { initPage, $, esc, fmtDate } from '../site.js';
import { getPost } from '../data.js';
import { renderRich } from '../content.js';
import { setPageMeta, snippet, htmlSnippet } from '../page-meta.js';
import { postSlugHere } from '../optional-pages.js';

const s = await initPage();
const el = $('#post');
// undefined = couldn't load (network, database), null = no such post.
const post = await getPost(postSlugHere(location.pathname, location.search) ?? '').catch((err) => (console.error(err), undefined));

if (post === undefined) {
  setPageMeta({ title: `${s.shop_name} — News`, noindex: true });
  el.innerHTML = `<h1>We Couldn't Load This Post</h1><p>Please check your connection and try again in a moment.</p><p><a href="blog.html">← All news</a></p>`;
} else if (!post) {
  setPageMeta({ title: `${s.shop_name} — Post Not Found`, noindex: true });
  el.innerHTML = '<h1>Post Not Found</h1><p><a href="blog.html">← All news</a></p>';
} else {
  setPageMeta({ title: `${s.shop_name} — ${post.title}`, description: snippet(post.excerpt) || htmlSnippet(post.body) });
  // body is written by staff in the admin WYSIWYG editor; sanitized before showing.
  const body = await renderRich(post.body, s).catch((err) => (console.error(err), '<p>Sorry, the rest of this post couldn’t be shown right now. Please try again in a moment.</p>'));
  el.innerHTML = `
    <p><a href="blog.html">← All news</a></p>
    <time class="card__meta" datetime="${esc(post.published_at)}">${fmtDate(post.published_at, { month: 'long', day: 'numeric', year: 'numeric' })}</time>
    <h1>${esc(post.title)}</h1>
    ${post.cover_url ? `<a href="${esc(post.cover_url)}" data-lightbox><img src="${esc(post.cover_url)}" alt="${esc(post.title)}" loading="lazy" class="post__cover"></a>` : ''}
    ${body}`;
}

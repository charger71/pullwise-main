import { initPage, $, esc, fmtDate } from '../site.js';
import { getPost } from '../data.js';
import { renderRich } from '../content.js';

const s = await initPage();
const post = await getPost(new URLSearchParams(location.search).get('slug') ?? '');
const el = $('#post');

if (!post) {
  el.innerHTML = '<h1>Post Not Found</h1><p><a href="blog.html">← All news</a></p>';
} else {
  document.title = `${s.shop_name} — ${post.title}`;
  // body is written by staff in the admin WYSIWYG editor; sanitized before showing.
  const body = await renderRich(post.body, s);
  el.innerHTML = `
    <p><a href="blog.html">← All news</a></p>
    <time class="card__meta" datetime="${esc(post.published_at)}">${fmtDate(post.published_at, { month: 'long', day: 'numeric', year: 'numeric' })}</time>
    <h1>${esc(post.title)}</h1>
    ${post.cover_url ? `<a href="${esc(post.cover_url)}" data-lightbox><img src="${esc(post.cover_url)}" alt="${esc(post.title)}" loading="lazy" style="border-radius:var(--radius);margin-bottom:1em"></a>` : ''}
    ${body}`;
}

import { initPage, $, esc, fmtDate } from '../site.js';
import { getPosts } from '../data.js';

await initPage();
const posts = await getPosts().catch((err) => (console.error(err), null));
$('#posts').innerHTML = !posts
  ? '<li class="empty">We couldn’t load the news just now. Please try again in a moment.</li>'
  : posts.length
  ? posts
      .map(
        (p) => `<li class="panel">
          <time datetime="${esc(p.published_at)}">${fmtDate(p.published_at, { month: 'long', day: 'numeric', year: 'numeric' })}</time>
          <h2 class="post-list__title"><a href="post.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h2>
          ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
        </li>`,
      )
      .join('')
  : '<li class="empty">No posts yet.</li>';

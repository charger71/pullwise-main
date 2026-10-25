// News: blog posts (new-release roundups, shop news). Drafts stay private
// until published; a future publish time schedules the post.

import { $, $$, esc, must, toast, imageField, makeEditor, setHtml, getHtml, setStatus, toLocalInput, fromLocalInput, fmtDateTime, slugify, sortableTable, solidIcon, friendlyError } from '../lib.js';

let sb;
let tab = 'all'; // all | published | scheduled | drafts
const kindOf = (p, now) => (!p.published_at ? 'drafts' : p.published_at > now ? 'scheduled' : 'published');

export async function mount(el, ctx) {
  sb = ctx.sb;
  showList(el);
}

function showList(el) {
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>News</h1>
      <button class="btn btn--add" type="button" data-new>${solidIcon('add', 18)} New post</button>
    </div>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-news="all">All</button>
      <button type="button" class="admin-tab" role="tab" data-news="published">Published</button>
      <button type="button" class="admin-tab" role="tab" data-news="scheduled">Scheduled</button>
      <button type="button" class="admin-tab" role="tab" data-news="drafts">Drafts <span class="admin-tab__badge" data-draft-count hidden></span></button>
    </div>
    <div data-list></div>`;
  try {
    tab = sessionStorage.getItem('admin-news-tab') || tab;
  } catch {
    /* start on All */
  }
  $$('[data-news]', el).forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.news;
      try {
        sessionStorage.setItem('admin-news-tab', tab);
      } catch {
        /* remembering the tab is optional */
      }
      load(el);
    }),
  );
  $('[data-new]', el).addEventListener('click', () => edit(el, null));
  $('[data-list]', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) edit(el, Number(b.dataset.edit));
  });
  load(el);
}

async function load(el) {
  const box = $('[data-list]', el);
  const { data: all, error } = await sb.from('posts').select('id,title,slug,published_at,updated_at').order('published_at', { ascending: false, nullsFirst: true }).order('updated_at', { ascending: false });
  if (error) return (box.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
  const now = new Date().toISOString();
  $$('[data-news]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.news === tab));
  const drafts = all.filter((p) => kindOf(p, now) === 'drafts').length;
  const badge = $('[data-draft-count]', el);
  if (badge) (badge.textContent = drafts), (badge.hidden = !drafts);
  const data = all.filter((p) => tab === 'all' || kindOf(p, now) === tab);
  box.innerHTML = data.length
    ? `<table class="admin-table cards"><thead><tr><th scope="col" data-sort="text">Post</th><th scope="col" data-sort="text" data-first="desc">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${data
        .map((p) => {
          const state = !p.published_at ? '<span class="pill pill--sold_out">Draft</span>' : p.published_at > now ? `<span class="pill pill--backorder">Scheduled ${fmtDateTime(p.published_at)}</span>` : `<span class="pill pill--available">Published ${fmtDateTime(p.published_at)}</span>`;
          return `<tr><td class="card-title"><strong>${esc(p.title)}</strong></td><td class="card-wide" data-sort="${p.published_at ?? ''}">${state}</td><td class="nowrap card-foot"><button class="btn btn--ghost btn--small" type="button" data-edit="${p.id}">${solidIcon('edit', 16)} Edit<span class="visually-hidden"> ${esc(p.title)}</span></button> ${p.published_at && p.published_at <= now ? `<a class="btn btn--ghost btn--small" href="../post.html?slug=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View ↗</a>` : ''}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : `<p class="empty">${all.length ? `No ${tab} posts.` : 'No posts yet.'}</p>`;
  if (data.length) sortableTable($('table', box));
}

async function edit(listEl, id) {
  const post = id ? await must(sb.from('posts').select('*').eq('id', id).single()) : {};
  const published = !!post.published_at;
  const d = listEl;
  const back = () => showList(listEl);
  d.innerHTML = `
    <p><button class="btn btn--ghost btn--small" type="button" data-back>← Back to news</button></p>
    <h1>${id ? 'Edit Post' : 'New Post'}</h1>
    <details class="fold fold--compact fold--static" open><summary class="fold__head"><h2>Post Details</h2></summary><div class="fold__body">
    <form class="admin-form" novalidate>
      <div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="p-title">Title <span class="req" aria-hidden="true">*</span></label><input id="p-title" name="title" required value="${esc(post.title)}"></div>
        <div class="field span-2"><label for="p-slug">Web address</label><input id="p-slug" name="slug" value="${esc(post.slug)}" aria-describedby="p-slug-hint"><p class="field__hint" id="p-slug-hint">post.html?slug=<span data-slug-preview>${esc(post.slug ?? '')}</span> — made from the title if left blank.</p></div>
        <div class="field span-2"><label for="p-excerpt">Summary</label><textarea id="p-excerpt" name="excerpt" rows="2" maxlength="300">${esc(post.excerpt)}</textarea><p class="field__hint">Shown in the News list.</p></div>
        <div class="field span-2"><span class="label" id="p-body-label">Post</span><div class="editor--body"><div data-body></div></div></div>
        <div class="field span-2" data-cover></div>
        <div class="checks span-2"><label><input type="checkbox" name="published"${published ? ' checked' : ''}> Published</label></div>
        <div class="field field--full"><label for="p-when">Publish time</label><input id="p-when" name="published_at" type="datetime-local" value="${toLocalInput(post.published_at ?? new Date().toISOString())}"><p class="field__hint">A future time schedules the post.</p></div>
      </div>
      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">Save</button>
        ${id ? `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>` : ''}
        <span class="admin-status" role="status"></span>
      </div>
    </form>
    </div></details>`;
  window.scrollTo(0, 0);
  $('[data-back]', d).addEventListener('click', back);
  const quill = makeEditor($('[data-body]', d), 'body', $('#p-body-label', d));
  setHtml(quill, post.body);
  const cover = imageField($('[data-cover]', d), { folder: 'posts', label: 'Cover image (optional)', maxSize: 1600 });
  cover.set(post.cover_url);
  const form = $('form', d);
  const status = $('.admin-status', d);
  const slugInput = form.elements.slug;
  const syncSlug = () => ($('[data-slug-preview]', d).textContent = slugInput.value.trim() || slugify(form.elements.title.value));
  form.elements.title.addEventListener('input', syncSlug);
  slugInput.addEventListener('input', syncSlug);
  syncSlug();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const title = f.get('title').trim();
    const row = {
      title,
      slug: slugify(f.get('slug').trim() || title),
      excerpt: f.get('excerpt').trim() || null,
      body: getHtml(quill),
      cover_url: cover.get(),
      published_at: f.has('published') ? fromLocalInput(f.get('published_at')) ?? new Date().toISOString() : null,
    };
    if (!title) return setStatus(status, 'Please enter a title.', 'error');
    if (!row.slug) return setStatus(status, 'Please enter a web address.', 'error');
    setStatus(status, 'Saving…');
    try {
      await must(id ? sb.from('posts').update(row).eq('id', id) : sb.from('posts').insert(row));
      toast(row.published_at ? 'Post saved' : 'Draft saved');
      back();
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-delete]', d)?.addEventListener('click', async () => {
    if (!confirm(`Delete “${post.title}”? This can’t be undone.`)) return;
    try {
      await must(sb.from('posts').delete().eq('id', id));
      toast('Post deleted');
      back();
    } catch (err) {
      setStatus(status, `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });
}

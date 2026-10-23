// FAQ: add, edit, reorder and delete questions (faqs table).

import { $, $$, esc, must, hintFold, setStatus, makeEditor, setHtml, getHtml, toast, solidIcon, friendlyError } from '../lib.js';

let items = []; // { id|null, el, quill, dirty }
export const hasUnsavedChanges = () => items.some((i) => i.dirty);

export async function mount(el, { sb }) {
  items = [];
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>FAQ</h1>
      <button class="btn btn--add" type="button" data-add>${solidIcon('add', 18)} Add question</button>
    </div>
    ${hintFold(`Questions appear on the FAQ page in this order. A new question is added at the bottom. The FAQ page's intro is under <a href="#pages">Pages → FAQ</a>.`)}
    <ol class="faq-items"></ol>`;
  const list = $('.faq-items', el);
  let rows;
  try {
    rows = await must(sb.from('faqs').select('*').order('sort').order('id'));
  } catch (err) {
    list.innerHTML = `<li class="form-error">Couldn’t load the FAQ: ${esc(friendlyError(err))}</li>`;
    return;
  }
  rows.forEach((f, i) => addItem(sb, list, f, i === 0)); // the first question starts open
  $('[data-add]', el).addEventListener('click', () => {
    const item = addItem(sb, list, { id: null, question: '', answer_html: '' }, true);
    item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('input', item.el).focus();
  });
}

function addItem(sb, list, f, open = false) {
  const el = document.createElement('li');
  el.className = 'faq-item' + (f.id ? '' : ' faq-item--unsaved');
  const qid = `faq-q-${Math.random().toString(36).slice(2)}`;
  el.innerHTML = `
    <details class="fold"${open ? ' open' : ''}>
      <summary class="fold__head">
        <span class="faq-item__num"></span>
        <span class="faq-item__q" data-q></span>
        <span class="faq-item__move">
          <button class="btn btn--ghost btn--small" type="button" data-move="-1" aria-label="Move question up">↑</button>
          <button class="btn btn--ghost btn--small" type="button" data-move="1" aria-label="Move question down">↓</button>
        </span>
      </summary>
      <div class="fold__body">
        <div class="field">
          <label for="${qid}">Question</label>
          <input id="${qid}" maxlength="300" value="${esc(f.question)}">
        </div>
        <span class="label" data-answer-label>Answer</span>
        <div class="editor--lede"><div data-answer></div></div>
        <div class="faq-item__actions sticky-actions">
          <button class="btn btn--primary" type="button" data-save>Save</button>
          <button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>
          <span class="admin-status" role="status"></span>
        </div>
      </div>
    </details>`;
  list.append(el);
  const quill = makeEditor($('[data-answer]', el), 'body', $('[data-answer-label]', el));
  setHtml(quill, f.answer_html);
  const item = { id: f.id, el, quill, dirty: !f.id };
  items.push(item);

  const status = $('.admin-status', el);
  const markDirty = () => {
    item.dirty = true;
    setStatus(status, 'Unsaved changes');
  };
  // The closed header shows the question's wording.
  const showQuestion = () => ($('[data-q]', el).textContent = $('input', el).value.trim() || '(new question)');
  showQuestion();
  quill.on('text-change', markDirty);
  $('input', el).addEventListener('input', () => {
    markDirty();
    showQuestion();
  });
  $('[data-save]', el).addEventListener('click', () => save(sb, item));
  $('[data-delete]', el).addEventListener('click', () => remove(sb, item));
  $$('[data-move]', el).forEach((b) => b.addEventListener('click', () => move(sb, list, item, Number(b.dataset.move))));
  return item;
}

async function save(sb, item) {
  const status = $('.admin-status', item.el);
  const question = $('input', item.el).value.trim();
  if (!question) return setStatus(status, 'Please enter the question.', 'error');
  const row = { question, answer_html: getHtml(item.quill) ?? '', sort: (items.indexOf(item) + 1) * 10 };
  const btn = $('[data-save]', item.el);
  if (btn.disabled) return; // a save is already on its way (a double click would add a new question twice)
  btn.disabled = true;
  setStatus(status, 'Saving…');
  try {
    const saved = item.id
      ? await must(sb.from('faqs').update(row).eq('id', item.id).select('id').single())
      : await must(sb.from('faqs').insert(row).select('id').single());
    item.id = saved.id;
    item.dirty = false;
    item.el.classList.remove('faq-item--unsaved');
    setStatus(status, 'Saved — live on the FAQ page.', 'ok');
  } catch (err) {
    setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function remove(sb, item) {
  const question = $('input', item.el).value.trim() || 'this question';
  if (!confirm(`Delete “${question}” from the FAQ? This can’t be undone.`)) return;
  try {
    if (item.id) await must(sb.from('faqs').delete().eq('id', item.id));
    items.splice(items.indexOf(item), 1);
    item.el.remove();
    toast('Question deleted');
  } catch (err) {
    setStatus($('.admin-status', item.el), `Not deleted: ${friendlyError(err)}`, 'error');
  }
}

/** Move a question up/down and save the new order of every saved question. */
async function move(sb, list, item, delta) {
  const i = items.indexOf(item);
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  items.forEach((f) => list.append(f.el));
  item.el.querySelector(`[data-move="${delta}"]`).focus();
  const saved = items.map((f, idx) => [f, (idx + 1) * 10]).filter(([f]) => f.id);
  const results = await Promise.all(saved.map(([f, sort]) => sb.from('faqs').update({ sort }).eq('id', f.id)));
  const failed = results.find((r) => r.error);
  const text = failed ? `Order not saved: ${friendlyError(failed.error)}` : 'Order saved.';
  setStatus($('.admin-status', item.el), text, failed ? 'error' : 'ok');
  // The status line is inside the question's fold, so a failure on a closed question also gets a toast.
  if (failed && !$('details', item.el).open) toast(text, 'error');
}

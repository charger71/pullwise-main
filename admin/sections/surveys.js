// Surveys: build a survey, open or close it, and read the answers.
// Customers answer at survey.html?s=<slug> (no login). Responses are private to staff.

import { $, $$, esc, must, toast, setStatus, slugify, fmtDateTime, downloadCsv, loadScript, solidIcon, friendlyError, setupTabs, fetchAll, hintFold, fmtDate } from '../lib.js';
import { QR_LIB, svgFor, newSlug, encodedText } from './qr.js';
import { SITE_URL } from '../../js/config.js';

const TYPES = { section: 'Section header (title, text and a divider)', text: 'Short answer', long: 'Long answer', choice: 'Pick one', multi: 'Pick any', rating: 'Rating 1–5', yesno: 'Yes / No' };
const HAS_OPTIONS = ['choice', 'multi'];
let sb;
let surveys = [];
let listTab = 'all'; // all | open | closed
let dirty = false;
export const hasUnsavedChanges = () => dirty;

// A full admin page in place of the survey list (with a way back), instead of a pop-up.
// The returned element has close(), which returns to the list.
function openPage(el, title, bodyHtml) {
  dirty = false;
  el.innerHTML = `
    <p><button class="btn btn--ghost btn--small" type="button" data-back>← Back to surveys</button></p>
    <h1>${esc(title)}</h1>
    ${bodyHtml}`;
  el.close = () => ((dirty = false), mount(el, { sb }));
  $('[data-back]', el).addEventListener('click', () => {
    if (!dirty || confirm('You have unsaved changes here. Leave anyway?')) el.close();
  });
  window.scrollTo(0, 0);
  return el;
}
const publicUrl = (slug, q = '') => `${(SITE_URL || location.origin).replace(/\/$/, '')}/survey.html?s=${encodeURIComponent(slug)}${q}`;

export async function mount(el, ctx) {
  sb = ctx.sb;
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Surveys</h1>
      <button class="btn btn--add" type="button" data-new>${solidIcon('add', 18)} New survey</button>
    </div>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-status="all">All</button>
      <button type="button" class="admin-tab" role="tab" data-status="open">Open <span class="admin-tab__badge" data-open-count hidden></span></button>
      <button type="button" class="admin-tab" role="tab" data-status="closed">Closed</button>
    </div>
    ${hintFold('Customers answer without signing in, at the survey\'s link. Only an open survey can be answered. Link to it from a news post, the Dashboard announcement or a custom page.')}
    <div data-list></div>`;
  try {
    listTab = sessionStorage.getItem('admin-surveys-tab') || listTab;
  } catch {
    /* start on All */
  }
  $$('[data-status]', el).forEach((b) =>
    b.addEventListener('click', () => {
      listTab = b.dataset.status;
      try {
        sessionStorage.setItem('admin-surveys-tab', listTab);
      } catch {
        /* remembering the tab is optional */
      }
      load(el);
    }),
  );
  $('[data-new]', el).addEventListener('click', () => edit(el, null));
  $('[data-list]', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit],[data-results],[data-share],[data-make-qr]');
    if (!b) return;
    if (b.dataset.makeQr) return makeQr(el, b);
    if (b.dataset.edit) edit(el, Number(b.dataset.edit));
    else if (b.dataset.share) edit(el, Number(b.dataset.share), 'share');
    else edit(el, Number(b.dataset.results), 'results');
  });
  load(el);
}

// Saves a forwarding code for the survey in Admin → QR Codes (scan counts, address can change later).
async function ensureQr(sv) {
  const url = publicUrl(sv.slug);
  const have = await must(sb.from('qr_codes').select('id').eq('target_url', url).eq('forward', true).limit(1));
  if (!have.length) await must(sb.from('qr_codes').insert({ name: `Survey: ${sv.title}`.slice(0, 120), target_url: url, forward: true, slug: newSlug() }));
}

async function makeQr(el, btn) {
  const sv = surveys.find((x) => x.id === Number(btn.dataset.makeQr));
  btn.disabled = true;
  try {
    await ensureQr(sv);
    await load(el);
  } catch (err) {
    btn.disabled = false;
    toast(`Not saved: ${friendlyError(err)}`, 'error');
  }
}

async function load(el) {
  const box = $('[data-list]', el);
  try {
    const all = (surveys = await must(sb.from('surveys').select('id,slug,title,is_open,questions,survey_responses(count)').order('created_at', { ascending: false })));
    const rows = all.filter((s) => listTab === 'all' || (listTab === 'open') === s.is_open);
    $$('[data-status]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.status === listTab));
    const openCount = all.filter((s) => s.is_open).length;
    const badge = $('[data-open-count]', el);
    if (badge) (badge.textContent = openCount), (badge.hidden = !openCount);
    // Saved forwarding codes (Admin → QR Codes) for these surveys, keyed by survey link; best effort.
    const saved = new Map();
    try {
      await loadScript(QR_LIB, 'Couldn’t load the QR code maker.');
      (await must(sb.from('qr_codes').select('slug,target_url,scan_count').eq('forward', true))).forEach((q) => saved.set(q.target_url, q));
    } catch { /* the column just shows direct codes without scan counts */ }
    const qrCell = (s) => {
      const q = saved.get(publicUrl(s.slug));
      if (!q) return `<td><button class="btn btn--ghost btn--small" type="button" data-make-qr="${s.id}">Make QR code</button></td>`;
      return `<td><a class="btn btn--ghost btn--small" href="#qr" title="Opens this survey's code in QR Codes">View QR code</a><br><span class="card__meta">${q.scan_count} scan${Number(q.scan_count) === 1 ? '' : 's'}</span></td>`;
    };
    box.innerHTML = rows.length
      ? `<div class="admin-table-wrap"><table class="admin-table cards"><thead><tr><th scope="col">Survey</th><th scope="col">Status</th><th scope="col">Answers</th><th scope="col">QR code</th><th scope="col">Share</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows
          .map((s) => `<tr><td class="card-title"><strong>${esc(s.title)}</strong><br><span class="card__meta">${s.questions.filter((q) => q.type !== 'section').length} question${s.questions.filter((q) => q.type !== 'section').length === 1 ? '' : 's'}</span></td><td class="card-key">${s.is_open ? 'Open' : 'Closed'}</td><td class="card-key card-label">${s.survey_responses[0].count}</td>${qrCell(s)}<td class="card-foot"><a href="../survey.html?s=${encodeURIComponent(s.slug)}&amp;preview=1" target="_blank" rel="noopener">Preview<span class="visually-hidden"> ${esc(s.title)}</span></a> · <button class="btn btn--ghost btn--small" type="button" data-share="${s.id}">Link<span class="visually-hidden"> for ${esc(s.title)}</span></button></td><td class="nowrap card-foot"><button class="btn btn--ghost btn--small" type="button" data-results="${s.id}">Results<span class="visually-hidden"> for ${esc(s.title)}</span></button> <button class="btn btn--ghost btn--small" type="button" data-edit="${s.id}">${solidIcon('edit', 16)} Edit<span class="visually-hidden"> ${esc(s.title)}</span></button></td></tr>`)
          .join('')}</tbody></table></div>`
      : `<p class="empty">${all.length ? `No ${listTab} surveys.` : 'No surveys yet — start one with “New survey”.'}</p>`;
  } catch (err) {
    box.innerHTML = `<p class="form-error">Couldn’t load surveys: ${esc(friendlyError(err))}</p>`;
  }
}

const newQuestionId = () => `q${Math.random().toString(36).slice(2, 8)}`;

function questionRow(q, open = false) {
  const li = document.createElement('li');
  li.dataset.qid = q.id;
  const uid = `sq-${q.id}`;
  li.innerHTML = `
    <details class="fold"${open ? ' open' : ''}>
      <summary class="fold__head"><span class="sq-head"><h2 data-qtitle></h2><span class="card__meta" data-qtype></span></span></summary>
      <div class="fold__body">
    <div class="form-grid form-grid--pairs">
      <div class="field span-2"><label for="${uid}-l" data-label-name>Question</label><input id="${uid}-l" data-label maxlength="300" value="${esc(q.label)}"></div>
      <div class="field"><label for="${uid}-t">Answer type</label><select id="${uid}-t" data-type>${Object.entries(TYPES).map(([v, l]) => `<option value="${v}"${v === q.type ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field field--check" data-required-field><input id="${uid}-r" type="checkbox" data-required${q.required ? ' checked' : ''}><label for="${uid}-r">Required</label></div>
      <div class="field span-2" data-text-field><label for="${uid}-s">Text under the title (optional)</label><textarea id="${uid}-s" data-text rows="3">${esc(q.text)}</textarea></div>
      <div class="field span-2" data-options-field><label for="${uid}-o">Choices (one per line)</label><textarea id="${uid}-o" data-options rows="4">${esc((q.options ?? []).join('\n'))}</textarea></div>
      <div class="field field--check span-2" data-other-field><input id="${uid}-x" type="checkbox" data-other${q.other ? ' checked' : ''}><label for="${uid}-x">Add an “Other” choice with a write-in box</label></div>
    </div>
    <div class="admin-actions">
      <button class="btn btn--ghost btn--small" type="button" data-move="-1" aria-label="Move question up">↑</button>
      <button class="btn btn--ghost btn--small" type="button" data-move="1" aria-label="Move question down">↓</button>
      <button class="btn btn--danger btn--small" type="button" data-remove>${solidIcon('remove', 16)} Remove</button>
    </div>
      </div>
    </details>`;
  const sync = () => {
    const type = $('[data-type]', li).value;
    $('[data-options-field]', li).hidden = $('[data-other-field]', li).hidden = !HAS_OPTIONS.includes(type);
    $('[data-text-field]', li).hidden = type !== 'section';
    $('[data-required-field]', li).hidden = type === 'section';
    $('[data-label-name]', li).textContent = type === 'section' ? 'Section title' : 'Question';
    // The closed header names the question and its type.
    $('[data-qtitle]', li).textContent = $('[data-label]', li).value.trim() || (type === 'section' ? '(new section)' : '(new question)');
    $('[data-qtype]', li).textContent = (TYPES[type] ?? type).split(' (')[0];
  };
  $('[data-type]', li).addEventListener('change', sync);
  $('[data-label]', li).addEventListener('input', sync);
  sync();
  return li;
}

function readQuestions(list) {
  return $$('li', list).map((li) => {
    const type = $('[data-type]', li).value;
    const q = { id: li.dataset.qid, type, label: $('[data-label]', li).value.trim(), required: $('[data-required]', li).checked };
    if (type === 'section') {
      q.required = false;
      q.text = $('[data-text]', li).value.trim();
    } else if (HAS_OPTIONS.includes(type)) {
      q.options = [...new Set($('[data-options]', li).value.split('\n').map((o) => o.trim()).filter(Boolean))];
      if ($('[data-other]', li).checked) q.other = true;
    }
    return q;
  });
}

async function edit(listEl, id, startTab) {
  const sv = id ? await must(sb.from('surveys').select('*').eq('id', id).single()) : { title: '', slug: '', intro: '', thank_you: '', is_open: false, questions: [] };
  const d = openPage(listEl, id ? sv.title : 'New Survey', `
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="details">Details</button>
      <button type="button" class="admin-tab" role="tab" data-tab="questions">Questions</button>
      ${id ? `<button type="button" class="admin-tab" role="tab" data-tab="results">Results</button>
      <button type="button" class="admin-tab" role="tab" data-tab="share">Share</button>` : ''}
    </div>
    <form class="admin-form" novalidate>
      <div data-tabpane="details">
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Details</h2></summary><div class="fold__body">
      <div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="sv-title">Title <span class="req" aria-hidden="true">*</span></label><input id="sv-title" name="title" required maxlength="150" value="${esc(sv.title)}"></div>
        <div class="field span-2"><label for="sv-slug">Link name</label><input id="sv-slug" name="slug" maxlength="80" value="${esc(sv.slug)}" placeholder="customer-survey"><p class="field__hint">Used in the link: survey.html?s=<em>link-name</em>. Letters, numbers and dashes. Leave blank to make one from the title.</p></div>
        <div class="field span-2"><label for="sv-intro">Introduction</label><textarea id="sv-intro" name="intro" rows="3">${esc(sv.intro)}</textarea></div>
        <div class="field span-2"><label for="sv-thanks">Thank-you message</label><textarea id="sv-thanks" name="thank_you" rows="2">${esc(sv.thank_you)}</textarea></div>
      </div>
      </div></details>
      <details class="fold toorder fold--static" open><summary class="fold__head"><h2>Email Box</h2></summary><div class="fold__body">
      <div class="form-grid form-grid--pairs">
        <div class="checks span-2"><label><input id="sv-email" name="collect_email" type="checkbox"${sv.collect_email ? ' checked' : ''}> Offer an optional email box (for a drawing or prize)</label></div>
        <div class="field span-2"><label for="sv-email-prompt">Wording above the email box</label><input id="sv-email-prompt" name="email_prompt" maxlength="200" value="${esc(sv.email_prompt)}" placeholder="Enter your email to be entered in our gift card drawing"><p class="field__hint">Emails are saved separately from the answers (see Results), so the answers stay anonymous. Say what the prize is and when you'll draw.</p></div>
      </div>
      </div></details>
      </div>
      <div data-tabpane="questions">
      <h3>Questions</h3>
      <ol class="survey-questions"></ol>
      <p><button class="btn btn--add" type="button" data-add>${solidIcon('add', 18)} Add question</button></p>
      <div class="field field--check"><input id="sv-open" name="is_open" type="checkbox"${sv.is_open ? ' checked' : ''}><label for="sv-open">Open — customers can answer it</label></div>
      </div>
      <div class="admin-actions sticky-actions" data-form-actions>
        <button class="btn btn--primary" type="submit">${id ? 'Save' : 'Create survey'}</button>
        ${id ? `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>` : ''}
        <span class="admin-status" role="status"></span>
      </div>
    </form>
    ${id ? '<div data-tabpane="results"></div><div data-tabpane="share"></div>' : ''}`);
  let resultsShown = false;
  let shareShown = false;
  const showTab = setupTabs(d, 'admin-survey-tab', 'details', (tab) => {
    $('[data-form-actions]', d).hidden = tab === 'results' || tab === 'share';
    if (tab === 'results' && !resultsShown) ((resultsShown = true), renderResults($('[data-tabpane="results"]', d), sv));
    if (tab === 'share' && !shareShown) ((shareShown = true), renderShare($('[data-tabpane="share"]', d), sv));
  });
  if (id && ['details', 'questions', 'results', 'share'].includes(startTab)) showTab(startTab);
  const list = $('.survey-questions', d);
  sv.questions.forEach((q, i) => list.append(questionRow(q, i === 0))); // the first question starts open
  $('[data-add]', d).addEventListener('click', () => {
    const li = questionRow({ id: newQuestionId(), type: 'text', label: '', required: false }, true);
    list.append(li);
    $('[data-label]', li).focus();
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    const move = e.target.closest('[data-move]');
    if (move) {
      const dir = Number(move.dataset.move);
      const other = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
      if (other) dir < 0 ? list.insertBefore(li, other) : list.insertBefore(other, li);
      move.focus();
    } else if (e.target.closest('[data-remove]') && (!$('[data-label]', li).value || confirm('Remove this question? Answers already collected for it stay in the saved responses.'))) li.remove();
  });
  const form = $('form', d);
  const status = $('.admin-status', d);
  form.addEventListener('input', () => (dirty = true));
  form.addEventListener('change', () => (dirty = true));
  list.addEventListener('click', (e) => e.target.closest('[data-remove],[data-move]') && (dirty = true));
  $('[data-add]', d).addEventListener('click', () => (dirty = true));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const title = f.get('title').trim();
    const questions = readQuestions(list);
    if (!title) return setStatus(status, 'Please enter a title.', 'error');
    const bad = questions.findIndex((q) => !q.label || (HAS_OPTIONS.includes(q.type) && q.options.length < (q.other ? 1 : 2)));
    if (bad >= 0) return setStatus(status, `${questions[bad].type === 'section' ? 'Section' : 'Question'} ${bad + 1} needs ${questions[bad].type === 'section' ? 'a title' : 'wording'}${HAS_OPTIONS.includes(questions[bad].type) && questions[bad].label ? ' and at least two choices' : ''}.`, 'error');
    const slug = slugify(f.get('slug').trim() || title);
    if (!slug) return setStatus(status, 'Please give the survey a link name.', 'error');
    const row = { title, slug, intro: f.get('intro').trim() || null, thank_you: f.get('thank_you').trim() || null, questions, is_open: f.get('is_open') === 'on', collect_email: f.get('collect_email') === 'on', email_prompt: f.get('email_prompt').trim() || null };
    setStatus(status, 'Saving…');
    try {
      await must(id ? sb.from('surveys').update(row).eq('id', id) : sb.from('surveys').insert(row));
      toast(id ? 'Survey saved' : 'Survey created');
      d.close();
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-delete]', d)?.addEventListener('click', async () => {
    if (!confirm(`Delete “${sv.title}” and all its answers? This can’t be undone.`)) return;
    try {
      await must(sb.from('surveys').delete().eq('id', id));
      toast('Survey deleted');
      d.close();
    } catch (err) {
      setStatus(status, `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });
}

// Horizontal bars, one per choice: label, bar (share of people who answered), then count and percent.
// Plain text carries every number, so the chart reads without colour or hover.
function bars(rows, total, after = {}) {
  return `<div class="survey-bars" role="list">${rows
    .map(({ label, n }) => {
      const pct = total ? Math.round((n / total) * 100) : 0;
      return `<div class="survey-bar" role="listitem" title="${esc(label)}: ${n} (${pct}%)"><span class="survey-bar__label">${esc(label)}</span><span class="survey-bar__track" aria-hidden="true"><span class="survey-bar__fill" style="width:${n ? Math.max(pct, 1) : 0}%"></span></span><span class="survey-bar__value"><strong>${n}</strong> · ${pct}%</span></div>${after[label] ?? ''}`;
    })
    .join('')}</div>`;
}

const answerText = (v) => (Array.isArray(v) ? v.join('; ') : v ?? '');

/** The Results tab: summary of every answer, with print and CSV downloads. */
async function renderResults(box, sv) {
  const id = sv.id;
  box.innerHTML = '<p class="admin-hint" aria-busy="true">Loading…</p>';
  const rows = await fetchAll(() => sb.from('survey_responses').select('id,answers,created_at').eq('survey_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }));
  const answerable = sv.questions.filter((q) => q.type !== 'section');
  const summary = answerable.map((q) => {
    const answers = rows.map((r) => r.answers[q.id]).filter((v) => v != null && v !== '');
    let body;
    if (['choice', 'multi', 'yesno'].includes(q.type)) {
      const counts = new Map();
      const writeIns = [];
      answers.flat().forEach((a) => {
        const other = q.other && /^Other(: |$)/.test(a) && !q.options?.includes(a);
        if (other && a.length > 5) writeIns.push(a.slice(7));
        const key = other ? 'Other' : a;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      const opts = q.type === 'yesno' ? ['Yes', 'No'] : [...q.options, ...(q.other ? ['Other'] : [])];
      const labels = [...new Set([...opts, ...counts.keys()])];
      body = bars(labels.map((label) => ({ label, n: counts.get(label) ?? 0 })), answers.length, writeIns.length ? { Other: `<ul class="survey-writeins">${writeIns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` } : {});
    } else if (q.type === 'rating') {
      const avg = answers.length ? (answers.reduce((a, b) => a + b, 0) / answers.length).toFixed(1) : '–';
      body = `<p>Average <strong>${avg}</strong> out of 5</p>${bars([5, 4, 3, 2, 1].map((n) => ({ label: `${n} ★`, n: answers.filter((a) => a === n).length })), answers.length)}`;
    } else {
      body = answers.length ? `<ul>${answers.slice(0, 50).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>${answers.length > 50 ? `<p class="admin-hint">Showing 50 of ${answers.length}. Download the CSV for all.</p>` : ''}` : '<p class="admin-hint">No answers.</p>';
    }
    return `<section class="survey-q"><h3>${esc(q.label)} <span class="card__meta">(${answers.length} answered)</span></h3>${body}</section>`;
  });
  const entries = sv.collect_email ? await fetchAll(() => sb.from('survey_entries').select('email,created_at').eq('survey_id', id).order('created_at', { ascending: false }).order('email')) : [];
  const d = box;
  box.innerHTML = `
    <p><strong>${rows.length}</strong> response${rows.length === 1 ? '' : 's'}${rows[0] ? ` · latest ${fmtDateTime(rows[0].created_at)}` : ''}</p>
    <p class="print-only">${esc(sv.title)} · printed ${fmtDate(new Date().toISOString(), { month: 'short', day: 'numeric', year: 'numeric' })}</p>
    ${rows.length ? '<p class="no-print"><button class="btn btn--primary" type="button" data-print>Print / Save as PDF</button> <button class="btn btn--ghost" type="button" data-csv>Download CSV</button></p>' : ''}
    ${sv.collect_email ? `<p><strong>${entries.length}</strong> email${entries.length === 1 ? '' : 's'} entered for the drawing${entries.length ? ' <button class="btn btn--ghost btn--small no-print" type="button" data-entries>Download emails</button>' : ''}</p>` : ''}
    ${rows.length ? summary.join('') : '<p class="empty">No responses yet.</p>'}`;
  // The browser's print dialog has a "Save as PDF" destination; the file name comes from the page title.
  $('[data-print]', d)?.addEventListener('click', () => {
    const title = document.title;
    document.title = `${sv.slug}-results`;
    window.addEventListener('afterprint', () => (document.title = title), { once: true });
    window.print();
  });
  $('[data-entries]', d)?.addEventListener('click', () => downloadCsv(`${sv.slug}-emails.csv`, ['Email', 'Entered'], entries.map((x) => [x.email, new Date(x.created_at).toLocaleString()])));
  $('[data-csv]', d)?.addEventListener('click', () =>
    downloadCsv(`${sv.slug}-responses.csv`, ['Submitted', ...answerable.map((q) => q.label)], rows.map((r) => [new Date(r.created_at).toLocaleString(), ...answerable.map((q) => answerText(r.answers[q.id]))])),
  );
}

/** The Share tab: the survey's link and its QR code (the saved code and its scans live in Admin → QR Codes). */
async function renderShare(box, sv) {
  const url = publicUrl(sv.slug);
  let qr = null;
  let img = '';
  try {
    await loadScript(QR_LIB, 'Couldn’t load the QR code maker.');
    qr = (await must(sb.from('qr_codes').select('slug,scan_count').eq('forward', true).eq('target_url', url).limit(1)))[0] ?? null;
    if (qr) img = svgFor(encodedText({ forward: true, slug: qr.slug }), '#000000', '#ffffff');
  } catch { /* the QR section just offers to make one */ }
  box.innerHTML = `
    <details class="fold toorder fold--static" open>
      <summary class="fold__head"><h2>Link</h2><span class="toorder__count">${sv.is_open ? 'Open: customers can answer it' : 'Closed: the link won’t work until you open it'}</span></summary>
      <div class="fold__body">
        <p><input readonly value="${esc(url)}" aria-label="Survey link" data-url></p>
        <p><button class="btn btn--ghost" type="button" data-copy>Copy link</button> <a class="btn btn--ghost" href="../survey.html?s=${encodeURIComponent(sv.slug)}&amp;preview=1" target="_blank" rel="noopener">Preview</a></p>
      </div>
    </details>
    <details class="fold toorder fold--static" open>
      <summary class="fold__head"><h2>QR Code</h2>${qr ? `<span class="toorder__count">${qr.scan_count} scan${Number(qr.scan_count) === 1 ? '' : 's'}</span>` : ''}</summary>
      <div class="fold__body">
        ${qr && img ? `<p><a class="survey-qr" href="#qr" aria-label="Open this QR code in QR Codes">${img}</a></p><p class="admin-hint">Print it from Admin → QR Codes. The address can change later without reprinting.</p>`
          : '<p class="admin-hint">Make a QR code that forwards to this survey, with scan counts.</p><p><button class="btn btn--ghost" type="button" data-make-qr>Make QR code</button></p>'}
      </div>
    </details>`;
  $('[data-copy]', box).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { $('[data-url]', box).select(); toast('Press Ctrl/⌘+C to copy', 'ok'); }
  });
  $('[data-make-qr]', box)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; // currentTarget is null again once the await below returns
    btn.disabled = true;
    try {
      await ensureQr(sv);
      renderShare(box, sv);
    } catch (err) {
      btn.disabled = false;
      toast(`Not saved: ${friendlyError(err)}`, 'error');
    }
  });
}

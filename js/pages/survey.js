import { initPage, $, esc, linkify } from '../site.js';
import { getSurvey, submitSurvey } from '../data.js';

await initPage();
const root = $('#survey');
const params = new URLSearchParams(location.search);
const slug = params.get('s');
// ?preview=1 lets signed-in staff see a survey that is still closed; nothing is saved from it.
const preview = params.get('preview') === '1';
const survey = await getSurvey(slug, { preview }).catch((err) => (console.error(err), null));

const paragraphs = (text) => String(text ?? '').split(/\n{2,}/).filter(Boolean).map((p) => `<p>${linkify(p).replace(/\n/g, '<br>')}</p>`).join('');
const doneKey = survey && `survey-done-${survey.id}`;
const wasDone = () => { try { return !!localStorage.getItem(doneKey); } catch { return false; } };
const markDone = () => { try { localStorage.setItem(doneKey, '1'); } catch {} };

function thanks() {
  root.innerHTML = `<h1>Thank you!</h1>${paragraphs(survey.thank_you) || '<p>We read every response.</p>'}<p><a class="btn btn--primary" href="index.html">Back to the shop</a></p>`;
  document.title = `Thank you — ${survey.title}`;
  window.scrollTo(0, 0);
}

function field(q, i) {
  const name = `q-${q.id}`;
  const text = `${esc(q.label)}${q.required ? ' <span aria-hidden="true">*</span><span class="visually-hidden"> (required)</span>' : ''}`;
  const label = `<span class="label" id="${name}-l">${text}</span>`;
  const forLabel = `<label id="${name}-l" for="${name}">${text}</label>`;
  const group = (inner) => `<fieldset class="field" style="border:0;padding:0;margin:0 0 22px" aria-labelledby="${name}-l">${label}${inner}</fieldset>`;
  // More than 6 choices flow into two columns on wider screens (see .survey-choices in site.css).
  const opts = (type, list) => {
    const items = list.map((o, j) => `<div class="field--check"><input id="${name}-${j}" type="${type}" name="${name}" value="${esc(o)}"><label for="${name}-${j}">${esc(o)}</label></div>`).join('');
    const other = q.other ? `<div class="survey-choice-other"><div class="field--check"><input id="${name}-other" type="${type}" name="${name}" value="__other__" data-other><label for="${name}-other">Other</label></div><div class="field" data-other-text="${name}" hidden style="margin:0 0 8px 34px"><label class="visually-hidden" for="${name}-other-text">Other: please specify</label><input id="${name}-other-text" maxlength="200" placeholder="Please specify"></div></div>` : '';
    return `<div class="survey-choices${list.length + (q.other ? 1 : 0) > 6 ? ' survey-choices--cols' : ''}">${items}${other}</div>`;
  };
  switch (q.type) {
    case 'section': return `<h2>${esc(q.label)}</h2>${paragraphs(q.text)}<hr style="margin:1.2em 0 1.8em">`;
    case 'long': return `<div class="field" style="margin-bottom:22px">${forLabel}<textarea id="${name}" name="${name}" maxlength="3000" rows="4"${q.required ? ' required' : ''}></textarea></div>`;
    case 'choice': return group(opts('radio', q.options));
    case 'multi': return group(opts('checkbox', q.options));
    case 'yesno': return group(opts('radio', ['Yes', 'No']));
    case 'rating': return group(`<div style="display:flex;gap:18px;flex-wrap:wrap">${[1, 2, 3, 4, 5].map((n) => `<div class="field--check"><input id="${name}-${n}" type="radio" name="${name}" value="${n}"><label for="${name}-${n}">${n}</label></div>`).join('')}</div><p class="field__hint">1 = not at all, 5 = absolutely</p>`);
    default: return `<div class="field" style="margin-bottom:22px">${forLabel}<input id="${name}" name="${name}" maxlength="300"${q.required ? ' required' : ''}></div>`;
  }
}

if (!survey) {
  root.innerHTML = `<h1>Survey</h1><p>There isn't a survey open right now — check back soon.</p><p><a class="btn btn--primary" href="index.html">Back to the shop</a></p>`;
} else if (!preview && wasDone()) {
  root.innerHTML = `<h1>${esc(survey.title)}</h1><p>Looks like you've already answered this one — thank you!</p><p><a class="btn btn--primary" href="index.html">Back to the shop</a></p>`;
} else {
  document.title = `${survey.title} — ${document.title.split(' — ')[0]}`;
  const questions = survey.questions.filter((q) => q.type !== 'section');
  const seconds = questions.reduce((n, q) => n + (q.type === 'long' ? 60 : q.type === 'text' ? 20 : 10), 0);
  const minutes = Math.max(1, Math.round(seconds / 60));
  // Each section header starts a new page; a survey with no sections stays on one page.
  const pages = [];
  for (const q of survey.questions) {
    if (q.type === 'section' || !pages.length) pages.push([]);
    pages.at(-1).push(q);
  }
  const paged = pages.length > 1;
  const emailPrompt = survey.email_prompt || 'Enter your email to be entered in our drawing';
  root.innerHTML = `
    ${preview ? `<p class="panel" role="status"><strong>Preview.</strong> ${survey.is_open ? 'This survey is open.' : 'This survey is closed, so only staff can see it.'} Nothing you submit here is saved.</p>` : ''}
    <h1>${esc(survey.title)}</h1>
    ${paragraphs(survey.intro)}
    <p class="card__meta">${questions.length} question${questions.length === 1 ? '' : 's'} · about ${minutes} minute${minutes === 1 ? '' : 's'}</p>
    ${paged ? '<div id="survey-progress" tabindex="-1"><p class="card__meta" id="survey-step"></p><div role="progressbar" aria-label="Survey progress" aria-valuemin="0" aria-valuemax="100" style="height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-bottom:1.5em"><div id="survey-bar" style="height:100%;background:var(--teal);width:0;transition:width .2s"></div></div></div>' : ''}
    <form id="survey-form" novalidate>
      ${pages.map((qs, i) => `<div data-page="${i}"${i ? ' hidden' : ''}>${qs.map(field).join('')}</div>`).join('')}
      ${survey.collect_email ? `<div class="field" data-email-wrap${paged ? ' hidden' : ''}><label for="survey-email">${esc(emailPrompt)} <span class="card__meta">(optional)</span></label><input id="survey-email" name="email" type="email" autocomplete="email" maxlength="200"><p class="field__hint">We keep your email separate from your answers, so your answers stay anonymous.</p></div>` : ''}
      <div hidden aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <p class="form-error" role="alert" id="survey-error"></p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${paged ? '<button class="btn btn--ghost" type="button" data-back hidden>Back</button><button class="btn btn--primary" type="button" data-next>Next</button>' : ''}
        <button class="btn btn--primary" type="submit"${paged ? ' hidden' : ''}>Submit</button>
      </div>
    </form>`;
  const form = $('#survey-form');
  const err = $('#survey-error');
  let page = 0;

  // The "Other" write-in box shows only while Other is picked.
  form.addEventListener('change', (e) => {
    if (e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
    for (const box of form.querySelectorAll('[data-other-text]')) {
      const on = form.querySelector(`#${box.dataset.otherText}-other`).checked;
      box.hidden = !on;
      if (on && e.target.id === `${box.dataset.otherText}-other`) box.querySelector('input').focus();
    }
  });
  const otherAnswer = (q, v) => {
    if (v !== '__other__') return v;
    const t = form.querySelector(`#q-${q.id}-other-text`).value.trim();
    return t ? `Other: ${t}` : 'Other';
  };
  // Answers for these questions, or the first unanswered required one.
  function collect(qs) {
    const answers = {};
    for (const q of qs.filter((x) => x.type !== 'section')) {
      const found = form.elements[`q-${q.id}`];
      const els = found ? (found.length === undefined ? [found] : [...found]) : [];
      if (q.type === 'multi') answers[q.id] = els.filter((x) => x.checked).map((x) => otherAnswer(q, x.value));
      else if (q.type === 'rating') { const c = els.find((x) => x.checked); if (c) answers[q.id] = Number(c.value); }
      else if (['choice', 'yesno'].includes(q.type)) { const c = els.find((x) => x.checked); if (c) answers[q.id] = otherAnswer(q, c.value); }
      else answers[q.id] = els[0]?.value.trim() ?? '';
      const v = answers[q.id];
      if (q.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) {
        return { answers, missing: q, focus: els[0] };
      }
    }
    return { answers };
  }

  function show(i) {
    page = i;
    form.querySelectorAll('[data-page]').forEach((el) => (el.hidden = Number(el.dataset.page) !== i));
    const last = i === pages.length - 1;
    $('[data-back]', form).hidden = i === 0;
    $('[data-next]', form).hidden = last;
    $('button[type=submit]', form).hidden = !last;
    const wrap = $('[data-email-wrap]', form);
    if (wrap) wrap.hidden = !last;
    $('#survey-step').textContent = `Page ${i + 1} of ${pages.length}`;
    const pct = Math.round((i / pages.length) * 100);
    $('#survey-bar').style.width = `${pct}%`;
    $('#survey-bar').parentElement.setAttribute('aria-valuenow', pct);
    err.textContent = '';
    $('#survey-progress').scrollIntoView({ block: 'start' });
    $('#survey-progress').focus({ preventScroll: true });
  }
  if (paged) {
    show(0);
    $('[data-back]', form).addEventListener('click', () => show(page - 1));
    $('[data-next]', form).addEventListener('click', () => {
      const r = collect(pages[page]);
      if (r.missing) {
        err.textContent = `Please answer: ${r.missing.label}`;
        return r.focus?.focus();
      }
      show(page + 1);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const r = collect(survey.questions);
    if (r.missing) {
      // On a paged survey, jump back to the page holding the unanswered question.
      if (paged) show(pages.findIndex((qs) => qs.includes(r.missing)));
      err.textContent = `Please answer: ${r.missing.label}`;
      return r.focus?.focus();
    }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      if (preview) await new Promise((res) => setTimeout(res, 300));
      else {
        await submitSurvey({ surveyId: survey.id, answers: r.answers, website: form.elements.website.value, email: form.elements.email?.value.trim() });
        markDone();
      }
      thanks();
      if (preview) root.insertAdjacentHTML('afterbegin', '<p class="panel" role="status"><strong>Preview.</strong> Nothing was saved.</p>');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

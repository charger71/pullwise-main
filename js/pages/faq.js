import { initPage, $, esc } from '../site.js';
import { getFaqs } from '../data.js';
import { renderRich } from '../content.js';

const s = await initPage();
const faqs = await getFaqs();

// Questions and answers are managed on the admin page (faqs table).
$('#faq-list').innerHTML = (
  await Promise.all(faqs.map(async (f) => `<details><summary>${esc(f.question)}</summary><div>${await renderRich(f.answer_html, s)}</div></details>`))
).join('') || '<p class="empty">No questions yet — give us a call.</p>';

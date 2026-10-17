import { initPage, $, esc } from '../site.js';
import { getFaqs } from '../data.js';
import { renderRich } from '../content.js';

const s = await initPage();
const faqs = await getFaqs().catch((err) => (console.error(err), null));
const failed = '<p>Sorry, this answer couldn’t be shown right now.</p>';

// Questions and answers are managed on the admin page (faqs table).
$('#faq-list').innerHTML = !faqs
  ? '<p class="empty">We couldn’t load the questions just now. Please try again in a moment, or give us a call.</p>'
  : (
      await Promise.all(faqs.map(async (f) => `<details><summary>${esc(f.question)}</summary><div>${await renderRich(f.answer_html, s).catch((err) => (console.error(err), failed))}</div></details>`))
    ).join('') || '<p class="empty">No questions yet — give us a call.</p>';

// My List in the app (js/pages/account.js): swipe a title to the left to take it off the list, as in a native app's
// list. A short swipe leaves a Remove button showing at the row's end; a long one (past half the row) asks on
// release. Either way the customer confirms first (a swipe is easy to make by mistake), then it presses the row's own
// Remove button, so removing works exactly as tapping the trash icon
// does (and screen reader and keyboard users keep that button). Only rows that can still be changed have one.

import { buzzOnCross } from './app-device.js';

const DECIDE = 10; // px of travel before the gesture is a sideways swipe or a scroll
// px a short swipe leaves open: the Remove button's width, --swipe-open in css/site.css (88px when unreadable)
const OPEN = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--swipe-open')) || 88;
const OPEN_AFTER = 48; // px dragged that leaves it open on release
const REMOVE_AT = 0.5; // share of the row's width that removes on release

const removeOf = (row) => row.querySelector('[data-remove]');

function place(row, px, { settle = false } = {}) {
  row.classList.toggle('is-settling', settle);
  row.style.setProperty('--swipe', `${px}px`);
  row.classList.toggle('is-swiped', px > 0);
}

/**
 * Ask before removing, with the row held open on its Remove so it's clear which title is meant; then slide it away and
 * press its own Remove button, or put it back.
 */
async function confirmRemove(row) {
  const btn = removeOf(row);
  if (!btn) return;
  place(row, OPEN(), { settle: true });
  await new Promise((done) => setTimeout(done, 250)); // let it settle on screen before the question covers it
  const what = (btn.getAttribute('aria-label') ?? 'Remove this title').replace(/^Remove /, '');
  if (!confirm(`Remove ${what} from your pull list?`)) return place(row, 0, { settle: true });
  place(row, row.offsetWidth, { settle: true }); // slides away, then the list is drawn without it
  btn.click();
}

/** Close any row left open, except `keep`. */
function closeOthers(box, keep = null) {
  for (const row of box.querySelectorAll('.account-line--app.is-swiped')) if (row !== keep) place(row, 0, { settle: true });
}

/** Start swipe-to-remove on the rows inside `box` (which keeps its listeners when its rows are drawn again). */
export function enableSwipeRemove(box) {
  if (box.dataset.swipe) return;
  box.dataset.swipe = 'on';
  let row = null;
  let startX = 0;
  let startY = 0;
  let from = 0; // where the row was (open or closed) when the finger went down
  let px = 0;
  let sideways = null; // null until decided
  let armed = false;
  const buzz = buzzOnCross();

  box.addEventListener('touchstart', (e) => {
    const r = e.target.closest('.account-line--app');
    closeOthers(box, r);
    // Not from the copies field (its own swipe moves the cursor), and only on a row that can be removed.
    if (!r || e.touches.length !== 1 || !removeOf(r) || e.target.closest('input, [data-swipe-remove]')) return void (row = null);
    row = r;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    from = row.classList.contains('is-swiped') ? OPEN() : 0;
    px = from;
    sideways = null;
    armed = false;
    buzz(false);
  }, { passive: true });

  box.addEventListener('touchmove', (e) => {
    if (!row) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (sideways === null) {
      if (Math.abs(dx) < DECIDE && Math.abs(dy) < DECIDE) return;
      sideways = Math.abs(dx) > Math.abs(dy);
      if (!sideways) return void (row = null); // a scroll: leave the row be
    }
    const width = row.offsetWidth;
    px = Math.min(width, Math.max(0, from - dx));
    place(row, px);
    armed = px > width * REMOVE_AT;
    row.classList.toggle('is-armed', armed);
    buzz(armed);
  }, { passive: true });

  const release = () => {
    if (!row) return;
    const r = row;
    row = null;
    r.classList.remove('is-armed');
    buzz(false); // the next swipe buzzes again
    if (!sideways) return;
    if (armed) {
      confirmRemove(r);
    } else {
      place(r, px > OPEN_AFTER ? OPEN() : 0, { settle: true });
    }
  };
  box.addEventListener('touchend', release);
  box.addEventListener('touchcancel', release);
  // A touch anywhere else puts an open row back.
  document.addEventListener('touchstart', (e) => !box.contains(e.target) && closeOthers(box), { passive: true });
  // A tap on an open row (not its Remove) closes it rather than opening the title.
  box.addEventListener('click', (e) => {
    const r = e.target.closest('.account-line--app.is-swiped');
    if (!r || e.target.closest('[data-swipe-remove], [data-remove]')) return; // its Remove buttons still work
    e.preventDefault();
    e.stopPropagation();
    place(r, 0, { settle: true });
  }, true);

  // The Remove button a short swipe uncovered. It's for fingers only (hidden from screen readers and out of the tab
  // order): the trash icon on every row does the same for everyone.
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-swipe-remove]');
    if (!btn) return;
    confirmRemove(btn.closest('.account-line--app'));
  });
}

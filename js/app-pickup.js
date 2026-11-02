// The app's pickup code, full screen (js/pages/account.js): tap the QR code on My List and it fills the screen, dark
// on white, big enough to scan from across the counter, with the customer's name and number. The screen is kept
// awake while it shows (Screen Wake Lock), so the phone doesn't dim while staff find the scanner. A web app can't
// turn the brightness up; the white page is the most it can do. Tap anywhere, Close, Escape or Back to put it away.

let dialog = null;
let lock = null;

async function keepAwake() {
  if (!dialog?.open || lock || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
  } catch {
    /* not allowed now (battery saver, say): the screen may dim as usual */
  }
}

function letSleep() {
  lock?.release().catch(() => {});
  lock = null;
}

// A wake lock ends when the app goes to the background; take it again on return if the code is still up.
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());

function create() {
  const d = document.createElement('dialog');
  d.className = 'pickup-full';
  d.setAttribute('aria-labelledby', 'pickup-full-h');
  d.autofocus = true; // focus the code itself on opening, not the ✕ (whose focus ring would sit over it)
  document.body.append(d);
  d.addEventListener('click', () => d.close()); // anywhere: it's a full-screen card, not a form
  d.addEventListener('close', () => {
    letSleep();
    d.returnFocusTo?.isConnected && d.returnFocusTo.focus();
  });
  return d;
}

/** Show the pickup code from `card` (the .app-pickup box on My List) full screen. */
export function showPickupFull(card, opener) {
  const qr = card.querySelector('[data-pickup-qr] svg');
  if (!qr) return;
  dialog ??= create();
  const name = card.querySelector('.app-pickup__name')?.textContent ?? '';
  const code = card.querySelector('.app-pickup__code')?.textContent ?? '';
  dialog.innerHTML = `
    <h2 id="pickup-full-h" class="visually-hidden">Pickup code</h2>
    <div class="pickup-full__qr"></div>
    <p class="pickup-full__name"></p>
    <p class="pickup-full__code"></p>
    <p class="pickup-full__hint">Show this at the counter · tap to close</p>
    <button class="dialog__close pickup-full__close" type="button" aria-label="Close">✕</button>`;
  dialog.querySelector('.pickup-full__qr').append(qr.cloneNode(true));
  dialog.querySelector('.pickup-full__name').textContent = name;
  dialog.querySelector('.pickup-full__code').textContent = code;
  dialog.returnFocusTo = opener;
  dialog.showModal();
  keepAwake();
}

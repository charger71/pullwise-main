// An icon for every tab. Tabs are written as plain buttons by each page; this adds the icon in front of the label
// (the label is hidden on phones, leaving just the icon). Icons are matched by the tab's label.

const SVG = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  log: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 4.5a3.5 3.5 0 0 1 0 7M22 21c0-3-1.7-5-4.5-5.7"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  message: '<path d="M3 5h18v12H8l-5 4z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l3 12h11l2-8H6"/>',
  again: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>',
  box: '<path d="m3 8 9-5 9 5v9l-9 5-9-5zM3 8l9 5 9-5M12 13v9"/>',
  shield: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6M19 8v6M16 11h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  bag: '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  shop: '<path d="m3 9 1-5h16l1 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v9h14v-9"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2.5 1.5-2.5H18a3 3 0 0 0 3-3C21 7 17 3 12 3z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1"/>',
  upload: '<path d="M12 14V4M8 8l4-4 4 4"/><path d="M8 19h8" stroke-width="3"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  download: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M8 19h8" stroke-width="3"/>',
  forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  brush: '<path d="M18 3l3 3-9.5 9.5-3-3zM8.5 12.5C5.5 12.5 4 14 4 16.5c0 1.5-.5 2.5-1.5 3.5 3.5.5 7-1 7-4.2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.8-4.8"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5M3 13l2.5-8h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  shieldCheck: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  userCheck: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6M15 15l2 2 4-4"/>',
};

// First match wins. Matched against the tab's label.
const BY_LABEL = [
  [/^today$/i, 'sun'], [/^trends$/i, 'chart'], [/^system$/i, 'pulse'],
  [/^sales$/i, 'tag'], [/^customers$/i, 'people'], [/^searches$/i, 'search'],
  [/^details/i, 'info'], [/^questions/i, 'question'], [/^results/i, 'chart'], [/^share/i, 'share'], [/^open/i, 'check'], [/^closed/i, 'lock'],
  [/^page text/i, 'pencil'], [/^shelf intros/i, 'layers'], [/^page settings/i, 'gear'], [/^google/i, 'globe'],
  [/^published/i, 'check'], [/^scheduled/i, 'calendar'], [/^drafts?/i, 'pencil'],
  [/^all pages/i, 'log'], [/^menu order/i, 'layers'],
  [/^library/i, 'image'], [/^upload/i, 'upload'],
  [/^import files/i, 'upload'], [/^always skip/i, 'ban'], [/^recent runs/i, 'history'],
  [/^email settings/i, 'gear'], [/^send$/i, 'send'], [/log$/i, 'log'],
  [/^backups$/i, 'moon'], [/^restore$/i, 'history'],
  [/^customers$/i, 'people'],
  [/^all customers/i, 'people'], [/^new this week/i, 'sparkle'], [/^needs attention/i, 'alert'],
  [/^unclaimed/i, 'inbox'], [/^approvals/i, 'userCheck'],
  [/^pull list/i, 'bookmark'], [/^profile/i, 'user'], [/^messages/i, 'message'], [/^changes/i, 'history'],
  [/^upcoming/i, 'calendar'], [/^calendar$/i, 'grid'], [/^past/i, 'clock'], [/signups/i, 'clipboard'],
  [/^reservations/i, 'bookmark'], [/^store order/i, 'shop'], [/^place order/i, 'cart'], [/^re-order/i, 'again'], [/^received/i, 'box'],
  [/^my account/i, 'user'], [/^staff list/i, 'shield'], [/^add a staff/i, 'userPlus'],
  [/^all series/i, 'layers'], [/^creatives/i, 'brush'], [/^add active series/i, 'plus'], [/^all$/i, 'grid'],
  [/^forwarding/i, 'forward'], [/^direct/i, 'target'],
  [/^foc /i, 'flag'], [/^out this week/i, 'bag'],
  [/^shop/i, 'shop'], [/^logo/i, 'palette'], [/^online/i, 'globe'], [/^pre-orders/i, 'tag'], [/^pickups/i, 'shieldCheck'],
];

/** A tab can name its icon (data-icon="pin"); otherwise it is matched by label. */
const iconFor = (label, named) => SVG[named] ?? SVG[BY_LABEL.find(([re]) => re.test(label))?.[1] ?? 'dot'];

/** Put an icon in front of each tab's label (once). */
export function decorateTabs(root) {
  root.querySelectorAll('.admin-tab:not([data-iconed])').forEach((tab) => {
    const badge = tab.querySelector('.admin-tab__badge');
    const label = document.createElement('span');
    label.className = 'admin-tab__label';
    [...tab.childNodes].filter((n) => n !== badge).forEach((n) => label.append(n));
    const text = label.textContent.trim().replace(/\s+/g, ' ');
    tab.dataset.iconed = '1';
    tab.title = text;
    tab.insertAdjacentHTML('afterbegin', `<svg class="admin-tab__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconFor(text, tab.dataset.icon)}</svg>`);
    tab.querySelector('svg').after(label);
  });
  // Roving tab stop: only the chosen tab is in the Tab order; the arrow keys (tabKeys below) move between the others.
  root.querySelectorAll('[role="tablist"]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const on = tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0];
    tabs.forEach((t) => (t.tabIndex = t === on ? 0 : -1));
  });
}

/** Keyboard for tab rows (the ARIA tabs pattern): ← → move to and open the next tab, Home / End the first and last. */
export function tabKeys(e) {
  const tab = e.target.closest?.('[role="tab"]');
  const keys = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
  if (!tab || !(e.key in keys)) return;
  const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]:not([disabled]):not([hidden])')];
  const i = tabs.indexOf(tab);
  const k = keys[e.key];
  const next = k === 'first' ? tabs[0] : k === 'last' ? tabs.at(-1) : tabs[(i + k + tabs.length) % tabs.length];
  e.preventDefault();
  next.focus();
  next.click();
}

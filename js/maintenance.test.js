// applyMaintenance (js/site.js): the full-screen "be right back" notice. A tiny stand-in for the DOM is enough.
import assert from 'node:assert/strict';

const make = (tag) => ({
  tagName: tag, id: '', className: '', inert: false, attrs: {}, innerHTML: '', removed: false,
  setAttribute(k, v) { this.attrs[k] = v; },
  removeAttribute(k) { delete this.attrs[k]; },
  remove() { this.removed = true; body.children = body.children.filter((c) => c !== this); },
});
const body = { children: [make('HEADER'), make('MAIN'), make('SCRIPT')], append(el) { this.children.push(el); } };
const classes = new Set();
globalThis.document = {
  body,
  documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } },
  createElement: make,
  addEventListener() {},
  getElementById: (id) => body.children.find((c) => c.id === id) ?? null,
  querySelectorAll: (sel) => (sel === '[data-maint-inert]' ? body.children.filter((c) => 'data-maint-inert' in c.attrs) : []),
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.location = { pathname: '/', search: '', hostname: 'localhost' };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };

const { applyMaintenance, visitLine } = await import('./site.js');
const count = () => body.children.filter((c) => c.id === 'maintenance').length;

applyMaintenance({ maintenance_mode: false, shop_name: 'X' });
assert.equal(count(), 0, 'nothing shows while off');

const on = { maintenance_mode: true, shop_name: 'Tom & <b>Jerry</b>', maintenance_message: '<script>alert(1)</script>', phone: '555-123-4567', email: 'a"b@x.com' };
applyMaintenance(on);
const el = document.getElementById('maintenance');
assert(el && classes.has('is-maintenance'), 'shows when on');
assert(el.innerHTML.includes('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt; Will Be Right Back'), 'shop name is escaped');
assert(el.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !el.innerHTML.includes('<script>'), 'message is escaped');
assert(el.innerHTML.includes('tel:5551234567') && !el.innerHTML.includes('a"b'), 'phone is linked and the email is escaped');
assert.equal(el.attrs.role, 'alert');
assert.deepEqual(body.children.filter((c) => c.inert).map((c) => c.tagName), ['HEADER', 'MAIN'], 'the page underneath is inert (scripts are left alone)');

applyMaintenance({ ...on, maintenance_message: null, phone: '', email: '' });
assert.equal(count(), 1, 'idempotent: one notice however often it is applied');
assert(document.getElementById('maintenance').innerHTML.includes('little maintenance') && !document.getElementById('maintenance').innerHTML.includes('In the meantime'), 'default text, no contact line without a phone or email');

applyMaintenance({ maintenance_mode: false });
assert.equal(count(), 0, 'removed when switched off');
assert(!classes.has('is-maintenance') && body.children.every((c) => !c.inert), 'the page is usable again');
console.log('maintenance tests passed');

// visitLine (the Simple and Sign-up first footers): a shop with several locations lists their names, linked to the
// Visit page only while that page is on (css/site.css hides links to an off page, which would leave bare dots).
const twoShops = { locations: [{ name: 'Downtown' }, { name: 'Eastside & Co' }] };
assert.equal(visitLine(twoShops), '<a href="contact.html">Downtown</a> · <a href="contact.html">Eastside &amp; Co</a>');
assert.equal(visitLine(twoShops, new Set(['contact.html'])), 'Downtown · Eastside &amp; Co');

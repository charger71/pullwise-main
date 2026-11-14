// node supabase/functions/weekly-pull-list/email.test.js
import assert from 'node:assert/strict';
import { buildMessage, emailLook, sections, build, lastChangeDay, addDays, asTest, splitClaims, withLocation } from './email.js';

const today = '2026-10-08'; // a Thursday
const it = (title, issue, rel, foc, extra = {}) => ({ title, issue_number: issue, release_date: rel, foc_date: foc, variant: null, price: 4.99, ...extra });
const lines = [
  { quantity: 1, status: 'arrived', arrived_on: '2026-10-07', source: 'manual', item: it('ABSOLUTE BATMAN', '25', '2026-10-07', '2026-09-14', { variant: 'CVR A NICK DRAGOTTA' }) },
  { quantity: 2, status: 'ordered', source: 'manual', item: it('DAREDEVIL', '9', '2026-10-14', '2026-09-21') },
  { quantity: 1, status: 'open', source: 'series', created_at: '2026-10-06T10:00:00Z', item: it('SPAWN', '400', '2026-10-28', '2026-10-05') },
  { quantity: 1, status: 'open', source: 'manual', item: it('X <script>', '1', '2026-11-04', '2026-10-12') },
  { quantity: 1, status: 'picked_up', source: 'manual', item: it('OLD BOOK', '1', '2026-09-01', '2026-08-01') },
  { quantity: 1, status: 'cancelled', source: 'manual', item: it('GONE', '1', '2026-11-01', '2026-10-12') },
];

assert.equal(lastChangeDay('2026-10-12'), '2026-10-10'); // Monday FOC -> Saturday before
assert.equal(lastChangeDay('2026-10-10'), '2026-10-03'); // Saturday FOC -> the week before
assert.equal(addDays('2026-12-30', 3), '2027-01-02');

const sec = sections(lines, { today, holdDays: 30 });
assert.deepEqual(sec.ready.map((e) => e.title), ['ABSOLUTE BATMAN #25']);
assert.equal(sec.ready[0].holdUntil, '2026-11-06');
assert.deepEqual(sec.soon.map((e) => e.title), ['DAREDEVIL #9']); // released within the week ahead
assert.deepEqual(sec.later.map((e) => e.title), ['SPAWN #400', 'X <script> #1']);
assert.equal(sec.later[0].isNew, true);
assert.equal(sec.later[1].changeBy, '2026-10-10');
assert.equal(sec.later[0].changeBy, null); // FOC Oct 5 has passed, nothing left to change

// Skip this one: only for a title a follow added this week that can still be changed
{
  const l = (id, source, status, created_at, foc) => ({ id, quantity: 1, status, source, created_at, item: it(`T${id}`, '1', '2026-11-04', foc) });
  const sk = sections([
    l(1, 'series', 'open', '2026-10-06T10:00:00Z', '2026-10-12'), // follow, new, changeable: skippable
    l(2, 'artist', 'open', '2026-10-06T10:00:00Z', '2026-10-12'), // artist follow: skippable
    l(3, 'manual', 'open', '2026-10-06T10:00:00Z', '2026-10-12'), // they added it themselves
    l(4, 'series', 'open', '2026-10-06T10:00:00Z', '2026-10-05'), // cutoff passed
    l(5, 'series', 'open', '2026-09-01T10:00:00Z', '2026-10-12'), // not new any more
    l(6, 'series', 'ordered', '2026-10-06T10:00:00Z', '2026-10-12'), // already ordered
    l(7, 'variant', 'open', '2026-10-06T10:00:00Z', '2026-10-12'), // all-covers add: not a skippable follow line
    { quantity: 1, status: 'open', source: 'series', created_at: '2026-10-06T10:00:00Z', item: it('NOID', '1', '2026-11-04', '2026-10-12') }, // no id
  ], { today });
  const byTitle = Object.fromEntries(sk.later.map((e) => [e.title.split(' ')[0], e.skipId]));
  assert.deepEqual(byTitle, { T1: 1, T2: 2, T3: undefined, T4: undefined, T5: undefined, T6: undefined, T7: undefined, NOID: undefined });
  const skipUrl = (id) => `https://db.test/f?u=tok&skip=${id}`;
  const m = build({ customer: { first_name: 'Jo' }, sections: sk, shop: { shop_name: 'S', colors: {} }, today, manageUrl: 'https://example.com/account.html', unsubscribeUrl: 'https://example.com/u?u=abc', skipUrl });
  assert.equal((m.html.match(/Skip this one<\/a>/g) ?? []).length, 2, 'a Skip link on each of the two');
  assert.ok(m.html.includes('href="https://db.test/f?u=tok&amp;skip=1"'), 'the link is escaped for HTML');
  assert.match(m.text, /- T1 #1[^\n]*\n  [^\n]*\n  Skip this one: https:\/\/db\.test\/f\?u=tok&skip=1\n/);
  assert.ok(!/skip=3|skip=4|skip=5|skip=6|skip=7/.test(m.html + m.text));
  const none = build({ customer: { first_name: 'Jo' }, sections: sk, shop: { shop_name: 'S', colors: {} }, today, manageUrl: 'https://example.com/account.html', unsubscribeUrl: 'https://example.com/u?u=abc' });
  assert.ok(!/Skip this one/.test(none.html + none.text), 'a test or preview (no link maker) has no Skip');
}

assert.equal(sections([{ quantity: 1, status: 'picked_up', item: it('A', '1') }], { today }), null);
assert.equal(sections([], { today }), null);

const shop = { shop_name: "Main Street Comics", colors: { primary: '#c8102e', accent: '#ffd100' }, street: '1 Main St', city: 'Springfield', region: 'ST', postal_code: '40202', phone: '(502) 555-0100' };
const mail = build({ customer: { first_name: 'Jane', last_name: 'Smith', ship_arrivals: true }, sections: sec, shop, today, manageUrl: 'https://example.com/account.html', unsubscribeUrl: 'https://example.com/u?u=abc' });
assert.match(mail.subject, /1 ready for pickup, 1 coming this week/);
assert.match(mail.html, /Hi Jane,/);
assert.match(mail.html, /Log in to edit your pull list/);
assert.match(mail.html, /href="https:\/\/example\.com\/app"[^>]*>Get [^<]*’s app<\/a>/, 'the weekly email points to the app');
assert.match(mail.text, /: https:\/\/example\.com\/app\n/);
const noApp = build({ customer: { first_name: 'Jane' }, sections: sec, shop, today, manageUrl: 'https://example.com/account.html', unsubscribeUrl: 'https://example.com/u?u=abc', app: false });
assert.ok(!/’s app/.test(noApp.html) && !/’s app/.test(noApp.text), 'a shop without the app (shops.json) gets no app line');
assert.match(noApp.text, /account\.html\n\n--/);
assert.match(mail.html, /Unsubscribe/);
assert.ok(!mail.html.includes('<script>'), 'titles are escaped');
assert.match(mail.html, /X &lt;script&gt; #1/);
assert.match(mail.text, /READY FOR PICKUP \(1\)/);
assert.match(mail.text, /ship your ready books/);
assert.match(mail.text, /\[NEW\]/);
assert.match(build({ customer: {}, sections: sec, shop, today, manageUrl: 'x', unsubscribeUrl: 'y' }).html, /Hi,/);
console.log('email tests passed');
console.log('\nSubject:', mail.subject, '\n\n' + mail.text);

// ---- "Your books are in" -----------------------------------------------------
import { arrivalSections, buildArrival, hoursLines, arrivalSubject } from './email.js';

const arr = (title, variant, q, price, arrivedOn, notified = null) => ({ quantity: q, status: 'arrived', arrived_on: arrivedOn, arrival_notified_at: notified, item: { title, issue_number: '1', variant, price } });
const alines = [
  arr('ABSOLUTE BATMAN', 'CVR A', 2, 5.99, '2026-10-07'),
  arr('DAREDEVIL', null, 1, 4.99, '2026-10-07'),
  arr('SAGA <b>', null, 1, null, '2026-10-07'),
  arr('OLDER BOOK', null, 1, 3.99, '2026-09-30', '2026-09-30T15:00:00Z'),
  { quantity: 1, status: 'open', arrived_on: null, arrival_notified_at: null, item: { title: 'NOT YET', issue_number: '2', price: 1 } },
];
const asec = arrivalSections(alines, { holdDays: 30 });
assert.deepEqual(asec.fresh.map((e) => e.title), ['ABSOLUTE BATMAN #1', 'DAREDEVIL #1', 'SAGA <b> #1']);
assert.deepEqual(asec.waiting.map((e) => e.title), ['OLDER BOOK #1']);
assert.equal(asec.fresh[0].holdUntil, '2026-11-06');
assert.equal(arrivalSections([arr('X', null, 1, 1, '2026-10-07', '2026-10-07T10:00:00Z')], {}), null, 'nothing new → no email');
assert.equal(arrivalSections([], {}), null);

assert.deepEqual(hoursLines([{ days: ['Tu', 'We', 'Th', 'Fr', 'Sa'], open: '11:00', close: '19:00' }, { days: ['Su', 'Mo'], open: '12:00', close: '18:00' }]), ['Tue–Sat 11 AM – 7 PM', 'Sun, Mon 12 PM – 6 PM']);
assert.equal(arrivalSubject(1, 'Main Street'), 'Your books are in at Main Street: 1 title ready for pickup');

const shop2 = { ...shop, hours: [{ days: ['Tu', 'We', 'Th', 'Fr', 'Sa'], open: '11:00', close: '19:00' }] };
const am = buildArrival({ customer: { first_name: 'Jane' }, arrival: asec, shop: shop2, manageUrl: 'https://example.com/account.html', unsubscribeUrl: 'https://example.com/u?u=abc&k=arrivals' });
assert.match(am.subject, /3 titles ready for pickup/);
assert.match(am.html, /Your books are in!/);
assert.match(am.html, /ready for pickup\. Pay when you pick them up/);
assert.match(am.html, /Tue–Sat 11 AM – 7 PM/);
// 12.97 + 4.99 = 16.97 at cover; no follows → 0 series → no discount line
assert.match(am.html, /Estimated total \$16\.97/);
assert.ok(!/pull list discount|You follow/.test(am.html));

// Series on the list don't count, only series follows (artist follows don't either): 5 series, 10% off
const dl = alines.map((l, i) => ({ ...l, item: { ...l.item, series_key: `s${i}` } }));
assert.equal(arrivalSections(dl, { holdDays: 30 }).series, 0);
const follows = [...['a', 'b', 'c', 'd', 'e', 'a'].map((key) => ({ kind: 'series', key })), { kind: 'artist', key: 'x' }];
const dsec = arrivalSections(dl, { holdDays: 30, follows });
assert.equal(dsec.series, 5);
const dm = buildArrival({ customer: { first_name: 'Jane' }, arrival: dsec, shop: shop2, manageUrl: 'x', unsubscribeUrl: 'y' });
assert.match(dm.html, /Estimated total \$15\.27/);
assert.match(dm.html, /10% pull list discount \(−\$1\.70\) from \$16\.97/);
assert.match(dm.html, /Follow 11 more to get 15% off/);
assert.match(dm.text, /Estimated total \$15\.27/);
const wk = build({ customer: {}, sections: { ...sec, series: 16 }, shop, today, manageUrl: 'x', unsubscribeUrl: 'y' });
assert.match(wk.html, /You follow 16 series: 15% off\. Follow 15 more to get 20% off\./);
assert.match(wk.text, /15% off/);

// Switched off in settings: no discount, no tier line
const offShop = { ...shop2, discount_enabled: false };
const om = buildArrival({ customer: { first_name: 'Jane' }, arrival: dsec, shop: offShop, manageUrl: 'x', unsubscribeUrl: 'y' });
assert.match(om.html, /Estimated total \$16\.97/);
assert.ok(!/pull list discount|You follow/.test(om.html));
// Custom tiers from settings
const cm = buildArrival({ customer: {}, arrival: dsec, shop: { ...shop2, discount_tiers: [{ min: 1, pct: 50 }] }, manageUrl: 'x', unsubscribeUrl: 'y' });
assert.match(cm.html, /Estimated total \$8\.4[89]/);
assert.match(cm.html, /top discount/);

// The function's copy of the tiers matches the site's
import { readFileSync } from 'node:fs';
const body = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !l.startsWith('// Copy of'));
assert.deepEqual(body('./discount.js'), body('../../../js/discount.js'), 'discount.js copies differ');
assert.match(am.html, /1 without a price not counted/);
assert.match(am.html, /Still waiting for you \(1\)/);
assert.ok(!am.html.includes('<b>'), 'titles are escaped');
assert.match(am.text, /READY FOR PICKUP \(3\)/);
assert.match(am.text, /Stop these emails/);
const ship = buildArrival({ customer: { first_name: 'Maria', ship_arrivals: true }, arrival: asec, shop: shop2, manageUrl: 'x', unsubscribeUrl: 'y' });
assert.match(ship.html, /We&#39;ll ship them to the address on your profile/);
assert.match(ship.html, /Just arrived \(3\)/);
assert.match(buildArrival({ customer: {}, arrival: asec, shop: shop2, manageUrl: 'x', unsubscribeUrl: 'y', sample: true }).subject, /^\[Sample\] /);
console.log('arrival email tests passed');

// Logo in the header: a resized copy when the shop has one, nothing when it doesn't.
const LOGO = 'https://x.supabase.co/storage/v1/object/public/media/brand/logo.png';
const withLogo = buildArrival({ customer: { first_name: 'Jane' }, arrival: asec, shop: { ...shop2, logo_url: LOGO }, manageUrl: 'x', unsubscribeUrl: 'y' });
assert.match(withLogo.html, /<img src="https:\/\/x\.supabase\.co\/storage\/v1\/render\/image\/public\/media\/brand\/logo\.png\?width=96&amp;height=96&amp;resize=contain" width="48"/);
assert.doesNotMatch(buildArrival({ customer: {}, arrival: asec, shop: shop2, manageUrl: 'x', unsubscribeUrl: 'y' }).html, /<img /);
console.log('logo header tests passed');

// Email look (Admin → Emails → Look): blank follows the site, overrides win, text stays readable.
const site = emailLook({ colors: { primary: '#982c21' }, logo_url: LOGO });
assert.equal(site.header, '#982c21');
assert.equal(site.button, '#982c21');
assert.equal(site.headerText, '#ffffff');
assert.match(site.logo, /render\/image\/public/);
const custom = emailLook({ colors: { primary: '#982c21' }, logo_url: LOGO, email_logo_url: 'https://example.com/e.png', email_header_color: '#ffd100', email_button_color: '#ffe680' });
assert.equal(custom.header, '#ffd100');
assert.equal(custom.headerText, '#161616', 'dark text on a yellow header');
assert.equal(custom.buttonText, '#161616');
assert.equal(custom.title, '#161616', 'a pale button color falls back to dark section titles');
assert.equal(custom.logo, 'https://example.com/e.png');
assert.equal(emailLook({ email_header_color: 'red', colors: {} }).header, '#c8102e', 'junk colors are ignored');
const html = buildArrival({ customer: {}, arrival: asec, shop: { ...shop2, email_header_color: '#123456', email_button_color: '#654321' }, manageUrl: 'x', unsubscribeUrl: 'y' }).html;
assert.match(html, /background:#123456/);
assert.match(html, /background:#654321;color:#ffffff/);
console.log('email look tests passed');

// One-to-one staff message: escaped, paragraphs kept, shop header and footer.
const msg = buildMessage({ shop: { ...shop2, logo_url: LOGO }, subject: 'Your order', message: 'Hi <b>Jane</b>,\n\nYour book is in.\nSee you soon!' });
assert.equal(msg.subject, 'Your order');
assert.match(msg.html, /Hi &lt;b&gt;Jane&lt;\/b&gt;,<\/p>/, 'message text is escaped');
assert.match(msg.html, /Your book is in\.<br>See you soon!/, 'single line breaks stay, blank lines make paragraphs');
assert.match(msg.html, /<img src=/);
assert.match(msg.text, /^Hi <b>Jane<\/b>,/);
assert.match(msg.text, /Main Street Comics, 1 Main St/);
console.log('message tests passed');

// Test copies: a note at the top saying the unsubscribe link is off; nothing else changes.
const real = { subject: 'S', html: '<!doctype html><html><body style="margin:0"><a href="https://site/account.html">Unsubscribe</a></body></html>', text: 'Hi\nUnsubscribe: https://site/account.html\n' };
const t = asTest(real, 'Don <b>');
assert.equal(t.subject, 'S');
assert.match(t.html, /<body style="margin:0"><div [^>]*>Test copy of the email Don &lt;b&gt; gets\. Its unsubscribe link is switched off\.<\/div><a /);
assert.match(t.text, /^\[Test copy of the email Don <b> gets\. Its unsubscribe link is switched off\.\]\n\nHi\n/);
assert.match(asTest(real).text, /a customer gets/);
console.log('test copy tests passed');

// Arrival claims: send only emails whose titles this run got all of; hand back a partial claim.
const claims = splitClaims([{ c: 1, ids: [1, 2] }, { c: 2, ids: [3, 4] }, { c: 3, ids: [5] }, { c: 4, ids: [6] }], [1, 2, 3, 5]);
assert.deepEqual(claims.send.map((m) => m.c), [1, 3]);
assert.deepEqual(claims.release, [3], 'customer 2: another run got title 4, so title 3 goes back');
assert.deepEqual(splitClaims([{ ids: [1] }], []), { send: [], release: [] });
console.log('claim tests passed');

// A location's address, phone and hours replace the shop's in emails; with no location the shop is unchanged.
{
  const shop = { shop_name: 'Shop', street: '1 Old St', phone: '111', hours: [], email: 'a@b.c' };
  assert.equal(withLocation(shop, null), shop);
  const w = withLocation(shop, { name: 'Downtown', street: '2 New St', city: 'Town', region: 'OR', postal_code: '97000', phone: '222', hours: [{ days: ['Mo'], open: '10:00', close: '18:00' }] });
  assert.equal(w.street, '2 New St');
  assert.equal(w.phone, '222');
  assert.equal(w.hours.length, 1);
  assert.equal(w.email, 'a@b.c');
  assert.equal(w.shop_name, 'Shop');
}

// Several locations: the name reads "Shop : Location", and applying a location twice doesn't stack it.
{
  const shop = { shop_name: 'Area71 Comics & Toys' };
  const loc = { name: 'Elizabethtown', street: '2 New St', hours: [] };
  assert.equal(withLocation(shop, loc).shop_name, 'Area71 Comics & Toys');
  const multi = withLocation(shop, loc, { multi: true });
  assert.equal(multi.shop_name, 'Area71 Comics & Toys : Elizabethtown');
  assert.equal(withLocation(multi, { name: 'Camp Taylor' }, { multi: true }).shop_name, 'Area71 Comics & Toys : Camp Taylor');
}

// Background colors: standard warm gray page and white body, or the shop's own; light text on a dark body.
{
  const std = emailLook({ colors: {} });
  assert.equal(std.page, '#f4f1ea');
  assert.equal(std.body, '#ffffff');
  assert.equal(std.text, '#161616');
  const dark = emailLook({ colors: {}, email_page_color: '#000000', email_body_color: '#1b1b1b' });
  assert.equal(dark.page, '#000000');
  assert.equal(dark.text, '#ffffff', 'light text on a dark body');
  assert.notEqual(dark.muted, '#5b5b5b');
  assert.equal(emailLook({ colors: {}, email_body_color: 'nope' }).body, '#ffffff', 'junk colors are ignored');
  const mail = buildMessage({ shop: { shop_name: 'S', colors: {}, email_page_color: '#102030', email_body_color: '#203040' }, message: 'Hi', to: 'a@b.c' });
  assert.match(mail.html, /background:#102030/);
  assert.match(mail.html, /background:#203040/);
}
console.log('email background color tests passed');

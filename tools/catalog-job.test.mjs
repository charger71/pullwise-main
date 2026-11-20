// node tools/catalog-job.test.mjs
import assert from 'node:assert/strict';
import { emailLeftOut, sendEmail } from './catalog-job.mjs';

const mail = { subject: 'Left out of the catalog: PRH, 1 title (Nov 20)', html: '<p>x</p>', text: 'x', csv: 'Title,Why,Detail,Code\r\nA,B,,="1"', filename: 'left-out-prh-2026-11-20.csv' };
const calls = [];
/** The catalog's service client, as far as sending is concerned: functions.invoke answers with `reply`. */
const catalog = (reply) => ({ functions: { invoke: async (name, opts) => (calls.push({ name, body: opts.body }), reply()) } });
const quiet = console.log;
console.log = () => {};

// No recipient: skipped, the catalog isn't called.
delete process.env.LEFT_OUT_EMAIL;
assert.equal(await emailLeftOut(catalog(() => ({ error: null })), { mail, sentBy: 'Automatic PRH import' }), 'skipped');
assert.equal(calls.length, 0);

// Sent through the catalog's report-email function, with the list attached.
process.env.LEFT_OUT_EMAIL = 'don@example.com, ops@example.com';
assert.equal(await emailLeftOut(catalog(() => ({ data: { ok: true }, error: null })), { mail, sentBy: 'Automatic PRH import' }), 'sent');
const { name, body } = calls.at(-1);
assert.equal(name, 'report-email');
assert.deepEqual(body.to, ['don@example.com', 'ops@example.com']);
assert.equal(body.kind, 'left_out');
assert.equal(body.sent_by, 'Automatic PRH import');
assert.equal(body.subject, mail.subject);
assert.equal(body.attachments[0].filename, mail.filename);
assert.equal(Buffer.from(body.attachments[0].content, 'base64').toString('utf8'), `﻿${mail.csv}`, 'the CSV, with a BOM so Excel reads it as UTF-8');

// A report with no attachment sends none.
assert.equal(await sendEmail(catalog(() => ({ error: null })), { to: 'don@example.com', mail: { subject: 's', html: 'h', text: 't' }, kind: 'status_report', sentBy: 'Daily status report', label: 'status email' }), 'sent');
assert.deepEqual(calls.at(-1).body.attachments, []);

// The catalog refuses (no Resend key, Resend error) or can't be reached: failed, with its reason, never thrown.
let logged = '';
console.log = (line) => (logged = line);
const refused = { error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'RESEND_API_KEY isn’t set on the catalog' }) } } };
assert.equal(await emailLeftOut(catalog(() => refused), { mail, sentBy: 'Automatic Lunar import' }), 'failed');
assert.match(logged, /left-out email not sent: RESEND_API_KEY isn’t set on the catalog/);
assert.equal(await emailLeftOut(catalog(() => { throw new Error('network down'); }), { mail, sentBy: 'Automatic Lunar import' }), 'failed');
assert.match(logged, /not sent: network down/);

console.log = quiet;
console.log('catalog job tests passed');

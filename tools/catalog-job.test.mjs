// node tools/catalog-job.test.mjs
import assert from 'node:assert/strict';
import { emailLeftOut } from './catalog-job.mjs';

const mail = { subject: 'Left out of the catalog: PRH, 1 title (Nov 20)', html: '<p>x</p>', text: 'x', csv: 'Title,Why,Detail,Code\r\nA,B,,="1"', filename: 'left-out-prh-2026-11-20.csv' };
const logs = [];
const sb = { from: (table) => ({ insert: async (row) => (logs.push({ table, row }), { error: null }) }) };
const quiet = console.log;
console.log = () => {};
const env = (vars) => {
  for (const k of ['RESEND_API_KEY', 'RESEND_FROM', 'LEFT_OUT_EMAIL']) delete process.env[k];
  Object.assign(process.env, vars);
};

// Nothing to send with: skipped, nothing called, nothing logged.
env({ RESEND_API_KEY: 'k', RESEND_FROM: 'Pullwise <hello@example.com>' });
let calls = 0;
assert.equal(await emailLeftOut(sb, { mail, sentBy: 'Automatic PRH import' }, async () => (calls++, { ok: true })), 'skipped');
assert.equal(calls, 0);
assert.equal(logs.length, 0);

// Sent: one Resend call with the list attached, and a row in Admin → Emails.
env({ RESEND_API_KEY: 'k', RESEND_FROM: 'Pullwise <hello@example.com>', LEFT_OUT_EMAIL: 'don@example.com, ops@example.com' });
let sent;
assert.equal(await emailLeftOut(sb, { mail, sentBy: 'Automatic PRH import' }, async (url, init) => ((sent = { url, init }), { ok: true })), 'sent');
assert.equal(sent.url, 'https://api.resend.com/emails');
assert.equal(sent.init.headers.Authorization, 'Bearer k');
const body = JSON.parse(sent.init.body);
assert.deepEqual(body.to, ['don@example.com', 'ops@example.com']);
assert.equal(body.subject, mail.subject);
assert.equal(body.attachments[0].filename, mail.filename);
assert.equal(Buffer.from(body.attachments[0].content, 'base64').toString('utf8'), `﻿${mail.csv}`, 'the CSV, with a BOM so Excel reads it as UTF-8');
assert.deepEqual(logs.at(-1), { table: 'email_log', row: { kind: 'left_out', to_email: 'don@example.com, ops@example.com', subject: mail.subject, body: 'x', status: 'sent', error: null, sent_by: 'Automatic PRH import' } });

// Refused or unreachable: reported as failed and logged, never thrown.
assert.equal(await emailLeftOut(sb, { mail, sentBy: 'Automatic Lunar import' }, async () => ({ ok: false, status: 422, json: async () => ({ message: 'Invalid from' }) })), 'failed');
assert.equal(logs.at(-1).row.status, 'failed');
assert.equal(logs.at(-1).row.error, 'Resend: Invalid from');
assert.equal(await emailLeftOut(sb, { mail, sentBy: 'Automatic Lunar import' }, async () => { throw new Error('network down'); }), 'failed');
assert.equal(logs.at(-1).row.error, 'Resend: network down');

console.log = quiet;
console.log('catalog job tests passed');

import assert from 'node:assert/strict';
import { applyPageSeo } from './apply-seo.js';

const page = `<head>
  <title>Visit</title>
  <meta name="description" content="Hours and directions.">
</head>`;

// Staff text containing replacement patterns ($&, $', $$, $1) is written exactly as typed.
const tricky = "Save $$ & get $& $' $` $1 deals";
const out = applyPageSeo(page, { title: (orig) => `Pop's — ${orig} ${tricky}`, desc: tricky });
const escd = "Save $$ &amp; get $&amp; $' $` $1 deals";
assert.ok(out.includes(`<title data-seo data-default="Visit">Pop's — Visit ${escd}</title>`), out);
assert.ok(out.includes(`<meta name="description" data-seo data-default="Hours and directions." content="${escd}">`), out);
assert.ok(out.includes(`<meta property="og:title" content="Pop's — Visit ${escd}">`), out);
assert.ok(out.includes(`<meta property="og:description" content="${escd}">`), out);

// Running again is stable, and clearing the description restores the original.
assert.equal(applyPageSeo(out, { title: (orig) => `Pop's — ${orig} ${tricky}`, desc: tricky }), out);
const cleared = applyPageSeo(out, { title: (orig) => orig, desc: '' });
assert.ok(cleared.includes('<meta name="description" content="Hours and directions.">'), cleared);
assert.ok(cleared.includes('<title data-seo data-default="Visit">Visit</title>'), cleared);
assert.ok(!cleared.includes('og:description'));

console.log('apply-seo tests passed');

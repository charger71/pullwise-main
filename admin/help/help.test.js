// The Help screen: the Markdown reader, and that the topics, articles, walk-throughs and captured media agree.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { render, inline, plain } from './markdown.js';
import { TOPICS, GROUPS, topicForScreen, CAPTURED } from './topics.js';
import { SHOTS, VIDEOS, WALKTHROUGHS } from '../../tools/help-capture/walkthroughs.mjs';
import { allowed, toVtt, vttTime, readMs, mediaList } from '../../tools/help-capture/capture.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// ---- Markdown ------------------------------------------------------------------------------------------------------
assert.equal(inline('**Save** and *then*'), '<strong>Save</strong> and <em>then</em>');
assert.equal(inline('<b>x</b> & "y"'), '&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;', 'text is escaped');
assert.equal(inline('[Ordering](#reservations)'), '<a href="#reservations">Ordering</a>');
assert.equal(inline('[Lunar](https://lunar.example/x?a=1&b=2)'), '<a href="https://lunar.example/x?a=1&amp;b=2" target="_blank" rel="noopener">Lunar</a>');
assert.doesNotMatch(inline('[bad](javascript:alert(1))'), /<a|javascript/, 'a link that is not #, https or mailto is not a link');
assert.equal(inline('[bad](http://x.example)'), 'bad', 'plain http is dropped to its words');
assert.equal(inline('Shift+Enter and 2*3*4'), 'Shift+Enter and 2*3*4', 'stray stars are not italic');
assert.equal(inline('Cmd+Shift+R on a *Mac*'), 'Cmd+Shift+R on a <em>Mac</em>');

const md = `## Steps

1. First
2. Second
   runs on

- a bullet

> **Tip:** careful

![The list](customers-list)
![Missing](not-captured)

Plain text
on two lines`;
const html = render(md, { shots: ['customers-list'] });
assert.match(html, /<h2>Steps<\/h2>/);
assert.match(html, /<ol class="help-steps"><li>First<\/li><li>Second runs on<\/li><\/ol>/);
assert.match(html, /<ul class="help-steps"><li>a bullet<\/li><\/ul>/);
assert.match(html, /<aside class="help-tip"><p><strong>Tip:<\/strong> careful<\/p><\/aside>/);
assert.match(html, /<img src="help\/media\/customers-list.png" alt="The list"/);
assert.doesNotMatch(html, /not-captured/, 'a picture not captured yet is left out');
assert.doesNotMatch(render('![<img onerror=x>](bad name)'), /<img|<figure/, 'a picture whose name is not a plain name is not drawn, and its words are escaped');
assert.doesNotMatch(render('![x](../../evil)'), /<img/, 'a picture name cannot leave the media folder');
assert.match(html, /<p>Plain text on two lines<\/p>/);
assert.match(render('![x](not-captured)', { shots: null }), /not-captured\.png/, 'shots: null keeps every picture');
assert.equal(plain('## A [link](#x) and ![pic](y) **bold**'), 'A link and pic bold');

// ---- Topics and articles --------------------------------------------------------------------------------------------
const ids = TOPICS.map((t) => t.id);
assert.equal(new Set(ids).size, ids.length, 'topic ids are unique');
for (const t of TOPICS) assert.ok(GROUPS.some(([g]) => g === t.group), `${t.id}: unknown group ${t.group}`);

const adminJs = readFileSync(join(HERE, '..', 'admin.js'), 'utf8');
const SECTIONS = JSON.parse(adminJs.match(/const SECTIONS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
for (const s of SECTIONS.filter((s) => s !== 'help')) assert.ok(topicForScreen(s), `the ${s} screen has no Help topic (add it to a topic's screens)`);
const claimed = TOPICS.flatMap((t) => t.screens);
assert.equal(new Set(claimed).size, claimed.length, 'each screen links to one topic');
for (const s of claimed) assert.ok(SECTIONS.includes(s), `topics name a screen that doesn't exist: ${s}`);

for (const t of TOPICS) {
  const file = join(HERE, 'articles', `${t.id}.js`);
  assert.ok(existsSync(file), `no article for ${t.id}: add admin/help/articles/${t.id}.js`);
  const text = (await import(file)).default;
  assert.equal(typeof text, 'string', `${t.id}: the article exports its Markdown as the default`);
  assert.ok(text.trim().length > 200, `${t.id}: the article is nearly empty`);
  for (const [, name] of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) assert.ok(SHOTS.includes(name), `${t.id}: picture ${name} isn't made by any walk-through in tools/help-capture/walkthroughs.mjs`);
  for (const [, href] of text.matchAll(/\]\((#[^)]*)\)/g)) {
    const [screen, detail] = href.slice(1).split('/');
    if (screen === 'help') assert.ok(ids.includes(detail), `${t.id}: link to a Help topic that doesn't exist: ${href}`);
    else assert.ok(SECTIONS.includes(screen), `${t.id}: link to a screen that doesn't exist: ${href}`);
  }
  if (t.video) assert.ok(VIDEOS.includes(t.video), `${t.id}: video ${t.video} isn't recorded by any walk-through`);
}
for (const v of VIDEOS) assert.ok(TOPICS.some((t) => t.video === v), `walk-through ${v} records a video no topic shows`);
assert.equal(new Set(SHOTS).size, SHOTS.length, 'each screenshot name is made by one step');
for (const w of WALKTHROUGHS) {
  for (const s of w.steps) {
    const keys = Object.keys(s);
    assert.ok(keys.length, `${w.id}: an empty step`);
    for (const k of keys) assert.ok(['say', 'go', 'click', 'type', 'text', 'select', 'index', 'value', 'point', 'unpoint', 'press', 'scroll', 'shot', 'highlight', 'area', 'wait', 'optional'].includes(k), `${w.id}: unknown step key ${k}`);
    const ACTS = /\[data-(save|delete|go|approve[\w-]*|ro-ordered|cancel-event|restore|file)\b|data-email="(?!\w*preview)|type="submit"|:has-text\("(Save|Delete|Remove|Approve|Mark|Send to everyone)/i;
    assert.ok(!ACTS.test(`${s.click ?? ''}`), `${w.id}: walk-throughs only read; don't click ${s.click}`);
  }
}

// ---- Captured media: the list matches the folder --------------------------------------------------------------------
const onDisk = mediaList(join(HERE, 'media'));
assert.deepEqual([...CAPTURED.shots].sort(), onDisk.shots, 'media/captured.js lists exactly the screenshots in the folder: run npm run help:capture');
assert.deepEqual([...CAPTURED.videos].sort(), onDisk.videos, 'media/captured.js lists exactly the videos in the folder: run npm run help:capture');

// ---- The capture only reads ------------------------------------------------------------------------------------------
const API = 'https://abc.supabase.co';
assert.ok(allowed('GET', `${API}/rest/v1/items?select=*`));
assert.ok(allowed('POST', `${API}/auth/v1/token?grant_type=password`));
assert.ok(allowed('POST', `${API}/auth/v1/token?grant_type=refresh_token`));
assert.ok(!allowed('POST', `${API}/auth/v1/logout`));
assert.ok(allowed('POST', `${API}/rest/v1/rpc/staff_order_rows`));
assert.ok(!allowed('POST', `${API}/rest/v1/rpc/staff_mark_ordered`), 'a writing function is stopped');
assert.ok(!allowed('POST', `${API}/rest/v1/rpc/something_new`), 'an unknown function is stopped');
assert.ok(!allowed('PATCH', `${API}/rest/v1/items?id=eq.1`));
assert.ok(!allowed('DELETE', `${API}/rest/v1/customers?id=eq.1`));
assert.ok(!allowed('POST', `${API}/rest/v1/news`));
assert.ok(allowed('POST', `${API}/functions/v1/weekly-pull-list`, '{"mode":"preview"}'), 'an email preview sends nothing');
assert.ok(!allowed('POST', `${API}/functions/v1/weekly-pull-list`, '{"mode":"test"}'));
assert.ok(!allowed('POST', `${API}/functions/v1/weekly-pull-list`, '{"mode":"send"}'));
assert.ok(!allowed('POST', `${API}/functions/v1/weekly-pull-list`, 'not json'));
assert.ok(!allowed('POST', `${API}/functions/v1/staff-admin`, '{}'));

assert.equal(vttTime(75.5), '00:01:15.500');
assert.equal(vttTime(-1), '00:00:00.000');
assert.equal(toVtt([{ start: 1, end: 3.25, text: 'Hi' }], 0.5), 'WEBVTT\n\n1\n00:00:00.500 --> 00:00:02.750\nHi\n');
assert.ok(readMs('two words') >= 1800 && readMs('word '.repeat(100)) <= 6000);

console.log('help tests passed');

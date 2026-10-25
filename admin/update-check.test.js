// The update check reads the version out of admin/version.js, so the format the stamp writes must stay readable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document ??= { visibilityState: 'visible', addEventListener() {} };
const { readVersion } = await import('./update-check.js');
const { VERSION } = await import('./version.js');

assert.equal(readVersion(readFileSync(new URL('./version.js', import.meta.url), 'utf8')), VERSION, 'reads the real version.js');
assert.equal(readVersion("export const VERSION = 'v2026.10.25 · abc1234';\n"), 'v2026.10.25 · abc1234');
assert.equal(readVersion('<!doctype html><title>Not found</title>'), null, 'an error page is not a version');
const stamp = readFileSync(new URL('../tools/stamp-version.js', import.meta.url), 'utf8');
assert.match(stamp, /export const VERSION = 'v\$\{date\} · \$\{fingerprint\}'/, 'stamp-version.js still writes the line readVersion parses');
console.log('update check tests passed');

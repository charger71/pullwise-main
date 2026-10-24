import assert from 'node:assert/strict';
import { parseAdminHash, adminHash } from './route.js';

const S = ['dashboard', 'qr', 'surveys'];
const t = (hash) => parseAdminHash(hash, S);

assert.deepEqual(t('#qr'), { name: 'qr', arg: '' });
assert.deepEqual(t('#qr/ab12'), { name: 'qr', arg: 'ab12' });
assert.deepEqual(t('#qr/a%20b'), { name: 'qr', arg: 'a b' }, 'the detail is decoded');
assert.deepEqual(t('#qr/%E0%A4%A'), { name: 'qr', arg: '' }, 'a broken escape means no detail');
assert.deepEqual(t('#nope'), { name: 'dashboard', arg: '' }, 'an unknown section falls back to the dashboard');
assert.deepEqual(t('#nope/ab12'), { name: 'dashboard', arg: '' }, 'and drops its detail');
assert.deepEqual(t(''), { name: 'dashboard', arg: '' });
assert.deepEqual(t('#qr/'), { name: 'qr', arg: '' });
assert.equal(adminHash('qr'), '#qr');
assert.equal(adminHash('qr', 'ab12'), '#qr/ab12');
assert.equal(adminHash('qr', 'a b'), '#qr/a%20b');
assert.deepEqual(t(adminHash('qr', 'a b/c')), { name: 'qr', arg: 'a b/c' }, 'a slash in the detail survives the round trip');

console.log('admin route tests passed');

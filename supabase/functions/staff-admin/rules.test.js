import assert from 'node:assert/strict';
import { generatePassword, checkNewStaff, checkChange } from './rules.js';

const pw = generatePassword();
assert.equal(pw.length, 14);
assert.match(pw, /^[a-km-zA-HJ-NP-Z2-9]+$/, 'no look-alike characters');
assert.notEqual(generatePassword(), generatePassword());

assert.deepEqual(checkNewStaff({ name: ' Chris ', email: ' Chris@Example.COM ' }), { name: 'Chris', email: 'chris@example.com' });
assert.ok(checkNewStaff({ name: '', email: 'a@b.co' }).error);
assert.ok(checkNewStaff({ name: 'A', email: 'nope' }).error);
assert.ok(checkNewStaff({ name: 'A', email: 'a@b.co', password: 'short' }).error);
assert.ok(!checkNewStaff({ name: 'A', email: 'a@b.co', password: '' }).error, 'blank password means generate one');

const staff = [{ user_id: 'don', is_owner: true }, { user_id: 'chris', is_owner: false }];
assert.ok(checkChange({ action: 'remove', actorId: 'don', targetId: 'don', staff }).error, 'cannot remove yourself');
assert.ok(checkChange({ action: 'remove', actorId: 'don', targetId: 'chris', staff }).ok);
assert.ok(checkChange({ action: 'remove', actorId: 'don', targetId: 'nobody', staff }).error);
const twoOwners = [{ user_id: 'don', is_owner: true }, { user_id: 'pat', is_owner: true }];
assert.ok(checkChange({ action: 'remove', actorId: 'don', targetId: 'pat', staff: twoOwners }).ok);
assert.ok(checkChange({ action: 'remove', actorId: 'chris', targetId: 'don', staff }).error, 'never remove the last owner');
assert.ok(checkChange({ action: 'set_owner', makeOwner: false, actorId: 'don', targetId: 'don', staff }).error, 'cannot demote the only owner');
assert.ok(checkChange({ action: 'set_owner', makeOwner: false, actorId: 'don', targetId: 'don', staff: twoOwners }).ok);
assert.ok(checkChange({ action: 'set_owner', makeOwner: true, actorId: 'don', targetId: 'chris', staff }).ok);
assert.ok(checkChange({ action: 'reset_password', actorId: 'don', targetId: 'chris', staff }).ok);

// Super Admin: can't be removed or demoted by anyone, and an owner can't reset their password.
const withSuper = [{ user_id: 'don', is_owner: true, is_super: true }, { user_id: 'pat', is_owner: true }, { user_id: 'chris', is_owner: false }];
assert.match(checkChange({ action: 'remove', actorId: 'pat', targetId: 'don', staff: withSuper }).error, /Super Admin/, 'an owner cannot remove the Super Admin');
assert.match(checkChange({ action: 'remove', actorId: 'don', targetId: 'don', staff: withSuper }).error, /Super Admin|yourself/, 'the Super Admin cannot be removed at all');
assert.match(checkChange({ action: 'set_owner', makeOwner: false, actorId: 'pat', targetId: 'don', staff: withSuper }).error, /Super Admin/, 'an owner cannot demote the Super Admin');
assert.match(checkChange({ action: 'set_owner', makeOwner: false, actorId: 'don', targetId: 'don', staff: withSuper }).error, /Super Admin/, 'the Super Admin cannot be demoted');
assert.ok(checkChange({ action: 'set_owner', makeOwner: true, actorId: 'pat', targetId: 'don', staff: withSuper }).ok, 'setting owner on a Super Admin changes nothing');
assert.match(checkChange({ action: 'reset_password', actorId: 'pat', targetId: 'don', staff: withSuper }).error, /Super Admin/, 'an owner cannot reset the Super Admin password');
assert.ok(checkChange({ action: 'reset_password', actorId: 'don', targetId: 'pat', staff: withSuper }).ok, 'the Super Admin can reset an owner');
assert.ok(checkChange({ action: 'remove', actorId: 'don', targetId: 'pat', staff: withSuper }).ok, 'the Super Admin can remove an owner');
assert.ok(checkChange({ action: 'set_owner', makeOwner: false, actorId: 'don', targetId: 'pat', staff: withSuper }).ok, 'the Super Admin can demote an owner');
console.log('staff rules tests passed');

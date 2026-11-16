import assert from 'node:assert/strict';
import { dollars, centsFromDollars, capField, trustRowFrom, settingChange, ageLabel, standingChange, standingActions } from './trust.js';

assert.equal(dollars(4000), '$40.00');
assert.equal(dollars(null), '$0.00');
assert.equal(dollars(1234), '$12.34');

assert.equal(centsFromDollars('40'), 4000);
assert.equal(centsFromDollars('$40.00'), 4000);
assert.equal(centsFromDollars('12.5'), 1250);
assert.equal(centsFromDollars('1,250.99'), 125099);
assert.equal(centsFromDollars(''), null, 'blank is no cap');
assert.equal(centsFromDollars('0'), null, '0 is no cap');
assert.equal(centsFromDollars('0.00'), null);
assert.equal(centsFromDollars('abc'), undefined);
assert.equal(centsFromDollars('-5'), undefined);
assert.equal(centsFromDollars('4.999'), undefined);

assert.equal(capField(4000), '40.00');
assert.equal(capField(null), '');
assert.equal(capField(0), '');

const form = (over = {}) => {
  const v = { warning_days: '7', pause_days: '14', monthly_warning_days: '21', monthly_pause_days: '35', unproven_weekly_cap: '40', reliability_started_at: '2026-11-16', pickup_pause_enabled: 'on', verification_enabled: 'on', auto_resume_on_pickup: 'on', pickup_warning_subject: ' Waiting at {shop_name} ', pickup_warning_intro: 'Hi', pickup_pause_subject: 'On hold', pickup_pause_intro: 'Paused', ...over };
  return [(k) => v[k], (k) => v[k] === 'on'];
};
assert.deepEqual(trustRowFrom(...form()), {
  pickup_pause_enabled: true, verification_enabled: true, auto_resume_on_pickup: true,
  warning_days: 7, pause_days: 14, monthly_warning_days: 21, monthly_pause_days: 35,
  unproven_weekly_cap_cents: 4000, reliability_started_at: '2026-11-16',
  pickup_warning_subject: 'Waiting at {shop_name}', pickup_warning_intro: 'Hi', pickup_pause_subject: 'On hold', pickup_pause_intro: 'Paused',
});
assert.match(trustRowFrom(...form({ pickup_pause_subject: '  ' })), /pause email’s subject can’t be blank/);
assert.match(trustRowFrom(...form({ pickup_warning_intro: 'x'.repeat(2001) })), /too long/);
assert.equal(trustRowFrom(...form({ verification_enabled: undefined, unproven_weekly_cap: '' })).verification_enabled, false);
assert.equal(trustRowFrom(...form({ unproven_weekly_cap: '' })).unproven_weekly_cap_cents, null);
assert.match(trustRowFrom(...form({ warning_days: '14' })), /reminder before their pause/);
assert.match(trustRowFrom(...form({ monthly_pause_days: '0' })), /1 to 365/);
assert.match(trustRowFrom(...form({ pause_days: '3.5' })), /whole numbers/);
assert.match(trustRowFrom(...form({ unproven_weekly_cap: 'forty' })), /dollar amount/);
assert.match(trustRowFrom(...form({ reliability_started_at: '' })), /date/);

assert.equal(settingChange({ setting: 'verification_enabled', from_value: 'true', to_value: 'false' }), 'Verify new accounts: On → Off');
assert.equal(settingChange({ setting: 'unproven_weekly_cap_cents', from_value: '4000', to_value: null }), 'Weekly limit before first pickup: $40.00 → no limit');
assert.equal(settingChange({ setting: 'pause_days', from_value: '14', to_value: '10' }), 'Weekly pause day: day 14 → day 10');
assert.equal(settingChange({ setting: 'reliability_started_at', from_value: '2026-11-01', to_value: '2026-11-16' }), 'Count waiting days from: 2026-11-01 → 2026-11-16');

assert.equal(ageLabel(0), 'today');
assert.equal(ageLabel(1), '1 day');
assert.equal(ageLabel(9), '9 days');
assert.equal(ageLabel(null), '');

console.log('trust tests passed');

assert.equal(standingChange({ field: 'paused', from_value: 'active', to_value: 'paused (manual)' }), 'Pull list: Active → Paused by staff');
assert.equal(standingChange({ field: 'account_state', from_value: 'proven', to_value: 'unapproved (staff)' }), 'Account: Proven → Unverified by staff');
assert.equal(standingChange({ field: 'pickup_cadence', from_value: 'weekly', to_value: 'exempt' }), 'Pickup cadence: Weekly pickup → Exempt');
const acts = (r) => standingActions(r).map(([a]) => a).join(',');
assert.equal(acts({ paused_at: null, account_state: 'proven' }), 'pause,unverify');
assert.equal(acts({ paused_at: '2026-11-01', account_state: 'proven' }), 'resume,unverify');
assert.equal(acts({ paused_at: null, account_state: 'approved' }), 'pause,prove,unverify');
assert.equal(acts({ paused_at: null, account_state: 'unapproved', unapproved_reason: 'signup' }), 'pause,approve,prove,unverify');
assert.equal(acts({ paused_at: null, account_state: 'unapproved', unapproved_reason: 'staff' }), 'pause,approve,prove');
console.log('standing wording tests passed');

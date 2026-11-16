// Pickup reliability and account trust: the small pure pieces the admin screens share (money in cents, the settings
// form, the wording of account states and the settings log). The rules themselves live in the database
// (supabase/migrations/20270316000000_pickup_reliability.sql and later); nothing here decides who is paused or capped.

/** "$40.00" from 4000 cents. */
export const dollars = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

/**
 * Whole cents from what staff typed as dollars ("40", "$40.00", "12.5"). Blank or 0 → null (no cap).
 * Returns undefined when it isn't an amount.
 */
export function centsFromDollars(text) {
  const t = String(text ?? '').trim().replace(/^\$\s*/, '').replace(/,/g, '');
  if (!t) return null;
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(t)) return undefined;
  const cents = Math.round(Number(t) * 100);
  return cents === 0 ? null : cents;
}

/** The cap as the dollar field shows it: "40.00", or blank for no cap. */
export const capField = (cents) => (cents ? (cents / 100).toFixed(2) : '');

export const DAY_FIELDS = [
  ['warning_days', 'pause_days', 'Weekly'],
  ['monthly_warning_days', 'monthly_pause_days', 'Monthly'],
];

/**
 * The trust_settings row to save from the settings form, or a message saying what to fix.
 * `get(name)` reads a field's text, `has(name)` whether a checkbox is ticked.
 */
export function trustRowFrom(get, has) {
  const row = {
    pickup_pause_enabled: has('pickup_pause_enabled'),
    verification_enabled: has('verification_enabled'),
    auto_resume_on_pickup: has('auto_resume_on_pickup'),
  };
  for (const [warn, pause, label] of DAY_FIELDS) {
    for (const k of [warn, pause]) {
      const n = Number(get(k));
      if (!Number.isInteger(n) || n < 1 || n > 365) return `${label} reminder and pause days need to be whole numbers from 1 to 365.`;
      row[k] = n;
    }
    if (row[warn] >= row[pause]) return `${label} customers need their reminder before their pause: make the reminder day smaller than the pause day.`;
  }
  const cap = centsFromDollars(get('unproven_weekly_cap'));
  if (cap === undefined) return 'The weekly limit should be a dollar amount, like 40 or 40.00. Leave it blank for no limit.';
  row.unproven_weekly_cap_cents = cap;
  const start = String(get('reliability_started_at') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return 'Pick the date to count waiting days from.';
  row.reliability_started_at = start;
  return row;
}

export const ACCOUNT_STATE = { unapproved: 'Waiting for approval', approved: 'Approved', proven: 'Proven' };
export const CADENCE = { weekly: 'Weekly pickup', monthly: 'Monthly pickup', exempt: 'Exempt from pickup reminders' };

const SETTING_LABEL = {
  pickup_pause_enabled: 'Pause pulls for unclaimed books',
  verification_enabled: 'Verify new accounts',
  unproven_weekly_cap_cents: 'Weekly limit before first pickup',
  warning_days: 'Weekly reminder day',
  pause_days: 'Weekly pause day',
  monthly_warning_days: 'Monthly reminder day',
  monthly_pause_days: 'Monthly pause day',
  auto_resume_on_pickup: 'Un-pause when everything is picked up',
  reliability_started_at: 'Count waiting days from',
};

/** One settings-log value as staff read it. */
function settingValue(setting, v) {
  if (v == null || v === '') return setting === 'unproven_weekly_cap_cents' ? 'no limit' : 'blank';
  if (v === 'true') return 'On';
  if (v === 'false') return 'Off';
  if (setting === 'unproven_weekly_cap_cents') return Number(v) ? dollars(v) : 'no limit';
  if (setting.endsWith('_days')) return `day ${v}`;
  return v;
}

/** "Verify new accounts: On → Off" for a trust_settings_log row. */
export const settingChange = (r) =>
  `${SETTING_LABEL[r.setting] ?? r.setting}: ${settingValue(r.setting, r.from_value)} → ${settingValue(r.setting, r.to_value)}`;

/** "9 days" / "1 day" / "today". */
export const ageLabel = (days) => (days == null ? '' : days <= 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'}`);

// Admin smoke test: mounts every admin screen with a made-up Supabase client and reports the ones that throw,
// log errors, show an error message or leave an uncaught error behind. Open admin/smoke.html (see its text).
// The list of screens is read from the admin menu, so a new screen is picked up automatically.

const OWNER = { user_id: 'u1', name: 'Test Owner', email: 'owner@example.com', is_owner: true, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-10-01T00:00:00Z' };
const SETTINGS = {
  id: 1, shop_name: 'Test Shop', tagline: 'Tagline', timezone: 'America/New_York', hold_days: 30, max_copies_per_title: 10, show_map: true,
  colors: { primary: '#c8102e', accent: '#ffd100', ink: '#141414', paper: '#fffaf0' }, hours: [], socials: {}, announcement: '',
  pull_list_email_enabled: false, pull_list_email_day: 4, pull_list_email_hour: 9, arrival_email_enabled: false, arrival_email_after_hour: 12, arrival_email_before_hour: 20,
};
const ITEM = { id: 1, title: 'Test Title', issue_number: '1', variant: null, publisher: 'Test Pub', status: 'pre_order', price: 3.99, foc_date: '2026-12-01', release_date: '2026-12-10', cover_url: null, hidden: false, staff_pick: false, featured: false, badges: [], category_id: 1, distributor: 'lunar', sku: 'T1' };
const TABLE_ROWS = {
  categories: [{ id: 1, name: 'Comics', slug: 'comics', sort: 0 }],
  items: [ITEM],
  settings: [SETTINGS],
  locations: [
    { id: 1, name: 'Test Shop', street: '1 Main St', city: 'Town', region: 'KY', postal_code: '40000', phone: '555-0100', hours: [{ days: ['Mo', 'Tu'], open: '11:00', close: '19:00' }], map_embed_url: null, is_default: true },
    { id: 2, name: 'Second Store', street: '2 Oak St', city: 'Village', region: 'KY', postal_code: '40001', phone: null, hours: [], map_embed_url: null, is_default: false },
  ],
  staff_notice: [{ id: 1, notice: '' }],
  trust_settings: [{ id: 1, pickup_pause_enabled: true, verification_enabled: true, unproven_weekly_cap_cents: 4000, warning_days: 7, pause_days: 14, monthly_warning_days: 21, monthly_pause_days: 35, auto_resume_on_pickup: true, reliability_started_at: '2026-11-01' }],
  trust_settings_log: [{ setting: 'verification_enabled', from_value: 'false', to_value: 'true', staff_name: 'Test Owner', created_at: '2026-11-01T15:00:00Z' }],
  staff: [{ user_id: 'u1', name: 'Test Owner', is_owner: true }],
  // Import → Recent Runs, the Backup Log (the made-up client ignores filters, so every log shows all).
  job_log: [
    { id: 2, job: 'restore', ok: false, message: 'owner@example.com: replace — customers FAILED (violates foreign key)', created_at: '2026-10-02T15:00:00Z' },
    { id: 1, job: 'backup', ok: true, message: 'owner@example.com: 1,234 rows in 20 tables (1.5 MB)', created_at: '2026-10-01T15:00:00Z' },
  ],
  // Notifications → Sent
  news_pushes: [
    { id: 2, title: 'Test Shop', body: 'Testing on my phone', url: '/app', test: true, sent_by_name: 'Test Owner', status: 'sent', error: null, devices: 1, sent: 1, failed: 0, created_at: '2026-11-02T15:00:00Z' },
    { id: 1, title: '20% off trades', body: 'This weekend only.', url: '/news/sale', test: false, sent_by_name: 'Test Owner', status: 'sent', error: null, devices: 143, sent: 141, failed: 2, created_at: '2026-11-01T15:00:00Z' },
  ],
};
const RPC_DATA = {
  is_owner: true,
  push_news_reach: 143,
  staff_list: [OWNER],
  staff_health: { jobs: [{ name: 'flip-item-statuses', schedule: '0 * * * *', active: true, last_start: new Date().toISOString(), last_status: 'succeeded', last_message: '1 row', failed_7d: 0 }], arrival_waiting: 0, http_errors_24h: 0 },
  backup_meta: { tables: [], migration: '1' },
  backup_page: { count: 0, rows: [] },
  media_usage: [],
  // Dashboard and Analytics: reservations in progress, added up by the database.
  staff_line_summary: {
    open_copies: 4, arrived_copies: 2, arrived_orders: 1, overdue_lines: 1,
    by_foc: [{ foc_date: '2026-12-01', copies: 4, orders: 2 }],
    top: [{ copies: 6, item: ITEM }],
    money: { ready: 7.98, coming: 15.96, unpriced_ids: [] },
  },
  // Customers → Unclaimed and the pickup indicator.
  staff_pickup_summary: [{ customer_id: 1, first_name: 'Jane', last_name: 'Smith', name: 'Jane Smith', email: 'jane@example.com', phone: '5550100', account_state: 'approved', unapproved_reason: null, paused_at: '2026-11-10T15:00:00Z', paused_reason: 'auto', pickup_cadence: 'weekly', unclaimed_count: 2, unclaimed_copies: 3, unclaimed_cents: 1248, oldest_received_on: '2026-10-31', oldest_age_days: 16, warning_on: '2026-11-07', pause_on: '2026-11-14', last_pickup_at: '2026-10-30T18:00:00Z' }],
};

/** A Supabase query builder that answers every call with empty (or canned) data. */
function chain(table, single = false, error = null, data = undefined) {
  const state = { single };
  const proxy = new Proxy(function () {}, {
    get(_, key) {
      if (key === 'then') {
        if (data !== undefined) return (resolve) => resolve(error ? { data: null, error } : { data, error: null });
        const rows = TABLE_ROWS[table] ?? [];
        const out = state.single ? rows[0] ?? null : rows;
        return (resolve) => resolve(error ? { data: null, count: null, error } : { data: out, count: rows.length, error: null });
      }
      if (key === 'single' || key === 'maybeSingle') return () => ((state.single = true), proxy);
      return () => proxy;
    },
  });
  return proxy;
}
// ?break=1 makes every database call fail: the test should then report failures (a check that the test itself works).
const BREAK = new URLSearchParams(location.search).has('break');
const boom = { message: 'duplicate key value violates unique constraint "items_upc_idx"', code: '23505' };
const stubClient = () => ({
  from: (table) => (BREAK ? chain('__break__', false, boom) : chain(table)),
  // Like supabase-js, an RPC call is a query builder (.range() etc.) that resolves to its result.
  rpc: (name) => (BREAK ? chain('__break__', false, boom, null) : chain(name, false, null, name in RPC_DATA ? RPC_DATA[name] : [])),
  auth: {
    getUser: async () => ({ data: { user: { id: 'u1', email: 'owner@example.com' } } }),
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    updateUser: async () => ({ error: null }),
  },
  storage: { from: () => ({ list: async () => ({ data: [], error: null }), getPublicUrl: (p) => ({ data: { publicUrl: `https://example.com/${p}` } }), remove: async () => ({ error: null }), upload: async () => ({ error: null }) }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  // Realtime (the Chat screen listens for new messages): a channel that never sends anything.
  channel: () => {
    const ch = { on: () => ch, subscribe: () => ch, unsubscribe: async () => 'ok' };
    return ch;
  },
  removeChannel: async () => 'ok',
});

const results = document.getElementById('results');
const stage = document.getElementById('stage');
const row = (name, ok, details) => results.insertAdjacentHTML('beforeend', `<tr><td>${name}</td><td>${ok ? '✓ passed' : '<strong class="form-error">✗ FAILED</strong>'}</td><td>${String(details).replace(/</g, '&lt;')}</td></tr>`);

async function main() {
  const html = await (await fetch('./index.html')).text();
  const sections = [...html.matchAll(/<a href="#([a-z]+)"/g)].map((m) => m[1]);
  if (!sections.length) throw new Error('Could not read the admin menu from index.html');
  let failed = 0;
  for (const name of sections) {
    const problems = [];
    const onError = (e) => problems.push(`uncaught: ${e.message ?? e.reason?.message ?? e.reason ?? e}`);
    const realConsoleError = console.error;
    console.error = (...a) => (problems.push(`console.error: ${a.map(String).join(' ').slice(0, 160)}`), realConsoleError.apply(console, a));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    const el = document.createElement('div');
    stage.append(el);
    try {
      const module = await import(`./sections/${name}.js`);
      await module.mount(el, { sb: stubClient(), isOwner: true });
      await new Promise((r) => setTimeout(r, 400)); // let the screen's own loading finish
      const shown = [...el.querySelectorAll('.form-error')].map((n) => n.textContent.trim()).filter(Boolean);
      if (shown.length) problems.push(`error shown on screen: ${shown[0].slice(0, 160)}`);
      if (!el.textContent.trim()) problems.push('screen is empty');
    } catch (err) {
      problems.push(`threw: ${err.message}`);
    }
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
    console.error = realConsoleError;
    el.remove();
    if (problems.length) failed++;
    row(name, !problems.length, problems.join(' | ') || 'opened');
  }
  const summary = document.getElementById('summary');
  summary.textContent = failed ? `${failed} of ${sections.length} screens failed.` : `All ${sections.length} screens opened.`;
  summary.className = `admin-status ${failed ? 'form-error' : ''}`;
  document.title = `SMOKE ${failed ? 'FAIL' : 'PASS'}: ${sections.length - failed}/${sections.length}`;
}
main().catch((err) => {
  document.getElementById('summary').textContent = `Smoke test could not run: ${err.message}`;
  document.title = 'SMOKE FAIL';
});

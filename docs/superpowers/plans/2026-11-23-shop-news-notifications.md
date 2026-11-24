# Shop News Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff send their own push notice (title, message, where it opens) to every app user of their shop from a new
admin **Notifications** screen, with a test-send option, a send history and a "don't send too often" note.

**Architecture:** A migration adds the customers' `push_news` switch, a `news_pushes` history table and a staff-only
`push_news_reach()` count. The `push-notify` Edge Function gets a `news` mode that checks staff, records the send and
finishes delivery in the background. A new admin section composes, previews, confirms and lists sends, using pure
helpers in `admin/news-push.js` that are unit tested.

**Tech Stack:** Supabase Postgres + RLS, Deno Edge Function with `web-push`, vanilla JS admin (no build), Node
`assert` tests run by `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-23-shop-news-notifications-design.md`

## Global Constraints

- Title at most **60** characters (prefilled with the shop name); message at most **180** characters. Count characters
  with `Array.from(s).length` on both the screen and the server, so emoji count as one.
- Links: `/app`, `/app#list`, `/app#hot`, `/app#shop`, or a site path that starts with `/` and not `//`, at most 300
  characters. A full URL is accepted on the screen only when its host is the shop's own (`location.host`); it is cut to
  `pathname + search + hash`.
- The note, verbatim: "Send only what customers will be glad to get: a sale, a big new release, a closure or change of
  hours. Every notice buzzes their phone. Too many and they'll turn shop news off, or turn off notifications
  altogether. Once or twice a month is plenty."
- Customer switch label, verbatim: "News from the shop: sales, new releases and closures".
- Test checkbox label, verbatim: "Test send: only to my own devices".
- Confirm: "Send to N devices? This can't be undone." plus, when the last real send was under **3 days** ago,
  "You sent one N days ago." (or "earlier today"). Warning only, never a block.
- Push options: `tag: 'news-<id>'`, TTL **86400** seconds, urgency `normal`. Sent immediately, not held to sending hours.
- Any staff member can send. The screen and nav item exist only when `APP_ENABLED`.
- No pictures, no scheduling, no targeting (spec non-goals).
- `CLAUDE.md` admin rules: build from `admin/style-guide.html`, no inline `style="…"`, tokens only, update the style
  guide in the same change, `npm test` passes before every commit. Migration policies call `(select public.is_staff())`.

## Review Focus

1. **Double click or retry on Send:** one notice per phone. Covered by `request_id` replay (Task 2) and the button
   disabling while a send is in flight (Task 4).
2. **A full URL to another site in the link box:** refused on the screen with a clear message, and refused again by the
   server. Tests in Task 2 (`validNewsUrl`) and Task 3 (`toNewsPath`).
3. **Test send when the staff member has no app device:** no row is recorded and the screen explains how to get one
   (sign in to the app with this account, turn notifications on). Server answer `{ devices: 0 }`, tested via
   `testResultText` in Task 3.
4. **Nobody has shop news on yet (reach 0):** Send is disabled with "No customers have shop news turned on yet." Test
   in Task 3 (`reachText`).
5. **Emoji or pasted text over the limit:** counted the same on both sides and refused by the server. Tests in Task 2 and
   Task 3.

---

### Task 1: Schema and the customer's switch

**Files:**
- Create: `supabase/migrations/20270413000000_shop_news_push.sql`
- Modify: `js/app-notifications.js` (the `KINDS` list, line ~28)

**Interfaces:**
- Produces: `customers.push_news boolean not null default true` (update granted to `authenticated`).
- Produces: table `public.news_pushes (id bigint identity pk, request_id uuid not null unique, title text not null,
  body text not null, url text not null default '/app', test boolean not null default false, sent_by uuid references
  auth.users on delete set null, sent_by_name text, status text not null default 'sending' check (status in
  ('sending','sent','failed')), error text, devices int not null default 0, sent int not null default 0, failed int not
  null default 0, created_at timestamptz not null default now(), finished_at timestamptz)`, with length checks matching
  the Global Constraints, an index on `created_at desc`, RLS on, one policy "staff read news pushes" for select using
  `(select public.is_staff())`. No insert, update or delete policies: only the service role writes.
- Produces: `public.push_news_reach() returns integer`, `security definer`, `stable`. It raises `'Staff only.'` (errcode
  `P0001`) unless `public.is_staff()`, and otherwise counts `push_subscriptions s join customers c on c.id = s.customer_id
  where c.push_news`. Execute revoked from `public, anon` and granted to `authenticated`.

- [ ] **Step 1: Write the migration** with a header comment in the house style: what it adds, and that `push-notify`
  mode `news` writes the table.
- [ ] **Step 2: Add the fifth `KINDS` entry** `{ key: 'push_news', label: 'News from the shop: sales, new releases and closures' }`
  after `push_reminders`.
- [ ] **Step 3: Run the checks.** Run `node tools/check-migrations.js`. Expected: exit 0. If a local stack is running
  (`supabase status`), run `supabase db reset`. Expected: no errors.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(push): shop news switch, send history table and reach count`.

### Task 2: `news` mode in push-notify

**Files:**
- Modify: `supabase/functions/push-notify/messages.js`
- Modify: `supabase/functions/push-notify/messages.test.js`
- Modify: `supabase/functions/push-notify/index.ts`
- Modify: `SETUP.md` (the push-notify paragraph near line 274: one sentence on staff-sent shop news)

**Interfaces:**
- Consumes: Task 1's table, column and the existing `subscriptionsOf`, `sendTo`, `loadShop`, `notificationIcon`.
- Produces in `messages.js`: `NEWS_TITLE_MAX = 60`, `NEWS_BODY_MAX = 180`, `NEWS_URL_MAX = 300`,
  `charCount(s: string): number`, `validNewsUrl(url: string): boolean`,
  `checkNews({ title, body, url }): string | null` (an error sentence, or null when fine),
  `newsMessage({ id, title, body, url }): { title, body, url, tag }`.
- Produces in the function: `POST Authorization: Bearer <staff> { mode: 'news', title, body, url, test, request_id }`
  answering `200 { push: <news_pushes row> }`, `200 { devices: 0 }` for a test with no devices (nothing recorded),
  `400 { error }` for a bad message, `401 { error }` for a non-staff caller.

- [ ] **Step 1: Write the failing tests** in `messages.test.js`:

```js
assert.equal(charCount('🎉 Sale'), 6);
assert.equal(validNewsUrl('/app#hot'), true);
assert.equal(validNewsUrl('/news/big-sale?x=1'), true);
assert.equal(validNewsUrl('//evil.test/x'), false);
assert.equal(validNewsUrl('https://evil.test/'), false);
assert.equal(validNewsUrl('/' + 'a'.repeat(300)), false);
assert.equal(checkNews({ title: 'Sale', body: 'This weekend', url: '/app' }), null);
assert.match(checkNews({ title: '', body: 'x', url: '/app' }), /title/i);
assert.match(checkNews({ title: 'x', body: '🎉'.repeat(181), url: '/app' }), /180/);
assert.equal(checkNews({ title: 'x', body: '🎉'.repeat(180), url: '/app' }), null);
assert.match(checkNews({ title: 'x', body: 'y', url: 'https://evil.test' }), /link/i);
assert.deepEqual(newsMessage({ id: 7, title: ' Sale ', body: ' Fri–Sun ', url: '/app#shop' }),
  { title: 'Sale', body: 'Fri–Sun', url: '/app#shop', tag: 'news-7' });
assert.equal(newsMessage({ id: 1, title: 'x', body: 'y', url: '' }).url, '/app');
```

- [ ] **Step 2: Run** `node supabase/functions/push-notify/messages.test.js`. Expected: FAIL (`charCount` is not exported).
- [ ] **Step 3: Implement the four helpers and constants** in `messages.js`. `checkNews` trims, then checks title
  non-empty and ≤ 60, body non-empty and ≤ 180, and `validNewsUrl(url || '/app')`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Add the `news` mode to `index.ts`.**
  - Route `body.mode === 'news'` alongside `test` and `staff-test`, with the same staff check as `staff-test`. Also read
    `staff.name` for `sent_by_name`.
  - Return 400 with `checkNews`'s sentence when it isn't null. Also return 400 when `request_id` isn't a UUID.
  - **Replay:** if a row with that `request_id` exists, return it as is and send nothing.
  - **Test send:** find the caller's customer by `user_id`, using the service-role client, and their devices through
    `subscriptionsOf([id])`, ignoring `push_news`. With no devices, return `{ devices: 0 }` and record nothing.
  - **Real send:** devices are the subscriptions of customers with `push_news` on. Add a `newsDevices()` next to
    `subscriptionsOf`: page through `push_subscriptions` with an inner join on `customers!inner(push_news)` filtered to
    true, or fetch the ids of customers with `push_news` on and reuse `subscriptionsOf`.
  - Insert the row (`status 'sending'`, `devices` set, `test` set) and catch a unique violation on `request_id` by
    re-reading and returning that row. Respond with `{ push: row }`.
  - Run the delivery in `EdgeRuntime.waitUntil(...)`: `sendTo(devices, { ...newsMessage(row), icon }, CUSTOMER_TABLE,
    86400, 'normal')`. Then update the row with `status 'sent'`, `sent`, `failed` and `finished_at`. On a throw, update
    it with `status 'failed'` and `error`. Declare `EdgeRuntime` for TypeScript with
    `declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };`.
  - Add the mode to the header comment's list of modes.
- [ ] **Step 6: Type-check.** If `deno` is installed, run `deno check supabase/functions/push-notify/index.ts`.
  Expected: no errors. Otherwise, re-read the diff for types by hand.
- [ ] **Step 7: Run `npm test`.** Expected: all pass.
- [ ] **Step 8: Commit** `feat(push): push-notify sends staff-written shop news`.

### Task 3: Pure helpers for the screen

**Files:**
- Create: `admin/news-push.js`
- Create: `admin/news-push.test.js`

**Interfaces:**
- Consumes: nothing from the browser (pure functions), so Node can test them.
- Produces:
  - `APP_TARGETS = [{ value: '/app', label: 'The app' }, { value: '/app#list', label: 'My List' }, { value: '/app#hot', label: 'Hot' }, { value: '/app#shop', label: 'Shop' }]`
  - `toNewsPath(input: string, host: string): { path: string } | { error: string }`
  - `lastReal(rows: NewsRow[]): NewsRow | null`: the newest row with `!test && status !== 'failed'`.
  - `daysAgo(iso: string, now: Date): number`: whole days, where 0 means today.
  - `lastSentText(rows, now): string`: "Never sent", "Last sent earlier today by Sam" or "Last sent 3 days ago by Sam".
  - `recentWarning(rows, now): string | null`: "You sent one earlier today." or "You sent one 2 days ago." when under
    3 days, else null.
  - `reachText(n: number): string`: "Reaches 1 device", "Reaches 143 devices", or
    "No customers have shop news turned on yet." for 0.
  - `testResultText(devices: number): string`: for 0, "You have no devices with the app's notifications on. Sign in
    to the app with this account and turn notifications on, then try again."; otherwise "Test sent to your N device(s)."
  - `rowSummary(row): string`: "Sending…", "Failed: <error>", or "143 devices · 2 failed" (the failed part only when
    above 0).

- [ ] **Step 1: Write the failing tests** in `admin/news-push.test.js` (Node `assert`, run directly, same style as
  `admin/money.test.js`):

```js
const host = 'derbycomics.pullwise.shop';
assert.deepEqual(toNewsPath('', host), { path: '/app' });
assert.deepEqual(toNewsPath('/news/sale', host), { path: '/news/sale' });
assert.deepEqual(toNewsPath('news/sale', host), { path: '/news/sale' });
assert.deepEqual(toNewsPath('https://derbycomics.pullwise.shop/series/saga?x=1#a', host), { path: '/series/saga?x=1#a' });
assert.match(toNewsPath('https://evil.test/x', host).error, /your own site/i);
assert.match(toNewsPath('//evil.test/x', host).error, /your own site/i);
const now = new Date('2026-11-23T15:00:00Z');
const rows = [
  { test: true, status: 'sent', created_at: '2026-11-23T14:00:00Z', sent_by_name: 'Pat' },
  { test: false, status: 'sent', created_at: '2026-11-21T10:00:00Z', sent_by_name: 'Sam' },
];
assert.equal(lastSentText([], now), 'Never sent');
assert.equal(lastSentText(rows, now), 'Last sent 2 days ago by Sam');
assert.equal(recentWarning(rows, now), 'You sent one 2 days ago.');
assert.equal(recentWarning([{ ...rows[1], created_at: '2026-11-19T10:00:00Z' }], now), null);
assert.equal(recentWarning([{ ...rows[1], created_at: '2026-11-23T09:00:00Z' }], now), 'You sent one earlier today.');
assert.equal(reachText(0), 'No customers have shop news turned on yet.');
assert.equal(reachText(1), 'Reaches 1 device');
assert.match(testResultText(0), /Sign in to the app with this account/);
assert.equal(rowSummary({ status: 'sending' }), 'Sending…');
assert.equal(rowSummary({ status: 'sent', devices: 143, failed: 2 }), '143 devices · 2 failed');
assert.equal(rowSummary({ status: 'sent', devices: 5, failed: 0 }), '5 devices');
```

- [ ] **Step 2: Run** `node admin/news-push.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `admin/news-push.js`.** For `toNewsPath`: add a leading `/` to bare paths, parse full URLs
  with `new URL`, and accept a URL only when `url.host === host`. Days are counted between calendar days in local
  time.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): helpers for the shop news screen`.

### Task 4: The Notifications screen

**Files:**
- Create: `admin/sections/notifications.js`
- Modify: `admin/admin.js:21` (add `'notifications'` to `SECTIONS` after `'chat'`). Near line 183, hide the nav item
  when `!APP_ENABLED`, the same way `LOCATIONS_ENABLED` hides Locations.
- Modify: `admin/index.html` (a nav `<li>` after Chat: `href="#notifications"`, a bell `solid-icon nav-icon` SVG,
  `<span>Notifications</span>`)
- Modify: `admin/admin.css` (classes for the notice preview and the reach/last-sent line, tokens only)
- Modify: `admin/style-guide.html` (an example of the notice preview, and any new component or variant)
- Modify: `admin/sections/help.js` (`SCREEN_NAMES.notifications = 'Notifications'`), `admin/help/topics.js` (a
  `notifications` topic in group `pull`, `screens: ['notifications']`, `video: null`), and a new
  `admin/help/articles/notifications.js`: what it's for, the note, test send, the customer switch, and that iPhones
  only get notices from the Home Screen app.
- Modify: `ADMIN-ONBOARDING.md` (a row after Chat, audience "Counter staff")

**Interfaces:**
- Consumes: Task 3's helpers; Task 2's `push-notify` `news` mode via `sb.functions.invoke('push-notify', { body })`,
  with errors read as in `lib.js` `sendCustomerEmail` (`error.context.json()`); Task 1's `news_pushes` (select, newest
  first, limit 20, then "Show more" adds 20) and `push_news_reach()`; `settings.shop_name`, `favicon_url` and `logo_url`
  for the prefill and the preview icon; `openDialog`, `hintFold`, `setStatus`, `toast`, `fmtDateTime`, `esc` and
  `uid` from `lib.js`.
- Produces: `export async function mount(el, ctx)`.

- [ ] **Step 1: Build the screen** from the style guide's pieces:
  - The `<h1>` with a `hintFold` "How this works" right under it (consistency check), then the note as a hint above the
    form.
  - The form:
    - Title and Message, with live counts in the form `12 / 60`, counted with `Array.from`.
    - **Opens**: a select with `APP_TARGETS` plus "A page on our website". The last option shows a text box with the
      hint "Opens in the browser, outside the app."
    - The preview: shop icon, title and message, updating as you type.
    - The `reachText` and `lastSentText` line.
    - The test checkbox, and a **Send** button that is disabled when reach is 0 and the box is unticked.
  - The history below, with one row per send: `fmtDateTime(created_at)`, `sent_by_name`, a "Test" pill when `test`,
    title, message, where it opens, and `rowSummary`.
- [ ] **Step 2: Wire sending.**
  - Make a `request_id` with `crypto.randomUUID()` when the screen mounts, and a new one after each answered send.
  - Run `toNewsPath`, and show its error under the box if there is one.
  - **Test send:** no dialog. Invoke the function and show `testResultText(data.devices ?? data.push.devices)`.
  - **Real send:** first open the confirm dialog (Global Constraints wording, plus `recentWarning` when not null), with
    **Send** and **Cancel** buttons.
  - Disable the Send button from click until the answer arrives.
  - On success, toast "Sending to N devices.", clear the form back to the prefill, and reload the history.
  - While any row is `sending`, re-read the history every 4 s. Stop when none are left or the screen has gone
    (`root.isConnected` is false, the way `admin/sections/chat.js` guards its timer).
- [ ] **Step 3: Style guide and CSS.** Add the preview classes to `admin.css`, using tokens only, and the example to
  `style-guide.html`.
- [ ] **Step 4: Run `npm test`.** Expected: all pass, including `admin/consistency.test.js`: no inline styles, the
  guide covers the new classes, How this works sits under the title, and there is no unused CSS.
- [ ] **Step 5: Check it in the browser.**
  - Start the dev preview from `.claude/launch.json`, or add an entry if there is none.
  - Sign in on the demo shop and open `#notifications`.
  - Check that the counts, the preview, the link error for `https://evil.test`, the Send disabled state and the confirm
    dialog text all work.
  - Do a **test send** only, and check that the history shows a "Test" row.
  - Take a screenshot for the user.
- [ ] **Step 6: Commit** `feat(admin): Notifications screen for staff-sent shop news`.

### Task 5: Rebuild the design system

**Files:**
- Modify: whatever `tools/design-system/` regenerates (see `tools/design-system/README.md`)

- [ ] **Step 1: Run** `npm run design-system`, then `npm run design-system:check`. Expected: the check passes and the
  admin layer includes the notice preview.
- [ ] **Step 2: Republish** the design system artifact (https://claude.ai/artifact/YWP6UsATWeCe9f6mdqxJJn) as the
  README describes.
- [ ] **Step 3: Commit** any regenerated files: `chore(design-system): add the shop news notice preview`.

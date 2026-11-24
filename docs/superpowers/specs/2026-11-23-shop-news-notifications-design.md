# Shop news notifications: staff send their own push to app users

## Why
Today every app notification is automatic: books ready, new titles from follows, reminders, chat replies. A shop has
no way to tell its app users about a sale, a big new release or a closure. Shops want to send those themselves, from
the admin, whenever they need to. The feature is meant to be used, not abused: staff should be nudged not to send too
often.

## Goals
- Any staff member can write a title, a message and an optional link, and send it to every device of their own shop's
  app users who have notifications on.
- Before sending, staff see how many devices it will reach, a preview of the notice, and when the shop last sent one.
- A clear note on the screen asks staff not to send too often, and says what it's for: sales, new releases, closures.
- A history of past sends shows who sent what, when, and how many devices got it.
- Customers can turn these off with their own switch without losing pickup alerts.

## Non-goals
- Scheduling a send for later, targeting a subset of customers, or images in the notice.
- Email or SMS versions of the same message.
- Sending to staff devices (`staff_push_subscriptions`).
- Sending across shops. Each shop has its own database, so a send can only reach that shop's own devices.

## Anti-goals (failure even if it works)
- One shop's message reaching another shop's customers.
- Customers turning off *all* notifications because of too many shop messages, and so losing pickup alerts.
- A notice that opens a page outside the shop's own site.
- A double click or a slow network sending the same message twice.

## Constraints
- Only devices in `push_subscriptions` can be reached: customers who allowed notifications on that device, in the app
  or a browser. Someone who installed the app but never allowed notifications isn't reached.
- Only shops with `"app": true` in `shops.json` (`APP_ENABLED`) show the screen. Today those are demo, derbycomics and
  popscomics502.
- The admin rules in `CLAUDE.md` apply: build from `admin/style-guide.html`, no inline styles, tokens only, update the
  style guide in the same change, and `npm test` passes.

## Approaches considered
- **A. A new "Notifications" admin screen with a history of sends (chosen).** It covers all three uses. The history and
  the "last sent" line turn the "don't overdo it" note into something staff can see and act on.
- **B. A "send as notification" tick box on News posts.** Less to build, but a closure or a same-day sale would need a
  whole news post first, which is friction exactly when it's urgent.
- **C. A send form with no history.** Cheaper than A, but nothing shows how often the shop sends, so the note has no
  teeth.

## Design (decided)
**Admin screen.** A new nav item, **Notifications**, in the Pull List group after Chat, hidden when `APP_ENABLED` is
off. `admin/sections/notifications.js`. It has two parts:
1. **Send form.**
   - Fields: **Title** (shown in bold on the phone; up to 60 characters, prefilled with the shop name) and **Message**
     (up to 180 characters), each with a live character count.
   - **Opens (decided):** where tapping goes. A choice of **The app** (the default), a tab in the app (**My List**,
     **Hot**, **Shop**), or **A page on our website**, with a box for the page. A website page accepts a path
     (`/news/…`, `/series/…`, a page) or a full URL on the shop's own domain, which is cut down to its path. A website
     page opens outside the app (in the browser, or the app's in-app browser bar), and the screen says so under the
     box. `sw.js` needs no change: it already opens `data.url`.
   - A live phone-style **preview** of the notice with the shop icon.
   - A line above the button: "Reaches **N** devices · Last sent 3 days ago by Sam". When nothing has been sent yet:
     "Never sent". Test sends don't count.
   - The note, shown as a hint above the form: "Send only what customers will be glad to get: a sale, a big new
     release, a closure or change of hours. Every notice buzzes their phone. Too many and they'll turn shop news off,
     or turn off notifications altogether. Once or twice a month is plenty."
   - **Test send (decided):** a checkbox beside **Send**, "Test send: only to my own devices". Ticked, the notice
     goes only to the signed-in staff member's own devices in the app (the customer account with the same login), is
     marked as a test in the history, and skips the confirm dialog. If they have no such device, the screen says how
     to get one: sign in to the app with this account and turn notifications on. Every shop has the checkbox, demo
     included, and demo sends like any other shop.
   - **Send** (not a test) opens a confirm dialog ("Send to 143 devices? This can't be undone.") using `openDialog`.
     If the last real send was less than 3 days ago, the dialog adds a warning line ("You sent one 2 days ago."). This
     is a warning only, never a block.
2. **History.** The most recent sends, newest first: date and time, who sent it, title, message, where it opens, and
   "N devices · M failed" (or "Sending…"). Test sends are marked "Test" and don't count for "Last sent". Read-only.

**Customer switch.** A new column `customers.push_news boolean not null default true`, with update granted to
`authenticated` like the other four. A fifth line in the app's notification settings (`js/app-notifications.js`):
"News from the shop: sales, new releases and closures". The count on the admin screen and a real send include only devices
whose customer has `push_news` on. (The notification onboarding design's "all four stay on" becomes all five.)

**Sending.** A new mode in the `push-notify` Edge Function:
`POST Authorization: Bearer <staff> { "mode": "news", title, body, url, test, request_id }`.
- It checks the caller is staff (the same check as `staff-test`).
- It validates the lengths and the link (a relative path that starts with `/` and not `//`; app tabs are `/app`,
  `/app#list`, `/app#hot`, `/app#shop`).
- It records the send in a new `news_pushes` table, then sends to every subscribed device of customers with `push_news`
  on, with `tag: 'news-<id>'`, a TTL of 24 hours and normal urgency.
- `request_id` (a UUID the screen makes when the form opens, renewed after each send) is unique in the table, so a
  repeated request never sends again (see Delivery).
- `test: true` sends only to the caller's own customer devices (customer whose `user_id` is the caller), ignoring
  `push_news`, and records the row with `test = true`.
- **Delivery (my call, from scale):** a shop has hundreds of devices, not tens of thousands, but the send must never
  go out twice or look finished when it isn't. So the function inserts the row with `status = 'sending'`, replies
  straight away with the row, and finishes the send in the background (`EdgeRuntime.waitUntil`), 20 devices at a time
  so a large shop finishes well inside the time limit (other notices still send one by one). It then sets
  `status = 'sent'` with the counts, or `'failed'` with the error. A repeated `request_id` returns the existing row
  instead of an error, so a retry after a timeout shows the same send and never sends again. The history shows
  "Sending…" until it's done (the screen polls that row every few seconds while it's open).
- The send runs immediately. It is not held to the automatic notices' sending hours, because staff choose the moment.

**Table `news_pushes`.** Columns: `id`, `request_id uuid unique`, `title`, `body`, `url`, `sent_by uuid` (the staff
user), `sent_by_name` (copied from `staff.name` at send time), `test boolean`, `status` (`sending`/`sent`/`failed`),
`error`, `created_at`, `finished_at`, `devices`, `sent`, `failed`. Row level security: staff can
read it. Only the Edge Function (service role) writes it.

**Device count.** The screen counts devices with a staff-only RPC, `push_news_reach()`. It returns the number of
`push_subscriptions` rows whose customer has `push_news` on.

## Left to the builder
- Exact markup and classes, built from the style guide's form, fold, dialog and table/card-list pieces. Add the preview
  and anything new to `admin/style-guide.html`.
- Message text in `messages.js` (a `newsMessage({ title, body, url })` helper with tests), and the migration's file
  name and date.
- How many history rows to show (suggest 20, with "Show more").
- Whether the analytics screen should also show the `push_news` opt-out count of `customers.push_news` (optional, skip if it adds weight).
- After the admin stylesheets or style guide change, rebuild and republish the design system
  (`tools/design-system/README.md`).
- Add the new screen to the admin Help and to `ADMIN-ONBOARDING.md` if that lists screens.

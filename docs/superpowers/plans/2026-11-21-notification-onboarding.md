# Notification Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get more app customers to turn on push notifications by asking at the right moment, with a real button in the welcome card and a standing card on My List.

**Architecture:** A pure rules module (`js/push-nudge.js`) decides when a prompt may show and keeps the pauses. Call sites dispatch a "nudge" after a successful add or follow. An app-only UI module (`js/app-push-prompts.js`) listens for nudges and draws the cards. It turns notifications on through functions moved out of `setupNotifications` in `js/app-notifications.js`, so the Account tab and the prompts share one code path.

**Tech Stack:** Plain ES modules, no build step; Node `assert` test files run by `npm test`; `css/site.css` tokens.

**Spec:** `docs/superpowers/specs/2026-11-21-notification-onboarding-design.md`

## Global Constraints

- Prompts appear only on the app page (`document.body.dataset.page === 'app'`), and only when `pushState()` is `'off'` (supported, shop key set, not denied, no subscription on this device).
- Moment prompt: "Not now" pauses it **14 days**; at most **once per app open**.
- Standing card: closing it pauses it **30 days**; shown only once the welcome card is dismissed; never while a moment prompt is on screen.
- The phone's permission box appears only after a tap on **Turn on**.
- Copy (exact):
  - Add: `Want a heads-up when <strong>${title}</strong> is ready for pickup?`
  - Follow: `Want a heads-up when new <strong>${name}</strong> issues arrive?`
  - Standing card: `Get a notification when your books are ready for pickup.`
  - After turning on: `Notifications are on. Change which ones on the Account tab.`
- `css/site.css`: tokens only, a `prefers-reduced-motion` rule for every animation, and no `style="…"` in markup written by `js/` (`css/site.test.js`).
- All `localStorage` access is wrapped in try/catch.

## Review Focus

- **No storage** (private mode, or `localStorage` throws): the moment prompt still shows once per open, the standing card stays hidden (so it never nags on every open), and nothing throws.
- **Permission already granted but no subscription** (e.g. after reinstalling): `pushState()` is `'off'`, and Turn on subscribes without showing the phone's box.
- **Two adds in quick succession:** only one moment card is drawn.
- **Turn on fails** (the save RPC errors, or the worker never starts): the card stays up with the error in it. Prompts aren't paused and nothing is half-subscribed.
- **Customer denies the phone's box:** every prompt is removed, and the Account tab shows its "blocked" guidance.

---

### Task 1: Prompt rules and the nudge event

**Files:**
- Create: `js/push-nudge.js`
- Test: `js/push-nudge.test.js`

**Interfaces:**
- Produces:
  - `NUDGE_EVENT = 'pullwise:push-nudge'` and `CHANGED_EVENT = 'pullwise:push-changed'`
  - `nudge(detail: { kind: 'add' | 'follow', label: string }): void` dispatches `NUDGE_EVENT` on `window` (a no-op where `window` is missing)
  - `MOMENT_KEY = 'pc-push-moment-until'`, `BANNER_KEY = 'pc-push-banner-until'`, `MOMENT_DAYS = 14`, `BANNER_DAYS = 30`
  - `pausedUntil(store, key): number | null` returns the ms timestamp, `null` when unset, and `Infinity` when the store throws
  - `isPaused(store, key, now: number): boolean`
  - `pause(store, key, days: number, now: number): void` swallows store errors
  - `momentText({ kind, label }): string` returns HTML with the label escaped (use `esc` from `js/site.js`, or a local escape if importing site.js would pull in DOM code under Node)

- [ ] **Step 0:** `git switch -c notification-onboarding`; commit the spec and this plan (`docs: notification onboarding design and plan`).
- [ ] **Step 1: Write the failing test** `js/push-nudge.test.js` (plain `assert`, same style as `js/follow-link.test.js`), using a Map-backed fake store and a throwing store:
  - `isPaused(store, MOMENT_KEY, now)` is `false` when unset.
  - After `pause(store, MOMENT_KEY, 14, now)`: paused at `now + 13 days`, not paused at `now + 14 days + 1ms`.
  - After `pause(store, BANNER_KEY, 30, now)`: paused at `now + 29 days`.
  - Throwing store: `pause` doesn't throw; `isPaused` is `true`.
  - `momentText({ kind: 'add', label: 'Saga #70' })` equals ``Want a heads-up when <strong>Saga #70</strong> is ready for pickup?``
  - `momentText({ kind: 'follow', label: 'Saga' })` equals ``Want a heads-up when new <strong>Saga</strong> issues arrive?``
  - `momentText({ kind: 'add', label: '<b>' })` contains `&lt;b&gt;`.
- [ ] **Step 2: Run** `node js/push-nudge.test.js`. Expected: fails (module missing).
- [ ] **Step 3: Implement `js/push-nudge.js`** with the interfaces above. The store is passed in (`localStorage` in the app) so tests can fake it.
- [ ] **Step 4: Run** `node js/push-nudge.test.js`. Expected: no output, exit 0.
- [ ] **Step 5: Commit** `feat(app): rules for notification prompts`.

### Task 2: Shared turn-on in app-notifications.js

**Files:**
- Modify: `js/app-notifications.js` (the `render`/`turnOn`/`turnOff` closures inside `setupNotifications`)

**Interfaces:**
- Consumes: `CHANGED_EVENT` (Task 1)
- Produces:
  - `pushState(): Promise<'unsupported' | 'unavailable' | 'denied' | 'off' | 'on'>`: the same checks `render()` makes today, in the same order (`supported()`, `publicKey()`, `Notification.permission`, existing subscription).
  - `turnOnPush(sb): Promise<'on' | 'denied'>`: request permission → subscribe → `save_push_subscription` (unsubscribing on an RPC error, as today). Throws on failure, with the same messages as today. On `'on'`, dispatches `CHANGED_EVENT` on `window`.
  - `turnOffPush(sb): Promise<void>`: dispatches `CHANGED_EVENT`.
  - `pushError(err): string`: the message `turnOn` shows today (`pull.customerMessage` for coded errors, otherwise the message or the fallback).

- [ ] **Step 1:** Move the logic out of the closures into the four exports. `render()` now branches on `await pushState()`, and `turnOn` and `turnOff` call `turnOnPush` and `turnOffPush`. The Account tab's copy and focus behaviour stay the same.
- [ ] **Step 2:** In `setupNotifications`, re-render on `CHANGED_EVENT` (the event fires after this section's own turn-on as well; re-rendering twice is harmless, but keep its own "Notifications are on. Tap Send a test…" message by re-rendering only when the event didn't come from this host: pass `{ detail: { from } }` and skip when `from === host`).
- [ ] **Step 3: Verify in the preview** (`preview_start`; open `/app`, signed in as a demo customer). On the Account tab, Notifications still shows Turn on, the permission prompt, then the four checkboxes, Send a test, and Turn off, with the same copy as before. `npm test` passes.
- [ ] **Step 4: Commit** `refactor(app): share notification turn-on`.

### Task 3: The prompts

**Files:**
- Create: `js/app-push-prompts.js`
- Modify: `js/pages/account.js` (WELCOME step 3 markup ~line 449; `show()` where `setupNotifications` is imported ~line 394; `followFromLink` ~line 419; export `welcomed`)
- Modify: `js/components.js` (`togglePullList` add branch ~line 413; follow handlers ~lines 266, 287, 389)
- Modify: `css/site.css` (next to `.app-welcome` / `.app-install`, ~line 1564–1590)

**Interfaces:**
- Consumes: `nudge`, `NUDGE_EVENT`, `CHANGED_EVENT`, `isPaused`, `pause`, `momentText`, keys and days (Task 1); `pushState`, `turnOnPush`, `pushError` (Task 2); `itemTitle` (`js/util.js`), `nameFromKey` (`js/follow-link.js`)
- Produces: `setupPushPrompts({ root, sb, welcomeShown: boolean }): Promise<void>`

- [ ] **Step 1: Nudges at the call sites.** After each `await` succeeds (inside the existing try blocks):
  - `components.js` add: `nudge({ kind: 'add', label: itemTitle(item) })`.
  - The series follows: `nudge({ kind: 'follow', label: <series display name> })`, using the label the handler already shows, or `nameFromKey(key)`.
  - The artist follows: `nudge({ kind: 'follow', label: name })`.
  - `account.js` `followFromLink`: `nudge({ kind: 'follow', label: name })`.
  - Not in `moveGuestList` (a bulk move, not a moment of intent) or `reorder`.
- [ ] **Step 2: Welcome step 3.** Change it to `<li><strong>Hear when they’re in.</strong> <span data-push-welcome>Turn on notifications on the Account tab.</span></li>`. `setupPushPrompts` swaps the span's content for `<button class="btn btn--primary btn--small" type="button" data-push-prompt-on>Turn on notifications</button>` (or the nearest existing small-button class) when `pushState()` is `'off'`.
- [ ] **Step 3: Implement `setupPushPrompts`** in `js/app-push-prompts.js`, called from `show()` only when `APP`. Pass `welcomeShown: !welcomed()`.
  - Bail out unless `await pushState() === 'off'`.
  - **Standing card:** when `!welcomeShown` and not paused, insert at the top of `[data-view="list"]`: `<div class="push-banner" data-push-banner>` with the copy, a Turn on button (`data-push-prompt-on`) and a ✕ (`data-push-banner-close`, `aria-label="Not now"`). If storage throws, `isPaused` is true, so it stays hidden. ✕ calls `pause(localStorage, BANNER_KEY, BANNER_DAYS, Date.now())` and removes the card.
  - **Moment card:** on `NUDGE_EVENT`, show it if it hasn't been shown in this open (a module-level flag), the moment prompt isn't paused, and `pushState()` is still `'off'`. Ignore the pause check when storage throws (the per-open flag still limits it). Remove the standing card while it's up. Markup: a fixed card above the tab bar, `<div class="push-nudge" role="region" aria-label="Notifications" data-push-nudge>` with `momentText(detail)`, a Turn on button (`data-push-prompt-on`) and a Not now button (`data-push-nudge-later`). Move focus only if focus is in the body (don't steal it from the button just tapped). Not now pauses `MOMENT_KEY` for `MOMENT_DAYS` and removes the card.
  - **Turn on** (any `data-push-prompt-on`, delegated on `document`): disable the button, then `await turnOnPush(sb)`. On `'on'`, remove every prompt and show the confirmation copy in the moment card's place for about 4s, as `role="status"`. On `'denied'`, remove every prompt. On a throw, show `pushError(err)` in the card (`p.form-error`, `role="alert"`), re-enable the button, and pause nothing.
  - On `CHANGED_EVENT` with state `'on'`, remove every prompt (it was turned on from the Account tab).
- [ ] **Step 4: CSS** in `css/site.css`, next to `.app-install`:
  - `.push-banner`: reuse the `.app-install` look (add it to that selector list, plus a close-button rule).
  - `.push-nudge`: `position: fixed`, inset above the tab bar, `z-index: var(--z-bar)`, `--surface` background, `--border`, `--radius`, `--shadow-*` token, `--sp-*` padding. Slide-up with an existing `--dur-*`/`--ease-*` token.
  - `.push-nudge__actions`: flex with a gap.
  - A `@media (prefers-reduced-motion: reduce)` rule turning off the slide.
- [ ] **Step 5: Verify in the preview** (desktop Chrome supports push, so the app page qualifies):
  - Fresh storage: the welcome card shows a Turn on button.
  - Dismiss the welcome card, then reload: the standing card is at the top of My List.
  - ✕ hides it; after a reload it stays hidden (`localStorage['pc-push-banner-until']` is about 30 days ahead).
  - Add a title: the moment card names it. Add a second title: no second card.
  - Not now: after a reload, adding again shows no card (paused).
  - Clear storage and tap Turn on: Chrome's permission prompt appears. Allow it: the confirmation shows and the Account tab shows the checkboxes. Read the console for errors. Take a screenshot of the moment card in light and dark mode at mobile width.
- [ ] **Step 6:** `npm test` passes (`css/site.test.js` covers tokens, reduced motion, inline styles and unused CSS).
- [ ] **Step 7: Commit** `feat(app): ask for notifications after adds and follows, in the welcome card and on My List`.

### Task 4: Design system and ship

- [ ] **Step 1:** Rebuild and republish the design system's storefront layer, following `tools/design-system/README.md` (`npm run design-system`, then `npm run design-system:check`). If the components file lists the `.app-install` card, add the push prompts beside it.
- [ ] **Step 2:** `npm test`, then commit `chore: design system: notification prompts`.
- [ ] **Step 3:** Push the branch and open a PR. Afterwards, compare the "notifications on" count in Analytics with the count before release.

# Notification onboarding in the pull list app

## Why
Plenty of customers install the app, but few turn on notifications. Today the only prompt is a line of text in the
one-time welcome card ("Turn on notifications on the Account tab"). It has no button and points to the bottom of
another tab. Once the card is dismissed, the app never brings it up again.

## Goals
- Ask at the moment the reason is obvious: right after a customer adds a title or follows a series or artist.
- Give every customer who hasn't turned notifications on a real, one-tap way to do it from My List.
- Never waste the phone's one-time "Allow notifications?" box: our own card explains first, and the phone's box
  appears only after the customer taps **Turn on**.

## Non-goals
- Email, SMS or staff nudges at the counter.
- Changing which kinds of notification are on by default (all four stay on).
- New analytics. The Analytics screen already shows app users against notifications on, and that's how we judge it.

## Anti-goals (failure even if it works)
- Nagging: a prompt on every open, or two prompts on screen at once.
- Asking on the website (not the installed app), or on an iPhone that can't receive push (not added to the Home Screen).

## Approaches considered
- **A. At the moment it matters:** after an add or a follow. Highest yes rate, but only reaches active customers.
- **B. A standing card on My List:** reaches everyone, but is easier to ignore.
- **Chosen: both, leading with A.** A does most of the work. B and a real button in the welcome card catch everyone else.

## Design
**Who sees prompts:** only in the installed app, and only when the device supports push, the shop has push set up,
the phone hasn't blocked notifications, and this device has no subscription yet. These are the same checks the
Account tab's settings already make.

1. **Moment prompt (A).** After a successful add, series follow or artist follow in the app, a small card slides up
   from the bottom: "Want a heads-up when *Saga #70* is ready for pickup?" (for a follow: "…when new *Saga* issues
   arrive?") with **Turn on** and **Not now**. **Not now** pauses moment prompts on this device for 14 days. It
   appears at most once each time the app is opened.
2. **Welcome card.** Step 3 gets a **Turn on notifications** button in place of "on the Account tab", when the device
   qualifies.
3. **Standing card (B).** A quiet card at the top of My List ("Get a notification when your books are ready
   [Turn on] ✕"). It appears only after the welcome card is dismissed, and never on the same screen as a moment prompt.
   Closing it hides it for 30 days.

**Turn on** runs the same code as the Account tab's button: the phone's permission box, then subscribe and
`save_push_subscription`. A confirmation follows ("Notifications are on. Change which ones on the Account tab.").
If the customer declines the phone's box, every prompt stops; only the Account tab's guidance stays.

## Builder's notes (my calls)
- Move the Account tab's turn-on logic in `js/app-notifications.js` into an exported function (plus an `eligible()`
  check) that the Account tab and the new prompts all share.
- Hook the moment prompt where adds and follows succeed in `js/customer.js` (`add`, `followSeries`, `followArtist`),
  for example by having it dispatch an event that the app listens for, so cards, the title modal and search all get it.
- Pauses are kept in `localStorage` (wrapped in try/catch), since notification permission is per device anyway.
- Styling: new classes in `css/site.css` using tokens only, with a `prefers-reduced-motion` rule for the slide-up and
  no inline styles (`css/site.test.js`). Afterwards, rebuild and republish the design system's storefront layer
  (`tools/design-system/README.md`).
- Tests for the eligibility rules and the pause timing.

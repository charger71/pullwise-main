# Demo data

Keeps demo.pullwise.shop looking like a shop that has been running up to today.

```
npm run demo                       # no options in a terminal: asks what you want (the flags below are optional)
npm run demo                       # refresh.sql, then check.sql
npm run demo-data -- --hold-week   # whole current week left unreceived (Admin > Ordering > Received)
npm run demo-data -- --check       # only check
npm run demo-data -- --dry-run     # with any option: run it all, report, roll back (e.g. --reset --dry-run)
npm run demo-data -- --reset --yes # wipe the customer side and rebuild (without --yes: shows what would go)
```

- `refresh.sql` adds what is missing since the last run (new customers with pull lists and follows, website orders on
  days with none, this week's shipment, weekly events, sign-ups, emails, surveys, activity) and then puts every
  reservation line in the state its dates allow. Safe to run repeatedly; run it before a demo.
- `check.sql` counts rows breaking each rule listed at the top of `refresh.sql`. The runner fails if any is non-zero.
- The runner refuses to run unless the Supabase CLI is linked to the demo project.
- Customers are `@example.com` with email opt-in off and event-sign-up triggers are skipped, so no real mail is sent.
- `reset.sql` (used by `--reset`) deletes customers, orders, reservation lines, follows, emails, messages, notes,
  sign-ups and survey answers, and zeroes QR scans. It keeps staff (and the super admin), the catalog, series, events,
  news, pages, FAQs, surveys, settings, and any customer linked to a login. It runs in the same transaction as the
  rebuild (about 50 customers over 100 days, 45 days of orders, receiving and email history, then everything `refresh.sql` makes), so a failure changes nothing.
- It also covers the newer features: Admin > Chat (answered chats and one open and waiting), search history for
  Analytics (including searches with no results and searches that led to a reservation), customer re-orders and
  shelf re-orders on the Re-order tab, app users, stock alerts, customers who never collected their copies (Customers
  Drifting Away), staff notes on customers, and the unread badges on surveys and event sign-ups. Re-order lines staff
  entered by hand are never changed.
- Pickup reliability: the ladder starts 60 days back; customers who never collect are warned (day 7) and paused (day 14,
  or 21 and 35 on a monthly rhythm) with the notices marked sent, so nothing is emailed; two customers are paused by hand,
  a few are monthly or exempt, and the newest guest orders wait in the approval queue. Holiday hours and repeating
  weekly events (a shared series id) are filled in too.

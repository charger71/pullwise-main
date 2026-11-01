# Roadmap

Ideas and next steps for the site, newest first. Move an item to "Done" when it ships.

## Next

- **Distributor availability (backordered, out of print) on re-orders.** Waiting on Penguin Random House API access; Lunar
  sends it as an .xlsx sheet (no API), read by the importer like today's sheets.
  - A distributor status per title, separate from the shop's own status, which it never changes: in stock /
    backordered / out of print / unknown, the date it was last updated, an expected date when given, and the
    distributor's raw code (so the mapping can change later). It lives in the master catalog and reaches shops through
    catalog-sync, like price and dates.
  - Customers see it only in the "Order a copy" box on released trades and omnibuses: backordered keeps the button with
    "Backordered at the distributor, so expect a wait" (and the expected date); out of print hides the button (the app
    offers "Notify me if it's back"). Say "the distributor", never its name. Ignore data older than about a week.
  - Staff see a distributor-status pill in Ordering → Re-order (search results and the list), a warning when adding a
    backordered or out-of-print title, and a flag in On Order when a title goes to backorder after it was ordered, so
    the customers waiting can be told (a flag first; automatic email or push once the data is trusted).
  - Before building: a sample Lunar sheet and the PRH API's availability fields, to map their codes.

- **Two-factor sign-in for owners (and then staff).** Supabase supports TOTP. Needs a set-up screen (QR code, then enter a code to confirm), a code step on the admin sign-in, and a way for an owner to reset someone's second factor. Today a staff login is email + password only.

## Done


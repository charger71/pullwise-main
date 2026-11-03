# Roadmap

Ideas and next steps for the site, newest first. Move an item to "Done" when it ships.

## Next

- **Automatic daily Lunar import into the master catalog.** Lunar's sheets are public links, no login:
  `https://www.lunardistribution.com/home/productdatafile?foc=M/D/YYYY` (FOC, Mondays) and `?release=M/D/YYYY`
  (in store, Wednesdays). Shops copy from the catalog hourly, so importing there once covers every shop.
  - A daily GitHub Actions job (`tools/lunar-auto-import.mjs`), not an Edge Function: a 7 MB sheet with covers is too
    much for its CPU limit. It fetches the FOC sheets for the next 8 Mondays (new titles) and the release sheets for
    this week and the next 4 Wednesdays (slipped dates, price changes): about 13 downloads a day.
  - Same code as Admin → Import (`readWorkbook`, `parseSheet` with the catalog's exclusions, `applyImport`), so the same
    skip rules and badges, and staff changes are never overwritten. Covers only for new titles and ones still missing
    one; card-size copies made in Node.
  - Signs in as a dedicated "Automatic import" staff account (password in a GitHub secret), so R2 cover uploads and the
    database's rules work unchanged and the change log names it. `putMedia` needs to take a token directly.
  - Each run shows in Import → Recent Runs as "Automatic Lunar import" (added, updated, failures); System Health warns
    when it hasn't run for two days; the workflow can be run by hand. README, SETUP and the style guide (System Health
    card) updated with it.
  - Later: Lunar's availability sheet (next item) in the same job. PRH titles are kept current by `prh-sync` (Done).

- **Distributor availability (backordered, out of print) on re-orders.** PRH's code is now saved per title
  (`prh_titles.sale_status`, from `prh-sync`: IN, IP, EL, HT seen so far) and needs mapping; Lunar
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
  - Before building: a sample Lunar sheet, and what PRH's sale status codes mean.

- **Two-factor sign-in for owners (and then staff).** Supabase supports TOTP. Needs a set-up screen (QR code, then enter a code to confirm), a code step on the admin sign-in, and a way for an owner to reset someone's second factor. Today a staff login is email + password only.

## Done

- **PRH title updates in the master catalog** (`prh-sync`): hourly look-ups in the PRH API fill in descriptions and
  creators and keep dates and retail prices current, for books (ISBN) and comics (UPC, `SALESPLATFORM` domain).
  Re-importing a PRH sheet no longer clears a description. Next: covers for titles still missing one (needs the
  "Automatic import" staff account from the Lunar item to upload to R2), an ISBN look-up in Admin → Titles, and an
  upcoming-titles feed.


# Roadmap

Ideas and next steps for the site, newest first. Move an item to "Done" when it ships.

## Next

- **Move the Analytics counting into the database.** Orders per Day, Top 50, Money and Pull List App download raw rows
  and add them up in the browser, which gets slower as a shop's history grows. Postgres functions (like
  `drifting_customers`) would send back finished totals instead. Do this when a shop's Analytics screen actually gets
  slow: nobody has reported it yet, and the speed gain hasn't been measured. Dashboard → Today downloads the same rows
  for its tiles and order cutoff, so include it if the Dashboard is the slow screen.
  - Tried once and backed out before shipping, because moving Money into SQL drops the unit tests in
    `admin/money.test.js`. Add automated database tests in the same change (CI already installs a blank database).
  - The tests need to cover: the shop's calendar day around midnight; "in progress" meaning the same in SQL and
    JavaScript; the field names the cards read; Money's rules (cancelled and never-ordered lines aren't reserved, no
    cover price adds $0, a customer counts once and each guest order is its own person, a blank pickup rate and typical
    wait when there's nothing to measure); a row for every day in Orders per Day; signed-out visitors blocked.

- **The pull list app on Google Play, then the App Store.** One listing per shop under the shop's own name (Powered by
  Pullwise is the limit), published from the shop's own developer accounts with Pullwise added as a team member: Apple
  only accepts apps built from a template like ours from the content owner's account (App Store guideline 4.2.6).
  Step 1 is done (#171): Delete my account in the app and on the website, and `/.well-known/assetlinks.json` served
  from a shop's `"android"` entry in shops.json.
  - **Step 2, Google Play (a Trusted Web Activity).** The Android app is a thin wrapper that opens the shop's `/app`
    in Chrome, full screen, so push, the icon badge, haptics and the screen wake lock keep working unchanged.
    - Build: a `tools/android-app.mjs` that writes a Bubblewrap project per shop from shops.json and the shop's live
      `/manifest.webmanifest` (name, colors, icons, shortcuts): package `com.<shop domain reversed>.pulllist`, start URL
      `/app`, maskable icon from Shop Settings → Pull List App, notification delegation on. It builds a signed `.aab`
      with an upload key kept outside the repo (a GitHub secret if it runs in Actions), never committed.
    - The shop (or we, as a team member): create a Google Play developer account as an **organisation** (needs a D-U-N-S
      number; a personal account must first run a closed test with 12 testers for 14 days), and turn on Play App
      Signing.
    - Listing: the shop's name, a short and a full description, the 512px icon, a 1024 × 500 feature graphic, phone
      screenshots (the ones uploaded in Shop Settings), category Shopping or Books, the privacy policy URL
      (`https://<shop domain>/privacy.html`), the data safety form (email, name, phone, address and pull list for
      account management; push token for notifications; nothing sold or shared; deletion in the app) and the content
      rating questionnaire. Reviewers get a demo customer login (a test email, and a code sent to an inbox we read).
    - Link the app to the site: copy the SHA-256 fingerprints from Play Console → Test and release → App integrity (Play
      App Signing's and the upload key's) into the shop's `"android"` entry in shops.json, deploy, then check
      `https://<shop domain>/.well-known/assetlinks.json` and Google's Statement List tester. Without it the app shows
      a browser bar.
    - Release: internal testing first (open the app, sign in, notifications, pickup code full screen, swipe to remove,
      Delete my account), then production. One test shop end to end before any other.
  - **Step 3, the App Store.** Apple rejects a website in a wrapper, and its web view can't receive web push, so the
    iPhone app is a small native shell (Capacitor) around the same `/app`, with native extras so it passes review.
    - Native push through APNs: the app registers for notifications and saves its device token next to the web push
      subscriptions; supabase/functions/push-notify sends to APNs as well as web push (an APNs key, `.p8`, per
      developer account, kept as a Supabase secret).
    - Native haptics and the icon badge through Capacitor plugins in place of `navigator.vibrate` and `setAppBadge`
      (js/app-device.js picks whichever is there). Later: the pickup code as an Apple Wallet pass (needs a Pass Type ID
      certificate and a small function that signs passes).
    - The shop: an Apple Developer account as an organisation ($99 a year, D-U-N-S number), Pullwise invited as an App
      Manager. Building and uploading needs a Mac with Xcode (or a cloud Mac build service).
    - App Store Connect: the listing (name, subtitle, description, keywords, support URL, privacy policy URL),
      screenshots at Apple's sizes (6.9" and 6.5" iPhone at least), the App Privacy answers (as for Play), age rating,
      export compliance (standard encryption only), and review notes with the demo login and where to find Delete my
      account (Account tab).
    - Release: TestFlight first, then App Review (about a day to a week; answer questions in Resolution Center), then
      release.
  - **Before either store:** each shop's Privacy page (admin → Pages) mentions Delete my account and what the shop
    keeps (new shops get it in the default text); the shop has uploaded its app icon and screenshots in Shop Settings.
    Store rules change: check the current Play and App Store guidelines before each submission.

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

- **Automatic daily Lunar import into the master catalog** (`tools/lunar-auto-import.mjs`, GitHub Action): the FOC
  sheets for the next 8 Mondays and release sheets for this week and the next 4 Wednesdays, through the same code as
  Admin → Import. Lunar's hi-res covers (up to 18 MB) are shrunk with sharp to 1000 px plus a 560 px card copy and
  written to R2. Like the PRH job it writes with the catalog's service key (`tools/catalog-job.mjs`), so no staff
  account was needed, and leaves titles already stored as listed alone. Lunar's availability sheet can join it later.
  System Health (catalog only) shows each daily import's last run: red when it failed, amber after two days without
  one.
- **Automatic daily PRH import into the master catalog** (`tools/prh-auto-import.mjs`, GitHub Action): every comic
  and graphic novel PRH has on sale in the next 13 weeks, ratio variants skipped, covers to R2. No more PRH sheets.
- **PRH title updates in the master catalog** (`prh-sync`): hourly look-ups in the PRH API fill in descriptions and
  creators and keep dates and retail prices current, for books (ISBN) and comics (UPC, `SALESPLATFORM` domain).
  Re-importing a PRH sheet no longer clears a description. Edit Title in the catalog has "Fill in from PRH" (blank
  fields and the cover, by ISBN or UPC). Next: covers for titles still missing one (needs the "Automatic import"
  staff account from the Lunar item to upload to R2), and an upcoming-titles feed.


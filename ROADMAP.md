# Roadmap

Ideas and next steps for the site, newest first. Move an item to "Done" when it ships.

## Next

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
  - Later: Lunar's availability sheet (next item) in the same job. PRH titles are imported daily by
    `tools/prh-auto-import.mjs` (Done), which writes with the catalog's service key and R2 directly instead of a
    staff account: the Lunar job can do the same.

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

- **Automatic daily PRH import into the master catalog** (`tools/prh-auto-import.mjs`, GitHub Action): every comic
  and graphic novel PRH has on sale in the next 13 weeks, ratio variants skipped, covers to R2. No more PRH sheets.
- **PRH title updates in the master catalog** (`prh-sync`): hourly look-ups in the PRH API fill in descriptions and
  creators and keep dates and retail prices current, for books (ISBN) and comics (UPC, `SALESPLATFORM` domain).
  Re-importing a PRH sheet no longer clears a description. Edit Title in the catalog has "Fill in from PRH" (blank
  fields and the cover, by ISBN or UPC). Next: covers for titles still missing one (needs the "Automatic import"
  staff account from the Lunar item to upload to R2), and an upcoming-titles feed.


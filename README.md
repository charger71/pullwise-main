# Pullwise

Website for an independent comic shop: pull lists, pre-orders, reservations, events and a staff admin.
One codebase serves every shop (see [One codebase, many shops](#one-codebase-many-shops)). **New shop? `npm run add-shop`; see [SETUP.md](SETUP.md).**

Static HTML/CSS/JS served by one Cloudflare Worker for all shops (`worker/`), plus a Supabase project per shop
(database, auth, storage, Edge Functions). No build step.

## Run locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. With `SUPABASE_URL` empty in `js/config.js`, the site
runs in **demo mode** on sample data from `js/demo-data.js`.

## Connect Supabase

Full step-by-step instructions are in [SETUP.md](SETUP.md). In short:

1. Create a Supabase project (one project per shop).
2. `supabase db push --include-seed` applies every migration and the seed; the migrations turn on pg_cron and pg_net.
3. The migrations also schedule the hourly jobs, including the daily status flip (Pre-Order → New This Wednesday → Just Arrived → Available).
4. Auth → customers sign in with an emailed link/code (`account.html`), so leave **email sign-ups on**
   and the **Email** provider enabled (Auth → Providers). Add `https://<your site>/account.html` (and
   `http://localhost:8080/account.html` for local testing) under Auth → URL Configuration → Redirect URLs.
   In Auth → Email Templates → Magic Link, include `{{ .Token }}` so customers can type the 6-digit code
   as well as click the link. Staff are invited individually and then added to `public.staff`; being
   signed in never makes someone staff, only a row in `public.staff` does.
5. `supabase functions deploy` (all functions; `supabase/config.toml` marks the public ones)
6. Add the shop (domains, project URL, anon key) to `shops.json`; see SETUP.md.

## Weekly pull list email

Each week every customer with something on their pull list gets one email (ready for pickup, coming this
week, coming up, and a link to log in and edit). It is sent by the `weekly-pull-list` Edge Function through
[Resend](https://resend.com) and is **off** until you turn it on in Admin → Shop Settings.

One-time setup (the email address and day/time are then edited in Shop Settings):

1. In Resend, add and verify your sending domain (SPF + DKIM records in your DNS) and create an API key.
2. Choose a long random string for `CRON_SECRET`, then set the function's secrets (the API key goes only here,
   never in code or chat). `SITE_URL` is the public site address used in the email's login link:

   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx CRON_SECRET=<random string> SITE_URL=https://<your site>
   supabase functions deploy weekly-pull-list --no-verify-jwt
   ```
3. Give the database the same two values so its hourly check can call the function (SQL editor):

   ```sql
   select vault.create_secret('https://<project>.supabase.co/functions/v1/weekly-pull-list', 'weekly_email_url');
   select vault.create_secret('<the same random string>', 'weekly_email_secret');
   ```
4. In Shop Settings → Weekly pull list email: set **From** (an address on the verified domain), use
   **Preview** and **Send a test to me**, then tick **Send the weekly email**. The default is Thursday 9:00 AM
   shop time.

### "Your books are in" email

The same function also sends a same-day email when titles on a customer's pull list become **Ready for pickup**
(on their release date, or when staff mark them). It uses the same Resend key, From address and secrets as
the weekly email, so there is nothing extra to set up beyond the migration and redeploying the function.

- Off until you tick **Send "your books are in" emails** in Shop Settings. It is checked hourly and only sends
  between the "no earlier than / before" hours you choose (default noon to 8 PM shop time), so set the start to
  when the new books are actually on the shelf. Use **Preview** and **Send a test to me** first.
- Each customer gets one email listing what just arrived, plus anything still waiting. A title is only ever
  announced once (`reservations.arrival_notified_at`); if a send fails it is retried the next hour.
- Customers can turn it off in their profile ("Email me when my books are ready for pickup") or with the link in
  the email; staff can set it on the customer's page.

Email logic lives in `supabase/functions/weekly-pull-list/email.js`; run its tests with
`node supabase/functions/weekly-pull-list/email.test.js`.

## Weekly FOC import

Done on the admin **Import** page: drop in the week's sheets as downloaded. It recognises Lunar and PRH FOC and
release sheets, and Funko retailer pre-order lists (which go into Funko Pops). Any other spreadsheet (.xlsx, .xls,
.csv) also works if it has a header row with a Title / Name / Product column plus at least one of Price, UPC, ISBN,
SKU, Publisher, Release date or FOC date. Columns are matched by name (e.g. "SRP", "MSRP" or "Cover Price" all mean
price); rows with a quantity of 0 are skipped, titles are matched on SKU, then UPC, then ISBN, and a new row whose
UPC is already on another title is left out rather than duplicated.

If Lunar or PRH rename a column, the importer finds it under the usual other names (RetailCost → SRP is still the
price) and says so in the preview. A column that's gone only blanks that detail: titles already imported keep what
they have, and the preview shows a notice. Only a missing product code or Title column stops the import.

Incentive/ratio covers and retailer bundles are skipped; everything else is added as Pre-Order (or straight to New
This Wednesday / Just Arrived / Available if it releases this week or is already out) with its cover copied into
Supabase Storage. Re-importing a sheet updates distributor fields (price, dates, description) but never overwrites
staff changes (status, hidden, staff pick, category, badges). A new title starts with collector badges read from its sheet title:
**First Issue** (#1), **One-Shot** (`ONE SHOT`, `ONE-SHOT`, `1-SHOT`…), **Limited Series** (`#2 (OF 6)`), **Facsimile**
(reprint) and **Blind Bag** (`BLIND BAG`, `BLIND-BAGGED`); the master catalog passes them on to the shops. Titles imported
earlier got the same badges added once by migration `20270203000000_import_badges` (it never removes a badge). Parsing rules live in `js/import/distributors.js` and database
logic in `js/import/apply.js`.

## Admin (staff)

`/admin/` — staff sign in with email and password. Sections:

| Section | What it does |
| --- | --- |
| Dashboard | Landing page: new orders this week, copies to order, ready for pickup, past pickup window; latest 10 orders; orders per day (30 days); titles by status, next order cutoff, most-reserved titles, titles missing covers/categories/prices |
| Titles | Search/filter every title; change status, staff pick, hidden in the list; edit details and covers; add titles by hand |
| Reservations | Orders with per-title status (open → ordered → ready → picked up / released / cancelled), past-pickup highlighting, customer lookup, CSV export; **To order** totals reserved copies per title for each order cutoff, with CSV and "mark ordered" |
| Customers | Find a customer, edit their profile and pull list (staff can add titles past the cutoff), see the change log, export one list as a PDF or every list as a CSV |
| Series | Merge series that distributors name two ways, set series covers (upload or Media Library link), and mark which series are comics |
| Import | Drop Lunar/PRH FOC or release sheets, Funko lists, or any spreadsheet with recognisable column headers (shows which columns it used), preview, import (same rules as the command-line importer); history of imports and daily status runs, failures highlighted; Pull Lists: a moving shop's customers and pull lists from one spreadsheet, titles matched to series, every line reviewed before Save |
| Events / News | Community calendar events and blog posts with the WYSIWYG editor and images; posts can be drafts or scheduled |
| Media | Upload several images at once (resized, optional crop), copy links, replace; owners can delete (it first shows where the image is used) |
| Pages / FAQ | Each page's intro and body text (all homepage sections on one screen); add or delete your own pages (each lives at its own address, `/page-name`, and links from the menu or footer); the FAQ list |
| Emails | The weekly pull list email and the "your books are in" email: schedule, sender, preview, test and send now |
| Surveys | Short surveys with a shareable link and QR code, and their answers |
| Shop settings | **Owners only.** Name, headline, contact, hours, socials, map, logo, colors, reservation rules, timezone, pinned publishers |
| Backup | **Owners only.** Every shop is backed up nightly to a private R2 bucket (download any of those files here); download the whole database now as one file, or export just the customers as a CSV (see `BACKUPS.md`) |
| Restore | **Owners only.** Load tables back from a backup file: add missing rows or replace, all-or-nothing per table (see `BACKUPS.md`) |
| Staff | Your account (change your password); owners add and remove staff, reset passwords and make owners (via the `staff-admin` Edge Function), and read the **Change log** of who changed what |

The Dashboard also has a **System Health** card (are the scheduled jobs running, last import, email-service errors;
in the master catalog also the daily automatic PRH and Lunar imports, red when the last run failed and amber when
there's been none for two days) and a backup reminder for owners. Regular staff can add and edit almost everything; owners alone can change Shop Settings and
delete titles, Pages, Media files and series (enforced in the database).

To add a staff member, an owner uses **Admin → Staff** (see `ADMIN-ONBOARDING.md`). The very first owner is added in
Supabase (Authentication → Users → Add user, auto-confirmed), then:

```sql
insert into public.staff (user_id, name, is_owner)
select id, 'Their name', true from auth.users where email = 'them@example.com';
```

Edge Functions (deploy with `supabase functions deploy <name>`):
`fetch-cover` fetches PRH/Funko cover images for the admin importer (staff only);
`staff-admin` creates and removes staff logins and resets passwords (owners only);
`calendar-feed` serves the subscribable calendar (`--no-verify-jwt`).

## Layout

| Path | What |
| --- | --- |
| `*.html` | One file per page; content that isn't shop-specific lives here |
| `js/config.js` | Local / demo config; on live sites the Worker serves a generated one per shop |
| `js/data.js` | All data access; Supabase or demo data |
| `js/site.js` | Header/footer/theme/schema.org markup from shop settings, shared helpers |
| `js/util.js` | `esc`, `must`, `tally`, `itemTitle`; no dependencies, used by the site, admin and tools |
| `js/errors.js` | Plain-English versions of database and network errors (`friendlyError`); `must()` uses it |
| `js/dates.js` | Shop-time dates: today, `addDays`, `holdUntil`, file-name stamps |
| `js/labels.js` | Title and pull-list status labels (and badge icons) used everywhere |
| `js/customer.js` | The signed-in customer and their pull list, shared by every page |
| `js/ics.js` | Calendar export (.ics files, Google/Outlook links) |
| `js/social-icons.js` | Footer social icons |
| `js/components.js` | Item cards, reservation list bar and review-and-reserve dialog |
| `js/reservation-list.js` | The customer's in-progress reservation list (localStorage) |
| `js/content.js` | Loads, sanitizes and shows staff-edited page text (`pages`, `faqs` tables) |
| `js/page-defaults.js` | Starting page text and FAQ (demo mode, new shops) and the list of editable blocks |
| `admin/` | Staff admin: `admin.js` (sign-in, routing), `lib.js` (shared helpers), `editor.js` (the rich text editor), `images.js` (pictures and uploads), `filters.js` (safe `.or()` search filters), `backup.js` (backup/restore/customer export logic), `sections/*.js`, `pull-list-pdf.js` and `order-sheet-pdf.js` (printable PDFs, built in the browser) |
| `worker/` | The site Worker: serves every shop, generates `js/config.js` per domain and writes page titles, icons and the home banner into the HTML (`shop-page.js`, with tests), stores R2 images (`media.js`) and serves owners their nightly backups (`backups.js`) |
| `shops.json` | Every shop: id, domains, Supabase URL, anon key (public), project ref |
| `tools/` | `add-shop.mjs` (`npm run add-shop`: set up a new shop end to end), `deploy-plan.mjs` and `smoke-site.mjs` (the deploy workflow), `check-migrations.js`, `test-migrations.sh`, `restore.mjs` (backup file → SQL, for the terminal), `backup-shops.mjs` (the nightly automatic backup), `stamp-version.js` |
| `js/import/apply.js` | Import database logic shared by the CLI and admin |
| `js/catalog.js` | Filter/search listing shared by Pre-Orders and New Arrivals |
| `js/pages/*.js` | Per-page scripts |
| `css/site.css` | Public-site styles (dark theme); the five Shop Settings colors are `--brand-*` custom properties and the rest is derived from them. Staff admin styles are `admin/base.css` + `admin/admin.css` |
| `js/import/distributors.js` | Lunar/PRH order-sheet parsing rules (Node + browser) |
| `supabase/` | Schema, RLS, reservation RPC, status-flip job, Edge Functions |

## Tests

```bash
npm test
```

Runs the date helpers (`js/dates.test.js`), the email tests (`supabase/functions/weekly-pull-list/email.test.js`), the
staff-management rules, import exclusions, the error-message translator (`js/errors.test.js`), the admin search filters
(`admin/filters.test.js`), backup/restore logic (`admin/backup.test.js`, `tools/restore.test.js`), the site Worker's page
logic (`worker/shop-page.test.js`), and the migration rules (`tools/check-migrations.js` and its tests).

**Migrations on a blank database:** `tools/test-migrations.sh` (needs Docker and the Supabase CLI) starts Supabase's own
Postgres image, runs `supabase db push --include-seed` the way a new shop is installed, checks a second push changes
nothing and that the hourly jobs are scheduled.

GitHub Actions (`.github/workflows/ci.yml`) runs both on every pull request and on `main`.

**Admin smoke test:** with the local server running (`python3 -m http.server 8080`), open
http://localhost:8080/admin/smoke.html. It opens every admin screen against made-up data and reports any that fail to
load. It never touches the real database. Add `?break=1` to make the made-up database fail on purpose; most screens
should then be reported as failed, which shows the test itself works.

## Status and plans

The public site, customer accounts and pull lists, reservations, the weekly and "your books are in" emails, the
distributor importers, and the staff admin (with owner-only settings, a change log, backup and restore) are all built. Planned and open work is in [ROADMAP.md](ROADMAP.md); how backups work is in [BACKUPS.md](BACKUPS.md); the staff
guide is [ADMIN-ONBOARDING.md](ADMIN-ONBOARDING.md).

## Page titles & descriptions

Staff set these per page on the admin's Pages screen (stored in `pages.meta_title` / `meta_description`). The site
Worker (`worker/`) writes them into each page's HTML as it serves it (title, description and `og:` preview tags), along
with the tab icon, the logo and banner preloads and the home page banner, so browsers and Google get them without
running any script. It caches each shop's settings for a minute, so a change in the admin is live within about a
minute. The shop name is put in front of titles (`Shop name — title`); clearing a field goes back to the page's own
name (`data-default` in its HTML).

## One codebase, many shops

Every shop runs the same code from this repo. `shops.json` lists each shop's domains and Supabase project; the Worker
looks up the request's domain and serves that shop's `js/config.js`. Merging to `main` deploys to every shop
(`.github/workflows/deploy.yml`: canary shops first, then every shop's database, then the Worker; see SETUP.md →
"Deploys"). Everything shop-specific (name, colors, pages,
titles, customers, media) lives in the shop's own database, so deploying new code never touches it.

Rules that keep it that way:

- **Never put shop details in code.** Anything a shop might change belongs in its database (`settings`, `pages`…).
- **Migrations change the schema, not shop content.** To add new default text, insert it only where it's missing
  (`on conflict do nothing`); never `update` or `delete` rows in `pages`, `faqs` or `settings`.
- **Every new migration is checked** by `tools/check-migrations.js` (part of `npm test` and CI). A data fix every shop
  truly needs can pass by saying why on a line of its own: `-- content-change-ok: <reason>`.
- **Migrations must work with the code that's already live**, because each shop's database is updated before its site.
  Add a column in one release and stop using an old one in a later release.

## Adding a second location

A shop (one Supabase project: settings, domain, branding) owns one or more rows in `locations`. Every shop has exactly
one, marked `is_default`, copied from its settings. Triggers keep that first location and Shop Settings in step both
ways (address, phone, hours, map), so staff can edit either; the shop name is shared only while there is one location. Rows that mean "where this is picked up or handled" carry
a `location_id` that defaults to the default location: `reservations`, `events`, `customers.home_location_id`, and
`staff.location_id` (null = every location). Weekly and arrival emails and the public site read address, phone and
hours from the default location (`withLocation` in `weekly-pull-list/email.js`, `getSettings` in `js/data.js`).

Several locations are an upper-tier feature, switched per shop with `"locations": true` in `shops.json` (the same way as `"app"`; `add-shop --locations`). Without it the shop has its one location (Shop Settings), the admin has no Locations screen and no location filters, and customers never see a pickup picker, even if more locations exist in the database. The switch is read by `js/config.js` (`LOCATIONS_ENABLED`, written by the Worker).

To add a second location, owners use Admin → Locations → Add a location. Other locations are edited only there. Staff set a customer's pickup location on the customer's Profile tab. With two or more locations, a customer picks one home location (Account → My Profile, and at first sign-in); that is
where their pull list is picked up. New lines follow it (`reservations_set_location`), changing it moves lines that
haven't arrived yet (`customers_move_open_lines`; books already on the shelf stay where they are), and the weekly and
arrival emails show that location's address and hours. A one-location shop never sees the picker. Not built: a
per-item pickup override, a combined multi-location "ready" email, location-scoped staff permissions, billing. Backup/restore covers `locations` like every other table. Only owners can change locations.

## Master catalog

One shop in `shops.json` is the master catalog (`"catalog": true`): a Pullwise install whose staff import the week's
Lunar, PRH and Funko sheets on the normal Admin → Import page. Every other shop copies its titles in hourly
(`supabase/functions/catalog-sync`, rules in `public.catalog_apply()`), so a shop doesn't have to import anything,
though it still can for things the catalog doesn't carry.

- **New titles** arrive with the status a first import would give them, the catalog's category and badges, and a link
  to the catalog's cover (covers aren't copied). The catalog keeps its covers in Cloudflare R2 (`"media": "r2"`,
  SETUP.md → "Images in Cloudflare R2"), which doesn't charge for the traffic of every shop's visitors.
- **Changes** to a title's name, retail price, dates, description, creators or cover follow the catalog. A shop's own
  **shop price**, status, category, badges, staff pick, homepage and hidden are never touched.
- **The Series and Artists lists** follow too (`catalog_apply_series`, `catalog_apply_series_merges`,
  `catalog_apply_artists`, `catalog_apply_artist_renames`). Series the catalog's staff added arrive with their
  publisher and cover; a series the shop already has keeps its own name, publisher and cover, and only gets what it's
  missing. Two series merged in the catalog are merged in the shop too (titles, follows and list entry), unless the
  shop merged them the other way round. Artists the catalog's staff added or blocked are added or blocked in the shop
  (unblocking in the catalog doesn't unblock a shop), and an artist renamed or merged in the catalog is merged the
  same way in the shop, titles and follows included. Nothing is removed from a shop's lists, so a series a shop
  deleted comes back on the first sync, or whenever the catalog changes it.
- Titles are matched by catalog id, then distributor + SKU, UPC and ISBN, so titles a shop imported before joining are
  linked rather than duplicated. Nothing is ever deleted; a title hidden in the catalog stops syncing.
- The deploy gives every shop the catalog's address (`CATALOG_URL`, `CATALOG_ANON_KEY` function secrets). Progress
  is in `catalog_sync_state`; runs that changed something show in Import → Recent Runs as "Master catalog sync".
- **Automatic Lunar import** (`.github/workflows/lunar-import.yml`, daily at 11:15 UTC, `tools/lunar-auto-import.mjs`):
  Lunar's public sheets (`lunardistribution.com/home/productdatafile?foc=M/D/YYYY` and `?release=…`), the FOC sheets
  for the next 8 Mondays and the release sheets for this week and the next 4 Wednesdays, go through the same code as
  Admin → Import (`readWorkbook` → `parseSheet` with the Always Skip list → `applyImport`). Titles already stored as
  a sheet lists them are left alone. Covers for new titles and ones missing one: Lunar's hi-res picture (60 KB to
  18 MB) shrunk with sharp to 1000 px, plus the 560 px card copy, into R2; the sheet's own small picture when there's
  no hi-res one. A sheet that isn't out yet is noted, not an error. Runs show in Recent Runs as "Automatic Lunar
  import". Both daily imports share `tools/catalog-job.mjs` (service key, R2, logging).
- **Automatic PRH import** (`.github/workflows/prh-import.yml`, daily at 10:30 UTC, `tools/prh-auto-import.mjs`):
  the comics and graphic novels PRH has going on sale in the next 13 weeks (Marvel, IDW, Oni, Boom, Dark Horse,
  Ignition and the rest) are read from PRH's API (domain `SALESPLATFORM`) and imported into the catalog with the
  same code as Admin → Import (`parsePrhApi` → `applyImport`): ratio variants (PRH's "Incentive Variant", or 1:25 in
  the title), bundles and exclusives are skipped, the Always Skip list applies, and staff-owned fields are never
  touched; titles already exactly as PRH lists them are left alone, so shops don't copy them again. Covers go
  straight to R2 for new titles and ones still missing one, with PRH's 560 px copy as the card
  picture. It reads the catalog's service key and writes R2 with the Deploy secrets, plus `PRH_API_KEY`. Runs show in
  Recent Runs as "Automatic PRH import"; the workflow can be run by hand, with a dry run that only counts.
- **PRH title updates** (`supabase/functions/prh-sync`, catalog only): hourly at :05, up to 200 PRH titles are looked
  up in the Penguin Random House API, books by ISBN (domain `PRH.US`) and comics by their 17-digit UPC (domain
  `SALESPLATFORM`, the only one that knows them). Dates and the retail price follow PRH, like re-importing a sheet;
  a description (PRH's flap copy) and creators are filled in only when the title has none, so staff edits stay.
  Titles out within the last 60 days or still to come are looked up once a day; older ones still missing a
  description once a month.
  What PRH said (found, domain, its availability code) is in `prh_titles`; runs that changed something show in
  Recent Runs as "PRH title updates". Covers aren't fetched yet (the function can't sign in to upload to R2).
- **Fill in from PRH** (catalog admin only, `IS_CATALOG` in the Worker's `config.js`): in Edit Title / New Title,
  looks the ISBN or UPC up through the staff-only `prh-lookup` function and fills in the fields that are blank
  (title, issue, variant, publisher, category, retail price, dates, creators, description), plus the cover if there
  isn't one. It reads PRH's reply with the PRH sheet's rules (`prhApiItem` in `js/import/distributors.js`) and never
  replaces what's typed.

**Shop price:** `items.retail_price` comes from imports and the catalog, `items.shop_price` is set by staff, and a
trigger keeps `items.price` (what everything shows and totals) as the shop price if set, else retail.

## Style guide

- **Titles are in Title Case.** Every title — comic/item titles, page titles, post and event titles,
  and all section headings (public site and admin) — is written in Title Case: `Closing Soon for
  Pre-Order`, not `Closing soon for pre-order`. Small words (a, an, the, and, for, of, at, to…) stay
  lowercase unless first or last.

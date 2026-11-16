# Fresh Install

Every shop runs from this one repo: it gets its own Supabase project and its own domain, and one entry in
`shops.json`. Code changes merged to `main` deploy to every shop automatically ("Deploys" below); a shop's own
information (name, hours, colors, logo, page text, customers) lives in its database and is never touched by a deploy.

Setting up a shop takes about an hour. You need accounts at GitHub, [Supabase](https://supabase.com),
[Cloudflare](https://cloudflare.com) and (for email) [Resend](https://resend.com), plus the
[Supabase CLI](https://supabase.com/docs/guides/cli) and Node 20+.

## Deploys (one-time setup for the whole fleet)

`.github/workflows/deploy.yml` runs on every push to `main` (and from Actions → Deploy → **Run workflow**):

1. CI: the tests, the migration rules and a fresh install of every migration on a blank database.
2. **Canary** shops (`"canary": true` in `shops.json`, e.g. a demo shop you own): their database and Edge Functions,
   then their own Worker (`pullwise-canary`), then a live check of each canary site.
3. Every other shop's database and Edge Functions (`supabase db push --include-seed`, `supabase functions deploy`).
4. The main Worker (`pullwise`) with every other shop's domain, then a live check of each site.

Databases are always updated before the code that needs them. If the canary or **any** shop's database step fails,
the main Worker isn't deployed (so no shop gets code its database isn't ready for); fix it and re-run the workflow.

Add these in GitHub → the repo → Settings → Secrets and variables → **Actions** (never in code or chat):

| Secret | What |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens → **Generate new token**. Works for every project in your organization. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → **Create Token** → the "Edit Cloudflare Workers" template, plus **Zone → DNS → Edit**, for your account and the zones of the shops' domains. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages → the account ID on the right. |
| `SUPABASE_DB_PASSWORD_<ID>` | **Optional**, one per shop: its database password. Without it the Supabase CLI logs in to the shop's database with a temporary role made through `SUPABASE_ACCESS_TOKEN`, so you normally don't need it. `<ID>` is the shop's `id` upper-cased with `-` → `_`, e.g. `SUPABASE_DB_PASSWORD_MAIN_STREET`. |

Until the first three exist (or while `shops.json` is empty) the workflow deploys nothing and says why in its summary.

**Rolling back the site:** `npx wrangler rollback --name pullwise` (or `pullwise-canary`) puts the previous Worker
version back in seconds. Migrations aren't rolled back; fix forward with a new migration.

## Adding a shop: the button

GitHub → this repo → **Actions → Add a shop → Run workflow**. Fill in the id, name, domain(s) and owner's email, pick
the kind (shop, canary for a demo/test shop, or catalog for the master catalog) and run it. It does steps 2–6 below
with the `SUPABASE_ACCESS_TOKEN` secret (about 5 minutes) and opens a pull request adding the shop to `shops.json`;
merging it deploys the site. Nothing secret is printed: once the site is live, the owner opens `https://<domain>/admin/`,
types their email and clicks **Forgot your password?**.

- For a shop that gets the pull list app, change its entry's `"app": false` to `true` in that pull request before
  merging (the form has no room for another option: GitHub allows 10).
- Run one shop at a time and merge its pull request before the next (each one edits `shops.json`).
- If a run fails, fix the cause and run it again with the same id; finished steps are skipped.
- With the optional `RESEND_API_KEY` and `RESEND_FROM` repo secrets, new shops send email through Resend, including
  sign-in and password emails. Without them, Supabase's built-in sender only mails members of your Supabase
  organization, so a real owner wouldn't get their password email.
- If the run says it couldn't open the pull request, turn on Settings → Actions → General → **Allow GitHub Actions to
  create and approve pull requests**, or open it from the link it prints.

## Adding a shop: from your computer

`npm run add-shop` does steps 2–6 below in one go (about 5 minutes, mostly waiting for Supabase to create the project):

```bash
SUPABASE_ACCESS_TOKEN=<your token> npm run add-shop -- \
  --id main-street --name "Main Street Comics" \
  --domain mainstreetcomics.com --domain www.mainstreetcomics.com \
  --owner-email owner@mainstreetcomics.com --owner-name "Pat Smith" \
  --phone "(555) 555-0100" --timezone America/Chicago
```

It creates the Supabase project `pullwise-<id>`, applies the migrations and seed, sets up sign-in (redirect URLs and
the Magic Link code), sets the function and vault secrets (add `RESEND_API_KEY=… RESEND_FROM=…` in front to include
email), fills in the shop's name and contact details, creates the owner's login (printed once: send it privately) and
adds the shop to `shops.json`. Other options: `--org <slug>` if you're in several Supabase organizations,
`--region`, `--project-ref` to use a project you already made, `--canary` for a demo shop, `--super` to make the
owner Super Admin, `--app` to give the shop the pull list app. Every step is skipped when already done, so after a failure just run it again.

Then commit `shops.json` in a pull request; merging deploys the site (step 7), and the owner continues at step 8.
The numbered steps below are the same thing by hand.

## Images in Cloudflare R2 (once, for the whole fleet)

Covers and series images of shops marked `"media": "r2"` in `shops.json` (the master catalog is) live in one R2
bucket instead of the shop's Supabase storage: R2 has no charge for people viewing them, which matters when every
shop's visitors load the catalog's covers. Logos, banners, event photos and the Media library stay in Supabase.

1. Cloudflare → **R2** → **Create bucket** named `pullwise-media` (the name in `wrangler.jsonc`). Do this before
   merging the change that adds it: every deploy binds the Worker to it.
2. The bucket → **Settings → Custom Domains → Connect Domain** → `images.pullwise.shop` (`MEDIA_PUBLIC_URL` in
   `wrangler.jsonc`; change both if you use another).
3. The `CLOUDFLARE_API_TOKEN` needs **Account → Workers R2 Storage → Edit** (the "Edit Cloudflare Workers" template
   includes it).
4. Existing images: Actions → **Move images to R2** → Run workflow, first with "dry run" ticked to see the count, then
   without. It copies them into the bucket and rewrites the addresses; shops pick them up on their next hourly sync.

Every shop's own domain also serves these images at `https://<shop domain>/__img/<shop id>/covers/…` (the Worker reads
the bucket; nothing to set up in Cloudflare per shop, since each domain is already attached to the Worker). Mail sent
from a shop's domain should load pictures from that same domain, not from `images.pullwise.shop`, which is more likely to
be filed as spam: the pull-list emails do this: covers that are in R2 load from `<shop domain>/__img/…`, and the logo from
`<shop domain>/__email-logo` (the Worker fetches the logo set in Admin → Emails, else the site logo, and keeps it in Cloudflare's cache; a changed logo shows at once). Covers a shop imported itself live in its own Supabase Storage; the Worker serves those
at `<shop domain>/__sb/covers/…` (only `covers/` and `series/` pictures of that shop's own project, kept in Cloudflare's
cache for a week). Covers on any other site (a distributor's) are left out of mail rather than loaded from another domain.
The unsubscribe and "Skip this one" links go the same way: `<shop domain>/__unsubscribe?u=…` (the Worker hands the request
to the shop's own `weekly-pull-list` function), so the mail links only to the shop's domain. This needs the
function's `SITE_URL` secret to be the shop's own domain; `MEDIA_PUBLIC_URL` (optional, default `https://images.pullwise.shop`)
must match `wrangler.jsonc` if you changed that.

New covers uploaded in an R2 shop's admin (Import, a title's cover, a series cover) go through the site Worker
(`PUT /__media`, staff only) straight into the bucket under the shop's id.

## Emails: pictures and links on the shop's own domain

The pull-list emails (weekly, "your books are in", and staff / event messages) load their logo and cover thumbnails from, and
link their unsubscribe and "Skip this one" buttons to, the **shop's own domain**. Mail whose pictures and links sit on a
different domain from the sender is more likely to be filed as spam. Every shop domain's Worker serves:

| Address on the shop's domain | What it is |
| --- | --- |
| `/__img/<shop id>/covers/…` | Covers in the R2 bucket (the master catalog's covers, which shops link to) |
| `/__sb/covers/…` | Covers kept in that shop's own Supabase Storage (titles the shop imported itself) |
| `/__email-logo` | The logo set in Admin → Emails, else the site logo |
| `/__unsubscribe?u=…` | The unsubscribe and skip links, handed on to the shop's own `weekly-pull-list` function |

**Deploying it.** Nothing to run by hand: merging to `main` runs the Deploy workflow (see Deploys above), which updates each
shop's Edge Functions (this includes `weekly-pull-list`), then the Workers, canary first.

1. Merge to `main`, then open Actions → **Deploy** and check that the canary, every shop's functions and database, and the live
   checks all passed. The functions go out before the main Worker, so for a few minutes an email sent in between could link to
   an address the Worker doesn't serve yet; the weekly and arrival emails are sent on a schedule, so this only matters if one fires then.
2. **`SITE_URL`.** Each shop's `weekly-pull-list` function reads its `SITE_URL` secret to find the shop's domain. It must be the
   shop's own main domain, the first one in `shops.json`, with `https://` and no trailing slash. Shops made with the Add shop
   button or `npm run add-shop` already have it. For one set up by hand: `supabase secrets set SITE_URL=https://<domain> --project-ref <ref>`.
   (`supabase secrets list` shows names only, not values, so the test email below is how to check it.) Without it the email falls back to the old
   Supabase addresses and leaves covers out.
3. **`MEDIA_PUBLIC_URL`** only if you changed the images domain from `https://images.pullwise.shop` (also in `wrangler.jsonc`):
   `supabase secrets set MEDIA_PUBLIC_URL=https://<images domain> --project-ref <ref>`.

**Checking it.** In each shop's Admin → Emails, send yourself a test, then in your mail app:

- View the message source (or hover each picture and button). Every address should be on the shop's domain: the logo at
  `/__email-logo`, covers at `/__img/…` or `/__sb/…`. There should be no `supabase.co` and no `images.pullwise.shop`.
  A test email has no real unsubscribe or skip links (it points at the account page), so check that one separately, below.
- The logo and covers show, and the title and details don't move when the pictures load.
- Dark mode (turn on your mail app's dark theme) and a phone-width window both read cleanly.
- In **desktop Outlook for Windows**, a cover or logo that isn't 2:3 / square isn't stretched.
- Open `https://<shop domain>/__unsubscribe?u=00000000-0000-0000-0000-000000000000`. It should show an "Unsubscribe from the
  weekly pull list email?" page. A made-up token matches nobody, so pressing its button changes nothing.

**If something is wrong.** Fix forward. Don't roll the Worker back to a version from before this change
(`npx wrangler rollback`): the emails already sent link to `/__unsubscribe`, `/__email-logo`, `/__img/…` and `/__sb/…` on the
shop's domain, so an older Worker would break their pictures and, worse, their unsubscribe links, until it is rolled forward again.
Don't unset a shop's `SITE_URL` to switch this off either: the emails' "Log in" link and the calendar feed are built from it.

## The master catalog (once, for the whole fleet)

Create the catalog like any shop: with the button, pick **catalog**; or from your computer, add `--catalog`. Give it a
domain for its admin, e.g. `catalog.yourdomain.com`:

```bash
SUPABASE_ACCESS_TOKEN=… npm run add-shop -- --id catalog --name "Pullwise Catalog" \
  --domain catalog.yourdomain.com --owner-email you@yourdomain.com --catalog
```

Merge its `shops.json` change; from then on every deploy gives each shop the catalog's address and each shop copies
new and changed titles in hourly. Import the week's sheets in the catalog's admin (Admin → Import) instead of in
each shop. See README → "Master catalog" for exactly what syncs.

For PRH title updates, set the catalog's Penguin Random House API key (developer.penguinrandomhouse.com) as a
function secret on the catalog project only; the other shops' `prh-sync` does nothing without it:

```bash
supabase secrets set --project-ref <catalog ref> PRH_API_KEY=…
```

The daily automatic Lunar import needs nothing more: Lunar's sheets are public, and it uses the Deploy secrets.

For the daily automatic PRH import, add the same key as a GitHub repository secret named `PRH_API_KEY` (Settings →
Secrets and variables → Actions). The job uses it with the Deploy secrets already there.

`tools/prh-probe.sh` checks a key and shows PRH's raw replies for a book and a comic.

## 1. Try it locally (optional, 2 minutes)

```bash
python3 -m http.server 8080
```

Open http://localhost:8080. With `SUPABASE_URL` empty in `js/config.js` the site runs in **demo mode** on sample data,
so you can look around before connecting anything. `npm test` runs the test suite.

## 2. Create the Supabase project

1. Create a new Supabase project in your organization. Note the **project ref**, the **Project URL**, the
   **anon public key** (Project Settings → API) and the **database password** you chose.
2. Apply the schema and starting data (the deploy does this too, once the shop is in `shops.json`; doing it now lets
   you finish steps 3–4 before the shop goes live):

   ```bash
   supabase link --project-ref <project ref>
   supabase db push --include-seed   # every migration in order, then supabase/seed.sql
   ```

   That's all the database needs: the migrations turn on pg_cron and pg_net and schedule the hourly jobs
   (status flip, subscriptions, weekly and arrival emails, and the unclaimed-books reminders and pauses).

## 3. Auth

1. Authentication → Providers: leave **Email** on and **allow new sign-ups** (customers sign in with an emailed link or code).
2. Authentication → URL Configuration: set **Site URL** to your site, and add `https://<your site>/account.html` and
   `http://localhost:8080/account.html` to **Redirect URLs**.
3. Authentication → Email Templates → Magic Link: include `{{ .Token }}` so customers can type the 6-digit code.

## 4. First owner (and Super Admin)

Being signed in never makes someone staff; only a row in `public.staff` does.

1. Authentication → Users → **Add user** with the owner's email and a password (auto-confirm).
2. In the SQL editor:

   ```sql
   insert into public.staff (user_id, name, is_owner)
   select id, 'Owner Name', true from auth.users where lower(email) = 'owner@example.com';

   -- Optional: make them Super Admin (can't be removed or demoted by other owners)
   begin;
   select set_config('app.allow_super_change', 'on', true);
   update public.staff set is_super = true, is_owner = true
   where user_id = (select id from auth.users where lower(email) = 'owner@example.com');
   commit;
   ```

Further staff are added from **Admin → Staff** (see `ADMIN-ONBOARDING.md`).

## 5. Edge Functions

Deploys install them for every shop. To do it by hand: `supabase functions deploy` (all of them;
`supabase/config.toml` says which ones are public).

Secrets (`supabase secrets set NAME=value …`; never put these in code):

| Secret | Needed for | Value |
| --- | --- | --- |
| `SITE_URL` | calendar feed, emails | `https://<your site>` (no trailing slash) |
| `RESEND_API_KEY` | all emails | From Resend, after verifying your sending domain (SPF + DKIM) |
| `RESEND_FROM` | emails (fallback) | e.g. `Your Shop <hello@yourshop.com>`; Shop Settings' From address wins when set |
| `CRON_SECRET` | weekly / arrival / event / unclaimed-books emails | A long random string |
| `STAFF_CC` | optional | Comma-separated extra addresses that get copies of sell inquiries and event signups (the shop email in Shop Settings always does) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | app and staff chat notifications | A pair from `node tools/vapid-keys.mjs`. One pair serves every shop; keep it (a new pair makes every customer turn notifications on again) |
| `VAPID_SUBJECT` | app notifications | `mailto:` address push services can reach you at, e.g. `mailto:support@yourdomain.com` |

App notifications (`push-notify`) go out hourly inside the "Your books are in" email's sending hours, whether or not
that email is on. The database finds the function next to `weekly-pull-list` and uses the same `CRON_SECRET`, so it needs
nothing more than the two Vault secrets below. Without the VAPID secrets the app says notifications aren't available yet.

Staff chat notifications use the same function, keys and Vault secrets: when a visitor writes in live chat, the database
asks `push-notify` to tell every staff device that turned them on (admin → Chat, at most once every 5 minutes for each
chat). Without the VAPID secrets the Chat screen offers in-tab desktop alerts instead.

Then give the database the email function's address and the same `CRON_SECRET` (SQL editor):

```sql
select vault.create_secret('https://<project ref>.supabase.co/functions/v1/weekly-pull-list', 'weekly_email_url');
select vault.create_secret('<the same CRON_SECRET>', 'weekly_email_secret');
```

## 6. Add the shop to `shops.json`

All shops share this repo; the site Worker picks the shop by domain. Add an entry in a pull request (the anon key is
public: row-level security protects the data). `npm test` checks the file.

```json
{
  "shops": [
    {
      "id": "main-street",
      "domains": ["mainstreetcomics.com", "www.mainstreetcomics.com"],
      "supabaseUrl": "https://<project ref>.supabase.co",
      "anonKey": "<anon public key>",
      "projectRef": "<project ref>",
      "gaMeasurementId": "",
      "canary": false,
      "app": true
    }
  ]
}
```

The first domain is the shop's main address (used for links in emails, the calendar feed and canonical URLs). Don't put
the keys in `js/config.js`: that file is the local / demo version. `"canary": true` deploys the shop first, on its own
Worker; use it for a demo or test shop, not a real one.

`"app": true` gives the shop the installable pull list app at `/app` (and `app.<domain>`). Without it the shop has no
install manifest, `/app` forwards to the account page (the same pull list in the browser), and the "Get the App" link,
the account page's app note, the weekly email's app line and the admin Dashboard's app numbers are hidden. Turn it on
later by changing `false` to `true` in a pull request: it's live once the deploy finishes. Turning it off again leaves
installed copies opening the account page.

For a shop whose app is on Google Play, add its package name and signing-certificate fingerprints to its entry:

```json
      "app": true,
      "android": { "package": "com.mainstreetcomics.pulllist", "sha256": ["AB:CD:…:89"] }
```

The Worker then serves `/.well-known/assetlinks.json` on the shop's domains, which proves to Android that the app belongs
to the website, so it opens full screen with no browser bar. The fingerprints are the SHA-256 of the app's signing
certificates: in the Play Console under Test and release → App integrity (Play App Signing's, and the upload key's if
you sideload test builds). Without a valid entry the address is a 404.


Enable the version-stamping pre-commit hook once per clone: `git config core.hooksPath .githooks`. (The Deploy
workflow stamps the version again before it deploys, so a commit made without the hook still shows the right one.)

## 7. Go live

Merge the pull request. The Deploy workflow updates the shop's database and functions, deploys the Worker with the
shop's domains attached as custom domains (each must be a zone in the same Cloudflare account), and checks the site
answers with the right shop's settings. Page titles, the tab icon and the home banner are written in by the Worker
from the shop's settings, and update within about a minute of a change in the admin.

Removing a shop's domain from `shops.json` doesn't detach it from the Worker: do that in Cloudflare → Workers & Pages →
the Worker → Settings → Domains & Routes.

## 8. Make it yours (in the admin)

Sign in at `https://<your site>/admin/` as the owner, then:

1. **Shop Settings**: name, tagline, headline, contact details, address, hours, socials, map, logo, favicon, colors,
   timezone, reservation rules, pull list discounts. With the pull list app, also its Home Screen icon and up to four
   screenshots for Android's install sheet (Logo, Colors & Fonts → Pull List App).
2. **Pages / FAQ**: rewrite the About text and anything else that doesn't fit your shop.
3. **Emails**: set the From address, preview, send yourself a test, then turn on the weekly and "your books are in" emails.
   The unclaimed-books reminder and pause emails use the same From address and sending hours; they follow
   Shop Settings → Pickups & Accounts → "Pause pulls for unclaimed books" (on for a new shop), where an owner also sets their
   words, the reminder and pause days, and "Verify new accounts" with its weekly limit.
4. **Import**: drop in your first distributor FOC sheets.
5. **Backup**: nightly backups start on their own once the shop is in shops.json; check the next day that Backup → Backup Log lists one (see `BACKUPS.md`).

## Checklist

- [ ] Migrations and seed applied (`supabase db push --include-seed`)
- [ ] Auth redirect URLs and Magic Link template set
- [ ] Owner added to `public.staff`
- [ ] Edge Functions deployed, secrets and vault secrets set
- [ ] Shop added to `shops.json` in a pull request
- [ ] Merged; the Deploy run is green and the site answers on its domain
- [ ] Shop Settings, About page and email sender filled in; test email received
- [ ] Pull list app: `https://<domain>/app` is in the Auth redirect URLs (`npm run add-shop` adds it), and for the
      short address to print on flyers, `app.<domain>` is attached to the Worker as a custom domain (it forwards to
      `/app`). The app's name, icon and colors come from Shop Settings (the tab icon, else the logo).

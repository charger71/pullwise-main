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
| `SUPABASE_DB_PASSWORD_<ID>` | One per shop: its database password (Supabase → the project → Settings → Database). `<ID>` is the shop's `id` upper-cased with `-` → `_`, e.g. `SUPABASE_DB_PASSWORD_MAIN_STREET`. |

Until the first three exist (or while `shops.json` is empty) the workflow deploys nothing and says why in its summary.
A shop listed without its password secret stops the deploy with an error naming the secret.

**Rolling back the site:** `npx wrangler rollback --name pullwise` (or `pullwise-canary`) puts the previous Worker
version back in seconds. Migrations aren't rolled back; fix forward with a new migration.

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
   (status flip, subscriptions, weekly and arrival emails).

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
| `CRON_SECRET` | weekly / arrival / event emails | A long random string |
| `STAFF_CC` | optional | Comma-separated extra addresses that get copies of sell inquiries and event signups (the shop email in Shop Settings always does) |

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
      "canary": false
    }
  ]
}
```

The first domain is the shop's main address (used for links in emails, the calendar feed and canonical URLs). Don't put
the keys in `js/config.js`: that file is the local / demo version. `"canary": true` deploys the shop first, on its own
Worker; use it for a demo or test shop, not a real one.

Add the shop's database password as the GitHub secret `SUPABASE_DB_PASSWORD_<ID>` (see "Deploys") **before** merging.

Enable the version-stamping pre-commit hook once per clone: `git config core.hooksPath .githooks`.

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
   timezone, reservation rules, pull list discounts.
2. **Pages / FAQ**: rewrite the About text and anything else that doesn't fit your shop.
3. **Emails**: set the From address, preview, send yourself a test, then turn on the weekly and "your books are in" emails.
4. **Import**: drop in your first distributor FOC sheets.
5. **Backup**: download a first backup and set a weekly reminder (see `BACKUPS.md`).

## Checklist

- [ ] Migrations and seed applied (`supabase db push --include-seed`)
- [ ] Auth redirect URLs and Magic Link template set
- [ ] Owner added to `public.staff`
- [ ] Edge Functions deployed, secrets and vault secrets set
- [ ] `SUPABASE_DB_PASSWORD_<ID>` secret added; shop added to `shops.json` in a pull request
- [ ] Merged; the Deploy run is green and the site answers on its domain
- [ ] Shop Settings, About page and email sender filled in; test email received

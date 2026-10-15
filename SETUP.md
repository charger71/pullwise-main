# Fresh Install

Step-by-step setup for a new shop. Every shop gets its own copy of this repo, its own Supabase project and its own
site. After setup, nearly everything (name, hours, colors, logo, page text) is edited in the admin, not in code.

Allow about an hour. You need accounts at GitHub, [Supabase](https://supabase.com), [Cloudflare](https://cloudflare.com)
and (for email) [Resend](https://resend.com), plus the [Supabase CLI](https://supabase.com/docs/guides/cli) and Node 20+.

## 1. Try it locally (optional, 2 minutes)

```bash
python3 -m http.server 8080
```

Open http://localhost:8080. With `SUPABASE_URL` empty in `js/config.js` the site runs in **demo mode** on sample data,
so you can look around before connecting anything. `npm test` runs the test suite.

## 2. Create the Supabase project

1. Create a new Supabase project. Note the **project ref**, the **Project URL** and the **anon public key**
   (Project Settings → API).
2. **Before applying any migrations**, turn on these extensions (Database → Extensions): **pg_cron** and **pg_net**.
   (Several migrations schedule jobs with `cron.schedule`, so they fail if pg_cron is off. **supabase_vault** is on by default.)
3. Apply the schema and starting data:

   ```bash
   supabase link --project-ref <project ref>
   supabase db push                          # runs supabase/migrations/*.sql in order
   psql "<connection string>" -f supabase/seed.sql   # or paste seed.sql into the SQL editor
   ```
4. Turn on the daily status flip (Pre-Order → New This Wednesday → Just Arrived → Available) in the SQL editor:

   ```sql
   select cron.schedule('flip-item-statuses', '0 * * * *', 'select public.flip_item_statuses()');
   ```

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

```bash
supabase functions deploy calendar-feed --no-verify-jwt
supabase functions deploy sell-inquiry --no-verify-jwt
supabase functions deploy weekly-pull-list --no-verify-jwt
supabase functions deploy fetch-cover
supabase functions deploy staff-admin
supabase functions deploy publish-seo
```

Secrets (`supabase secrets set NAME=value …`; never put these in code):

| Secret | Needed for | Value |
| --- | --- | --- |
| `SITE_URL` | calendar feed, emails | `https://<your site>` (no trailing slash) |
| `RESEND_API_KEY` | all emails | From Resend, after verifying your sending domain (SPF + DKIM) |
| `RESEND_FROM` | emails (fallback) | e.g. `Your Shop <hello@yourshop.com>`; Shop Settings' From address wins when set |
| `CRON_SECRET` | weekly / arrival / event emails | A long random string |
| `STAFF_CC` | optional | Comma-separated extra addresses that get copies of sell inquiries and event signups (the shop email in Shop Settings always does) |
| `GITHUB_TOKEN`, `GITHUB_REPO` | "Save & publish titles now" | Fine-grained token with **Actions: Read and write** on this repo; repo as `owner/name` |

Then give the database the email function's address and the same `CRON_SECRET` (SQL editor):

```sql
select vault.create_secret('https://<project ref>.supabase.co/functions/v1/weekly-pull-list', 'weekly_email_url');
select vault.create_secret('<the same CRON_SECRET>', 'weekly_email_secret');
```

## 6. Point the site at the project

Edit `js/config.js` (the only per-shop code file):

```js
export const SUPABASE_URL = 'https://<project ref>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon public key>';   // safe in the browser; row-level security protects the data
export const GA_MEASUREMENT_ID = '';                    // optional, 'G-XXXXXXXXXX'
export const SITE_URL = 'https://<your site>';
```

Optional, for faster first paint: add `<link rel="preconnect" href="https://<project ref>.supabase.co" crossorigin>`
to the `<head>` of the public `*.html` pages.

Enable the version-stamping pre-commit hook once per clone: `git config core.hooksPath .githooks`.

## 7. Host it

Cloudflare → Workers & Pages → Create → import this GitHub repo. No build command; the output directory is the repo
root. Pushes to `main` go live in about a minute. Add your custom
domain there.

GitHub → this repo → Actions: make sure workflows are enabled. `apply-seo.yml` runs every 30 minutes and writes the
page titles, favicon and hero image from the admin into the HTML (it reads `js/config.js`, so do step 6 first).

## 8. Make it yours (in the admin)

Sign in at `https://<your site>/admin/` as the owner, then:

1. **Shop Settings**: name, tagline, headline, contact details, address, hours, socials, map, logo, favicon, colors,
   timezone, reservation rules, pull list discounts.
2. **Pages / FAQ**: rewrite the About text and anything else that doesn't fit your shop.
3. **Emails**: set the From address, preview, send yourself a test, then turn on the weekly and "your books are in" emails.
4. **Import**: drop in your first distributor FOC sheets.
5. **Backup**: download a first backup and set a weekly reminder (see `BACKUPS.md`).

## Checklist

- [ ] pg_cron + pg_net on, migrations applied, seed run, status flip scheduled
- [ ] Auth redirect URLs and Magic Link template set
- [ ] Owner added to `public.staff`
- [ ] Edge Functions deployed, secrets and vault secrets set
- [ ] `js/config.js` filled in and pushed
- [ ] Cloudflare deploy and domain working; Actions enabled
- [ ] Shop Settings, About page and email sender filled in; test email received

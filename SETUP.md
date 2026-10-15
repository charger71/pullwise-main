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
```

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

All shops share this repo; the site Worker picks the shop by domain. Add an entry (the anon key is public: row-level
security protects the data):

```json
{
  "shops": [
    {
      "id": "main-street",
      "domains": ["mainstreetcomics.com", "www.mainstreetcomics.com"],
      "supabaseUrl": "https://<project ref>.supabase.co",
      "anonKey": "<anon public key>",
      "projectRef": "<project ref>",
      "gaMeasurementId": ""
    }
  ]
}
```

The first domain is the shop's main address (used for links in emails, the calendar feed and canonical URLs). Don't put
the keys in `js/config.js`: that file is the local / demo version.

Enable the version-stamping pre-commit hook once per clone: `git config core.hooksPath .githooks`.

## 7. Host it

The whole fleet is one Cloudflare Worker (`wrangler.jsonc`). Deploy it, then attach the shop's domain:

```bash
npx wrangler deploy
```

Cloudflare → Workers & Pages → **pullwise** → Settings → Domains & Routes → **Add → Custom domain** → the shop's
domain (it must be a zone in the same Cloudflare account). Page titles, the tab icon and the home banner are written
in by the Worker from the shop's settings, and update within about a minute of a change in the admin.

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
- [ ] Shop added to `shops.json` and pushed
- [ ] Worker deployed and the shop's domain attached
- [ ] Shop Settings, About page and email sender filled in; test email received

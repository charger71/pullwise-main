# Pop's Comics → Pullwise: schema diff

**Status: PARTIAL. Phase 1 is blocked on database access.** `POPS_DB_URL` and `REFERENCE_DB_URL` are not set in this
session, so nothing below comes from a live database. Everything here is read from the two repos only.
No database was contacted.

## What is still missing (needs the two connection strings)
Schema dumps of both projects, the live-vs-migrations drift check, every diff section the plan needs (only-in-Pop's,
only-in-Pullwise, type/null/default/constraint changes, renames, RLS differences, `auth.users` FK alignment) and
row counts per table.

## Shop → Supabase project mapping (verified in repo)
- `shops.json` is the registry. Each entry has `id`, `domains` (first is the main address), `supabaseUrl`,
  `anonKey` (public), `projectRef`, `gaMeasurementId`, optional `canary`, `media` ("r2"), `app`, `android`.
  The Worker picks the shop by request domain. Today it holds catalog, demo, demo2 and derbycomics.
- Pop's needs a new entry: `popscomics502.com` and `www.popscomics502.com` as domains, its project URL, anon key and
  project ref, added in a pull request (SETUP.md step 6). `canary` stays false. Decide `app` (and `media`).
- Each domain must be a zone in the same Cloudflare account. **Merging the entry makes the Deploy workflow run every
  Pullwise migration plus seed against Pop's live database**, so the entry must not be merged until the schema has
  been brought into line and rehearsed.
- Deploy also needs Pop's `SUPABASE_ACCESS_TOKEN`/secrets, the Edge Functions, `vault` secrets and cron jobs
  (SETUP.md sections 3–5) and the nightly backup (BACKUPS.md).

## Repo-side facts
- Pullwise: 153 migrations, `20261012000000_init.sql` to
  `20270312000000_rename_staff.sql`. 36 files reference `auth.users`/`auth.uid`/`auth.identities`;
  7 declare `references auth.users (id …)`.
- ComicStore (Pop's repo) has 112 migrations and is clearly the ancestor
  (last commit 2026-11-09). 85 versions are shared by name; **7 shared names differ in content**:
- `20261012000000_init.sql`
- `20261017000000_page_content.sql`
- `20261028000000_weekly_status_flip.sql`
- `20261104000000_weekly_email.sql`
- `20261105000000_customer_first_last_name.sql`
- `20261229000000_media_usage.sql`
- `20270102000000_super_admin.sql`
- Only in ComicStore (27, 20270104… to 20270130…): audit fixes, artist/creator catalog, `reorders`, `coming_soon`
  status, qr codes and similar. Many look like the same features Pullwise carries under later version numbers
  (e.g. `artist_merge` is 20270120 there and 20270123 here), so **version numbers have shifted** and a naive
  `supabase db push` would replay them.
- Only in Pullwise (68): locations, push notifications, app visits, stock alerts, fonts, newsletter embed, catalog
  sync, shop price and more.
- Caveat: these are repo histories, not the live databases. Pop's live schema may match neither.

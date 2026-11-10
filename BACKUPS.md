# Backups

Supabase's free plan keeps **no backups** (point-in-time recovery is off), so Pullwise makes its own: automatically
every night, and by hand from the admin whenever you want one.

## Automatic nightly backups

Every night at about 4 a.m. Eastern, the **Automatic backup** GitHub workflow (`.github/workflows/backup.yml` →
`tools/backup-shops.mjs`) backs up **every shop in shops.json**: the same file as Download backup below, read with the
shop's service key. Files go to the **private** R2 bucket `pullwise-backups` (bound to the Worker as `BACKUPS` in
`wrangler.jsonc`; the Deploy workflow creates it if it's missing; it has no public address, unlike the media bucket):

- `daily/<shop>/shop-backup-YYYY-MM-DD.json.gz`, kept 35 days;
- `monthly/<shop>/shop-backup-YYYY-MM-01.json.gz`, the 1st of each month, kept 400 days;
- `weekly/<shop>/shop-media-YYYY-MM-DD[-partNofM].zip`: **every Sunday (UTC) the run also saves all the uploaded pictures** (the whole `media` storage bucket) as .zip archives of about 90 MB each, kept 35 days. They are listed on the Backups tab as "Pictures: part N of M" with a Download button; download all the parts of a week and load them from **Restore → Restore Pictures from a Media Backup**. Run it on another day with `--media` (Actions → Automatic backup → Run workflow → media). If the pictures fail the database backup is still saved, but the run fails so GitHub emails you.

R2 deletes old files by itself (a lifecycle rule the script sets on each run). Each backup is written to that shop's
**Backup → Log** as "Automatic nightly backup", which also keeps the Dashboard's Back up reminder quiet. If a shop
fails, the run fails and GitHub emails you; the other shops are still backed up, and the failure is in that shop's log.

- **Get a file:** **Admin → Backup → Backups** (owners only) lists the shop's files with how long each is kept;
  press Download to keep a copy, or Restore to load tables back from it without downloading it. Each download is written to the Log. The list
  comes from the Worker (`GET /__backups`, `worker/backups.js`), which checks the caller is an owner of that shop and
  only ever shows that shop's own files. (Cloudflare dashboard → R2 → `pullwise-backups` also works.)
- **Run it now:** GitHub → Actions → Automatic backup → Run workflow (leave Shop blank for every shop).
- **Needs:** the `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets the
  Deploy workflow already uses. The Cloudflare token needs **Workers R2 Storage: Edit** (to create the bucket and set its
  clean-up rule), and each shop's database needs migration `20270227000000_automatic_backup` (deployed with main).

The files hold customer data, so leave the bucket private: never connect a custom domain or public r2.dev address to it.

## Make a backup by hand

**Admin → Backup → Backups → Download a Backup Now** (owners only). It reads every table (about 20,000 rows) and saves one file,
`shop-backup-YYYY-MM-DD.json.gz` (about 1.5 MB). Use it before a big change, or to keep a copy outside Cloudflare, such
as in Dropbox. The Dashboard's Needs Attention list shows a **Back up** reminder to owners when the last backup
(automatic or downloaded) is over 7 days old, which with nightly backups running means they have stopped. **Backup → Log** lists every backup downloaded, restore run and customer list exported, with who did it.

The file holds customer names, phone numbers and emails: don't share or email it, and never commit it to git.

**Download media backup (.zip)** on the same box saves every uploaded picture (the whole `media` storage bucket: the Media Library and the covers added by hand) with the same folder names as in storage. A big library is split into several archives of about 250 MB (`shop-media-YYYY-MM-DD-part1of3.zip`, …; a small one is a single `shop-media-YYYY-MM-DD.zip`); each is built and saved in turn so the browser never holds them all, and it may ask to allow multiple downloads. Pictures are not in the database backup. Each media backup is written to the Log.

**Restore pictures:** Backup → Restore → *Restore Pictures from a Media Backup*. Pick all the .zip parts (a zip re-made by Finder or Explorer works too). *Add missing pictures only* uploads just the ones no longer in storage; *Replace* overwrites same-named pictures (type RESTORE). Each run is written to the Log. Pictures use their original paths, so every link to them works again.

Included: titles, customers, pull lists and reservations, orders, events, news, page text, FAQ, surveys, settings, the
series list, the staff list, logs and the change log, plus customers' sign-ins: each account's id, email, confirmation state and **password hash** (bcrypt; not the password itself, but as secret as the rest of the file, so treat every backup as sensitive; the one-time reset/confirmation tokens are not included).
Not included:
- **Uploaded pictures** (Admin → Media: logo, series covers, page pictures). Keep the originals, or download them from
  Supabase → Storage → media.
- **Distributor cover images** (about 1.4 GB). Re-importing the sheets fetches them again.
- The database *structure* and Edge Function code (they are in git), and Supabase secrets (set again with `supabase secrets set`).

## Restore

**In the admin: Admin → Backup** (owners only).

1. Choose a backup: one of the nightly backups (**Restore** on its row loads it straight from R2 through `/__backups`,
   nothing is saved to your computer) or a backup file on this computer (picked on the **Restore** tab). It is read in your browser; nothing changes yet.
2. Tick only the tables you need. The list shows how many rows each table has in the backup and how many it has now.
3. Pick how to load them:
   - **Add missing rows only** (safe): rows that already exist are left as they are; only rows that are gone come back.
     Use this after something was deleted by mistake.
   - **Replace the table with the backup**: deletes every row now in the table first, so anything changed since the
     backup is lost. You must type RESTORE, and a safety backup of today's data is downloaded automatically first.
4. In Replace mode, the screen lists any other tables whose rows the replace would delete or unlink (replacing customers
   deletes their follows and notes and unlinks their orders, for example). Tick those tables too if the backup has them,
   or tick the box that says you accept losing those rows.
5. Press Restore. All the ticked tables load together, all-or-nothing, on the server: if any table fails, nothing is
   changed and the screen names the table. Foreign keys stay enforced and tables load parents first; rows whose parent
   is in neither the database nor the backup (a backup taken while someone was ordering) are skipped and counted. A table
   whose parent rows are missing from a table you didn't tick is refused (tick the parent table too). A very large restore
   can hit the database's time limit; restore fewer tables at a time if it says so. Every restore is recorded in the job
   log and listed under **Backup → Log** (who, add or replace, what each table got, or which table failed).

Not restored: the staff list (add people under Admin → Staff), the staff change log and the job log (kept as the record of
what was done), and the one thing Replace never touches: customers' sign-ins. Tick **customer sign-ins** together with customers and the accounts come back with the same ids and passwords, so nobody has to sign up again; they load first, are only ever added (an account that exists already, by id or email, is never changed) and their email-login records are rebuilt. A backup made before 2027-03-07 has no password hashes: those accounts come back without a password and each customer uses Forgot password once. The command-line `tools/restore.mjs` still skips sign-ins. Restoring event signups doesn't re-send their confirmation emails.

If the whole project is lost: create a new Supabase project, run `supabase db push` so the structure exists, then restore
every table here (the structure itself comes from git, not from the backup).

### From a terminal instead

`tools/restore.mjs` turns a backup file into SQL files, without touching the database:

```
node tools/restore.mjs ~/Dropbox/shop-backup-2026-10-12.json.gz /tmp/restore --tables customers,reservations
supabase db query --linked -f /tmp/restore/restore-customers.sql      # each file in restore-all.txt, in order
```

`--replace` deletes each table first. Big tables are split into `.part01`, `.part02` ... (Supabase refuses requests over
about 1 MB): run every part in order. This route switches foreign-key checks off while loading, so use the admin screen
unless it is unavailable.

Tested 2026-10-12 against the live database (inside a rolled-back transaction): customers, reservations, orders,
settings, pages, events, the series list, follows and the titles table loaded back and matched the live data exactly.

## Better protection

Supabase's paid plan includes daily backups kept for 7 days, and point-in-time recovery as an add-on. Both restore the
whole database at once; the nightly files above let you bring back single tables.

## Filling a new project from another site's backup

Restore also takes backups made by the original single-shop site (Pop's Comics, `popscomics-backup-….json.gz`), so a
new project, such as the master catalog, can start with an existing shop's titles, series and artists:

1. In the old site's admin, **Staff → Backup → Download backup** (owners).
2. In the new project's admin, **Restore**, pick the file, and tick only the catalog tables:
   **categories, items, series_catalog, series_aliases, creator_catalog, creator_aliases**. Leave everything else
   unticked (customers, reservations, staff… stay with the old shop). Don't tick item_creators: it is rebuilt from
   the titles' credits as they load.
3. Choose **Replace** if the new project has no titles yet (its starting categories are swapped for the backup's, so
   every title keeps its category), otherwise **Add missing rows**.

Prices load as the retail price. Covers keep pointing at the old site's image storage, so they keep working as long as
that project does.

## Taking your data with you

**Admin → Backup → Customers** has two CSV exports for leaving Pullwise (or a mailing): **Customers** (name, contact details, address, email preferences, joined date) and **Customers and pull lists**, which adds one row per title still on a customer's pull list (open, ordered or arrived) and per series or creator they follow, with quantity, status and release date. A customer with nothing on their list still gets a row. Orders that aren't linked to a customer aren't in it. Each export is written to the Log. They hold personal details: don't share or email them.

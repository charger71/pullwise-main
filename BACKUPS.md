# Backups

The Supabase project has **no automatic backups** (its backup list is empty and point-in-time recovery is off), so
the admin has a manual one.

## Make a backup

**Admin → Backup → Download backup** (owners only). It reads every table (about 20,000 rows) and saves one file,
`shop-backup-YYYY-MM-DD.json.gz` (about 1.5 MB). Do it weekly and keep the file somewhere safe, such as Dropbox.
The Dashboard's Needs Attention list shows a **Back up** reminder to owners when the last download is over 7 days old
(or there never was one).

The file holds customer names, phone numbers and emails: don't share or email it, and never commit it to git.

Included: titles, customers, pull lists and reservations, orders, events, news, page text, FAQ, surveys, settings, the
series list, the staff list, logs and the change log, plus the sign-in list for reference (no passwords).
Not included:
- **Uploaded pictures** (Admin → Media: logo, series covers, page pictures). Keep the originals, or download them from
  Supabase → Storage → media.
- **Distributor cover images** (about 1.4 GB). Re-importing the sheets fetches them again.
- The database *structure* and Edge Function code (they are in git), and Supabase secrets (set again with `supabase secrets set`).

## Restore

**In the admin: Admin → Restore** (owners only).

1. Choose a backup file. It is read in your browser; nothing changes yet.
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
   log.

Not restored: the staff list (add people under Admin → Staff), the staff change log and the job log (kept as the record of
what was done), and customers' sign-ins (they sign up again with the same email and are matched back to their customer
record and pull list automatically). Restoring event signups doesn't re-send their confirmation emails.

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

Supabase's paid plan includes daily backups kept for 7 days, and point-in-time recovery as an add-on.

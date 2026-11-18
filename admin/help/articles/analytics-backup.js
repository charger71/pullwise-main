// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
## Analytics

**Analytics** shows how the shop is doing: **Sales** (reservations and the most-wanted titles), **Customers** (growth, and who's drifting away) and **Searches** (what people look for, including searches that found nothing, a good hint for what to stock).

![Analytics](analytics)

## Backup (owners)

Your shop is backed up every night. **Backup** lets you download a copy whenever you want one.

![Backup](backup)

- **Backups**: **Download database backup** (everything except pictures) or **Download media backup** (the pictures, as a .zip). Keep them somewhere safe: they hold customer details. The nightly automatic backups are listed below, to download or restore.
- **Restore**: put back data from a backup. Read the screen carefully first; it shows what will change.
- **Customers**: a spreadsheet of customers' contact details, for a mailing or your records. It isn't a backup.
- **Log**: when backups ran.

> **Tip:** the Dashboard's **Needs Attention** reminds you if the shop hasn't been backed up recently.
`;

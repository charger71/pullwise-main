// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
The Dashboard is the first screen you see after signing in. It answers "what needs doing today?"

![Dashboard → Today](dashboard-today)

## Today

- **The tiles** across the top count new orders, copies still to order, and books ready for pickup.
- **Needs Attention** lists what's worth a look: books past their pickup window, customers with no email, guest orders to link, titles missing a cover, category or price, new survey responses and event signups, and (for owners) a backup that's overdue. Each line has a button that opens the list already filtered. When it's empty, you're all caught up.
- **Next order cutoff** and **Latest orders** show what's coming up and what just came in.

![Needs Attention](dashboard-attention)

## The Special Announcement

The **Special Announcement** bar at the top of the Dashboard is a message shown across the top of your website: holiday hours, a signing, Free Comic Book Day. Click it to open it, change the text, and save. Clear the text to take it down.

## Trends

Orders per day, the **most-reserved titles** and what people search for most. It's a quick look; [Analytics](#help/analytics-backup) has the full picture.

![Dashboard → Trends](dashboard-trends)

## System

Whether the shop's scheduled jobs (the nightly backup, the weekly emails, adding new issues to pull lists, updating title statuses on release day) ran on time. Nothing to do here unless a job shows a problem.

![Dashboard → System](dashboard-system)

> **Tip:** a shop with more than one location gets a **Today** tab per location.
`;

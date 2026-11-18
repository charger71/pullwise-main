// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
On new-release day, tell Pullwise what came in. Customers then see their books as ready for pickup, and the "your books are in" email can go out.

## Mark books ready

Open **Ordering → Received**.

![Ordering → Received](received)

1. Every title releasing this week is listed, with the copies customers reserved and the store's own copies on order. Tick **Only titles with copies coming** to hide the rest.
2. Tick what came in. Titles out this week that have copies coming start ticked; **Tick all shown** and **Clear ticks** help with the rest. Untick anything that didn't arrive or came up short.
3. Click **Mark … ready**.

![The Mark ready button](received-mark-ready)

Customers' copies become **Ready**, and the hold window starts today (its length is set in **Shop Settings → Pre-Orders & Stock**). The store's own copies are marked received.

> **Tip:** titles with no release date, from earlier weeks, or only re-ordered aren't ticked for you. Tick them by hand when they arrive.

## Hand books over

When a customer collects, mark their titles **picked up**: open them on [Customers](#help/customers), or use **Scan pickup code** there to find them from the code on their phone.

## Re-order

**Re-order** is for ordering a title after its cutoff: trades and omnibuses stay in print, and Coming Soon titles (past their cutoff, not out yet) are where most re-orders happen.

![Ordering → Re-order](reorder)

1. Search the catalog and pick the title.
2. Choose the copies and who they're for: the shelf, or a customer (it goes on their pull list).
3. Add it to the re-order list, export the list for the distributor, then mark it ordered.

When re-ordered copies arrive, mark customers' copies ready on **Received**, and shelf copies received on **Re-order**.
`;

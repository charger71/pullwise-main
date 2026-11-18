// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
Pullwise follows the comic shop week. Here is which screen to open, and when. Your distributors set the order cutoffs (FOC, usually a Monday); everything else follows from them.

## Every day

- Open the [Dashboard](#help/dashboard). **Today** shows new orders, books ready for pickup and anything that **Needs Attention**.
- Answer [Chat](#help/chat) if it's switched on, and serve customers at the counter from [Customers](#help/customers).

## Saturday: customers' deadline

Customers can reserve a title until **midnight on the Saturday before its order cutoff**. After that it drops off the Pre-Orders page, so your numbers stop changing before you order. Staff can still add a title to a customer's pull list past the cutoff.

## Order cutoff day (usually Monday)

1. **Ordering → Store Order**: enter the copies the store wants for its own shelves.
2. **Ordering → Place Order**: check the totals, then get the Lunar file or the PRH lines and place the order on the distributor's site.
3. Mark the cutoff ordered.

The full steps are in [Placing your order at the cutoff](#help/place-order).

## Wednesday: new-release day

1. **Ordering → Received**: tick what came in and mark it **Ready**. Customers see it as ready for pickup, and the "your books are in" email goes out at the times set on [Emails](#help/emails).
2. Hand books over at the counter, and mark them **picked up** on the customer's pull list or with **Scan pickup code** on Customers.

See [New-release day: receiving books](#help/receiving).

## Every week, by themselves

- **The weekly pull list email** goes out at the time set under **Emails → Email Settings**.
- **New issues** of series customers follow are added to their pull lists, and the catalog updates every hour.
- **Unclaimed books:** if pausing is switched on, customers whose books have waited too long get a reminder, then a pause. See [Approvals, unclaimed books and pauses](#help/accounts).

> **Tip:** the Dashboard's **System** tab shows whether these scheduled jobs ran on time.
`;

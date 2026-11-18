// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
At each order cutoff (FOC) you tell the distributors how many copies of each title to send. Pullwise adds up what customers reserved, plus the store's own shelf copies, so you only check and send.

## 1. Enter the store's own copies

Open **Ordering → Store Order**. It lists every title for one cutoff, A to Z, whether customers reserved it or not.

![Ordering → Store Order](store-order)

- Type how many copies the store wants for its shelves in **Store**. Each number saves as you type; **Enter** moves to the next title.
- A title starts at last issue's number (or the series' every-issue number, if you set one). That number is ordered unless you change it; **0** orders none.
- **Customers** is what customers reserved. **Copies** is the total that goes to the distributor.

## 2. Check the order

Open **Place Order**. It shows the copies to order per title for each cutoff.

![Ordering → Place Order](place-order)

> **Tip:** accounts waiting for approval and paused pull lists aren't counted. A note at the top says how many copies that leaves out.

## 3. Get the file for the distributor

In the **Distributor Order List** box, pick **one cutoff** and **Lunar** or **PRH**:

- **Lunar:** click **Download Lunar file**, then upload it on Lunar's **Upload FOC Edits** page (only that page: it sets each title to the full total).
- **PRH:** click **Get PRH lines** and paste them into PRH's cart. PRH takes a limited number of lines at a time, so they come in numbered batches.
- Other distributors: use **Export CSV** or **Export PDF**.

![Lunar picked for one cutoff](place-order-lunar)

## 4. Mark it ordered

After you've placed the order on the distributor's site, mark the cutoff ordered. Its titles move to **Ordered** on every customer's list, and Pullwise records what was sent.

If numbers change after that (a late reservation, a changed store number), the changed titles come back to the top with what was sent and how far the total has moved, so you can send the difference.

> **Tip:** exports always use the latest numbers. Click **Refresh** in the box if the page has been open a while.
`;

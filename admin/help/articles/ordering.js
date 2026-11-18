// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
**Ordering → Reservations** lists every order customers have placed. Use it to find an order and move its titles along.

![Ordering → Reservations](ordering-reservations)

## Find an order

- Search by customer name, phone, email or title, and pick which titles to show: **Active**, **Ready**, **Past pickup**, **Ordered** or **All**.
- **Past pickup** shows books that have waited longer than your hold time (set in **Shop Settings → Pre-Orders & Stock**).
- **Export CSV** downloads the list.
- Click an order to open it and see each title on it.

![An order opened, with its titles](ordering-order-open)

## Title statuses

Each title on an order moves through these steps:

1. **Open**: reserved by the customer, not ordered yet.
2. **Ordered**: on an order you've placed with the distributor (set for you when you mark a cutoff ordered on **Place Order**).
3. **Ready**: in the shop and waiting for the customer (set for you when you mark it ready on **Received**).
4. **Picked up**: the customer has it.

A title can also be **released** (back to the shelf, for example after the hold time runs out) or **cancelled**. You can change any title's status by hand from the order or the customer's pull list.

## The other Ordering tabs

- **Store Order** and **Place Order**: at each order cutoff. See [Placing your order at the cutoff](#help/place-order).
- **Received** and **Re-order**: on new-release day and after. See [New-release day: receiving books](#help/receiving).

> **Tip:** a shop with more than one location picks the location at the top of the screen. It applies to every tab, because orders are placed and received per location.
`;

// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
Two optional rules protect your orders from no-shows and fake accounts. Both are set by an owner in **Shop Settings → Pickups & Accounts**, and both are handled day to day on **Customers**.

## Unclaimed books and pauses

When a customer's books have waited too long, Pullwise can send a friendly "your books are waiting" reminder, and later **pause** their pull list: no new titles from follows, no new pre-orders, and nothing new ordered for them until they pick up.

**Customers → Unclaimed** lists everyone with books waiting, how many, their value, and how long the oldest has waited.

![Customers → Unclaimed](customers-unclaimed)

- **Pause or resume by hand** from the customer's page, whether or not automatic pausing is on. A customer paused by hand stays paused until staff resume them.
- Automatic pauses can lift by themselves once everything waiting is picked up.
- Customers who collect monthly can be set to **Monthly**, or **Exempt** (no reminders or pauses), on their page.

## Approving new accounts

With **Verify new accounts** on, a new account can build a pull list, but nothing is ordered for them until staff approve it. After that, a **weekly limit** applies until their first pickup. Existing accounts are never affected.

**Customers → Approvals** lists accounts, titles over the weekly limit, and guest orders waiting for a yes.

![Customers → Approvals](customers-approvals)

Click **Approve** when you recognize the customer (or they've been in). Until then their copies aren't counted on **Place Order**.

## Setting the rules

![Shop Settings → Pickups & Accounts](settings-pickups)

- **Pause pulls for unclaimed books**: the reminder day, the pause day (weekly and monthly customers), and the two emails in your words. Preview them on [Emails](#help/emails).
- **Count waiting days from**: books that arrived before this date count from it, so nobody is paused for old history.
- **Verify new accounts** and **Weekly limit before first pickup ($)**: blank or 0 means no limit.
`;

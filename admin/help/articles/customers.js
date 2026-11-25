// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
**Customers** lists everyone who made an account on your site, and anyone you add yourself. Use it at the counter and on the phone.

![Customers → All Customers](customers-list)

## Find a customer

Type a name, phone number, email or pickup code in the search box. The list tabs help too:

- **New This Week**: accounts made in the last week (the badge shows how many).
- **Needs Attention**: customers missing a name or email, and guest orders to link to a customer.
- **Unclaimed** and **Approvals**: see [Approvals, unclaimed books and pauses](#help/accounts).

## A customer's pull list

Open a customer to see their page. The **Pull List** tab shows everything they've reserved, its status, and the series and creators they follow.

![A customer's pull list](customer-pull-list)

- **Change a title:** set the quantity or status on its line (for example, mark it picked up).
- **Add a title:** search in **Add to Pull List**. Staff can add titles past the customer cutoff.
- **Follows:** new issues of a followed series are added to the list by themselves. Add or remove follows here.
- **Export PDF** prints the list, for example to put in their bag.

![Add to Pull List](customer-add-title)

## Profile, messages and changes

- **Profile**: name, email, phone, address, and whether they get the weekly and "books are in" emails. **Notes** are private to staff.
- **Messages**: emails sent to them. Click any customer's email address to write to them.
- **Changes**: every change to their pull list and follows, newest first: what staff changed (with their name), what the customer changed themselves on the site or in the app (**Customer**), and what the shop did on its own, such as a cutoff move (**Automatic**). **Show older changes** loads the rest.

![Customer → Profile](customer-profile)

## Add a customer

Click **New customer** for someone without an account, such as a regular who doesn't use the website. With an email, they can sign in later and see the same list.

> **Tip:** deleting a customer removes their profile, pull list, orders, follows, notes and login, and can't be undone. Check twice.
`;

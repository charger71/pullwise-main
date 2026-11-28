// Help article: see admin/help/topics.js. Markdown, as admin/help/markdown.js reads it.
export default String.raw`
**Shop Settings** (owners only) is your shop's details and rules. One **Save settings** button covers every tab.

![Shop Settings → Shop](settings-shop)

## The tabs

- **Shop**: name, contact details, address and map, opening hours and holiday hours, and a **Notice for staff** shown at the top of every admin screen.
- **Logo, Colors & Fonts**: your logo, colors and fonts. A readability check warns when text would be hard to read.

## Layout

**Logo, Colors & Fonts → Layout** picks how your website is laid out. Pick one of each and press **Save settings**; your logo, colors and fonts apply to every layout.

- **Top navigation**: **Classic** (announcement and search strip, logo on the left), **Centered** (big logo in the middle, menu underneath) or **Bold bar** (one bar in your accent color, search behind an icon).
- **Home page banner**: **Banner** (headline over your accent color or banner photo), **Split** (headline beside your banner photo), **This week's covers** (six of this week's new covers, filled in for you; the New This Week shelf starts after them) or **Slim** (one line, so your own top block comes first).
- **Footer**: **Full** (address, hours, social and links), **Simple** (one line of links and your address with today's hours) or **Sign-up first** (your newsletter sign-up leads).

> **Tip:** Split needs a banner photo and Sign-up first needs a newsletter sign-up (Emails → Weekly Email Signup). Without them the site shows the Banner and the Simple footer instead.
- **Online**: social links, whether live chat is used at all, analytics, and footer code (such as an email signup form).
- **Pre-Orders & Stock**: **Copies per customer per title**, **Hold reservations after arrival (days)**, and the shop's time zone.
- **Pickups & Accounts**: pausing for unclaimed books and verifying new accounts. See [Approvals, unclaimed books and pauses](#help/accounts).

![Logo, Colors & Fonts](settings-look)

![Pre-Orders & Stock](settings-stock)

> **Tip:** only one person should edit Shop Settings at a time. Saving overwrites the page, so if two people have it open, the last save wins.

## Locations

A shop with more than one location manages them on **Locations** (Utilities). Each location then gets its own Today tab on the Dashboard, and is picked at the top of Ordering.
`;

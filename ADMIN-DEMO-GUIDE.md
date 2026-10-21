# Admin demo guide: showing Pullwise to a comic shop owner

A script for a **25-30 minute** walk through the admin. It follows a shop's week (Wednesday arrivals, order cutoffs, pull lists) instead of the menu order, because that is how an owner thinks about the shop. Each stop has the point to make, what to click, and the question owners tend to ask.

**Short on time?** Do the 10-minute version: stops 1, 2, 4, 6 and 10.

## Before the demo (15 minutes)

- [ ] **Use a demo shop with a real database.** The admin does nothing in local demo mode ("This site isn't connected to a database"). Use your canary/demo shop (`"canary": true` in `shops.json`).
- [ ] Sign in as an **owner** so every menu item and Shop Settings appear.
- [ ] **Fix the gaps I found on demo.pullwise.shop (checked Oct 21):**
  - **Media library is empty** ("No images yet"). Upload 2-3 photos so Stop 7 isn't blank.
  - **No surveys and no QR codes.** Make one of each before the demo, or build one live (a good moment).
  - **Never backed up.** The dashboard shows "Never backed up: download a backup" in Needs Attention. Click **Back up** once so it reads clean.
  - **108 visible titles have no cover.** That is the first thing a shop owner will notice on the Dashboard. Fix it or avoid clicking that row's Fix button.
  - **Weekly and "your books are in" emails are Off.** Fine for the demo (Preview and Send a test still work), but say so.
  - **Orders mostly show as "Guest order".** Only one customer (Isaac Bishop, order #19, 27 titles) is a real pull list. Use that one in Stop 4.
  - Customers, events (5 upcoming), news (3 posts), the Top 50 and reservations in every state are already good.
- [ ] Set the logo and colors to something that looks like a comic shop, not a blank template.
- [ ] Open the public site in a second tab so you can show the admin change and the customer view side by side.
- [ ] Hard refresh the admin (Cmd+Shift+R) and close any private tabs. Turn off "Send to everyone" anywhere you would be tempted to click it; use **Send a test to me** only.
- [ ] Have **ADMIN-ONBOARDING.md** and **ROADMAP.md** open in case they ask about staff access or what's coming.

## The pitch in one sentence

> Customers build their own pull list and reserve online. You see every order, order exactly what you need at the cutoff, and tell people the moment their books are in, without anyone retyping anything.

## Stop 1: Dashboard (3 min)

**Point:** Open the admin and the first screen tells you what to do today.

- **Today** tab: new orders, copies to order, ready for pickup, **Needs Attention**, next order cutoff, latest orders.
- **Trends** tab: orders per day, **Top 50 most reserved titles**, titles by status. "This is what your customers actually want, not what a distributor thinks."
- **System** tab: scheduled jobs and backups. "It runs itself; the daily status flip happens overnight."
- Click the **Special Announcement** bar at the top and edit it. Flip to the public site to show it live (holiday hours, Free Comic Book Day).

**They'll ask:** "Do my staff all see this?" Yes, everyone on staff sees the same dashboard.

## Stop 2: Titles and Import (4 min)

**Point:** The catalog fills itself. A shop doesn't have to import anything.

- **Dashboard → System → catalog-sync**: titles arrive hourly from the Pullwise master catalog (Lunar, PRH and Funko sheets are imported once for every shop). The demo shop has 6,000+ titles and has never run an import. Your shop price, status, category, staff picks and hidden flags are never overwritten by the sync.
- **Import Titles → Import Files**: for things the catalog doesn't carry, a shop can still drop in its own sheet (Lunar, PRH or Funko, or any spreadsheet with a Title column) and sees what will change before anything is saved. Don't upload a file on the demo shop.
- **Always Skip**: publishers, series and words you never carry. "Set once, never see them again." Incentive and "N COPY" covers are never added.
- **Titles → All**: search, filter, change status, mark a **Staff Pick**, fix a cover or price, add a title by hand. Click **Hide** (staff can hide; only owners delete).
- **FOC This Week / Out This Week**: on Wednesday FOC becomes **FOC Next Week**. "This is the screen you stare at at the cutoff."

**They'll ask:** "Where do the titles come from?" Weekly distributor files you upload; there's nothing to key in.

## Stop 3: Series (1 min)

**Point:** Distributors name the same series two ways; fix it once.

- **All Series** (738 on the demo shop): merge duplicates, set a series cover. **Add Active Series**: the list customers can follow. **Creatives**: add or block artists and writers.

## Stop 4: Customers and pull lists (4 min)

**Point:** Every customer has a real pull list, and you can see and fix it.

- **Customers → All Customers**: search by name, phone or email.
- Open one. Walk the tabs: **Pull List** (add a title past the cutoff, follows), **Profile** (details, private notes), **Messages**, **Changes**.
- **Needs Attention** and **New This Week** (badge count): guests to link, missing emails.
- On Isaac Bishop's Pull List (verified): summary chips (1 ready for pickup, 24 open, 2 ordered, and "24 new from follows this week"), a quantity box and status dropdown per title, "Added by Customer / Series follow" on each line, **Export PDF**, and an **Email customer** button at the top. "New from follows" shows the series-follow feature: new issues land on his list automatically.
- Every row on the customer list shows small status icons (weekly email off, arrival email off) because those emails are off on the demo shop.
- Click a customer's email to write them directly.
- Mention privacy: names, phones and emails stay in the admin.

**Then show the customer side (public site, 1 min):** sign in with an emailed code (no password to forget), add a title to the pull list, reserve a pre-order. Return to the admin and refresh: the order is there.

**They'll ask:** "Will my customers actually use it?" Sign-in is an emailed link or 6-digit code, no accounts to create or passwords to remember. Guest orders can be linked to a customer afterward.

## Stop 5: Ordering (5 min)

**Point:** One screen from "what did people reserve" to "what did I order" to "it's here."

- **Ordering → Reservations**: filter by title status (including **Past pickup window**). Expand an order and move its titles through **open → ordered → ready → picked up / released / cancelled**.
- **Place Order**: use at each cutoff. Copies are totaled per title for each order cutoff. Show **Export PDF** (pick a cutoff and distributor), then **Mark N copies ordered** after you place the order with the distributor. In a demo, skip the Mark button unless you want those orders to move to "ordered". "This is your order, already counted."
- **Received**: mark titles ready as the box comes in.

**They'll ask:** "What about people who never pick up?" Past pickup window filter plus release; the pre-order and stock rules (Shop Settings) set the limits.

## Stop 6: Emails (3 min)

**Point:** The shop talks to customers without anyone writing emails.

- **Emails → Email Settings**: schedule (default Thursday 9 AM shop time), sender, look.
- **Send**: show **Preview** of the weekly pull list email (ready for pickup, coming this week, coming up, link to edit). Click **Send a test to me**. **Do not click "Send to everyone" in a demo.**
- The **"your books are in"** email is automatic: once turned on, it is checked hourly and sent only within the sending hours you set (the section header shows "Automatic: noon to 8 PM"-style hours), to customers whose newly arrived titles haven't been announced yet. Show its section on the Email Settings tab; don't use the send-now button on the demo shop.
- **Email Log**: a record of what was sent.

## Stop 7: Website content (4 min)

**Point:** You run your own site; no web designer needed.

- **Pages**: edit homepage text, **Shelf Intros** (Closing Soon, Funko Pops, Action Figures, Records), **We Buy Comics**, Terms. Each page has a **Google & Browser Tab** for search listing text. Show a change on the public site.
- **News**: write a post with the editor, add an image, schedule it. Tabs: All, Published, Scheduled, Drafts.
- **Events**: add an event; customers can subscribe to the calendar (.ics, Google/Outlook) and sign up. **Event Signups** tab shows who's coming.
- **Media**: **Library** and **Upload** (photos are resized automatically).
- **FAQ** and **QR Codes**: print a QR code for the counter or a flyer.
- **Surveys**: build one, show **Share** (link and QR) and **Results** (print as PDF). "Ask customers what you should stock."

## Stop 8: Shop Settings (2 min, owner only)

**Point:** The shop is yours: logo, colors, hours, rules.

- **Shop**: staff notice, contact, hours, map.
- **Logo & Colors**: change a color and watch the **readability check** warn if text is hard to read. Link color is automatic by default.
- **Online**: social links, analytics, footer email signup (paste your own form code from any email service).
- **Pre-Orders & Stock**: reservation rules.
- One **Save settings** button covers every tab.

## Stop 9: Staff and safety (2 min)

**Point:** Your data is protected and your staff have the right access.

- **Staff → Add a Staff Member**: name and email, a password is generated and shown once. They can sign in right away.
- **Owners** manage staff, settings and deletions; regular staff add and edit but can't delete.
- **Change Log**: every change is recorded with who made it.
- **Backup / Restore**: your data is backed up and you can restore it.
- "Remove" locks someone out immediately.

**They'll ask:** "What if an employee quits angry?" Remove, and their login is gone at once; the change log shows what they touched.

## Stop 10: Close (2 min)

Recap in their words: pull lists, ordering at the cutoff, emails on autopilot, their own site.

- **What it takes to get started:** their domain, their distributor sheets, a logo and colors. (Point to SETUP.md internally; one database per shop, one shared codebase.)
- Mention what's coming from **ROADMAP.md** (two-factor sign-in for owners and staff).
- Ask: "What does your Wednesday look like now?" and listen.

## Handling common objections

| They say | You say |
| --- | --- |
| "We already use a pull list system." | Show the Import and Ordering stops: how long does your cutoff take now? |
| "My customers aren't online." | Staff can add titles to any customer's pull list from the Customers screen. |
| "I'm not technical." | Show the Staff stop and Pages: everything is point-and-click, no code. |
| "What does my data look like if I leave?" | Backup tab: it's yours. |
| "Is customer info safe?" | Staff-only access, owners control who gets it, change log records edits. |

## Demo don'ts

- Don't send to everyone. Don't delete a customer (it can't be undone).
- Don't show real customer names, phones or emails.
- Don't edit Shop Settings in two tabs at once (last save wins).
- Don't improvise on a feature you haven't tried on the demo shop this week; rehearse the order flow once.

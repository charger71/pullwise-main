// Storefront components: README + preview each. Markup follows the site's own templates (js/site.js, js/components.js,
// js/catalog.js, js/pages/*); styles are css/site.css under .pw-shop in bundle.css.
import { SOCIAL_ICONS } from '../../js/social-icons.js';
const soc = (k) => `<li><a href="#" aria-label="${SOCIAL_ICONS[k].label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SOCIAL_ICONS[k].path}"/></svg></a></li>`;
const G = (g) => `Storefront · ${g}`;
const page = (title, body, cls = 'pw-shop pw-pad') => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} — preview</title></head>
<body>
<div class="${cls}">
${body.trim()}
</div>
</body>
</html>
`;
const ph = '<div class="cover cover--placeholder" aria-hidden="true">Image coming soon</div>';
const badge = (s, icon, label) => `<span class="badge badge--${s}"><span aria-hidden="true">${icon}</span> ${label}</span>`;

const listTags = (top, pick) => `${top ? '<span class="list-tag list-tag--top" title="One of our 10 most reserved titles">Top 10</span>' : ''}${pick ? '<span class="list-tag list-tag--pick"><span aria-hidden="true">★</span> Staff Pick</span>' : ''}`;
const viewToggle = (list) => `<div class="view-toggle" role="group" aria-label="Show titles as"><button class="btn btn--small btn--ghost" type="button" aria-pressed="${!list}" aria-label="Grid" title="Grid"><svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg></button><button class="btn btn--small btn--ghost" type="button" aria-pressed="${list}" aria-label="List" title="List"><svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg></button></div>`;
const toolbar = (count, list) => `<div class="list-toolbar"><p class="results-count" role="status">${count}</p><div class="list-toolbar__controls"><label class="visually-hidden" for="sort">Sort titles</label><select id="sort" class="list-toolbar__sort"><option>Order cutoff (soonest)</option><option>Title A–Z</option></select>${viewToggle(list)}</div></div>`;

// Mirrors itemCard() in js/components.js: .card__info holds the text, .card__actions the buttons (under the text in a
// grid, at the right of a list row).
const card = ({ status, icon, label, title, variant, meta, chips, pick, top, foc, soon, foot = true, on = false, covers = false, follow = false }) => {
  const actions = foot ? `<div class="card__foot">${on ? '<button class="btn btn--ghost" aria-pressed="true"><span aria-hidden="true">✓</span> On your pull list</button>' : '<button class="btn btn--primary" aria-pressed="false">Add to pull list</button>'}${covers ? '<button class="btn btn--ghost" type="button">Add all covers</button>' : ''}</div>${follow ? '<button class="follow-open" type="button">+ Follow<span class="follow-open__more"> series / artist</span></button>' : ''}` : '';
  return `<article class="card">
  <div class="card__media${top ? ' has-top-badge' : ''}">
    ${ph}
    ${top ? '<span class="top-badge" title="One of our 10 most reserved titles"><span class="top-badge__top">Top</span><span class="top-badge__num" aria-hidden="true">10</span><span class="visually-hidden"> 10 most reserved</span></span>' : ''}
    ${pick ? '<span class="pick-badge"><span aria-hidden="true">★</span> Staff Pick</span>' : ''}
  </div>
  <div class="card__body">
    <div class="card__info">
      <div class="card__badges">${badge(status, icon, label)}${listTags(top, pick)}</div>
      ${chips ? `<ul class="chips" aria-label="Collector notes">${chips.map((c) => `<li>${c}</li>`).join('')}</ul>` : ''}
      <h3 class="card__title"><button class="card__title-open" type="button">${title}<span class="visually-hidden"> (details)</span></button></h3>
      ${variant ? `<p class="card__variant">${variant}</p>` : ''}
      <p class="card__meta">${meta}</p>
      ${foc ? `<p class="foc${soon ? ' foc--soon' : ''}"><span aria-hidden="true">⏱</span> ${foc}</p>` : ''}
    </div>
    ${actions ? `<div class="card__actions">${actions}</div>` : ''}
  </div>
</article>`;
};

export const SHOP = [
  {
    name: 'ShopHeader', group: G('Layout'), height: 126, width: 1200,
    readme: `# ShopHeader

The storefront's sticky header: an announcement and search bar on top, then the shop's logo or name and the main menu.

- **Top bar** (\`.topbar\`): a darkened \`shop-brand-primary\` band with the announcement on the left (\`<strong>Announcement:</strong>\` then staff text) and site search on the right; the search button is \`shop-gold\` with \`shop-on-accent\` ink.
- **Brand** (\`.brand\`): the logo (\`.brand__logo\`, at most 48px tall), the name in \`shop-type-shop-name\` and \`shop-cream\`, or both (then the logo's alt is empty). An \`&\` in the name turns \`shop-gold-text\`.
- **Menu** (\`.nav\`): Pre-Orders, New Arrivals, We Buy, Calendar, News, Visit, My Pull List, plus any custom pages. The current page is \`shop-gold-text\` and underlined (\`aria-current="page"\`). A count badge (\`.nav-badge\`) is \`shop-red-btn\`; \`.nav-badge--new\` is \`shop-gold\` with \`shop-on-accent\` text.
- Below 1100px the menu folds behind the gold \`.nav-toggle\` (44px) and opens as a panel under the header that scrolls if it runs past the screen.
- A skip link (\`.skip-link\`) is always first.
- Consumer provides: shop settings (name, logo, announcement) and the page id for \`aria-current\`. Rendered by \`renderHeader()\` in js/site.js.`,
    html: page('ShopHeader', `
<header id="site-header">
  <div class="topbar">
    <div class="topbar__inner container">
      <p class="topbar__notice"><strong>Announcement:</strong> Free Comic Book Day is May 2. Doors open at 9.</p>
      <form class="topbar__search" role="search" onsubmit="return false">
        <label class="visually-hidden" for="site-q">Search the site</label>
        <input id="site-q" type="search" name="q" placeholder="Search" maxlength="100" autocomplete="off">
        <button class="topbar__btn" type="submit" aria-label="Search"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></button>
      </form>
    </div>
  </div>
  <div class="header__bar container">
    <a class="brand" href="#"><span class="brand__name">Galaxy Comics <span>&amp;</span> Games</span></a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav"><span class="nav-toggle__icon" aria-hidden="true"></span><span class="visually-hidden">Menu</span></button>
    <nav id="site-nav" class="nav" aria-label="Main">
      <ul><li><a href="#" aria-current="page">Pre-Orders</a></li><li><a href="#">New Arrivals <span class="nav-badge nav-badge--new">12</span></a></li><li><a href="#">We Buy</a></li><li><a href="#">Calendar</a></li><li><a href="#">News</a></li><li><a href="#">Visit</a></li><li><a href="#">My Pull List <span class="nav-badge">3</span></a></li></ul>
    </nav>
  </div>
</header>`, 'pw-shop'),
  },
  {
    name: 'ShopFooter', group: G('Layout'), height: 517, width: 1000,
    readme: `# ShopFooter

The storefront footer: the newsletter band, then three columns (address and contact, hours and social, more links) and the copyright line.

- Background \`shop-brand-footer\`; text in muted, headings in \`shop-footer-heading\` (\`shop-type-footer-heading\`, upper case), links in \`shop-footer-link\`. When a shop picks a light footer, text and links switch to dark, readable values (js/theme-vars.js).
- **Newsletter** (\`.newsletter\`): a \`surface\` band with a centered heading, staff intro and the shop's own pasted sign-up code.
- **Hours** (\`.hours\`): a definition list, day bold on the left, time on the right, at most 280px wide.
- **Holiday hours** (\`.hours__title\` then \`.hours.hours--holiday\`): the next 60 days' holiday dates under the weekly hours, the holiday's name in \`.hours__note\` (small, muted) under the date, "Closed" or the times on the right. Shown wherever the hours are.
- **Social** (\`.socials\`): the **Social icons** asset group at 20px in 44px tap areas, plain in the footer (no circles), pulled left so the first glyph lines up with the text.
- Links in "More" run in two columns and wrap long page titles instead of widening the page.
- **Copyright line** (\`.footer__legal\`, \`shop-fs-xs\`, centred): the shop's copyright text (or "© year shop name"), then " · Powered by Pullwise" in the same small text. It's plain text, not a link, and the only place Pullwise appears on the site. The "Get the App" link shows only for shops with the app.
- Consumer provides: shop settings (address, phone, email, hours, socials, copyright). Rendered by \`renderFooter()\` in js/site.js.`,
    html: page('ShopFooter', `
<section class="newsletter"><div class="container"><h2>Get the Weekly New&#8209;Release Email</h2><div class="lede"><p>Every Tuesday: what's out Wednesday and what's at FOC.</p></div></div></section>
<footer id="site-footer">
  <div class="container footer__grid">
    <section>
      <h2 class="footer__heading">Galaxy Comics &amp; Games</h2>
      <address><a href="#">1208 Main Street<br>Springfield, OR 97477</a></address>
      <p><a href="#">(541) 555-0147</a></p>
      <p><a href="#">hello@galaxycomics.example</a></p>
    </section>
    <section>
      <h2 class="footer__heading">Hours</h2>
      <dl class="hours"><div><dt>Wed</dt><dd>10 AM – 8 PM</dd></div><div><dt>Thu – Sat</dt><dd>11 AM – 7 PM</dd></div><div><dt>Sun</dt><dd>12 – 5 PM</dd></div></dl><p class="hours__title">Holiday hours</p><dl class="hours hours--holiday"><div><dt>Wed, Dec 24<span class="hours__note">Christmas Eve</span></dt><dd>10 AM – 3 PM</dd></div><div><dt>Thu, Dec 25<span class="hours__note">Christmas Day</span></dt><dd>Closed</dd></div></dl>
      <h2 class="footer__heading footer__heading--next">Social</h2>
      <ul class="socials">${soc('instagram')}${soc('discord')}${soc('whatnot')}</ul>
    </section>
    <section>
      <h2 class="footer__heading">More</h2>
      <ul class="footer__links"><li><a href="#">About</a></li><li><a href="#">Gift Cards</a></li><li><a href="#">How To</a></li><li><a href="#">FAQ</a></li><li><a href="#">Privacy</a></li><li><a href="#">Terms</a></li></ul>
    </section>
  </div>
  <p class="container footer__legal">© 2026 Galaxy Comics &amp; Games · Powered by Pullwise</p>
</footer>`, 'pw-shop'),
  },
  {
    name: 'ShopHero', group: G('Layout'), height: 424, width: 1000,
    readme: `# ShopHero

The home page opener: the shop's headline over a faint halftone dot screen, an intro line and up to two actions.

- Headline in \`shop-type-h1\` (upper case); wrap one phrase in a \`<span>\` to color it \`shop-gold-text\`. One per page.
- Intro in \`shop-cream\`, at most 620px wide. Actions in \`.hero__actions\`: one \`btn--primary\`, one ghost.
- With a banner photo (\`.hero--photo\`, the picture in \`--hero-image\`) a left-to-right \`shop-paper\` scrim (92% → 60%) keeps the headline readable on any picture.
- Padding 64px, 96px from 800px wide. A single \`shop-line\` rule underneath.
- Consumer provides: headline, intro, actions and optional photo, all from Shop Settings and page text.`,
    html: page('ShopHero', `
<section class="hero"><div class="container">
  <h1>Your week in comics, <span>held at the counter</span></h1>
  <p>Reserve this week's books and next month's pre-orders. We pull them and hold them for you.</p>
  <div class="hero__actions"><a class="btn btn--primary" href="#">See pre-orders</a><a class="btn btn--ghost" href="#">New this week</a></div>
</div></section>`, 'pw-shop'),
  },
  {
    name: 'ShopButton', group: G('Actions'), height: 161,
    readme: `# ShopButton

Storefront buttons: upper-case labels on square-cornered (3px) blocks, \`shop-field-h\` (46px) tall, like the fields beside them.

- **Default** (\`.btn\`): \`shop-teal\` with \`shop-paper\` text; hover \`shop-teal-hover\`. Secondary actions such as Search or Done.
- **Primary** (\`.btn--primary\`): \`shop-red-btn\` with \`shop-on-primary\` text; hover a 15% darker red. The one action that matters on a card or form: Add to pull list, Reserve, Save.
- **Ghost** (\`.btn--ghost\`): transparent with a \`shop-gold-text\` edge and label. Also the "on" state of a toggle (✓ On your pull list, with \`aria-pressed="true"\`).
- **Disabled** (\`[disabled]\`): \`raised\` fill, muted text, \`line\` edge, not faded.
- **Small** (\`.btn--small\`): \`shop-btn-h-sm\` (36px) tall with a \`fs-xs\` label; on phones \`shop-tap\` (44px), so it's never under the touch minimum. For a row of actions beside each result in a list (search's Series and Artists); on a phone the actions sit on their own line under the name.
- **Icon** (\`.btn__icon\`, from \`btnIcon()\` in \`js/util.js\`): a 16px stroke icon in the label's color, before the label: \`follow\` (+), \`covers\`, \`books\`, \`on\` (✓, the "Following" state). Decorative (\`aria-hidden\`): the label says what the button does.
- **Link button** (\`.link-button\`): an action that reads as a link, in \`shop-teal\`, underlined.
- No hover lift or shadow on the storefront. Labels are verbs ("Add to pull list", not "Submit").
- Consumer provides: the label and \`type\`. Use \`<a class="btn">\` only for navigation.`,
    html: page('ShopButton', `
<div class="pw-row">
  <button class="btn btn--primary" type="button">Add to pull list</button>
  <button class="btn" type="button">Search</button>
  <button class="btn btn--ghost" type="button" aria-pressed="true"><span aria-hidden="true">✓</span> On your pull list</button>
  <button class="btn btn--primary" type="button" disabled>Cutoff passed</button>
  <button class="link-button" type="button">Sign out</button>
</div>
<div class="pw-row">
  <button class="btn btn--primary btn--small" type="button"><svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Follow</button>
  <button class="btn btn--ghost btn--small" type="button"><svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h11v15"/><path d="M5 6h11v15H5z"/></svg>All covers</button>
  <span class="btn btn--ghost btn--small is-on" aria-disabled="true"><svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Following</span>
</div>`),
  },
  {
    name: 'ShopField', group: G('Forms'), height: 501,
    readme: `# ShopField

Form fields on the storefront: a visible label above every control, a hint under it, and one shared field height.

- Wrap each control in \`.field\` with a \`<label>\` (\`shop-type-label\`). Hints go in \`.field__hint\` (muted, .85rem), never in the placeholder.
- Inputs, selects and the multi-select button are \`shop-field-h\` (46px) tall with 9px corners, a \`shop-paper\` fill and a \`field-line\` edge; hover and focus turn the edge \`shop-teal\`, focus adds a soft 3px \`shop-focus\` glow.
- Tick boxes and radios are 24px with a \`shop-teal\` accent, beside their label in \`.field--check\` (44px row).
- Errors: \`.form-error\` in \`shop-error\`, bold, announced with \`role="alert"\`.
- Two short fields share a row in \`.account-row\`. Sign-up forms use \`.signup\` (input and button side by side from 600px).
- Consumer provides: label text, ids and validation messages.`,
    html: page('ShopField', `
<form class="pw-col" style="max-width:460px" onsubmit="return false">
  <div class="account-row">
    <div class="field"><label for="f-first">First name</label><input id="f-first" type="text" value="Jane"></div>
    <div class="field"><label for="f-last">Last name</label><input id="f-last" type="text" value="Smith"></div>
  </div>
  <div class="field"><label for="f-tel">Phone</label><input id="f-tel" type="tel" placeholder="(555) 123-4567"><p class="field__hint">We text you when your books are in.</p></div>
  <div class="field"><label for="f-loc">Pickup location</label><select id="f-loc"><option>Main Street</option><option>Eastgate</option></select></div>
  <div class="field field--check"><input id="f-week" type="checkbox" checked><label for="f-week">Send me the weekly pull list email</label></div>
  <p class="form-error" role="alert">Please enter a phone number.</p>
</form>`),
  },
  {
    name: 'ShopMultiSelect', group: G('Forms'), height: 486,
    readme: `# ShopMultiSelect

A checkbox dropdown for catalog filters (publisher, format): a button that looks like a select, opening a panel of tick boxes.

- The button (\`.multi__button\`) matches a select: same height, corners and chevron; its summary reads "All", one name, or "3 selected".
- The panel (\`.multi__panel\`) is \`raised\` with a \`line\` edge and \`shop-shadow-lg\`, at least the button's width and up to 300px. More than ten options adds a search box; pinned favourites sit above a divider.
- Options are \`shop-tap\` (44px) rows; footer actions are Clear (underlined) and Done (\`shop-gold\` with \`shop-on-accent\` text).
- \`aria-expanded\` on the button, \`aria-controls\` to the panel. Escape and Done close it.
- Consumer provides: the label, options and the field name. Built by js/catalog.js.`,
    html: page('ShopMultiSelect', `
<div class="filters" style="max-width:340px;display:block">
  <div class="field multi">
    <span class="label" id="m-label">Publisher</span>
    <button type="button" class="multi__button" aria-expanded="true" aria-controls="m-panel" aria-labelledby="m-label m-summary"><span class="multi__summary" id="m-summary">2 selected</span></button>
    <div class="multi__panel" id="m-panel" style="position:static;margin-top:4px">
      <input type="search" class="multi__search" placeholder="Find a publisher" aria-label="Find a publisher">
      <fieldset class="multi__options">
        <label class="multi__option"><input type="checkbox" checked> DC Comics</label>
        <label class="multi__option"><input type="checkbox" checked> Marvel</label>
        <hr class="multi__divider">
        <label class="multi__option"><input type="checkbox"> Boom! Studios</label>
        <label class="multi__option"><input type="checkbox"> Image Comics</label>
      </fieldset>
      <div class="multi__actions"><button type="button" class="multi__clear">Clear</button><button type="button" class="multi__done">Done</button></div>
    </div>
  </div>
</div>`),
  },
  {
    name: 'ShopFilters', group: G('Forms'), height: 220, width: 1000,
    readme: `# ShopFilters

The filter bar above a catalog grid: a search box and select or multi-select filters, with a live count under it.

- \`.filters\` is a \`surface\` box with a \`line\` edge and \`shop-radius\`. On phones it is two columns with search on its own row; from 800px every filter shares one row and search is 1.6× wider.
- Filter labels are .85rem. Under the bar, the list toolbar (\`.list-toolbar\`, js/list-view.js): the count (\`.results-count\`, \`role="status"\`, muted) on the left; on the right a sort select (\`.list-toolbar__sort\`, 44px tall: the page's usual order first, then Title A–Z / Z–A, Release date, Price both ways, Publisher; held in the address as \`?sort=\`) and the Grid / List switch (\`.view-toggle\`, as on the Calendar; remembered on the device per page). Used on Pre-Orders, New Arrivals and Search.
- List view (\`.grid--list\`): one title per row with the buttons on the right; see ShopTitleList.
- Consumer provides: the filters, the sort choices and the count text ("48 titles").`,
    html: page('ShopFilters', `
<form class="filters" role="search" onsubmit="return false">
  <div class="field field--search"><label for="q">Search</label><input id="q" type="search" placeholder="Title, creator or series"></div>
  <div class="field"><label for="pub">Publisher</label><select id="pub"><option>All</option><option>DC Comics</option></select></div>
  <div class="field"><label for="fmt">Format</label><select id="fmt"><option>All</option><option>Comic</option><option>Trade</option></select></div>
  <div class="field"><label for="month">Out</label><select id="month"><option>Any month</option><option>November</option></select></div>
</form>
${toolbar('48 titles', false)}`),
  },
  {
    name: 'ShopTitleCard', group: G('Catalog'), height: 643, width: 960,
    readme: `# ShopTitleCard

A title in the catalog grid: cover, status, collector notes, title, meta, the order cutoff and the pull-list button.

- \`.card\`: \`surface\` fill, \`line\` edge, a 3px top rule in the derived red, 5px corners, no shadow.
- Cover (\`.cover\`) at the comic trim ratio 6.625 / 10.25 on \`raised\`; no cover shows "Image coming soon" over a faint dot screen.
- On the cover: **Staff Pick** (\`.pick-badge\`, \`shop-gold\` with \`shop-on-accent\` text), and the **Top 10** disc (\`.top-badge\`, white with a \`shop-brand-primary\` number) for the ten most reserved; with both, Staff Pick moves left.
- Body order, always: status badge (ShopStatusBadge), collector chips (\`.chips\`: 1st Appearance, Key Issue…, \`shop-gold-text\` on \`raised\`), title (\`shop-type-card-title\`, a button that opens the details dialog), variant, meta (\`publisher · Out date · price\`), cutoff line (\`.foc\`, \`shop-error\` within two days), then the button.
- Grid (\`.grid\`): 2 across, 3 from 600px, 4 from 800px, 6 from 1100px (tighter text). Series cards add a red "Series" band over the cover (\`.card__banner\`).
- Consumer provides: the title record. Rendered by \`itemCard()\` in js/components.js.`,
    html: page('ShopTitleCard', `
<div class="grid">
${card({ status: 'pre_order', icon: '◷', label: 'Pre-Order', title: 'Absolute Batman #12', variant: 'Cover B Jock', meta: 'DC Comics · Out Nov 4 · $4.99', chips: ['Key Issue'], top: true, pick: true, foc: 'Add by Sat, Oct 31', soon: false })}
${card({ status: 'pre_order', icon: '◷', label: 'Pre-Order', title: 'Saga #71', meta: 'Image Comics · Out Nov 11 · $3.99', foc: 'Add by tomorrow night <span class="card__meta">(Sat, Oct 24)</span>', soon: true, on: true })}
${card({ status: 'just_arrived', icon: '★', label: 'Just Arrived', title: 'Monstress #60', meta: 'Image Comics · $3.99', chips: ['Final Issue'], foot: false })}
<article class="card"><div class="card__media">${ph}<span class="card__banner" aria-hidden="true">Series</span></div><div class="card__body"><h3 class="card__title">Transformers</h3><p class="card__meta">Series · 24 issues listed</p><button class="follow-open" type="button">+ Follow<span class="follow-open__more"> this series</span></button></div></article>
</div>`),
  },
  {
    name: 'ShopTitleList', group: G('Catalog'), height: 590, width: 960,
    readme: `# ShopTitleList

The catalog in list view: one title per row, for scanning a long list. The visitor picks it with the List switch in the list toolbar (ShopFilters) on Pre-Orders, New Arrivals and Search; the choice is remembered on the device per page.

- \`.grid.grid--list\`: the same \`.card\` markup as ShopTitleCard, one per row, with a 1px top edge and a 3px red rule down the left instead of across the top.
- Cover: 76px wide (96px from 800px), centred top to bottom in the row. The cover badges are hidden; Top 10 and Staff Pick show as small labels beside the status badge instead (\`.list-tag\`: Top 10 in \`shop-brand-primary\` with \`shop-on-primary\` text, Staff Pick in \`shop-gold\` with \`shop-on-accent\` text).
- Text (\`.card__info\`) fills the middle in the card's usual order. The buttons (\`.card__actions\`: Add to pull list, Add all covers, then the Follow link) sit in a 220px column on the right, full width and stacked, centred in the row. Under 600px they drop below the text at their natural width.
- Consumer provides: the title records. Rendered by \`itemCard()\` in js/components.js; the switch is \`listToolbar()\` in js/list-view.js.`,
    html: page('ShopTitleList', `
${toolbar('48 titles', true)}
<div class="grid grid--list">
${card({ status: 'pre_order', icon: '◷', label: 'Pre-Order', title: 'Absolute Batman #12', variant: 'Cover B Jock', meta: 'DC Comics · Out Nov 4 · $4.99', chips: ['Key Issue'], top: true, pick: true, foc: 'Add by Sat, Oct 31', covers: true, follow: true })}
${card({ status: 'pre_order', icon: '◷', label: 'Pre-Order', title: 'Saga #71', meta: 'Image Comics · Out Nov 11 · $3.99', foc: 'Add by tomorrow night <span class="card__meta">(Sat, Oct 24)</span>', soon: true, on: true, follow: true })}
${card({ status: 'just_arrived', icon: '★', label: 'Just Arrived', title: 'Monstress #60', meta: 'Image Comics · $3.99', chips: ['Final Issue'], foot: false })}
</div>`),
  },
  {
    name: 'ShopStatusBadge', group: G('Catalog'), height: 129,
    readme: `# ShopStatusBadge

A title's stock status: an icon and an upper-case word on a colored chip, never color alone.

- \`.badge.badge--<status>\`, \`shop-type-badge\`, 2px corners. Statuses and their icons come from \`ITEM_STATUS\` in js/labels.js: Pre-Order ◷ and Coming Soon ◷ (\`shop-teal\`; Coming Soon is a status of its own: a pre-order past its order cutoff, not out yet), New This Wednesday ★ and Just Arrived ★ (\`shop-gold\`), Available ✓ (\`shop-ok\`), Low Stock ! (orange), Sale % (\`shop-red-btn\`, \`shop-on-primary\` text), Clearance ↓ (pink), Backorder ↻ (\`shop-cream\`), Sold Out ✕ (dark with light text).
- The icon is \`aria-hidden\`; the word carries the meaning.
- Related labels: \`.foc\` (the order cutoff, \`shop-error\` when close), \`.new-badge\` (a gold pill on titles a follow added), \`.chips\` (collector notes).
- Text is \`shop-paper\` on the blue, green, orange, pink and cream chips (these switch to dark fills on a light page), \`shop-on-accent\` on the gold ones, \`shop-on-primary\` on Sale and \`shop-on-sold-out\` on Sold Out.`,
    html: page('ShopStatusBadge', `
<div class="pw-row">
  ${badge('pre_order', '◷', 'Pre-Order')}${badge('coming_soon', '◷', 'Coming Soon')}${badge('new_this_wednesday', '★', 'New This Wednesday')}${badge('just_arrived', '★', 'Just Arrived')}${badge('available', '✓', 'Available')}${badge('low_stock', '!', 'Low Stock')}
  ${badge('sale', '%', 'Sale')}${badge('clearance', '↓', 'Clearance')}${badge('backorder', '↻', 'Backorder')}${badge('sold_out', '✕', 'Sold Out')}
</div>
<div class="pw-row" style="margin-top:16px">
  <p class="foc" style="margin:0"><span aria-hidden="true">⏱</span> Add by Sat, Oct 31</p>
  <p class="foc foc--soon" style="margin:0"><span aria-hidden="true">⏱</span> Add by tonight</p>
  <span class="new-badge">New</span>
  <ul class="chips"><li>1st Appearance</li><li>Key Issue</li><li>One-Shot</li></ul>
</div>`),
  },
  {
    name: 'ShopTitleModal', group: G('Catalog'), height: 617, width: 960,
    readme: `# ShopTitleModal

The title details dialog that opens from a cover or title: the cover (and other covers) on the left, details and the pull-list button on the right.

- A \`<dialog class="title-modal">\` up to 900px wide; two columns (260px cover, details) from 700px, full screen below 600px.
- Below 600px it's a sheet: it slides up to open and down to close (\`dur-sheet\`), and a swipe down from the top of its content or from the close bar follows the finger and closes it past 120px (or on a quick flick), springing back otherwise. Escape, the close button, the backdrop and the back button all slide it away. Under reduced motion it opens and closes at once and doesn't follow a swipe.
- Title in the display face, upper case, clamp(1.5rem, 4vw, 2.1rem). Then the release line, status, the description, creators as chips, and the card's own footer (Add to pull list, Add all covers, Follow).
- Other covers are 52px thumbnails (\`.title-modal__thumb\`); the one showing has a \`shop-gold-text\` edge.
- The close button is a \`shop-tap\` (44px) circle; with the keyboard it fills \`shop-teal\` instead of drawing an outline (an outline clips at the dialog edge).
- In the app, signed in, a title that can't be reserved (Sold Out, Backorder, or Coming Soon past its cutoff) gets **Notify me when it's in** (primary; \`.title-modal__alert\`). Pressed, it turns ghost with "✓ We'll tell you when it's in" (\`aria-pressed\`) and a status line, which also says to turn on notifications if they're off. One notification is sent when the title is back on the shelf.
- Under an upcoming release date, **Add to calendar:** Apple / .ics (an all-day event on the release day, linking to the title) and Google (\`.title-modal__cal\` row of 44px links).
- Last comes a ghost **Share** button (\`.title-modal__share\`): a phone opens its share sheet with a link to the title on the website (Pre-Orders while it can be ordered, else New Arrivals); elsewhere it copies the link and says "Link copied." beside it.
- Consumer provides: the title record. Built by js/title-modal.js.`,
    html: page('ShopTitleModal', `
<dialog class="title-modal" open style="position:static;margin:0 auto;max-height:none">
  <div class="dialog__head title-modal__head"><button class="dialog__close" type="button" aria-label="Close">×</button></div>
  <div class="dialog__body" style="max-height:none">
    <div class="title-modal__layout">
      <div class="title-modal__media"><div class="title-modal__cover">${ph}</div>
        <ul class="title-modal__covers"><li><button class="title-modal__thumb is-on" type="button" aria-label="Cover A"><span class="title-modal__nocover">A</span></button></li><li><button class="title-modal__thumb" type="button" aria-label="Cover B"><span class="title-modal__nocover">B</span></button></li></ul>
      </div>
      <div>
        ${badge('pre_order', '◷', 'Pre-Order')}
        <h2 class="title-modal__title">Absolute Batman #12</h2>
        <p class="title-modal__when card__meta">DC Comics · Out Wed, Nov 4 · $4.99</p>
        <p class="foc"><span aria-hidden="true">⏱</span> Add by Sat, Oct 31</p>
        <p class="title-modal__desc">Bruce Wayne has no fortune and no butler, only a city that keeps pushing back. The story arc continues.</p>
        <ul class="chips" aria-label="Creators"><li>Scott Snyder</li><li>Nick Dragotta</li></ul>
        <div class="card__foot"><button class="btn btn--primary">Add to pull list</button><button class="btn btn--ghost">Add all covers</button></div>
      </div>
    </div>
  </div>
</dialog>`),
  },
  {
    name: 'ShopListBar', group: G('Reservations'), height: 334,
    readme: `# ShopListBar

The reservation list: a bar fixed to the bottom of the screen while a guest has titles on their list, and the dialog that reviews and sends it.

- \`.list-bar\`: \`surface\` with a \`line\` top edge, safe-area padding at the bottom; the text reads "**Your Pull List** · 3 titles, 4 copies" with a primary button beside it. The page gets 76px of bottom padding while it shows.
- \`.list-dialog\` (up to 600px): a line per title (\`.list-line\`): 52px cover, title, variant and cutoff, then quantity (72px number field) and an underlined Remove. Name fields sit two to a row from 480px.
- Consumer provides: the list (titles and quantities) and the shop's copy limit. Built by js/components.js and js/reservation-list.js.`,
    html: page('ShopListBar', `
<div class="list-dialog" style="max-width:600px">
  <ul class="list-lines">
    <li class="list-line"><div class="cover cover--placeholder" aria-hidden="true">No cover</div><div class="list-line__info"><strong>Absolute Batman #12</strong><span class="card__variant">Cover B Jock</span><p class="foc"><span aria-hidden="true">⏱</span> Add by Sat, Oct 31</p></div><div class="list-line__controls"><label class="visually-hidden" for="q1">Quantity</label><input class="list-line__qty" id="q1" type="number" min="1" value="2"><button class="list-line__remove" type="button">Remove</button></div></li>
    <li class="list-line"><div class="cover cover--placeholder" aria-hidden="true">No cover</div><div class="list-line__info"><strong>Saga #71</strong><p class="foc foc--soon"><span aria-hidden="true">⏱</span> Add by tonight</p></div><div class="list-line__controls"><label class="visually-hidden" for="q2">Quantity</label><input class="list-line__qty" id="q2" type="number" min="1" value="1"><button class="list-line__remove" type="button">Remove</button></div></li>
  </ul>
</div>
<div class="list-bar" style="position:static;margin-top:16px"><div class="container list-bar__inner"><p class="list-bar__text"><strong>Your Pull List</strong> · 2 titles, 3 copies</p><button class="btn btn--primary" type="button">Review and send</button></div></div>`),
  },
  {
    name: 'ShopEvent', group: G('Content'), height: 328,
    readme: `# ShopEvent

An event on the calendar: a tear-off date block beside the type, title, time and place, with the event's photo on the right on wider screens.

- Date block (\`.event__date\`, 64px): month in a \`shop-red-btn\` strip with \`shop-on-primary\` text, day in \`shop-type-date\`, on \`surface\` with a \`line\` edge.
- Type (\`.event__type\`: Release party, Signing, Tournament…) in \`shop-gold-text\` upper case; title as an h3 link; when-and-where in muted.
- Months are separated by \`.month-heading\` (\`shop-type-title\` with a \`line\` underline).
- \`.event--compact\` is the home page's "Coming up" list: a 48px block and smaller text.
- Tags (\`.event__tags\` of \`.event__tag\`): Today (accent), Tomorrow, Signups open / N spots left (\`shop-ok\`), Full (\`shop-error\`) and Cancelled (\`shop-sold-out\`). A repeating event adds \`.event__repeat\` ("· Repeats weekly") after the type; a cancelled one strikes its title (\`.event__title--cancelled\`).
- Consumer provides: the event record. Built by js/pages/calendar.js.`,
    html: page('ShopEvent', `
<h2 class="month-heading">November 2026</h2>
<article class="event">
  <div class="event__date" aria-hidden="true"><span class="event__month">Nov</span><span class="event__day">7</span></div>
  <div class="event__body"><div class="event__text"><span class="event__type">Signing <span class="event__repeat">· Repeats weekly</span></span><p class="event__tags"><span class="event__tag event__tag--today">Today</span> <span class="event__tag event__tag--open">8 spots left</span></p><h3><a href="#">Meet the Monstress team</a></h3><p class="event__when">Saturday, November 7 · 1:00 PM–4:00 PM · Main Street</p><p class="event__summary">Bring your books; two signatures per person.</p><div class="event__actions"><a href="#">Add to calendar</a><a href="#">Details</a></div></div></div>
</article>
<article class="event event--compact" style="margin-top:20px">
  <div class="event__date" aria-hidden="true"><span class="event__month">Nov</span><span class="event__day">14</span></div>
  <div><span class="event__type">Tournament</span><h3><a href="#">Pokémon League night</a></h3><p class="event__when">Sat, Nov 14 · 6:00 PM</p></div>
</article>`),
  },
  {
    name: 'ShopCalendar', group: G('Content'), height: 420,
    readme: `# ShopCalendar

The Calendar page's month view, beside the list. A List / Calendar switch (\`.view-toggle\` of icon-only small ghost buttons, the pressed one filled \`shop-gold-text\`) sits under the filters and is remembered on the device; the address holds the view, month and filters.

- \`.cal__nav\` (Prev, month title, Next) and \`.cal__today\` (This month); \`.cal__weekdays\` and \`.cal__grid\` of \`.cal__day\` cells, today edged \`shop-gold-text\`.
- An event is a \`.cal__event\` link with its time. Its left edge takes the type's color (\`--cal-type\`: release party gold, signing teal, tournament warn, livestream violet, Comic Con clearance, sale ok, other cream); a legend (\`.cal__legend\`) names them, and the type is also in the link's hidden text. A cancelled event is struck through and muted.
- A square shows two events; more are behind \`.cal__more\` ("+N more"), which opens a dialog listing the day. Phones show only the days that have events, one under another, with every event.
- Arrow keys move between days; swiping sideways changes the month on a phone.
- Consumer provides: the month's events. Built by js/pages/calendar.js.`,
    html: page('ShopCalendar', `
<div class="cal"><div class="cal__nav"><button class="btn btn--ghost btn--small" type="button">← Prev</button><h2 class="cal__title">November 2026</h2><button class="btn btn--ghost btn--small" type="button">Next →</button></div>
<ul class="cal__weekdays" aria-hidden="true"><li>Sun</li><li>Mon</li><li>Tue</li><li>Wed</li><li>Thu</li><li>Fri</li><li>Sat</li></ul>
<ol class="cal__grid">
<li class="cal__day cal__day--has cal__day--today"><span class="cal__num"><span class="cal__label">Sat 14</span><span class="cal__digit" aria-hidden="true">14</span></span><ul class="cal__events"><li><a class="cal__event cal__event--release_party" href="#"><span class="cal__time">11:00 AM</span> New Comic Day party</a></li><li><a class="cal__event cal__event--tournament" href="#"><span class="cal__time">6:00 PM</span> Pokémon League</a></li></ul><button class="cal__more" type="button">+1 more</button></li>
<li class="cal__day cal__day--has"><span class="cal__num"><span class="cal__label">Mon 16</span><span class="cal__digit" aria-hidden="true">16</span></span><ul class="cal__events"><li><a class="cal__event cal__event--signing cal__event--cancelled" href="#"><span class="cal__time">1:00 PM</span> Creator signing</a></li></ul></li>
</ol>
<ul class="cal__legend"><li><span class="cal__swatch cal__swatch--release_party"></span>Release party</li><li><span class="cal__swatch cal__swatch--signing"></span>Signing</li><li><span class="cal__swatch cal__swatch--tournament"></span>Tournament</li></ul></div>`),
  },
  {
    name: 'ShopPanel', group: G('Content'), height: 404,
    readme: `# ShopPanel

Boxes for content on the storefront: the panel, the light callout, the notice, and staff quote blocks.

- **Panel** (\`.panel\`): \`surface\` with a \`line\` edge, 5px corners, 24px padding, no shadow. Title in \`shop-type-title\`.
- **Callout** (\`.callout\`): a light tint of \`shop-gold\` with #161616 text and links: a rounded note that must stand out (gift card terms, a sale).
- **Notice** (\`.notice\`): \`shop-teal-dark\` with a 3px \`shop-teal\` left edge, normal weight: information about the page itself (demo data, a signed-out state).
- **Staff quote** (\`blockquote\` in \`.lede\` or \`.page-body\`): staff text marked as a quote in the editor shows as a bold \`shop-gold\` box with \`shop-on-accent\` text.
- Consumer provides: the content. Staff-written content comes from the admin editor.`,
    html: page('ShopPanel', `
<div class="info-grid">
  <section class="panel"><h2>Pickup</h2><p class="m-0" style="margin:0">We hold arrivals for 30 days. Ask at the counter and we'll bring out your box.</p></section>
  <div class="pw-col">
    <p class="callout">Gift cards never expire. <a href="#">Buy one online</a>.</p>
    <p class="notice">You're signed out. Sign in to see your pull list.</p>
    <div class="page-body"><blockquote>Closed Thanksgiving Day. Open 9 AM Black Friday.</blockquote></div>
  </div>
</div>`),
  },
  {
    name: 'ShopDisclosure', group: G('Content'), height: 301,
    readme: `# ShopDisclosure

Show-and-hide boxes on the storefront: FAQ answers and the "How it works" note on Pre-Orders.

- \`<details>\` with a \`<summary>\` (44px tall, bold): \`surface\` with a \`line\` edge. One indicator everywhere: a chevron that points down when closed and flips up when open (no motion with reduced motion).
- \`.how-it-works\` is the quiet version: no box, the summary in \`shop-teal\` like a link, the text flush with the page.
- Consumer provides: the question and answer (staff text).`,
    html: page('ShopDisclosure', `
<details class="how-it-works"><summary>How pre-orders work</summary><div><div class="page-body"><p>Add titles by the cutoff and we order them for you. We email you when they arrive.</p></div></div></details>
<details open><summary>How long do you hold my books?</summary><div><p>30 days after they arrive. Ask us if you need longer.</p></div></details>
<details><summary>Can I cancel a pre-order?</summary><div><p>Until the cutoff date, from My Pull List.</p></div></details>`),
  },
  {
    name: 'ShopDialog', group: G('Overlays'), height: 287,
    readme: `# ShopDialog

The storefront's modal dialog: a native \`<dialog>\` with a title, a round close button and a padded body.

- \`surface\` with a \`line\` edge, 8px corners, \`shop-shadow-lg\`, up to 520px wide (wider variants: list 600px, follow 560px, title 900px); the backdrop is 80% black.
- Head (\`.dialog__head\`): title in \`shop-type-title\` and a \`shop-tap\` (44px) round close button; keyboard focus fills it \`shop-teal\`.
- Full-screen variants, in the app: the title details sheet on a phone (ShopTitleModal) and the pickup code (\`.pickup-full\`, ShopApp), always white whatever the page, so scanners can read it; its close button is the same round \`.dialog__close\` in black, and keyboard focus inside it is black, since \`shop-teal\` is set for the page, not for white.
- While any dialog or the lightbox is open the page behind it doesn't scroll (\`html:has(dialog:modal)\`, keeping the scrollbar's space so nothing shifts), and scrolling past the end of a dialog stops there instead of moving the page.
- A finished action shows \`.confirm\`: a big \`shop-gold-text\` line in the display face and what happens next.
- Consumer provides: the title, body and the element focus returns to.`,
    html: page('ShopDialog', `
<dialog open style="position:static;margin:0 auto;max-height:none">
  <div class="dialog__head"><h2>Reserve Absolute Batman #12</h2><button class="dialog__close" type="button" aria-label="Close">×</button></div>
  <div class="dialog__body">
    <div class="confirm"><p class="confirm__big">You're all set</p><p>We'll email you when it arrives. Pick it up within 30 days.</p></div>
    <button class="btn btn--primary" type="button" style="width:100%">Done</button>
  </div>
</dialog>`),
  },
  {
    name: 'ShopChat', group: G('Overlays'), height: 614, width: 860,
    readme: `# ShopChat

The live chat: a button in the bottom-right corner opens a small chat box. It appears only when the owner has Live Chat on for the site (Shop Settings → Online) and staff have switched chat on (the switch on Admin → Chat). Rendered by \`initChat()\` in js/chat.js.

- **Button** (\`.chat-launch\`): a 56px round \`.btn--primary\` fixed to the corner at \`shop-z-chat\`, over the sticky header and the pull-list bar, under the skip link. It shows a comic word balloon (three dots, a tail) drawn in \`shop-on-primary\`, so it reads on any main color; the name \"Chat with us\" is its \`aria-label\` and \`title\`. When the shop has answered since the visitor last looked, a dot (\`.chat-launch__dot\`, \`shop-gold-text\` in a ring of \`shop-paper\`) sits on its rim and the name becomes \"Chat with us, the shop has replied\". It lifts clear of the pull-list bar (\`body.has-list-bar\`).
- **Box** (\`.chat\`): \`surface\` with a \`line\` edge, \`shop-radius-lg\`, \`shop-shadow-lg\`, 380px wide and at most 600px tall. Under 480px it is a sheet pinned to the bottom of the screen.
- **Head** (\`.chat__head\`): the title in \`shop-type-compact\` and a labelled **Close** (\`.btn--ghost .btn--small\`, 44px tall on phones). Escape closes it too, and focus goes back to where the visitor opened it.
- **Start form** (\`.chat__form\`): the ordinary storefront fields (name, optional email, message), a hidden honeypot and a \`.btn--primary\` "Start chat". Errors use \`.form-error\`.
- **Conversation** (\`.chat__log\`, \`role="log"\`): the visitor's messages sit on the right on \`shop-red-btn\` with \`shop-on-primary\` text (\`.chat__msg--mine\`); the shop's sit on the left on \`raised\` and may contain links. Each has a small time (\`.chat__time\`). Enter sends on screens 600px and wider; a phone's Return key adds a line.
- **Hide this button** (\`.chat__hide\`): a link-style button in the foot (\`shop-teal\`, 44px tall). It hides the floating button in that browser. The footer's "Chat with us" link (\`a[href="#chat"]\`) opens the chat whether the button shows or not, so there is always a way back.
- The balloon and the visitor's bubbles follow their fill (\`shop-on-primary\`); everything else follows the page, so the chat reads on any colors a shop picks.
- Consumer provides: shop settings (\`chat_available\` and \`chat_enabled\`, both needed, through \`chatOn()\` in js/util.js; \`chat_greeting\`; the shop name). Staff answer from Admin → Chat (AdminChat).`,
    html: page('ShopChat', `
<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
<section class="chat" aria-label="Chat with Pop's Comics" style="position:static;max-height:none">
  <div class="chat__head">
    <h2 class="chat__title">Chat with Pop's Comics</h2>
    <button class="btn btn--ghost btn--small" type="button">Close</button>
  </div>
  <div class="chat__body">
    <form class="chat__form" novalidate>
      <p class="chat__note">Ask us anything. We’ll reply right here. If we’re busy in the shop it can take a few minutes.</p>
      <div class="field"><label for="pw-chat-name">Your name</label><input id="pw-chat-name" name="name"></div>
      <div class="field"><label for="pw-chat-email">Email (optional)</label><input id="pw-chat-email" name="email" type="email"><p class="field__hint">So we can reach you if you close this page.</p></div>
      <div class="field"><label for="pw-chat-first">Message</label><textarea id="pw-chat-first" name="body" rows="2"></textarea></div>
      <button class="btn btn--primary" type="submit">Start chat</button>
    </form>
  </div>
  <p class="chat__foot"><button class="chat__hide" type="button">Hide this button</button><span>Find it again in the page footer.</span></p>
</section>
<div>
<section class="chat" aria-label="Chat with Pop's Comics" style="position:static;max-height:none">
  <div class="chat__head">
    <h2 class="chat__title">Chat with Pop's Comics</h2>
    <button class="btn btn--ghost btn--small" type="button">Close</button>
  </div>
  <div class="chat__body">
    <div class="chat__log" role="log" aria-label="Chat messages" tabindex="0">
      <div class="chat__msg chat__msg--mine"><p>Hi! Is the new Absolute Batman #12 in yet?</p><span class="chat__time">9:12 AM</span></div>
      <div class="chat__msg"><p>It comes in Wednesday. Want us to add it to your pull list?</p><span class="chat__time">Shop · 9:14 AM</span></div>
    </div>
    <form class="chat__send">
      <label class="visually-hidden" for="pw-chat-reply">Your message</label>
      <textarea id="pw-chat-reply" rows="2"></textarea>
      <button class="btn btn--primary" type="submit">Send</button>
    </form>
  </div>
  <p class="chat__foot"><button class="chat__hide" type="button">Hide this button</button><span>Find it again in the page footer.</span></p>
</section>
<p style="margin-top:16px"><button class="btn btn--primary chat-launch" type="button" style="position:relative;right:auto;bottom:auto" aria-label="Chat with us, the shop has replied" title="Chat with us, the shop has replied"><svg class="chat-launch__icon" viewBox="0 0 307 246" aria-hidden="true" focusable="false"><path d="M47.5 179.4A153.4 103.8 0 1 1 100.2 201.4L27 246L20 244zM88.3 103.9a14.5 14.5 0 1 0 29 0a14.5 14.5 0 1 0-29 0zM138.3 103.9a14.5 14.5 0 1 0 29 0a14.5 14.5 0 1 0-29 0zM188.3 103.9a14.5 14.5 0 1 0 29 0a14.5 14.5 0 1 0-29 0z"/></svg><span class="chat-launch__dot"></span></button></p>
</div>
</div>`),
  },
  {
    name: 'ShopAccount', group: G('Account'), height: 436,
    readme: `# ShopAccount

The customer's pull list on My Pull List: grouped lines with a cover, title, quantity and status, and a running total.

- Groups (\`.account-group\`: Ready for pickup, Coming up, Past) in \`shop-type-h3\` with a \`line\` underline; empty groups hide.
- A line (\`.account-line\`): 56px cover, title and variant, quantity, then the status on the right: \`shop-ok\` for arrived, \`shop-gold-text\` for not ordered yet. A title a follow added since the last visit gets a gold left edge, a faint gold wash and a New badge.
- \`.account-summary\`: a \`raised\` box of totals with the total line bold over a rule.
- Saved changes show \`.account-saved\` in \`shop-ok\`.
- On the website, Coming Up fills the wide column; the narrow one holds the terms callout, then **Following**, **My Profile**, **Export my comics** (once something has been picked up) and **Delete my account**. All four are \`.account-fold\` panels: a \`<details class="panel">\` whose \`<summary>\` holds the \`h2\`, with the chevron on the right; Following starts open, the others closed. The app keeps them as titled panels.
- **Export my comics**: a ghost **Download spreadsheet (CSV)** button and short import steps for collection apps, under My Profile.
- **Delete my account** (its own panel after My Profile, on the website and in the app's Account view; the app stores require it): a paragraph saying what goes (sign-in on every device, following, notifications, titles not yet ordered), a \`field__hint\` saying what the shop keeps (name and contact details, books already ordered or waiting; signing in again with the same email reopens the account), then a ghost **Delete my account** button. It asks first; done, the sign-in form shows with a \`.notice\` (\`.account-deleted\`) saying the account is deleted, focused so a screen reader reads it.
- Consumer provides: the customer's lines. Built by js/pages/account.js.`,
    html: page('ShopAccount', `
<h2 class="account-group">Ready for pickup</h2>
<ul class="account-lines">
  <li class="account-line"><div class="cover cover--placeholder" aria-hidden="true"></div><div class="account-line__info"><strong>Saga #70</strong><span class="card__meta">Image Comics · Out Oct 21</span></div><span class="account-line__qty">× 1</span><span class="account-line__status account-line__status--arrived">Arrived</span></li>
  <li class="account-line account-line--new"><div class="cover cover--placeholder" aria-hidden="true"></div><div class="account-line__info"><span class="new-badge">New</span><strong>Absolute Batman #12</strong><span class="card__variant">Cover B Jock</span></div><span class="account-line__qty">× 2</span><span class="account-line__status account-line__status--not_ordered">Not ordered yet</span></li>
</ul>
<div class="account-summary" style="margin-top:16px"><dl class="account-summary__totals"><div><dt>Ready now</dt><dd>$3.99</dd></div><div class="account-summary__total"><dt>Total</dt><dd>$13.97</dd></div></dl></div>`),
  },
  {
    name: 'ShopApp', group: G('Account'), height: 424, width: 375,
    readme: `# ShopApp

The shop's installable pull list app (app.html, at /app; app.<shop domain> forwards there): the account page as one view at a time, under the shop's own brand.

- **Signed in only** (\`.app-locked\` on the body): until the customer is signed in and has finished a first sign-in, the app is the shop's brand on top, the Sign in (or Welcome, let's finish your account) form and "Powered by Pullwise" under it. No tab bar, search, Hot, Shop or Appearance; the install strip still shows. A link to a tab (\`#hot\`, a notification) opens that tab once they're signed in.
- \`.app-bar\`: the shop's logo and/or name (the header's \`.brand\`, logo up to 40px) and, on the right, a \`shop-tap\` (44px) round search button (\`.app-bar__search\`, a 24px line magnifier in \`ink\`; \`surface\` with a \`gold-text\` icon while the search is open). No menu; the website is linked from the Shop tab. The header clears the phone's notch.
- \`.tab-bar\`: fixed to the foot, \`surface\` with a \`line\` top edge, four equal tabs (My List, Hot with a flame, Shop, Account): a 24px line icon over a \`fs-2xs\` bold label in \`muted\`. The current tab (\`aria-current="page"\`) is \`ink\` with a 3px \`gold\` edge on top and a \`gold-text\` icon. \`.tab-bar__count\` is a gold pill with the number ready for pickup.
- Tabs behave like a native tab bar: each keeps its own scroll position; tapping the tab already showing puts away the search and scrolls it to the top; switching replaces the address (\`#hot\`) rather than adding to the history, so the back button leaves the app instead of stepping back through tabs. The views cross-fade (View Transitions, \`dur\`) while the header and tab bar stay still; under reduced motion they switch at once. The shop's name in the header goes to My List the same way.
- Taps: no grey tap flash and no text selection or image menu from a long press on the app's chrome; each control shows its own press instead: a tab's icon shrinks a little, a \`.btn\` scales to 97% and darkens, a link-button fades, a cover darkens, and round icon buttons (search, Remove, close, the Shop tab's links) take a \`raised\` fill.
- Loading: a view still loading is a 240px \`raised\` block pulsing like the website's skeletons (still at rest under reduced motion; screen readers hear "Loading…"), not the website's dimmer and spinner.
- Back to the front after 5 minutes or more away, online and signed in, the app fetches My List (and Hot, if it was opened) again by itself and keeps its scroll position. It waits if a search, a title, or a half-typed field is open.
- \`.app-pull\`: pull down to refresh. Pulling from the top drops a 40px round \`surface\` badge from under the header, its circular arrow turning with the pull and going \`gold-text\` once letting go will refresh; it spins (slower under reduced motion) while the signed-in views are drawn again in place. The Shop tab, or a signed-out app, reloads instead. A screen reader hears "Refreshing…" then "Updated."
- View titles sit above their panels (\`.app-view__title\`, \`fs-title\`), never inside: \`.app-section\` is a title then a \`.panel\`, 32px apart when a view has several (Account: Notifications, My Profile, then Appearance).
- Loading screen (\`.app-splash\`): while the first view loads, the shop's logo and name sit centred on the page colour (the Worker fills both from Settings); it fades out once nothing is loading, after 3 seconds at most, and is then removed. Hidden from screen readers.
- Search (\`.app-search\`): the header's search button slides a full-width search box down from behind the header (\`dur-slide\`, none under reduced motion) over the page wherever it's scrolled, and puts the cursor in it; the page doesn't move. The box is a \`paper\` band fixed under the header, with a \`line\` edge and \`shadow-menu\` below. Results start at the top, under the box; closing the search goes back to where the tab was scrolled. While it has words in it, signed-in customers first see matching series and artists to follow (the Series and Artists & writers lists with their Follow buttons, as on the website's account page), then the website's title search (titles that can still be ordered first) stands in for the tab as a two-across \`.grid\` of cards with a count and Show more. The button again, Escape or any tab puts it away and brings the tab back.
- Hot (\`.app-shelf\`): **Top 10 Order Cutoff Soon** (the ten most pulled titles whose order cutoff is in the next two weeks) and **Top 10 New Arrivals** (the ten most pulled of the newest books), ranked by \`rank_by_pulls\`; titles nobody has pulled fill in by date. Each row is an \`fs-sub\` heading with a See all link-button, a \`muted\` lede, then \`.app-shelf__row\`: the website's cards in one row that swipes sideways, snapping card by card, about two and a half cards wide (each up to 200px) and running to the screen's edges. The cards are shorter than the website's: an 8px body, the title in \`fs-ui\` and at most two lines, meta in \`fs-xs\`, the cutoff without its date in brackets, and the button label in \`fs-2xs\` on one line. See all opens the search's results (search box empty above them) with every open pre-order, soonest order cutoff first, or every title in the shop, new arrivals first, with Show more. Above the titles, the website's \`.filters\` box (ShopFilters): Order cutoff, Publisher and Category for pre-orders; Publisher and Category for the shop. Typing a search replaces the list and its filters, and closing goes back to Hot.
- \`.app-note\`: a \`surface\` strip under the header, like \`.app-install\`: "You’re offline. Showing your list from Sat 4:09 PM." (the last copy of the list, read-only with its controls left out, \`.account-saved-list\`), or "A new version of the app is ready" with a primary Update button.
- The app's icon shows the number of books ready for pickup (set when the list loads and by the ready-for-pickup notification); long-pressing it on Android offers My List, Hot and Shop, each with the tab bar's icon (\`/icons/shortcut-*.png\`). A shortcut, a notification or a link into the app while it's open brings that window forward (\`launch_handler\` \`navigate-existing\`) instead of opening a second one. A notification about one title opens its details.
- Home Screen icon and install sheet: the shop can upload an app icon (Shop Settings → Pull List App, 512 × 512, a solid square with the logo in its middle 60%), used as Android's maskable icon and the iPhone's icon; without one the tab icon or logo is used. Up to four screenshots (1080 × 2340) turn Android's install offer into a full sheet showing the app.
- \`.app-install\`: a \`surface\` strip under the header offering Add to Home Screen (an Install button, or Share directions on an iPhone) with a ✕ to dismiss.
- Welcome (\`.app-welcome\`): at the top of Coming Up until **Got it** (remembered on the phone): three numbered steps (follow, titles land on the list by themselves, turn on notifications, with a small primary **Turn on notifications** button when this device can), then **Follow a series** (primary, opens the search) and **Got it** (ghost).
- Asking for notifications (js/app-push-prompts.js; only when this device could turn them on right now). \`.push-nudge\`: after an add or a follow, a \`surface\` card with \`shadow-lg\` slides up (\`sheet-up\`, none under reduced motion) just above the tab bar, up to 480px wide: "Want a heads-up when **Saga #70** is ready for pickup?" (a follow: "…when new **Saga** issues arrive?") with small **Turn on** (primary) and **Not now** (ghost). Once per app open; Not now waits 14 days. \`.push-banner\`: the same offer at the top of My List once the welcome is dismissed, like \`.app-install\` with a ✕ that waits 30 days; never alongside the card. Turn on brings up the phone's own permission box; once on, "Notifications are on. Change which ones on the Account tab." shows in the card for 4 seconds. If the phone's box is declined, every prompt goes.
- Following (\`.app-follows\`): a \`raised\` fold at the top of Coming Up (under the welcome), closed by default: **Following** with the counts on the right in \`muted\` ("3 series · 1 artist", or "Nothing yet"). Open, it holds the how-following-works hint and each follow with All covers, copies of each issue and Unfollow. There is no Following tab; following more starts from the search.
- Full-screen pickup code (\`.pickup-full\`, js/app-pickup.js): tapping the QR code on My List fills the screen with it, dark on white whatever the page, up to 420px, with the name, **#number** in the display face and "Show this at the counter · tap to close". The screen is kept awake while it shows (Screen Wake Lock; taken again on return to the app). A tap anywhere, the ✕, Escape or Back closes it.
- Sticky date headings: My List's group headings (\`.account-group\`) stay pinned under the header on a band of their container's color (\`surface\` in My List's panel, else \`paper\`) while their titles scroll under them; the next slides over it. The app keeps scroll padding for the header, a pinned heading and the tab bar, so keyboard focus never lands under them.
- Covers fade in (\`dur-slide\`) as they load, over a \`raised\` placeholder of their own shape, instead of popping in.
- Opening the app again puts you back on the tab you left (unless a link, notification or shortcut names one) and, within the hour, where each tab was scrolled. Kept on the phone only.
- Pickup code (\`.app-pickup\`): under the "Ready for pickup" heading, a \`surface\` box led by the customer's name, last name first ("Smith, Jane", as shops file held books), then a 112px QR code, always dark on white, and **#<customer number>** in the display face. Staff scan it with a phone (it opens the customer in the admin) or type "#1042" into Customers.
- My List lines (\`.account-line--app\`): a 116px cover on the left; beside it the title across the rest of the line, then variant, details and status (none while it's simply on the list), then **Qty** with the number field and a 44px trash-icon Remove (\`.account-line__remove\`, \`shop-error\` on hover, labelled "Remove <title>"). Cover and title open the title details dialog (ShopTitleModal), a full-screen sheet on a phone with Close below the status bar and only the body scrolling.
- Swipe to remove (\`.account-line__swipe\`, js/app-swipe.js): a My List row that can still be changed slides left under the finger over a \`swipe-remove\` red Remove growing from its right edge. Let go after a short swipe and 88px of Remove stays to tap; past half the row's width it asks on release (the label centres to say so). Either way the row holds open on its Remove while the customer confirms "Remove <title> from your pull list?"; Cancel puts it back. Then both press the row's own trash button, so removing behaves the same and keyboard and screen reader users keep that button; the swipe's button is hidden from them. A vertical drag still scrolls; a touch elsewhere or a tap on the row closes an open one. Not on the offline copy.
- Changes show at once (optimistic), for signed-in customers in the app and on the website: Add to pull list turns to "On your list", counts move, and a removed My List line disappears before the shop's database answers. If it says no (or there's no connection), the change is undone and the error shows. A title still on its way ignores a second tap.
- Haptics (Android; iPhones have none for web apps): a short buzz when a pull to refresh, a title sheet swipe or a row swipe reaches the point where letting go acts, and a slightly longer one when a title goes on the list. Only in the app, never on the website.
- \`.account-summary--fold\`: the app's totals fold away under one "Estimated total  $x" line (a show/hide box); open, it shows the discount tier, Subtotal and Discount.
- Account → Notifications: one primary "Turn on notifications" button; once on, \`.push-on\` ("✓ Notifications are on for this device", \`shop-ok\`), a tick box for each kind (books ready, new titles from follows), then \`.push-actions\`: a ghost "Send a test" and a link-style "Turn off on this device". On an iPhone outside the Home Screen app it says how to add it instead.
- Account → Appearance (\`.app-look\`, under the Account view): radio choices **Match my phone**, **Light** and **Dark**. Light and Dark keep the shop's main and accent colors on a light (\`#f6f3ee\`) or dark (\`#121212\`) page, with links, gold text and feedback colors worked out to read on it (\`schemeCss\` in js/theme-vars.js). Until someone picks, the app keeps the shop's own page, and the choice shown is whichever that page is. The pick is kept on the phone and painted before the first draw; the status bar follows it.
- Account → Delete my account: as on the website (ShopAccount), after My Profile.
- \`.app-powered\`: the last line of the Account view, under Appearance (signed out, under the sign-in form): "Powered by Pullwise", centred, \`shop-fs-xs\` in muted, 32px above. Plain text, not a link; the app's one mention of Pullwise, which never shows on the other tabs.
- \`.app-shop\`: the Shop view, centred: logo, name in the headline font, tagline, then each location as an \`.app-shop__place\` set off by a \`line\` rule (name, Call and Directions buttons, address, hours), the email and socials below another rule, then \`.app-shop__links\` to the website two to a row.
- Consumer provides: the shop's settings and the signed-in customer. Built by js/pages/app.js and js/pages/account.js (views in \`[data-view]\`).`,
    html: page('ShopApp', `
<div class="app-bar" style="border-bottom:1px solid var(--line)"><a class="brand" href="#"><span class="brand__name">Your Comic Shop</span></a><button class="app-bar__search" type="button" aria-label="Search titles" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></button></div>
<div class="app-install" style="padding-inline:12px"><p class="app-install__text"><strong>Add Your Comic Shop to your Home Screen</strong> for one-tap access to your pull list.</p><button class="btn btn--primary" type="button">Install</button><button class="app-install__close" type="button" aria-label="Not now">✕</button></div>
<div class="app-shop panel" style="margin-top:16px"><p class="app-shop__name">Your Comic Shop</p><p class="app-shop__tagline">Comics, collectibles &amp; more</p></div>
<nav class="tab-bar" aria-label="App" style="position:static;margin-top:16px"><ul>
  <li><a href="#" aria-current="page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg><span>My List</span><span class="tab-bar__count">3</span></a></li>
  <li><a href="#"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.6 3.2 5.5 5.6 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.3 1.1-4 2.4-5.2.1 1.7.9 2.9 2.2 3.4-.4-3 .1-5.9.9-8.7z"/></svg><span>Hot</span></a></li>
  <li><a href="#"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v10h16V10"/><path d="M3 10l2-6h14l2 6z"/><path d="M10 20v-5h4v5"/></svg><span>Shop</span></a></li>
  <li><a href="#"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg><span>Account</span></a></li>
</ul></nav>`),
  },
  {
    name: 'ShopFollow', group: G('Account'), height: 348,
    readme: `# ShopFollow

Follow a series or a creator from a title: choices as large toggle buttons in a dialog, so new issues land on the customer's list.

- On a card, \`.follow-open\` is a text button in \`shop-teal\` ("+ Follow series / artist"); once following it turns muted ("✓ Following this series").
- \`.follow-choice\`: a 52px block with a bold label and a muted hint, \`shop-paper\` fill and \`field-line\` edge; chosen (\`.is-on\`, \`aria-pressed="true"\`) it fills \`shop-gold\` with \`shop-on-accent\` text and a ✓. Two per row from 480px.
- People get a small gold role tag (\`.follow-person__tag\`: Writer, Artist, Cover).
- The status line (\`.follow-dialog__status\`) confirms in \`shop-ok\`; the footer sticks to the bottom of the dialog.
- Consumer provides: the title, its series and creators. Built by js/components.js.`,
    html: page('ShopFollow', `
<div class="follow-dialog" style="max-width:560px">
  <p class="follow-dialog__for">Absolute Batman #12 · Cover B Jock</p>
  <div class="follow-group"><h3>Series</h3><div class="follow-choices"><button class="follow-choice is-on" type="button" aria-pressed="true"><span class="follow-choice__label">✓ Every issue</span><span class="follow-choice__hint">The main cover of each new issue</span></button><button class="follow-choice" type="button" aria-pressed="false"><span class="follow-choice__label">Every cover</span><span class="follow-choice__hint">All variant covers too</span></button></div></div>
  <div class="follow-group"><div class="follow-person"><strong>Jock</strong> <span class="follow-person__tag">Cover</span><div class="follow-choices"><button class="follow-choice" type="button" aria-pressed="false"><span class="follow-choice__label">Covers by Jock</span><span class="follow-choice__hint">Any series</span></button></div></div></div>
  <p class="follow-dialog__status" role="status">Following Absolute Batman.</p>
</div>`),
  },
  {
    name: 'ShopGallery', group: G('Content'), height: 430, width: 960,
    readme: `# ShopGallery

A picture gallery from the page editor's Gallery button: a grid of square pictures that open larger in a lightbox.

- \`.gallery\`: two columns on phones, three from 600px, four from 800px, \`shop-sp-12\` apart. Each \`figure\` has a link (\`a[data-lightbox]\`) around a square, cropped picture with \`shop-radius\` corners and an optional \`figcaption\` in muted text.
- **Hover and keyboard focus:** a soft dark tint with a small magnifier fades in and the picture eases in 5%. Only on pointer devices (a tap leaves nothing stuck); with reduced motion the tint shows instantly and the picture does not zoom.
- **Lightbox** (\`.lightbox\`, a dialog): the picture on black with the caption over its bottom edge on a dark fade (\`.lightbox__bar\`), a round Close button top right and round previous/next buttons (\`.lightbox__nav\`) at the vertical middle of each side. ← → step through the gallery and wrap around, Escape or a click outside closes. The arrows only show when the gallery has more than one picture.
- Every picture has a description (alt text); staff must write one.
- Consumer provides: the pictures, descriptions and captions (from the page text).`,
    html: page('ShopGallery', `
<div class="gallery">
  <figure><a href="#" data-lightbox><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" alt="Opening day" loading="lazy"></a><figcaption>Opening day</figcaption></figure>
  <figure><a href="#" data-lightbox><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" alt="New shelves" loading="lazy"></a><figcaption>New shelves</figcaption></figure>
  <figure><a href="#" data-lightbox><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" alt="Staff picks wall" loading="lazy"></a><figcaption>Staff picks wall</figcaption></figure>
  <figure><a href="#" data-lightbox><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" alt="Halloween costumes" loading="lazy"></a><figcaption>Halloween costumes</figcaption></figure>
</div>
<p class="card__meta" style="margin:16px 0 8px">The lightbox, open on the second picture:</p>
<div class="lightbox" style="position:relative;display:inline-block;max-width:420px"><button class="lightbox__close" type="button" aria-label="Close">✕</button><img alt="New shelves" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" style="width:420px;height:280px"><button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous picture">‹</button><button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Next picture">›</button><div class="lightbox__bar"><p class="lightbox__caption">New shelves</p></div></div>`),
  },
  {
    name: 'ShopColumns', group: G('Content'), height: 200, width: 960,
    readme: `# ShopColumns

Rows of side-by-side text and pictures from the page editor's Columns button.

- \`.cols\` with a layout class and a \`.col\` per column. On phones the columns stack, first on top. From 600px two-column rows sit side by side (\`cols--2\`, \`cols--4\` as two, \`cols--1-2\` narrow then wide, \`cols--2-1\` wide then narrow); \`cols--3\` goes three across from 700px and \`cols--4\` four from 800px.
- \`shop-sp-16\` between stacked columns, \`shop-sp-24\` between side-by-side ones. Text keeps the page's text styles; pictures scale down to their column (\`max-width: 100%\`) and can carry a link.
- The first and last child of a column have no outer margin, so columns line up at the top and bottom.
- Consumer provides: the layout and each column's text and pictures.`,
    html: page('ShopColumns', `
<div class="cols cols--1-2"><div class="col"><h3>Hours</h3><p>Mon–Sat 10–7<br>Sun 12–5</p></div><div class="col"><h3>Pull list pickup</h3><p>Come in any time after your books arrive and pay at the counter. We hold your books for 30 days.</p></div></div>
<div class="cols cols--3"><div class="col"><p>Comics</p></div><div class="col"><p>Toys</p></div><div class="col"><p>Games</p></div></div>`),
  },
  {
    name: 'ShopPostList', group: G('Content'), height: 233,
    readme: `# ShopPostList

News posts and search results as simple stacked lists.

- \`.post-list\`: a date in muted (.85rem), the title in \`shop-type-title\` as a link that underlines on hover, then a summary. 16px between posts; the home page's version is tighter with smaller titles.
- \`.search-hits\`: each hit a \`surface\` box with a \`line\` edge; matched words are marked in \`shop-gold\` with \`shop-on-accent\` text.
- Consumer provides: the posts or hits.`,
    html: page('ShopPostList', `
<ul class="post-list">
  <li><time datetime="2026-10-20">Oct 20, 2026</time><h3 class="post-list__title"><a href="#">Halloween ComicFest is on</a></h3><p>Free books for costumes, all day Saturday.</p></li>
</ul>
<ul class="search-hits" style="margin-top:16px"><li><a href="#"><strong>FAQ</strong></a><p>How long do you hold my <mark>pull list</mark> books?</p></li></ul>`),
  },
  {
    name: 'ShopEmpty', group: G('Feedback'), height: 153,
    readme: `# ShopEmpty

Empty results, and the placeholders that hold a list's space while it loads.

- \`.empty\`: a dashed 2px box with centered muted text that says what is missing and, where it helps, what to try ("No titles match. Clear a filter to see more.").
- While a grid has no cards yet it shows one pulsing \`raised\` block about a screen tall, so the page below doesn't jump (still with reduced motion).
- While anything loads (\`aria-busy="true"\` or \`.loading\`) the page dims and a 28px spinner sits in the middle; clicks pass through.
- The dashed edge is \`line\`, so it follows the page.`,
    html: page('ShopEmpty', `<p class="empty">No titles match. Clear a filter to see more.</p>`),
  },
];

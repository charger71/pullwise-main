// Staff admin components. Preview markup is lifted verbatim from admin/style-guide.html (the repo's own reference);
// styles are admin/base.css + admin/admin.css under .pw-admin in bundle.css.
import { readFileSync } from 'node:fs';
import { REPO } from './config.mjs';

const guide = readFileSync(`${REPO}admin/style-guide.html`, 'utf8');
const tabSrc = readFileSync(`${REPO}admin/tab-icons.js`, 'utf8');
const TAB = Object.fromEntries([...tabSrc.matchAll(/^  (\w+): '([^']+)',$/gm)].map((m) => [m[1], m[2]]));

/** The inner markup of the .sg-demo after the <h3> whose text contains `title`. */
function demo(title) {
  const h = guide.indexOf(`${title}</h3>`);
  if (h < 0) throw new Error(`style guide item not found: ${title}`);
  const start = guide.indexOf('<div class="sg-demo', h);
  const open = guide.indexOf('>', start) + 1;
  let i = open, depth = 1;
  while (depth) {
    const o = guide.indexOf('<div', i), c = guide.indexOf('</div>', i);
    if (o !== -1 && o < c) { depth++; i = o + 4; } else { depth--; i = c + 6; }
  }
  return guide.slice(open, i - 6)
    .replace(/\bsg-row\b/g, 'pw-row')
    .replace(/class="sg-dialog"/g, 'class="pw-dialog"')
    .replace(/ data-sg-stack/g, '')
    .replace(/\n {14}/g, '\n')
    .trim();
}

const G = (g) => `Admin · ${g}`;
const page = (title, body, cls = 'pw-admin pw-pad') => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} — preview</title></head>
<body>
<div class="${cls}">
${body.trim()}
</div>
</body>
</html>
`;
const h = (t) => `<p class="admin-hint" style="margin:16px 0 8px">${t}</p>`;
const tab = (label, icon, selected, badge) => `<button type="button" class="admin-tab" role="tab" aria-selected="${selected}" title="${label}" data-iconed="1"${selected ? '' : ' tabindex="-1"'}><svg class="admin-tab__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TAB[icon]}</svg><span class="admin-tab__label">${label}</span>${badge ? ` <span class="admin-tab__badge">${badge}</span>` : ''}</button>`;

/** A `cards` table as admin.js leaves it on a phone: .is-stack, and each column heading copied onto its cells. */
function stacked(html) {
  const heads = [...html.match(/<thead>[\s\S]*?<\/thead>/)[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => (/visually-hidden/.test(m[1]) ? '' : m[1].replace(/<[^>]+>/g, '').trim()));
  return html
    .replace('class="admin-table cards"', 'class="admin-table cards is-stack"')
    .replace(/<tr([^>]*)>([\s\S]*?)<\/tr>/g, (all, attrs, inner) => (/<th/.test(inner) ? all : `<tr${attrs}>${inner.replace(/<td/g, (() => { let n = 0; return () => `<td data-label="${heads[n++] ?? ''}"`; })())}</tr>`));
}

export const ADMIN = [
  {
    name: 'AdminHeader', group: G('Layout'), height: 159, width: 960,
    readme: `# AdminHeader

The staff admin's sticky top bar and the title row that opens each screen.

- \`.admin-header\`: \`admin-header-bg\` with \`admin-header-fg\` text, \`admin-header-h\` (60px) tall, \`admin-z-header\`. The shop name (\`.brand__name\`) is \`admin-brand-accent\` in the display face; the signed-in email and a small ghost Sign out button sit on the right (the email hides below 600px).
- Things that stick under it use \`top: var(--header-h)\`.
- **Title row** (\`.admin-title-row\`): the page title (\`admin-type-h1\`, or \`admin-type-page\` inside a section) with its actions on the right, wrapping under it on phones.
- Consumer provides: the shop name, the staff member's email, and the page title and actions.`,
    html: page('AdminHeader', `
<header class="admin-header"><div class="container admin-header__bar"><a class="brand" href="#"><span class="brand__name">Galaxy Comics</span></a><div class="admin-header__user"><span id="admin-email">dana@galaxycomics.example</span><button class="btn btn--ghost btn--small" type="button">Sign out</button></div></div></header>
<div class="container" style="padding-top:20px">
${demo('Page title row')}
</div>`, 'pw-admin'),
  },
  {
    name: 'AdminButton', group: G('Actions'), height: 313, width: 960,
    readme: `# AdminButton

Admin buttons: one primary action per screen area, a fixed minimum width so pairs and pagers match, and big tap targets on phones.

- **Variants:** \`.btn--primary\` (\`admin-brand-primary\`, white text) for the main action; default \`.btn\` (\`admin-brand-accent\`, \`admin-on-accent\` text); \`.btn--ghost\` (\`admin-surface\` with an \`admin-field-line\` edge) for Cancel and secondary actions; \`.btn--green\` (\`admin-success\`) for "Mark ordered"-type progress; \`.btn--blue\` (\`admin-info\`); \`.btn--danger\` (\`admin-danger\`) with the trash icon for Delete. Disabled fades to 55%.
- **Small** (\`.btn--small\`, 36px, \`admin-fs-ui\`): inside tables, toolbars and card headers. On phones every button is at least \`admin-tap-btn\` (48px) and small ones \`admin-tap\` (44px).
- **Width:** at least \`admin-btn-w\` (8.5rem), small \`admin-btn-w-sm\` (7rem). A place that wants buttons to shrink to their label joins the "Natural-width buttons" list in admin.css.
- **Add and remove:** outside a table, icon plus word (\`.btn--add\`, \`.btn--danger\` with an **Admin action icons** glyph); inside a table row, icon only (\`.icon-btn\` 36px, \`.icon-btn--add\` green, \`.icon-btn--remove\` red) with \`aria-label\` and \`title\`.
- \`.admin-link-button\` is an action that reads as a link.
- Use \`<button type="button">\` for actions and \`<a class="btn">\` only for navigation. Never put an email address in a list as a link: use the small Email button.`,
    html: page('AdminButton', `
${demo('<h3>Variants'.slice(4))}
${h('Small')}
${demo('<h3>Small'.slice(4))}
${h('Add and remove: icon and word outside a table, icon only in a table row')}
<div class="pw-row">${demo('Add and remove outside a table: icon and word').replace(/^<div class="pw-row">|<\/div>$/g, '')}${demo('Add and remove in a table row: icon only').replace(/^<div class="pw-row">|<\/div>$/g, '')}</div>`),
  },
  {
    name: 'AdminSaveBar', group: G('Actions'), height: 211,
    readme: `# AdminSaveBar

The row that saves a form: the save button with its result beside it, pinned to the bottom of the screen on long forms.

- \`.admin-actions\`: buttons first (primary, then ghost Cancel), then \`.admin-status\` with \`role="status"\`: "Saved." in green (\`.admin-status--ok\`), or the reason it failed in \`admin-danger-ink\` (\`.admin-status--error\`, \`role="alert"\`).
- \`.sticky-actions\` keeps the bar on \`admin-paper\` at the bottom of the screen (\`admin-z-sticky\`) with the last-saved time.
- Consumer provides: the button label (a verb: "Save settings") and the status text.`,
    html: page('AdminSaveBar', `
${demo('Save row with status')}
${h('Sticky save bar (shown in place)')}
${demo('Sticky save bar')}`),
  },
  {
    name: 'AdminField', group: G('Forms'), height: 558, width: 960,
    readme: `# AdminField

Admin form fields: every control in a \`.field\` with a visible bold label, one shared height, hints under the field.

- Inputs, selects and search boxes are \`admin-field-h\` (44px) on \`admin-surface\` with an \`admin-field-line\` edge and \`admin-radius\` corners; hover darkens the edge to \`admin-ink\`; focus is the 3px \`admin-focus\` ring.
- Group fields in \`.form-grid\`; \`.form-grid--pairs\` puts short fields two to a row from 600px; \`.span-2\` (or \`.field--full\`) keeps one on the whole row.
- Required: \`<span class="req" aria-hidden="true">*</span>\` after the label and \`required\` on the field.
- Tick boxes: \`.field--check\` for one, \`.checks\` for a row of them; 18px with an \`admin-brand-primary\` accent.
- Hints: \`.field__hint\` (\`admin-type-hint\`, \`admin-muted\`). Errors: \`.form-error\` in \`admin-danger-ink\` with \`role="alert"\`.
- Use the same label text everywhere a field appears; pair \`for\`/\`id\` with \`uid('prefix')\` from lib.js.`,
    html: page('AdminField', `
${demo('Fields in a pairs grid')}
${demo('<h3>Error'.slice(4))}`),
  },
  {
    name: 'AdminDropzone', group: G('Forms'), height: 141,
    readme: `# AdminDropzone

A file picker you can also drop files on: a dashed \`admin-dropzone-bg\` box that turns \`admin-dropzone-hover\` while a file is over it.

- A \`<label class="dropzone">\` around a visually hidden file input, so a click, a tap and the keyboard all open the picker.
- Lead with the verb in bold ("**Choose spreadsheets** or drop them here").
- Consumer provides: the accepted file types and the label text.`,
    html: page('AdminDropzone', demo('Drop zone')),
  },
  {
    name: 'AdminShopLook', group: G('Forms'), height: 764, width: 960,
    readme: `# AdminShopLook

Shop Settings → Logo, Colors & Fonts: color swatches and font pickers that set the storefront's \`shop-brand-*\` tokens and font slots.

- **Colours:** \`.color-grid\` is a pairs grid of full-width color inputs, each with a hint saying where the color shows. \`.color-row\` is one swatch with an "Automatic" tick that disables it (links follow the page background unless staff override them).
- **Fonts:** \`.font-pick\` is a select of the **storefront font library** for one slot (Headlines, Sub-headings, Body text), grouped Display / Sans serif / Serif / Your own. Under it, \`.font-pick__options\`: radio rows for Size (Small / Medium / Large) and Letter spacing (Tight / Normal / Wide). "Your own font file…" shows \`.font-pick__upload\` (a .woff2/.woff behind a ghost button). Headlines get a "Headlines in capitals" tick.
- \`.font-preview\` shows the choice on the shop's own page colors, set inline with \`--pv-*\` variables.
- Only on Shop Settings; the storefront gets the same values from js/theme-vars.js \`themeCss()\`.`,
    html: page('AdminShopLook', `
${demo('<h3>Colours'.slice(4))}
${h('Font picker and preview')}
${demo('Font picker and preview')}`),
  },
  {
    name: 'AdminHoursRow', group: G('Forms'), height: 134, width: 960,
    readme: `# AdminHoursRow

One row of opening hours: day chips with a tick box inside, open and close times, and Remove.

- Days are \`.chip\` labels around tick boxes; Settings (one shop) and Locations (each location) use the same row.
- From 700px: days, Open, Close and Remove on one line (\`1fr 130px 130px auto\`); on phones the days and Remove take their own lines.
- Consumer provides: the days and times.`,
    html: page('AdminHoursRow', demo('Opening hours row')),
  },
  {
    name: 'AdminMediaGrid', group: G('Forms'), height: 207,
    readme: `# AdminMediaGrid

The media library: a grid of pictures, each with its name, size and actions.

- \`.media-grid\` of \`.media-item\`: the thumbnail on \`admin-media-bg\`, \`.media-item__name\` (meta text), then small Copy link (ghost) and Delete (danger) buttons.
- The image picker (\`imageField\` with \`library: true\`) uses the same grid with \`.media-pick\`: bigger thumbnails, each one a button.
- Consumer provides: the files (url, name, size).`,
    html: page('AdminMediaGrid', demo('Picture list (Media)')),
  },
  {
    name: 'AdminTabs', group: G('Navigation'), height: 107, width: 960,
    readme: `# AdminTabs

A row of tabs that switches the view inside a screen, each with an icon in front of its label and an optional count badge.

- \`.admin-tabs\` (\`role="tablist"\`) sits on a 3px \`admin-brand-primary\` rule. A tab (\`.admin-tab\`, \`role="tab"\`) is \`admin-tab-bg\` with \`admin-muted\` text and rounded top corners; hover \`admin-tab-hover\`; the selected tab (\`aria-selected="true"\`) fills \`admin-brand-primary\` with white text.
- Icons come from the **Admin tab icons** asset group, matched to the label by \`decorateTabs()\` in admin/tab-icons.js (or named with \`data-icon\`). Below 700px the label hides and the icon stays, with the label as a tooltip and for screen readers.
- The count badge (\`.admin-tab__badge\`) is \`admin-brand-primary\` with white text, inverting on the selected tab.
- Only the selected tab is in the Tab order; arrow keys, Home and End move between tabs (\`tabKeys\`, wired by admin.js). Set up with \`setupTabs\` from lib.js.`,
    html: page('AdminTabs', `<div class="admin-tabs" role="tablist">${tab('All customers', 'people', true)}${tab('New this week', 'sparkle', false)}${tab('Needs attention', 'alert', false, 3)}${tab('Pull list', 'bookmark', false)}</div>`),
  },
  {
    name: 'AdminChips', group: G('Navigation'), height: 86,
    readme: `# AdminChips

Quick-filter chips above a list: one tap narrows the list to a common view.

- \`.status-chips\` (\`role="group"\` with an \`aria-label\`) of \`<button class="chip" aria-pressed>\`; the pressed chip is filled.
- A chip may carry a count (\`<span data-quick-count>\`).
- The same \`.chip\` wraps tick boxes in the opening-hours row.
- Consumer provides: the chip labels and which is pressed.`,
    html: page('AdminChips', demo('Quick-filter chips')),
  },
  {
    name: 'AdminFilterBar', group: G('Navigation'), height: 360, width: 960,
    readme: `# AdminFilterBar

The search and filter row above an admin list, its result count, an optional tick option, and the pager under the list.

- \`.filters.admin-filters\` (\`role="search"\` with an \`aria-label\`): search first and wider, then selects; from 900px they share one row (\`2fr repeat(4, 1fr)\`). Fields line up along the bottom, so a button or tick box in the row needs no empty label.
- \`.results-count\` (\`role="status"\`) in \`admin-muted\` under the bar.
- \`.cust-export-opt\` is a quiet tick box that changes what a list or an export includes; on phones it takes its own row.
- \`.admin-pager\`: ghost "← Previous" and "Next →" with the range between ("1–25 of 120").`,
    html: page('AdminFilterBar', `
${demo('Filter bar')}
${demo('Tick option in a filter row')}
${demo('<h3>Pager'.slice(4))}`),
  },
  {
    name: 'AdminTable', group: G('Data'), height: 781, width: 960,
    readme: `# AdminTable

Every admin list: a striped table under the slate header band, with sortable columns and a small set of row states.

- \`.admin-table\` inside \`.admin-table-wrap\` (which scrolls sideways when it must). The header row is \`admin-fold-head-bg\` with white text; every other row is \`admin-stripe\`; hover \`admin-hover-row\`.
- Customer columns always run **Name, Phone, Email**, then the rest. Phones go through \`formatPhone()\`; emails are the small Email button, never raw addresses.
- Sortable columns put \`data-sort\` on the \`<th>\`; \`sortableTable()\` adds the buttons and arrows. \`.center\` for numbers, \`.nowrap\` for dates, phones and ids.
- **Row states** paint the \`<tr>\`, never its cells: \`tr.is-overdue\` (\`admin-danger-soft\`: overdue, failed, blocked), \`tr.is-hidden\` (muted text, faded pictures), \`tr.is-merge\` / \`tr.is-keep\` (Series merge), \`tr.is-open\` (\`admin-select-bg\`: the open order; \`aria-expanded\` goes on its View button). New states join the one row-colour block in admin.css, in priority order, without \`!important\`.
- A status changed right in a row uses \`.select--small\`, which grows to 44px on phones.
- On phones a \`cards\` table becomes AdminCardList.`,
    html: page('AdminTable', `
${demo('<h3>List table'.slice(4))}
${h('Row states')}
${demo('Row states')}
${h('Small select in a row')}
${demo('Small select (in a table row)')}`, 'pw-admin pw-pad'),
  },
  {
    name: 'AdminCardList', group: G('Data'), height: 379, width: 420,
    readme: `# AdminCardList

On phones and tablets (up to 899px) a \`cards\` table becomes a list of cards; any other table stays a table and scrolls sideways.

- Add \`cards\` to the table and name each cell's role; admin.js adds \`.is-stack\` and copies each column heading onto its cell as \`data-label\`.
- Roles: \`.card-title\` (the name, fills the first line), \`.card-action\` (a button at the end of the first line), \`.card-lead\` (a tick box before the title), \`.card-line\` (a line of its own under the title), \`.card-key\` (a figure that matters), \`.card-wide\` (a line of its own at the end: status, notes), \`.card-foot\` (buttons on a last line), \`.card-label\` (put the column heading in front: "Copies 2"). \`cards--slim\` for a narrow action column; \`card-expand\` for a row that holds content under a card.
- Reuse these roles for every new list instead of a screen-specific phone layout.`,
    html: page('AdminCardList', stacked(demo('A card list'))),
  },
  {
    name: 'AdminThumb', group: G('Data'), height: 184,
    readme: `# AdminThumb

Cover thumbnails in admin lists.

- \`.thumb\`: a cover at list size (96×144). \`.thumb--sm\`: dense lists (Dashboard → Most Reserved, Series).
- \`.thumb--fix\`: stands in when a title has no cover and links to a cover search ("Fix").
- Consumer provides: the cover url and alt text (empty when the title is in the same row).`,
    html: page('AdminThumb', demo('Cover thumbnails')),
  },
  {
    name: 'AdminPill', group: G('Status'), height: 112, width: 960,
    readme: `# AdminPill

A state as a word in a rounded, upper-case pill: one component, a tone named for its meaning, never color alone.

- \`.pill\`: \`admin-type-pill\`, \`admin-radius-pill\`, \`admin-neutral-bg\` by default (Guest order).
- Line status: \`--open\` (\`admin-pill-open\`), \`--ordered\` (\`admin-pill-ordered\`), \`--arrived\` (\`admin-brand-accent\`), \`--picked_up\` (\`admin-pill-done\`), \`--not_ordered\` (\`admin-pill-warn\`), \`--released\` / \`--cancelled\` (\`admin-pill-off\`).
- Titles and roles: \`--pre_order\`, \`--available\`, \`--low_stock\`, \`--sold_out\`, \`--sale\` (\`admin-brand-primary\`), \`--clearance\` (\`admin-pill-pink\`), \`--pull\`, \`--owner\` (crown), \`--staff\` (person), \`--super\` (shield, dark with gold text), \`--failed\` (\`admin-danger\`).
- Role pills carry a 14px **Admin action icons** glyph before the word.
- A new state reuses a tone; a pill class with no style fails consistency.test.js.`,
    html: page('AdminPill', `
${demo('Line status')}
${demo('Titles, kinds and roles')}`),
  },
  {
    name: 'AdminStatusIcon', group: G('Status'), height: 67,
    readme: `# AdminStatusIcon

Compact solid icons in list rows that appear only when something needs attention; a healthy row shows none.

- \`.cust-icon.is-solid\`: \`.is-alert\` (\`admin-alert-icon\`) means staff should act; \`.is-minor\` (\`admin-minor-icon\`) is a minor issue.
- Each has \`role="img"\`, an \`aria-label\` and a matching \`title\`.
- Never show positive states (has an account, email on) as icons.
- Icons are filled shapes: \`.is-solid\` fills every path and cuts holes with even-odd fill, so draw details as sub-paths of the same path, not strokes.`,
    html: page('AdminStatusIcon', demo('Customer issues')),
  },
  {
    name: 'AdminPanel', group: G('Containers'), height: 155,
    readme: `# AdminPanel

A plain white card for a block of content that doesn't open and close.

- \`.panel\`: \`admin-surface\`, \`admin-radius\`, \`admin-shadow\`, \`admin-sp-16\` padding. Its heading (h2) uses the bold body font at \`admin-fs-card\`, never the display face.
- Use a fold (AdminFold) instead when the block has a title band or should collapse.
- Consumer provides: the heading and content.`,
    html: page('AdminPanel', demo('<h3>Panel'.slice(4))),
  },
  {
    name: 'AdminFold', group: G('Containers'), height: 561, width: 960,
    readme: `# AdminFold

A card with a slate header band; clicking the band opens and closes it. Every header in the admin is this same band.

- \`<details class="fold">\` with \`<summary class="fold__head">\` (\`admin-fold-head-bg\`, white text, at least \`admin-tap-head\` 52px) and \`.fold__body\`. The band's corners square off at the bottom while the body shows. The chevron is added by CSS; focus uses the shared \`admin-focus\` ring.
- A note on the right of the band: \`<span class="card__meta">\`; inside the heading: \`<span class="fold__note">\`.
- \`.fold--compact\`: a tighter band for lists of folds (Place Order cutoffs: one fold per cutoff, its count in the note).
- \`.fold--static\`: always open, a \`<section>\` with a \`<div class="fold__head">\`, so it isn't a tab stop or announced as something that opens.
- **Never put a button inside a \`<summary>\`.** The main action sits at the top of the body, right aligned (\`.admin-actions\`), or beside the band outside the summary (see AdminFaqItem).`,
    html: page('AdminFold', `
${demo('Folds: open and closed, with a note on the right')}
${demo('Static fold (always open, not clickable)')}
${demo('Fold with a count and an action at the top (Place Order cutoff)')}`),
  },
  {
    name: 'AdminHintFold', group: G('Containers'), height: 105,
    readme: `# AdminHintFold

"How this works": instructions that start closed on every screen size, to save space.

- \`<details class="admin-hint-fold">\` with the help icon and "How this works" in the summary; the text is \`.admin-hint\`, lined up with the heading above it.
- Build it with \`hintFold(html)\` from lib.js; don't hand-write it.`,
    html: page('AdminHintFold', demo('(hintFold)')),
  },
  {
    name: 'AdminFaqItem', group: G('Containers'), height: 128,
    readme: `# AdminFaqItem

A reorderable fold: up and down arrows beside a fold's header band, used for FAQ questions.

- \`.faq-item\` holds \`.faq-item__move\` (two small ghost arrow buttons) and a \`.fold\`. The arrows sit over the band but outside the \`<summary>\`, so they can be reached and announced; each is described by its question (\`aria-describedby\`).
- The arrows are fixed-width icon buttons: a deliberate exception to the standard small button.`,
    html: page('AdminFaqItem', demo('Reorderable fold (FAQ)')),
  },
  {
    name: 'AdminActivityLog', group: G('Containers'), height: 174, width: 960,
    readme: `# AdminActivityLog

A striped list of dated entries: Import → Recent Runs, a customer's Changes, Staff → Change Log.

- \`.job-log\`: time first (\`.job-log__when\`), then who or what, then the detail (\`.job-log__msg\`). From 700px the three sit in columns (\`130px auto 1fr\`).
- Consumer provides: the entries, newest first.`,
    html: page('AdminActivityLog', demo('Activity log')),
  },
  {
    name: 'AdminMessage', group: G('Feedback'), height: 363,
    readme: `# AdminMessage

Inline messages, from quiet to loud: hint, status, notice, warning and the empty state.

- \`.admin-hint\`: explains something without demanding attention (\`admin-fs-ui\`, \`admin-muted\`).
- \`.admin-status\`: the result of an action, \`role="status"\`; \`--ok\` green, \`--error\` \`admin-danger-ink\` with \`role="alert"\`. Errors say what failed and how to fix it ("Not saved: the phone number is required.").
- \`.notice\`: \`admin-brand-accent\` with \`admin-on-accent\` text, bold: something staff should know before acting.
- \`.cust-warn\`: amber (\`admin-warn-text\`) heads-up inside a row or card.
- \`.empty\`: a dashed \`admin-line-dash\` box with centered muted text ("No customers match.").
- Never make a whole screen a live region.`,
    html: page('AdminMessage', `
${demo('Hints, status and notices')}
${demo('Empty state')}`),
  },
  {
    name: 'AdminToast', group: G('Feedback'), height: 85,
    readme: `# AdminToast

A short confirmation that appears bottom-right and dismisses itself.

- Call \`toast('Title marked arrived')\` or \`toast('Not saved: network error', 'error')\` from lib.js; never build one by hand.
- Sits at \`admin-z-float\`. One line, past tense for done ("Saved"), the reason for a failure.`,
    html: page('AdminToast', demo('Toasts (bottom-right, auto-dismiss)')),
  },
  {
    name: 'AdminDashboard', group: G('Dashboard'), height: 347, width: 960,
    readme: `# AdminDashboard

Dashboard tiles and fact cards: the week at a glance, each linking to the list behind it.

- \`.dash-tiles\` of \`.dash-tile\`: a label, the number in \`admin-type-stat\`, and a note saying what to do. \`.dash-tile--alert\` marks a tile that needs action (it says so in words too). Four across from 1200px, one column under 380px.
- \`.dash-card\`: a card with a title row (title and a small ghost "View all →") and \`.dash-facts\`: bold figure, then words. A zero fact (\`.is-zero\`) is muted.
- Consumer provides: the figures and their links.`,
    html: page('AdminDashboard', `
${demo('<h3>Tiles'.slice(4))}
${demo('Card with facts')}`),
  },
  {
    name: 'AdminDialog', group: G('Overlays'), height: 259,
    readme: `# AdminDialog

A modal dialog: title, round close button and a body ending in an action row.

- Open with \`openDialog(title, bodyHtml, { wide })\` from lib.js: a native \`<dialog>\` on \`admin-surface\` with \`admin-radius-xl\` corners and \`admin-shadow-lg\`, up to 520px wide (wide for tables), over a 60% black backdrop.
- Head: title in \`admin-type-title\`, a 36px round close button that fills \`admin-focus\` on keyboard focus. Body ends with \`.admin-actions\`: the verb first (Send), then Cancel.
- Shown here as a static card.`,
    html: page('AdminDialog', demo('<h3>Structure'.slice(4))),
  },
  {
    name: 'AdminRichText', group: G('Forms'), height: 0,
    readme: `# AdminRichText

The rich-text editor for page text, news, events and FAQ answers (Quill, loaded from a CDN, so it has no live preview here).

- Markup: \`<div class="editor-block"><label id="p-body-label">Text</label><p class="editor-block__hint">What this text is for, in one line.</p><div data-body></div></div>\`.
- \`makeEditor(el, 'body' | 'lede', label)\` from lib.js builds the toolbar, names its icon buttons for screen readers, ties the editor to the label and adds image, video, table and divider tools. \`'body'\` is tall (\`.editor--body\`), \`'lede'\` short (\`.editor--lede\`). Read and write with \`setHtml\` / \`getHtml\`.
- What staff write shows on the storefront under \`.prose\` / \`[data-content]\`: a quote becomes a gold callout, staff text colors map to readable storefront colors.`,
    html: null,
  },
];

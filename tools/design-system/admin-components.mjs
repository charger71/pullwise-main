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
- **Account menu** (\`.account-menu\`): the staff member's name (hidden on phones), then a circle with its first letter (\`account-menu__btn\`, \`aria-expanded\`) that opens a panel with the name and email, My account and Sign out. Escape or a click elsewhere closes it. Staff without a name show their email.
- Consumer provides: the shop name, the staff member's name and email, and the page title and actions.`,
    html: page('AdminHeader', `
<header class="admin-header"><div class="container admin-header__bar"><a class="brand" href="#"><span class="brand__name">Galaxy Comics</span></a><div class="admin-header__user"><span class="account__name">Dana Reyes</span><div class="account-menu"><button class="account-menu__btn" type="button" aria-expanded="false" aria-label="Account: Dana Reyes"><span aria-hidden="true">D</span></button></div></div></div></header>
<div class="container" style="padding-top:20px">
${demo('Page title row')}
</div>`, 'pw-admin'),
  },
  {
    name: 'AdminButton', group: G('Actions'), height: 405, width: 960,
    readme: `# AdminButton

Admin buttons: one primary action per screen area, a fixed minimum width so pairs and pagers match, and big tap targets on phones.

- **Variants:** \`.btn--primary\` (\`admin-brand-primary\`, white text) for the main action; default \`.btn\` (\`admin-brand-accent\`, \`admin-on-accent\` text); \`.btn--ghost\` (\`admin-surface\` with an \`admin-field-line\` edge) for Cancel and secondary actions; \`.btn--green\` (\`admin-success\`) for "Mark ordered"-type progress; \`.btn--blue\` (\`admin-info\`); \`.btn--danger\` (\`admin-danger\`) with the trash icon for Delete. Disabled fades to 55%.
- **Small** (\`.btn--small\`, 36px, \`admin-fs-ui\`): inside tables, toolbars and card headers. On phones every button is at least \`admin-tap-btn\` (48px) and small ones \`admin-tap\` (44px).
- **Width:** at least \`admin-btn-w\` (8.5rem), small \`admin-btn-w-sm\` (7rem). A place that wants buttons to shrink to their label joins the "Natural-width buttons" list in admin.css.
- **Add and remove:** outside a table, icon plus word (\`.btn--add\`, \`.btn--danger\` with an **Admin action icons** glyph); inside a table row, icon only (\`.icon-btn\` 36px, \`.icon-btn--add\` green, \`.icon-btn--remove\` red) with \`aria-label\` and \`title\`.
- **Tool buttons:** a ghost button that starts a job leads with a 16px **Admin action icons** glyph (\`sync\` for Sync now, \`clean\` for Clean up old titles, \`download\` for downloads). When its label changes while it runs, wrap the words in a \`span\` and change only that.
- \`.admin-link-button\` is an action that reads as a link.
- Use \`<button type="button">\` for actions and \`<a class="btn">\` only for navigation. Never put an email address in a list as a link: use the small Email button.`,
    html: page('AdminButton', `
${demo('<h3>Variants'.slice(4))}
${h('Small')}
${demo('<h3>Small'.slice(4))}
${h('Add and remove: icon and word outside a table, icon only in a table row')}
<div class="pw-row">${demo('Add and remove outside a table: icon and word').replace(/^<div class="pw-row">|<\/div>$/g, '')}${demo('Add and remove in a table row: icon only').replace(/^<div class="pw-row">|<\/div>$/g, '')}</div>
${h('Tool buttons: icon and word')}
${demo('Tool buttons: icon and word')}`),
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
    name: 'AdminField', group: G('Forms'), height: 704, width: 960,
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
    name: 'AdminSwitch', group: G('Forms'), height: 196,
    readme: `# AdminSwitch

An on/off switch for a setting that is either on or off. Build it with \`switchHtml(label, { name, checked, attrs })\` from lib.js.

- A checkbox with \`role="switch"\` and its words beside it (\`.switch\`, \`.switch__track\`, \`.switch__text\`). Off: a \`admin-stripe\` track with an \`admin-field-line\` edge and an \`admin-muted\` knob. On: the \`admin-success\` fill, an \`admin-success-ink\` edge (so the edge reads on the dark page too) and a white knob. Every pair is 3:1 or better in both themes.
- 44px tall (\`admin-tap\`), the whole label is the click target, and keyboard focus draws the ordinary 3px \`admin-focus\` ring round the track. Space flips it. The track slides in \`admin-dur\` and holds still under reduced motion.
- Change the words with the state ("Chat is on" / "Chat is off"), never leave a bare "Enabled".
- **On its own screen** a switch saves the moment it is flipped: disable it while saving, say the result in a toast, and put it back if the save fails. **Inside a settings form** it waits for Save like the other fields there.
- For "also do this" options in a list of choices, use a plain checkbox (AdminField) instead.`,
    html: page('AdminSwitch', demo('On/off switch')),
  },
  {
    name: 'AdminChoiceList', group: G('Forms'), height: 216,
    readme: `# AdminChoiceList

One question with a few answers picked by radio button, each answer a whole line: Import → Pull lists uses it for a title that needs a look (pick a series or skip it).

- A \`fieldset.choice-list\` (\`admin-surface\`, a \`--border\` edge, \`admin-radius\`) with the question as its bold \`legend\`, and one \`label.choice-list__option\` per answer, each a 44px (\`admin-tap\`) row with the radio first. A score or hint after the answer is \`card__meta\`.
- Always end with the way out ("Skip this title").
- Picking an answer saves it straight away, so there's no Save button under it; while it saves the fieldset carries \`aria-busy="true"\` and fades.
- For two or three short options side by side (Small / Medium / Large), use the radios in AdminShopLook's font picker instead.
- Consumer provides: the question, the answers and what saving one does.`,
    html: page('AdminChoiceList', demo('Choice list')),
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
    name: 'AdminHolidayRow', group: G('Forms'), height: 260, width: 960,
    readme: `# AdminHolidayRow

One holiday date under Opening Hours: Date, an optional holiday name, a "Closed all day" chip, Open and Close times, and Remove.

- Built by \`holidayEditor()\` in admin/holiday-hours.js; Settings (one shop) and Locations (each location) use the same rows.
- Ticking \`.holiday-row__closed\` (a \`.chip\` around a tick box) disables the times.
- From 1200px: one line (\`160px 1fr auto 120px 120px auto\`); below it Date sits beside the chip, then the name, Open and Close, and Remove.
- Consumer provides: the date, name and times.`,
    html: page('AdminHolidayRow', demo('Holiday hours row')),
  },
  {
    name: 'AdminMediaGrid', group: G('Forms'), height: 552,
    readme: `# AdminMediaGrid

The media library: a grid of pictures, each with its name, size and actions.

- \`.media-grid\` of \`.media-item\`: the thumbnail on \`admin-media-bg\`, \`.media-item__name\` (meta text), then small Copy link (ghost) and Delete (danger) buttons.
- The image picker (\`imageField\` with \`library: true\`) uses the same grid with \`.media-pick\`: bigger thumbnails, each one a button.
- Consumer provides: the files (url, name, size).`,
    html: page('AdminMediaGrid', demo('Picture list (Media)')),
  },
  {
    name: 'AdminMonthCalendar', group: G('Containers'), height: 330, width: 960,
    readme: `# AdminMonthCalendar

One month of events (Events → Calendar): a grid on desktop, where each event is a chip you can drag to another day; on phones only the days that have events, one under another.

- \`.admin-cal__nav\` (Prev, \`.admin-cal__title\`, Next), \`.admin-cal__today\` (This month), \`.admin-cal__weekdays\`, then \`.admin-cal__grid\` of \`.admin-cal__day\` cells.
- A cell has a \`.admin-cal__head\` (the day and an \`.icon-btn.admin-cal__add\` + that adds on that day) and \`.admin-cal__events\` of \`.admin-cal__chip\` buttons. Today's cell has a \`admin-brand-primary\` edge; the cell a chip is dragged over takes \`is-over\`.
- A cancelled item uses \`.admin-cal__chip--cancelled\` (struck through, muted). A drag is a shortcut only: the same change is possible from the item's edit screen.
- Consumer provides: the month's events.`,
    html: page('AdminMonthCalendar', demo('A month')),
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
    name: 'AdminNavBadge', group: G('Navigation'), height: 120, width: 420,
    readme: `# AdminNavBadge

A count on a menu item for work waiting on staff, shown on every screen.

- \`.admin-nav__badge\`: the same pill as the tab count (\`admin-brand-primary\` with white text), pushed to the end of the menu row. Below 900px the menu is folded away, so the menu button shows the total of every badge (\`data-nav-total\`).
- Carries hidden words for screen readers ("2 unread chats") and clears when the work is done (opening the chat reads it; opening a survey's Results reads its responses). The unread chat count also goes first in the tab title, "(2) Dashboard · Staff · …".
- Only for things someone has to answer or read, not for things that are merely new. Today: unread chats (admin/chat-alerts.js), unread survey responses (admin/survey-alerts.js) and new event signups (admin/event-alerts.js).`,
    html: page('AdminNavBadge', demo('Menu item with a count badge')),
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
- Above a \`cards\` table on a screen sits \`.list-toolbar\`: a sort select (every sortable column, up or down) and the Grid / List \`view-switch\`. Grid (900px and wider) shows each row as a bordered card (\`.is-grid\`); Titles lays its cards out like its phone cards. A loading list shows a spinner over its wrap (\`data-loading\`), and Titles' headings stay sticky under the header.\n- On phones a \`cards\` table becomes AdminCardList.`,
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
    name: 'AdminChat', group: G('Data'), height: 339, width: 960,
    readme: `# AdminChat

One live chat with a visitor, and the box to answer it. Built by admin/sections/chat.js (Admin → Chat); the storefront side is ShopChat.

- **Thread** (\`.chat-thread\`, \`role="log"\`): a \`admin-stripe\` box that scrolls past 60vh. The visitor's messages (\`.chat-msg\`) sit on the left on \`admin-surface\`; staff replies (\`.chat-msg--staff\`) sit on the right on the selected tint. Under each, \`.chat-msg__meta\` shows who and when in \`admin-muted\` at the smallest size.
- **Reply box** (\`.chat-compose\`): an ordinary \`.field\` with a label ("Reply") and a \`.btn--primary\` Send at its natural width, side by side. Ctrl or Cmd + Enter sends. Replying to a closed chat opens it again.
- **On/off**: an \`AdminSwitch\` beside the page title turns chat on or off for visitors (it starts off) and saves as soon as it is flipped. Any staff member can use it; the owner can remove the whole feature, and this screen, in Shop Settings → Online.
- **List**: chats are an \`AdminTable\` card list. Open and Closed are \`AdminTabs\` with a count of unread chats; a chat with unread messages carries a \`.pill--new\`. Closing, reopening and deleting use the ordinary buttons, and Delete asks first (AdminDialog).
- New messages appear on their own. On every other screen, admin/chat-alerts.js counts chats with unread visitor messages on the Chat menu item (AdminNavBadge) and in the tab title, and a toast with an **Open chat** link names the visitor (AdminToast). Desktop alerts and push notifications to staff devices are turned on per device from the line under the switch (admin/staff-push.js).
- Consumer provides: the messages (who sent each, and when) and the reply handler.`,
    html: page('AdminChat', `<style>.pw-admin .chat-thread{max-height:none}</style>
${demo('A chat with its reply box')}`),
  },
  {
    name: 'AdminPushCompose', group: G('Data'), height: 564, width: 960,
    readme: `# AdminPushCompose

The shop news form: staff write a notification and send it to every app user with "News from the shop" on. Built by admin/sections/notifications.js (Admin → Notifications, shops with the app only); push-notify (mode \`news\`) sends it.

- **Layout** (\`form.push-compose\`): the fields (\`.push-compose__fields\`) beside a 320px preview (\`.push-compose__side\`). Every other child spans both columns. Under 900px the preview sits under the fields.
- **Preview** (\`.push-preview\`): a phone-style notice on \`admin-surface\` with \`admin-shadow\`: the shop icon (\`.push-preview__icon\`), then the title in bold and the message (\`.push-preview__text\`), updating as staff type.
- **Fields**: Title (60 characters, prefilled with the shop name) and Message (180), each with a live count that turns \`.form-error\` past the limit. "Tapping it opens" picks the app, one of its tabs, or a page on the shop's own site.
- **Restraint**: a \`notice\` above the form asks staff to send only sales, big releases and closures, about once or twice a month. Above the button, "Reaches N devices · Last sent 3 days ago by Sam". A real send asks first (AdminDialog) and adds a \`cust-warn\` line when the shop sent one less than 3 days ago.
- **Test send**: a \`field--check\` that sends only to the sender's own app devices, with no dialog.
- Sends are listed under the form in an \`AdminTable\` card list, test sends marked with a \`.pill--info\`.
- Consumer provides: the shop name and icon, the device count, the past sends and the send handler.`,
    html: page('AdminPushCompose', demo('The send form with its notice preview')),
  },
  {
    name: 'AdminPill', group: G('Status'), height: 112, width: 960,
    readme: `# AdminPill

A state as a word in a rounded, upper-case pill: one component, a tone named for its meaning, never color alone.

- \`.pill\`: \`admin-type-pill\`, \`admin-radius-pill\`, \`admin-neutral-bg\` by default (Guest order).
- Line status: \`--open\` (\`admin-pill-open\`), \`--ordered\` (\`admin-pill-ordered\`), \`--arrived\` (\`admin-brand-accent\`), \`--picked_up\` (\`admin-pill-done\`), \`--not_ordered\` (\`admin-pill-warn\`), \`--released\` / \`--cancelled\` (\`admin-pill-off\`).
- Titles and roles: \`--pre_order\` and \`--coming_soon\` (\`--pill-open\`), \`--available\`, \`--low_stock\`, \`--sold_out\`, \`--sale\` (\`admin-brand-primary\`), \`--clearance\` (\`admin-pill-pink\`), \`--pull\`, \`--owner\` (crown), \`--staff\` (person), \`--super\` (shield, dark with gold text), \`--failed\` (\`admin-danger\`).
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
    name: 'AdminHintFold', group: G('Containers'), height: 117,
    readme: `# AdminHintFold

"How this works": a round accent help icon (\`.icon-btn--hint\`: an \`admin-brand-accent\` disc with the ? in \`admin-on-accent\`) at the end of a screen's title, with no words beside it. It opens the text in a dialog.

- Build it with \`hintFold(html)\` from lib.js (it writes a template that \`hintsInto\` moves into the title) or \`setHint(el, html)\` for a tab's own text; don't hand-write it. Inside a dialog it goes into the dialog's title.
- 28px (32px target) on desktop, 44px on phones; \`aria-label\` and \`title\` say "How this works".`,
    html: page('AdminHintFold', demo('(hintFold)')),
  },
  {
    name: 'AdminHelp', group: G('Containers'), height: 1035, width: 960,
    readme: `# AdminHelp

The Help screen's pieces: the topic list, a guide's steps, tips and screenshots, the walk-through video, and the pager. Guides are Markdown in admin/help/articles/, drawn by admin/help/markdown.js, so a guide never writes its own HTML; these are the only pieces it produces.

- **Topic list** (\`.help-topics\` of \`.help-topic\` links in a \`.panel\` per group): a grid of \`admin-raised\` cards, the title bold at \`admin-fs-md\`, the summary \`admin-muted\`. \`.help-topic__video\` is a small \`admin-brand-accent\` pill in the corner when the topic has a video.
- **Article** (\`.help-article\`, at most 72ch): \`.help-steps\` for numbered or bulleted steps; \`.help-tip\`, a callout with an \`admin-brand-accent\` edge; \`.help-shot\`, a 1280×800 screenshot with a border, \`admin-shadow\` and a caption, linked to the full-size file.
- **Video** (\`.help-video\`): a captioned MP4 with a poster and a .vtt track, no sound; the steps are always written out below it too.
- **Pager** (\`.help-pager\`): previous and next guides, stacked on phones; \`.help-open\` holds the primary button that opens the screen the guide covers.
- A screen's How this works ends with \`.help-link\`, a small ghost button to its guide, added by lib.js when admin/help/topics.js names the screen.
- Consumer provides: the article text; screenshots and videos come from tools/help-capture.`,
    html: page('AdminHelp', `
${demo('Topic list')}
${demo('An article: steps, a tip and a screenshot')}
${demo('Open the screen, and the pager')}`),
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
    name: 'AdminToast', group: G('Feedback'), height: 142,
    readme: `# AdminToast

A short confirmation that appears bottom-right and dismisses itself.

- Call \`toast('Title marked arrived')\` or \`toast('Not saved: network error', 'error')\` from lib.js; never build one by hand.
- Sits at \`admin-z-float\`. One line, past tense for done ("Saved"), the reason for a failure.
- News from another screen (a visitor's chat message) takes a link as the third argument: \`toast('New chat message from Sam', 'ok', { href, text: 'Open chat' })\` adds \`.toast__link\` (underlined, the toast's own text color) and stays up 10 seconds. A toast disappears, so what it reports must also be reachable another way (AdminNavBadge).`,
    html: page('AdminToast', demo('Toasts (bottom-right, auto-dismiss)')),
  },
  {
    name: 'AdminDashboard', group: G('Dashboard'), height: 347, width: 960,
    readme: `# AdminDashboard

Dashboard tiles and fact cards: the week at a glance, each linking to the list behind it.

- \`.dash-tiles\` of \`.dash-tile\`: a label, the number in \`admin-type-stat\`, and a note saying what to do. \`.dash-tile--alert\` marks a tile that needs action (it says so in words too). Four across from 1200px, one column under 380px.
- \`.dash-card\`: a card with a title row (title and a small ghost "View all →") and \`.dash-facts\`: bold figure, then words. A zero fact (\`.is-zero\`) is muted.
- \`.dash-grid\` holds the cards, two columns from 1200px; \`.dash-card--wide\` spans both. When heights differ a lot, wrap each column of cards in a \`.dash-stack\` so each keeps its own height.
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
    name: 'AdminGalleryEditor', group: G('Forms'), height: 280, width: 960,
    readme: `# AdminGalleryEditor

The picture gallery tool in the rich-text editor: a dialog to add, describe and order the pictures of a gallery.

- **Opens** from the editor's Gallery button, or by clicking a gallery in the text (\`openDialog\` with \`wide\`).
- \`.gallery-edit\` of \`.gallery-edit__item\`: a 64px thumbnail, then \`.gallery-edit__fields\` with two inputs: an optional **caption** (shown over the picture on the site) and a **required description** (alt text, not shown; read by screen readers and search engines). **Done** will not save until every picture has a description.
- \`.gallery-edit__move\`: ↑ ↓ small ghost buttons (the first ↑ and last ↓ are disabled) and a red remove icon button. After a move, focus follows to the arrow still enabled on that picture.
- Below the list: Upload pictures… (several at once) and Choose from Media… (the picker lets staff tap several, each \`.media-pick__btn\` showing \`aria-pressed="true"\` with an \`admin-brand-accent\` outline). A gallery holds up to 24 pictures.
- **In the editor text** a gallery is a dashed \`.gallery\` grid of small square pictures you click to edit. On the website it becomes ShopGallery.
- Consumer provides: the pictures (address, caption, description).`,
    html: page('AdminGalleryEditor', `
${demo('Gallery editor list')}
${h('In the editor text (click it to edit)')}
<div class="ql-editor"><div class="gallery"><figure><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" alt="Opening day"><figcaption>Opening day</figcaption></figure><figure><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" alt="New shelves"><figcaption>New shelves</figcaption></figure><figure><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23c8ced6'/%3E%3C/svg%3E" alt="Staff picks wall"></figure></div></div>`),
  },
  {
    name: 'AdminColumnsEditor', group: G('Forms'), height: 270, width: 960,
    readme: `# AdminColumnsEditor

The rows-and-columns tool in the rich-text editor: side-by-side text and pictures that stack on phones.

- **Opens** from the editor's Columns button, or by clicking a row in the text. The dialog has a **Layout** select (2, 3 or 4 equal columns, narrow then wide, wide then narrow) and one small editor per column (\`.editor--cell\` inside \`.cols-edit__col\`) with a lighter toolbar: text style, bold/italic/underline, link, file link, picture, video, divider, lists, alignment. Pictures in a column get the same picture bar (alignment, size, description, link).
- A row is a \`.cols\` block with a layout class (\`cols--2\`, \`cols--3\`, \`cols--4\`, \`cols--1-2\`, \`cols--2-1\`) and a \`.col\` per column. Changing to fewer columns keeps the first ones' text.
- **In the editor text** a row is a dashed grid (\`admin-field-line\` edge) with a dashed box per column; click it to edit. More rows are more Columns buttons. The website shows it as ShopColumns.
- Consumer provides: the layout and each column's text.`,
    html: page('AdminColumnsEditor', `
${demo('Columns row (editor)')}
${h('Three columns')}
<div class="ql-editor"><div class="cols cols--3"><div class="col"><p>One</p></div><div class="col"><p>Two</p></div><div class="col"><p>Three</p></div></div></div>`),
  },
  {
    name: 'AdminMenuOrder', group: G('Navigation'), height: 140, width: 960,
    readme: `# AdminMenuOrder

A short list staff put in order: the main menu and the footer links (Admin → Pages → Menu Order).

- \`.menu-order\` of \`.menu-order__item\`: a grip (\`⋮⋮\`, muted), the label in bold, and ↑ ↓ small ghost buttons that save at once. Each button is described by its row's label; the first ↑ and last ↓ are disabled, and focus follows to the arrow still enabled on a moved row.
- Rows are also \`draggable\` with the grip: while dragging, the row is half transparent (\`.is-dragging\`) and the drop target gets an \`admin-brand-accent\` outline (\`.is-over\`). Drag is only a shortcut; the buttons stay for keyboards and phones.
- A row that must stay put (My Pull List, always last in the main menu) is \`.menu-order__item--fixed\`: regular weight, muted, with a note and no buttons.
- Items not in the saved order go at the end, in their default order. There is a list for the main menu and one for the footer.
- Consumer provides: the items and the saved order.`,
    html: page('AdminMenuOrder', demo('Menu order list')),
  },
  {
    name: 'AdminRichText', group: G('Forms'), height: 0,
    readme: `# AdminRichText

The rich-text editor for page text, news, events and FAQ answers (Quill, loaded from a CDN, so it has no live preview here).

- Markup: \`<div class="editor-block"><label id="p-body-label">Text</label><p class="editor-block__hint">What this text is for, in one line.</p><div data-body></div></div>\`.
- \`makeEditor(el, 'body' | 'lede', label)\` from editor.js builds the toolbar, names its icon buttons for screen readers, ties the editor to the label and adds image, video, table and divider tools. \`'body'\` is tall (\`.editor--body\`), \`'lede'\` short (\`.editor--lede\`). Read and write with \`setHtml\` / \`getHtml\`.
- What staff write shows on the storefront under \`.prose\` / \`[data-content]\`: a quote becomes a gold callout, staff text colors map to readable storefront colors.`,
    html: null,
  },
];

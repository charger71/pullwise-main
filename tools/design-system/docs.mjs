// The brand-book sections for the storefront and the admin, and the README's new opening.
import { shopDerived } from './tokens.mjs';
import { ratio, fmt } from './css.mjs';

const d = shopDerived();
const paper = '#121212', ink = '#f4f0ea';
const row = (name, mixDesc, v, note) => `| \`${name}\` | ${mixDesc} | \`${v}\` | ${note} |`;

export const THREE_SURFACES = `## Three surfaces, one system

Pullwise ships three things that look different on purpose. Tokens, components and classes carry the surface in their name; use only the set for the surface you are building.

| Surface | Who sees it | Tokens | Components | Wrapper class |
| --- | --- | --- | --- | --- |
| **Marketing site** (pullwise brand) | Shop owners deciding to buy | no prefix: \`paper\`, \`cyan\`, \`sp-5\`… | Button, Panel, FAQ… (groups "Marketing · …") | \`pw-*\` classes |
| **Storefront** (each shop's own site) | The shop's customers | \`shop-*\` | Shop… (groups "Storefront · …") | \`.pw-shop\` |
| **Staff admin** | Shop owners and staff, every day | \`admin-*\` | Admin… (groups "Admin · …") | \`.pw-admin\` |

- The sections below this one (Brand idea through Avoid) are the Pullwise brand and the marketing site. **Storefront** and **Staff admin** each have their own section.
- The storefront wears the shop's brand, not Pullwise's: no \`cyan\` / \`magenta\` / \`yellow\`, no Pullwise logo. Its colors and fonts are the shop's settings.
- The admin is a calm work tool: one slate hue in light and dark, the shop's red and yellow as its only accents.
- \`bundle.css\` holds each app's real stylesheet under its wrapper class, so storefront and admin markup renders exactly as in the apps: wrap it in \`<div class="pw-shop">\` or \`<div class="pw-admin">\`. The **Light** theme exists for the admin; marketing and storefront tokens keep their values in it.

### Rules for every surface

- **Tokens only.** No bare hex color, font size, z-index or breakpoint where a token or an existing step covers it. A new value becomes a token first.
- **Contrast.** Text 4.5:1 on its ground in every theme (3:1 at 24px+ or bold 19px+); field edges, focus rings and meaningful icons 3:1. Each text token's note lists its pairs.
- **Focus** is always visible: a 3px solid ring (\`focus\`, \`shop-focus\`, \`admin-focus\`) on every interactive element.
- **Never color alone.** Status is a word with a color (badges, pills); icon-only controls have an \`aria-label\` and a \`title\`.
- **Touch.** Every control is at least 44px tall on phones.
- **Labels.** Every field has a visible label above it; hints go under the field, never in the placeholder.
- **Words.** Sentence case in the source text. Buttons are verbs that say what happens ("Add to pull list", "Mark 4 copies ordered", "Save settings"), never "OK", "Submit" or "Learn more". Errors say what failed and how to fix it. (Storefront buttons are set in capitals by CSS; write them in sentence case.)
- **Motion** is small and optional: every transition and animation stops under \`prefers-reduced-motion\`.
- **Semantics.** \`<button>\` for actions, \`<a>\` for navigation; a native \`<dialog>\` for dialogs; \`<details>\` for anything that opens and closes, never with a button inside its \`<summary>\`.
`;

export const STOREFRONT = `# Storefront

Each shop's public site: pull lists, pre-orders, new arrivals, events and the shop's own pages. One codebase serves every shop; the shop's colors and fonts come from Shop Settings → Logo, Colors & Fonts, so the design is a frame the shop's brand fills. Default look: "Bronze Age Modern + Dusty Blue", a dark page with brick-red actions, gold accents and dusty-blue links.

## Color

Five colors are the shop's settings; every other color is mixed from them or fixed. Build with the roles, never with the default hex values, because each shop's values differ.

| Setting | Token | Default | Job |
| --- | --- | --- | --- |
| Main color | \`shop-brand-primary\` (\`shop-red-btn\`) | \`#982c21\` | The one action that matters (Add to pull list, Reserve), the top bar, sale badges, the event month strip. Text on it: \`shop-on-primary\`. |
| Accent | \`shop-brand-accent\` (\`shop-gold\`) | \`#e7b84b\` | Highlights: current menu item, ghost buttons, Staff Pick, New, chips, a headline's highlighted phrase, footer headings. Text on it: \`shop-on-accent\`; as text itself: \`shop-gold-text\`. |
| Text | \`shop-brand-ink\` (\`shop-ink\`) | \`#f4f0ea\` | All running text. |
| Page background | \`shop-brand-paper\` (\`shop-paper\`) | \`#121212\` | The page; also the text on blue, green, orange and pink fills. |
| Footer background | \`shop-brand-footer\` | \`#121212\` | The footer only. |

**Mixed from page and text** (\`color-mix(in srgb, paper, ink N%)\` in the stylesheet, so they follow any shop's pick):

| Name | Mix | Default | Use |
|---|---|---|---|
${row('surface', 'ink 4%', d.surface, 'Cards, panels, filters, dialogs, alternate sections.')}
${row('raised', 'ink 9%', d.raised, 'Cover backgrounds, chips, the open multi-select panel, disabled buttons.')}
${row('line', 'ink 17%', d.line, 'Every border and divider.')}
${row('field-line', 'ink 52%', d['field-line'], `Field edges: ${fmt(ratio(d['field-line'], paper))} on the page.`)}
${row('muted', 'ink 76%', d.muted, `Secondary text: ${fmt(ratio(d.muted, paper))} on the page, ${fmt(ratio(d.muted, d.surface))} on surface.`)}

**Roles** (swapped for readable ones when a shop picks a light page, by js/theme-vars.js): \`shop-teal\` (links, the default button, focus), \`shop-teal-hover\`, \`shop-teal-dark\` (notice), \`shop-cream\` (shop name, menu, hero text), \`shop-error\`, \`shop-ok\`, \`shop-warn\` (Low Stock, staff orange), \`shop-clearance\`, \`shop-violet\` (staff purple), and \`shop-on-accent\` / \`shop-gold-text\` (set from the accent). \`shop-sold-out\` / \`shop-on-sold-out\` is a dark chip on any page.

- **Red acts, gold highlights, blue links.** A filled red button is the main action on a card or form; gold marks what is current, picked or new; blue is every link and every secondary button.
- **Text on a fill follows the fill:** \`shop-on-primary\` on red, \`shop-on-accent\` on gold (both set from the shop's color: dark on a light one, white on a dark one), \`shop-paper\` on blue, green, orange and pink (which turn dark on a light page), \`shop-on-sold-out\` on Sold Out.
- **Gold as text or an edge is \`shop-gold-text\`**, never \`shop-gold\`: it is the accent itself where that reads at 4.5:1, else the accent darkened (light page) or lightened (dark page) until it does.
- **No fixed colors.** Every page-dependent color is a role in \`:root\` (\`shop-warn\`, \`shop-clearance\`, \`shop-violet\`, \`shop-sold-out\`…); css/site.test.js fails on any other literal outside \`:root\` except black, white, their translucent shades and the callout's \`#161616\`. A new role that is text or a badge gets a light-page value in js/theme-vars.js.
- Staff text from the admin editor that was colored for a light page maps to readable storefront colors (the "Staff-edited text" block at the end of css/site.css). Add a mapping there for any new editor color.

## Type

Three font slots, each a Shop Settings choice with a Size (Small / Medium / Large) and Letter spacing (Tight / Normal / Wide):

| Slot | Variable | Default | Styles |
| --- | --- | --- | --- |
| Headlines | \`--font-display\` | Archivo Black, upper case | \`shop-type-h1\`, \`shop-type-shop-name\`, \`shop-type-date\` |
| Sub-headings | \`--font-heading\` | Archivo 700 | \`shop-type-h2\`, \`shop-type-title\`, \`shop-type-h3\`, \`shop-type-card-title\`, \`shop-type-footer-heading\` |
| Body text | \`--font-body\` | Source Sans 3 | \`shop-type-body\`, \`shop-type-lede\`, \`shop-type-label\`, \`shop-type-button\`, \`shop-type-meta\`, \`shop-type-badge\` |

- **Font library** (all in \`fonts/\`, Latin subset, SIL Open Font License). Display only: Archivo Black, Bangers, Bebas Neue, Anton, Alfa Slab One. Any slot: Oswald, Source Sans 3, Inter, Work Sans, Rubik, Lora, Roboto Slab. Archivo: headlines and sub-headings. A shop can also upload a .woff2.
- Sizes multiply by \`--display-scale\`, \`--heading-scale\` and \`--body-scale\`; each library font carries its own scale so Medium looks as big as the default. Never set a storefront heading size without its scale.
- One h1 per page. Body text is 18px. Buttons, badges, footer headings and the top bar's "Announcement" label are the only upper-case text besides headlines.

## Layout

- Content sits in \`.container\` (\`shop-max\` 1180px, \`shop-gutter\` 16px each side). Sections pad 32px top and bottom and are divided by a \`line\` rule; \`.section--alt\` takes \`surface\`.
- A page opens with \`.section__head\`: the title and its links on one line, \`shop-space-block\` (24px) under it.
- The catalog grid is 2 → 3 (600px) → 4 (800px) → 6 (1100px) across. Info pages use \`.info-grid\` (two columns from 800px).
- **Breakpoints:** only \`min-width: 480 / 600 / 700 / 800 / 1100px\` and \`max-width\` one under a step (\`479 / 599 / 699 / 799 / 1099px\`), in CSS and in \`matchMedia\`; css/site.test.js rejects any other width. 600 is phones, 800 two columns and four across, 1100 the full menu and six across.
- **Shape:** \`shop-radius\` (5px) for panels, cards, filters and maps; buttons 3px; fields 9px; badges and chips 2px; dialogs 8px; pills and count badges fully round.
- **Depth:** no shadows at rest. Borders in \`line\` separate things; only dialogs and the open multi-select float (\`shop-shadow-lg\`).
- The comic texture: a faint dot screen (7px pitch) behind the hero and on cover placeholders. Nothing else is decorated.

## Behavior and accessibility

- Focus: 3px \`shop-focus\` with a 3px offset everywhere; fields add a soft blue glow. In forced-colors mode every field and button gets a real outline.
- Badges are an icon and a word. Cutoff lines say the day ("Add by Sat, Oct 31") and turn \`shop-error\` within two days.
- Lists that load later hold their space with a pulsing \`raised\` block; loading dims the page with a spinner that never blocks clicks.
- Covers keep the comic trim ratio (6.625 / 10.25) and always have alt text ("Cover of Saga #71"); a missing cover says "Image coming soon".
- Dialogs: native \`<dialog>\`, focus returns to the opener, the close button fills blue on keyboard focus. The title dialog is full screen under 600px.
`;

export const ADMIN_MD = `# Staff admin

The shop's back office: customers and pull lists, reservations, Place Order, titles, series, events, news, pages, email, settings. People use it all day at the counter on phones, tablets and desktops, so it is plain, dense and predictable. Every screen is built from the Admin components; the repo's \`admin/style-guide.html\` is the live reference and \`admin/consistency.test.js\` guards it.

## Color

- **Light and dark.** Staff choose in My Account → Appearance; both use one slate hue. Use the \`admin-*\` tokens, which change with the theme; never a raw hex, and never \`#fff\` for a background.
- **Surfaces:** \`admin-paper\` (page) → \`admin-surface\` (panels, folds, inputs, dialogs) → \`admin-stripe\` (every other row, callouts). Lines: \`admin-line\` (dividers), \`admin-field-line\` (field and ghost-button edges, 3:1).
- **The slate band** \`admin-fold-head-bg\` with white text is every header: folds and table heads. One look for one job.
- **Accents:** \`admin-brand-primary\` (red) for the main action, selected tab and tab rule; \`admin-brand-accent\` (yellow) for the default button, notices and "arrived" states, always with \`admin-on-accent\` text.
- **Status:** fills \`admin-success\` (green buttons), \`admin-danger\` (Delete) and \`admin-info\` (blue buttons) carry white text; as text or an icon use \`admin-success-ink\` (Saved, Add) and \`admin-danger-ink\` (errors, Remove), which read in both themes. Amber heads-up text is \`admin-warn-text\`. Rows: \`admin-danger-soft\` overdue, \`admin-select-bg\` open, \`admin-merge-bg\` / \`admin-keep-bg\` Series merge. Pill tones: \`admin-pill-*\`.
- Pair every color with a word or icon.

## Type

- **Display** (Archivo Black, \`admin-display\`): page titles (\`admin-type-h1\`, \`admin-type-page\`), the shop name in the header and dashboard numbers (\`admin-type-stat\`) only.
- **Body** (the system font, \`admin-body\`): everything else, including card, panel and fold headings (\`admin-type-card\`, bold).
- Every font size is an \`admin-fs-*\` step; a bare rem value fails consistency.test.js. Body is \`admin-fs-base\` (16px), so phones never zoom into fields.

## Spacing, size and layers

- Margin, padding and gap use \`admin-sp-*\` (2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32px, and 40 / 64px for page-level space). Corners use \`admin-radius\` (6px) and its steps (\`admin-radius-xl\` for dialogs). consistency.test.js rejects a px or rem margin, padding, gap or corner; allowed besides are 0, auto, em / ch / %, a negative offset that lines edges up, and anything inside \`calc()\`.
- \`--border\` is a whole border (\`1px solid admin-line\`): write \`border: var(--border)\`, never \`1px solid var(--border)\`.
- Touch: \`admin-tap-btn\` (48px) buttons and \`admin-tap\` (44px) small buttons and fields on phones; clickable fold headers \`admin-tap-head\` (52px). Fields are \`admin-field-h\`.
- Stacking: \`admin-z-raised\` → \`admin-z-sticky\` → \`admin-z-header\` → \`admin-z-float\` (toasts) → \`admin-z-busy\` (loading). Never a bare z-index.
- Helpers: \`m-0\`, \`mt-*\` / \`mb-*\` (0–24), \`ml-auto\`, \`stack\`, \`cluster\`, \`gap-*\`, \`justify-between\`, \`items-start|end\`, \`flex-1\`, \`text-muted\`, \`text-danger\`, \`text-success\`, \`text-right\`, \`font-mono\`, \`nowrap\`.

## Breakpoints

Phone up to 599px, tablet 600–899px, desktop from 900px, wide from 1200px; small tablets split at 700px and the narrowest phones at 380px. Use only \`max-width: 599 / 699 / 899 / 1199px\` or \`min-width: 600 / 700 / 900 / 1200px\` (and 380px); consistency.test.js rejects any other width. Up to 899px, \`cards\` tables become card lists and "How this works" folds start closed.

## Rules

- **Where code lives:** shared components in admin/base.css and admin/admin.css; one screen per file in admin/sections/; helpers (\`esc\`, \`uid\`, \`toast\`, \`openDialog\`, \`hintFold\`, \`setupTabs\`, \`sortableTable\`, \`solidIcon\`, \`makeEditor\`) in admin/lib.js.
- **One look for each job:** headers are the slate band, actions are AdminButton, states are AdminPill, lists are AdminTable. Something new goes into the style guide (and this system) first, in the same change.
- **Lists:** customer columns run Name, Phone, Email, then the rest; show a customer's current details (\`withCustomers\`), not what an order was placed with.
- **Accessibility:** visible labels; \`role="status"\` for save results and \`role="alert"\` for errors; buttons, not links, for actions; never a whole screen as a live region; never a button inside a \`<summary>\`; tab rows get arrow keys.
- **Safety:** escape every piece of text put into markup with \`esc()\`; make label/field id pairs with \`uid()\`.
- **Templates:** start a new line at each block tag, never between inline ones (buttons, spans, links), where a line break shows as a space.
- **Deliberate exceptions:** Titles filter labels are a little smaller so seven filters fit; the FAQ arrows are fixed-width icon buttons; the Titles list's Edit button is tighter on phones.

## Screen patterns

Layouts that belong to one screen, built from the components; reuse the component, not the screen's class:

- **Titles list** (\`.titles-table\`): on phones a grid card per title, because the cover spans three lines.
- **Customer pull list** (\`.cust-lines\`): grouped Ready / Open & ordered / Past with group header rows; stripes from \`tr.is-alt\`; stacks below 1200px.
- **Reservations:** an order opens under its row (\`tr.is-open\` + \`tr.order-expand\` holding \`.order--inline\`).
- **Place Order:** one \`.fold--compact[data-foc]\` per order cutoff, its count in the header note and "Mark ordered" at the top of the body.
- **Dashboard → Most Reserved** (\`.dash-top\`), **Series merge**, **QR codes** (\`.qr-item\`), **Survey questions** (\`.sq-head\`).

## Icons

- **Admin tab icons:** 44 line icons, 24px grid, 2px stroke, round caps and joins, \`currentColor\`. Only in front of tab labels, matched by label in admin/tab-icons.js.
- **Admin action icons:** 19 solid icons cut with even-odd fill (\`solidIcon(name, size)\` in lib.js): Add, Remove, Edit, Delete, View, Follow, role pills and status icons. Inside a table row, icon only with \`aria-label\` and \`title\`; elsewhere icon plus the word.
- Don't mix in the marketing line icons or another set.
`;

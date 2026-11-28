# Shop layouts: header, homepage hero and footer choices

Date: 2026-11-27 · Status: draft for approval (covers source decided 2026-11-28)

## Why

Every Pullwise shop's site has the same shape today; only the logo, colors, fonts and editor blocks differ. Shops
want their site to look less like the next one, and a few distinct looks also help sell Pullwise to new shops. We do
that with a small set of designed choices, not free-form templates, so every combination still passes the
storefront's contrast, token and accessibility rules, and still carries the shop's brand first (see
`shop-branding-first`).

## Goals

- Staff pick, independently, one **top navigation**, one **homepage hero** and one **footer** in Shop Settings.
- Ten options at launch (all approved from the mockups):
  - Header: **Classic** (today), **Centered**, **Bold bar**
  - Hero: **Banner** (today), **Split**, **This week's covers**, **Slim**
  - Footer: **Full** (today), **Simple**, **Sign-up first**
- **Adding an option later is cheap**: one entry in a registry, its markup branch, its CSS, its admin thumbnail, its
  style-guide / design-system entry. Tests fail if any of those is missing.
- No shop changes look until staff pick something: missing or unknown values fall back to Classic / Banner / Full.
- First paint is already in the chosen layout (no jump from Classic to the pick).

## Non-goals

- Named "looks" that bundle the three picks. Possible later as presets on top of this.
- Reordering, adding or removing homepage sections below the hero. The editor blocks at the top and bottom stay the
  way to add content.
- Per-shop HTML/CSS templates or custom code in the header.
- The pull list app (`app.html`): it keeps its own header and has no footer.
- Live preview of the storefront inside admin.

## Anti-goals

- Any option that can fail contrast, ignore the shop's colors and fonts, or put "Pullwise" anywhere beyond the
  existing footer line.
- A layout flash on load, or a slower homepage.
- An option that looks broken on a phone.

## Approaches considered

- **A · Three separate picks (chosen).** One setting per area; the existing render functions branch on it; looks
  live in `site.css` on existing tokens; the Worker stamps the picks for first paint. Most flexible, least code, and
  new options are additive. Chosen *so we can add more options later*.
- **B · Named looks.** A handful of designed bundles. Simpler admin, but no mix-and-match. Can be layered on A later.
- **C · Template files per layout, injected by the Worker.** Ruled out: the header and footer are built in JS from
  menu order, switched-off pages, custom pages and locations; templates would mean rewriting or duplicating that.

## Design

### Data

- Migration: `alter table public.settings add column if not exists layout jsonb not null default '{}'::jsonb;`
  Shape: `{ "header": "centered", "hero": "split", "footer": "simple" }`. Every key optional.
- Follow the migration merge-order rule (`migration-merge-order`): don't apply to demo before the PR merges.
- Add `layout` to the Worker's settings select (`worker/index.js`, the `settings?select=…` line).

### Registry — `js/layouts.js`

Pure module, no DOM (Node-tested, imported by the site, admin and Worker):

```js
export const LAYOUTS = {
  header: [{ id: 'classic', label: 'Classic', hint: '…' }, { id: 'centered', … }, { id: 'bold', … }],
  hero:   [{ id: 'banner', … }, { id: 'split', … }, { id: 'covers', … }, { id: 'slim', … }],
  footer: [{ id: 'full', … }, { id: 'simple', … }, { id: 'signup', … }],
};
export function layoutOf(settings) // → { header, hero, footer }, unknown/missing → first entry of each list
```

The first entry of each list is the default. Removing an option later degrades shops on it to the default.

### First paint (Worker)

- `worker/index.js` sets `data-header`, `data-hero`, `data-footer` on `<body>` from `layoutOf(settings)` for every
  page (hero only matters on `index.html`). CSS keys off these attributes, so the header drawn from the saved
  snapshot or built-in defaults is already in the right shape.
- `worker/shop-page.js` `hero()` returns the class and markup for the chosen hero. For **Split** it adds the photo
  element; for **Covers** it reserves the cover row's height (empty slots) so nothing shifts when covers arrive;
  for **Slim** it drops the tagline and second button.
- `js/site.js` sets the same attributes from loaded settings (covers a change since the page was cached).

### Storefront rendering

- `renderHeader` (`js/site.js`): one markup branch per header. Shared pieces (skip link, nav list built from
  `orderMenu`, toggle, announcement, search) are helpers, so each branch only arranges them.
  - **Classic**: unchanged.
  - **Centered**: announcement + search strip, logo centered, nav on its own row. On phones: logo centered, menu
    toggle at the side, same phone menu as today.
  - **Bold bar**: one bar on `--brand-accent` with text in `--on-accent`; search becomes an icon button that opens
    the search field below the bar; announcement strip sits under the bar. My Pull List keeps its standout style.
- `js/pages/home.js` `paintHero`: per-hero markup, mirroring the Worker.
  - **Banner**: unchanged.
  - **Split**: text one side, banner photo the other (no text over the photo). No photo set → falls back to Banner.
  - **This week's covers**: headline (`hero_headline`, default "New this Wednesday at {shop}"), six covers, one
    button. Covers open the title details modal (`covers-open-title-details`). Source (decided): the first six of
    the existing New This Week list (`fresh` in `loadHome`: staff "Show on homepage" titles first, then this week's
    arrivals, then recent releases). The New This Week shelf then starts after those six, so no cover repeats; if
    fewer than six are left, the shelf shows what's left, and hides when empty.
  - **Slim**: one line (headline) and one button; the top editor block follows directly.
- `renderFooter`: one branch per footer.
  - **Full**: unchanged.
  - **Simple**: centered logo, one line of footer links (same `orderMenu` + `footer_order` + custom pages), one line
    of address · phone · today's hours (holiday hours respected). Several locations: location names linking to
    Contact instead of one address. Social icons stay. Legal line unchanged.
  - **Sign-up first**: the newsletter band (existing `.newsletter` section and its editor lede) becomes the
    footer's first band, then a two-column Visit / More block. Only offered when `newsletter_embed` is set; without
    it the site renders Simple.
- All new looks go in `css/site.css` as modifier classes on tokens only; markup from `js/` has no inline styles
  (except values computed at run time, like the hero photo URL, as today). Every animation gets a
  `prefers-reduced-motion` rule. `js/theme-vars.js` light-page handling applies unchanged.

### Admin

- Shop Settings → "Logo, Colors & Fonts" tab gets a **Layout** fold (`admin/sections/settings.js`) with three
  groups of picture cards (radio inputs styled as cards), each with label and one-line hint from the registry.
  Thumbnails are small static SVGs in `admin/` (one per option), so they don't need storefront CSS.
- "Sign-up first" is disabled with a hint ("Add a newsletter sign-up first") when there's no newsletter embed.
- Split shows a hint when no banner photo is set.
- Saved with the existing Save settings, as `layout`.
- The picture-card radio group is a new admin component: add it to `admin/style-guide.html` and `admin.css`
  (`admin/consistency.test.js` requires it).

### Design system and docs

- Add the new header, hero and footer variants to the storefront components (`tools/design-system/shop-components.mjs`)
  and `storefront.md`; the picture-card radio to the admin layer. Rebuild and republish per
  `tools/design-system/README.md`.
- Add a short "Layout" section to `ADMIN-ONBOARDING.md` / help.

### Tests

- `js/layouts.test.js`: `layoutOf` defaults and unknown values; every registry id has a CSS rule
  (`[data-header="…"]` etc.) in `site.css` and an admin thumbnail file.
- `worker/shop-page.test.js`: hero output per option; body attributes.
- Existing `css/site.test.js` / `npm test` cover tokens, contrast and inline styles.
- Manual: each option on desktop and phone, dark and light page, single and multi-location, with and without
  newsletter / hero photo; demo shop.

## Left to the builder

- Exact spacing, sizes and breakpoints within the token scale; thumbnail artwork.
- How to factor `renderHeader` / `renderFooter` helpers.
- Whether the cover row reuses `itemCard` or a lighter cover-only element.

## Calls I made (check these)

- Defaults are today's layout; unknown values fall back to them.
- Split with no photo falls back to Banner; Sign-up first with no newsletter falls back to Simple; the covers hero
  with no new titles at all falls back to Banner.
- Centered and Bold bar use today's phone menu.
- Admin thumbnails are static SVGs, not live previews.
- Simple footer shows today's hours only; full hours stay on Contact.
- The picks live in one `layout` JSON column, not three columns.

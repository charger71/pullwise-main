# Shop Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff pick one of 3 headers, 4 homepage heroes and 3 footers per shop, with room to add more later.

**Architecture:** A pure registry (`js/layouts.js`) lists the options and resolves a shop's picks from a new
`settings.layout` JSON column. The Worker stamps the picks on `<body>` and pre-draws the chosen hero; `js/site.js`
and `js/pages/home.js` branch their existing markup per pick; looks live in `css/site.css` keyed off the body
attributes. Admin gets a Layout fold of picture-card radios.

**Tech Stack:** Vanilla ES modules, Supabase (Postgres migration), Cloudflare Worker + HTMLRewriter, plain
`node:assert` test scripts run by `npm test` (`tools/run-tests.mjs` finds every `*.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-27-shop-layouts-design.md`

## Global Constraints

- Work in a git worktree on a feature branch; never switch branches or stash in the shared checkout.
- Defaults are today's look: header `classic`, hero `banner`, footer `full`. Missing/unknown values → default.
- Option ids (exact): header `classic | centered | bold`; hero `banner | split | covers | slim`; footer `full | simple | signup`.
- `css/site.css`: tokens only (spacing, sizes, radii, shadows, z-index, durations, breakpoints); text on a fill uses
  `--on-primary` / `--on-accent`; gold as text is `--gold-text`; every animation has a `prefers-reduced-motion` rule.
- Markup written by `js/` carries no `style="…"` except run-time values (the hero photo URL, as today).
- Admin markup carries no fixed `style="…"`; new admin component goes in `admin.css` and `admin/style-guide.html`.
- "Pullwise" appears only in the existing footer legal line (`POWERED_BY`), in every footer option.
- Covers open the title details modal.
- Migration: schema only (`tools/check-migrations.js`); do not apply to demo before the PR merges.
- `npm test` passes before every commit. Never edit `admin/version.js`.
- After the CSS/style-guide changes, rebuild and republish the design system (`tools/design-system/README.md`).

## Review Focus

1. **First visit, no saved snapshot:** the header/footer are first drawn from `FALLBACK_SETTINGS` (no `layout`).
   They must use the Worker-stamped body attributes, not fall back to Classic and then jump.
2. **Bold bar on a light page / light accent:** bar text and the My Pull List pill must stay readable (`--on-accent`), and the search icon too.
3. **Narrow phones (375px) with a long shop name or wide logo** in Centered and Bold bar: no overflow, the menu toggle stays visible.
4. **Covers hero with few or no new titles** (e.g. before the weekly import): fewer than 6 shows what there is;
   zero renders the Banner hero instead (spec "Calls I made"); the New This Week shelf never repeats a hero cover.
5. **No announcement, switched-off pages, maintenance mode, multi-location shops** with each header/footer: no
   empty strips, hidden links stay hidden, the Simple footer lists location names.

---

### Task 1: Registry and `layout` column

**Files:**
- Create: `supabase/migrations/20270419000000_shop_layout.sql` (use the next free timestamp after the newest migration)
- Create: `js/layouts.js`
- Test: `js/layouts.test.js`

**Interfaces:**
- Produces:
  - `LAYOUTS: { header: Option[], hero: Option[], footer: Option[] }`, `Option = { id: string, label: string, hint: string }`; first entry is the default. Labels: Classic, Centered, Bold bar / Banner, Split, This week's covers, Slim / Full, Simple, Sign-up first. Hints: the one-liners from the spec's Goals/Design.
  - `layoutOf(settings, stamped = {}) → { header, hero, footer }` — per area: `settings.layout[area]` if it is a known id; else, **only when `settings.layout` is undefined**, `stamped[area]` if known; else the default.
  - `heroCovers(fresh: Item[], heroId: string) → { covers: Item[], shelf: Item[] }` — `heroId === 'covers'`: covers = first 6, shelf = the rest; otherwise covers = [], shelf = fresh.
  - `HERO_COVERS = 6`.

- [ ] **Step 1: Write the failing test** (`js/layouts.test.js`, `node:assert/strict` script like the others)

```js
assert.deepEqual(layoutOf({}), { header: 'classic', hero: 'banner', footer: 'full' });
assert.deepEqual(layoutOf({ layout: { header: 'bold', hero: 'nope' } }), { header: 'bold', hero: 'banner', footer: 'full' });
assert.deepEqual(layoutOf({ shop_name: '' }, { header: 'centered', hero: 'slim', footer: 'simple' }), { header: 'centered', hero: 'slim', footer: 'simple' }, 'no layout key → stamped');
assert.deepEqual(layoutOf({ layout: {} }, { header: 'centered' }).header, 'classic', 'saved settings win over stamp');
const items = Array.from({ length: 8 }, (_, i) => ({ id: i }));
assert.deepEqual(heroCovers(items, 'covers').covers.map((i) => i.id), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(heroCovers(items, 'covers').shelf.map((i) => i.id), [6, 7]);
assert.deepEqual(heroCovers(items, 'banner'), { covers: [], shelf: items });
assert.deepEqual(heroCovers([], 'covers'), { covers: [], shelf: [] });
for (const area of ['header', 'hero', 'footer']) assert.ok(new Set(LAYOUTS[area].map((o) => o.id)).size === LAYOUTS[area].length, `${area} ids unique`);
```

- [ ] **Step 2: Run** `node js/layouts.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `js/layouts.js`** (pure, no DOM) and the migration:
  `alter table public.settings add column if not exists layout jsonb not null default '{}'::jsonb;` with a header comment in the style of `20270205000000_fonts.sql`.
- [ ] **Step 4: Run** `node js/layouts.test.js && node tools/check-migrations.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(layouts): layout registry and settings.layout column`.

---

### Task 2: Worker stamps picks and pre-draws the hero

**Files:**
- Modify: `worker/index.js` (settings `select=` list ~line 269; HTMLRewriter chain ~lines 288–347)
- Modify: `worker/shop-page.js` (`hero()` ~line 372)
- Test: `worker/shop-page.test.js` (~line 105)

**Interfaces:**
- Consumes: `layoutOf`, `HERO_COVERS` from `js/layouts.js`.
- Produces:
  - `bodyLayoutAttrs(settings) → { 'data-header': id, 'data-hero': id, 'data-footer': id }` in `worker/shop-page.js`.
  - `hero(settings)` gains `{ layout: heroId, photoHtml: string|null, coverSlots: number, secondButton: boolean }`;
    `heroId` is the *effective* hero: `split` with no https photo → `banner`. For `split`, `className` has no
    `hero--photo`, `style` is null, and `photoHtml` is `<div class="hero__photo" style="--hero-image: url(…)"></div>`.
    `covers` → `coverSlots: HERO_COVERS` (empty placeholders keep the row's height). `slim` → `tagline: ''`, `secondButton: false`.
    Existing assertions for the default keep passing (add the new keys to the expected objects).

- [ ] **Step 1: Write failing tests**

```js
assert.deepEqual(bodyLayoutAttrs({}), { 'data-header': 'classic', 'data-hero': 'banner', 'data-footer': 'full' });
assert.equal(hero({ layout: { hero: 'split' } }).layout, 'banner', 'split without a photo → banner');
const sp = hero({ layout: { hero: 'split' }, hero_image_url: `${MEDIA}/hero.jpg` });
assert.equal(sp.layout, 'split'); assert.equal(sp.style, null); assert.match(sp.photoHtml, /hero__photo/);
assert.equal(hero({ layout: { hero: 'covers' } }).coverSlots, 6);
const sl = hero({ layout: { hero: 'slim' }, tagline: 'Hi' });
assert.equal(sl.tagline, ''); assert.equal(sl.secondButton, false);
assert.equal(hero({ layout: { hero: 'split' }, hero_image_url: 'javascript:alert(1)' }).photoHtml, null);
```

- [ ] **Step 2: Run** `node worker/shop-page.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `bodyLayoutAttrs` and the `hero()` additions; in `worker/index.js` add `layout` to the select, set the three attributes on `body` for every non-`app.html` page, and on `index.html` set `section.hero`'s `data-layout`, append `photoHtml` / `coverSlots` placeholder `<div class="hero__covers">` (with `aria-hidden` empty slots) and remove the `.btn--ghost` in `.hero__actions` when `!secondButton`.
- [ ] **Step 4: Run** `node worker/shop-page.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(layouts): worker stamps layout and pre-draws the chosen hero`.

---

### Task 3: Header variants

**Files:**
- Modify: `js/site.js` (`renderHeader` ~273, `paint` in `initPage` ~701)
- Modify: `css/site.css` (header block ~268–480)
- Test: `js/layouts.test.js` (CSS coverage check)

**Interfaces:**
- Consumes: `layoutOf(settings, document.body.dataset)`.
- Produces: `paint` sets `document.body.dataset.header|hero|footer` from `layoutOf(s, document.body.dataset)` before rendering, so later code and CSS read one source. `renderHeader` arranges shared helpers `navList(s, page, extraNav, off)`, `announcementHtml(s)`, `searchForm()` per header id.

- [ ] **Step 1: Write the failing test** — in `js/layouts.test.js`, read `css/site.css` and assert a rule exists for every non-default option:

```js
const css = readFileSync(new URL('../css/site.css', import.meta.url), 'utf8');
for (const area of ['header']) for (const o of LAYOUTS[area].slice(1)) // widened in Tasks 4–5
  assert.ok(css.includes(`[data-${area}="${o.id}"]`), `css/site.css has no rule for ${area} "${o.id}"`);
```

- [ ] **Step 2: Run** `node js/layouts.test.js` — Expected: FAIL (no `[data-header="centered"]`).
- [ ] **Step 3: Implement** in `renderHeader`:
  - `classic`: today's markup, unchanged.
  - `centered`: topbar as today; `.header__bar--centered` with brand centered and the nav in its own row below (`.nav--row`). On phones (`< --bp` where today's toggle appears) brand centered, toggle at the side, same phone menu.
  - `bold`: one `.header__bar--bold` on `--brand-accent`, text `--on-accent`; search is an icon button (`aria-expanded`, `aria-controls`) toggling the search form in a row under the bar; announcement strip under the bar only when `s.announcement` is set. My Pull List keeps a pill in `--paper` on the bar.
  - Add the CSS under `[data-header="centered"]` / `[data-header="bold"]` (tokens only, reduced-motion rule for any transition).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Verify in the browser** — `preview_start {name: "site"}`, open `http://localhost:8080/` (demo data), set `document.body.dataset.header` and `localStorage` snapshot `layout` to each option; check desktop and `resize_window` mobile, a long `shop_name`, no announcement, and a light page (`colors.paper` light). Screenshot each.
- [ ] **Step 6: Commit** `feat(layouts): centered and bold-bar headers`.

---

### Task 4: Hero variants and no-repeat shelf

**Files:**
- Modify: `js/pages/home.js` (`paintHero` ~12, `renderHome` ~126–130)
- Modify: `index.html` (hero section: add empty `.hero__photo` and `.hero__covers` hosts, hidden by default)
- Modify: `css/site.css` (hero block ~524–545)
- Test: `js/layouts.test.js` (widen CSS loop to `hero`)

**Interfaces:**
- Consumes: `layoutOf`, `heroCovers`, `HERO_COVERS`; existing `itemCard`/`renderGrid` and `enableReservations` (covers must open the details modal like other covers).
- Produces: `paintHero(s, fresh = [])` — draws the effective hero (same rules as the Worker's `hero()`: split without photo → banner; covers with zero items → banner).

- [ ] **Step 1: Widen the CSS loop** to `['header', 'hero']`; run `node js/layouts.test.js` — Expected: FAIL.
- [ ] **Step 2: Implement**
  - `split`: `.hero--split` two-column grid (stacks on phones, photo first or second is the builder's call), photo in `.hero__photo`, no text over it.
  - `covers`: headline defaults to `New this Wednesday at *{shop_name}*` when `hero_headline` is empty; cover row from `heroCovers(fresh, 'covers').covers`, one primary button; `renderHome` draws `#new-releases` from `heroCovers(...).shelf` and hides its section when the shelf is empty.
  - `slim`: `.hero--slim` single line, headline + primary button only.
  - `banner`: unchanged.
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Verify in the browser** each hero on desktop and phone: split with/without photo, covers with 8, 3 and 0 new titles (no repeated cover in New This Week; clicking a cover opens the details modal), slim followed by the top editor block. Reload with an empty `localStorage` to confirm no layout jump. Screenshot each.
- [ ] **Step 5: Commit** `feat(layouts): split, covers and slim homepage heroes`.

---

### Task 5: Footer variants

**Files:**
- Modify: `js/holiday-hours.js`, `js/holiday-hours.test.js`
- Modify: `js/site.js` (`renderFooter` ~357)
- Modify: `css/site.css` (footer block ~481–520, `.newsletter`)
- Test: `js/layouts.test.js` (widen CSS loop to all areas)

**Interfaces:**
- Produces: `todayHours(hours, holidays, today) → { closed: true } | { open: 'HH:MM', close: 'HH:MM' } | null` in `js/holiday-hours.js`. `today` is `'YYYY-MM-DD'` in the shop's zone; a valid holiday on that date wins; else the weekly entry whose `days` (`'Mo'…'Su'`) includes that weekday; no entry → `{ closed: true }` if `hours` is non-empty, `null` if empty.

- [ ] **Step 1: Write failing tests**

```js
const wk = [{ days: ['We', 'Th'], open: '10:00', close: '20:00' }];
assert.deepEqual(todayHours(wk, [], '2026-12-02'), { open: '10:00', close: '20:00' }); // a Wednesday
assert.deepEqual(todayHours(wk, [], '2026-12-06'), { closed: true });                  // a Sunday
assert.deepEqual(todayHours(wk, [{ date: '2026-12-02', closed: true }], '2026-12-02'), { closed: true });
assert.deepEqual(todayHours(wk, [{ date: '2026-12-02', open: '12:00', close: '16:00' }], '2026-12-02'), { open: '12:00', close: '16:00' });
assert.equal(todayHours([], [], '2026-12-02'), null);
```

- [ ] **Step 2: Run** `node js/holiday-hours.test.js` — Expected: FAIL. Implement; run again — PASS.
- [ ] **Step 3: Implement footers** and widen the CSS loop to all three areas:
  - `full`: unchanged.
  - `simple`: centered brand, one line of the same ordered footer links (`orderMenu` + `footer_order` + custom pages, `off` respected, chat link when on), one line `address · phone · Open today h–h` / `Closed today` (omit the part when `todayHours` is null); multi-location shops show location names linking to `contact.html` instead. Social icons, legal line unchanged.
  - `signup`: when `newsletter_embed` is set, render the existing `.newsletter` section as the footer's first band (`.newsletter--lead`) followed by a two-column Visit / More block; when it isn't, render `simple`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Verify in the browser** each footer: single and multi-location, holiday today, no hours, with/without newsletter, a switched-off footer page. Screenshot each.
- [ ] **Step 6: Commit** `feat(layouts): simple and sign-up-first footers`.

---

### Task 6: Admin Layout fold

**Files:**
- Modify: `admin/sections/settings.js` ("look" tab ~84–116; save ~244–266; tab hint ~191)
- Create: `admin/layouts/{area}-{id}.svg` (10 small wireframe thumbnails, colors via `currentColor`/`var()` so both admin themes work)
- Modify: `admin/admin.css`, `admin/style-guide.html`, `admin/consistency.test.js` (`COMPONENTS` ~222)
- Test: `js/layouts.test.js` (thumbnail files exist)

**Interfaces:**
- Consumes: `LAYOUTS`, `layoutOf`.
- Produces: new admin component `choice-cards` (`.choice-cards` group, `.choice-card` label wrapping a visually-hidden radio, thumbnail, label, hint; selected and focus-visible states; disabled state with reason). Saves `layout: { header, hero, footer }` with the other settings.

- [ ] **Step 1: Write failing tests** — add `'choice-cards', 'choice-card'` to `COMPONENTS` in `admin/consistency.test.js`; in `js/layouts.test.js` assert `existsSync(new URL(`../admin/layouts/${area}-${o.id}.svg`, import.meta.url))` for every option. Run `npm test` — Expected: FAIL.
- [ ] **Step 2: Implement** a "Layout" fold (`fold fold--compact fold--static`, after Logo & Colors) with three `fieldset`s (Top navigation, Homepage hero, Footer) built from `LAYOUTS`; checked from `layoutOf(s)`. `signup` disabled with hint "Add a newsletter sign-up first" when `s.newsletter_embed` is blank; `split` shows a hint when no banner photo is set. Include `layout` in the save payload. Add the component's CSS to `admin.css` (tokens only) and an example with all states to `style-guide.html`.
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Verify in the browser** (admin on demo): pick each option, save, reload the storefront and confirm it shows; keyboard-only selection works; both admin themes. Screenshot the fold.
- [ ] **Step 5: Commit** `feat(admin): layout picker for header, hero and footer`.

---

### Task 7: Design system, docs and help

**Files:**
- Modify: `tools/design-system/shop-components.mjs`, `tools/design-system/admin-components.mjs`, storefront docs (`storefront.md` via `docs.mjs`)
- Modify: `ADMIN-ONBOARDING.md`, `admin/help/` (the Shop Settings page)

- [ ] **Step 1:** Add the header, hero and footer variants (storefront) and `choice-cards` (admin) to the design system sources; add a short "Layout" section to onboarding and help (what each option is for, the two fallbacks).
- [ ] **Step 2:** Rebuild and republish the design system per `tools/design-system/README.md` (plain read before publish; absolute paths).
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Commit** `docs(layouts): design system, onboarding and help`; open the PR. Apply the migration to shops only after merge.

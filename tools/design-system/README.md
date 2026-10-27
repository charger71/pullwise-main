# Design system generator

The Pullwise design system is a claude.ai Design System artifact:
<https://claude.ai/artifact/YWP6UsATWeCe9f6mdqxJJn>. It has three layers:

| Layer | Tokens | Components | Built from |
| --- | --- | --- | --- |
| Marketing site and brand | no prefix | Button, Panel, FAQ… | the marketing site's repo (not this one) |
| Storefront | `shop-*` | Shop… | `css/site.css`, `js/theme-vars.js`, `js/social-icons.js`, `fonts/` |
| Staff admin | `admin-*` | Admin… | `admin/base.css`, `admin/admin.css`, `admin/style-guide.html`, `admin/tab-icons.js`, `admin/lib.js` |

This folder rebuilds the **storefront and admin layers** from this repo. It keeps everything else as it is: the
marketing layer, the cover, the logos, and anything people changed on the artifact's page.

Run it after any change to the storefront or admin stylesheets, tokens, style guide or icons, so the design system
matches the code.

## Running it

1. **Get the system's current files.** Read the artifact's files (everything under `project/`) into a folder, keeping
   their paths, so you have `<folder>/project/tokens.json`, `<folder>/project/README.md` and so on. In Claude Code: ask
   Claude to "read the Pullwise design system's project files into a folder".
2. **Build:**

   ```bash
   npm run design-system -- --from <folder>
   ```

   This writes an updated copy of the whole system to `tools/design-system/out/project/` (git ignores `out/`). It then
   lists the files that changed, any new icons, and anything to check by hand, such as a new color variable with no
   usage note.
3. **Check the previews** (optional; needs Playwright):

   ```bash
   npm run design-system:check
   ```

   This renders every Shop and Admin preview in dark and light. It reports horizontal overflow and each card's real
   height, and saves screenshots to `out/check/`. If a card's height changed, update its `height` in
   `shop-components.mjs` or `admin-components.mjs`.

## Publishing

Publish to the artifact's URL in this order:

1. **New icons:** upload each new icon as an asset first.
2. **Changed files:** publish only the files the run listed (never `tokens.css`, `manifest.json` or `api/`, which the
   page generates).
3. **Index, last:** update `design-system.json` and publish it on its own. Read it from the artifact again right
   before, then:
   - add a record for each new icon under `assetGroups`;
   - set `lastChange` (`by`, `at`, `via: "GitHub · charger71/pullwise-main@<sha>"`, `note`).

Claude Code does all three when asked to "publish the design system update". Before overwriting, compare each file
with the copy read in step 1 of Running it: if the artifact changed since then, someone edited it on the page, so
merge their change instead.

## Files

| File | What it does |
| --- | --- |
| `index.mjs` | Entry point: copies the system, runs the build, writes components and brand-book sections, reports what changed. |
| `config.mjs` | Paths (`--from`, `--out`), the commit and the date recorded in the system. |
| `tokens.mjs` | Reads the `:root` variables from the stylesheets into `shop-*` and `admin-*` tokens. Each token's note comes from `SHOP_NOTE` / `ADMIN_NOTE`, plus where it is used and its contrast on the grounds it sits on. **A new color variable needs a note here.** |
| `build.mjs` | Writes `tokens.json` (type styles, fonts, spacing, sizes), `components/bundle.css` (the real stylesheets scoped under `.pw-shop` / `.pw-admin`, taking their values from the tokens), the font files and the icon SVGs. |
| `css.mjs` | CSS reading, scoping and WCAG contrast maths. |
| `shop-components.mjs`, `admin-components.mjs` | Each component's guidelines and preview. Admin previews are lifted from `admin/style-guide.html`; storefront previews follow the site's own templates. **A new shared component goes here too.** |
| `docs.mjs` | The brand-book sections: the README's "Three surfaces" overview, `storefront.md` and `admin.md`. |
| `check.mjs` | The optional render check. |

# Working on Pullwise

## Before building or changing anything in the staff admin
- **Start from the style guide:** read `admin/style-guide.html` (open it in a browser, or read the file) and build
  from the components and rules it shows: buttons, folds, tabs, tables and card lists, pills, forms, dialogs,
  spacing and size tokens, breakpoints, row colours, accessibility. Don't invent a one-off look when a shared piece fits.
- **Update the style guide in the same change** whenever you add a component, a variant or a rule, or change how one
  looks or behaves. The guide is the reference the next change is built from, so it must match the code.
  `admin/consistency.test.js` fails when a shared component is missing from the guide.
- Shared CSS lives in `admin/base.css` (tokens, both themes) and `admin/admin.css`; one screen per file in
  `admin/sections/`; helpers (`esc`, `uid`, `hintFold`, `setupTabs`, `openDialog`, …) in `admin/lib.js`.

## Before changing the public site's look
- The storefront's colors, breakpoints and fonts follow the rules at the top of `css/site.css` and in the design
  system's Storefront section: text on a fill follows the fill (`--on-primary`, `--on-accent`), gold as text is
  `--gold-text`, and every page-dependent color is a role in `:root` that `js/theme-vars.js` keeps readable when a shop
  picks a light page. `css/site.test.js` enforces them.

## Design system
- The Pullwise design system (https://claude.ai/artifact/YWP6UsATWeCe9f6mdqxJJn) has storefront (`shop-*`) and admin
  (`admin-*`) layers built from this repo by `tools/design-system/`. After changing the storefront or admin
  stylesheets, tokens, style guide or icons, rebuild and republish it: see `tools/design-system/README.md`.

## Checks
- `npm test` runs the unit tests and `admin/consistency.test.js`: contrast in both themes, tokens only (no bare
  colours, font sizes, spacing, corners, z-index or breakpoints), row colours, fold markup, no unused CSS, and more,
  and `css/site.test.js` for the storefront (breakpoints and colors). Run it before every commit.
- The git pre-commit hook stamps `admin/version.js`, and the Deploy workflow stamps it again before each Worker deploy
  (for commits made without the hook); never edit it by hand.

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

## Checks
- `npm test` runs the unit tests and `admin/consistency.test.js`: contrast in both themes, tokens only (no bare
  colours, font sizes, z-index or breakpoints), row colours, fold markup, no unused CSS, and more. Run it before
  every commit.
- The git pre-commit hook stamps `admin/version.js`; never edit it by hand.

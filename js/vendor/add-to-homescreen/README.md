# add-to-homescreen (vendored)

The step-by-step "Add to Home Screen" guide the pull list app shows on phones (js/pages/app.js `showInstallGuide`).

- Source: https://github.com/philfung/add-to-homescreen, npm `pwa-add-to-homescreen` **4.6.0**, MIT (LICENSE).
- Files: `dist/add-to-homescreen_en.min.js` (English only), `dist/add-to-homescreen.min.css`, and only the images
  the script uses from `dist/assets/img/` (not the demo's `sample/` or `aardvark-*`).
- Local changes to the CSS: the `@import` of Roboto from Google Fonts is removed (no third-party request from the
  app) and `font-family: "Roboto", sans-serif` is `inherit`, so the guide uses the shop's page font.

To update: download the new tarball (`npm view pwa-add-to-homescreen dist.tarball`), copy the same files, re-apply the
two CSS changes, and copy any image named in `_genAssetUrl("…")` in `dist/add-to-homescreen.js` that's missing here.

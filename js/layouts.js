// The shop's layout picks (Shop Settings → Logo, Colors & Fonts → Layout): one top navigation, one homepage hero and
// one footer, saved as settings.layout ({ header, hero, footer }). The first option in each list is today's look and
// the default for a missing or unknown pick, so removing an option later moves its shops back to the default.
// Pure, no DOM: the site, admin and the site Worker all import it (js/layouts.test.js).
//
// Adding an option: an entry here, its markup in js/site.js (header, footer) or js/pages/home.js and
// worker/shop-page.js (hero), its CSS under [data-<area>="<id>"] in css/site.css, a thumbnail at
// admin/layouts/<area>-<id>.svg, and its entry in the design system. js/layouts.test.js checks the CSS and thumbnail.

export const LAYOUTS = {
  header: [
    { id: 'classic', label: 'Classic', hint: 'Announcement and search strip, logo on the left, menu on the right.' },
    { id: 'centered', label: 'Centered', hint: 'Big logo in the middle, menu on its own row underneath. Suits a wide or detailed logo.' },
    { id: 'bold', label: 'Bold bar', hint: 'One bar in your accent color with the logo and menu; search is an icon.' },
  ],
  hero: [
    { id: 'banner', label: 'Banner', hint: 'Headline, tagline and two buttons over your accent color or banner photo.' },
    { id: 'split', label: 'Split', hint: 'Headline on one side, your banner photo on the other. Needs a banner photo.' },
    { id: 'covers', label: "This week's covers", hint: 'Headline and six of this week’s new covers, filled in automatically.' },
    { id: 'slim', label: 'Slim', hint: 'One line and one button, so your own top block and the shelves come first.' },
  ],
  footer: [
    { id: 'full', label: 'Full', hint: 'Address, hours, social links and page links in three columns.' },
    { id: 'simple', label: 'Simple', hint: 'Logo, one line of links, and your address with today’s hours.' },
    { id: 'signup', label: 'Sign-up first', hint: 'Your newsletter sign-up leads, with a short visit and links block under it. Needs a newsletter sign-up.' },
  ],
};

/** How many covers the "This week's covers" hero shows. */
export const HERO_COVERS = 6;

const known = (area, id) => LAYOUTS[area].some((o) => o.id === id);

/**
 * The shop's picks as { header, hero, footer }. Saved settings decide; settings with no `layout` at all (the
 * built-in fallback drawn before the real settings load) use `stamped` instead, the picks the site Worker wrote on
 * <body>. Missing or unknown values are the first option.
 */
export function layoutOf(settings, stamped = {}) {
  const saved = settings?.layout;
  const from = saved === undefined ? stamped ?? {} : saved ?? {};
  return Object.fromEntries(Object.keys(LAYOUTS).map((area) => [area, known(area, from[area]) ? from[area] : LAYOUTS[area][0].id]));
}

/** New This Week split for the covers hero: its covers, and what the shelf below shows so no cover repeats. */
export function heroCovers(fresh, heroId) {
  if (heroId !== 'covers') return { covers: [], shelf: fresh };
  return { covers: fresh.slice(0, HERO_COVERS), shelf: fresh.slice(HERO_COVERS) };
}

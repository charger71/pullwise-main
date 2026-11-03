// Site config: which Supabase project the browser talks to.
//
// On the live sites this file is generated per shop by the Worker (worker/index.js) from shops.json, so it
// never changes between shops. This copy is what you get locally (python3 -m http.server) and on any domain
// that isn't in shops.json: SUPABASE_URL empty = demo mode on sample data. To try the site against a real
// project locally, put its URL and anon key here, but don't commit them.

export const SUPABASE_URL = '';
// Public anon key — safe in browser code; row-level security protects the data.
export const SUPABASE_ANON_KEY = '';

// Live sites using the shared R2 image bucket get '/__media' here (covers and series images upload through the
// Worker). Empty = pictures go to the shop's own Supabase storage.
export const MEDIA_UPLOAD_URL = '';

// Whether this shop has the pull list app (app.html): the Worker sets it from "app": true in shops.json. Locally
// and in demo mode it's on, so the app can be tried; false hides every "Get the app" link and the admin's app numbers.
export const APP_ENABLED = true;

// Whether this is the master catalog ("catalog": true in shops.json, set by the Worker). It turns on Admin → Titles'
// "Fill in from PRH", which needs the PRH key only the catalog has. Off locally and in demo mode.
export const IS_CATALOG = false;

// Google Analytics 4 measurement ID, e.g. 'G-XXXXXXXXXX'. Empty = no analytics.
export const GA_MEASUREMENT_ID = '';

// Public site origin, used for canonical links and the calendar feed.
export const SITE_URL = globalThis.location?.origin ?? '';

// What the header, menu and footer show on a first visit until the shop settings arrive (or if they can't be
// loaded at all). On the live sites the Worker fills these in per shop from its last copy of Shop Settings;
// this local / demo copy stays neutral.
export const FALLBACK_SETTINGS = { shop_name: '', timezone: 'America/New_York' };

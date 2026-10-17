// Site config: which Supabase project the browser talks to.
//
// On the live sites this file is generated per shop by the Worker (worker/index.js) from shops.json, so it
// never changes between shops. This copy is what you get locally (python3 -m http.server) and on any domain
// that isn't in shops.json: SUPABASE_URL empty = demo mode on sample data. To try the site against a real
// project locally, put its URL and anon key here, but don't commit them.

export const SUPABASE_URL = '';
// Public anon key — safe in browser code; row-level security protects the data.
export const SUPABASE_ANON_KEY = '';

// Google Analytics 4 measurement ID, e.g. 'G-XXXXXXXXXX'. Empty = no analytics.
export const GA_MEASUREMENT_ID = '';

// Public site origin, used for canonical links and the calendar feed.
export const SITE_URL = globalThis.location?.origin ?? '';

// What the header, menu and footer show on a first visit until the shop settings arrive (or if they can't be
// loaded at all). On the live sites the Worker fills these in per shop from its last copy of Shop Settings;
// this local / demo copy stays neutral.
export const FALLBACK_SETTINGS = { shop_name: '', timezone: 'America/New_York' };

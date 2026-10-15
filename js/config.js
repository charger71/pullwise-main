// Per-shop deployment config. The only file that changes between shops —
// everything else (name, hours, colors, logo…) lives in the Supabase
// `settings` row and is edited from the Shop Settings admin page.
//
// Leave SUPABASE_URL empty to run the site in demo mode on sample data.

export const SUPABASE_URL = '';
// Public anon key — safe in browser code; row-level security protects the data.
export const SUPABASE_ANON_KEY = '';

// Google Analytics 4 measurement ID, e.g. 'G-XXXXXXXXXX'. Empty = no analytics.
export const GA_MEASUREMENT_ID = '';

// Public site origin, used for canonical links and the calendar feed.
export const SITE_URL = '';

// Plain-English versions of database and network error messages, for the admin (and anywhere else an error is shown).
// friendlyError(error) takes a Supabase / PostgREST error object or an Error and returns a sentence a person can act on.
// fromError(error) returns an Error whose message is that sentence, keeping the original as .raw and the code as .code.

const TABLES = {
  reservations: 'reservations', reservation_orders: 'orders', customers: 'customers', items: 'titles', subscriptions: 'follows',
  pull_list_exclusions: 'pull list exclusions', item_creators: 'creators', event_signups: 'event signups', survey_responses: 'survey answers',
  survey_entries: 'survey entries', posts: 'news posts', events: 'events', pages: 'pages', faqs: 'FAQ entries', series_catalog: 'series',
  customer_notes: 'customer notes', customer_messages: 'sent emails', categories: 'categories', surveys: 'surveys', pull_list_log: 'pull list history',
};
const tableName = (t) => TABLES[t] ?? String(t).replace(/_/g, ' ');
const columnName = (c) => String(c).replace(/_/g, ' ');

/** Specific messages for the database's own named rules (unique indexes and check constraints). */
const RULES = {
  customers_email_key: 'Another customer already has that email address.',
  customers_user_id_key: 'That sign-in is already linked to a customer.',
  items_upc_idx: 'Another title already has that UPC.',
  items_distributor_sku_key: 'That distributor already has a title with that SKU.',
  posts_slug_key: 'Another post already uses that web address. Change it.',
  surveys_slug_key: 'Another survey already uses that link name.',
  categories_name_key: 'That category already exists.',
  categories_slug_key: 'That category already exists.',
  event_signups_email_uniq: 'That email is already signed up for this event.',
  import_exclusions_unique: 'That is already on the exclusion list.',
  reservations_order_id_item_id_key: 'That title is already on this order.',
  reservation_orders_pull_list_key: 'That customer already has a pull list.',
  subscriptions_unique: 'They already follow that.',
  survey_entries_unique: 'That email has already entered this survey.',
  customer_notes_notes_check: 'The note is too long (5,000 characters at most).',
  customers_address1_check: 'The address is too long (200 characters at most).',
  customers_city_check: 'The city is too long (100 characters at most).',
  customers_email_check: 'The email address is too long (254 characters at most).',
  customers_first_name_check: 'The first name is too long (80 characters at most).',
  customers_last_name_check: 'The last name is too long (80 characters at most).',
  customers_phone_check: 'The phone number is too long (40 characters at most).',
  customers_state_check: 'The state is too long (50 characters at most).',
  customers_zip_check: 'The zip code is too long (20 characters at most).',
  event_signups_notes_check: 'The notes are too long (500 characters at most).',
  event_signups_party_size_check: 'Party size must be between 1 and 10.',
  events_signup_capacity_check: 'Signup capacity must be more than 0, or left blank.',
  events_summary_check: 'The event summary is too long (300 characters at most).',
  faqs_question_check: 'The question needs 1 to 300 characters.',
  pages_meta_description_check: 'The search description is too long (320 characters at most).',
  pages_meta_title_check: 'The search title is too long (120 characters at most).',
  reservation_orders_contact_chk: 'An order needs a phone number or an email address.',
  reservation_orders_name_check: 'The name needs 1 to 120 characters.',
  reservation_orders_email_check: 'The email address is too long (254 characters at most).',
  reservation_orders_phone_check: 'The phone number is too long (40 characters at most).',
  reservations_quantity_check: 'Quantity must be between 1 and 100.',
  subscriptions_quantity_check: 'Quantity must be between 1 and 100.',
  series_catalog_title_check: 'The series name is too long (200 characters at most).',
  series_catalog_cover_url_check: 'The cover link is too long (1,000 characters at most).',
  items_cover_thumb_url_check: 'The cover link is too long (1,000 characters at most).',
  settings_admin_notice_check: 'The admin notice is too long (500 characters at most).',
  settings_announcement_check: 'The announcement is too long (300 characters at most).',
  settings_copyright_text_check: 'The copyright text is too long (200 characters at most).',
  settings_email_button_color_check: 'The email button color must look like #c8102e.',
  settings_email_header_color_check: 'The email header color must look like #c8102e.',
  settings_email_logo_url_check: 'The email logo link must start with https://',
  settings_arrival_email_after_hour_check: 'The sending hours need a start between 0 and 23.',
  settings_arrival_email_before_hour_check: 'The sending hours need an end between 1 and 24.',
  settings_pull_list_email_day_check: 'Pick a day of the week for the pull list email.',
  settings_pull_list_email_hour_check: 'The send hour must be between 0 and 23.',
  import_exclusions_value_check: 'That entry is too long (200 characters at most).',
};

const GENERIC = 'Something went wrong. Try again, and tell the shop owner if it keeps happening.';

export function friendlyError(error) {
  if (!error) return GENERIC;
  const msg = String(error.message ?? error.error_description ?? error ?? '');
  const code = String(error.code ?? '');
  const constraint = msg.match(/constraint "([^"]+)"/)?.[1] ?? msg.match(/unique constraint "?([^"\s]+)"?/)?.[1];

  // Our own database functions raise their messages in plain English already (error code P0001, or 42501 for refusals).
  if (code === 'P0001' || (code === '42501' && !/permission denied|row-level security|must be owner/i.test(msg))) return msg;
  // Messages written for people (owner-only checks, backup and restore refusals, etc.) are already fine.
  if (/^(Only an owner|Only staff|Staff only|Please |That |Another |Nothing was|Unknown table)/i.test(msg) && !/violates|constraint/.test(msg)) return msg;

  if (/Failed to fetch|NetworkError|Load failed|network request failed|ERR_INTERNET/i.test(msg)) return 'Couldn’t reach the server. Check your internet connection and try again.';
  if (/rate limit|too many requests|over_request_rate_limit/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  if (/Email not confirmed/i.test(msg)) return 'That email address hasn’t been confirmed yet.';
  if (code === 'PGRST301' || /\bJWT\b|token is expired|not authenticated|Invalid Refresh Token/i.test(msg)) return 'Your sign-in has expired. Reload the page and sign in again.';
  if (code === '57014' || /statement timeout/i.test(msg)) return 'That took too long. Try again, or narrow it down.';

  if (code === '23505' || /duplicate key value/i.test(msg)) return (constraint && RULES[constraint]) || 'That already exists, so it wasn’t saved.';
  if (code === '23503' || /violates foreign key/i.test(msg)) {
    const del = msg.match(/update or delete on table "(\w+)" violates foreign key constraint "[^"]*" on table "(\w+)"/);
    if (del) return `It can’t be deleted because ${tableName(del[2])} still depend on it.`;
    return 'That refers to something that no longer exists. Reload the page and try again.';
  }
  if (code === '23502' || /violates not-null constraint/i.test(msg)) {
    const col = msg.match(/column "(\w+)"/)?.[1];
    return col ? `“${columnName(col)}” is required.` : 'A required field is empty.';
  }
  if (code === '23514' || /violates check constraint/i.test(msg)) {
    if (constraint && RULES[constraint]) return RULES[constraint];
    const col = constraint?.replace(/^[a-z_]+?_(?=[a-z0-9]+(_check|_chk)$)/, '').replace(/_(check|chk)$/, '');
    return col ? `The value for “${columnName(col)}” isn’t allowed.` : 'One of the values isn’t allowed.';
  }
  if (code === '22001' || /value too long/i.test(msg)) {
    const n = msg.match(/\((\d+)\)/)?.[1];
    return n ? `One of the entries is too long (${n} characters at most).` : 'One of the entries is too long.';
  }
  if (code === '22P02' || code === '22007' || code === '22008' || /invalid input syntax|date\/time field value out of range/i.test(msg)) return 'One of the values isn’t in the right format.';
  if (code === '22003' || /out of range/i.test(msg)) return 'One of the numbers is too big or too small.';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'You don’t have permission to do that. Some actions are for owners only.';
  if (/^(42P01|42703|42883|PGRST20[0-9]|PGRST1[0-9]{2})$/.test(code) || /schema cache|does not exist|Could not find the/i.test(msg)) return 'The admin and the database are out of step (an update may still be going live). Reload the page and try again.';
  if (/Edge Function returned a non-2xx|FunctionsHttpError|FunctionsFetchError/i.test(msg)) return 'The server couldn’t do that. Try again in a moment.';
  if (/already exists|Duplicate/i.test(msg) && /resource|object|file/i.test(msg)) return 'A file with that name already exists.';
  if (/Payload too large|maximum allowed size|entity too large|exceeded the maximum/i.test(msg) || code === '413') return 'That is too big to send. Try a smaller file.';
  if (/mime type|not supported|invalid_mime/i.test(msg)) return 'That kind of file isn’t allowed here.';
  if (/Bucket not found/i.test(msg)) return 'The picture storage isn’t set up. Tell the shop owner.';
  if (/violates|relation "|syntax error|PGRST|SQLSTATE|pg_/i.test(msg)) return GENERIC;
  return msg || GENERIC;
}

/** An Error carrying the plain-English message; the original text is on .raw and the database code on .code. */
export function fromError(error) {
  const e = new Error(friendlyError(error));
  e.raw = String(error?.message ?? error ?? '');
  e.code = error?.code;
  return e;
}

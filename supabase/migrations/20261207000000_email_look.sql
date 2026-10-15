-- Admin → Emails → Look: a logo and two colors for the customer emails. All optional; when blank the
-- emails use the site logo and the site's main color, as before.

alter table public.settings
  add column email_logo_url text check (email_logo_url is null or email_logo_url ~ '^https://'),
  add column email_header_color text check (email_header_color is null or email_header_color ~ '^#[0-9a-fA-F]{6}$'),
  add column email_button_color text check (email_button_color is null or email_button_color ~ '^#[0-9a-fA-F]{6}$');

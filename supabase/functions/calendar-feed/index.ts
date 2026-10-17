// Standing iCalendar feed of all shop events. Customers subscribe to
//   webcal://<project>.supabase.co/functions/v1/calendar-feed
// and their calendar app polls it, so new events show up automatically.
//
// Deploy with:  supabase functions deploy calendar-feed --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import { htmlToText, icsText as text, icsFold as fold } from './ical.js';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// text() escapes a TEXT value; fold() keeps lines to 75 octets (RFC 5545). See ical.js.

Deno.serve(async () => {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const [{ data: settings }, { data: events, error }] = await Promise.all([
    supabase.from('settings').select('shop_name').eq('id', 1).single(),
    supabase.from('events').select('*').gte('starts_at', since).order('starts_at'),
  ]);
  if (error) return new Response('Calendar unavailable', { status: 500 });

  const shop = settings?.shop_name ?? 'Shop';
  const host = new URL(Deno.env.get('SUPABASE_URL')!).host;
  const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  const now = stamp(new Date().toISOString());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${text(shop)}//Events//EN`,
    `X-WR-CALNAME:${text(shop)} Events`,
    'X-PUBLISHED-TTL:PT6H',
    ...(events ?? []).flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:event-${e.id}@${host}`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${stamp(e.updated_at)}`,
      `DTSTART:${stamp(e.starts_at)}`,
      `DTEND:${stamp(e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 2 * 3600000).toISOString())}`,
      `SUMMARY:${text(e.title)}`,
      // Calendar apps show URL in different places (or not at all), so the link is also at the end of the description.
      `DESCRIPTION:${text(`${htmlToText(e.description)}\n\nDetails: ${site}/event.html?id=${e.id}`.trim())}`,
      `URL:${site}/event.html?id=${e.id}`,
      `LOCATION:${text(e.location ? `${shop} — ${e.location}` : shop)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
});

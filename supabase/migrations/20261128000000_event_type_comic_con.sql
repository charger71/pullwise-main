-- New event type: Comic con.
alter table public.events drop constraint events_event_type_check;
alter table public.events add constraint events_event_type_check
  check (event_type in ('signing', 'release_party', 'tournament', 'sale', 'livestream', 'comic_con', 'other'));

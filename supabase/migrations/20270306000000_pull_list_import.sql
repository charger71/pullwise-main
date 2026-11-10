-- Customer pull list import (Admin -> Import -> Pull lists). A shop moving to Pullwise uploads one spreadsheet of its
-- customers and the series each one takes. The browser reads the file and stores it here as a batch of customers and
-- lines; the database matches each title to a series; staff review every line; nothing touches customers, follows or
-- pull lists until Save (staff_import_pull_lists). No AI, and saving sends no email of any kind.
--
-- Matching, per title, first hit wins:
--   1. alias - a spelling staff corrected in an earlier review (pull_import_aliases, kept apart from series_aliases)
--   2. exact - _series_key_auto(title), which already follows series_aliases, is a series in the catalog
--              (series_catalog) or has visible titles (items.series_key)
--   3. close - the top 5 series by pg_trgm similarity, for staff to choose from
-- Staff corrections come first so that a correction ("Batman" means batman 2025) still wins once "batman" also
-- exists as a series of its own.
--
-- Saving, one customer at a time, each in its own subtransaction, so a failure rolls back only that customer and can
-- be retried without redoing the others:
--   * the customer: found by lowercased email, then phone digits, else created. An existing customer is never
--     duplicated and keeps what it has: blanks are filled in, "Mature OK" can only switch mature_ok on, "No email"
--     can only switch the weekly and arrival emails off. New customers get both emails on unless "No email".
--   * the follows: series follows inserted directly; one the customer already has is left exactly as it is
--     (_subscribe would overwrite its quantity, and refuses a series that is only in the catalog).
--   * the pull list: titles open for pre-order now are added straight away through apply_subscriptions, as when
--     staff follow a series by hand; later titles come in with the hourly sweep. Mature titles only for mature_ok.
--     A customer with no email and no phone keeps their follows but gets no titles until staff add one (see below).
--   * notes from the sheet are appended to the customer's staff notes, never replacing what is there.
-- Line detail (and the names, emails and phones held for a draft) is removed 30 days after a batch is saved or
-- discarded; a draft left untouched for 90 days is discarded.

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------

create table public.import_batches (
  id          bigint generated always as identity primary key,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  source_name text not null check (length(source_name) between 1 and 200),
  status      text not null default 'draft',
  counts      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz, -- when it was saved in full or discarded; the 30-day clock for its detail
  constraint import_batches_status_chk check (status in ('draft', 'reviewing', 'committed', 'discarded'))
);
create index import_batches_open_idx on public.import_batches (status, updated_at);
create trigger import_batches_touch before update on public.import_batches for each row execute function public.touch_updated_at();

-- One row per customer in the sheet. ref is the sheet's own grouping key (made by the browser); the contact details
-- are what the sheet said, held until Save so a draft can be resumed, and blanked by the cleanup.
create table public.import_customers (
  id               bigint generated always as identity primary key,
  batch_id         bigint not null references public.import_batches (id) on delete cascade,
  ref              text not null check (length(ref) between 1 and 300),
  first_name       text check (length(first_name) <= 80),
  last_name        text check (length(last_name) <= 80),
  email            text check (length(email) <= 254),
  phone            text check (length(phone) <= 40),
  mature_ok        boolean not null default false,
  no_email         boolean not null default false,
  customer_id      bigint references public.customers (id) on delete set null,
  was_new          boolean,
  status           text not null default 'pending',
  error            text,
  follows_added    int not null default 0,
  follows_existing int not null default 0,
  titles_added     int not null default 0,
  saved_at         timestamptz,
  unique (batch_id, ref),
  constraint import_customers_status_chk check (status in ('pending', 'saved', 'failed'))
);
create index import_customers_customer_idx on public.import_customers (customer_id);

create table public.import_lines (
  id           bigint generated always as identity primary key,
  batch_id     bigint not null references public.import_batches (id) on delete cascade,
  customer_ref text not null,
  position     int not null default 0,
  raw_title    text not null check (length(raw_title) between 1 and 300),
  raw_quantity smallint not null default 1 check (raw_quantity between 1 and 100),
  raw_notes    text check (length(raw_notes) <= 1000),
  raw_key      text, -- the title normalised like a series key, before any alias; what import aliases are keyed on
  match_key    text,
  match_method text,
  candidates   jsonb not null default '[]',
  status       text not null default 'review',
  checked_at   timestamptz, -- when matching ran on this line
  decided_by   uuid references auth.users (id) on delete set null,
  foreign key (batch_id, customer_ref) references public.import_customers (batch_id, ref) on delete cascade,
  constraint import_lines_method_chk check (match_method in ('exact', 'alias', 'close', 'staff')),
  constraint import_lines_status_chk check (status in ('matched', 'review', 'not_found', 'skipped'))
);
create index import_lines_batch_idx on public.import_lines (batch_id, customer_ref, position);
create index import_lines_unchecked_idx on public.import_lines (batch_id, id) where checked_at is null;

-- A spelling staff matched by hand -> the series it means. Used before exact matching on every later import.
create table public.pull_import_aliases (
  raw_key    text primary key check (length(raw_key) between 1 and 300),
  series_key text not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.import_batches enable row level security;
alter table public.import_customers enable row level security;
alter table public.import_lines enable row level security;
alter table public.pull_import_aliases enable row level security;
create policy "staff all import_batches" on public.import_batches for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all import_customers" on public.import_customers for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all import_lines" on public.import_lines for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all pull_import_aliases" on public.pull_import_aliases for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.import_batches, public.import_customers, public.import_lines, public.pull_import_aliases from anon, authenticated;
grant select, insert, update, delete on public.import_batches, public.import_customers, public.import_lines, public.pull_import_aliases to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------------------------------------------------

-- The title as a series key, without following any alias ("GARGOYLES (2026)" -> "gargoyles 2026").
create or replace function public._pull_import_key(p_title text)
returns text
language sql immutable
as $$
  select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(p_title, '')), '\(mr\)', ' ', 'g'), '[^a-z0-9]+', ' ', 'g')), '');
$$;

create or replace function public._pull_import_series_exists(p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_key is not null and (
    exists (select 1 from public.series_catalog where key = p_key)
    or exists (select 1 from public.items where series_key = p_key and not hidden));
$$;

create or replace function public._pull_import_label(p_key text)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(public._series_label(p_key), (select title from public.series_catalog where key = p_key), p_key);
$$;

-- Series whose name is like p_text, best first: { key, label, score }. p_contains also takes names that contain the
-- text (for the search box, where "batman" should find "Absolute Batman").
create or replace function public._pull_import_candidates(p_text text, p_limit int default 5, p_contains boolean default false)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with q as (select public._squash(p_text) as s),
  hits as (
    select i.series_key as key, i.title as label, similarity(i.title_squash, q.s) as score
    from public.items i, q
    where length(q.s) >= 2 and i.series_key is not null and not i.hidden
      and (i.title_squash % q.s or (p_contains and i.title_squash like '%' || q.s || '%'))
    union all
    select sc.key, sc.title, similarity(sc.title_squash, q.s)
    from public.series_catalog sc, q
    where length(q.s) >= 2 and (sc.title_squash % q.s or (p_contains and sc.title_squash like '%' || q.s || '%'))
  ),
  best as (
    select distinct on (public._series_resolve(key)) public._series_resolve(key) as key, score
    from hits
    order by public._series_resolve(key), score desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', b.key, 'label', public._pull_import_label(b.key), 'score', round(b.score::numeric, 2))
                            order by b.score desc, b.key), '[]'::jsonb)
  from (select * from best order by score desc, key limit p_limit) b;
$$;

-- One title through the matching order. status: matched (alias / exact), review (close candidates) or not_found.
-- A matched title's candidates hold just its series, so the review can show the series' name.
create or replace function public._pull_import_match(p_title text,
  out o_raw_key text, out o_key text, out o_method text, out o_candidates jsonb, out o_status text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_key text;
begin
  o_raw_key := public._pull_import_key(p_title);
  o_candidates := '[]';
  o_status := 'not_found';
  if o_raw_key is null then return; end if;

  select public._series_resolve(a.series_key) into v_key from public.pull_import_aliases a where a.raw_key = o_raw_key;
  if public._pull_import_series_exists(v_key) then
    o_key := v_key; o_method := 'alias'; o_status := 'matched';
    o_candidates := jsonb_build_array(jsonb_build_object('key', v_key, 'label', public._pull_import_label(v_key)));
    return;
  end if;

  v_key := public._series_resolve(public._series_key_auto(p_title));
  if public._pull_import_series_exists(v_key) then
    o_key := v_key; o_method := 'exact'; o_status := 'matched';
    o_candidates := jsonb_build_array(jsonb_build_object('key', v_key, 'label', public._pull_import_label(v_key)));
    return;
  end if;

  o_candidates := public._pull_import_candidates(p_title, 5);
  if jsonb_array_length(o_candidates) > 0 then
    o_method := 'close'; o_status := 'review';
  end if;
end;
$$;

-- An existing customer with this email (lowercased), else this phone (digits; the last 10 when both have that many).
create or replace function public._pull_import_find_customer(p_email text, p_phone text)
returns bigint
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id     bigint;
  v_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if nullif(trim(p_email), '') is not null then
    select id into v_id from public.customers where lower(email) = lower(trim(p_email)) limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  if length(v_digits) >= 7 then
    select id into v_id from public.customers
    where phone_digits = v_digits or (length(v_digits) >= 10 and length(phone_digits) >= 10 and right(phone_digits, 10) = right(v_digits, 10))
    order by id limit 1;
  end if;
  return v_id;
end;
$$;

-- Matches a batch: its customers against existing ones, and up to p_limit titles not matched yet (the screen calls it
-- until remaining is 0, which keeps each call well inside the statement timeout). Returns { remaining }.
create or replace function public.staff_import_match(p_batch bigint, p_limit int default 300)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  m record;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if not exists (select 1 from public.import_batches where id = p_batch and status in ('draft', 'reviewing')) then
    raise exception 'This import has already been saved or discarded.' using errcode = 'P0001';
  end if;
  update public.import_batches set status = 'reviewing' where id = p_batch;

  update public.import_customers ic
  set customer_id = public._pull_import_find_customer(ic.email, ic.phone)
  where ic.batch_id = p_batch and ic.status <> 'saved';
  update public.import_customers set was_new = customer_id is null where batch_id = p_batch and status <> 'saved';

  for r in
    select id, raw_title from public.import_lines
    where batch_id = p_batch and checked_at is null
    order by id limit greatest(1, least(coalesce(p_limit, 300), 1000))
  loop
    select * into m from public._pull_import_match(r.raw_title);
    update public.import_lines
    set raw_key = m.o_raw_key, match_key = m.o_key, match_method = m.o_method, candidates = m.o_candidates,
        status = case when status = 'skipped' then status else m.o_status end, checked_at = now()
    where id = r.id;
  end loop;

  return jsonb_build_object('remaining', (select count(*) from public.import_lines where batch_id = p_batch and checked_at is null));
end;
$$;

-- Staff decide a line: a series key (picked from the candidates, found by search or just added to the catalog), or
-- null to skip it. A series choice is saved as an import alias for that spelling, and the batch's other lines with
-- the same spelling that are still waiting take it too. Returns { key, label, also }.
create or replace function public.staff_import_decide(p_line bigint, p_series_key text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  l      public.import_lines;
  v_key  text;
  v_pick jsonb;
  v_also int := 0;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into l from public.import_lines where id = p_line for update;
  if l.id is null then raise exception 'That line is no longer in the import.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.import_batches where id = l.batch_id and status in ('draft', 'reviewing')) then
    raise exception 'This import has already been saved or discarded.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.import_customers where batch_id = l.batch_id and ref = l.customer_ref and status = 'saved') then
    raise exception 'This customer has already been saved.' using errcode = 'P0001';
  end if;

  if p_series_key is null then
    update public.import_lines set status = 'skipped', decided_by = auth.uid(), checked_at = coalesce(checked_at, now()) where id = l.id;
  else
    v_key := public._series_resolve(p_series_key);
    if not public._pull_import_series_exists(v_key) then
      raise exception 'We couldn''t find that series.' using errcode = 'P0001';
    end if;
    v_pick := jsonb_build_array(jsonb_build_object('key', v_key, 'label', public._pull_import_label(v_key)));
    update public.import_lines
    set status = 'matched', match_key = v_key, match_method = 'staff', decided_by = auth.uid(), checked_at = coalesce(checked_at, now()),
        candidates = case when candidates @> jsonb_build_array(jsonb_build_object('key', v_key)) then candidates else candidates || v_pick end
    where id = l.id;
    if l.raw_key is not null then
      insert into public.pull_import_aliases (raw_key, series_key) values (l.raw_key, v_key)
      on conflict (raw_key) do update set series_key = excluded.series_key, created_by = auth.uid(), created_at = now();
      update public.import_lines o
      set status = 'matched', match_key = v_key, match_method = 'alias',
          candidates = case when o.candidates @> jsonb_build_array(jsonb_build_object('key', v_key)) then o.candidates else o.candidates || v_pick end
      where o.batch_id = l.batch_id and o.raw_key = l.raw_key and o.id <> l.id and o.status in ('review', 'not_found')
        and not exists (select 1 from public.import_customers c where c.batch_id = o.batch_id and c.ref = o.customer_ref and c.status = 'saved');
      get diagnostics v_also = row_count;
    end if;
  end if;
  update public.import_batches set updated_at = now() where id = l.batch_id;
  return jsonb_build_object('key', v_key, 'label', public._pull_import_label(v_key), 'also', v_also);
end;
$$;

-- The review's series search: catalog and title series whose name is like or contains the text.
create or replace function public.staff_import_find_series(p_q text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return public._pull_import_candidates(left(p_q, 200), 10, true);
end;
$$;

-- A title that isn't a series yet: add it to the series catalog (as Admin -> Series does) and match the line to it.
create or replace function public.staff_import_add_series(p_line bigint, p_title text, p_publisher text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public._series_key_auto(left(trim(coalesce(p_title, '')), 200));
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if v_key is null then raise exception 'Enter the series name.' using errcode = 'P0001'; end if;
  perform public.staff_add_series(jsonb_build_array(jsonb_build_object('title', trim(p_title), 'publisher', p_publisher)));
  return public.staff_import_decide(p_line, v_key);
end;
$$;

create or replace function public.staff_import_discard(p_batch bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  update public.import_batches set status = 'discarded', finished_at = now() where id = p_batch and status in ('draft', 'reviewing');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The hourly sweep and customers with no email and no phone
-- ---------------------------------------------------------------------------------------------------------------------
-- The import may create a customer with neither (staff are warned in review). A pull list order needs one of the two
-- (reservation_orders_contact_chk), and one failing insert stopped the whole sweep for every customer. The sweep now
-- passes over such customers; their titles come in on the first sweep after staff add a phone or an email. Only that
-- condition changes, so it is patched into the current function the way 20261216000000 patched staff_save_customer.
do $$
declare
  v_src text := pg_get_functiondef('public.apply_subscriptions(bigint, int)'::regprocedure);
  v_old text := $old$    where (cu.mature_ok or not oi.mature)$old$;
  v_new text := $new$    where (cu.email is not null or cu.phone is not null) -- a pull list order needs one of them
      and (cu.mature_ok or not oi.mature)$new$;
begin
  if position(v_old in v_src) = 0 then
    raise exception 'could not patch apply_subscriptions: mature check not found';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Saving
-- ---------------------------------------------------------------------------------------------------------------------

-- Finds or creates the customer, fills in what they don't have yet, and returns their id.
create or replace function public._pull_import_customer(r public.import_customers, out o_id bigint, out o_new boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := nullif(lower(trim(r.email)), '');
  v_phone text := nullif(trim(r.phone), '');
  v_first text := nullif(trim(r.first_name), '');
  v_last  text := nullif(trim(r.last_name), '');
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null; -- flagged in review; saved without it rather than not at all
  end if;
  o_id := public._pull_import_find_customer(v_email, v_phone);
  o_new := o_id is null;
  if o_new then
    if v_first is null then
      raise exception 'This customer has no name in the sheet.' using errcode = 'P0001';
    end if;
    insert into public.customers (first_name, last_name, email, phone, mature_ok, email_opt_in, notify_arrivals)
    values (v_first, v_last, v_email, v_phone, r.mature_ok, not r.no_email, not r.no_email)
    returning id into o_id;
  else
    update public.customers c set
      first_name      = coalesce(c.first_name, v_first),
      last_name       = coalesce(c.last_name, v_last),
      -- an email another customer already has stays with them
      email           = coalesce(c.email, case when not exists (select 1 from public.customers x where lower(x.email) = v_email) then v_email end),
      phone           = coalesce(c.phone, v_phone),
      mature_ok       = c.mature_ok or r.mature_ok,
      email_opt_in    = c.email_opt_in and not r.no_email,
      notify_arrivals = c.notify_arrivals and not r.no_email
    where c.id = o_id;
  end if;
end;
$$;

-- Saves one sheet customer: the customer, their follows, their notes and (for new follows) the open titles.
create or replace function public._pull_import_save_customer(r public.import_customers)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c          record;
  f          record;
  v_id       bigint;
  v_follows  int;
  v_added    int := 0;
  v_existing int := 0;
  v_before   int;
  v_titles   int := 0;
  v_waiting  int;
  v_notes    text;
begin
  select count(*) into v_waiting from public.import_lines
  where batch_id = r.batch_id and customer_ref = r.ref and status in ('review', 'not_found');
  if v_waiting > 0 then
    raise exception '% % still % a decision.', v_waiting, case when v_waiting = 1 then 'title' else 'titles' end,
      case when v_waiting = 1 then 'needs' else 'need' end using errcode = 'P0001';
  end if;

  select * into c from public._pull_import_customer(r);
  v_id := c.o_id;

  select count(*) into v_follows from public.subscriptions where customer_id = v_id;
  for f in
    select public._series_resolve(match_key) as key, max(raw_quantity) as quantity
    from public.import_lines
    where batch_id = r.batch_id and customer_ref = r.ref and status = 'matched' and match_key is not null
    group by 1 order by 1
  loop
    if not public._pull_import_series_exists(f.key) then
      raise exception 'The series “%” is no longer in the catalog.', f.key using errcode = 'P0001';
    end if;
    if exists (select 1 from public.subscriptions where customer_id = v_id and kind = 'series' and key = f.key) then
      v_existing := v_existing + 1; -- left exactly as it is
      continue;
    end if;
    if v_follows >= 200 then
      raise exception 'That''s more than 200 follows for one customer.' using errcode = 'P0001';
    end if;
    insert into public.subscriptions (customer_id, kind, key, label, role, quantity)
    values (v_id, 'series', f.key, public._pull_import_label(f.key), null, f.quantity)
    on conflict (customer_id, kind, key, coalesce(role, '')) do nothing;
    v_added := v_added + 1;
    v_follows := v_follows + 1;
  end loop;

  select string_agg(format('Imported – %s: %s', raw_title, trim(raw_notes)), E'\n' order by position, id) into v_notes
  from public.import_lines
  where batch_id = r.batch_id and customer_ref = r.ref and nullif(trim(raw_notes), '') is not null;
  if v_notes is not null then
    insert into public.customer_notes (customer_id, notes, updated_by)
    values (v_id, left(v_notes, 5000), auth.uid())
    on conflict (customer_id) do update
      set notes = left(public.customer_notes.notes || E'\n\n' || excluded.notes, 5000), updated_at = now(), updated_by = auth.uid();
  end if;

  if v_added > 0 then
    select count(*) into v_before from public.reservations x join public.reservation_orders o on o.id = x.order_id where o.customer_id = v_id;
    perform public.apply_subscriptions(v_id);
    select count(*) - v_before into v_titles from public.reservations x join public.reservation_orders o on o.id = x.order_id where o.customer_id = v_id;
  end if;

  return jsonb_build_object('customer_id', v_id, 'was_new', c.o_new, 'follows_added', v_added, 'follows_existing', v_existing, 'titles_added', v_titles,
    'no_contact', not exists (select 1 from public.customers where id = v_id and (email is not null or phone is not null)));
end;
$$;

-- Saves the customers of a batch that aren't saved yet (only p.refs when given). Each customer is its own unit: one
-- that fails is rolled back alone, marked failed with the reason, and saved by calling this again. p.final = true on
-- the last call of a Save writes the job log entry. Returns { results: [{ ref, status, ... }], counts, done }.
create or replace function public.staff_import_pull_lists(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_batch   bigint := (p ->> 'batch_id')::bigint;
  v_refs    text[] := case when jsonb_typeof(p -> 'refs') = 'array' then array(select jsonb_array_elements_text(p -> 'refs')) end;
  b         public.import_batches;
  r         public.import_customers;
  v_res     jsonb;
  v_results jsonb := '[]';
  v_counts  jsonb;
  v_done    boolean;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into b from public.import_batches where id = v_batch for update;
  if b.id is null then raise exception 'That import no longer exists.' using errcode = 'P0001'; end if;
  if b.status not in ('draft', 'reviewing') then
    raise exception 'This import has already been saved or discarded.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.import_lines where batch_id = v_batch and checked_at is null) then
    raise exception 'The titles haven''t all been matched yet.' using errcode = 'P0001';
  end if;

  for r in
    select * from public.import_customers
    where batch_id = v_batch and status <> 'saved' and (v_refs is null or ref = any (v_refs))
    order by id
  loop
    begin
      v_res := public._pull_import_save_customer(r);
      update public.import_customers set
        status = 'saved', error = null, saved_at = now(),
        customer_id = (v_res ->> 'customer_id')::bigint, was_new = (v_res ->> 'was_new')::boolean,
        follows_added = (v_res ->> 'follows_added')::int, follows_existing = (v_res ->> 'follows_existing')::int,
        titles_added = (v_res ->> 'titles_added')::int
      where id = r.id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('ref', r.ref, 'status', 'saved') || v_res);
    exception when others then
      -- everything this customer did is rolled back; record why
      update public.import_customers set status = 'failed', error = left(sqlerrm, 500) where id = r.id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('ref', r.ref, 'status', 'failed', 'error', left(sqlerrm, 500)));
    end;
  end loop;

  select jsonb_build_object(
    'customers', count(*),
    'saved', count(*) filter (where status = 'saved'),
    'failed', count(*) filter (where status = 'failed'),
    'pending', count(*) filter (where status = 'pending'),
    'new', count(*) filter (where status = 'saved' and was_new),
    'existing', count(*) filter (where status = 'saved' and not was_new),
    'follows_added', coalesce(sum(follows_added), 0),
    'follows_existing', coalesce(sum(follows_existing), 0),
    'titles_added', coalesce(sum(titles_added), 0)
  ) into v_counts
  from public.import_customers where batch_id = v_batch;
  v_counts := v_counts || (
    select jsonb_build_object('lines', count(*), 'matched', count(*) filter (where status = 'matched'), 'skipped', count(*) filter (where status = 'skipped'))
    from public.import_lines where batch_id = v_batch);
  v_done := (v_counts ->> 'saved')::int = (v_counts ->> 'customers')::int;

  update public.import_batches
  set counts = v_counts,
      status = case when v_done then 'committed' else 'reviewing' end,
      finished_at = case when v_done then now() end
  where id = v_batch;

  if coalesce((p ->> 'final')::boolean, false) then
    insert into public.job_log (job, ok, message, detail)
    values ('pull_import', (v_counts ->> 'failed')::int = 0,
      format('%s: %s of %s customers saved (%s new, %s already in Pullwise), %s follows added, %s titles added to pull lists%s',
        b.source_name, v_counts ->> 'saved', v_counts ->> 'customers', v_counts ->> 'new', v_counts ->> 'existing',
        v_counts ->> 'follows_added', v_counts ->> 'titles_added',
        case when (v_counts ->> 'failed')::int > 0 then format(', %s failed', v_counts ->> 'failed') else '' end),
      v_counts || jsonb_build_object('batch_id', v_batch, 'by', auth.uid()));
  end if;

  return jsonb_build_object('results', v_results, 'counts', v_counts, 'done', v_done);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Cleanup: daily. Drafts untouched for 90 days are discarded; 30 days after a batch is saved or discarded its lines
-- are deleted and its customers' names, emails and phones blanked (the link to the customer record stays).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.pull_import_cleanup()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  update public.import_batches set status = 'discarded', finished_at = now()
  where status in ('draft', 'reviewing') and updated_at < now() - interval '90 days';
  delete from public.import_lines l using public.import_batches b
  where l.batch_id = b.id and b.status in ('committed', 'discarded') and b.finished_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  update public.import_customers ic set first_name = null, last_name = null, email = null, phone = null, error = null
  from public.import_batches b
  where ic.batch_id = b.id and b.status in ('committed', 'discarded') and b.finished_at < now() - interval '30 days'
    and (ic.first_name is not null or ic.last_name is not null or ic.email is not null or ic.phone is not null or ic.error is not null);
  return v_n;
end;
$$;

revoke execute on function
  public._pull_import_key(text), public._pull_import_series_exists(text), public._pull_import_label(text),
  public._pull_import_candidates(text, int, boolean), public._pull_import_match(text),
  public._pull_import_find_customer(text, text), public._pull_import_customer(public.import_customers),
  public._pull_import_save_customer(public.import_customers), public.pull_import_cleanup()
from public, anon, authenticated;

revoke execute on function
  public.staff_import_match(bigint, int), public.staff_import_decide(bigint, text), public.staff_import_find_series(text),
  public.staff_import_add_series(bigint, text, text), public.staff_import_discard(bigint), public.staff_import_pull_lists(jsonb)
from public, anon;
grant execute on function
  public.staff_import_match(bigint, int), public.staff_import_decide(bigint, text), public.staff_import_find_series(text),
  public.staff_import_add_series(bigint, text, text), public.staff_import_discard(bigint), public.staff_import_pull_lists(jsonb)
to authenticated;

select cron.schedule('pull-import-cleanup', '40 3 * * *', 'select public.pull_import_cleanup()');

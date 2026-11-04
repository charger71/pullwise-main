-- New event signups: staff see how many signups nobody has looked at yet (a count on Admin → Events in the menu, on the
-- Event Signups tab and under Dashboard → Needs Attention). Opening Event Signups, or one event's signups, marks them read.
--
--   * event_signups.seen: false until staff open the signups. Signups already in are marked read, so the count starts
--     at nothing new instead of every signup ever.
--   * Staff mark them read with a plain update (they can already change signups). `seen` joins the bookkeeping columns
--     the audit log skips, so looking at signups doesn't add an entry to Staff → Activity.

alter table public.event_signups add column seen boolean not null default false;
update public.event_signups set seen = true;
create index event_signups_unseen_idx on public.event_signups (event_id) where not seen;

create or replace function public._audit_diff(o jsonb, n jsonb, k text, names_only boolean)
returns jsonb
language plpgsql immutable
as $$
declare
  v_changed jsonb;
begin
  select jsonb_object_agg(e.key, case when names_only then 'true'::jsonb
                                      else jsonb_build_object('from', public._audit_cell(o -> e.key), 'to', public._audit_cell(e.value)) end)
  into v_changed
  from jsonb_each(n) e
  where e.key <> all (array['updated_at', 'series_key', 'search_norm', 'arrival_rank', 'title_squash', 'seen']) and (o -> e.key) is distinct from e.value;
  if v_changed is null then return null; end if;
  return public._audit_label(n, k) || jsonb_build_object('changed', v_changed);
end;
$$;

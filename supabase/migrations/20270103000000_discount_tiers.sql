-- Pull list discount: tiers by number of distinct series on a customer's active pull list, plus an
-- on/off switch. Edited in Shop settings. Tiers: [{ "min": series needed, "pct": percent off }, ...].

create or replace function public._valid_discount_tiers(t jsonb)
returns boolean language plpgsql immutable as $$
declare
  e jsonb;
  prev int := 0;
  m numeric;
  p numeric;
begin
  if t is null or jsonb_typeof(t) <> 'array' or jsonb_array_length(t) > 10 then return false; end if;
  for e in select * from jsonb_array_elements(t) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'min') <> 'number' or jsonb_typeof(e->'pct') <> 'number' then return false; end if;
    m := (e->>'min')::numeric;
    p := (e->>'pct')::numeric;
    if m <> trunc(m) or p <> trunc(p) or m <= prev or m > 1000 or p < 0 or p > 100 then return false; end if;
    prev := m::int;
  end loop;
  return true;
end $$;

alter table public.settings
  add column discount_enabled boolean not null default true,
  add column discount_tiers jsonb not null default '[{"min":1,"pct":10},{"min":16,"pct":15},{"min":31,"pct":20},{"min":51,"pct":25}]'
    check (public._valid_discount_tiers(discount_tiers));

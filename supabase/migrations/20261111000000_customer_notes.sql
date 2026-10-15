-- Staff-only notes about a customer (shown in Admin → Customers, never on the public site).
--
-- Kept in its own table, not a column on public.customers: customers can SELECT their own
-- customers row (including every column), so a notes column there would be readable by the
-- customer. This table has RLS for staff only and no customer policy, so a customer's
-- login sees nothing from it.

create table public.customer_notes (
  customer_id bigint primary key references public.customers (id) on delete cascade,
  notes       text not null check (length(notes) <= 5000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

alter table public.customer_notes enable row level security;
create policy "staff all customer_notes" on public.customer_notes for all using (public.is_staff()) with check (public.is_staff());

revoke all on public.customer_notes from anon;
revoke all on public.customer_notes from authenticated;
grant select, insert, update, delete on public.customer_notes to authenticated;

-- Saves (or clears) a customer's notes. Empty text removes the row.
create or replace function public.staff_save_customer_notes(p_customer bigint, p_notes text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_notes, '')), '') is null then
    delete from public.customer_notes where customer_id = p_customer;
  else
    insert into public.customer_notes (customer_id, notes, updated_by)
    values (p_customer, trim(p_notes), auth.uid())
    on conflict (customer_id) do update set notes = excluded.notes, updated_at = now(), updated_by = auth.uid();
  end if;
end;
$$;
revoke execute on function public.staff_save_customer_notes(bigint, text) from public, anon;
grant execute on function public.staff_save_customer_notes(bigint, text) to authenticated;

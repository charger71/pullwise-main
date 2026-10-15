-- Emails staff send to one customer from the admin (the compose box that opens from any customer
-- email link). The Edge Function writes a row for each message it sends; staff can read them.

create table public.customer_messages (
  id           bigint generated always as identity primary key,
  customer_id  bigint references public.customers (id) on delete set null,
  to_email     text not null,
  subject      text not null,
  body         text not null,
  sent_by      text,
  created_at   timestamptz not null default now()
);
create index customer_messages_customer_idx on public.customer_messages (customer_id, created_at desc);

alter table public.customer_messages enable row level security;
create policy "staff read customer messages" on public.customer_messages for select using (public.is_staff());

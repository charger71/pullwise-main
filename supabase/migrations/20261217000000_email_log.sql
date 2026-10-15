-- A log of every email the site sends (Admin -> Emails -> Email log). The Edge functions that send mail
-- write a row for each one, with the plain-text body so staff can see exactly what a customer received.
-- kind: weekly | arrival | message (staff to one customer) | test | inquiry (the Sell form)

create table public.email_log (
  id           bigint generated always as identity primary key,
  kind         text not null,
  to_email     text not null,
  customer_id  bigint references public.customers (id) on delete set null,
  subject      text not null,
  body         text,
  status       text not null default 'sent' check (status in ('sent', 'failed')),
  error        text,
  sent_by      text,
  -- Emails from one scheduled or "send now" run share a run_id, so the log can show the run as one entry.
  run_id       uuid,
  created_at   timestamptz not null default now()
);
create index email_log_created_idx on public.email_log (created_at desc);
create index email_log_customer_idx on public.email_log (customer_id, created_at desc);
create index email_log_run_idx on public.email_log (run_id) where run_id is not null;

alter table public.email_log enable row level security;
-- Staff read; only the Edge functions (service role) write.
create policy "staff read email log" on public.email_log for select using (public.is_staff());

-- One row per run (or per single email), for the grouped view of the log.
create view public.email_log_groups with (security_invoker = true) as
select coalesce(run_id::text, 'e' || id::text) as group_key,
       run_id,
       kind,
       min(created_at) as created_at,
       count(*) as total,
       count(*) filter (where status = 'failed') as failed,
       (array_agg(id order by id))[1] as first_id,
       (array_agg(to_email order by id))[1] as to_email,
       (array_agg(subject order by id))[1] as subject,
       (array_agg(sent_by order by id))[1] as sent_by
from public.email_log
group by coalesce(run_id::text, 'e' || id::text), run_id, kind;

-- Messages staff already sent from the customer compose box.
insert into public.email_log (kind, to_email, customer_id, subject, body, status, sent_by, created_at)
select 'message', to_email, customer_id, subject, body, 'sent', sent_by, created_at from public.customer_messages;

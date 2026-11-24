-- Shop news in the pull list app: staff write their own notification (a sale, a big new release, a closure) and send
-- it to every app user who has notifications on (Admin → Notifications).
--
--   * customers.push_news: the customer's own on/off for shop news (App → Account → Notifications), so someone who
--     doesn't want them keeps their pickup alerts
--   * news_pushes: one row per send, real or test, with who sent it and how many devices got it. Only the Edge
--     Function `push-notify` (mode `news`, service role) writes it; staff read it for the screen's history.
--   * push_news_reach(): how many devices a send would reach right now, for the screen

alter table public.customers add column push_news boolean not null default true;
grant update (push_news) on public.customers to authenticated;

create table public.news_pushes (
  id           bigint generated always as identity primary key,
  request_id   uuid   not null unique,
  title        text   not null check (length(title) between 1 and 120),
  body         text   not null check (length(body) between 1 and 400),
  url          text   not null default '/app' check (url ~ '^/([^/]|$)' and length(url) <= 300),
  test         boolean not null default false,
  sent_by      uuid   references auth.users (id) on delete set null,
  sent_by_name text   check (length(sent_by_name) <= 200),
  status       text   not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error        text   check (length(error) <= 500),
  devices      integer not null default 0,
  sent         integer not null default 0,
  failed       integer not null default 0,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index news_pushes_created_idx on public.news_pushes (created_at desc);
alter table public.news_pushes enable row level security;
create policy "staff read news pushes" on public.news_pushes for select using ((select public.is_staff()));

-- Devices a shop news send reaches now: every subscribed device of a customer with shop news on.
create or replace function public.push_news_reach()
returns integer
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = 'P0001';
  end if;
  return (select count(*)::integer from public.push_subscriptions s join public.customers c on c.id = s.customer_id where c.push_news);
end;
$$;
revoke execute on function public.push_news_reach() from public, anon;
grant execute on function public.push_news_reach() to authenticated;

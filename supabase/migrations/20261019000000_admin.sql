-- Support for the full staff admin.

-- Imports run from the admin page record their result like the command-line
-- importer does, so staff need to write the job log (still read-only to the public).
create policy "staff insert job_log" on public.job_log for insert with check (public.is_staff());

-- Publishers pinned to the top of the Publisher filter, in this order (per shop).
alter table public.settings
  add column pinned_publishers text[] not null default array['Marvel', 'DC', 'Image', 'Dark Horse', 'BOOM!', 'IDW', 'Dynamite'];

-- Lets the admin (and the fetch-cover function) check staff status for the signed-in user.
grant execute on function public.is_staff() to authenticated;

-- Reservation lines: staff look these up by order and by status constantly.
create index if not exists reservations_status_idx on public.reservations (status);

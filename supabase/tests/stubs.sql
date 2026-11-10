-- Stand-ins for the parts of a hosted Supabase project that plain Postgres doesn't have (roles, auth, storage, vault,
-- pg_net, pg_cron), so the migrations can be applied to a scratch local database for the SQL tests in this folder.
-- Only what the migrations touch, and nothing works for real: http_post records nothing, cron.schedule only stores
-- the job. Never apply this to a real project. Used by tools/test-db.sh.

set client_min_messages = error;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists net;
create schema if not exists cron;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data  jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz
);

-- The signed-in user comes from the test's `set local request.jwt.claim.sub = '<uuid>'`.
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable
as $$ select jsonb_build_object('sub', auth.uid(), 'role', auth.role()) $$;

create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text,
  owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable
as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(secret text, name text default null, description text default null)
returns uuid language sql as $$ insert into vault.secrets (name, secret, description) values (name, secret, description) returning id $$;
create or replace function vault.update_secret(id uuid, secret text default null, name text default null, description text default null)
returns void language sql as $$ update vault.secrets s set secret = coalesce($2, s.secret), name = coalesce($3, s.name) where s.id = $1 $$;

create table if not exists net._http_response (id bigint, status_code int, content text, created timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ select 0::bigint $$;
create or replace function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ select 0::bigint $$;

create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create table if not exists cron.job_run_details (runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql
as $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(job_name text) returns boolean language sql
as $$ with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d) $$;

set client_min_messages = error;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;

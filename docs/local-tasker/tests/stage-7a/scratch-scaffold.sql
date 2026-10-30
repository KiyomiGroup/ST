-- SCRATCH stand-ins for Stage 7A tests (NOT the real project). Only what stage-7a-core.sql and stage-7a-tests.sql touch.
create schema if not exists auth;
create table auth.users (id uuid primary key, aud text, role text, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create table public.users (id uuid primary key, name text, role text, profile_details jsonb);
create table public.local_tasker_profiles (tasker_user_id uuid primary key references auth.users(id), full_name text not null, phone text not null, status text not null default 'draft');
create table public.bookings (id uuid primary key default gen_random_uuid(), customer_id uuid references public.users(id), tasker_id uuid references public.users(id),
  status text, payment_status text, amount numeric);
-- STAND-IN: real body is select 0.12::numeric (owner decision log, Stage 1C)
create function public.platform_fee_rate() returns numeric language sql immutable as $$ select 0.12::numeric $$;

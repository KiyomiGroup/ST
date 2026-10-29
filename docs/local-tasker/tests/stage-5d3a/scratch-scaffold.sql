-- SCRATCH ONLY (stage 5D-3a). Same stand-ins as stage 5D-2 plus a minimal local_booking_quotes (the real table has many more columns). NOT the real schema.
-- Load order on a plain Postgres: this file, stage-5d2-core.sql, stage-5d3a-core.sql, stage-5d3a-tests.sql.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
grant usage on schema public, auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, aud text, role text, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table public.coordinators (user_id uuid primary key, display_name text, status text not null default 'pending');
create function public.is_active_coordinator(p_user uuid) returns boolean language sql security definer as $$ select exists(select 1 from public.coordinators where user_id=p_user and status='active') $$;
create function public.is_local_tasker_admin() returns boolean language sql security definer as $$ select coalesce(current_setting('st.test_admin', true), '') = '1' $$;
create table public.local_tasker_audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), action text, entity text, entity_id text, before_data jsonb, after_data jsonb, actor_id uuid);
create function public.local_tasker_audit(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_actor uuid) returns uuid language plpgsql security definer as $$
declare v uuid; begin insert into public.local_tasker_audit_log(action,entity,entity_id,before_data,after_data,actor_id) values (p_action,p_entity,p_entity_id,p_before,p_after,p_actor) returning id into v; return v; end $$;
create table public.bookings (id uuid primary key default gen_random_uuid(), customer_id uuid, tasker_id uuid, status text default 'pending', payment_status text, amount numeric, completion_code text);
create table public.payment_requests (id uuid primary key default gen_random_uuid(), booking_id uuid, status text default 'pending', amount numeric);
create table public.payment_intents (id uuid primary key default gen_random_uuid(), booking_id uuid, amount numeric);
create table public.job_disputes (booking_id uuid, status text);
create function public.job_booking_frozen(p_booking uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.job_disputes d where d.booking_id = p_booking and d.status = 'open') $$;
-- 5D-1 pre-flight stand-ins
create table public.local_booking_quote_decisions (id uuid primary key default gen_random_uuid());
create function public.local_booking_decide_quote(uuid, integer, uuid, text, text) returns jsonb language sql as $$ select '{}'::jsonb $$;

-- REAL 5A objects (copied from stage-5a1-core.sql)
create table public.local_booking_state (
  booking_id uuid primary key references public.bookings(id) on delete cascade, tasker_user_id uuid not null, coordinator_id uuid, original_coordinator_id uuid,
  lt_status text not null default 'assigned', resume_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint local_booking_state_status_check check (lt_status in ('needs_reassignment', 'assigned', 'awaiting_tasker_confirmation', 'tasker_confirmed', 'tasker_declined', 'quote_sent', 'quote_approved', 'quote_declined')));
create table public.local_booking_events (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, kind text not null,
  from_status text, to_status text, coordinator_id uuid, previous_coordinator_id uuid, actor_id uuid, actor_role text, note text, created_at timestamptz not null default clock_timestamp());
create function public._local_booking_is_open(p_status text) returns boolean language sql immutable as $$ select coalesce(p_status, 'pending') not in ('completed', 'cancelled', 'rejected', 'declined') $$;
create function public._local_booking_log(p_booking uuid, p_kind text, p_from text, p_to text, p_coord uuid, p_prev uuid, p_actor uuid, p_role text, p_note text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.local_booking_events (booking_id, kind, from_status, to_status, coordinator_id, previous_coordinator_id, actor_id, actor_role, note)
  values (p_booking, p_kind, p_from, p_to, p_coord, p_prev, p_actor, p_role, left(nullif(btrim(coalesce(p_note, '')), ''), 300)) $$;
grant select, insert, update on public.bookings to authenticated;
-- 5D-3a stand-in: only the columns the no-show rule reads (booking_id, superseded_at, created_at). The real table is stage-5c2-core.sql.
create table public.local_booking_quotes (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, superseded_at timestamptz, created_at timestamptz not null default now());

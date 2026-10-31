-- SCRATCH POSTGRES ONLY. NEVER RUN THIS IN SUPABASE.
-- STAND-INS for the real StreetTasker objects that v1b2 touches. Names, columns and signatures come
-- from sql/verification/results/ (block1-columns, v1b2-block1-functions, v1b2-block3-coordinators-columns).
-- Only columns v1b2 uses (plus ids/NOT NULLs) are reproduced. local_tasker_scrub is a pass-through
-- here because its real source was not seen. _notify and local_tasker_audit are the REAL source text.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.users (
  id uuid primary key, name text, role text default 'customer',
  first_name text, last_name text, dob date,
  is_verified boolean default false, verified_at timestamptz);
create table public.taskers (
  id text primary key default gen_random_uuid()::text, user_id text,
  is_verified boolean default false, verified boolean default false, verified_at timestamptz);
create table public.local_tasker_profiles (
  tasker_user_id uuid primary key, full_name text, phone text, status text not null default 'draft',
  verification_method text check (verification_method is null or char_length(verification_method) <= 40),
  verified_at timestamptz, verified_by uuid, verification_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null, title text not null,
  message text, data jsonb default '{}'::jsonb, is_read boolean default false, created_at timestamptz default now());
create table public.coordinators (
  user_id uuid primary key, display_name text, status text not null, created_at timestamptz not null default now());
create table public.coordinator_assignments (
  id uuid primary key default gen_random_uuid(), coordinator_id uuid not null, tasker_user_id uuid not null,
  assigned_by uuid, assign_reason text, ended_at timestamptz);
create table public.support_staff (user_id uuid primary key);
create table public.local_tasker_audit_log (
  id uuid primary key default gen_random_uuid(), actor_id uuid, actor_role text, action text not null,
  entity text, entity_id text, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());

create function public.local_tasker_scrub(p jsonb) returns jsonb language sql immutable as $$ select p $$;

create function public.local_tasker_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'The audit log is append-only: rows cannot be changed or deleted.' using errcode = 'P0001';
end $$;
create trigger audit_no_change before update or delete on public.local_tasker_audit_log
  for each row execute function public.local_tasker_audit_append_only();

create function public._notify(p_user uuid, p_type text, p_title text, p_msg text, p_data jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, type, title, message, data, is_read)
  values (p_user, p_type, p_title, p_msg, p_data, false);
exception when others then
  null;   -- a notification problem must never block money movement
end $$;

create function public.local_tasker_audit(p_action text, p_entity text, p_entity_id text default null,
  p_before jsonb default null, p_after jsonb default null, p_actor uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := coalesce(auth.uid(), p_actor); v_role text; v_id uuid;
begin
  v_role := case
    when v_actor is null then 'system'
    when exists (select 1 from public.support_staff s where s.user_id = v_actor) then 'admin'
    when exists (select 1 from public.coordinators c where c.user_id = v_actor) then 'coordinator'
    else 'other' end;
  insert into public.local_tasker_audit_log (actor_id, actor_role, action, entity, entity_id, before_data, after_data)
  values (v_actor, v_role, p_action, p_entity, p_entity_id,
          public.local_tasker_scrub(p_before), public.local_tasker_scrub(p_after))
  returning id into v_id;
  return v_id;
end $$;

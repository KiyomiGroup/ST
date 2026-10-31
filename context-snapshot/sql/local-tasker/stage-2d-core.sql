-- Stage 2D (2D-1): server-only SQL to create a Local Tasker, all or nothing.
-- Additive and re-runnable. Rollback: stage-2d-rollback.sql.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- Creates: table local_tasker_create_requests (idempotency ledger) and functions
--          local_tasker_identity_email, local_tasker_find_request, create_local_tasker.
-- Changes NO existing object. The table and all three functions are SERVER ONLY (service_role).

-- 1. Idempotency ledger: one row per creation request. A retry with the same request_id
--    returns the same Local Tasker and never creates a second identity.
create table if not exists public.local_tasker_create_requests (
  request_id      uuid primary key,
  coordinator_id  uuid not null references public.coordinators(user_id) on delete restrict,
  tasker_user_id  uuid not null unique references auth.users(id) on delete restrict,
  created_at      timestamptz not null default now()
);
alter table public.local_tasker_create_requests enable row level security;   -- no policies = deny-all
revoke all on table public.local_tasker_create_requests from public, anon, authenticated;

-- 2. Deterministic non-deliverable email for the placeholder identity of one request.
create or replace function public.local_tasker_identity_email(p_request uuid)
returns text language sql immutable set search_path = public, pg_temp as $$
  select 'lt-' || p_request::text || '@local-tasker.invalid'
$$;

-- 3. Lookup used by the Edge Function before and after it calls the Auth admin API.
create or replace function public.local_tasker_find_request(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.local_tasker_create_requests; v_ident uuid;
begin
  select * into r from public.local_tasker_create_requests where request_id = p_request;
  select u.id into v_ident from auth.users u where u.email = public.local_tasker_identity_email(p_request);
  return jsonb_build_object(
    'request_exists', r.request_id is not null,
    'coordinator_id', r.coordinator_id,
    'tasker_user_id', r.tasker_user_id,
    'identity_user_id', v_ident,
    'identity_has_profile', exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = v_ident));
end $$;

-- 4. The creation function. ONE transaction: any failure (including the 10-cap trigger)
--    rolls back everything, including the ledger row.
--    p_tasker_user must be a placeholder identity the Edge Function just made through the Auth
--    admin API: email = local_tasker_identity_email(p_request), banned for 10+ years.
--    The function REFUSES an identity that could log in.
create or replace function public.create_local_tasker(
  p_coordinator uuid, p_request uuid, p_tasker_user uuid,
  p_public_name text, p_full_name text, p_phone text,
  p_areas_served text, p_skills text[], p_availability_notes text,
  p_consent_method text, p_consent_evidence_ref text, p_consent_details text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ins uuid; r public.local_tasker_create_requests; u auth.users;
  v_id text := p_tasker_user::text; v_consent uuid;
begin
  if p_coordinator is null or p_request is null or p_tasker_user is null then
    raise exception 'Missing coordinator, request or identity.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if not public.is_active_coordinator(p_coordinator) then
    raise exception 'Only an active coordinator can create a Local Tasker.' using errcode = 'P0001', hint = 'not_active_coordinator';
  end if;
  if p_public_name is null or char_length(btrim(p_public_name)) not between 2 and 80
     or p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 120
     or p_phone is null or char_length(btrim(p_phone)) not between 7 and 20
     or char_length(coalesce(p_areas_served, '')) > 300
     or char_length(coalesce(p_availability_notes, '')) > 500
     or coalesce(cardinality(p_skills), 0) > 20 then
    raise exception 'Invalid Local Tasker details.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_consent_method is null or p_consent_method not in ('in_person', 'phone', 'written') then
    raise exception 'A consent method (in_person, phone or written) is required.' using errcode = 'P0001', hint = 'consent_required';
  end if;

  -- Idempotency: claim the request id; a concurrent duplicate waits here, then sees the row.
  insert into public.local_tasker_create_requests (request_id, coordinator_id, tasker_user_id)
  values (p_request, p_coordinator, p_tasker_user)
  on conflict (request_id) do nothing returning request_id into v_ins;
  if v_ins is null then
    select * into r from public.local_tasker_create_requests where request_id = p_request;
    if r.coordinator_id <> p_coordinator or r.tasker_user_id <> p_tasker_user then
      raise exception 'This request id was already used for a different Local Tasker.' using errcode = 'P0001', hint = 'request_mismatch';
    end if;
    return jsonb_build_object('created', false, 'tasker_user_id', r.tasker_user_id);
  end if;

  -- The identity must be the locked placeholder, never a loginable account.
  -- Login is blocked by the Auth ban (a banned user cannot sign in by any method). We do not require an
  -- empty password hash: Supabase may store one even when none was given, and it is unknown to everyone.
  select * into u from auth.users where id = p_tasker_user;
  if not found or u.email is distinct from public.local_tasker_identity_email(p_request)
     or u.banned_until is null or u.banned_until < now() + interval '10 years' then
    raise exception 'The identity is not a locked placeholder (found=%, email_ok=%, banned_until=%).',
      found, u.email is not distinct from public.local_tasker_identity_email(p_request), u.banned_until
      using errcode = 'P0001', hint = 'identity_not_locked';
  end if;
  if exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = p_tasker_user)
     or exists (select 1 from public.users x where x.id = p_tasker_user)
     or exists (select 1 from public.taskers t where t.id = v_id or t.user_id = v_id) then
    raise exception 'This identity already has a profile.' using errcode = 'P0001', hint = 'identity_in_use';
  end if;

  -- Private profile FIRST (status draft) so the identity is never visible half-built (2C rule).
  insert into public.local_tasker_profiles
    (tasker_user_id, taskers_row_id, full_name, phone, areas_served, skills, availability_notes, status, created_by)
  values (p_tasker_user, v_id, btrim(p_full_name), btrim(p_phone), nullif(btrim(coalesce(p_areas_served, '')), ''),
          coalesce(p_skills, '{}'::text[]), nullif(btrim(coalesce(p_availability_notes, '')), ''), 'draft', p_coordinator);

  -- Public rows: NO phone, whatsapp, dob (they become public on publish). Phone stays in the profile only.
  insert into public.users (id, name, role, profile_details)
  values (p_tasker_user, btrim(p_public_name), 'tasker', '{}'::jsonb);
  insert into public.taskers (id, user_id, name, available, created_at, profile_details)
  values (v_id, v_id, btrim(p_public_name), false,
          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{}'::jsonb);

  -- Active assignment. The assignment trigger enforces coordinator active + the cap of 10.
  insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason)
  values (p_tasker_user, p_coordinator, p_coordinator, 'Created by coordinator');

  -- Consent record (purpose profile): the coordinator confirms the tasker agreed to this profile.
  insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by, evidence_ref, details)
  values (p_tasker_user, 'profile', p_consent_method, p_coordinator,
          nullif(btrim(coalesce(p_consent_evidence_ref, '')), ''), nullif(btrim(coalesce(p_consent_details, '')), ''))
  returning id into v_consent;

  -- Audit (no phone or full name in the audit JSON).
  perform public.local_tasker_audit('local_tasker_created', 'local_tasker', v_id, null,
    jsonb_build_object('request_id', p_request, 'public_name', btrim(p_public_name), 'status', 'draft',
                       'coordinator_id', p_coordinator), p_coordinator);
  perform public.local_tasker_audit('consent_recorded', 'local_tasker_consent', v_consent::text, null,
    jsonb_build_object('tasker_user_id', p_tasker_user, 'purpose', 'profile', 'method', p_consent_method), p_coordinator);

  return jsonb_build_object('created', true, 'tasker_user_id', p_tasker_user, 'consent_id', v_consent);
end $$;

-- 5. Server only. Supabase grants EXECUTE to anon/authenticated by default; remove it.
revoke all on function public.local_tasker_identity_email(uuid) from public, anon, authenticated;
revoke all on function public.local_tasker_find_request(uuid) from public, anon, authenticated;
revoke all on function public.create_local_tasker(uuid, uuid, uuid, text, text, text, text, text[], text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.local_tasker_identity_email(uuid) to service_role;
grant execute on function public.local_tasker_find_request(uuid) to service_role;
grant execute on function public.create_local_tasker(uuid, uuid, uuid, text, text, text, text, text[], text, text, text, text)
  to service_role;

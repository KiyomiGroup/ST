-- Stage V1c-2: start and read functions for Didit identity verification.
-- Needs v1a, v1b1, v1b2 and v1c1 applied first. Run in the Supabase SQL editor (staging first).
-- ADDITIVE ONLY: creates new functions, touches no table, policy or existing function. Safe to run twice.
-- Rollback: v1c2-rollback.sql.
--
-- WHAT THIS ADDS
--   Server only (service_role; called by the didit-create-session / didit-sync Edge Functions):
--     idv_start_attempt(caller, mode, target, environment, request_id)
--         Decides WHO is being verified on the server (the browser never names the subject in self mode),
--         refuses without a live consent, refuses an already VERIFIED person, reuses an open attempt or a
--         retried request, otherwise inserts ONE new attempt in status NOT_STARTED. Capped at 5 new
--         attempts per person per environment per 24 hours (each Didit session costs money).
--     idv_attach_session(verification_id, session_id, workflow_id)
--         Stores the Didit session id on the attempt once Didit has created it. Never changes status.
--     idv_mark_pending(verification_id)
--         NOT_STARTED / IN_PROGRESS -> PENDING ("came back from Didit, result not here yet"). Nothing else.
--   Signed-in users (authenticated):
--     idv_my_status()                 own status only
--     idv_local_status(tasker)        one assigned Local Tasker (active coordinator only)
--     idv_local_status_list()         all Local Taskers assigned to the calling coordinator
--   The read functions return status, dates, consent and a needs_review flag. They NEVER return scores, the
--   liveness / face / document / NIN results, reason codes, the Didit session id, workflow id or any image.
--   Nothing here can set VERIFIED, write users/taskers/local_tasker_profiles flags, or change a status
--   other than NOT_STARTED (new row) and PENDING. Status changes stay in idv_apply_event.

begin;

-- Private helper: what kind of subject is this self-mode user? (Local Taskers never use self mode.)
create or replace function public.idv_subject_kind(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = p_user) then 'tasker_local'
    when exists (select 1 from public.taskers t where t.user_id = p_user::text) then 'tasker_regular'
    else 'customer'
  end
$$;

-- 1. Server only: start (or reuse) an attempt.
create or replace function public.idv_start_attempt(
  p_caller      uuid,
  p_mode        text,
  p_target      uuid,
  p_environment text,
  p_request_id  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid;
  v_kind  text;
  v_row   public.identity_verifications;
  v_n     integer;
begin
  if p_caller is null or p_mode is null or p_mode not in ('self', 'proxy')
     or p_environment is null or p_environment not in ('sandbox', 'live')
     or char_length(coalesce(p_request_id, '')) > 100 then
    raise exception 'Invalid request.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  -- Who is being verified (decided here, never by the browser).
  if p_mode = 'self' then
    v_user := p_caller;
    v_kind := public.idv_subject_kind(v_user);
    if v_kind = 'tasker_local' then
      raise exception 'A Local Tasker cannot verify themselves.' using errcode = 'P0001', hint = 'not_for_local_tasker';
    end if;
  else
    if not public.is_active_coordinator(p_caller) then
      raise exception 'Only an active coordinator can start this.' using errcode = 'P0001', hint = 'not_active_coordinator';
    end if;
    if p_target is null or not public.coordinator_manages_tasker(p_caller, p_target) then
      raise exception 'This Local Tasker is not assigned to you.' using errcode = 'P0001', hint = 'not_assigned';
    end if;
    if not exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = p_target) then
      raise exception 'This Local Tasker is not assigned to you.' using errcode = 'P0001', hint = 'not_assigned';
    end if;
    v_user := p_target;
    v_kind := 'tasker_local';
  end if;

  -- Two clicks for the same person run one after the other.
  perform pg_advisory_xact_lock(hashtext('idv_start:' || v_user::text || ':' || p_environment));

  -- Consent first (also for a retried request: consent may have been withdrawn in between).
  if not public.idv_has_consent(v_user, v_kind) then
    raise exception 'Consent is required before verification can start.' using errcode = 'P0001', hint = 'consent_required';
  end if;

  if exists (select 1 from public.identity_verifications
              where user_id = v_user and environment = p_environment and status = 'VERIFIED') then
    raise exception 'This person is already verified.' using errcode = 'P0001', hint = 'already_verified';
  end if;

  -- A retried request returns the same attempt.
  if p_request_id is not null then
    select * into v_row from public.identity_verifications
     where created_by = p_caller and request_id = p_request_id;
    if found then
      if v_row.user_id <> v_user then
        raise exception 'Invalid request.' using errcode = 'P0001', hint = 'bad_input';
      end if;
      return jsonb_build_object('verification_id', v_row.id, 'user_id', v_row.user_id,
        'subject_kind', v_row.subject_kind, 'status', v_row.status,
        'provider_session_id', v_row.provider_session_id, 'reused', true);
    end if;
  end if;

  -- An open attempt is reused (the one-open-row index allows only one).
  select * into v_row from public.identity_verifications
   where user_id = v_user and environment = p_environment
     and status not in ('VERIFIED', 'FAILED', 'EXPIRED', 'ABANDONED')
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('verification_id', v_row.id, 'user_id', v_row.user_id,
      'subject_kind', v_row.subject_kind, 'status', v_row.status,
      'provider_session_id', v_row.provider_session_id, 'reused', true);
  end if;

  -- Cost guard.
  select count(*) into v_n from public.identity_verifications
   where user_id = v_user and environment = p_environment and created_at > now() - interval '24 hours';
  if v_n >= 5 then
    raise exception 'Too many attempts. Try again later.' using errcode = 'P0001', hint = 'too_many_attempts';
  end if;

  insert into public.identity_verifications (user_id, subject_kind, environment, status, request_id, created_by)
  values (v_user, v_kind, p_environment, 'NOT_STARTED', nullif(p_request_id, ''), p_caller)
  returning * into v_row;

  perform public.local_tasker_audit('idv.attempt_created', 'identity_verification', v_row.id::text, null,
    jsonb_build_object('subject_kind', v_kind, 'mode', p_mode), p_caller);

  return jsonb_build_object('verification_id', v_row.id, 'user_id', v_row.user_id,
    'subject_kind', v_row.subject_kind, 'status', v_row.status,
    'provider_session_id', v_row.provider_session_id, 'reused', false);
end
$$;

-- 2. Server only: remember the Didit session id on the attempt. Never changes status.
create or replace function public.idv_attach_session(
  p_verification_id uuid,
  p_session_id      text,
  p_workflow_id     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.identity_verifications;
begin
  if p_verification_id is null or p_session_id is null or btrim(p_session_id) = ''
     or char_length(p_session_id) > 200 or char_length(coalesce(p_workflow_id, '')) > 200 then
    raise exception 'Invalid request.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select * into v_row from public.identity_verifications where id = p_verification_id for update;
  if not found then
    raise exception 'Attempt not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_row.status in ('VERIFIED', 'FAILED', 'EXPIRED', 'ABANDONED') then
    raise exception 'This attempt is closed.' using errcode = 'P0001', hint = 'not_open';
  end if;
  if v_row.provider_session_id is not null then
    if v_row.provider_session_id = p_session_id then
      return jsonb_build_object('attached', false, 'status', v_row.status);
    end if;
    raise exception 'A different session is already attached.' using errcode = 'P0001', hint = 'session_already_set';
  end if;
  update public.identity_verifications
     set provider_session_id = p_session_id, workflow_id = coalesce(p_workflow_id, workflow_id)
   where id = v_row.id;
  return jsonb_build_object('attached', true, 'status', v_row.status);
end
$$;

-- 3. Server only: the person came back from Didit and the result has not arrived yet.
create or replace function public.idv_mark_pending(p_verification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.identity_verifications;
begin
  if p_verification_id is null then
    raise exception 'Invalid request.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select * into v_row from public.identity_verifications where id = p_verification_id for update;
  if not found then
    raise exception 'Attempt not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_row.provider_session_id is not null and v_row.status in ('NOT_STARTED', 'IN_PROGRESS') then
    update public.identity_verifications set status = 'PENDING' where id = v_row.id;
    return jsonb_build_object('changed', true, 'status', 'PENDING');
  end if;
  return jsonb_build_object('changed', false, 'status', v_row.status);
end
$$;

-- 4. A signed-in person reads their OWN status.
create or replace function public.idv_my_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_row  public.identity_verifications;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  v_kind := public.idv_subject_kind(v_uid);
  if v_kind = 'tasker_local' then
    raise exception 'A Local Tasker cannot verify themselves.' using errcode = 'P0001', hint = 'not_for_local_tasker';
  end if;
  select * into v_row from public.identity_verifications
   where user_id = v_uid order by created_at desc limit 1;
  return jsonb_build_object(
    'subject_kind',     v_kind,
    'status',           coalesce(v_row.status, 'NOT_STARTED'),
    'has_attempt',      v_row.id is not null,
    'has_open_attempt', v_row.id is not null and v_row.status not in ('VERIFIED', 'FAILED', 'EXPIRED', 'ABANDONED'),
    'verified',         exists (select 1 from public.identity_verifications where user_id = v_uid and status = 'VERIFIED'),
    'needs_review',     coalesce(v_row.status = 'REVIEW_REQUIRED', false),
    'consent_given',    public.idv_has_consent(v_uid, v_kind),
    'consent_version',  public.idv_consent_version(),
    'started_at',       v_row.created_at,
    'updated_at',       v_row.updated_at,
    'completed_at',     v_row.completed_at);
end
$$;

-- 5. An active coordinator reads ONE assigned Local Tasker.
create or replace function public.idv_local_status(p_tasker uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.identity_verifications;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  if not public.is_active_coordinator(v_uid) then
    raise exception 'Only an active coordinator can see this.' using errcode = 'P0001', hint = 'not_active_coordinator';
  end if;
  if p_tasker is null or not public.coordinator_manages_tasker(v_uid, p_tasker) then
    raise exception 'This Local Tasker is not assigned to you.' using errcode = 'P0001', hint = 'not_assigned';
  end if;
  select * into v_row from public.identity_verifications
   where user_id = p_tasker order by created_at desc limit 1;
  return jsonb_build_object(
    'tasker_user_id',   p_tasker,
    'status',           coalesce(v_row.status, 'NOT_STARTED'),
    'has_attempt',      v_row.id is not null,
    'has_open_attempt', v_row.id is not null and v_row.status not in ('VERIFIED', 'FAILED', 'EXPIRED', 'ABANDONED'),
    'verified',         exists (select 1 from public.identity_verifications where user_id = p_tasker and status = 'VERIFIED'),
    'needs_review',     coalesce(v_row.status = 'REVIEW_REQUIRED', false),
    'consent_given',    public.idv_has_consent(p_tasker, 'tasker_local'),
    'started_at',       v_row.created_at,
    'updated_at',       v_row.updated_at,
    'completed_at',     v_row.completed_at);
end
$$;

-- 6. An active coordinator reads ALL their assigned Local Taskers (for the list page).
create or replace function public.idv_local_status_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  if not public.is_active_coordinator(v_uid) then
    raise exception 'Only an active coordinator can see this.' using errcode = 'P0001', hint = 'not_active_coordinator';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tasker_user_id',   t.tasker_user_id,
             'status',           coalesce(l.status, 'NOT_STARTED'),
             'has_attempt',      l.id is not null,
             'has_open_attempt', l.id is not null and l.status not in ('VERIFIED', 'FAILED', 'EXPIRED', 'ABANDONED'),
             'verified',         exists (select 1 from public.identity_verifications v where v.user_id = t.tasker_user_id and v.status = 'VERIFIED'),
             'needs_review',     coalesce(l.status = 'REVIEW_REQUIRED', false),
             'consent_given',    public.idv_has_consent(t.tasker_user_id, 'tasker_local'),
             'completed_at',     l.completed_at)
           order by t.tasker_user_id)
      from (select distinct a.tasker_user_id
              from public.coordinator_assignments a
             where a.coordinator_id = v_uid and a.ended_at is null
               and public.coordinator_manages_tasker(v_uid, a.tasker_user_id)) t
      left join lateral (select * from public.identity_verifications i
                          where i.user_id = t.tasker_user_id order by i.created_at desc limit 1) l on true
  ), '[]'::jsonb);
end
$$;

-- Who may run what. Supabase grants EXECUTE to anon/authenticated by default: remove, then grant.
revoke all on function public.idv_subject_kind(uuid)                                   from public, anon, authenticated;
revoke all on function public.idv_start_attempt(uuid, text, uuid, text, text)          from public, anon, authenticated;
revoke all on function public.idv_attach_session(uuid, text, text)                     from public, anon, authenticated;
revoke all on function public.idv_mark_pending(uuid)                                   from public, anon, authenticated;
revoke all on function public.idv_my_status()                                          from public, anon, authenticated;
revoke all on function public.idv_local_status(uuid)                                   from public, anon, authenticated;
revoke all on function public.idv_local_status_list()                                  from public, anon, authenticated;
grant execute on function public.idv_start_attempt(uuid, text, uuid, text, text)       to service_role;
grant execute on function public.idv_attach_session(uuid, text, text)                  to service_role;
grant execute on function public.idv_mark_pending(uuid)                                to service_role;
grant execute on function public.idv_my_status()                                       to authenticated;
grant execute on function public.idv_local_status(uuid)                                to authenticated;
grant execute on function public.idv_local_status_list()                               to authenticated;

commit;

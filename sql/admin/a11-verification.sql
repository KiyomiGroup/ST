-- StreetTasker Admin Control Centre, stage A11: Identity verification (READ ONLY).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a11-rollback.sql. The last line says DONE or NOT DONE.
-- Written from the owner's identity-verification schema dump of 2026-11-11 (real columns, statuses and checks).
--
-- Adds three functions (SECURITY DEFINER, execute for authenticated only, each checks verification.view itself):
--   admin_verification_overview()                       counts by status and kind, gate settings, consent and takedown counts
--   admin_verification_list(filter, offset, kind)       identity_verifications rows, 25 per page, with attempt counts
--   admin_verification_detail(id)                       one row, all attempts of that person, webhook events of those sessions, consent, takedowns
--
-- Writes nothing. No table, policy, trigger or existing function is changed. There is NO way here to set a verified flag:
-- status only ever comes from the provider through idv_apply_event.
-- Never read or returned: idv_old_id_backup (holds old ID numbers), verifications.id_number, payload_hash, any ID number, date of birth,
-- phone, address, photo or provider media. The provider only stores results here: three booleans, a NIN match word and reason codes.
-- Membership (PRO / PREMIUM) is never shown here.
-- Real statuses: NOT_STARTED, IN_PROGRESS, PENDING, VERIFIED, FAILED, REVIEW_REQUIRED, RESUBMIT_REQUESTED, EXPIRED, ABANDONED.
-- Real kinds: tasker_regular, tasker_local, customer, coordinator. Environments: sandbox, live.
-- Filters: pending = PENDING + IN_PROGRESS; review = REVIEW_REQUIRED; resubmit = RESUBMIT_REQUESTED ("Additional information");
--          failed = FAILED; verified = VERIFIED; unfinished = NOT_STARTED + EXPIRED + ABANDONED.

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regclass('public.identity_verifications') is null then
    raise exception 'NOT DONE: identity_verifications does not exist. Nothing was changed.';
  end if;
end
$pre$;

create or replace function public.admin_verification_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.admin_has('verification.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'generated_at', now(),
    'total', (select count(*) from public.identity_verifications),
    'by_status', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select status as s, count(*) n from public.identity_verifications group by status) x),
    'by_kind', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select subject_kind as k, count(*) n from public.identity_verifications group by subject_kind) x),
    'sandbox_rows', (select count(*) from public.identity_verifications where environment = 'sandbox'),
    'waiting_review', (select count(*) from public.identity_verifications where status in ('REVIEW_REQUIRED', 'RESUBMIT_REQUESTED')),
    'webhook_events', (select count(*) from public.identity_verification_events),
    'events_rejected', (select count(*) from public.identity_verification_events where outcome = 'rejected'),
    'events_unprocessed', (select count(*) from public.identity_verification_events where processed_at is null),
    'consents_active', (select count(*) from public.identity_verification_consents where revoked_at is null),
    'consents_revoked', (select count(*) from public.identity_verification_consents where revoked_at is not null),
    'takedowns_open', (select count(*) from public.idv_takedowns where restored_at is null),
    'gate', (select jsonb_build_object('gate_customers', g.gate_customers, 'lockdown_enabled', g.lockdown_enabled) from public.idv_gate_config g limit 1)
  ) into v;
  return jsonb_build_object('ok', true) || v;
end $$;

create or replace function public.admin_verification_list(p_filter text default 'all', p_offset integer default 0, p_kind text default 'all')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_k text := lower(coalesce(p_kind, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('verification.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'pending', 'review', 'resubmit', 'failed', 'verified', 'unfinished') then v_f := 'all'; end if;
  if v_k not in ('all', 'tasker_regular', 'tasker_local', 'customer', 'coordinator') then v_k := 'all'; end if;
  with f as (
    select i.* from public.identity_verifications i
     where (v_k = 'all' or i.subject_kind = v_k)
       and (v_f = 'all'
         or (v_f = 'pending' and i.status in ('PENDING', 'IN_PROGRESS'))
         or (v_f = 'review' and i.status = 'REVIEW_REQUIRED')
         or (v_f = 'resubmit' and i.status = 'RESUBMIT_REQUESTED')
         or (v_f = 'failed' and i.status = 'FAILED')
         or (v_f = 'verified' and i.status = 'VERIFIED')
         or (v_f = 'unfinished' and i.status in ('NOT_STARTED', 'EXPIRED', 'ABANDONED')))
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'kind', v_k, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'user_id', t.user_id, 'subject_kind', t.subject_kind,
        'name', coalesce((select nullif(btrim(lp.full_name), '') from public.local_tasker_profiles lp where lp.tasker_user_id = t.user_id),
                         (select nullif(btrim(u.name), '') from public.users u where u.id = t.user_id)),
        'status', t.status, 'provider_status', t.provider_status, 'environment', t.environment,
        'reason_codes', t.status_reason_codes, 'provider_session_id', t.provider_session_id,
        'created_at', t.created_at, 'updated_at', t.updated_at, 'completed_at', t.completed_at,
        'attempts', (select count(*) from public.identity_verifications a where a.user_id = t.user_id)) order by t.updated_at desc nulls last, t.id), '[]'::jsonb)
      from (select * from f order by updated_at desc nulls last, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

create or replace function public.admin_verification_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.identity_verifications%rowtype; v_name text;
begin
  if not public.admin_has('verification.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  select * into r from public.identity_verifications where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'That verification was not found.'); end if;
  select coalesce((select nullif(btrim(lp.full_name), '') from public.local_tasker_profiles lp where lp.tasker_user_id = r.user_id),
                  (select nullif(btrim(u.name), '') from public.users u where u.id = r.user_id)) into v_name;
  return jsonb_build_object('ok', true,
    'verification', jsonb_build_object('id', r.id, 'user_id', r.user_id, 'name', v_name, 'subject_kind', r.subject_kind, 'provider', r.provider,
      'provider_session_id', r.provider_session_id, 'workflow_id', r.workflow_id, 'environment', r.environment, 'status', r.status,
      'provider_status', r.provider_status, 'reason_codes', r.status_reason_codes, 'liveness_ok', r.liveness_ok, 'face_match_ok', r.face_match_ok,
      'document_ok', r.document_ok, 'nin_database_match', r.nin_database_match, 'last_event_created_at', r.last_event_created_at,
      'created_at', r.created_at, 'updated_at', r.updated_at, 'completed_at', r.completed_at),
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'subject_kind', a.subject_kind, 'environment', a.environment,
        'created_at', a.created_at, 'completed_at', a.completed_at) order by a.created_at desc, a.id), '[]'::jsonb)
      from public.identity_verifications a where a.user_id = r.user_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event_id', e.event_id, 'webhook_type', e.webhook_type, 'provider_status', e.provider_status,
        'environment', e.environment, 'outcome', e.outcome, 'received_at', e.received_at, 'processed_at', e.processed_at) order by e.received_at desc, e.event_id), '[]'::jsonb)
      from (select * from public.identity_verification_events x
             where x.provider_session_id in (select a.provider_session_id from public.identity_verifications a where a.user_id = r.user_id and a.provider_session_id is not null)
             order by x.received_at desc limit 50) e),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('consent_version', c.consent_version, 'method', c.method, 'recorded_at', c.recorded_at,
        'revoked_at', c.revoked_at, 'revoke_reason', left(c.revoke_reason, 200)) order by c.recorded_at desc, c.id), '[]'::jsonb)
      from public.identity_verification_consents c where c.user_id = r.user_id),
    'takedowns', (select coalesce(jsonb_agg(jsonb_build_object('entity', d.entity, 'reason', left(d.reason, 200), 'taken_at', d.taken_at,
        'restored_at', d.restored_at, 'restore_skipped', left(d.restore_skipped, 200)) order by d.taken_at desc, d.id), '[]'::jsonb)
      from public.idv_takedowns d where d.user_id = r.user_id));
end $$;

revoke all on function public.admin_verification_overview(), public.admin_verification_list(text, integer, text), public.admin_verification_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_verification_overview(), public.admin_verification_list(text, integer, text), public.admin_verification_detail(uuid) to authenticated;

select case
  when to_regprocedure('public.admin_verification_overview()') is not null
   and to_regprocedure('public.admin_verification_list(text,integer,text)') is not null
   and to_regprocedure('public.admin_verification_detail(uuid)') is not null
  then 'DONE: A11 installed.'
  else 'NOT DONE: see the messages above.'
end as a11_result;

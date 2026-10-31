-- Stage V1b-1: status transition core for Didit identity verification.
-- Needs v1a-tables.sql applied first. Run in the Supabase SQL editor (staging first).
-- Safe to run twice (it never overwrites idv_apply_effects once V1b-2 has replaced it).
-- Rollback: v1b1-rollback.sql.
--
-- WHAT THIS DOES
--   idv_apply_event(...) is the ONLY place a verification's status changes. It is called by
--   the didit-webhook and didit-sync Edge Functions (service_role). Everything in it runs in
--   one transaction: if anything fails, nothing is kept (the ledger row too), so Didit's retry
--   starts clean.
--
-- RULES (from didit-00 section 4, DIDIT-API-FACTS.md and D-V3)
--   Status map:  Not Started -> NOT_STARTED | In Progress, Awaiting User -> IN_PROGRESS
--                In Review -> REVIEW_REQUIRED | Approved -> VERIFIED or REVIEW_REQUIRED (see below)
--                Declined -> FAILED | Resubmitted -> RESUBMIT_REQUESTED | Abandoned -> ABANDONED
--                Expired -> EXPIRED | Kyc Expired -> EXPIRED (and un-verify, done in V1b-2).
--                PENDING is never produced from a Didit status; only the server sets it (later stage).
--   Approved becomes VERIFIED only when: the caller says the decision was re-fetched from Didit,
--     AND liveness_ok AND face_match_ok are true, AND (for a Nigerian document) the NIMC database
--     result is full_match. Anything else on an Approved event -> REVIEW_REQUIRED. We never
--     auto-FAIL on a database mismatch: a person reviews it (D-V3 + D-V5).
--   Duplicate event_id  -> no change, outcome 'duplicate'.
--   Older event (Didit created_at earlier than the newest applied one) -> 'stale', no change.
--   Wrong environment (sandbox event for a live row or the reverse) -> 'ignored_environment'.
--   Terminal = VERIFIED, FAILED, EXPIRED, ABANDONED (same list as the one-open-row index in V1a).
--   A terminal row only changes on: Resubmitted (any terminal), Kyc Expired (only from VERIFIED
--     or EXPIRED), or a repeat of its own status (refreshes check fields). Everything else ->
--     'ignored_transition'. A new attempt is a NEW row (stage V1c), not a change to a terminal one.
--   Kyc Expired is ignored unless the row is VERIFIED or EXPIRED.
--   Known consequence: a reviewer who DECLINES in the Didit console and later flips it to
--   Approved is ignored here; the person must start a new session.
--   Equal timestamps are applied (cannot be ordered); the terminal rule still protects.
--
-- RETRY RULE: 'unknown_session' and 'decision_not_fetched' remove the ledger row again and return
--   retry=true, so the same event can be processed once the cause is fixed. All other outcomes
--   keep the ledger row (a repeat is then 'duplicate').

begin;

-- One more outcome than V1a allowed.
alter table public.identity_verification_events
  drop constraint if exists identity_verification_events_outcome_check;
alter table public.identity_verification_events
  add constraint identity_verification_events_outcome_check
  check (outcome in ('applied', 'duplicate', 'stale', 'ignored_environment', 'ignored_transition', 'rejected'));

create or replace function public.idv_map_status(p_provider_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_provider_status
    when 'Not Started'    then 'NOT_STARTED'
    when 'In Progress'    then 'IN_PROGRESS'
    when 'Awaiting User'  then 'IN_PROGRESS'
    when 'In Review'      then 'REVIEW_REQUIRED'
    when 'Approved'       then 'VERIFIED'          -- the approval rule below may lower this
    when 'Declined'       then 'FAILED'
    when 'Resubmitted'    then 'RESUBMIT_REQUESTED'
    when 'Abandoned'      then 'ABANDONED'
    when 'Expired'        then 'EXPIRED'
    when 'Kyc Expired'    then 'EXPIRED'
    else null
  end
$$;

create or replace function public.idv_is_terminal(p_status text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_status in ('VERIFIED', 'FAILED', 'EXPIRED', 'ABANDONED')
$$;

-- D-V3: what an Approved event is worth.
create or replace function public.idv_decide_approved(
  p_liveness_ok boolean, p_face_match_ok boolean, p_nin_database_match text, p_nigerian_doc boolean)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_liveness_ok, false)
     and coalesce(p_face_match_ok, false)
     and (not coalesce(p_nigerian_doc, false) or p_nin_database_match = 'full_match')
    then 'VERIFIED'
    else 'REVIEW_REQUIRED'
  end
$$;

-- Hook for side effects (flags on users/taskers, audit, notification). V1b-1 ships a no-op;
-- V1b-2 replaces it. Called only when the status actually changed.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'idv_apply_effects') then
    execute $f$
      create function public.idv_apply_effects(p_row public.identity_verifications, p_old_status text)
      returns void
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $b$ begin null; end $b$
    $f$;
  end if;
end $$;

-- Private: stamp the ledger row and build the result.
create or replace function public.idv_finish_event(p_event_id text, p_outcome text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.identity_verification_events
     set outcome = p_outcome, processed_at = now()
   where event_id = p_event_id;
  return p_result || jsonb_build_object('outcome', p_outcome);
end
$$;

create or replace function public.idv_apply_event(
  p_event_id            text,
  p_session_id          text,
  p_webhook_type        text,
  p_provider_status     text,
  p_environment         text,
  p_event_created_at    timestamptz,
  p_payload_hash        text    default null,
  p_decision_fetched    boolean default false,
  p_liveness_ok         boolean default null,
  p_face_match_ok       boolean default null,
  p_document_ok         boolean default null,
  p_nin_database_match  text    default null,
  p_nigerian_doc        boolean default false,
  p_reason_codes        text[]  default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.identity_verifications;
  v_n        integer;
  v_old      text;
  v_target   text;
  v_allowed  boolean;
  v_ts       timestamptz := coalesce(p_event_created_at, now());
begin
  if p_event_id is null or p_session_id is null or p_provider_status is null or p_environment is null then
    raise exception 'idv_apply_event: event_id, session_id, provider_status and environment are required';
  end if;

  -- 1. Idempotency ledger (insert first).
  insert into public.identity_verification_events
         (event_id, provider_session_id, webhook_type, provider_status, environment, payload_hash)
  values (p_event_id, p_session_id, p_webhook_type, p_provider_status, p_environment, p_payload_hash)
  on conflict (event_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('outcome', 'duplicate', 'changed', false);
  end if;

  -- 2. Find and lock the attempt (serialises two events for the same session).
  select * into v_row from public.identity_verifications
   where provider_session_id = p_session_id for update;
  if not found then
    delete from public.identity_verification_events where event_id = p_event_id;
    return jsonb_build_object('outcome', 'rejected', 'reason', 'unknown_session', 'retry', true, 'changed', false);
  end if;
  v_old := v_row.status;

  -- 3. Known status?
  v_target := public.idv_map_status(p_provider_status);
  if v_target is null then
    return public.idv_finish_event(p_event_id, 'rejected',
      jsonb_build_object('reason', 'unknown_status', 'changed', false, 'status', v_old));
  end if;

  -- 4. Environment must match the row.
  if p_environment <> v_row.environment then
    return public.idv_finish_event(p_event_id, 'ignored_environment',
      jsonb_build_object('changed', false, 'status', v_old));
  end if;

  -- 5. Out-of-order.
  if v_row.last_event_created_at is not null and v_ts < v_row.last_event_created_at then
    return public.idv_finish_event(p_event_id, 'stale',
      jsonb_build_object('changed', false, 'status', v_old));
  end if;

  -- 6. Approved: only trust it after the decision was re-fetched, then apply D-V3.
  if p_provider_status = 'Approved' then
    if not coalesce(p_decision_fetched, false) then
      delete from public.identity_verification_events where event_id = p_event_id;
      return jsonb_build_object('outcome', 'rejected', 'reason', 'decision_not_fetched',
                                'retry', true, 'changed', false, 'status', v_old);
    end if;
    v_target := public.idv_decide_approved(p_liveness_ok, p_face_match_ok, p_nin_database_match, p_nigerian_doc);
  end if;

  -- 7. Is this move allowed from the current status?
  if p_provider_status = 'Kyc Expired' then
    v_allowed := v_old in ('VERIFIED', 'EXPIRED');
  elsif p_provider_status = 'Resubmitted' then
    v_allowed := true;
  elsif public.idv_is_terminal(v_old) then
    v_allowed := (v_target = v_old);
  else
    v_allowed := true;
  end if;
  if not v_allowed then
    return public.idv_finish_event(p_event_id, 'ignored_transition',
      jsonb_build_object('changed', false, 'status', v_old, 'attempted', v_target));
  end if;

  -- 8. Apply.
  update public.identity_verifications
     set status                = v_target,
         provider_status       = p_provider_status,
         status_reason_codes   = coalesce(p_reason_codes, status_reason_codes),
         liveness_ok           = coalesce(p_liveness_ok, liveness_ok),
         face_match_ok         = coalesce(p_face_match_ok, face_match_ok),
         document_ok           = coalesce(p_document_ok, document_ok),
         nin_database_match    = coalesce(p_nin_database_match, nin_database_match),
         last_event_created_at = v_ts,
         completed_at          = case
                                   when public.idv_is_terminal(v_target)
                                     then case when v_old <> v_target or completed_at is null then now() else completed_at end
                                   else null
                                 end
   where id = v_row.id
   returning * into v_row;

  if v_old <> v_target then
    perform public.idv_apply_effects(v_row, v_old);
  end if;

  return public.idv_finish_event(p_event_id, 'applied',
    jsonb_build_object('changed', v_old <> v_target, 'status', v_target,
                       'previous_status', v_old, 'verification_id', v_row.id));
end
$$;

-- Nobody but the server can run any of these.
revoke all on function public.idv_map_status(text)                                   from public, anon, authenticated;
revoke all on function public.idv_is_terminal(text)                                  from public, anon, authenticated;
revoke all on function public.idv_decide_approved(boolean, boolean, text, boolean)   from public, anon, authenticated;
revoke all on function public.idv_apply_effects(public.identity_verifications, text) from public, anon, authenticated;
revoke all on function public.idv_finish_event(text, text, jsonb)                    from public, anon, authenticated;
revoke all on function public.idv_apply_event(text, text, text, text, text, timestamptz, text,
                                              boolean, boolean, boolean, boolean, text, boolean, text[])
  from public, anon, authenticated;
grant execute on function public.idv_apply_event(text, text, text, text, text, timestamptz, text,
                                                 boolean, boolean, boolean, boolean, text, boolean, text[])
  to service_role;

commit;

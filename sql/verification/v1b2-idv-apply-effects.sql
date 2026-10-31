-- Stage V1b-2: side effects of a verification status change (Didit).
-- Needs v1a-tables.sql and v1b1-idv-apply-core.sql applied first.
-- Run in the Supabase SQL editor (staging first). Safe to run twice.
-- Rollback: v1b2-rollback.sql (puts the no-op hook back; it does NOT undo flags already set).
--
-- WHAT THIS DOES
--   Replaces the no-op hook idv_apply_effects(row, old_status). idv_apply_event() calls it only
--   when the status actually changed, inside the same transaction.
--   * Entering VERIFIED: set the verified flags, write one audit row, notify.
--   * Leaving VERIFIED (Kyc Expired, or Resubmitted): clear the flags, write one audit row, notify.
--   * Becoming FAILED or REVIEW_REQUIRED (from any non-VERIFIED status): a notification only. No
--     flags, no audit row (the event ledger records the change). The text gives no reason, score
--     or detail: just "could not be completed" / "being reviewed".
--   * Any other change (IN_PROGRESS, RESUBMIT_REQUESTED, EXPIRED, ABANDONED, ...): nothing at all.
--   This is the ONLY code that writes the verified flags (V1d will remove the browser's right to).
--
-- FLAGS (names and types from the introspect results)
--   users.is_verified, users.verified_at                       (all subject kinds)
--   taskers.is_verified, taskers.verified, taskers.verified_at (tasker_regular and tasker_local;
--       all three together, every taskers row of that user; taskers.user_id is TEXT)
--   local_tasker_profiles.verification_method / verified_at / verified_by  (tasker_local only)
--       verified: method 'didit', verified_at now(), verified_by NULL (no human verified it)
--       un-verified: method and verified_at cleared
--   users.first_name / last_name / dob are NOT touched (D: leave them alone).
--   Clearing keeps a flag when the same user still has ANOTHER VERIFIED attempt that supports it
--   (users flags: any other VERIFIED row; taskers/profile fields: another VERIFIED tasker row), so
--   an old attempt cannot un-verify a newer one.
--
-- AUDIT (existing helper local_tasker_audit, append-only log)
--   action idv.verified / idv.unverified, entity 'identity_verification', entity_id = verification
--   id, before/after = {"status": ...} only. No personal data, scores or Didit media. Actor is
--   auth.uid() or, with no login (the webhook), role 'system'. If the audit insert fails it RAISES,
--   which rolls back the whole event (wanted: no change without a record).
--
-- NOTIFICATION (existing helper _notify, which EMAILS every new row via the existing pipeline)
--   One row per recipient per change. Regular taskers and customers: the user. Local Taskers can
--   never sign in, so the ACTIVE coordinator(s) of that tasker are notified instead (normally
--   exactly one); none active -> no notification, the audit row is still written.
--   _notify swallows every error by design, so a failed notification can never roll the event
--   back, and nothing reports it. Text stands alone (it is the email), has no personal data and
--   makes no claim StreetTasker cannot prove. data = {"url": "/verify.html"}.
--
-- KNOWN POINTS TO WATCH
--   * Sandbox and live rows both set flags. Never point a PRODUCTION project at the Didit sandbox
--     (V2e runbook: DIDIT_ENV must be 'live' there), or a sandbox "approval" marks a real user.
--   * Each time a row ENTERS FAILED or REVIEW_REQUIRED it sends one notification (so a row that
--     goes review -> resubmitted -> review again notifies twice). A repeat of the same status does not.

begin;

-- Private helper: send one notification per recipient. Regular taskers and customers: the user.
-- Local Taskers can never sign in, so every ACTIVE coordinator with an un-ended assignment is told.
create or replace function public.idv_notify_subject(p_row public.identity_verifications, p_title text, p_msg text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_recipient uuid;
begin
  if p_row.subject_kind = 'tasker_local' then
    for v_recipient in
      select distinct c.user_id
        from public.coordinator_assignments a
        join public.coordinators c on c.user_id = a.coordinator_id and c.status = 'active'
       where a.tasker_user_id = p_row.user_id and a.ended_at is null
    loop
      perform public._notify(v_recipient, 'identity_verification', p_title, p_msg,
                             jsonb_build_object('url', '/verify.html'));
    end loop;
  else
    perform public._notify(p_row.user_id, 'identity_verification', p_title, p_msg,
                           jsonb_build_object('url', '/verify.html'));
  end if;
end
$$;
revoke all on function public.idv_notify_subject(public.identity_verifications, text, text) from public, anon, authenticated;

create or replace function public.idv_apply_effects(p_row public.identity_verifications, p_old_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now_verified boolean := (p_row.status = 'VERIFIED');
  v_was_verified boolean := (p_old_status = 'VERIFIED');
  v_ts           timestamptz := now();
  v_is_tasker    boolean := p_row.subject_kind in ('tasker_regular', 'tasker_local');
  v_title        text;
  v_msg          text;
  v_keep_user    boolean;
  v_keep_tasker  boolean;
begin
  -- Only entering or leaving VERIFIED has side effects.
  if v_now_verified = v_was_verified then
    -- No flags and no audit row, but the person is told when an attempt failed or needs a review.
    if p_row.status = 'FAILED' then
      perform public.idv_notify_subject(p_row,
        case when p_row.subject_kind = 'tasker_local' then 'Identity verification could not be completed'
             else 'Your identity verification could not be completed' end,
        case when p_row.subject_kind = 'tasker_local'
             then 'Identity verification could not be completed for a tasker you manage. Open the verification page to see what to do next.'
             else 'We could not complete your identity verification. Open the verification page to see what to do next.' end);
    elsif p_row.status = 'REVIEW_REQUIRED' then
      perform public.idv_notify_subject(p_row,
        case when p_row.subject_kind = 'tasker_local' then 'Identity verification is being reviewed'
             else 'Your identity verification is being reviewed' end,
        case when p_row.subject_kind = 'tasker_local'
             then 'Identity verification for a tasker you manage needs a manual review. You will be told when there is an update.'
             else 'Your identity verification needs a manual review. This can take some time. You will be told when there is an update.' end);
    end if;
    return;
  end if;

  if v_now_verified then
    -- ===== set =====
    update public.users
       set is_verified = true, verified_at = v_ts
     where id = p_row.user_id;

    if v_is_tasker then
      update public.taskers
         set is_verified = true, verified = true, verified_at = v_ts
       where user_id = p_row.user_id::text;
    end if;

    if p_row.subject_kind = 'tasker_local' then
      update public.local_tasker_profiles
         set verification_method = 'didit', verified_at = v_ts, verified_by = null
       where tasker_user_id = p_row.user_id;
    end if;

    perform public.local_tasker_audit(
      'idv.verified', 'identity_verification', p_row.id::text,
      jsonb_build_object('status', p_old_status),
      jsonb_build_object('status', p_row.status), null);

    v_title := case when p_row.subject_kind = 'tasker_local'
                    then 'Identity verification completed'
                    else 'Your identity verification is complete' end;
    v_msg   := case when p_row.subject_kind = 'tasker_local'
                    then 'Identity verification was completed for a tasker you manage.'
                    else 'Your identity verification was completed. Thank you.' end;

  else
    -- ===== clear =====
    -- Keep a flag when the same user still has another VERIFIED attempt that supports it.
    v_keep_user := exists (select 1 from public.identity_verifications o
                            where o.user_id = p_row.user_id and o.status = 'VERIFIED' and o.id <> p_row.id);
    v_keep_tasker := exists (select 1 from public.identity_verifications o
                              where o.user_id = p_row.user_id and o.status = 'VERIFIED' and o.id <> p_row.id
                                and o.subject_kind in ('tasker_regular', 'tasker_local'));

    if not v_keep_user then
      update public.users
         set is_verified = false, verified_at = null
       where id = p_row.user_id;
    end if;

    if v_is_tasker and not v_keep_tasker then
      update public.taskers
         set is_verified = false, verified = false, verified_at = null
       where user_id = p_row.user_id::text;
    end if;

    if p_row.subject_kind = 'tasker_local' and not v_keep_tasker then
      update public.local_tasker_profiles
         set verification_method = null, verified_at = null
       where tasker_user_id = p_row.user_id;
    end if;

    perform public.local_tasker_audit(
      'idv.unverified', 'identity_verification', p_row.id::text,
      jsonb_build_object('status', p_old_status),
      jsonb_build_object('status', p_row.status), null);

    v_title := case when p_row.subject_kind = 'tasker_local'
                    then 'Identity verification needs to be done again'
                    else 'Your identity verification needs to be done again' end;
    v_msg   := case when p_row.subject_kind = 'tasker_local'
                    then 'A tasker you manage is no longer verified. Please verify them again on the verification page.'
                    else 'Your identity verification is no longer active. Please verify again on the verification page.' end;
  end if;

  -- ===== notify (best effort: _notify swallows its own errors) =====
  perform public.idv_notify_subject(p_row, v_title, v_msg);
end
$$;

-- Server only (CREATE OR REPLACE keeps the old grants; this states them again).
revoke all on function public.idv_apply_effects(public.identity_verifications, text) from public, anon, authenticated;

commit;

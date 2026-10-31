-- Stage V1c-1: consent for Didit identity verification (face + liveness + ID are processed).
-- Needs v1a-tables.sql, v1b1 and v1b2 applied (v1b2 is needed only for its audit/notify helpers, which
-- already exist in your project). Run in the Supabase SQL editor (staging first). Safe to run twice.
-- Rollback: v1c1-rollback.sql.
--
-- WHAT THIS DOES
--   1. Local Taskers (no login): adds the purpose 'identity_verification' to the existing check on
--      local_tasker_consents (the only change to an existing object). The coordinator records the
--      consent for ONE assigned Local Tasker, with the existing method list (in_person/phone/written).
--   2. Everyone else (regular taskers, customers): a new table identity_verification_consents, one row
--      per consent the signed-in person gives for themselves, tied to a consent TEXT VERSION. The
--      wording itself comes in stage V3a (owner decision D-V8 is still open). Changing the version
--      (idv_consent_version) makes every older consent stop counting, so people are asked again.
--   3. Functions. Browser-callable (signed-in, checked inside): idv_consent_version,
--      idv_give_consent, idv_withdraw_consent, idv_record_local_consent. Server only (service_role):
--      idv_has_consent, used by the create-session Edge Function (V2c) before it calls Didit.
--   Every consent given or withdrawn writes an audit row (local_tasker_audit). If that fails, the
--   consent is not recorded.
--
-- NOT DONE HERE (on purpose)
--   * Withdrawing a consent does not delete or change an existing verification (retention is D-V7, open).
--   * Withdrawal of a Local Tasker's consent is not offered by a function yet (the table has the fields).
--   * No reading functions for the page (V1c-2).

begin;

-- 1. Local Taskers: one more allowed purpose.
alter table public.local_tasker_consents drop constraint if exists local_tasker_consents_purpose_check;
alter table public.local_tasker_consents add constraint local_tasker_consents_purpose_check
  check (purpose = any (array['profile', 'publish_info', 'photos', 'payout', 'price_change',
                              'booking_confirmation', 'identity_verification']));

-- 2. Self consent table (browser has no access to it; functions only).
create table if not exists public.identity_verification_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,                       -- the person consenting (= auth.uid())
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  method          text not null default 'self_checkbox' check (method = 'self_checkbox'),
  recorded_at     timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid,
  revoke_reason   text check (revoke_reason is null or char_length(revoke_reason) <= 500),
  constraint idv_consents_revoke_consistent check (revoked_at is not null or (revoked_by is null and revoke_reason is null))
);
-- One live consent per person per text version.
create unique index if not exists idv_consents_one_live
  on public.identity_verification_consents (user_id, consent_version) where revoked_at is null;
create index if not exists idv_consents_user on public.identity_verification_consents (user_id, recorded_at desc);

-- Insert-only: nothing but the revoke fields may change, once; no deletes (same idea as local_tasker_consents).
create or replace function public.idv_consent_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Consent records cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.consent_version is distinct from old.consent_version or new.method is distinct from old.method
     or new.recorded_at is distinct from old.recorded_at then
    raise exception 'A consent record cannot be edited. Record a new one.' using errcode = 'P0001';
  end if;
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at or new.revoked_by is distinct from old.revoked_by
          or new.revoke_reason is distinct from old.revoke_reason) then
    raise exception 'This consent has already been withdrawn.' using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists idv_consents_guard on public.identity_verification_consents;
create trigger idv_consents_guard before update or delete on public.identity_verification_consents
  for each row execute function public.idv_consent_guard();

alter table public.identity_verification_consents enable row level security;   -- no policy = no browser access
revoke all on public.identity_verification_consents from public, anon, authenticated;
revoke all on function public.idv_consent_guard() from public, anon, authenticated;
grant select, insert, update on public.identity_verification_consents to service_role;

-- 3a. The text version people must accept right now. Bump it when the consent wording changes.
create or replace function public.idv_consent_version()
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select 'v1'::text $$;

-- 3b. A signed-in person gives consent for themselves.
create or replace function public.idv_give_consent(p_version text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  if p_version is distinct from public.idv_consent_version() then
    raise exception 'The consent text has changed. Reload the page and read it again.' using errcode = 'P0001', hint = 'consent_version_mismatch';
  end if;
  if exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = v_uid) then
    raise exception 'A Local Tasker cannot give consent for themselves.' using errcode = 'P0001', hint = 'not_for_local_tasker';
  end if;

  insert into public.identity_verification_consents (user_id, consent_version)
  values (v_uid, p_version)
  on conflict (user_id, consent_version) where revoked_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.identity_verification_consents
     where user_id = v_uid and consent_version = p_version and revoked_at is null;
    return jsonb_build_object('created', false, 'consent_id', v_id);
  end if;

  perform public.local_tasker_audit('consent_recorded', 'identity_verification_consent', v_id::text, null,
    jsonb_build_object('purpose', 'identity_verification', 'method', 'self_checkbox', 'version', p_version), v_uid);
  return jsonb_build_object('created', true, 'consent_id', v_id);
end
$$;

-- 3c. A signed-in person withdraws their own consent (all live ones). Does not touch any verification.
create or replace function public.idv_withdraw_consent(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  r     record;
  v_n   integer := 0;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then
    raise exception 'The reason is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  for r in select id from public.identity_verification_consents
            where user_id = v_uid and revoked_at is null for update
  loop
    update public.identity_verification_consents
       set revoked_at = now(), revoked_by = v_uid, revoke_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = r.id;
    perform public.local_tasker_audit('consent_revoked', 'identity_verification_consent', r.id::text, null,
      jsonb_build_object('purpose', 'identity_verification'), v_uid);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('revoked', v_n);
end
$$;

-- 3d. A coordinator records the consent of ONE assigned Local Tasker (proxy mode).
create or replace function public.idv_record_local_consent(
  p_tasker uuid, p_method text, p_evidence_ref text default null, p_details text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  if not public.is_active_coordinator(v_uid) then
    raise exception 'Only an active coordinator can record this consent.' using errcode = 'P0001', hint = 'not_active_coordinator';
  end if;
  if p_tasker is null or not public.coordinator_manages_tasker(v_uid, p_tasker) then
    raise exception 'This Local Tasker is not assigned to you.' using errcode = 'P0001', hint = 'not_assigned';
  end if;
  if p_method is null or p_method not in ('in_person', 'phone', 'written')
     or char_length(coalesce(p_evidence_ref, '')) > 500 or char_length(coalesce(p_details, '')) > 1000 then
    raise exception 'A consent method (in_person, phone or written) is required.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  -- Serialise two clicks for the same tasker, then reuse a live consent if one exists.
  perform 1 from public.local_tasker_profiles where tasker_user_id = p_tasker for update;
  select id into v_id from public.local_tasker_consents
   where tasker_user_id = p_tasker and purpose = 'identity_verification' and revoked_at is null
   order by recorded_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('created', false, 'consent_id', v_id);
  end if;

  insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by, evidence_ref, details)
  values (p_tasker, 'identity_verification', p_method, v_uid,
          nullif(btrim(coalesce(p_evidence_ref, '')), ''), nullif(btrim(coalesce(p_details, '')), ''))
  returning id into v_id;

  perform public.local_tasker_audit('consent_recorded', 'local_tasker_consent', v_id::text, null,
    jsonb_build_object('tasker_user_id', p_tasker, 'purpose', 'identity_verification', 'method', p_method), v_uid);
  return jsonb_build_object('created', true, 'consent_id', v_id);
end
$$;

-- 3e. Server only: is there a current, un-withdrawn consent for this subject?
create or replace function public.idv_has_consent(p_user uuid, p_subject_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_subject_kind = 'tasker_local' then
    return exists (select 1 from public.local_tasker_consents c
                    where c.tasker_user_id = p_user and c.purpose = 'identity_verification' and c.revoked_at is null);
  elsif p_subject_kind in ('tasker_regular', 'customer') then
    return exists (select 1 from public.identity_verification_consents c
                    where c.user_id = p_user and c.consent_version = public.idv_consent_version() and c.revoked_at is null);
  end if;
  raise exception 'Unknown subject kind.' using errcode = 'P0001', hint = 'bad_input';
end
$$;

-- Who may run what. Supabase grants EXECUTE to anon/authenticated by default: remove, then grant.
revoke all on function public.idv_consent_version()                                      from public, anon, authenticated;
revoke all on function public.idv_give_consent(text)                                     from public, anon, authenticated;
revoke all on function public.idv_withdraw_consent(text)                                 from public, anon, authenticated;
revoke all on function public.idv_record_local_consent(uuid, text, text, text)           from public, anon, authenticated;
revoke all on function public.idv_has_consent(uuid, text)                                from public, anon, authenticated;
grant execute on function public.idv_consent_version()                                   to authenticated, service_role;
grant execute on function public.idv_give_consent(text)                                  to authenticated;
grant execute on function public.idv_withdraw_consent(text)                              to authenticated;
grant execute on function public.idv_record_local_consent(uuid, text, text, text)        to authenticated;
grant execute on function public.idv_has_consent(uuid, text)                             to service_role;

commit;

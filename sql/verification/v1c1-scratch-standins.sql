-- SCRATCH POSTGRES ONLY. NEVER RUN THIS IN SUPABASE. Run AFTER v1b2-scratch-standins.sql.
-- Stand-ins for the existing consent table (columns, constraints and guard trigger as in the
-- introspect results: block1-columns, v1b2-block2-constraints, v1b2-block1-functions) and for the
-- two coordinator helpers (REAL source text from block5 / v1b2-block1).
create table public.local_tasker_consents (
  id uuid primary key default gen_random_uuid(),
  tasker_user_id uuid not null references public.local_tasker_profiles(tasker_user_id) on delete restrict,
  purpose text not null,
  method text not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  evidence_ref text, details text,
  revoked_at timestamptz, revoked_by uuid, revoke_reason text,
  constraint local_tasker_consents_details_check check (details is null or char_length(details) <= 1000),
  constraint local_tasker_consents_evidence_ref_check check (evidence_ref is null or char_length(evidence_ref) <= 500),
  constraint local_tasker_consents_method_check check (method = any (array['in_person', 'phone', 'written'])),
  constraint local_tasker_consents_purpose_check check (purpose = any (array['profile', 'publish_info', 'photos', 'payout', 'price_change', 'booking_confirmation'])),
  constraint local_tasker_consents_revoke_consistent check (revoked_at is not null or (revoked_by is null and revoke_reason is null)),
  constraint local_tasker_consents_revoke_reason_check check (revoke_reason is null or char_length(revoke_reason) <= 500));

create function public.local_tasker_consent_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Consent records cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id or new.tasker_user_id is distinct from old.tasker_user_id
     or new.purpose is distinct from old.purpose or new.method is distinct from old.method
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at
     or new.evidence_ref is distinct from old.evidence_ref or new.details is distinct from old.details then
    raise exception 'A consent record cannot be edited. Record a new one.' using errcode = 'P0001';
  end if;
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at or new.revoked_by is distinct from old.revoked_by
          or new.revoke_reason is distinct from old.revoke_reason) then
    raise exception 'This consent has already been withdrawn.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger local_tasker_consents_guard before update or delete on public.local_tasker_consents
  for each row execute function public.local_tasker_consent_guard();

create function public.is_active_coordinator(p_user uuid) returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select p_user is not null and exists (select 1 from public.coordinators c where c.user_id = p_user and c.status = 'active')
$$;
create function public.coordinator_manages_tasker(p_coordinator uuid, p_tasker uuid) returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select p_coordinator is not null and p_tasker is not null and exists (
    select 1 from public.coordinator_assignments a
      join public.coordinators c on c.user_id = a.coordinator_id and c.status = 'active'
     where a.coordinator_id = p_coordinator and a.tasker_user_id = p_tasker and a.ended_at is null)
$$;

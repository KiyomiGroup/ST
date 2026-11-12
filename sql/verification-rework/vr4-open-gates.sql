-- StreetTasker verification rework, stage VR4: switch the old "verify first" gates OFF. Nobody verifies up front any more.
-- Run ONLY after VR2a and VR3a are live and tested (this file refuses to run otherwise). Run once, whole file, in the Supabase SQL editor.
-- Safe to run again. Undo the gates with vr4-rollback.sql (rows already published stay published).
-- What it changes:
--   SET   idv_gate_config.gate_customers = false
--   EDIT  idv_can_publish()     any signed-in person may publish tasks, services and listings (signed out: no)
--   EDIT  idv_my_gate()         'required' is always false (so js/verify-gate.js never redirects anyone to verify)
--   EDIT  idv_takedown_user()   the AUTOMATIC reasons 'unverified' and 'reverify' no longer hide anything (other reasons still work)
--   EDIT  coordinator_new_starts_pending() and idv_coordinator_sync()   no longer hold coordinators in "pending" until verified
--   DROP  trigger trg_guard_booking_customer_verified and its function guard_booking_customer_verified()   booking needs no verification
--   DO    publish everything currently held as a draft "until verified" (tasks, services, tasker listings) and report how many
--   DO    switch on coordinators that were "pending" (they were pending only because the identity check was not done yet) and report how many
-- Original versions are copied into table vr4_backup first, so vr4-rollback.sql can put them back exactly.
-- NOT touched: idv_lockdown_guard (stops browsers writing "verified" flags), idv_start_attempt, the Didit functions, the street-address-after-payment rule,
--   VR2a (withdrawals) and VR3a (payments over the limit): those are the rules that now do the work.

do $$ begin
  if to_regprocedure('public.idv_withdrawal_gate(uuid,text)') is null then
    raise exception 'NOT DONE: VR2a (the withdrawal gate) is not installed. Without it an unverified person could withdraw. Nothing was changed.';
  end if;
  if to_regprocedure('public.idv_customer_payment_gate(uuid,numeric)') is null then
    raise exception 'NOT DONE: VR3a (the payment gate) is not installed. Nothing was changed.';
  end if;
  if to_regprocedure('public.idv_can_publish()') is null or to_regprocedure('public.idv_my_gate()') is null
     or to_regprocedure('public.idv_takedown_user(uuid,text)') is null or to_regclass('public.idv_takedowns') is null then
    raise exception 'NOT DONE: an idv_* object this file edits is missing. Nothing was changed.';
  end if;
end $$;

-- 1. Backup of everything this file changes (first run only; a second run never overwrites it).
create table if not exists public.vr4_backup (name text primary key, kind text not null, def text, saved_at timestamptz not null default now());
alter table public.vr4_backup enable row level security;
revoke all on public.vr4_backup from anon, authenticated;

insert into public.vr4_backup(name, kind, def)
select p.proname, 'function', pg_get_functiondef(p.oid)
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('idv_can_publish','idv_my_gate','idv_takedown_user','coordinator_new_starts_pending','idv_coordinator_sync','guard_booking_customer_verified')
on conflict (name) do nothing;

insert into public.vr4_backup(name, kind, def)
select t.tgname, 'trigger', pg_get_triggerdef(t.oid)
  from pg_trigger t where t.tgname = 'trg_guard_booking_customer_verified' and not t.tgisinternal
on conflict (name) do nothing;

insert into public.vr4_backup(name, kind, def)
select 'gate_customers', 'setting', gate_customers::text from public.idv_gate_config limit 1
on conflict (name) do nothing;

-- 2. The setting.
update public.idv_gate_config set gate_customers = false;

-- 3. Publishing is open to any signed-in person.
create or replace function public.idv_can_publish()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('can_publish', false, 'reason', 'signed_out');
  end if;
  -- VR4: no identity check is needed to publish. (The old rule lived here.)
  return jsonb_build_object('can_publish', true,
    'reason', case when exists (select 1 from public.identity_verifications where user_id = v_uid and status = 'VERIFIED') then 'verified' else 'not_required' end,
    'subject_kind', public.idv_subject_kind(v_uid));
end $fn$;

-- 4. Nobody is sent to the verify page. Same keys as before; 'required' is always false.
create or replace function public.idv_my_gate()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid(); v_ver boolean; v_kind text;
begin
  if v_uid is null then return jsonb_build_object('required', false, 'signed_in', false); end if;
  v_kind := public.idv_subject_kind(v_uid);
  v_ver := exists (select 1 from public.identity_verifications where user_id = v_uid and status = 'VERIFIED');
  return jsonb_build_object('signed_in', true, 'subject_kind', v_kind, 'verified', v_ver,
    'required', false,
    'profile_url', case when v_kind = 'customer' then 'edit-profile-customer.html' else 'edit-profile-tasker.html' end);
end $fn$;

-- 5. The automatic "hide everything because not verified / must re-verify" does nothing. A manual or admin reason still works.
--    Same body as before with ONE early return added.
do $mig$
declare v_def text;
begin
  select def into v_def from public.vr4_backup where name = 'idv_takedown_user';
  if v_def is null or position('declare n_t int' in v_def) = 0 then
    raise exception 'NOT DONE: idv_takedown_user is not the version this file expects. Send me its current source.';
  end if;
  if position('VR4' in (select prosrc from pg_proc where oid = 'public.idv_takedown_user(uuid,text)'::regprocedure)) = 0 then
    -- whitespace-proof (your live function may use Windows line endings): put one early return right after the first 'begin ... if idv_is_exempt'
    v_def := regexp_replace(v_def, 'begin(\s+)if public\.idv_is_exempt\(p_user\)',
      'begin\1if p_reason in (''unverified'', ''reverify'') then return jsonb_build_object(''skipped'', ''vr4_not_required''); end if; /* VR4 */\1if public.idv_is_exempt(p_user)', 'i');
    if position('VR4' in v_def) = 0 then raise exception 'NOT DONE: could not place the VR4 line in idv_takedown_user.'; end if;
    execute v_def;
  end if;
end $mig$;

-- 6. Coordinators are not held until verified.
create or replace function public.coordinator_new_starts_pending()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$ begin return new; end $fn$;   -- VR4: was: a new active coordinator with no VERIFIED check became 'pending'

create or replace function public.idv_coordinator_sync()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$ begin return new; end $fn$;   -- VR4: was: VERIFIED activated a pending coordinator, losing VERIFIED made an active one pending

-- 7. Booking needs no verification.
drop trigger if exists trg_guard_booking_customer_verified on public.bookings;
drop function if exists public.guard_booking_customer_verified();

-- 8. Publish what is held, and switch on coordinators that were only waiting for the check. Reports the counts.
do $go$
declare r record; n int; n_t int := 0; n_s int := 0; n_l int := 0; n_skip int := 0; n_c int := 0;
begin
  for r in select * from public.idv_takedowns where restored_at is null order by taken_at loop
    n := 0;
    if r.entity = 'task' then
      update public.tasks set status = 'open' where id::text = r.entity_id and status = 'draft'
         and (customer_id::text = r.user_id::text or user_id::text = r.user_id::text);
      get diagnostics n = row_count; if n = 1 then n_t := n_t + 1; end if;
    elsif r.entity = 'service' then
      update public.services set available = true where id::text = r.entity_id and available is false and user_id::text = r.user_id::text;
      get diagnostics n = row_count; if n = 1 then n_s := n_s + 1; end if;
    else
      update public.taskers set available = true where id::text = r.entity_id and available is false and user_id = r.user_id::text;
      get diagnostics n = row_count; if n = 1 then n_l := n_l + 1; end if;
    end if;
    update public.idv_takedowns set restored_at = now(),
           restore_skipped = case when n = 1 then null else 'changed' end where id = r.id;
    if n = 0 then n_skip := n_skip + 1; end if;
  end loop;
  if to_regclass('public.coordinators') is not null then
    update public.coordinators set status = 'active' where status = 'pending';
    get diagnostics n_c = row_count;
  end if;
  raise notice 'VR4 DONE. Published: % tasks, % services, % tasker listings. Held rows that had changed since (left as they are): %. Coordinators switched on: %.', n_t, n_s, n_l, n_skip, n_c;
end $go$;

-- 9. Result (one row)
select (select gate_customers from public.idv_gate_config limit 1) as gate_customers,
       (select count(*) from public.idv_takedowns where restored_at is null) as still_held,
       (select count(*) from pg_trigger where tgname = 'trg_guard_booking_customer_verified') as booking_guard_left,
       (select count(*) from public.vr4_backup) as backed_up_objects;

-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7G-1 core (coordinator tiers: model and capacity). SQL ONLY.
-- Additive and re-runnable. Rollback: stage-7g-rollback.sql. Tests: stage-7g-tests.sql.
-- Run in the Supabase SQL editor: select ALL, press Run. Safe to run twice.
--
-- WHAT IT DOES (owner changes C4, C6, C7, C8, C13; DECISIONS.md tier table)
--   1. coordinator_tiers_state     one row per coordinator (tier, default 1). Every existing coordinator is backfilled; every new coordinator gets a
--                                  row from a trigger. RLS on, NO policy, no browser grants: a tier can never be set from the browser.
--   2. coordinator_tier_upgrades   immutable ledger of upgrades (from_tier, to_tier = from_tier + 1, amount_kobo, payment reference). unique(coordinator, to_tier)
--                                  and a unique payment reference, so a tier is never paid for or applied twice.
--   3. coordinator_tier_terms(n)   THE ONE PLACE for the schedule. Capacity: tiers 1 to 3 = 10, 20, 30; from tier 4 = 5 x tier + 15.
--                                  Price to reach a tier = 50,000 naira x (tier - 1), stored in kobo; tier 1 is free.
--   4. coordinator_capacity(uuid)  the capacity of one coordinator (a missing state row counts as tier 1).
--   5. my_coordinator_plan()       read-only, for the signed-in ACTIVE coordinator: tier, capacity, active count, places left, over-capacity flag, next tier terms.
--   6. coordinator_apply_upgrade   the ONLY way to raise a tier. Service role only. Accepts only current tier + 1, refuses a repeat, a skipped tier and a
--                                  reused payment reference, takes the price from coordinator_tier_terms (never from the caller), writes the ledger and an audit row.
--                                  No function gives a tier without payment (C13), and nothing lowers a tier (C8).
--   7. local_tasker_assignment_guard  REPLACED: the real body from the owner's CSV (2026-11-02), with ONE change: the cap comes from
--                                  coordinator_capacity(coordinator) instead of local_tasker_max_active(). Same error hint 'coordinator_cap', same
--                                  lock-then-count, and the message now names the capacity and the tier. A coordinator above capacity keeps everyone
--                                  but cannot add more (C8). Nothing here ends or moves any assignment.
--
-- NOT DONE HERE: payment (Stage 7H), the plan page (Stage 7I). local_tasker_max_active() and the settings row are LEFT IN PLACE but are no longer
-- read by the guard; the number 10 now lives only in tier 1's terms.
--
-- DECISIONS TO CONFIRM (defaults used, owner may overrule)
--   D-7G-1  Highest tier accepted by the terms function is 100 (a guard against nonsense input; the owner's table stops at 8).
--   D-7G-2  coordinator_apply_upgrade does NOT require the coordinator to be active (7H checks that BEFORE taking payment); refusing here could lose a
--           payment that was already verified.
--   D-7G-3  coordinator_capacity() is executable by signed-in users (the guard runs as whoever inserts). It returns one number and nothing else.
-- ============================================================================

do $$
begin
  if to_regclass('public.coordinators') is null or to_regclass('public.coordinator_assignments') is null then
    raise exception 'coordinators or coordinator_assignments is missing. Nothing was changed.';
  end if;
  if to_regprocedure('public.is_active_coordinator(uuid)') is null or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null then
    raise exception 'is_active_coordinator(uuid) or local_tasker_audit(...) is missing. Nothing was changed.';
  end if;
end $$;

-- 1. State ----------------------------------------------------------------------------------------------------------
create table if not exists public.coordinator_tiers_state (
  coordinator_id uuid primary key references public.coordinators (user_id) on delete cascade,
  tier           integer not null default 1 check (tier >= 1),
  updated_at     timestamptz not null default now()
);
alter table public.coordinator_tiers_state enable row level security;
revoke all on public.coordinator_tiers_state from public, anon, authenticated;

insert into public.coordinator_tiers_state (coordinator_id)
select c.user_id from public.coordinators c on conflict (coordinator_id) do nothing;

create or replace function public.coordinator_tiers_state_seed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.coordinator_tiers_state (coordinator_id) values (new.user_id) on conflict (coordinator_id) do nothing;
  return new;
end $$;
revoke all on function public.coordinator_tiers_state_seed() from public, anon, authenticated;
drop trigger if exists coordinators_tier_state_ai on public.coordinators;
create trigger coordinators_tier_state_ai after insert on public.coordinators for each row execute function public.coordinator_tiers_state_seed();

-- 2. Ledger ---------------------------------------------------------------------------------------------------------
create table if not exists public.coordinator_tier_upgrades (
  id                uuid primary key default gen_random_uuid(),
  coordinator_id    uuid not null,
  from_tier         integer not null check (from_tier >= 1),
  to_tier           integer not null,
  amount_kobo       bigint  not null check (amount_kobo > 0),
  payment_reference text    not null check (char_length(payment_reference) between 1 and 100),
  created_at        timestamptz not null default now(),
  check (to_tier = from_tier + 1),
  unique (coordinator_id, to_tier),
  unique (payment_reference)
);
alter table public.coordinator_tier_upgrades enable row level security;
revoke all on public.coordinator_tier_upgrades from public, anon, authenticated;

create or replace function public.coordinator_tier_upgrades_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'The upgrade history cannot be changed or deleted.' using errcode = 'P0001', hint = 'immutable';
end $$;
drop trigger if exists coordinator_tier_upgrades_no_change on public.coordinator_tier_upgrades;
create trigger coordinator_tier_upgrades_no_change before update or delete on public.coordinator_tier_upgrades for each row execute function public.coordinator_tier_upgrades_immutable();
drop trigger if exists coordinator_tier_upgrades_no_truncate on public.coordinator_tier_upgrades;
create trigger coordinator_tier_upgrades_no_truncate before truncate on public.coordinator_tier_upgrades for each statement execute function public.coordinator_tier_upgrades_immutable();

-- 3. THE schedule ---------------------------------------------------------------------------------------------------
create or replace function public.coordinator_tier_terms(p_tier integer)
returns table (tier integer, capacity integer, price_kobo bigint)
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_tier is null or p_tier < 1 or p_tier > 100 then
    raise exception 'Unknown tier.' using errcode = 'P0001', hint = 'bad_tier';
  end if;
  tier := p_tier;
  capacity := case when p_tier <= 3 then 10 * p_tier else 5 * p_tier + 15 end;
  price_kobo := 50000::bigint * (p_tier - 1) * 100;      -- naira 50,000 x (tier - 1), in kobo; tier 1 = 0 (free)
  return next;
end $$;
revoke all on function public.coordinator_tier_terms(integer) from public, anon;
grant execute on function public.coordinator_tier_terms(integer) to authenticated, service_role;

-- 4. Capacity of one coordinator ------------------------------------------------------------------------------------
create or replace function public.coordinator_capacity(p_coordinator uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select (select t.capacity from public.coordinator_tier_terms(coalesce((select s.tier from public.coordinator_tiers_state s where s.coordinator_id = p_coordinator), 1)) t)
$$;
revoke all on function public.coordinator_capacity(uuid) from public, anon;
grant execute on function public.coordinator_capacity(uuid) to authenticated, service_role;

-- 5. The coordinator's own plan (read only) -------------------------------------------------------------------------
create or replace function public.my_coordinator_plan() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); v_tier integer; v_cap integer; v_active integer; v_next record;
begin
  if v_me is null or not public.is_active_coordinator(v_me) then
    raise exception 'Not available.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select coalesce((select s.tier from public.coordinator_tiers_state s where s.coordinator_id = v_me), 1) into v_tier;
  select t.capacity into v_cap from public.coordinator_tier_terms(v_tier) t;
  select count(*) into v_active from public.coordinator_assignments a where a.coordinator_id = v_me and a.ended_at is null;
  select * into v_next from public.coordinator_tier_terms(least(v_tier + 1, 100));
  return jsonb_build_object(
    'tier', v_tier, 'capacity', v_cap, 'active_count', v_active,
    'places_left', greatest(v_cap - v_active, 0), 'over_capacity', v_active > v_cap,
    'next', case when v_tier >= 100 then null
                 else jsonb_build_object('tier', v_next.tier, 'capacity', v_next.capacity, 'price_kobo', v_next.price_kobo) end);
end $$;
revoke all on function public.my_coordinator_plan() from public, anon;
grant execute on function public.my_coordinator_plan() to authenticated, service_role;

-- 6. The ONLY way to raise a tier -----------------------------------------------------------------------------------
create or replace function public.coordinator_apply_upgrade(p_coordinator uuid, p_to_tier integer, p_payment_ref text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from integer; v_terms record; v_ref text := btrim(coalesce(p_payment_ref, ''));
begin
  if p_coordinator is null or p_to_tier is null or char_length(v_ref) not between 1 and 100 then
    raise exception 'A coordinator, a tier and a payment reference are required.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if not exists (select 1 from public.coordinators c where c.user_id = p_coordinator) then
    raise exception 'Coordinator not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  insert into public.coordinator_tiers_state (coordinator_id) values (p_coordinator) on conflict (coordinator_id) do nothing;
  select s.tier into v_from from public.coordinator_tiers_state s where s.coordinator_id = p_coordinator for update;   -- serialises two upgrades for one coordinator

  if p_to_tier <= v_from or exists (select 1 from public.coordinator_tier_upgrades u where u.coordinator_id = p_coordinator and u.to_tier = p_to_tier) then
    raise exception 'This tier has already been reached.' using errcode = 'P0001', hint = 'tier_already_applied';
  end if;
  if p_to_tier <> v_from + 1 then
    raise exception 'A tier cannot be skipped. The next tier is %.', v_from + 1 using errcode = 'P0001', hint = 'tier_skip';
  end if;
  if exists (select 1 from public.coordinator_tier_upgrades u where u.payment_reference = v_ref) then
    raise exception 'This payment has already been used for an upgrade.' using errcode = 'P0001', hint = 'payment_reused';
  end if;

  select * into v_terms from public.coordinator_tier_terms(p_to_tier);       -- the price is the schedule's, never the caller's
  insert into public.coordinator_tier_upgrades (coordinator_id, from_tier, to_tier, amount_kobo, payment_reference)
  values (p_coordinator, v_from, p_to_tier, v_terms.price_kobo, v_ref);
  update public.coordinator_tiers_state set tier = p_to_tier, updated_at = now() where coordinator_id = p_coordinator;
  perform public.local_tasker_audit('coordinator_tier_upgraded', 'coordinator', p_coordinator::text,
    jsonb_build_object('tier', v_from), jsonb_build_object('tier', p_to_tier, 'capacity', v_terms.capacity, 'amount_kobo', v_terms.price_kobo, 'payment_reference', v_ref), p_coordinator);
  return jsonb_build_object('coordinator_id', p_coordinator, 'from_tier', v_from, 'tier', p_to_tier, 'capacity', v_terms.capacity, 'amount_kobo', v_terms.price_kobo);
end $$;
revoke all on function public.coordinator_apply_upgrade(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.coordinator_apply_upgrade(uuid, integer, text) to service_role;

-- 7. The cap check: the owner's REAL guard body, one change (the cap line and the message) --------------------------
create or replace function public.local_tasker_assignment_guard()
returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$   -- NOT security definer on purpose: current_user must be the real caller
declare v_cap integer; v_status text; v_active integer; v_tier integer;
begin
  if tg_op = 'DELETE' then
    if current_user in ('authenticated', 'anon') then
      raise exception 'Assignment history cannot be deleted.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.tasker_user_id is distinct from old.tasker_user_id
       or new.coordinator_id is distinct from old.coordinator_id
       or new.previous_coordinator_id is distinct from old.previous_coordinator_id
       or new.assigned_at is distinct from old.assigned_at
       or new.assigned_by is distinct from old.assigned_by
       or new.assign_reason is distinct from old.assign_reason then
      raise exception 'An assignment cannot be edited. End it and create a new one.' using errcode = 'P0001';
    end if;
    if old.ended_at is not null
       and (new.ended_at is distinct from old.ended_at
            or new.ended_by is distinct from old.ended_by
            or new.end_reason is distinct from old.end_reason) then
      raise exception 'This assignment has already ended.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- INSERT of an ACTIVE assignment (ended_at is null): lock the coordinator row,
  -- then count. The lock makes concurrent inserts for one coordinator queue up,
  -- and the count runs after the lock is held, so it sees every committed row.
  if new.ended_at is null then
    select c.status into v_status
      from public.coordinators c where c.user_id = new.coordinator_id for update;
    if not found then
      raise exception 'Coordinator not found.' using errcode = 'P0001';
    end if;
    if v_status <> 'active' then
      raise exception 'This coordinator is not active and cannot receive new Local Taskers.' using errcode = 'P0001';
    end if;
    v_cap := public.coordinator_capacity(new.coordinator_id);     -- 7G: from the coordinator's tier (was local_tasker_max_active())
    if v_cap is null then
      raise exception 'The capacity for this coordinator could not be worked out.' using errcode = 'P0001';
    end if;
    select count(*) into v_active from public.coordinator_assignments a
     where a.coordinator_id = new.coordinator_id and a.ended_at is null;
    if v_active >= v_cap then
      select coalesce((select s.tier from public.coordinator_tiers_state s where s.coordinator_id = new.coordinator_id), 1) into v_tier;
      raise exception 'This coordinator already has the maximum of % active Local Taskers for their plan (tier %).', v_cap, v_tier
        using errcode = 'P0001', hint = 'coordinator_cap';
    end if;
  end if;
  return new;
end $function$;

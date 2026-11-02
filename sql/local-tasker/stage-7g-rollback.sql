-- StreetTasker Local Tasker: STAGE 7G-1 rollback. Select ALL, Run. Puts the original cap check back (cap read from local_tasker_max_active()) and removes
-- the 7G objects. WARNING: this deletes the tier state and the upgrade ledger. Do not run it after any coordinator has paid for an upgrade.
create or replace function public.local_tasker_assignment_guard()
returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$   -- NOT security definer on purpose: current_user must be the real caller
declare v_cap integer; v_status text; v_active integer;
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

  if new.ended_at is null then
    select c.status into v_status
      from public.coordinators c where c.user_id = new.coordinator_id for update;
    if not found then
      raise exception 'Coordinator not found.' using errcode = 'P0001';
    end if;
    if v_status <> 'active' then
      raise exception 'This coordinator is not active and cannot receive new Local Taskers.' using errcode = 'P0001';
    end if;
    v_cap := public.local_tasker_max_active();
    if v_cap is null then
      raise exception 'The setting max_active_per_coordinator is missing.' using errcode = 'P0001';
    end if;
    select count(*) into v_active from public.coordinator_assignments a
     where a.coordinator_id = new.coordinator_id and a.ended_at is null;
    if v_active >= v_cap then
      raise exception 'This coordinator already has the maximum of % active Local Taskers.', v_cap
        using errcode = 'P0001', hint = 'coordinator_cap';
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists coordinators_tier_state_ai on public.coordinators;
drop function if exists public.coordinator_tiers_state_seed();
drop function if exists public.coordinator_apply_upgrade(uuid, integer, text);
drop function if exists public.my_coordinator_plan();
drop function if exists public.coordinator_capacity(uuid);
drop function if exists public.coordinator_tier_terms(integer);
drop table if exists public.coordinator_tier_upgrades;
drop function if exists public.coordinator_tier_upgrades_immutable();
drop table if exists public.coordinator_tiers_state;

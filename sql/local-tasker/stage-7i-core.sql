-- ============================================================================
-- Stage 7I: upgrade history for the coordinator plan page (READ ONLY function)
-- One new function: my_coordinator_upgrades(). Nothing else is created or changed.
-- Additive and re-runnable (create or replace). Rollback: stage-7i-rollback.sql.
--
-- Why: coordinator_tier_upgrades is locked from browsers (7G), so the plan page
-- cannot read the history directly. This function returns the signed-in,
-- ACTIVE coordinator's OWN rows only, newest first, at most 50.
-- It follows my_coordinator_plan() exactly (same guard, same error hint).
-- ============================================================================

do $$
begin
  if to_regclass('public.coordinator_tier_upgrades') is null
     or to_regprocedure('public.coordinator_tier_terms(integer)') is null
     or to_regprocedure('public.is_active_coordinator(uuid)') is null then
    raise exception 'Stage 7G is not installed (coordinator_tier_upgrades, coordinator_tier_terms or is_active_coordinator is missing). Nothing was changed.';
  end if;
end $$;

create or replace function public.my_coordinator_upgrades() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_active_coordinator(v_me) then
    raise exception 'Not available.' using errcode = 'P0001', hint = 'not_found';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'from_tier',         x.from_tier,
             'to_tier',           x.to_tier,
             'capacity',          (select t.capacity from public.coordinator_tier_terms(x.to_tier) t),
             'amount_kobo',       x.amount_kobo,
             'payment_reference', x.payment_reference,
             'created_at',        x.created_at)
           order by x.created_at desc, x.to_tier desc)
    from (select u.* from public.coordinator_tier_upgrades u
           where u.coordinator_id = v_me
           order by u.created_at desc, u.to_tier desc
           limit 50) x
  ), '[]'::jsonb);
end $$;
revoke all on function public.my_coordinator_upgrades() from public, anon;
grant execute on function public.my_coordinator_upgrades() to authenticated, service_role;

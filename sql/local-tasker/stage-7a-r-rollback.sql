-- Stage 7A-R rollback. Re-runnable.
-- WARNING: this brings the OLD 0% exemption for Local Taskers back (the owner cancelled it on 2026-11-01). Use it only if 7A-R itself broke something.
-- It can only restore what Stage 7A part 1 and part 2 define, so it refuses to run if those helper functions are not in the project.
do $$
begin
  if to_regprocedure('public.is_local_tasker_user(uuid)') is null then
    raise exception 'is_local_tasker_user(uuid) is missing: Stage 7A was never applied in this project, so there is no old state to restore. Nothing was changed.';
  end if;
  if to_regprocedure('public._booking_tasker_user(public.bookings)') is null then
    raise exception '_booking_tasker_user is missing, so the Stage 7A part 2 helpers cannot be restored. Nothing was changed.';
  end if;
end $$;

create or replace function public.platform_fee_rate_for_tasker(p_tasker uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_local_tasker_user(p_tasker) then 0::numeric else public.platform_fee_rate() end
$$;
revoke all on function public.platform_fee_rate_for_tasker(uuid) from public, anon, authenticated;
grant execute on function public.platform_fee_rate_for_tasker(uuid) to service_role;

create or replace function public.platform_fee_rate_for_booking(p_booking uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select public.platform_fee_rate_for_tasker(public._booking_tasker_user(b)) from public.bookings b where b.id = p_booking
$$;
revoke all on function public.platform_fee_rate_for_booking(uuid) from public, anon, authenticated;
grant execute on function public.platform_fee_rate_for_booking(uuid) to service_role;

create or replace function public.booking_fee_rates(p_tasker_ids uuid[])
returns table (tasker_id uuid, fee_rate numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (b.tasker_id) b.tasker_id, public.platform_fee_rate_for_tasker(public._booking_tasker_user(b))
    from public.bookings b
   where auth.uid() is not null
     and cardinality(coalesce(p_tasker_ids, '{}'::uuid[])) between 1 and 100
     and b.customer_id = auth.uid()
     and b.tasker_id = any (coalesce(p_tasker_ids, '{}'::uuid[]))
   order by b.tasker_id
$$;
revoke all on function public.booking_fee_rates(uuid[]) from public, anon;
grant execute on function public.booking_fee_rates(uuid[]) to authenticated, service_role;

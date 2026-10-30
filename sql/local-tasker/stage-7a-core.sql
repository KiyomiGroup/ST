-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7A core (commission exemption, PART 1: the single trusted answer)
-- Additive and re-runnable. Rollback: stage-7a-rollback.sql. Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- WHAT THIS DOES
--   1. is_local_tasker_user(uuid)           internal: is this user a Local Tasker (has a row in local_tasker_profiles, ANY status).
--   2. platform_fee_rate_for_tasker(uuid)   the ONE answer to "what fee rate applies to this tasker": 0 for a Local Tasker,
--                                           otherwise exactly platform_fee_rate() (still 0.12). Decision D8. service_role / definer functions only.
--   3. booking_fee_rates(uuid[])            customer-safe read for the Bookings page: for taskers the signed-in customer has booked,
--                                           the fee rate (so "Provider receives" is right). Nothing else, no names.
--
-- WHAT THIS DOES NOT DO (and why)
--   It does NOT change _prepare_intent, _release_escrow or platform_fee_rate(): their real bodies were not in the upload, and a
--   CREATE OR REPLACE needs the whole body. Run stage-7a-introspect.sql, send the CSV, and Part 2 patches them to CALL function 2.
--   Until Part 2 is applied, NOTHING about money changes: Local Taskers are still charged 12% by the Job Room path.
--   It never touches bookings, payment_intents, escrow_payments, wallets or regular taskers.
--
-- DECISION D-7A-1 (owner may overrule): "Local Tasker" = has a local_tasker_profiles row, any status. D8 said "published or active";
--   that would flip a booking from 0% to 12% if the person is unpublished or retired between payment and release. A regular tasker
--   never has such a row (rows are created only by create_local_tasker).
-- ============================================================================

do $$
begin
  if to_regclass('public.local_tasker_profiles') is null or to_regclass('public.bookings') is null then
    raise exception 'A required table is missing (local_tasker_profiles, bookings). Nothing was changed.';
  end if;
  if to_regprocedure('public.platform_fee_rate()') is null then
    raise exception 'platform_fee_rate() is missing. Nothing was changed.';
  end if;
end $$;

-- 1. Internal: is this user a Local Tasker --------------------------------------------------------------------
create or replace function public.is_local_tasker_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null and exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = p_user)
$$;
revoke all on function public.is_local_tasker_user(uuid) from public, anon, authenticated;
grant execute on function public.is_local_tasker_user(uuid) to service_role;

-- 2. THE fee rate for a tasker ----------------------------------------------------------------------------------
create or replace function public.platform_fee_rate_for_tasker(p_tasker uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.is_local_tasker_user(p_tasker) then 0::numeric else public.platform_fee_rate() end
$$;
revoke all on function public.platform_fee_rate_for_tasker(uuid) from public, anon, authenticated;
grant execute on function public.platform_fee_rate_for_tasker(uuid) to service_role;

-- 3. Customer-safe: fee rate for taskers I have booked -------------------------------------------------------------
create or replace function public.booking_fee_rates(p_tasker_ids uuid[])
returns table (tasker_id uuid, fee_rate numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, public.platform_fee_rate_for_tasker(t.id)
    from (select distinct u as id from unnest(coalesce(p_tasker_ids, '{}'::uuid[])) as u) t
   where auth.uid() is not null
     and cardinality(coalesce(p_tasker_ids, '{}'::uuid[])) between 1 and 100
     and exists (select 1 from public.bookings b where b.customer_id = auth.uid() and b.tasker_id = t.id)
$$;
revoke all on function public.booking_fee_rates(uuid[]) from public, anon;
grant execute on function public.booking_fee_rates(uuid[]) to authenticated, service_role;

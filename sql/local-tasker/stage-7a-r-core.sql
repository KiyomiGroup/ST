-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7A-R core (Local Taskers pay the same 12% as everyone; replaces Stage 7A)
-- Additive-in-effect and RE-RUNNABLE. Safe whether or not stage-7a-core.sql / stage-7a2-core.sql were ever applied. Rollback: stage-7a-r-rollback.sql.
-- Run in the Supabase SQL editor (select ALL, Run). Then run stage-7a-r-tests.sql.
--
-- WHAT THIS DOES (owner change C1, 2026-11-01)
--   1. platform_fee_rate_for_tasker(uuid)  now returns platform_fee_rate() (0.12) for EVERY tasker, Local Taskers included. The function is KEPT
--                                          so there is still ONE place that answers "what rate applies to this tasker" (Stages 7C and 7E call it).
--   2. platform_fee_rate_for_booking(uuid) the same single answer by booking id (used by the gift-card-pay Edge Function). It no longer needs
--                                          _booking_tasker_user, so it works even if Stage 7A part 2 was never applied.
--   3. booking_fee_rates(uuid[])           DROPPED. It existed only so the customer Bookings page could show 0% for a Local Tasker. The page no
--                                          longer calls it (js/customer-bookings.js in this delivery); an old copy of the page that still calls it
--                                          falls back to the normal 12% by design.
--
-- WHY THIS IS CORRECT IN BOTH STATES
--   * If 7A part 2 WAS applied: _prepare_intent and _release_escrow already call platform_fee_rate_for_tasker(). Changing that one function makes
--     them charge 12% for a Local Tasker again. Their bodies are NOT touched (their only 7A edit was to call this function; the "(no fee)" wallet
--     note branch can no longer be reached because the rate is never 0).
--   * If 7A part 2 was NOT applied: _prepare_intent / _release_escrow still use platform_fee_rate() directly (12% for everyone). Nothing about
--     money changes; this file only creates the one-place functions that 7C / 7E and gift-card-pay need.
--
-- WHAT THIS DOES NOT DO
--   It does not touch bookings, payment_intents, escrow rows, wallets or any regular tasker. Money already paid and held while 7A part 2 was live
--   keeps the fee stored on its row (only NEW payments change). stage-7a-r-tests.sql prints how many such rows exist (INFO line).
--   It leaves is_local_tasker_user(uuid) in place if it exists (harmless, service role only; Stage 7E may use it).
-- ============================================================================

do $$
begin
  if to_regprocedure('public.platform_fee_rate()') is null then
    raise exception 'platform_fee_rate() is missing. Nothing was changed.';
  end if;
  if to_regclass('public.bookings') is null then
    raise exception 'The bookings table is missing. Nothing was changed.';
  end if;
end $$;

-- 1. THE fee rate for a tasker: the platform rate, for everyone -----------------------------------------------------
create or replace function public.platform_fee_rate_for_tasker(p_tasker uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select public.platform_fee_rate()
$$;
revoke all on function public.platform_fee_rate_for_tasker(uuid) from public, anon, authenticated;
grant execute on function public.platform_fee_rate_for_tasker(uuid) to service_role;

-- 2. The same answer by booking id (gift-card-pay). NULL when the booking does not exist: the Edge Function then refuses before moving money.
create or replace function public.platform_fee_rate_for_booking(p_booking uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select public.platform_fee_rate() from public.bookings b where b.id = p_booking
$$;
revoke all on function public.platform_fee_rate_for_booking(uuid) from public, anon, authenticated;
grant execute on function public.platform_fee_rate_for_booking(uuid) to service_role;

-- 3. The customer-side lookup that could show a different rate is removed ---------------------------------------------
drop function if exists public.booking_fee_rates(uuid[]);

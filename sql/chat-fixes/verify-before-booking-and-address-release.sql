-- StreetTasker: (1) a customer must be VERIFIED before a booking can be created, (2) the street address goes to the
-- tasker only after the customer has paid.
-- Run once in the Supabase SQL editor (live project). Safe to run again. Undo with verify-before-booking-and-address-release-rollback.sql.
-- Written from the policy you sent (booking_private_tasker_select) and the payment_status values in the code
-- ('unpaid', 'paid', 'released', 'disputed', 'refunded'). NOT checked: what public.idv_my_status() returns on your project.
-- This file assumes it returns json/jsonb with a "verified" key, which is what js/verify.js reads. Run the TESTS at the
-- bottom before relying on it.

-- ── 1. Verification guard on bookings ────────────────────────────────────────────────────────────────────────────────
-- Applies only when a signed-in customer creates their OWN booking from the site. It is skipped when there is no signed-in
-- user (server code with the service role) and when someone else creates it for the customer (a coordinator booking for a
-- Local Tasker's customer goes through its own functions).
create or replace function public.guard_booking_customer_verified()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_ok boolean := false;
begin
  if v_me is null or v_me is distinct from new.customer_id then
    return new;
  end if;
  begin
    v_ok := coalesce((public.idv_my_status() ->> 'verified') = 'true', false);
  exception when others then
    v_ok := false;                       -- no answer = no booking
  end;
  if not v_ok then
    raise exception 'Verify your identity before booking a service.' using errcode = 'P0001', hint = 'verification_required';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_booking_customer_verified on public.bookings;
create trigger trg_guard_booking_customer_verified
  before insert on public.bookings
  for each row execute function public.guard_booking_customer_verified();

-- ── 2. Street address released only after payment ───────────────────────────────────────────────────────────────────
-- Same rule as before (the booking must be accepted) PLUS the booking must be paid: payment_status paid, released or disputed.
drop policy if exists booking_private_tasker_select on public.booking_private;
create policy booking_private_tasker_select on public.booking_private
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_private.booking_id
      and b.tasker_id = auth.uid()
      and b.status = any (array['confirmed','in_progress','awaiting_confirmation','awaiting_code','provider_done','completed','disputed'])
      and b.payment_status = any (array['paid','released','disputed'])
  ));

-- ── TESTS (read only) ───────────────────────────────────────────────────────────────────────────────────────────────
-- A. The trigger and the policy exist (expect 1 row each)
select tgname from pg_trigger where tgname = 'trg_guard_booking_customer_verified' and not tgisinternal;
select policyname from pg_policies where schemaname = 'public' and tablename = 'booking_private' and policyname = 'booking_private_tasker_select';

-- B. What idv_my_status() returns. Run this while signed in as a customer in the app, or look at the key names in the function.
--    You need a "verified" key. If it is named differently, tell me and I will change line "v_ok :=" above.
select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'idv_my_status';

-- C. Live check in the app: with an UNVERIFIED customer account, send a booking request from a tasker profile.
--    Expected: "Verify your identity before booking a service." and no new row in bookings.
--    Then verify that account and send again: it should go through.

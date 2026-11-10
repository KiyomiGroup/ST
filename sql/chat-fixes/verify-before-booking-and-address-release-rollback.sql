-- Undo verify-before-booking-and-address-release.sql
drop trigger if exists trg_guard_booking_customer_verified on public.bookings;
drop function if exists public.guard_booking_customer_verified();

drop policy if exists booking_private_tasker_select on public.booking_private;
create policy booking_private_tasker_select on public.booking_private
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_private.booking_id
      and b.tasker_id = auth.uid()
      and b.status = any (array['confirmed','in_progress','awaiting_confirmation','awaiting_code','provider_done','completed','disputed'])
  ));

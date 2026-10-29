-- Stage 5D-3c-2 rollback. Re-runnable. Removes the functions and triggers; the record table is kept on purpose (history).
-- Problem reports already opened stay open: this file does not undo business actions (withdraw them from the booking page).
drop function if exists public.local_booking_reduction(uuid);
drop function if exists public.local_booking_request_reduction(uuid, uuid, numeric, text, text);
drop function if exists public._local_booking_reduction_block(uuid);
drop function if exists public._local_booking_reduction_paid(uuid);
drop trigger if exists lbrd_audit on public.local_booking_reductions;
drop trigger if exists lbrd_guard on public.local_booking_reductions;
drop function if exists public.local_booking_reductions_audit();
-- To remove the history too, uncomment:
-- drop table if exists public.local_booking_reductions;

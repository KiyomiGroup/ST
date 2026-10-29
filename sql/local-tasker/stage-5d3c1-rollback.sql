-- Stage 5D-3c-1 rollback. Re-runnable. Removes the functions and triggers; the record table is kept on purpose (history).
-- Extra-cost payment requests already made stay in the Job Room: this file does not undo business actions.
drop function if exists public.local_booking_extras(uuid);
drop function if exists public.local_booking_cancel_extra(uuid, uuid);
drop function if exists public.local_booking_request_extra(uuid, uuid, text, numeric, text, text, text);
drop function if exists public._local_booking_extra_room(uuid);
drop function if exists public._local_booking_extra_block(uuid);
drop trigger if exists lbec_audit on public.local_booking_extra_costs;
drop trigger if exists lbec_guard on public.local_booking_extra_costs;
drop function if exists public.local_booking_extra_costs_audit();
-- To remove the history too, uncomment:
-- drop table if exists public.local_booking_extra_costs;

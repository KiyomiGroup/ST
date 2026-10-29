-- Stage 5D-3a rollback. Re-runnable. Restores the 5D-2 block helper and record function by re-running stage-5d2-core.sql at the end.
drop trigger if exists lbs_going_back_guard on public.local_booking_state;
drop function if exists public.local_booking_state_going_back_guard();
drop function if exists public.local_booking_customer_exceptions(uuid);
drop function if exists public.local_booking_exceptions(uuid);
drop function if exists public.local_booking_record_exception(uuid, uuid, text, timestamptz, text);
-- NEXT STEP AFTER THIS FILE: run stage-5d2-core.sql again. It puts back the 5D-2 versions of _local_booking_milestone_block and
-- local_booking_record_milestone (the 5D-3a versions know about a no-show). The small helper _local_booking_no_show_standing is left
-- in place on purpose (no browser access, harmless) so nothing breaks between the two runs.
drop trigger if exists lbx_audit on public.local_booking_exceptions;
drop trigger if exists lbx_guard on public.local_booking_exceptions;
drop function if exists public.local_booking_exceptions_audit();
drop function if exists public.local_booking_exceptions_guard();
-- Recorded exceptions are kept on purpose (history). To remove them too, uncomment the next line:
-- drop table if exists public.local_booking_exceptions;

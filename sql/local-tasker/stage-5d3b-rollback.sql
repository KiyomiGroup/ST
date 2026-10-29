-- Stage 5D-3b rollback. Re-runnable. Removes the functions and triggers; the three record tables are kept on purpose (history).
-- Cancelled bookings stay cancelled and reports already opened stay open (support decides them): this file does not undo business actions.
drop function if exists public.local_booking_closeout(uuid);
drop function if exists public.local_booking_withdraw_problem(uuid, uuid);
drop function if exists public.local_booking_open_problem(uuid, uuid, text, text);
drop function if exists public.local_booking_cancel(uuid, uuid, text, text);
drop function if exists public._local_booking_report_block(uuid);
drop function if exists public._local_booking_cancel_block(uuid);
drop trigger if exists lbpr_audit on public.local_booking_problem_reports;
drop trigger if exists lbpr_guard on public.local_booking_problem_reports;
drop trigger if exists lbc_audit on public.local_booking_cancellations;
drop trigger if exists lbc_guard on public.local_booking_cancellations;
drop function if exists public.local_booking_problem_reports_audit();
drop function if exists public.local_booking_cancellations_audit();
drop function if exists public.local_booking_closeout_guard();
-- To remove the history too, uncomment:
-- drop table if exists public.local_booking_problem_reports;
-- drop table if exists public.local_booking_cancellations;

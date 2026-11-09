-- Undo stage A12b: removes the four new functions. admin_booking_detail keeps the A12b version (it only reads the two real
-- exception column names instead of two that do not exist); re-run sql/admin/a12a-bookings.sql (already corrected) if you want the A12a file's text.
-- No table, policy or existing function was changed by A12b.
drop function if exists public.admin_local_booking_coordinators();
drop function if exists public.admin_local_booking_reassign(uuid, uuid, text);
drop function if exists public.admin_local_booking_unlock(uuid, text);
drop function if exists public.admin_local_exception_list(text, integer);
select 'DONE: A12b removed. The Problems tab and the action panels will say a function is missing.' as a12b_rollback;

-- Undo stage A12a: removes the three read-only functions and the helper. A12a changed no table, policy or existing function,
-- so this restores the database to the A10 state.
drop function if exists public.admin_booking_list(text, text, text, integer);
drop function if exists public.admin_booking_detail(uuid);
drop function if exists public.admin_task_list(text, text, integer);
drop function if exists public._a12a_pick(jsonb, text[]);
select 'DONE: A12a removed.' as a12a_rollback;

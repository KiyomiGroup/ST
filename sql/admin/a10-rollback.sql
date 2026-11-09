-- Undo stage A10: removes the four admin_local_tasker_* functions and the helper. Nothing else was changed by A10 (no table, policy or
-- existing function), so this restores the database to the A9 state. Local Taskers unpublished or deactivated through the page stay as they are.
drop function if exists public.admin_local_tasker_list(text, text, uuid, integer);
drop function if exists public.admin_local_tasker_detail(uuid);
drop function if exists public.admin_local_tasker_unpublish(uuid, text);
drop function if exists public.admin_local_tasker_deactivate(uuid, text);
drop function if exists public._a10_pick(jsonb, text[]);
select 'DONE: A10 removed.' as a10_rollback;

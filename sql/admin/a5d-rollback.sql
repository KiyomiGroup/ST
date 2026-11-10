-- Rollback for stage A5d: removes the functions only. Changes no data, no table and no log. Requests already in the queue stay.
drop function if exists public.admin_team_changes_mine();
drop function if exists public.admin_role_apply_change(uuid);
drop function if exists public.admin_role_request_change(text, text[], text);
drop function if exists public.admin_team_apply_change(uuid);
drop function if exists public.admin_team_request_change(uuid, text, text[], text);
drop function if exists public.admin_is_last_super(uuid);
drop function if exists public.admin_role_target_version(text);
drop function if exists public.admin_team_target_version(uuid);

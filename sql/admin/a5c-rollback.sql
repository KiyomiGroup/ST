-- Rollback for stage A5c: removes the two reader functions only. Changes no data, no table and no log.
drop function if exists public.admin_role_directory();
drop function if exists public.admin_team_list();

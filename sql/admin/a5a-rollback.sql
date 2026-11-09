-- Rollback for stage A5a: removes the four reader functions only. Changes no data, no table and no log.
drop function if exists public.admin_approval_detail(uuid);
drop function if exists public.admin_approval_list(text, text, int, int);
drop function if exists public.admin_approval_counts();
drop function if exists public.admin_approval_scope();

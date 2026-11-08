-- StreetTasker Admin Control Centre, stage A1: ROLLBACK.
-- Removes everything a1-admin-core.sql created. Touches nothing else.
-- WARNING: this deletes the admin audit log. Use it only before the admin area is in use.
-- support_staff: removes ONLY the row(s) the bootstrap added (note 'admin bootstrap (A1)').

delete from public.support_staff where note = 'admin bootstrap (A1)';

drop trigger if exists admin_users_protect_last on public.admin_users;
drop trigger if exists admin_user_roles_protect_last on public.admin_user_roles;
drop trigger if exists admin_audit_no_update on public.admin_audit_log;
drop trigger if exists admin_audit_no_truncate on public.admin_audit_log;

drop function if exists public.admin_bootstrap_super_admin(text, text, boolean);
drop function if exists public.admin_bootstrap_super_admin(text, text);
drop function if exists public.admin_my_access();
drop function if exists public.admin_guard(text, text);
drop function if exists public.admin_log(text, text, text, jsonb, jsonb, text, uuid, text, jsonb);
drop function if exists public.admin_require(text);
drop function if exists public.admin_has(text);
drop function if exists public.admin_protect_last_super_user();
drop function if exists public.admin_protect_last_super_role();
drop function if exists public.admin_audit_immutable();

drop table if exists public.admin_audit_log;
drop table if exists public.admin_user_roles;
drop table if exists public.admin_role_permissions;
drop table if exists public.admin_permissions;
drop table if exists public.admin_roles;
drop table if exists public.admin_settings;
drop table if exists public.admin_users;

-- ============================================================================
-- StreetTasker Admin Control Centre, stage A5c: Admin Team and Roles (READ ONLY).
-- ADDITIVE and safe to run twice. Creates two functions. Changes no table, no policy, no
-- existing function, and writes no row (reading is not logged here, as in A5a and A6).
-- Rollback: a5c-rollback.sql. Needs a1-admin-core.sql first.
--
--   admin_team_list()       every admin login: name, email, status, roles, last active, two-step on/off
--   admin_role_directory()  every role with its permissions (and the full permission list, grouped)
--
-- Who may call: admin_team_list needs admin.team.view. admin_role_directory needs admin.team.view
-- or admin.roles.manage. Anyone else gets error 42501 (the page shows "no permission").
-- Email addresses and two-step status are returned only to a caller who passed that check.
-- Not returned: password data, factor ids, secrets, IP addresses.
-- Super Admin holds every permission by rule (admin_has), so its list is the whole permission list.
-- ============================================================================

do $$
begin
  if to_regclass('public.admin_users') is null or to_regclass('public.admin_role_permissions') is null then
    raise exception 'Run sql/admin/a1-admin-core.sql first (the admin tables are missing).';
  end if;
end $$;

create or replace function public.admin_team_list()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_req boolean;
  v_supers int;
begin
  if not public.admin_has('admin.team.view') then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;

  v_req := coalesce((select s.text_value from public.admin_settings s where s.key = 'require_mfa'), 'off') = 'on';

  select count(*) into v_supers
    from public.admin_user_roles r join public.admin_users u on u.user_id = r.user_id
   where r.role_key = 'super_admin' and u.status = 'active' and u.removed_at is null;

  select coalesce(jsonb_agg(to_jsonb(y) - 'sort_key' order by y.sort_key, lower(coalesce(y.display_name, '')), y.user_id), '[]'::jsonb)
    into v_rows
    from (
      select u.user_id,
             u.display_name,
             (select a.email::text from auth.users a where a.id = u.user_id) as email,
             u.status,
             (u.removed_at is not null) as removed,
             u.created_at,
             u.last_seen_at,
             (u.user_id = v_uid) as is_me,
             coalesce((select jsonb_agg(jsonb_build_object('key', ur.role_key, 'label', r.label) order by r.label)
                         from public.admin_user_roles ur join public.admin_roles r on r.key = ur.role_key
                        where ur.user_id = u.user_id), '[]'::jsonb) as roles,
             exists (select 1 from auth.mfa_factors f
                      where f.user_id = u.user_id and f.factor_type::text = 'totp' and f.status::text = 'verified') as mfa_on,
             case when u.status = 'active' and u.removed_at is null then 0 else 1 end as sort_key
        from public.admin_users u
    ) y;

  return jsonb_build_object('mfa_required', v_req, 'active_super_admins', v_supers, 'rows', v_rows);
end $$;

create or replace function public.admin_role_directory()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_perms jsonb;
  v_roles jsonb;
begin
  if not (public.admin_has('admin.team.view') or public.admin_has('admin.roles.manage')) then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('key', p.key, 'label', p.label, 'group_name', p.group_name, 'sensitive', p.sensitive)
                            order by p.group_name, p.label), '[]'::jsonb)
    into v_perms from public.admin_permissions p;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', r.key,
           'label', r.label,
           'is_system', r.is_system,
           'all_permissions', (r.key = 'super_admin'),
           'permission_keys',
             case when r.key = 'super_admin'
                  then (select coalesce(jsonb_agg(p.key order by p.key), '[]'::jsonb) from public.admin_permissions p)
                  else (select coalesce(jsonb_agg(rp.permission_key order by rp.permission_key), '[]'::jsonb)
                          from public.admin_role_permissions rp where rp.role_key = r.key) end,
           'members',
             (select coalesce(jsonb_agg(coalesce(u.display_name, 'Unnamed admin') order by lower(coalesce(u.display_name, ''))), '[]'::jsonb)
                from public.admin_user_roles ur join public.admin_users u on u.user_id = ur.user_id
               where ur.role_key = r.key and u.status = 'active' and u.removed_at is null)
         ) order by (r.key = 'super_admin') desc, r.label), '[]'::jsonb)
    into v_roles from public.admin_roles r;

  return jsonb_build_object('roles', v_roles, 'permissions', v_perms);
end $$;

revoke all on function public.admin_team_list()      from public, anon, authenticated;
revoke all on function public.admin_role_directory() from public, anon, authenticated;
grant execute on function public.admin_team_list()      to authenticated;
grant execute on function public.admin_role_directory() to authenticated;
-- (each function checks its permission itself: a signed-in person without it gets error 42501)

select case
  when to_regprocedure('public.admin_team_list()') is not null
   and to_regprocedure('public.admin_role_directory()') is not null
  then 'DONE: A5c installed. Super Admins can open /admin/team.html and /admin/roles.html.'
  else 'NOT DONE: see the messages above.'
end as a5c_result;

-- ============================================================================
-- StreetTasker Admin Control Centre, stage A5d: team and role changes THROUGH APPROVALS.
-- ADDITIVE and safe to run twice. Changes no table, no policy, no trigger and no existing function.
-- Rollback: a5d-rollback.sql (drops only the functions below; no data is touched).
-- Needs a1-admin-core.sql and a2-approvals.sql first.
--
-- How a change happens (two people, two steps):
--   1. A Super Admin with the permission ASKS: admin_team_request_change / admin_role_request_change.
--      Nothing changes yet. The request goes to the approval queue (admin_approval_requests).
--   2. A DIFFERENT Super Admin approves it on the Pending approvals page (A5b).
--   3. The person who asked APPLIES it: admin_team_apply_change / admin_role_apply_change.
--      The apply function uses admin_consume_approval, which re-checks everything (approved, not expired, same action,
--      same target, the target unchanged since the request, approver still a Super Admin) and marks the request used,
--      in the same transaction as the change. If anything fails, nothing at all is changed.
--
-- Team changes (action admin.team.change): set_roles (replace the whole role set), suspend, reactivate.
-- Role change (action admin.role.change): replace the permission set of one role (never super_admin).
-- Rules enforced here (and some again by the A1 triggers):
--   * nobody may change their own roles or status (another Super Admin must);
--   * the last active Super Admin cannot lose that role or be suspended;
--   * a role must keep at least one role per admin (to remove access, suspend);
--   * super_admin's permissions cannot be edited (it holds every permission by rule);
--   * approvals.decide can never be given to a role other than super_admin;
--   * suspending also removes the login from support_staff (so support.html closes too); reactivating a Super Admin adds it back.
-- Every request, refusal and change is written to admin_audit_log (append only).
-- ============================================================================

do $$
begin
  if to_regclass('public.admin_approval_requests') is null or to_regprocedure('public.admin_consume_approval(uuid,text,text,text,jsonb,text,jsonb)') is null then
    raise exception 'Run sql/admin/a2-approvals.sql first (the approval functions are missing).';
  end if;
  if to_regclass('public.support_staff') is null then
    raise exception 'The support_staff table is missing: run sql/admin/a1-admin-core.sql and check the A1 bootstrap first.';
  end if;
end $$;

-- ---------- internal helpers (no browser access) ------------------------------

create or replace function public.admin_team_target_version(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select md5(
    coalesce((select u.status || '|' || coalesce(u.removed_at::text, '') from public.admin_users u where u.user_id = p_user), 'none')
    || '|' ||
    coalesce((select string_agg(ur.role_key, ',' order by ur.role_key) from public.admin_user_roles ur where ur.user_id = p_user), ''))
$$;

create or replace function public.admin_role_target_version(p_role text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select md5(coalesce((select string_agg(rp.permission_key, ',' order by rp.permission_key)
                         from public.admin_role_permissions rp where rp.role_key = p_role), ''))
$$;

-- True when p_user is an active Super Admin and no other active Super Admin exists.
create or replace function public.admin_is_last_super(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admin_user_roles r join public.admin_users u on u.user_id = r.user_id
                  where r.user_id = p_user and r.role_key = 'super_admin' and u.status = 'active' and u.removed_at is null)
     and not exists (select 1 from public.admin_user_roles r join public.admin_users u on u.user_id = r.user_id
                      where r.role_key = 'super_admin' and r.user_id <> p_user and u.status = 'active' and u.removed_at is null)
$$;

-- ---------- team: ask --------------------------------------------------------

create or replace function public.admin_team_request_change(
  p_user uuid, p_change text, p_roles text[] default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_au public.admin_users;
  v_cur text[];
  v_new text[];
  v_bad text;
  v_payload jsonb;
begin
  if not public.admin_guard('admin.team.manage', 'admin.team.request') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change the admin team.');
  end if;
  if p_user is null or p_change is null or p_change not in ('set_roles', 'suspend', 'reactivate') then
    return jsonb_build_object('ok', false, 'error', 'Say which admin and which change.');
  end if;
  if p_user = v_uid then
    return jsonb_build_object('ok', false, 'error', 'You cannot change your own roles or status. Ask another Super Admin to do it.');
  end if;
  select * into v_au from public.admin_users u where u.user_id = p_user;
  if not found or v_au.removed_at is not null or v_au.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'That admin does not exist or was removed.');
  end if;
  select coalesce(array_agg(ur.role_key order by ur.role_key), '{}') into v_cur from public.admin_user_roles ur where ur.user_id = p_user;

  if p_change = 'set_roles' then
    if v_au.status <> 'active' then
      return jsonb_build_object('ok', false, 'error', 'Reactivate this admin before changing roles.');
    end if;
    select coalesce(array_agg(k order by k), '{}') into v_new
      from (select distinct lower(btrim(x)) as k from unnest(coalesce(p_roles, '{}'::text[])) x where btrim(x) <> '') s;
    if cardinality(v_new) = 0 then
      return jsonb_build_object('ok', false, 'error', 'Choose at least one role. To remove access, suspend the admin instead.');
    end if;
    select string_agg(x, ', ') into v_bad from unnest(v_new) x where not exists (select 1 from public.admin_roles r where r.key = x);
    if v_bad is not null then
      return jsonb_build_object('ok', false, 'error', 'Unknown role: ' || v_bad);
    end if;
    if v_new = v_cur then
      return jsonb_build_object('ok', false, 'error', 'This admin already has exactly these roles.');
    end if;
    if 'super_admin' = any (v_cur) and not ('super_admin' = any (v_new)) and public.admin_is_last_super(p_user) then
      return jsonb_build_object('ok', false, 'error', 'This is the last active Super Admin. Appoint another Super Admin first.');
    end if;
    v_payload := jsonb_build_object('change', 'set_roles', 'roles', to_jsonb(v_new));
  elsif p_change = 'suspend' then
    if v_au.status <> 'active' then
      return jsonb_build_object('ok', false, 'error', 'This admin is not active.');
    end if;
    if public.admin_is_last_super(p_user) then
      return jsonb_build_object('ok', false, 'error', 'This is the last active Super Admin. Appoint another Super Admin first.');
    end if;
    v_payload := jsonb_build_object('change', 'suspend');
  else
    if v_au.status <> 'suspended' then
      return jsonb_build_object('ok', false, 'error', 'Only a suspended admin can be reactivated.');
    end if;
    v_payload := jsonb_build_object('change', 'reactivate');
  end if;

  return public.admin_request_approval('admin.team.change', 'admin', p_user::text, v_payload, p_reason,
           jsonb_build_object('status', v_au.status, 'roles', to_jsonb(v_cur)), public.admin_team_target_version(p_user));
end $$;

-- ---------- team: apply an approved request ----------------------------------

create or replace function public.admin_team_apply_change(p_approval uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  q public.admin_approval_requests;
  v_target uuid;
  v_change text;
  v_roles text[];
  v_old_roles text[];
  v_new_roles text[];
  v_au public.admin_users;
  v_old jsonb;
  v_new jsonb;
  v_support text := 'unchanged';
  v_n int;
  v_msg text := null;
begin
  if not public.admin_guard('admin.team.manage', 'admin.team.apply') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change the admin team.');
  end if;
  select * into q from public.admin_approval_requests r where r.id = p_approval;
  if not found or q.action <> 'admin.team.change' then
    return jsonb_build_object('ok', false, 'error', 'That approval is not for an admin team change.');
  end if;
  if q.requested_by <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'Only the person who asked for the change can apply it.');
  end if;

  begin
    v_target := q.target_id::uuid;
    if v_target = v_uid then
      raise exception 'You cannot change your own roles or status.' using errcode = 'P0001';
    end if;
    v_change := q.payload ->> 'change';
    select * into v_au from public.admin_users u where u.user_id = v_target for update;
    if not found or v_au.removed_at is not null or v_au.status = 'removed' then
      raise exception 'That admin does not exist or was removed.' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(ur.role_key order by ur.role_key), '{}') into v_old_roles from public.admin_user_roles ur where ur.user_id = v_target;
    v_old := jsonb_build_object('status', v_au.status, 'roles', to_jsonb(v_old_roles));

    -- Re-checks approved, not expired, same action and target, unchanged target, approver still allowed. Marks it used.
    perform public.admin_consume_approval(p_approval, 'admin.team.change', 'admin', q.target_id, q.payload,
                                          public.admin_team_target_version(v_target), jsonb_build_object('change', v_change));

    if v_change = 'set_roles' then
      select coalesce(array_agg(x order by x), '{}') into v_roles from jsonb_array_elements_text(q.payload -> 'roles') x;
      if cardinality(v_roles) = 0 then raise exception 'The approved change has no roles.' using errcode = 'P0001'; end if;
      if exists (select 1 from unnest(v_roles) x where not exists (select 1 from public.admin_roles r where r.key = x)) then
        raise exception 'One of the roles no longer exists.' using errcode = 'P0001';
      end if;
      if v_au.status <> 'active' then raise exception 'This admin is not active.' using errcode = 'P0001'; end if;
      if 'super_admin' = any (v_old_roles) and not ('super_admin' = any (v_roles)) and public.admin_is_last_super(v_target) then
        raise exception 'This is the last active Super Admin. Appoint another Super Admin first.' using errcode = 'P0001';
      end if;
      insert into public.admin_user_roles (user_id, role_key, granted_by)
        select v_target, x, v_uid from unnest(v_roles) x on conflict do nothing;
      delete from public.admin_user_roles ur where ur.user_id = v_target and not (ur.role_key = any (v_roles));
    elsif v_change = 'suspend' then
      if v_au.status <> 'active' then raise exception 'This admin is not active.' using errcode = 'P0001'; end if;
      if public.admin_is_last_super(v_target) then
        raise exception 'This is the last active Super Admin. Appoint another Super Admin first.' using errcode = 'P0001';
      end if;
      update public.admin_users set status = 'suspended' where user_id = v_target;
      delete from public.support_staff s where s.user_id = v_target;
      get diagnostics v_n = row_count;
      v_support := case when v_n > 0 then 'removed' else 'unchanged' end;
    elsif v_change = 'reactivate' then
      if v_au.status <> 'suspended' then raise exception 'Only a suspended admin can be reactivated.' using errcode = 'P0001'; end if;
      update public.admin_users set status = 'active', removed_at = null where user_id = v_target;
      if exists (select 1 from public.admin_user_roles ur where ur.user_id = v_target and ur.role_key = 'super_admin') then
        insert into public.support_staff (user_id, note, added_at) values (v_target, 'admin reactivated (A5d)', now())
          on conflict (user_id) do nothing;
        v_support := 'added';
      end if;
    else
      raise exception 'The approved change is not one this function knows.' using errcode = 'P0001';
    end if;

    select coalesce(array_agg(ur.role_key order by ur.role_key), '{}') into v_new_roles from public.admin_user_roles ur where ur.user_id = v_target;
    v_new := jsonb_build_object('status', (select u.status from public.admin_users u where u.user_id = v_target), 'roles', to_jsonb(v_new_roles));
    perform public.admin_log('admin.team.changed', 'admin_user', v_target::text, v_old, v_new, q.reason, p_approval, 'ok',
                             jsonb_build_object('change', v_change, 'support_staff', v_support));
  exception when others then
    v_msg := sqlerrm;
  end;

  if v_msg is not null then
    perform public.admin_log('admin.team.apply', 'admin_user', q.target_id, null, null, null, p_approval, 'refused', jsonb_build_object('error', v_msg));
    return jsonb_build_object('ok', false, 'error', v_msg);
  end if;
  return jsonb_build_object('ok', true, 'change', v_change);
end $$;

-- ---------- role permissions: ask --------------------------------------------

create or replace function public.admin_role_request_change(p_role text, p_permissions text[] default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_cur text[];
  v_new text[];
  v_bad text;
begin
  if not public.admin_guard('admin.roles.manage', 'admin.role.request') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change roles.');
  end if;
  if not exists (select 1 from public.admin_roles r where r.key = v_role) then
    return jsonb_build_object('ok', false, 'error', 'That role does not exist.');
  end if;
  if v_role = 'super_admin' then
    return jsonb_build_object('ok', false, 'error', 'Super Admin always holds every permission and cannot be edited.');
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_new
    from (select distinct lower(btrim(x)) as k from unnest(coalesce(p_permissions, '{}'::text[])) x where btrim(x) <> '') s;
  select string_agg(x, ', ') into v_bad from unnest(v_new) x where not exists (select 1 from public.admin_permissions p where p.key = x);
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'error', 'Unknown permission: ' || v_bad);
  end if;
  if 'approvals.decide' = any (v_new) then
    return jsonb_build_object('ok', false, 'error', 'Only a Super Admin can decide approvals. This permission cannot be given to another role.');
  end if;
  select coalesce(array_agg(rp.permission_key order by rp.permission_key), '{}') into v_cur from public.admin_role_permissions rp where rp.role_key = v_role;
  if v_new = v_cur then
    return jsonb_build_object('ok', false, 'error', 'This role already has exactly these permissions.');
  end if;
  return public.admin_request_approval('admin.role.change', 'role', v_role, jsonb_build_object('permissions', to_jsonb(v_new)), p_reason,
           jsonb_build_object('permissions', to_jsonb(v_cur)), public.admin_role_target_version(v_role));
end $$;

-- ---------- role permissions: apply an approved request ----------------------

create or replace function public.admin_role_apply_change(p_approval uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  q public.admin_approval_requests;
  v_perms text[];
  v_old text[];
  v_new text[];
  v_msg text := null;
begin
  if not public.admin_guard('admin.roles.manage', 'admin.role.apply') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change roles.');
  end if;
  select * into q from public.admin_approval_requests r where r.id = p_approval;
  if not found or q.action <> 'admin.role.change' then
    return jsonb_build_object('ok', false, 'error', 'That approval is not for a role change.');
  end if;
  if q.requested_by <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'Only the person who asked for the change can apply it.');
  end if;

  begin
    if q.target_id = 'super_admin' then
      raise exception 'That role cannot be changed.' using errcode = 'P0001';
    end if;
    perform 1 from public.admin_roles r where r.key = q.target_id for update;
    if not found then
      raise exception 'That role does not exist.' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(rp.permission_key order by rp.permission_key), '{}') into v_old from public.admin_role_permissions rp where rp.role_key = q.target_id;

    perform public.admin_consume_approval(p_approval, 'admin.role.change', 'role', q.target_id, q.payload,
                                          public.admin_role_target_version(q.target_id), jsonb_build_object('permissions', to_jsonb(v_old)));

    select coalesce(array_agg(x order by x), '{}') into v_perms from jsonb_array_elements_text(q.payload -> 'permissions') x;
    if 'approvals.decide' = any (v_perms) then
      raise exception 'Only a Super Admin can decide approvals.' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(v_perms) x where not exists (select 1 from public.admin_permissions p where p.key = x)) then
      raise exception 'One of the permissions no longer exists.' using errcode = 'P0001';
    end if;
    insert into public.admin_role_permissions (role_key, permission_key)
      select q.target_id, x from unnest(v_perms) x on conflict do nothing;
    delete from public.admin_role_permissions rp where rp.role_key = q.target_id and not (rp.permission_key = any (v_perms));

    select coalesce(array_agg(rp.permission_key order by rp.permission_key), '{}') into v_new from public.admin_role_permissions rp where rp.role_key = q.target_id;
    perform public.admin_log('admin.role.changed', 'admin_role', q.target_id, jsonb_build_object('permissions', to_jsonb(v_old)),
                             jsonb_build_object('permissions', to_jsonb(v_new)), q.reason, p_approval, 'ok', null);
  exception when others then
    v_msg := sqlerrm;
  end;

  if v_msg is not null then
    perform public.admin_log('admin.role.apply', 'admin_role', q.target_id, null, null, null, p_approval, 'refused', jsonb_build_object('error', v_msg));
    return jsonb_build_object('ok', false, 'error', v_msg);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- my open change requests (for the Team and Roles pages) ----------

create or replace function public.admin_team_changes_mine()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rows jsonb;
begin
  if not (public.admin_has('admin.team.manage') or public.admin_has('admin.roles.manage')) then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'action', q.action, 'status', q.status, 'target_id', q.target_id,
           'target_label', case when q.action = 'admin.team.change'
                                then (select coalesce(u.display_name, 'Unnamed admin') from public.admin_users u where u.user_id::text = q.target_id)
                                else (select r.label from public.admin_roles r where r.key = q.target_id) end,
           'payload', q.payload, 'previous_value', q.previous_value, 'reason', q.reason,
           'requested_at', q.requested_at, 'expires_at', q.expires_at,
           'seconds_left', greatest(0, floor(extract(epoch from (q.expires_at - now()))))::bigint)
         order by q.requested_at desc), '[]'::jsonb)
    into v_rows
    from public.admin_approval_requests q
   where q.requested_by = v_uid and q.action in ('admin.team.change', 'admin.role.change')
     and q.status in ('pending', 'approved') and q.expires_at > now();
  return jsonb_build_object('rows', v_rows);
end $$;

-- ---------- who may run what ---------------------------------------------------

revoke all on function public.admin_team_target_version(uuid)                  from public, anon, authenticated;
revoke all on function public.admin_role_target_version(text)                  from public, anon, authenticated;
revoke all on function public.admin_is_last_super(uuid)                        from public, anon, authenticated;
revoke all on function public.admin_team_request_change(uuid, text, text[], text) from public, anon, authenticated;
revoke all on function public.admin_team_apply_change(uuid)                    from public, anon, authenticated;
revoke all on function public.admin_role_request_change(text, text[], text)    from public, anon, authenticated;
revoke all on function public.admin_role_apply_change(uuid)                    from public, anon, authenticated;
revoke all on function public.admin_team_changes_mine()                        from public, anon, authenticated;
grant execute on function public.admin_team_request_change(uuid, text, text[], text) to authenticated;
grant execute on function public.admin_team_apply_change(uuid)                 to authenticated;
grant execute on function public.admin_role_request_change(text, text[], text) to authenticated;
grant execute on function public.admin_role_apply_change(uuid)                 to authenticated;
grant execute on function public.admin_team_changes_mine()                     to authenticated;
-- (the five above check the caller's admin permission themselves; the three helpers are for server code only)

select case
  when to_regprocedure('public.admin_team_request_change(uuid,text,text[],text)') is not null
   and to_regprocedure('public.admin_team_apply_change(uuid)') is not null
   and to_regprocedure('public.admin_role_request_change(text,text[],text)') is not null
   and to_regprocedure('public.admin_role_apply_change(uuid)') is not null
   and to_regprocedure('public.admin_team_changes_mine()') is not null
  then 'DONE: A5d installed. Team and role changes now go through approvals.'
  else 'NOT DONE: see the messages above.'
end as a5d_result;

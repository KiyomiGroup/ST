-- ============================================================================
-- StreetTasker Admin Control Centre, stage A5e: INVITE a new admin, through an approval.
-- ADDITIVE and safe to run twice. Changes no table, no policy, no trigger and no existing function.
-- It adds ONE row to the A2 registry of sensitive actions (admin.team.invite) and the functions below.
-- Rollback: a5e-rollback.sql. Needs a1-admin-core.sql, a2-approvals.sql and a5d-team-write.sql first.
--
-- How an invite happens (three steps, two people):
--   1. A Super Admin ASKS: admin_invite_request(email, roles, reason, name). Nothing is created. The request goes to the
--      approval queue and the OTHER Super Admins are told.
--   2. A DIFFERENT Super Admin approves it on the Pending approvals page (A5b). The page shows the email and the roles.
--   3. The person who asked SENDS it from the Admin team page. That calls the Edge Function admin-invite, which
--        a. asks admin_invite_precheck (as the caller) whether the approval is good,
--        b. creates the login in Supabase Auth with the service-role key (kept on the server) and sends the invite email,
--        c. asks admin_invite_finish (as the caller), which uses the approval ONCE and, in one transaction, makes the
--           admin_users row, the roles and (for a Super Admin) the support_staff row.
--      The browser sends only the approval id. The email and roles come from the approved request, never from the browser.
-- Rules enforced here:
--   * needs admin.team.manage; the approver is a different Super Admin; the requester sends (A2 consume rules);
--   * the email must be a NEW login for admin work: it is refused if it is already an admin, or already has a customer,
--     Tasker or coordinator account (a separate admin login is the safer design);
--   * at least one role, every role must exist; the invite expires like any approval (72 hours);
--   * every ask, refusal and invite is in admin_audit_log (append only).
-- ============================================================================

do $$
begin
  if to_regprocedure('public.admin_consume_approval(uuid,text,text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('public.admin_request_approval(text,text,text,jsonb,text,jsonb,text)') is null then
    raise exception 'Run sql/admin/a2-approvals.sql first (the approval functions are missing).';
  end if;
  if to_regprocedure('public.admin_team_apply_change(uuid)') is null then
    raise exception 'Run sql/admin/a5d-team-write.sql first.';
  end if;
  if to_regclass('public.support_staff') is null then
    raise exception 'The support_staff table is missing: run sql/admin/a1-admin-core.sql and check the A1 bootstrap first.';
  end if;
end $$;

-- The registry row (A2 table). Same permission as the other team changes.
insert into public.admin_sensitive_actions (action, permission_required, risk, expires_hours, check_target_version, notes)
values ('admin.team.invite', 'admin.team.manage', 'high', 72, true, 'Invite a new admin')
on conflict (action) do nothing;

-- ---------- internal helpers (no browser access) ------------------------------

-- Changes when the email gains or loses an admin row (creating the Auth login does NOT change it).
create or replace function public.admin_invite_target_version(p_email text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select md5(coalesce((select u.status || '|' || coalesce(u.removed_at::text, '')
                         from public.admin_users u join auth.users a on a.id = u.user_id
                        where lower(a.email) = lower(btrim(p_email)) limit 1), 'none'))
$$;

-- For the Edge Function only (service role): does a login with this email exist, and is it an account that is not for admin work?
create or replace function public.admin_invite_auth_lookup(p_email text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_confirmed boolean; v_site boolean; v_admin boolean;
begin
  select a.id, (a.email_confirmed_at is not null) into v_id, v_confirmed
    from auth.users a where lower(a.email) = lower(btrim(p_email)) limit 1;
  if v_id is null then
    return jsonb_build_object('exists', false, 'user_id', null, 'confirmed', false, 'site_account', false, 'is_admin', false);
  end if;
  v_site  := exists (select 1 from public.users x where x.id = v_id) or exists (select 1 from public.coordinators c where c.user_id = v_id);
  v_admin := exists (select 1 from public.admin_users u where u.user_id = v_id);
  return jsonb_build_object('exists', true, 'user_id', v_id, 'confirmed', coalesce(v_confirmed, false), 'site_account', v_site, 'is_admin', v_admin);
end $$;

-- ---------- ask -----------------------------------------------------------------

create or replace function public.admin_invite_request(
  p_email text, p_roles text[] default null, p_reason text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_new text[];
  v_bad text;
  v_lookup jsonb;
begin
  if not public.admin_guard('admin.team.manage', 'admin.invite.request') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change the admin team.');
  end if;
  if v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or char_length(v_email) > 200 then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid email address.');
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'The name is too long (80 characters at most).');
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_new
    from (select distinct lower(btrim(x)) as k from unnest(coalesce(p_roles, '{}'::text[])) x where btrim(x) <> '') s;
  if cardinality(v_new) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Choose at least one role.');
  end if;
  select string_agg(x, ', ') into v_bad from unnest(v_new) x where not exists (select 1 from public.admin_roles r where r.key = x);
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'error', 'Unknown role: ' || v_bad);
  end if;
  v_lookup := public.admin_invite_auth_lookup(v_email);
  if (v_lookup ->> 'is_admin')::boolean then
    return jsonb_build_object('ok', false, 'error', 'This email already belongs to an admin (active, suspended or removed). Use Change on the team list instead.');
  end if;
  if (v_lookup ->> 'site_account')::boolean then
    return jsonb_build_object('ok', false, 'error', 'This email already has a customer, Tasker or coordinator account. Use a separate email made only for admin work.');
  end if;

  return public.admin_request_approval('admin.team.invite', 'admin_invite', v_email,
           jsonb_build_object('change', 'invite', 'email', v_email, 'name', v_name, 'roles', to_jsonb(v_new)),
           p_reason, '{"admin": null}'::jsonb, public.admin_invite_target_version(v_email));
end $$;

-- ---------- check (read only; the Edge Function calls it as the caller BEFORE it creates a login) ----------

create or replace function public.admin_invite_precheck(p_approval uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  q public.admin_approval_requests;
  v_email text;
  v_lookup jsonb;
begin
  if not public.admin_has('admin.team.manage') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change the admin team.');
  end if;
  select * into q from public.admin_approval_requests r where r.id = p_approval;
  if not found or q.action <> 'admin.team.invite' then
    return jsonb_build_object('ok', false, 'error', 'That approval is not for an admin invite.');
  end if;
  if q.requested_by <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'Only the person who asked for the invite can send it.');
  end if;
  if q.status = 'consumed' then return jsonb_build_object('ok', false, 'error', 'That invite was already sent.'); end if;
  if q.status <> 'approved' then return jsonb_build_object('ok', false, 'error', 'That invite has not been approved (status: ' || q.status || ').'); end if;
  if q.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'That approval has expired. Ask again.'); end if;
  if q.decided_by is null or q.decided_by = q.requested_by or not public.admin_user_has(q.decided_by, 'approvals.decide') then
    return jsonb_build_object('ok', false, 'error', 'The approval is not valid any more. Ask again.');
  end if;
  if q.payload_hash is distinct from public.admin_approval_hash(q.action, q.target_type, q.target_id, q.payload) then
    return jsonb_build_object('ok', false, 'error', 'The request is not the one that was approved.');
  end if;
  v_email := lower(btrim(coalesce(q.payload ->> 'email', '')));
  if v_email = '' or v_email is distinct from q.target_id then
    return jsonb_build_object('ok', false, 'error', 'The approved request has no valid email.');
  end if;
  if q.target_version is distinct from public.admin_invite_target_version(v_email) then
    return jsonb_build_object('ok', false, 'error', 'This email changed after the approval was asked for. Ask again.');
  end if;
  v_lookup := public.admin_invite_auth_lookup(v_email);
  if (v_lookup ->> 'is_admin')::boolean then return jsonb_build_object('ok', false, 'error', 'This email already belongs to an admin.'); end if;
  if (v_lookup ->> 'site_account')::boolean then
    return jsonb_build_object('ok', false, 'error', 'This email now has a customer, Tasker or coordinator account. Use a separate email for admin work.');
  end if;
  return jsonb_build_object('ok', true, 'email', v_email, 'name', q.payload ->> 'name', 'roles', q.payload -> 'roles',
                            'login_exists', (v_lookup ->> 'exists')::boolean, 'login_id', v_lookup -> 'user_id');
end $$;

-- ---------- finish (uses the approval, makes the admin; the Edge Function calls it as the caller AFTER the login exists) ----------

create or replace function public.admin_invite_finish(p_approval uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  q public.admin_approval_requests;
  v_email text;
  v_roles text[];
  v_name text;
  v_auth_email text;
  v_support text := 'unchanged';
  v_msg text := null;
begin
  if not public.admin_guard('admin.team.manage', 'admin.invite.finish') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to change the admin team.');
  end if;
  select * into q from public.admin_approval_requests r where r.id = p_approval;
  if not found or q.action <> 'admin.team.invite' then
    return jsonb_build_object('ok', false, 'error', 'That approval is not for an admin invite.');
  end if;
  if q.requested_by <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'Only the person who asked for the invite can send it.');
  end if;

  begin
    v_email := lower(btrim(coalesce(q.payload ->> 'email', '')));
    if p_user is null or p_user = v_uid then raise exception 'That is not the invited login.' using errcode = 'P0001'; end if;
    select lower(a.email) into v_auth_email from auth.users a where a.id = p_user;
    if v_auth_email is null or v_auth_email is distinct from v_email then
      raise exception 'The login does not match the approved email.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.admin_users u where u.user_id = p_user) then
      raise exception 'This login is already an admin.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.users x where x.id = p_user) or exists (select 1 from public.coordinators c where c.user_id = p_user) then
      raise exception 'This login has a customer, Tasker or coordinator account. Use a separate email for admin work.' using errcode = 'P0001';
    end if;

    -- Re-checks approved, not expired, same action and target, unchanged email, approver still allowed, requester is the caller. Marks it used.
    perform public.admin_consume_approval(p_approval, 'admin.team.invite', 'admin_invite', q.target_id, q.payload,
                                          public.admin_invite_target_version(v_email), jsonb_build_object('change', 'invite'));

    select coalesce(array_agg(x order by x), '{}') into v_roles from jsonb_array_elements_text(q.payload -> 'roles') x;
    if cardinality(v_roles) = 0 then raise exception 'The approved invite has no roles.' using errcode = 'P0001'; end if;
    if exists (select 1 from unnest(v_roles) x where not exists (select 1 from public.admin_roles r where r.key = x)) then
      raise exception 'One of the roles no longer exists.' using errcode = 'P0001';
    end if;
    v_name := coalesce(nullif(btrim(q.payload ->> 'name'), ''), initcap(split_part(v_email, '@', 1)));

    insert into public.admin_users (user_id, display_name, status, created_by) values (p_user, v_name, 'active', v_uid);
    insert into public.admin_user_roles (user_id, role_key, granted_by) select p_user, x, v_uid from unnest(v_roles) x;
    if 'super_admin' = any (v_roles) then
      insert into public.support_staff (user_id, note, added_at) values (p_user, 'admin invited (A5e)', now()) on conflict (user_id) do nothing;
      v_support := 'added';
    end if;
    perform public.admin_log('admin.team.invited', 'admin_user', p_user::text, null,
                             jsonb_build_object('status', 'active', 'roles', to_jsonb(v_roles)), q.reason, p_approval, 'ok',
                             jsonb_build_object('email', v_email, 'support_staff', v_support));
  exception when others then
    v_msg := sqlerrm;
  end;

  if v_msg is not null then
    perform public.admin_log('admin.invite.finish', 'admin_invite', q.target_id, null, null, null, p_approval, 'refused', jsonb_build_object('error', v_msg));
    return jsonb_build_object('ok', false, 'error', v_msg);
  end if;
  return jsonb_build_object('ok', true, 'user_id', p_user);
end $$;

-- ---------- my invites (for the Team page) ------------------------------------

create or replace function public.admin_invites_mine()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rows jsonb;
begin
  if not public.admin_has('admin.team.manage') then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'status', q.status, 'email', q.payload ->> 'email', 'name', q.payload ->> 'name', 'roles', q.payload -> 'roles',
           'reason', q.reason, 'requested_at', q.requested_at, 'expires_at', q.expires_at,
           'seconds_left', greatest(0, floor(extract(epoch from (q.expires_at - now()))))::bigint)
         order by q.requested_at desc), '[]'::jsonb)
    into v_rows
    from public.admin_approval_requests q
   where q.requested_by = v_uid and q.action = 'admin.team.invite' and q.status in ('pending', 'approved') and q.expires_at > now();
  return jsonb_build_object('rows', v_rows);
end $$;

-- ---------- who may run what ---------------------------------------------------

revoke all on function public.admin_invite_target_version(text)            from public, anon, authenticated;
revoke all on function public.admin_invite_auth_lookup(text)               from public, anon, authenticated;
revoke all on function public.admin_invite_request(text, text[], text, text) from public, anon, authenticated;
revoke all on function public.admin_invite_precheck(uuid)                  from public, anon, authenticated;
revoke all on function public.admin_invite_finish(uuid, uuid)              from public, anon, authenticated;
revoke all on function public.admin_invites_mine()                         from public, anon, authenticated;
grant execute on function public.admin_invite_request(text, text[], text, text) to authenticated;
grant execute on function public.admin_invite_precheck(uuid)               to authenticated;
grant execute on function public.admin_invite_finish(uuid, uuid)           to authenticated;
grant execute on function public.admin_invites_mine()                      to authenticated;
-- the lookup is for the Edge Function only (it uses the service role); the target-version helper is for server code only.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.admin_invite_auth_lookup(text) to service_role;
  end if;
end $$;

select case
  when to_regprocedure('public.admin_invite_request(text,text[],text,text)') is not null
   and to_regprocedure('public.admin_invite_precheck(uuid)') is not null
   and to_regprocedure('public.admin_invite_finish(uuid,uuid)') is not null
   and to_regprocedure('public.admin_invites_mine()') is not null
   and to_regprocedure('public.admin_invite_auth_lookup(text)') is not null
   and exists (select 1 from public.admin_sensitive_actions where action = 'admin.team.invite')
  then 'DONE: A5e installed. Next: deploy the admin-invite function (see handoffs/A5e.md).'
  else 'NOT DONE: see the messages above.'
end as a5e_result;

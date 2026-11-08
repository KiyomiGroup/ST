-- StreetTasker Admin Control Centre, stage A1: TESTS.
-- Run a1-admin-core.sql first. Run THIS file once, whole, in the Supabase SQL editor.
-- It changes nothing that lasts: everything it writes is undone inside the file itself.
-- It borrows four existing user ids from public.users only to stand in for admins (nothing is sent,
-- nobody is notified, no login is created). The last line of output is the result:
--   RESULT: ALL PASS (n checks)   or   RESULT: FAIL (n failed of m)
-- Run it BEFORE the bootstrap, if you can: check 10 (last Super Admin) needs an empty admin team and
-- says SKIPPED otherwise.

create temp table if not exists a1_results (n serial, line text);
truncate a1_results;

do $a1$
declare
  v_res text := ''; v_n int := 0; v_fail int := 0;
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; v_none uuid := gen_random_uuid();
  v_fresh boolean; v_cnt1 int; v_cnt2 int; v_txt text; v_json jsonb; v_b boolean; v_perm_total int;
begin
  begin
    select (array_agg(id order by created_at nulls last, id))[1], (array_agg(id order by created_at nulls last, id))[2],
           (array_agg(id order by created_at nulls last, id))[3], (array_agg(id order by created_at nulls last, id))[4]
      into u1, u2, u3, u4 from public.users where id not in (select user_id from public.admin_users);
    if u4 is null then raise exception 'NEED_4_USERS'; end if;
    v_fresh := not exists (select 1 from public.admin_users);
    select count(*) into v_perm_total from public.admin_permissions;

    -- stand-in admins (rolled back at the end)
    insert into public.admin_users (user_id, display_name, status) values (u1, 'T operations', 'active'), (u2, 'T support suspended', 'suspended'), (u3, 'T super', 'active');
    insert into public.admin_user_roles (user_id, role_key) values (u1, 'operations'), (u2, 'support'), (u3, 'super_admin');

    -- 1 a person who is not an admin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_none::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', v_none::text, true);
    v_n := v_n + 1; if public.admin_has('customers.view') = false and (public.admin_my_access() ->> 'active') = 'false'
      then v_res := v_res || E'PASS 1 non-admin: no permission, access inactive\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1 non-admin\n'; end if;

    -- 2 nobody signed in
    perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
    v_n := v_n + 1; if public.admin_has('customers.view') = false and (public.admin_my_access() ->> 'active') = 'false'
      then v_res := v_res || E'PASS 2 no login: refused\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 2 no login\n'; end if;

    -- 3 inactive (suspended) admin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u2::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', u2::text, true);
    v_n := v_n + 1; if public.admin_has('disputes.view') = false and (public.admin_my_access() ->> 'active') = 'false'
      then v_res := v_res || E'PASS 3 suspended admin refused\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 3 suspended admin\n'; end if;

    -- 4 wrong permission (operations admin)
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u1::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', u1::text, true);
    v_n := v_n + 1; if public.admin_has('customers.view') and public.admin_has('approvals.view')
         and not public.admin_has('disputes.manage') and not public.admin_has('approvals.decide')
         and not public.admin_has('no.such.permission')
      then v_res := v_res || E'PASS 4 operations admin: own permissions yes, others no, unknown name no\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4 wrong permission\n'; end if;

    -- 5 super admin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u3::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', u3::text, true);
    v_json := public.admin_my_access();
    v_n := v_n + 1; if public.admin_has('approvals.decide') and public.admin_has('customers.suspend')
         and not public.admin_has('no.such.permission') and jsonb_array_length(v_json -> 'permissions') = v_perm_total
      then v_res := v_res || E'PASS 5 super admin: every real permission, no invented one\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 5 super admin\n'; end if;

    -- 6 admin_require raises 42501 for a missing permission, passes for a held one
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u1::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', u1::text, true);
    v_n := v_n + 1;
    begin perform public.admin_require('disputes.manage'); v_fail := v_fail + 1; v_res := v_res || E'FAIL 6 admin_require did not raise\n';
    exception when sqlstate '42501' then
      begin perform public.admin_require('customers.view'); v_res := v_res || E'PASS 6 admin_require: raises 42501 when missing, passes when held\n';
      exception when others then v_fail := v_fail + 1; v_res := v_res || E'FAIL 6 admin_require refused a held permission\n'; end;
    end;

    -- 7 admin_guard logs a refusal for an active admin, nothing for a stranger
    select count(*) into v_cnt1 from public.admin_audit_log;
    v_b := public.admin_guard('disputes.manage', 'test.guard');
    select count(*) into v_cnt2 from public.admin_audit_log;
    v_n := v_n + 1; if v_b = false and v_cnt2 = v_cnt1 + 1 and exists (select 1 from public.admin_audit_log where action = 'test.guard' and outcome = 'refused' and actor_id = u1)
      then v_res := v_res || E'PASS 7a admin_guard logs a refusal for an active admin\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 7a admin_guard refusal row\n'; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_none::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', v_none::text, true);
    select count(*) into v_cnt1 from public.admin_audit_log;
    v_b := public.admin_guard('disputes.manage', 'test.guard.stranger');
    select count(*) into v_cnt2 from public.admin_audit_log;
    v_n := v_n + 1; if v_b = false and v_cnt2 = v_cnt1
      then v_res := v_res || E'PASS 7b admin_guard writes nothing for a non-admin\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 7b stranger wrote a row\n'; end if;

    -- 8 audit log cannot be updated, deleted or truncated (even by the owner role)
    v_n := v_n + 1;
    begin update public.admin_audit_log set reason = 'x'; v_fail := v_fail + 1; v_res := v_res || E'FAIL 8a update allowed\n';
    exception when sqlstate 'P0001' then v_res := v_res || E'PASS 8a audit row cannot be updated\n'; end;
    v_n := v_n + 1;
    begin delete from public.admin_audit_log; v_fail := v_fail + 1; v_res := v_res || E'FAIL 8b delete allowed\n';
    exception when sqlstate 'P0001' then v_res := v_res || E'PASS 8b audit row cannot be deleted\n'; end;
    v_n := v_n + 1;
    begin truncate public.admin_audit_log; v_fail := v_fail + 1; v_res := v_res || E'FAIL 8c truncate allowed\n';
    exception when sqlstate 'P0001' then v_res := v_res || E'PASS 8c audit log cannot be truncated\n'; end;

    -- 9 admin_log records the actor and the roles
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u3::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', u3::text, true);
    perform public.admin_log('test.log', 'thing', '42', '{"a":1}'::jsonb, '{"a":2}'::jsonb, 'because', null, 'ok', null);
    v_n := v_n + 1; if exists (select 1 from public.admin_audit_log where action = 'test.log' and actor_id = u3 and actor_roles = array['super_admin'] and old_value = '{"a":1}'::jsonb)
      then v_res := v_res || E'PASS 9 admin_log writes actor, roles and values\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 9 admin_log row\n'; end if;

    -- 10 the last active Super Admin cannot be removed, suspended or demoted
    if v_fresh then
      v_n := v_n + 1;
      begin delete from public.admin_user_roles where user_id = u3 and role_key = 'super_admin'; v_fail := v_fail + 1; v_res := v_res || E'FAIL 10a last super demoted\n';
      exception when sqlstate 'P0001' then v_res := v_res || E'PASS 10a last Super Admin cannot be demoted\n'; end;
      v_n := v_n + 1;
      begin update public.admin_users set status = 'suspended' where user_id = u3; v_fail := v_fail + 1; v_res := v_res || E'FAIL 10b last super suspended\n';
      exception when sqlstate 'P0001' then v_res := v_res || E'PASS 10b last Super Admin cannot be suspended\n'; end;
      v_n := v_n + 1;
      begin update public.admin_users set removed_at = now() where user_id = u3; v_fail := v_fail + 1; v_res := v_res || E'FAIL 10c last super removed\n';
      exception when sqlstate 'P0001' then v_res := v_res || E'PASS 10c last Super Admin cannot be removed\n'; end;
      insert into public.admin_user_roles (user_id, role_key) values (u1, 'super_admin');
      v_n := v_n + 1;
      begin delete from public.admin_user_roles where user_id = u3 and role_key = 'super_admin'; v_res := v_res || E'PASS 10d with a second Super Admin, one may be demoted\n';
      exception when others then v_fail := v_fail + 1; v_res := v_res || E'FAIL 10d demotion refused although another Super Admin exists\n'; end;
      v_n := v_n + 1;
      begin delete from public.admin_user_roles where user_id = u1 and role_key = 'super_admin'; v_fail := v_fail + 1; v_res := v_res || E'FAIL 10e new last super demoted\n';
      exception when sqlstate 'P0001' then v_res := v_res || E'PASS 10e the remaining Super Admin is protected\n'; end;
    else
      v_res := v_res || E'SKIPPED 10 last Super Admin (the admin team is not empty; run this file before the bootstrap)\n';
    end if;

    -- 11 browser roles have no table or function access except admin_has and admin_my_access
    set local role authenticated;
    v_n := v_n + 1;
    begin perform 1 from public.admin_audit_log limit 1; reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 11a authenticated read the audit log\n';
    exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 11a authenticated cannot read the audit log\n'; end;
    set local role authenticated;
    v_n := v_n + 1;
    begin perform 1 from public.admin_users limit 1; reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 11b authenticated read admin_users\n';
    exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 11b authenticated cannot read admin_users\n'; end;
    set local role authenticated;
    v_n := v_n + 1;
    begin perform public.admin_log('x'); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 11c authenticated called admin_log\n';
    exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 11c authenticated cannot call admin_log\n'; end;
    set local role authenticated;
    v_n := v_n + 1;
    begin perform public.admin_guard('customers.view'); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 11d authenticated called admin_guard\n';
    exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 11d authenticated cannot call admin_guard\n'; end;
    set local role authenticated;
    v_n := v_n + 1;
    begin perform public.admin_bootstrap_super_admin('someone@example.invalid'); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 11e authenticated called the bootstrap\n';
    exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 11e authenticated cannot call the bootstrap\n'; end;
    set local role authenticated;
    v_n := v_n + 1;
    begin perform public.admin_has('customers.view'); perform public.admin_my_access(); reset role; v_res := v_res || E'PASS 11f authenticated can call admin_has and admin_my_access\n';
    exception when others then reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 11f authenticated cannot call admin_has\n'; end;
    set local role anon;
    v_n := v_n + 1;
    begin perform public.admin_has('customers.view'); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 11g anon called admin_has\n';
    exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 11g anon cannot call admin_has\n'; end;

    -- 12 bootstrap: unknown email, then a real login twice (idempotent)
    v_txt := public.admin_bootstrap_super_admin('nobody-a1-test@example.invalid');
    v_n := v_n + 1; if v_txt like 'NOT DONE: no login%' then v_res := v_res || E'PASS 12a bootstrap refuses an email with no login\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 12a bootstrap unknown email\n'; end if;
    select email into v_txt from auth.users where id = u4;
    if v_txt is null then
      v_res := v_res || E'SKIPPED 12b bootstrap success (the stand-in user has no email)\n';
    else
      v_txt := public.admin_bootstrap_super_admin(v_txt, 'Test');
      v_n := v_n + 1; if v_txt like 'DONE:%' and exists (select 1 from public.admin_user_roles where user_id = u4 and role_key = 'super_admin')
         and exists (select 1 from public.support_staff where user_id = u4)
        then v_res := v_res || E'PASS 12b bootstrap makes a Super Admin and a support staff member\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 12b bootstrap result: ' || coalesce(v_txt, 'null') || E'\n'; end if;
      select email into v_txt from auth.users where id = u4;
      v_txt := public.admin_bootstrap_super_admin(v_txt, 'Test');
      v_n := v_n + 1; if v_txt like 'DONE:%' and (select count(*) from public.admin_user_roles where user_id = u4 and role_key = 'super_admin') = 1
        then v_res := v_res || E'PASS 12c bootstrap is safe to run twice\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 12c bootstrap twice\n'; end if;
    end if;

    -- 12d a coordinator login: refused unless the owner says true
    select c.user_id into u2 from public.coordinators c limit 1;
    if u2 is null then
      v_res := v_res || E'SKIPPED 12d coordinator login (no coordinator exists)\n';
    else
      v_txt := public.admin_bootstrap_super_admin((select email from auth.users where id = u2), 'T', false);
      v_n := v_n + 1; if v_txt like 'NOT DONE: this login is a coordinator account%' and not exists (select 1 from public.admin_user_roles where user_id = u2 and role_key = 'super_admin')
        then v_res := v_res || E'PASS 12d a coordinator login is refused by default\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 12d coordinator not refused\n'; end if;
      v_txt := public.admin_bootstrap_super_admin((select email from auth.users where id = u2), 'T', true);
      v_n := v_n + 1; if v_txt like 'DONE:%' and v_txt like '%also a coordinator%' and exists (select 1 from public.admin_user_roles where user_id = u2 and role_key = 'super_admin')
        then v_res := v_res || E'PASS 12e a coordinator login is accepted with true, with a warning\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 12e coordinator with true: ' || coalesce(v_txt,'null') || E'\n'; end if;
    end if;

    -- 13 two-step verification switch
    update public.admin_settings set text_value = 'on' where key = 'require_mfa';
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u4::text, 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', u4::text, true);
    v_n := v_n + 1; if public.admin_has('customers.view') = false and (public.admin_my_access() ->> 'mfa_ok') = 'false' and jsonb_array_length(public.admin_my_access() -> 'permissions') = 0
      then v_res := v_res || E'PASS 13a with two-step required, a one-step session is refused\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 13a mfa refusal\n'; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u4::text, 'aal', 'aal2')::text, true);
    v_n := v_n + 1; if public.admin_has('customers.view') and (public.admin_my_access() ->> 'mfa_ok') = 'true'
      then v_res := v_res || E'PASS 13b with two-step required, a two-step session passes\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 13b mfa pass\n'; end if;

    -- 14 seed sanity
    v_n := v_n + 1; if (select count(*) from public.admin_roles) = 6 and not exists (select 1 from public.admin_role_permissions where role_key = 'super_admin')
         and (select count(*) from public.admin_permissions) > 50 and (select text_value from public.admin_settings where key = 'require_mfa') is not null
      then v_res := v_res || E'PASS 14 seed: 6 roles, permissions present, super_admin not listed (implicit)\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 14 seed\n'; end if;

    raise exception 'a1 rollback' using errcode = 'P9999';   -- undoes every row written above
  exception when others then
    reset role;
    if sqlstate <> 'P9999' then v_fail := v_fail + 1; v_res := v_res || 'ERROR: ' || sqlerrm || E'\n'; end if;
  end;

  insert into a1_results (line)
    select l from regexp_split_to_table(v_res, E'\n') l where l <> '';
  insert into a1_results (line)
    values (case when v_fail = 0 and v_n > 0 then 'RESULT: ALL PASS (' || v_n || ' checks)'
                 else 'RESULT: FAIL (' || v_fail || ' failed of ' || v_n || ')' end);
end
$a1$;

select line from a1_results order by n;

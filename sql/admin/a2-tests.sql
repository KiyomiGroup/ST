-- StreetTasker Admin Control Centre, stage A2: TESTS.
-- Run a1-admin-core.sql and a2-approvals.sql first. Run THIS file once, whole, in the Supabase SQL editor.
-- It changes nothing that lasts: everything it writes is undone inside the file itself.
-- It borrows three existing user ids from public.users only as stand-in admins (nothing is sent, no login is created).
-- The last line is the result:  RESULT: ALL PASS (n checks)   or   RESULT: FAIL (n failed of m)

create temp table if not exists a2_results (n serial, line text);
truncate a2_results;

create or replace function pg_temp.a2_as(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', case when p is null then '' else jsonb_build_object('sub', p::text, 'aal', 'aal1')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
end $f$;

do $a2$
declare
  v_res text := ''; v_n int := 0; v_fail int := 0;
  u1 uuid; u2 uuid; u3 uuid; v_none uuid := gen_random_uuid();
  v_r jsonb; v_id uuid; v_id2 uuid; v_cnt int; v_b boolean;
  v_pl jsonb := '{"price": 5000, "plan": "pro"}'::jsonb;
begin
  begin
    select (array_agg(id order by created_at nulls last, id))[1], (array_agg(id order by created_at nulls last, id))[2],
           (array_agg(id order by created_at nulls last, id))[3] into u1, u2, u3 from public.users
      where id not in (select user_id from public.admin_users);
    if u3 is null then raise exception 'NEED_3_USERS'; end if;
    insert into public.admin_users (user_id, display_name, status) values (u1, 'T requester', 'active'), (u2, 'T operations', 'active'), (u3, 'T decider', 'active');
    insert into public.admin_user_roles (user_id, role_key) values (u1, 'super_admin'), (u2, 'operations'), (u3, 'super_admin');
    insert into public.admin_sensitive_actions (action, permission_required, risk, expires_hours, check_target_version) values
      ('test.a2.action', 'settings.manage', 'high', 72, true), ('test.a2.noversion', 'settings.manage', 'medium', 72, false), ('test.a2.instant', 'settings.manage', 'high', 0, true);
    -- 1 who may request
    perform pg_temp.a2_as(v_none); v_r := public.admin_request_approval('test.a2.action','thing','42',v_pl,'a good enough reason','{"old":1}'::jsonb,'v1');
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 1a a stranger cannot request\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1a a stranger cannot request\n'; end if;
    perform pg_temp.a2_as(u2); v_r := public.admin_request_approval('test.a2.action','thing','42',v_pl,'a good enough reason','{"old":1}'::jsonb,'v1');
    v_n := v_n + 1; if (v_r->>'ok')='false' and exists (select 1 from public.admin_audit_log where action='approval.request' and outcome='refused' and actor_id=u2) then v_res := v_res || E'PASS 1b an admin without the permission cannot request, and the refusal is logged\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1b an admin without the permission cannot request, and the refusal is logged\n'; end if;
    perform pg_temp.a2_as(u1);
    v_r := public.admin_request_approval('no.such.action','thing','42',v_pl,'a good enough reason',null,'v1');
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 1c an unknown action is refused\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1c an unknown action is refused\n'; end if;
    v_r := public.admin_request_approval('test.a2.action','thing','42',v_pl,'short',null,'v1');
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 1d a short reason is refused\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1d a short reason is refused\n'; end if;
    v_r := public.admin_request_approval('test.a2.action','thing','42',v_pl,'a good enough reason',null,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 1e a missing target version is refused when the action needs it\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1e a missing target version is refused when the action needs it\n'; end if;
    v_r := public.admin_request_approval('test.a2.action','thing','42','[]'::jsonb,'a good enough reason',null,'v1');
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 1f a payload that is not an object is refused\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1f a payload that is not an object is refused\n'; end if;
    v_r := public.admin_request_approval('test.a2.action','thing','42',v_pl,'a good enough reason','{"old":1}'::jsonb,'v1'); v_id := (v_r->>'id')::uuid;
    v_n := v_n + 1; if (v_r->>'ok')='true' and exists (select 1 from public.admin_approval_requests where id=v_id and status='pending' and requested_by=u1 and payload_hash=public.admin_approval_hash('test.a2.action','thing','42',v_pl) and expires_at=requested_at+interval '72 hours') then v_res := v_res || E'PASS 1g a valid request is stored as pending with the right fingerprint and 72 hours\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 1g a valid request is stored as pending with the right fingerprint and 72 hours\n'; end if;
    v_r := public.admin_request_approval('test.a2.action','thing','42',v_pl,'a good enough reason','{"old":1}'::jsonb,'v1');
    v_n := v_n + 1; if (v_r->>'ok')='false' and (v_r->>'id')::uuid=v_id then v_res := v_res || E'PASS 2 the same request cannot be made twice while it waits\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 2 the same request cannot be made twice while it waits\n'; end if;
    -- 3 who may decide
    v_r := public.admin_decide_approval(v_id,true,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' and exists (select 1 from public.admin_audit_log where action='approval.decide' and outcome='refused' and actor_id=u1) then v_res := v_res || E'PASS 3a the requester cannot decide their own request (refusal logged)\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 3a the requester cannot decide their own request (refusal logged)\n'; end if;
    perform pg_temp.a2_as(u2); v_r := public.admin_decide_approval(v_id,true,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 3b an admin without approvals.decide cannot decide\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 3b an admin without approvals.decide cannot decide\n'; end if;
    perform pg_temp.a2_as(v_none); v_r := public.admin_decide_approval(v_id,true,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 3c a stranger cannot decide\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 3c a stranger cannot decide\n'; end if;
    perform pg_temp.a2_as(u3); v_r := public.admin_decide_approval(v_id,false,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' and exists (select 1 from public.admin_approval_requests where id=v_id and status='pending') then v_res := v_res || E'PASS 3d rejecting needs a reason\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 3d rejecting needs a reason\n'; end if;
    v_r := public.admin_decide_approval(v_id,true,'looks right');
    v_n := v_n + 1; if (v_r->>'ok')='true' and exists (select 1 from public.admin_approval_requests where id=v_id and status='approved' and decided_by=u3) then v_res := v_res || E'PASS 3e another Super Admin can approve\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 3e another Super Admin can approve\n'; end if;
    v_r := public.admin_decide_approval(v_id,true,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' then v_res := v_res || E'PASS 3f a decided request cannot be decided again\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 3f a decided request cannot be decided again\n'; end if;
    -- 4 consume: refusals first, then the one correct use
    perform pg_temp.a2_as(u1);
    v_n := v_n + 1; begin perform public.admin_consume_approval(null,'test.a2.action','thing','42',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4a no approval id (no error)\n'; exception when others then if sqlerrm like '%approval is required%' then v_res := v_res || E'PASS 4a no approval id\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4a no approval id: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin perform public.admin_consume_approval(gen_random_uuid(),'test.a2.action','thing','42',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4b an id that does not exist (no error)\n'; exception when others then if sqlerrm like '%does not exist%' then v_res := v_res || E'PASS 4b an id that does not exist\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4b an id that does not exist: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.noversion','thing','42',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4c a different action (no error)\n'; exception when others then if sqlerrm like '%different action%' then v_res := v_res || E'PASS 4c a different action\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4c a different action: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','43',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4d a different target id (no error)\n'; exception when others then if sqlerrm like '%different target%' then v_res := v_res || E'PASS 4d a different target id\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4d a different target id: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','other','42',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4e a different target type (no error)\n'; exception when others then if sqlerrm like '%different target%' then v_res := v_res || E'PASS 4e a different target type\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4e a different target type: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','42','{"price": 9999, "plan": "pro"}'::jsonb,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4f a changed payload (no error)\n'; exception when others then if sqlerrm like '%not the one that was approved%' then v_res := v_res || E'PASS 4f a changed payload\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4f a changed payload: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','42',v_pl,'v2','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4g the target changed since the request (no error)\n'; exception when others then if sqlerrm like '%target changed%' then v_res := v_res || E'PASS 4g the target changed since the request\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4g the target changed since the request: ' || sqlerrm || E'\n'; end if; end;
    perform pg_temp.a2_as(u3);
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','42',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4h someone other than the requester cannot run it (no error)\n'; exception when others then if sqlerrm like '%Only the person who asked%' then v_res := v_res || E'PASS 4h someone other than the requester cannot run it\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4h someone other than the requester cannot run it: ' || sqlerrm || E'\n'; end if; end;
    perform pg_temp.a2_as(u1);
    perform public.admin_consume_approval(v_id,'test.a2.action','thing','42',v_pl,'v1','{"done":true}'::jsonb);
    v_n := v_n + 1; if exists (select 1 from public.admin_approval_requests where id=v_id and status='consumed' and consumed_by=u1 and execution_result->>'done'='true') and exists (select 1 from public.admin_audit_log where action='approval.consumed' and approval_id=v_id) then v_res := v_res || E'PASS 4i the correct use works and is recorded\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4i the correct use works and is recorded\n'; end if;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','42',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 4j an approval cannot be used twice (no error)\n'; exception when others then if sqlerrm like '%already been used%' then v_res := v_res || E'PASS 4j an approval cannot be used twice\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 4j an approval cannot be used twice: ' || sqlerrm || E'\n'; end if; end;
    -- 5 rejected, cancelled
    v_r := public.admin_request_approval('test.a2.action','thing','50',v_pl,'a good enough reason',null,'v1'); v_id := (v_r->>'id')::uuid;
    perform pg_temp.a2_as(u3); v_r := public.admin_decide_approval(v_id,false,'not now'); perform pg_temp.a2_as(u1);
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','50',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 5a a rejected approval cannot be used (no error)\n'; exception when others then if sqlerrm like '%was rejected%' then v_res := v_res || E'PASS 5a a rejected approval cannot be used\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 5a a rejected approval cannot be used: ' || sqlerrm || E'\n'; end if; end;
    v_r := public.admin_request_approval('test.a2.action','thing','51',v_pl,'a good enough reason',null,'v1'); v_id := (v_r->>'id')::uuid;
    perform pg_temp.a2_as(u2); v_r := public.admin_cancel_approval(v_id,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' and exists (select 1 from public.admin_audit_log where action='approval.cancel' and outcome='refused' and actor_id=u2) then v_res := v_res || E'PASS 5b a stranger to the request (no approvals.decide) cannot cancel it\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 5b a stranger to the request (no approvals.decide) cannot cancel it\n'; end if;
    perform pg_temp.a2_as(u1); v_r := public.admin_cancel_approval(v_id,'changed my mind');
    v_n := v_n + 1; if (v_r->>'ok')='true' and exists (select 1 from public.admin_approval_requests where id=v_id and status='cancelled') then v_res := v_res || E'PASS 5c the requester can cancel\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 5c the requester can cancel\n'; end if;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','51',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 5d a cancelled approval cannot be used (no error)\n'; exception when others then if sqlerrm like '%was cancelled%' then v_res := v_res || E'PASS 5d a cancelled approval cannot be used\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 5d a cancelled approval cannot be used: ' || sqlerrm || E'\n'; end if; end;
    v_r := public.admin_request_approval('test.a2.action','thing','52',v_pl,'a good enough reason',null,'v1'); v_id := (v_r->>'id')::uuid;
    perform pg_temp.a2_as(u3); v_r := public.admin_cancel_approval(v_id,null);
    v_n := v_n + 1; if (v_r->>'ok')='true' then v_res := v_res || E'PASS 5e a Super Admin can cancel another person request\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 5e a Super Admin can cancel another person request\n'; end if;
    -- 6 expiry
    perform pg_temp.a2_as(u1); v_r := public.admin_request_approval('test.a2.instant','thing','60',v_pl,'a good enough reason',null,'v1'); v_id := (v_r->>'id')::uuid;
    perform pg_temp.a2_as(u3); v_r := public.admin_decide_approval(v_id,true,null);
    v_n := v_n + 1; if (v_r->>'ok')='false' and exists (select 1 from public.admin_approval_requests where id=v_id and status='expired') then v_res := v_res || E'PASS 6a deciding an expired request marks it expired\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 6a deciding an expired request marks it expired\n'; end if;
    insert into public.admin_approval_requests (action,target_type,target_id,payload,payload_hash,target_version,reason,risk,status,requested_by,expires_at,decided_by,decided_at) values ('test.a2.action','thing','61',v_pl,public.admin_approval_hash('test.a2.action','thing','61',v_pl),'v1','a good enough reason','high','approved',u1,now()-interval '1 hour',u3,now()) returning id into v_id2;
    perform pg_temp.a2_as(u1);
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id2,'test.a2.action','thing','61',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 6b an approved but out-of-date approval cannot be used (no error)\n'; exception when others then if sqlerrm like '%expired%' then v_res := v_res || E'PASS 6b an approved but out-of-date approval cannot be used\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 6b an approved but out-of-date approval cannot be used: ' || sqlerrm || E'\n'; end if; end;
    v_cnt := public.admin_expire_approvals();
    v_n := v_n + 1; if v_cnt >= 1 and exists (select 1 from public.admin_approval_requests where id=v_id2 and status='expired') then v_res := v_res || E'PASS 6c admin_expire_approvals marks old waiting requests expired\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 6c admin_expire_approvals marks old waiting requests expired\n'; end if;
    -- 7 the approver, the self-approved row, no-version actions
    v_r := public.admin_request_approval('test.a2.action','thing','70',v_pl,'a good enough reason',null,'v1'); v_id := (v_r->>'id')::uuid;
    perform pg_temp.a2_as(u3); v_r := public.admin_decide_approval(v_id,true,null);
    delete from public.admin_user_roles where user_id=u3 and role_key='super_admin'; insert into public.admin_user_roles (user_id, role_key) values (u3, 'support'); perform pg_temp.a2_as(u1);
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id,'test.a2.action','thing','70',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 7a an approver who lost the right cannot have their approval used (no error)\n'; exception when others then if sqlerrm like '%approver no longer%' then v_res := v_res || E'PASS 7a an approver who lost the right cannot have their approval used\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 7a an approver who lost the right cannot have their approval used: ' || sqlerrm || E'\n'; end if; end;
    insert into public.admin_user_roles (user_id, role_key) values (u3, 'super_admin');
    insert into public.admin_approval_requests (action,target_type,target_id,payload,payload_hash,target_version,reason,risk,status,requested_by,expires_at,decided_by,decided_at) values ('test.a2.action','thing','71',v_pl,public.admin_approval_hash('test.a2.action','thing','71',v_pl),'v1','a good enough reason','high','approved',u1,now()+interval '1 day',u1,now()) returning id into v_id2;
    v_n := v_n + 1; begin perform public.admin_consume_approval(v_id2,'test.a2.action','thing','71',v_pl,'v1','{"done":true}'::jsonb); v_fail := v_fail + 1; v_res := v_res || E'FAIL 7b a self-approved row is refused even if one exists (no error)\n'; exception when others then if sqlerrm like '%person who made it%' then v_res := v_res || E'PASS 7b a self-approved row is refused even if one exists\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 7b a self-approved row is refused even if one exists: ' || sqlerrm || E'\n'; end if; end;
    v_r := public.admin_request_approval('test.a2.noversion','thing','72',v_pl,'a good enough reason',null,null); v_id := (v_r->>'id')::uuid;
    perform pg_temp.a2_as(u3); v_r := public.admin_decide_approval(v_id,true,null); perform pg_temp.a2_as(u1);
    perform public.admin_consume_approval(v_id,'test.a2.noversion','thing','72',v_pl,null,null);
    v_n := v_n + 1; if exists (select 1 from public.admin_approval_requests where id=v_id and status='consumed') then v_res := v_res || E'PASS 7c an action that does not track versions can be used with none\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 7c an action that does not track versions can be used with none\n'; end if;
    v_b := public.admin_user_has(u3,'approvals.decide') and not public.admin_user_has(u2,'approvals.decide') and not public.admin_user_has(null,'approvals.decide') and not public.admin_user_has(u3,'no.such.permission');
    v_n := v_n + 1; if v_b then v_res := v_res || E'PASS 7d admin_user_has answers per user\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 7d admin_user_has answers per user\n'; end if;
    -- 8 a request can never be edited, deleted or moved backwards
    v_n := v_n + 1; begin update public.admin_approval_requests set payload='{"price":1}'::jsonb where id=v_id; v_fail := v_fail + 1; v_res := v_res || E'FAIL 8a payload cannot be edited (no error)\n'; exception when others then if sqlerrm like '%cannot be edited%' then v_res := v_res || E'PASS 8a payload cannot be edited\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 8a payload cannot be edited: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin delete from public.admin_approval_requests where id=v_id; v_fail := v_fail + 1; v_res := v_res || E'FAIL 8b a request cannot be deleted (no error)\n'; exception when others then if sqlerrm like '%cannot be deleted%' then v_res := v_res || E'PASS 8b a request cannot be deleted\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 8b a request cannot be deleted: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin update public.admin_approval_requests set status='pending' where id=v_id; v_fail := v_fail + 1; v_res := v_res || E'FAIL 8c a consumed request cannot go back to pending (no error)\n'; exception when others then if sqlerrm like '%cannot go from consumed%' then v_res := v_res || E'PASS 8c a consumed request cannot go back to pending\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 8c a consumed request cannot go back to pending: ' || sqlerrm || E'\n'; end if; end;
    v_n := v_n + 1; begin update public.admin_approval_requests set status='rejected' where id=v_id2; v_fail := v_fail + 1; v_res := v_res || E'FAIL 8d approved cannot become rejected (no error)\n'; exception when others then if sqlerrm like '%cannot go from approved%' then v_res := v_res || E'PASS 8d approved cannot become rejected\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 8d approved cannot become rejected: ' || sqlerrm || E'\n'; end if; end;
    -- 9 browser roles
    perform pg_temp.a2_as(null);
    set local role authenticated;
    v_n := v_n + 1; begin v_r := public.admin_request_approval('test.a2.action','thing','80',v_pl,'a good enough reason',null,'v1'); v_r := public.admin_decide_approval(gen_random_uuid(),true,null); v_r := public.admin_cancel_approval(gen_random_uuid(),null); reset role; v_res := v_res || E'PASS 9a authenticated can call request, decide and cancel (answers are refusals, not errors)\n'; exception when others then reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 9a ' || sqlerrm || E'\n'; end;
    set local role authenticated;
    v_n := v_n + 1; begin perform public.admin_consume_approval(null,'x','x','x','{}'::jsonb); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 9b authenticated cannot call admin_consume_approval\n'; exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 9b authenticated cannot call admin_consume_approval\n'; end;
    set local role authenticated;
    v_n := v_n + 1; begin perform public.admin_expire_approvals(); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 9c authenticated cannot call admin_expire_approvals\n'; exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 9c authenticated cannot call admin_expire_approvals\n'; end;
    set local role authenticated;
    v_n := v_n + 1; begin perform public.admin_user_has(null,'x'); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 9d authenticated cannot call admin_user_has\n'; exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 9d authenticated cannot call admin_user_has\n'; end;
    set local role authenticated;
    v_n := v_n + 1; begin perform 1 from public.admin_approval_requests limit 1; reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 9e authenticated cannot read approval requests\n'; exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 9e authenticated cannot read approval requests\n'; end;
    set local role authenticated;
    v_n := v_n + 1; begin perform 1 from public.admin_sensitive_actions limit 1; reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 9f authenticated cannot read the registry\n'; exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 9f authenticated cannot read the registry\n'; end;
    set local role anon;
    v_n := v_n + 1; begin v_r := public.admin_request_approval('x','x','x','{}'::jsonb,'xxxxxxxxxx'); reset role; v_fail := v_fail + 1; v_res := v_res || E'FAIL 9g anon called request\n'; exception when insufficient_privilege then reset role; v_res := v_res || E'PASS 9g anon cannot call request\n'; end;
    -- 10 seed
    v_n := v_n + 1; if (select count(*) from public.admin_sensitive_actions where action not like 'test.%') >= 13 and not exists (select 1 from public.admin_sensitive_actions a left join public.admin_permissions p on p.key=a.permission_required where p.key is null) then v_res := v_res || E'PASS 10 the registry holds the proposed launch list and every permission it names exists\n'; else v_fail := v_fail + 1; v_res := v_res || E'FAIL 10 the registry holds the proposed launch list and every permission it names exists\n'; end if;
    raise exception 'a2 rollback' using errcode = 'P9999';
  exception when others then
    reset role;
    if sqlstate <> 'P9999' then v_fail := v_fail + 1; v_res := v_res || 'ERROR: ' || sqlerrm || E'\n'; end if;
  end;
  insert into a2_results (line) select l from regexp_split_to_table(v_res, E'\n') l where l <> '';
  insert into a2_results (line)
    values (case when v_fail = 0 and v_n > 0 then 'RESULT: ALL PASS (' || v_n || ' checks)' else 'RESULT: FAIL (' || v_fail || ' failed of ' || v_n || ')' end);
end
$a2$;

select line from a2_results order by n;

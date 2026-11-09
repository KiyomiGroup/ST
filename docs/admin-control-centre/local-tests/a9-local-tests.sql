-- LOCAL ONLY: run after standin.sql, a9-standin.sql, a1-admin-core.sql, f6-admin-reassign.sql, a9-coordinators.sql on a scratch Postgres.
create temp table r (n serial, ok boolean, line text);
create function pg_temp.as_(p uuid, aal text default 'aal1') returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', case when p is null then '' else jsonb_build_object('sub', p::text, 'aal', aal)::text end, false);
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $f$;
create function pg_temp.chk(c boolean, t text) returns void language plpgsql as $f$ begin insert into r(ok,line) values (coalesce(c,false), t); end $f$;
do $t$
declare sa uuid := gen_random_uuid(); ops uuid := gen_random_uuid(); ver uuid := gen_random_uuid(); sup uuid := gen_random_uuid(); legacy uuid := gen_random_uuid(); nobody uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); cpend uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid(); notlt uuid := gen_random_uuid();
  app1 uuid := gen_random_uuid(); app2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  v jsonb; n int; txt text; ok boolean;
begin
  insert into auth.users(id,email) values (sa,'sa@x'),(ops,'ops@x'),(ver,'ver@x'),(sup,'sup@x'),(legacy,'l@x'),(nobody,'n@x'),(c1,'c1@x'),(c2,'c2@x'),(c3,'c3@x'),(cpend,'cp@x');
  insert into public.admin_users(user_id,display_name,status) values (sa,'Super','active'),(ops,'Ops','active'),(ver,'Verif','active'),(sup,'Support','active');
  insert into public.admin_user_roles(user_id,role_key) values (sa,'super_admin'),(ops,'operations'),(ver,'verification'),(sup,'support');
  insert into public.support_staff(user_id,note) values (legacy,'legacy');
  -- ops is ALSO a coordinator (Rule R-SELF)
  insert into public.coordinators(user_id,status,display_name) values (c1,'active','Coord One'),(c2,'active','Coord Two'),(c3,'deactivated','Coord Three'),(cpend,'pending','Pending'),(ops,'active','Ops as coordinator');
  insert into public.coordinator_tiers_state values (c1,1);
  insert into public.local_tasker_profiles values (t1,'Tasker One','published','Ikeja'),(t2,'Tasker Two','draft','Yaba'),(t3,'Tasker Three','draft','Surulere'),(t4,'Tasker Four','draft','Lekki');
  insert into public.coordinator_applications(id,full_name,email,phone,status,answers) values (app1,'Ada App','ada@x','0801','new','{"ref_phone":"0802"}'),(app2,'Bola App','bola@x','0803','new','{}');
  insert into public.coordinator_codes(code,expires_at,application_id) values ('APPCODE-1', now()+interval '3 days', app1);

  -- A. permission truth table for reads
  perform pg_temp.as_(null);   v := public.admin_coordinator_overview(); perform pg_temp.chk((v->>'ok')='false', 'A1 anonymous: overview refused');
  perform pg_temp.as_(nobody); v := public.admin_coordinator_overview(); perform pg_temp.chk((v->>'ok')='false', 'A2 stranger: overview refused');
  perform pg_temp.as_(legacy); v := public.admin_coordinator_overview(); perform pg_temp.chk((v->>'ok')='false', 'A3 legacy support_staff (not an admin): overview refused');
  perform pg_temp.as_(sup);    v := public.admin_coordinator_overview(); perform pg_temp.chk((v->>'ok')='false', 'A4 support admin (no coordinators.view): refused');
  perform pg_temp.as_(ops);    v := public.admin_coordinator_overview();
  perform pg_temp.chk((v->>'ok')='true' and jsonb_array_length(v->'coordinators')=5, 'A5 operations: overview lists 5 coordinators');
  perform pg_temp.chk(jsonb_array_length(v->'unassigned')=4, 'A6 four Local Taskers have no coordinator');
  perform pg_temp.chk((v->>'can_assign')='true' and (v->>'can_manage')='true' and (v->>'can_review')='true', 'A7 operations flags: assign, manage, review');
  perform pg_temp.chk((select (x->>'is_me')::boolean from jsonb_array_elements(v->'coordinators') x where x->>'user_id'=ops::text), 'A8 own coordinator row is flagged is_me');
  perform pg_temp.chk(position('capacity' in v::text) > 0 and (select (x->>'capacity')::int from jsonb_array_elements(v->'coordinators') x where x->>'user_id'=c1::text)=2, 'A9 capacity shown from coordinator_capacity()');
  perform pg_temp.as_(ver);    v := public.admin_coordinator_overview();
  perform pg_temp.chk((v->>'ok')='true' and (v->>'can_assign')='false' and (v->>'can_review')='false', 'A10 verification: can view, cannot assign or review');
  v := public.admin_coordinator_applications(null); perform pg_temp.chk((v->>'ok')='false', 'A11 verification: applications refused');
  perform pg_temp.as_(sa,'aal1'); update public.admin_settings set text_value='on' where key='require_mfa';
  v := public.admin_coordinator_overview(); perform pg_temp.chk((v->>'ok')='false', 'A12 two-step required but aal1: refused');
  perform pg_temp.as_(sa,'aal2'); v := public.admin_coordinator_overview(); perform pg_temp.chk((v->>'ok')='true', 'A13 aal2: allowed');
  update public.admin_settings set text_value='off' where key='require_mfa';
  update public.admin_users set status='suspended' where user_id=ops; perform pg_temp.as_(ops);
  v := public.admin_coordinator_overview(); perform pg_temp.chk((v->>'ok')='false', 'A14 suspended admin refused');
  update public.admin_users set status='active' where user_id=ops;

  -- B. applications
  perform pg_temp.as_(ops); v := public.admin_coordinator_applications('new');
  perform pg_temp.chk((v->>'ok')='true' and jsonb_array_length(v->'applications')=2, 'B1 two new applications');
  perform pg_temp.chk(position('token_hash' in v::text)=0 and position('"code"' in v::text)=0 and position('APPCODE-1' in v::text)=0, 'B2 no token hash and no code value in the list');
  perform pg_temp.chk((select x->>'code_state' from jsonb_array_elements(v->'applications') x where x->>'id'=app1::text)='issued', 'B3 code state shown as issued');
  v := public.admin_coordinator_applications('bogus'); perform pg_temp.chk((v->>'ok')='false', 'B4 unknown status refused');

  -- C. approve / reject. The imitation inner functions require _is_support(), like the real ones probably do.
  perform pg_temp.as_(sup); v := public.admin_coordinator_application_approve(app1);
  perform pg_temp.chk((v->>'ok')='false', 'C1 support admin (no applications.review): refused');
  select count(*) into n from public.admin_audit_log where action='coordinator.application_approve' and outcome='refused';
  perform pg_temp.chk(n=1, 'C2 refusal logged once');
  perform pg_temp.as_(nobody); v := public.admin_coordinator_application_approve(app1); perform pg_temp.chk((v->>'ok')='false', 'C3 stranger refused');
  perform pg_temp.as_(sa); v := public.admin_coordinator_application_approve(app1, 0); perform pg_temp.chk((v->>'ok')='false', 'C4 0 days refused');
  v := public.admin_coordinator_application_approve(app1, 7);
  perform pg_temp.chk((v->>'ok')='true' and (v->>'link') like 'https://streettasker.com/coordinator-test.html?t=%', 'C5 super admin: approved, link returned');
  perform pg_temp.chk((select status from public.coordinator_applications where id=app1)='approved', 'C6 application is approved');
  select count(*) into n from public.admin_audit_log where position('TOKEN-SECRET' in coalesce(new_value::text,'')||coalesce(detail::text,'')||coalesce(reason,''))>0;
  perform pg_temp.chk(n=0, 'C7 the test link/token is never written to the admin log');
  select count(*) into n from public.admin_audit_log where action='coordinator.application_approve' and outcome='ok' and target_id=app1::text;
  perform pg_temp.chk(n=1, 'C8 success logged');
  perform pg_temp.as_(ops); v := public.admin_coordinator_application_approve(app2);
  perform pg_temp.chk((v->>'ok')='false' and (v->>'error') like '%existing approval function%', 'C9 operations admin whose inner check refuses: clear message, nothing recorded: '||coalesce(v->>'error',''));
  perform pg_temp.chk((select status from public.coordinator_applications where id=app2)='new', 'C10 application unchanged after inner refusal');
  select count(*) into n from public.admin_audit_log where action='coordinator.application_approve' and outcome='error';
  perform pg_temp.chk(n=1, 'C11 error logged');
  perform pg_temp.as_(sa);
  v := public.admin_coordinator_application_reject(app2, 'short'); perform pg_temp.chk((v->>'ok')='false', 'C12 short reason refused');
  v := public.admin_coordinator_application_reject(app2, 'Does not meet the area requirement'); perform pg_temp.chk((v->>'ok')='true', 'C13 reject works');
  perform pg_temp.chk((select status from public.coordinator_applications where id=app2)='rejected', 'C14 application rejected');
  v := public.admin_coordinator_application_reject(gen_random_uuid(), 'A long enough reason'); perform pg_temp.chk((v->>'ok')='false', 'C15 unknown application refused');
  -- code
  v := public.admin_coordinator_code_create('For Chidi, Abuja', 14); perform pg_temp.chk((v->>'ok')='true' and (v->>'code')='CODE-SECRET-123', 'C16 code created and returned once');
  select count(*) into n from public.admin_audit_log where position('CODE-SECRET' in coalesce(new_value::text,'')||coalesce(detail::text,'')||coalesce(reason,''))>0;
  perform pg_temp.chk(n=0, 'C17 the code is never written to the log');
  perform pg_temp.as_(sup); v := public.admin_coordinator_code_create('For someone', 14); perform pg_temp.chk((v->>'ok')='false', 'C18 support admin refused');

  -- D. assign (first time) and capacity (imitation capacity = 2)
  perform pg_temp.as_(ops);
  v := public.admin_coordinator_assign_local_tasker(t1, c1, 'First assignment test'); perform pg_temp.chk((v->>'ok')='true' and v->>'kind'='assigned', 'D1 first assignment works');
  perform pg_temp.chk((select assigned_by from public.coordinator_assignments where tasker_user_id=t1 and ended_at is null)=ops, 'D2 assigned_by is the admin');
  v := public.admin_coordinator_assign_local_tasker(t2, c1, 'Second assignment test'); perform pg_temp.chk((v->>'ok')='true', 'D3 second works (capacity 2)');
  v := public.admin_coordinator_assign_local_tasker(t3, c1, 'Third assignment test');
  perform pg_temp.chk((v->>'ok')='false' and (v->>'error') like '%no free place%', 'D4 third is refused by the database guard: '||coalesce(v->>'error',''));
  perform pg_temp.chk((select count(*) from public.coordinator_assignments where tasker_user_id=t3)=0, 'D5 no row written when refused');
  select count(*) into n from public.admin_audit_log where action='coordinator.assign_local_tasker' and outcome='refused' and detail->>'hint'='coordinator_cap';
  perform pg_temp.chk(n=1, 'D6 capacity refusal logged');
  v := public.admin_coordinator_assign_local_tasker(t3, c3, 'Assign to deactivated one'); perform pg_temp.chk((v->>'ok')='false', 'D7 inactive coordinator refused');
  v := public.admin_coordinator_assign_local_tasker(t3, cpend, 'Assign to pending one'); perform pg_temp.chk((v->>'ok')='false', 'D8 pending coordinator refused');
  v := public.admin_coordinator_assign_local_tasker(notlt, c2, 'Not a local tasker at all'); perform pg_temp.chk((v->>'ok')='false', 'D9 not a Local Tasker refused');
  v := public.admin_coordinator_assign_local_tasker(t3, c2, 'short'); perform pg_temp.chk((v->>'ok')='false', 'D10 short reason refused');
  perform pg_temp.as_(ver); v := public.admin_coordinator_assign_local_tasker(t3, c2, 'Verification admin tries'); perform pg_temp.chk((v->>'ok')='false', 'D11 verification admin refused');
  perform pg_temp.as_(sup); v := public.admin_coordinator_assign_local_tasker(t3, c2, 'Support admin tries it'); perform pg_temp.chk((v->>'ok')='false', 'D12 support admin refused');
  perform pg_temp.as_(sa);
  select count(*) into n from public.notes_sent where to_user=c1; perform pg_temp.chk(n=2, 'D13 coordinator notified for each assignment');

  -- E. Rule R-SELF (ops is also coordinator "ops")
  perform pg_temp.as_(ops);
  v := public.admin_coordinator_assign_local_tasker(t3, ops, 'Assign to my own account'); perform pg_temp.chk((v->>'ok')='false' and (v->>'error') like '%own account%', 'E1 cannot assign to own coordinator account');
  select count(*) into n from public.admin_audit_log where action='coordinator.assign_local_tasker' and outcome='refused' and detail->>'why'='own_account';
  perform pg_temp.chk(n=1, 'E2 own-account refusal logged');
  perform pg_temp.as_(sa); v := public.admin_coordinator_assign_local_tasker(t3, ops, 'Super assigns to ops coordinator'); perform pg_temp.chk((v->>'ok')='true', 'E3 another admin may assign to the ops coordinator');
  perform pg_temp.as_(ops); v := public.admin_coordinator_assign_local_tasker(t3, c2, 'Move away from my own account');
  perform pg_temp.chk((v->>'ok')='false' and (v->>'error') like '%own account%', 'E4 cannot move from own coordinator account');
  begin perform public.admin_reassign_local_tasker(t3, c2, 'direct call by self'); perform pg_temp.chk(false,'E5 direct reassign from own account should have raised');
  exception when others then perform pg_temp.chk(sqlstate='P0001', 'E5 direct reassign from own account raises (own_account)'); end;
  v := public.admin_coordinator_deactivate(ops, 'Trying to remove myself here'); perform pg_temp.chk((v->>'ok')='false' and (v->>'error') like '%own coordinator account%', 'E6 cannot deactivate own coordinator account');

  -- F. move (reassign check replaced)
  perform pg_temp.as_(sa);
  v := public.admin_coordinator_assign_local_tasker(t1, c2, 'Moving to coordinator two'); perform pg_temp.chk((v->>'ok')='true' and v->>'kind'='moved', 'F1 move works');
  perform pg_temp.chk((select ended_at is not null from public.coordinator_assignments where tasker_user_id=t1 and coordinator_id=c1), 'F2 old assignment ended');
  perform pg_temp.chk((select previous_coordinator_id from public.coordinator_assignments where tasker_user_id=t1 and ended_at is null)=c1, 'F3 new row keeps previous coordinator');
  select count(*) into n from public.admin_audit_log where action='coordinator.reassign_local_tasker' and outcome='ok'; perform pg_temp.chk(n=1, 'F4 move logged by the function itself');
  v := public.admin_coordinator_assign_local_tasker(t1, c2, 'Moving to same coordinator'); perform pg_temp.chk((v->>'ok')='false' and (v->>'error') like '%already belongs%', 'F5 same coordinator refused: '||coalesce(v->>'error',''));
  -- move into a full coordinator (c1 has t2 only now; fill it)
  v := public.admin_coordinator_assign_local_tasker(t4, c1, 'Fill coordinator one up'); perform pg_temp.chk((v->>'ok')='true', 'F6 fill c1 to capacity');
  v := public.admin_coordinator_assign_local_tasker(t1, c1, 'Move into a full coordinator'); perform pg_temp.chk((v->>'ok')='false' and (v->>'error') like '%no free place%', 'F7 move into a full coordinator refused: '||coalesce(v->>'error',''));
  perform pg_temp.chk((select coordinator_id from public.coordinator_assignments where tasker_user_id=t1 and ended_at is null)=c2, 'F8 the Local Tasker stayed with the old coordinator (all or nothing)');

  -- G. the replaced F-6 function: who may call it directly
  perform pg_temp.as_(sup);    begin perform public.admin_reassign_local_tasker(t1, c1, 'x'); perform pg_temp.chk(false,'G1 support admin direct call should raise'); exception when others then perform pg_temp.chk(sqlstate='P0001', 'G1 support admin (passes _is_support) is refused by the replaced check'); end;
  perform pg_temp.as_(legacy); begin perform public.admin_reassign_local_tasker(t1, c1, 'x'); perform pg_temp.chk(false,'G2 legacy staff direct call should raise'); exception when others then perform pg_temp.chk(sqlstate='P0001', 'G2 legacy support_staff user refused (no longer allowed)'); end;
  perform pg_temp.as_(nobody); begin perform public.admin_reassign_local_tasker(t1, c1, 'x'); perform pg_temp.chk(false,'G3'); exception when others then perform pg_temp.chk(sqlstate='P0001', 'G3 stranger refused'); end;
  perform pg_temp.as_(null);   begin perform public.admin_reassign_local_tasker(t2, c2, 'Moved by the SQL editor test'); perform pg_temp.chk(true, 'G4 SQL editor / service role path still works'); exception when others then perform pg_temp.chk(false, 'G4 SQL editor path failed: '||sqlerrm); end;
  perform pg_temp.as_(sa);     begin perform public.admin_reassign_local_tasker(t2, c3, 'Move to deactivated one'); perform pg_temp.chk(false,'G5'); exception when others then perform pg_temp.chk(sqlstate='P0001', 'G5 target must be active (F-6 behaviour kept)'); end;

  -- H. deactivate
  perform pg_temp.as_(sa);
  v := public.admin_coordinator_deactivate(c2, 'Retiring this coordinator now'); perform pg_temp.chk((v->>'ok')='false' and (v->>'workers')::int=2, 'H1 refused while Local Taskers are assigned (2)');
  perform pg_temp.chk((select status from public.coordinators where user_id=c2)='active', 'H2 status unchanged');
  update public.coordinator_assignments set ended_at=now() where coordinator_id=c2 and ended_at is null;
  insert into public.bookings(id,status) values (b1,'accepted'),(b2,'completed');
  insert into public.local_booking_state values (b1,c2,t1);
  v := public.admin_coordinator_deactivate(c2, 'Retiring this coordinator now'); perform pg_temp.chk((v->>'ok')='false' and (v->>'open_bookings')::int=1, 'H3 refused while an open booking exists');
  delete from public.local_booking_state where booking_id=b1; insert into public.local_booking_state values (b2,c2,t1);
  v := public.admin_coordinator_deactivate(c2, 'short'); perform pg_temp.chk((v->>'ok')='false', 'H4 short reason refused');
  perform pg_temp.as_(ver); v := public.admin_coordinator_deactivate(c2, 'Retiring this coordinator now'); perform pg_temp.chk((v->>'ok')='false', 'H5 verification admin refused');
  perform pg_temp.as_(sa);
  v := public.admin_coordinator_deactivate(c2, 'Retiring this coordinator now'); perform pg_temp.chk((v->>'ok')='true', 'H6 deactivated when nothing depends on them (completed booking does not block)');
  perform pg_temp.chk((select status from public.coordinators where user_id=c2)='deactivated', 'H7 status is deactivated; row kept');
  perform pg_temp.chk((select count(*) from public.coordinator_assignments where coordinator_id=c2)>=2, 'H8 assignment history preserved');
  v := public.admin_coordinator_deactivate(c2, 'Retiring this coordinator now'); perform pg_temp.chk((v->>'ok')='false', 'H9 already deactivated refused');
  select count(*) into n from public.admin_audit_log where action='coordinator.deactivate' and outcome='ok'; perform pg_temp.chk(n=1, 'H10 success logged');

  -- I. workers list and grants
  v := public.admin_coordinator_workers(c1); perform pg_temp.chk((v->>'ok')='true' and jsonb_array_length(v->'workers')=1, 'I1 workers of c1 listed (t4 only; t2 moved by the editor test)');
  perform pg_temp.as_(sup); v := public.admin_coordinator_workers(c1); perform pg_temp.chk((v->>'ok')='false', 'I2 support admin refused');
  select count(*) into n from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'admin\_coordinator\_%' or p.proname='admin_reassign_local_tasker')
     and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'));
  perform pg_temp.chk(n=0, 'I3 all A9 functions: anon cannot execute, authenticated can');
  perform pg_temp.chk(not has_table_privilege('authenticated','public.coordinator_assignments','insert') and not has_table_privilege('authenticated','public.admin_audit_log','insert'), 'I4 browser role has no direct write on assignments or the audit log');
  select count(*) into n from public.admin_audit_log where action like 'coordinator.%' and actor_id is null; perform pg_temp.chk(n=0, 'I5 every log row names an actor');
end
$t$;
select case when ok then 'PASS' else 'FAIL' end as res, n, line from r order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from r;

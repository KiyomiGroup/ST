-- LOCAL ONLY: run after standin.sql, a1-admin-core.sql, a13-disputes.sql on a scratch Postgres. Not for Supabase.
create temp table r (n serial, ok boolean, line text);
create function pg_temp.as_(p uuid, aal text default 'aal1') returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', case when p is null then '' else jsonb_build_object('sub', p::text, 'aal', aal)::text end, false);
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $f$;
create function pg_temp.chk(c boolean, t text) returns void language plpgsql as $f$ begin insert into r(ok,line) values (coalesce(c,false), t); end $f$;
do $t$
declare sup uuid := gen_random_uuid(); ops uuid := gen_random_uuid(); sa uuid := gen_random_uuid(); legacy uuid := gen_random_uuid(); nobody uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); th uuid := gen_random_uuid(); v jsonb; n int; t text;
begin
  insert into auth.users(id,email) values (sup,'s@x'),(ops,'o@x'),(sa,'a@x'),(legacy,'l@x'),(nobody,'n@x');
  insert into public.admin_users(user_id,display_name,status) values (sup,'Support A','active'),(ops,'Ops','active'),(sa,'Super','active');
  insert into public.admin_user_roles(user_id,role_key) values (sup,'support'),(ops,'operations'),(sa,'super_admin');
  insert into public.support_staff(user_id,note) values (legacy,'legacy');
  insert into public.job_disputes(id,thread_id,reason,category,opened_by_role) values (d1,th,'a','not_done','customer'),(d2,th,'b','no_show','tasker'),(d3,th,'c','other','customer');
  -- 1 _is_support truth table
  perform pg_temp.as_(sup);    perform pg_temp.chk(public._is_support(), '1 support admin (disputes.manage) passes _is_support');
  perform pg_temp.as_(sa);     perform pg_temp.chk(public._is_support(), '2 super admin passes');
  perform pg_temp.as_(ops);    perform pg_temp.chk(not public._is_support(), '3 operations admin (no disputes.manage) refused');
  perform pg_temp.as_(legacy); perform pg_temp.chk(public._is_support(), '4 legacy support_staff row still passes');
  perform pg_temp.as_(nobody); perform pg_temp.chk(not public._is_support(), '5 stranger refused');
  perform pg_temp.as_(null);   perform pg_temp.chk(public._is_support(), '6 SQL-editor branch (no auth.uid, session_user postgres) kept');
  -- suspended admin
  update public.admin_users set status='suspended' where user_id=sup;
  perform pg_temp.as_(sup);    perform pg_temp.chk(not public._is_support(), '7 suspended admin refused');
  update public.admin_users set status='active' where user_id=sup;
  -- two-step required but not passed
  update public.admin_settings set text_value='on' where key='require_mfa';
  perform pg_temp.as_(sup,'aal1'); perform pg_temp.chk(not public._is_support(), '8 two-step required, aal1: refused');
  perform pg_temp.as_(sup,'aal2'); perform pg_temp.chk(public._is_support(), '9 two-step required, aal2: passes');
  update public.admin_settings set text_value='off' where key='require_mfa';
  -- 2 wrappers
  perform pg_temp.as_(ops);
  v := public.admin_dispute_start_review(d1::text);
  perform pg_temp.chk((v->>'ok')='false', '10 operations admin: start_review refused: '||coalesce(v->>'error',''));
  select count(*) into n from public.admin_audit_log where action='dispute.start_review' and outcome='refused';
  perform pg_temp.chk(n=1, '11 refusal logged once (active admin)');
  perform pg_temp.as_(nobody);
  v := public.admin_dispute_start_review(d1::text);
  perform pg_temp.chk((v->>'ok')='false', '12 stranger refused');
  select count(*) into n from public.admin_audit_log where actor_id=nobody; perform pg_temp.chk(n=0, '13 stranger writes nothing to the log');
  perform pg_temp.as_(sup);
  v := public.admin_dispute_start_review(d1::text);
  perform pg_temp.chk((v->>'ok')='true', '14 support admin: start_review ok');
  perform pg_temp.chk((select status from public.job_disputes where id=d1)='under_review', '15 dispute is under_review');
  select count(*) into n from public.admin_audit_log where action='dispute.start_review' and outcome='ok' and target_id=d1::text; perform pg_temp.chk(n=1, '16 ok row in admin log');
  v := public.admin_dispute_start_review(d1::text);
  perform pg_temp.chk((v->>'ok')='false', '17 second start_review: support function error passed through');
  select count(*) into n from public.admin_audit_log where action='dispute.start_review' and outcome='refused' and actor_id=sup; perform pg_temp.chk(n=1, '18 failed attempt logged as refused with error detail');
  -- resolve: no refund
  v := public.admin_dispute_resolve(d2::text, 'no_action', 'Looked at it, nothing to do here.');
  perform pg_temp.chk((v->>'ok')='true' and (select status from public.job_disputes where id=d2)='resolved', '19 resolve no_action ok');
  -- resolve with refund, amount as text -> numeric
  v := public.admin_dispute_resolve(d3::text, 'refund_partial', 'Partial refund agreed with customer.', '1500.50', 'RF-123', 'note');
  perform pg_temp.chk((v->>'ok')='true' and (select outcome from public.job_disputes where id=d3)='refund_partial', '20 refund outcome with text amount ok');
  select count(*) into n from public.admin_audit_log where action='dispute.resolve' and new_value->>'refund_ref'='RF-123' and reason like 'Partial%'; perform pg_temp.chk(n=1, '21 audit row has outcome, refund ref and decision note');
  -- record_refund
  v := public.admin_dispute_record_refund(d3::text, '200', 'RF-124');
  perform pg_temp.chk((v->>'ok')='true' and (select count(*) from public.job_refunds where paystack_ref='RF-124')=1, '22 record_refund ok');
  -- chat read
  v := public.admin_dispute_read_chat(d1::text);
  perform pg_temp.chk((v->>'ok')='true' and jsonb_typeof(v->'messages')='array', '23 read_chat ok and logged by support function');
  select count(*) into n from public.admin_audit_log where action='dispute.read_chat'; perform pg_temp.chk(n=1, '24 read_chat in admin log');
  -- remove evidence
  v := public.admin_dispute_remove_evidence(gen_random_uuid()::text, 'Contains a phone number'); perform pg_temp.chk((v->>'ok')='true', '25 remove_evidence ok');
  -- refund permission split: custom role with disputes.manage but not disputes.refund.record
  insert into public.admin_roles(key,label) values ('t_nr','Test no refund') on conflict do nothing;
  insert into public.admin_role_permissions(role_key,permission_key) values ('t_nr','disputes.manage');
  update public.admin_user_roles set role_key='t_nr' where user_id=sup;
  perform pg_temp.as_(sup);
  v := public.admin_dispute_resolve(gen_random_uuid()::text, 'refund_full', 'Refund everything please now.', '10', 'RF-9');
  perform pg_temp.chk((v->>'ok')='false' and v->>'error' like '%refund%', '26 manage without refund.record: refund outcome refused');
  v := public.admin_dispute_record_refund(d3::text, '5', 'RF-8'); perform pg_temp.chk((v->>'ok')='false', '27 manage without refund.record: record_refund refused');
  v := public.admin_dispute_resolve(gen_random_uuid()::text, 'no_action', 'No refund, closing the report.'); perform pg_temp.chk((v->>'error') is distinct from 'You do not have permission to do this.', '28 same role may still decide non-refund outcomes (reaches support function)');
  -- bad id: support function raises (uuid cast) -> clean error, logged
  v := public.admin_dispute_start_review('not-a-uuid'); perform pg_temp.chk((v->>'ok')='false' and v->>'error' like 'The request failed%', '29 bad id: clean failure, no raw SQL error');
  -- injection attempt in text args
  v := public.admin_dispute_remove_evidence(gen_random_uuid()::text, 'x''); drop table public.job_refunds; --'); perform pg_temp.chk(to_regclass('public.job_refunds') is not null and (v->>'ok')='true', '30 quote in text argument is data, not SQL');
  -- direct call of internal helper refused for browser role
  perform pg_temp.chk(not has_function_privilege('authenticated','public._admin_dispute_run(text,text,text,text,text,text,text,jsonb)','execute'), '31 helper not callable by browser roles');
  perform pg_temp.chk(not has_function_privilege('anon','public.admin_dispute_resolve(text,text,text,text,text,text)','execute') and has_function_privilege('authenticated','public.admin_dispute_resolve(text,text,text,text,text,text)','execute'), '32 grants: authenticated yes, anon no');
  perform pg_temp.chk(not has_table_privilege('authenticated','public.admin_function_backups','select'), '33 backup table closed to browser roles');
end $t$;
select case when ok then 'PASS ' else 'FAIL ' end || n || ' ' || line from r order by n;
select 'RESULT: ' || case when bool_and(ok) then 'ALL PASS' else 'FAIL' end || ' (' || count(*) || ' checks)' from r;

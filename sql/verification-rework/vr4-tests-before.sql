-- VR4 tests, part 1 of 2. SCRATCH DATABASE ONLY (made-up rows; do NOT run on live). Run BEFORE vr4-open-gates.sql, with the OLD functions installed.
-- It seeds people and held drafts, and proves the OLD gates were closed. Last row must say RESULT: ALL PASS (before state).
insert into public.users values ('11111111-0000-0000-0000-000000000001','customer',null),('11111111-0000-0000-0000-000000000002','tasker',null),('11111111-0000-0000-0000-000000000003','tasker',null);
insert into public.taskers values ('tk1','11111111-0000-0000-0000-000000000002',false),('tk2','11111111-0000-0000-0000-000000000003',true);
insert into public.tasks(id,status,customer_id,user_id) values ('22222222-0000-0000-0000-000000000001','draft','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into public.services(id,available,user_id) values ('33333333-0000-0000-0000-000000000001',false,'11111111-0000-0000-0000-000000000002');
insert into public.idv_takedowns(user_id,entity,entity_id,reason) values
 ('11111111-0000-0000-0000-000000000001','task','22222222-0000-0000-0000-000000000001','held'),
 ('11111111-0000-0000-0000-000000000002','service','33333333-0000-0000-0000-000000000001','held'),
 ('11111111-0000-0000-0000-000000000002','tasker_listing','tk1','held');
insert into public.coordinators values ('11111111-0000-0000-0000-000000000009','pending');
insert into public.idv_reverify_log values ('11111111-0000-0000-0000-000000000001');
create temp table t_res(n int, name text, ok boolean);
set test.uid = '11111111-0000-0000-0000-000000000002';
insert into t_res values (1,'OLD: unverified tasker cannot publish', not (public.idv_can_publish()->>'can_publish')::boolean);
set test.uid = '11111111-0000-0000-0000-000000000001';
insert into t_res values (2,'OLD: customer in reverify log is told verification is required', (public.idv_my_gate()->>'required')::boolean);
do $$ begin
  begin
    insert into public.bookings(customer_id,status) values ('11111111-0000-0000-0000-000000000001','pending');
    insert into t_res values (3,'OLD: unverified customer cannot book', false);
  exception when others then insert into t_res values (3,'OLD: unverified customer cannot book', sqlerrm like '%Verify your identity%');
  end;
end $$;
insert into t_res values (4,'OLD: held rows are waiting', (select count(*) from public.idv_takedowns where restored_at is null)=3);
select n, name, case when ok then 'PASS' else 'FAIL' end from t_res order by n;
select 'RESULT: ' || case when bool_and(ok) and count(*)=4 then 'ALL PASS (before state)' else 'SOME FAIL' end from t_res;

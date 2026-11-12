-- VR4 tests, part 2 of 2. SCRATCH DATABASE ONLY. Run AFTER vr4-tests-before.sql and vr4-open-gates.sql. Last row must say RESULT: ALL PASS.
begin;
create temp table t_res(n int, name text, ok boolean);
set local test.uid = '11111111-0000-0000-0000-000000000002';
insert into t_res values (1,'unverified tasker can publish', (public.idv_can_publish()->>'can_publish')::boolean);
set local test.uid = '11111111-0000-0000-0000-000000000001';
insert into t_res values (2,'unverified customer can publish', (public.idv_can_publish()->>'can_publish')::boolean);
insert into t_res values (3,'nobody is told verification is required', not (public.idv_my_gate()->>'required')::boolean);
do $$ begin
  begin
    insert into public.bookings(customer_id,status) values ('11111111-0000-0000-0000-000000000001','pending');
    insert into t_res values (4,'unverified customer can book', true);
  exception when others then insert into t_res values (4,'unverified customer can book', false);
  end;
end $$;
set local test.uid = '';
insert into t_res values (5,'signed out cannot publish', not (public.idv_can_publish()->>'can_publish')::boolean);
insert into t_res values (6,'gate_customers is false', (select gate_customers from public.idv_gate_config) is false);
insert into t_res values (7,'held task is live', (select status from public.tasks where id='22222222-0000-0000-0000-000000000001')='open');
insert into t_res values (8,'held service is live', (select available from public.services where id='33333333-0000-0000-0000-000000000001'));
insert into t_res values (9,'held tasker listing is live', (select available from public.taskers where id='tk1'));
insert into t_res values (10,'nothing is held any more', (select count(*) from public.idv_takedowns where restored_at is null)=0);
insert into t_res values (11,'pending coordinator was switched on', (select status from public.coordinators where user_id='11111111-0000-0000-0000-000000000009')='active');
insert into public.coordinators values ('11111111-0000-0000-0000-000000000010','active');
insert into t_res values (12,'new coordinator stays active (not held pending)', (select status from public.coordinators where user_id='11111111-0000-0000-0000-000000000010')='active');
-- automatic hide is off, a manual takedown still works
insert into public.tasks(id,status,customer_id,user_id) values ('22222222-0000-0000-0000-000000000002','open','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
select public.idv_takedown_user('11111111-0000-0000-0000-000000000001','unverified');
select public.idv_takedown_user('11111111-0000-0000-0000-000000000001','reverify');
insert into t_res values (13,'reason unverified/reverify hides nothing', (select status from public.tasks where id='22222222-0000-0000-0000-000000000002')='open');
select public.idv_takedown_user('11111111-0000-0000-0000-000000000001','admin_action');
insert into t_res values (14,'another reason (admin) still hides', (select status from public.tasks where id='22222222-0000-0000-0000-000000000002')='draft');
insert into t_res values (15,'booking guard is gone', to_regproc('public.guard_booking_customer_verified') is null and not exists (select 1 from pg_trigger where tgname='trg_guard_booking_customer_verified'));
insert into t_res values (16,'originals are backed up', (select count(*) from public.vr4_backup where kind='function')=6 and exists (select 1 from public.vr4_backup where kind='trigger'));
select n, name, case when ok then 'PASS' else 'FAIL' end from t_res order by n;
select 'RESULT: ' || case when bool_and(ok) and count(*)=16 then 'ALL PASS' else 'SOME FAIL' end from t_res;
rollback;

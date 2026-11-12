-- VR3a tests. Run AFTER vr3a-payment-gate.sql. Uses its own test rows inside one transaction and ROLLS BACK, so nothing is left behind.
-- Last row must say RESULT: ALL PASS. Needs a booking-linked chat to exist? No: it creates its own temporary rows only in a scratch
-- copy; on the live project run it only if you are comfortable with the rolled-back inserts. (It is safe: rollback at the end.)
begin;
create temp table t_res(n int, name text, ok boolean) on commit drop;
create or replace function pg_temp.chk(n int, name text, ok boolean) returns void language sql as $$ insert into t_res values (n, name, coalesce(ok,false)) $$;
-- runs _prepare_intent for a fresh request of p_amount; returns 'ok' or the hint
create or replace function pg_temp.try(p_user uuid, p_amount numeric) returns text language plpgsql as $$
declare r uuid := gen_random_uuid(); h text;
begin
  insert into public.payment_requests(id, thread_id, kind, status, amount) values (r, 'a0000000-0000-0000-0000-000000000001', 'payment', 'pending', p_amount);
  begin
    perform public._prepare_intent(p_user, 'request', r, null, null);
    return 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    return coalesce(nullif(h,''), 'other:' || sqlerrm);
  end;
end $$;
-- marks all of a user's pending intents paid (as payment_finalize would)
create or replace function pg_temp.settle(p_user uuid, p_provider text default 'PSK') returns void language sql as $$
  update public.payment_intents set status='paid', paid_at=now(), provider_ref=p_provider where user_id=p_user and status='pending' $$;

insert into public.exempt_ids values ('c0000000-0000-0000-0000-000000000003');
insert into public.identity_verifications(user_id, status) values ('c0000000-0000-0000-0000-000000000002','VERIFIED');
insert into public.identity_verifications(user_id, status) values ('c0000000-0000-0000-0000-000000000005','PENDING');
-- the thread belongs to user 1; make the other test users own it in turn
update public.message_threads set customer_id='c0000000-0000-0000-0000-000000000001';
update public.bookings set customer_id='c0000000-0000-0000-0000-000000000001';

select pg_temp.chk(1,'limit setting is 10000', public.idv_customer_payment_limit()=10000);
select pg_temp.chk(2,'message names the limit', public.idv_customer_payment_message()='Payments above ₦10,000 need identity verification.');
-- exactly 10,000 passes, 10,001 blocks (fresh customer)
select pg_temp.chk(3,'exactly 10,000 passes', pg_temp.try('c0000000-0000-0000-0000-000000000001',10000)='ok');
select pg_temp.settle('c0000000-0000-0000-0000-000000000001');
-- user 1 has now paid 10,000: any further payment goes over
select pg_temp.chk(4,'one more naira after 10,000 paid blocks', pg_temp.try('c0000000-0000-0000-0000-000000000001',1)='verification_required' or pg_temp.try('c0000000-0000-0000-0000-000000000001',100)='verification_required');
-- blocked attempt left no intent row behind
select pg_temp.chk(5,'refusal creates no payment row', (select count(*) from public.payment_intents where user_id='c0000000-0000-0000-0000-000000000001')=1);
-- fresh user: 10,001 blocks in one go. Use a new customer by moving the thread.
update public.message_threads set customer_id='c0000000-0000-0000-0000-000000000004'; update public.bookings set customer_id='c0000000-0000-0000-0000-000000000004';
select pg_temp.chk(6,'single payment 10,001 blocks', pg_temp.try('c0000000-0000-0000-0000-000000000004',10001)='verification_required');
select pg_temp.chk(7,'9,000 passes', pg_temp.try('c0000000-0000-0000-0000-000000000004',9000)='ok');
-- two payments of 6,000: first passes, once paid the second blocks
update public.payment_intents set status='expired' where user_id='c0000000-0000-0000-0000-000000000004';
select pg_temp.chk(8,'first 6,000 passes', pg_temp.try('c0000000-0000-0000-0000-000000000004',6000)='ok');
select pg_temp.settle('c0000000-0000-0000-0000-000000000004');
select pg_temp.chk(9,'second 6,000 blocks (total 12,000)', pg_temp.try('c0000000-0000-0000-0000-000000000004',6000)='verification_required');
select pg_temp.chk(10,'a 4,000 still fits (total exactly 10,000)', pg_temp.try('c0000000-0000-0000-0000-000000000004',4000)='ok');
-- things that must NOT count
update public.payment_intents set status='expired' where user_id='c0000000-0000-0000-0000-000000000004' and status='pending';
update public.message_threads set customer_id='c0000000-0000-0000-0000-000000000005'; update public.bookings set customer_id='c0000000-0000-0000-0000-000000000005';
insert into public.payment_intents(reference,user_id,purpose,amount,platform_fee,tasker_amount,status,provider_ref) values
 ('ST-1','c0000000-0000-0000-0000-000000000005','request',9000,0,0,'pending',null),
 ('ST-2','c0000000-0000-0000-0000-000000000005','request',9000,0,0,'expired',null),
 ('ST-3','c0000000-0000-0000-0000-000000000005','request',9000,0,0,'failed',null),
 ('ST-4','c0000000-0000-0000-0000-000000000005','request',9000,0,0,'amount_mismatch',null),
 ('ST-5','c0000000-0000-0000-0000-000000000005','request',9000,0,0,'paid','WALLET'),
 ('ST-6','c0000000-0000-0000-0000-000000000005','subscription',9000,0,0,'paid','PSK');
select pg_temp.chk(11,'pending/expired/failed/mismatch/wallet/subscription do not count', public._idv_customer_paid_total('c0000000-0000-0000-0000-000000000005')=0);
select pg_temp.chk(12,'so 10,000 still passes for that user', pg_temp.try('c0000000-0000-0000-0000-000000000005',10000)='ok');
-- verified and exempt are never blocked
update public.message_threads set customer_id='c0000000-0000-0000-0000-000000000002'; update public.bookings set customer_id='c0000000-0000-0000-0000-000000000002';
select pg_temp.chk(13,'verified customer: 500,000 passes', pg_temp.try('c0000000-0000-0000-0000-000000000002',500000)='ok');
update public.message_threads set customer_id='c0000000-0000-0000-0000-000000000003'; update public.bookings set customer_id='c0000000-0000-0000-0000-000000000003';
select pg_temp.chk(14,'exempt test account: 500,000 passes', pg_temp.try('c0000000-0000-0000-0000-000000000003',500000)='ok');
-- changing the limit takes effect with no code change
update public.verification_rules set int_value=20000 where key='customer_payment_limit';
update public.message_threads set customer_id='c0000000-0000-0000-0000-000000000006'; update public.bookings set customer_id='c0000000-0000-0000-0000-000000000006';
select pg_temp.chk(15,'limit 20,000: 15,000 passes', pg_temp.try('c0000000-0000-0000-0000-000000000006',15000)='ok');
select pg_temp.chk(16,'limit 20,000: 20,001 blocks', pg_temp.try('c0000000-0000-0000-0000-000000000006',20001)='verification_required');
update public.verification_rules set int_value=10000 where key='customer_payment_limit';
-- the pay-button helper
set local test.uid = 'c0000000-0000-0000-0000-000000000006';
select pg_temp.chk(17,'gate_mine: 12,000 needs verify', (public.customer_payment_gate_mine(12000)->>'needs_verify')::boolean and (public.customer_payment_gate_mine(12000)->>'limit')::int=10000);
select pg_temp.chk(18,'gate_mine: 9,000 does not', not (public.customer_payment_gate_mine(9000)->>'needs_verify')::boolean);
set local test.uid = 'c0000000-0000-0000-0000-000000000002';
select pg_temp.chk(19,'gate_mine: verified user never needs it', not (public.customer_payment_gate_mine(999999)->>'needs_verify')::boolean and (public.customer_payment_gate_mine(1)->>'verified')::boolean);
-- the rest of _prepare_intent still behaves: someone else's request is still refused with its own message
update public.message_threads set customer_id='c0000000-0000-0000-0000-000000000007';
select pg_temp.chk(20,'not-your-request message unchanged', pg_temp.try('c0000000-0000-0000-0000-000000000006',500) like 'other:%not yours%');
-- privileges: the browser cannot call the gate or read the settings
select pg_temp.chk(21,'authenticated cannot read verification_rules', not has_table_privilege('authenticated','public.verification_rules','select'));
select pg_temp.chk(22,'authenticated cannot call the raw gate', not has_function_privilege('authenticated','public.idv_customer_payment_gate(uuid,numeric)','execute'));
select pg_temp.chk(23,'authenticated can call gate_mine', has_function_privilege('authenticated','public.customer_payment_gate_mine(numeric)','execute'));

select n, name, case when ok then 'PASS' else 'FAIL' end as result from t_res order by n;
select 'RESULT: ' || case when bool_and(ok) and count(*)=23 then 'ALL PASS' else 'SOME FAIL' end from t_res;
rollback;

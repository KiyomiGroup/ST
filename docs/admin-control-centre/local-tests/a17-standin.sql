create table users(id uuid primary key, name text);
create table wallets(id uuid default gen_random_uuid(), user_id uuid, balance numeric, pending_balance numeric, updated_at timestamptz);
create table withdrawals(id uuid primary key default gen_random_uuid(), user_id uuid, reference text, amount numeric, fee numeric, net_amount numeric, status text, bank_account_id uuid, bank_code text, bank_name text, account_number text, account_name text, recipient_code text, paystack_transfer_code text, failure_reason text, created_at timestamptz default now(), updated_at timestamptz, settled_at timestamptz, account_last4 text);
create table local_payout_accounts(id uuid primary key, tasker_user_id uuid, status text, bank_code text, bank_name text, account_last4 text, recipient_code text);
create table local_tasker_profiles(tasker_user_id uuid, full_name text);
create table local_payouts(id uuid primary key default gen_random_uuid(), booking_id uuid, release_key text, tasker_user_id uuid, payout_account_id uuid, amount numeric, base_amount numeric, fee_total numeric, status text, status_reason text, reference text, provider_ref text, attempts int default 0, last_error text, created_at timestamptz default now(), updated_at timestamptz, paid_at timestamptz, transfer_reference text, provider_status text, claimed_at timestamptz, sent_at timestamptz, ref_gen int, release_after timestamptz, transfer_fee numeric, send_amount numeric);
create function admin_has(p text) returns boolean language sql as $$ select current_setting('app.perm', true) = p $$;
do $$ begin create role authenticated; create role anon; exception when duplicate_object then null; end $$;
insert into users values ('00000000-0000-0000-0000-000000000001','Ada Tasker');
insert into wallets(user_id,balance,pending_balance) values ('00000000-0000-0000-0000-000000000001',5000,200),('00000000-0000-0000-0000-000000000002',0,0);
insert into withdrawals(user_id,reference,amount,fee,net_amount,status,bank_name,account_number,account_last4,created_at,failure_reason) values
 ('00000000-0000-0000-0000-000000000001','wd-a',10000,50,9950,'success','GTB','0123456789','6789',now()-interval '2 days',null),
 ('00000000-0000-0000-0000-000000000001','wd-b',5000,50,4950,'processing','GTB','0123456789','6789',now()-interval '40 minutes',null),
 ('00000000-0000-0000-0000-000000000001','wd-c',3000,50,2950,'pending','GTB','0123456789','6789',now()-interval '2 minutes',null),
 ('00000000-0000-0000-0000-000000000001','wd-d',2000,50,1950,'failed','GTB','0123456789','6789',now()-interval '1 day','ANOMALY: x');
insert into local_payout_accounts values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000009','verified','058','GTB','1234','RCP_secret');
insert into local_tasker_profiles values ('00000000-0000-0000-0000-000000000009','Mama Ayo');
insert into local_payouts(booking_id,release_key,tasker_user_id,payout_account_id,amount,base_amount,fee_total,status,release_after,send_amount) values
 (gen_random_uuid(),'final','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000a1',8000,9000,1000,'queued',now()-interval '2 hours',7900),
 (gen_random_uuid(),'final','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000a1',4000,4500,500,'paid',now()-interval '3 days',3900);

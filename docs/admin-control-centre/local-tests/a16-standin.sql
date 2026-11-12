-- LOCAL STAND-INS ONLY (never run on Supabase). Just enough tables for sql/admin/a16-revenue.sql on a scratch Postgres.
drop schema public cascade; create schema public;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
create function public.admin_has(p text) returns boolean language sql stable as $$ select current_setting('app.perm', true) = p $$;
-- imitation of the A15b release-events function: reads a plain table with the same output columns
create table public.rel_events (src_table text, src_id text, booking_ref text, booking_id uuid, kind text, released_at timestamptz, tasker_kobo bigint, coord_kobo bigint, platform_kobo bigint);
create function public._acct_release_events(p_from timestamptz, p_to timestamptz) returns table (src_table text, src_id text, booking_ref text, booking_id uuid, kind text, released_at timestamptz, tasker_kobo bigint, coord_kobo bigint, platform_kobo bigint)
 language sql stable as $$ select * from public.rel_events where (p_from is null or released_at >= p_from) and (p_to is null or released_at < p_to) $$;
create table public.payment_intents (id uuid primary key default gen_random_uuid(), reference text, purpose text, status text, amount numeric, paid_at timestamptz);
create table public.escrow_payments (id uuid primary key default gen_random_uuid(), booking_id uuid, status text, platform_fee numeric);
create table public.subscription_receipts (id uuid primary key default gen_random_uuid(), reference text, plan_name text, kind text, amount_kobo bigint, paid_at timestamptz);
create table public.withdrawals (id uuid primary key default gen_random_uuid(), reference text, paystack_transfer_code text, status text, amount numeric, fee numeric, created_at timestamptz default now(), updated_at timestamptz, settled_at timestamptz);
-- test_archive tables must never be read: a row here would change a total if it were
create table public.test_archive_payment_intents (like public.payment_intents including defaults);
insert into public.test_archive_payment_intents (reference, purpose, status, amount, paid_at) values ('ARCH-1','tier_upgrade','paid',999999,now());
-- fixed data, dates in WAT (UTC+1). "today" in the tests is 2026-11-12.
insert into public.rel_events values
 ('wallet_transactions','w1','aaaa1111',gen_random_uuid(),'regular','2026-11-10 10:00+01',900000,0,120000),
 ('wallet_transactions','w2','bbbb2222',gen_random_uuid(),'regular','2026-11-02 10:00+01',450000,0,60000),
 ('wallet_transactions','w3','cccc3333',gen_random_uuid(),'regular','2026-11-09 23:30+01',300000,0,40000),   -- Monday 23:30 WAT = still Mon 9 Nov, week of 9 Nov
 ('wallet_transactions','w4','dddd4444',gen_random_uuid(),'regular','2026-11-08 23:30+00',300000,0,30000),   -- 00:30 WAT on 9 Nov (Mon): week of 9 Nov, not 2 Nov
 ('local_payouts','l1','eeee5555',gen_random_uuid(),'local','2026-11-11 12:00+01',800000,50000,30000),
 ('local_payouts','l2','ffff6666',gen_random_uuid(),'local','2026-11-11 13:00+01',800000,0,0),   -- zero platform share: no row
 ('wallet_transactions','w5','gggg7777',gen_random_uuid(),'regular','2025-01-05 10:00+01',100000,0,10000);   -- far outside the default range
insert into public.payment_intents (reference, purpose, status, amount, paid_at) values
 ('TU-1','tier_upgrade','paid',5000.50,'2026-11-05 09:00+01'),
 ('TU-2','tier_upgrade','pending',9000,null),
 ('TU-3','tier_upgrade','failed',9000,'2026-11-05 09:00+01'),
 ('SUB-1','subscription','paid',3000,'2026-11-06 09:00+01'),     -- a subscription intent is NOT counted here (the receipt is)
 ('JOB-1','booking','paid',20000,'2026-11-06 09:00+01');
insert into public.escrow_payments (booking_id, status, platform_fee) values (gen_random_uuid(),'held',2500),(gen_random_uuid(),'held',1000.25),(gen_random_uuid(),'released',9999);
insert into public.subscription_receipts (reference, plan_name, kind, amount_kobo, paid_at) values
 ('R-1','Pro','payment',300000,'2026-11-06 09:00+01'),('R-2','Premium','payment',700000,'2026-10-20 09:00+01'),('R-3','Pro','payment',300000,null);
insert into public.withdrawals (reference, paystack_transfer_code, status, amount, fee, created_at, settled_at) values
 ('wd-1','TRF_1','success',10000,100,'2026-11-07 09:00+01','2026-11-07 09:05+01'),
 ('wd-2','TRF_2','failed',5000,50,'2026-11-07 09:00+01',null),
 ('wd-3','TRF_3','success',3000,0,'2026-11-08 09:00+01','2026-11-08 09:05+01');

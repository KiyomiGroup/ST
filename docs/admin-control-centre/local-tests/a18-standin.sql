-- LOCAL STAND-INS ONLY (never run on Supabase). Just enough tables for sql/admin/a18-subscriptions.sql on a scratch Postgres.
-- The column names here are GUESSES that follow ARCHITECTURE.md B5 and js/my-subscription.js; the real ones were not available (docs/subscription/ missing).
drop schema public cascade; create schema public;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
-- permissions come from a comma list so a test can hold several at once
create function public.admin_has(p text) returns boolean language sql stable as $$ select p = any (string_to_array(coalesce(current_setting('app.perm', true), ''), ',')) $$;
create table public.users (id uuid primary key, name text, email text);
create table public.subscription_plans (plan text primary key, name text, price_kobo bigint, offers_per_month int, listing_limit int, membership_label text, is_active boolean);
create table public.subscriptions (user_id uuid primary key, plan text, tier int, status text, current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean default false, pending_plan text, created_at timestamptz default now());
create table public.subscription_receipts (id uuid primary key default gen_random_uuid(), user_id uuid, receipt_number text, reference text, plan_name text, kind text, price_kobo bigint, credit_kobo bigint, amount_kobo bigint, period_start timestamptz, period_end timestamptz, paid_at timestamptz);
create table public.payment_intents (id uuid primary key default gen_random_uuid(), user_id uuid, reference text, purpose text, status text, amount numeric, paid_at timestamptz, created_at timestamptz default now());
create table public.subscription_events (id uuid primary key default gen_random_uuid(), user_id uuid, kind text, from_plan text, to_plan text, note text, actor_id uuid, created_at timestamptz default now());
create table public.subscription_admin_log (id uuid primary key default gen_random_uuid(), admin_id uuid, action text, target_user_id uuid, target_plan text, old_value text, new_value text, reason text, approval_id uuid, created_at timestamptz default now());
create table public.subscription_card_authorizations (id uuid primary key default gen_random_uuid(), user_id uuid, card_last4 text, authorization_code text);

insert into public.users values
 ('00000000-0000-0000-0000-000000000001','Ada Okoro','ada@example.com'), ('00000000-0000-0000-0000-000000000002','Bola Ade','bola@example.com'),
 ('00000000-0000-0000-0000-000000000003','Chi Nwosu','chi@example.com'), ('00000000-0000-0000-0000-000000000004','Dayo Bello','dayo@example.com'),
 ('00000000-0000-0000-0000-000000000005','Emeka Eze','emeka@example.com'), ('00000000-0000-0000-0000-000000000006','Funmi Ola','funmi@example.com');
insert into public.subscription_plans values ('pro','Pro',300000,20,10,'PRO',true),('premium','Premium',700000,50,30,'PREMIUM',true),('legacy','Legacy',100000,5,3,null,false);
insert into public.subscriptions (user_id, plan, tier, status, current_period_start, current_period_end, cancel_at_period_end, pending_plan) values
 ('00000000-0000-0000-0000-000000000001','pro',1,'active', now()-interval '27 days', now()+interval '3 days', true, null),
 ('00000000-0000-0000-0000-000000000002','premium',2,'active', now()-interval '10 days', now()+interval '20 days', false, 'pro'),
 ('00000000-0000-0000-0000-000000000003','pro',1,'past_due', now()-interval '31 days', now()-interval '1 day', false, null),
 ('00000000-0000-0000-0000-000000000005','pro',1,'expired', now()-interval '60 days', now()-interval '30 days', false, null),
 ('00000000-0000-0000-0000-000000000006','legacy',0,'cancelled', now()-interval '90 days', now()-interval '60 days', false, null);
-- paid_at values sit inside the current Lagos month so "revenue this month" is stable whenever the test runs
insert into public.subscription_receipts (user_id, receipt_number, reference, plan_name, kind, price_kobo, credit_kobo, amount_kobo, paid_at) values
 ('00000000-0000-0000-0000-000000000001','RC-1','PAY-1','Pro','payment',300000,0,300000,(date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') + interval '1 minute'),
 ('00000000-0000-0000-0000-000000000002','RC-2','PAY-2','Premium','payment',700000,0,700000,(date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') + interval '2 minutes'),
 ('00000000-0000-0000-0000-000000000001','RC-3','PAY-3','Pro','payment',300000,0,300000,(date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') - interval '5 days'),
 ('00000000-0000-0000-0000-000000000004','RC-4','PAY-4','Pro','payment',300000,0,300000,(date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') + interval '3 minutes'),
 ('00000000-0000-0000-0000-000000000003','RC-5','PAY-5','Pro','payment',300000,0,300000,null);
insert into public.payment_intents (user_id, reference, purpose, status, amount, paid_at, created_at) values
 ('00000000-0000-0000-0000-000000000001','PAY-1','subscription','paid',3000, now()-interval '2 days', now()-interval '2 days'),
 ('00000000-0000-0000-0000-000000000002','PAY-2','subscription','paid',7000, now()-interval '2 days', now()-interval '2 days'),
 ('00000000-0000-0000-0000-000000000001','PAY-3','subscription','paid',3000, now()-interval '40 days', now()-interval '40 days'),
 ('00000000-0000-0000-0000-000000000004','PAY-4','subscription','paid',3000, now()-interval '1 day', now()-interval '1 day'),
 ('00000000-0000-0000-0000-000000000005','PAY-9','subscription','paid',3000, now()-interval '5 hours', now()-interval '5 hours'),       -- paid, NO receipt
 ('00000000-0000-0000-0000-000000000003','PAY-7','subscription','failed',3000, null, now()-interval '3 hours'),
 ('00000000-0000-0000-0000-000000000003','PAY-8','subscription','pending',3000, null, now()-interval '2 days'),
 ('00000000-0000-0000-0000-000000000001','JOB-1','booking','paid',20000, now()-interval '1 day', now()-interval '1 day'),             -- not a subscription
 ('00000000-0000-0000-0000-000000000001','TU-1','tier_upgrade','paid',5000, now()-interval '1 day', now()-interval '1 day');          -- coordinator plan, not here
insert into public.subscription_events (user_id, kind, from_plan, to_plan, note, created_at) values
 ('00000000-0000-0000-0000-000000000001','payment_applied',null,'pro','Paid and activated.', now()-interval '27 days'),
 ('00000000-0000-0000-0000-000000000001','renewal_notice_sent','pro',null, repeat('x', 500), now()-interval '5 days'),
 ('00000000-0000-0000-0000-000000000001','payment_applied','pro','pro','Paid again.', now()-interval '2 days'),
 ('00000000-0000-0000-0000-000000000002','payment_applied',null,'premium','Paid and activated.', now()-interval '10 days');
insert into public.subscription_admin_log (admin_id, action, target_user_id, target_plan, old_value, new_value, reason, approval_id, created_at) values
 (gen_random_uuid(),'override','00000000-0000-0000-0000-000000000001','pro','free','pro','Goodwill after a failed payment on the platform side.', gen_random_uuid(), now()-interval '6 days'),
 (gen_random_uuid(),'adjustment_recorded','00000000-0000-0000-0000-000000000002',null,null,null,'Customer asked for a refund; refund made in Paystack.', null, now()-interval '4 days');
insert into public.subscription_card_authorizations (user_id, card_last4, authorization_code) values
 ('00000000-0000-0000-0000-000000000001','4081','AUTH_SECRET_123'),('00000000-0000-0000-0000-000000000002','4081','AUTH_SECRET_456');

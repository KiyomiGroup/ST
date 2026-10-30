-- SCRATCH ONLY (stage 7A part 2). Loaded AFTER docs/local-tasker/tests/stage-5d3b/scratch-scaffold.sql (not repeated here).
-- Replaces the two thin money tables with the REAL columns from the owner's CSV query 31, and adds the few helpers the real functions call.
drop table public.payment_intents cascade; drop table public.escrow_payments cascade;
create table public.payment_intents (id uuid primary key default gen_random_uuid(), reference text, user_id uuid, purpose text, request_id uuid, booking_id uuid, amount numeric,
  platform_fee numeric default 0, tasker_amount numeric default 0, tasker_user_id uuid, status text default 'pending', provider_ref text, result jsonb, created_at timestamptz default now(), paid_at timestamptz);
create table public.escrow_payments (id uuid primary key default gen_random_uuid(), booking_id uuid, payment_id uuid, customer_id uuid, tasker_id uuid, amount numeric, tasker_amount numeric,
  platform_fee numeric, reference text, status text default 'held', paid_at timestamptz default now(), released_at timestamptz, created_at timestamptz default now());
create table public.wallets (user_id uuid primary key, balance numeric not null default 0, pending_balance numeric not null default 0, updated_at timestamptz);
create table public.wallet_transactions (id uuid primary key default gen_random_uuid(), user_id uuid, type text, amount numeric, reference text, booking_id uuid, status text, note text, created_at timestamptz default now());
create function public._ensure_wallet(p_user uuid) returns void language sql as $$ insert into public.wallets (user_id) values (p_user) on conflict do nothing $$;
create function public._assert_booking_not_frozen(p_booking uuid) returns void language sql as $$ select 1 $$;
create function public._link_thread_booking(p_thread uuid) returns void language sql as $$ select 1 $$;
create table public.tasks (id uuid primary key default gen_random_uuid(), budget numeric, category text);
create table public.local_tasker_profiles (tasker_user_id uuid primary key references auth.users(id), full_name text not null, phone text not null, status text not null default 'draft');
create function public.platform_fee_rate() returns numeric language sql immutable as $$ select 0.12::numeric $$;

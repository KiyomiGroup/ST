-- =====================================================================
-- W2a: withdrawal tables, saved bank accounts, fee, limits, RLS, ledger allowances
-- Additive and safe to run twice. Rollback: w2a-rollback.sql. Self-test: w2a-tests.sql.
-- Run in: Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- Touches NO existing row. Does not change RLS or grants on wallets, wallet_transactions,
-- escrow_payments, payments or payment_intents.
-- Needs sql/messaging-step6a.sql to have been run already (it has been).
-- =====================================================================
begin;

-- 0. Pre-flight --------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['wallets', 'wallet_transactions', 'notifications']) as t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Missing tables: %. Nothing was changed. Run sql/messaging-step6a.sql first.', missing;
  end if;
  if to_regprocedure('public._ensure_wallet(uuid)') is null
     or to_regprocedure('public._notify(uuid,text,text,text,jsonb)') is null then
    raise exception 'Missing helper functions _ensure_wallet / _notify. Nothing was changed. Run sql/messaging-step6a.sql first.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'W2a: role service_role was not found, so its grants are skipped.';
  end if;
end $$;

-- 1. The ONE place for limits and the ONE place for the fee --------------
-- Change a number here (create or replace) and every later function and the popup follow.
create or replace function public.withdrawal_limits() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'min_amount',                 500,        -- NGN, per withdrawal
    'max_amount',                 500000,     -- NGN, per withdrawal
    'daily_max',                  1000000,    -- NGN, rolling 24 hours (pending + processing + success)
    'max_saved_accounts',         3,          -- saved bank accounts per tasker
    'new_account_cooldown_hours', 0           -- 0 = a newly saved account can be paid at once. Set e.g. 24 to
                                              -- block payouts to an account saved less than 24h ago.
  )
$$;

-- Fee the TASKER pays, taken from the withdrawal. Charged on the gross amount typed.
-- Source: PAYSTACK-FACTS.md facts 4 and 5 (confirmed 2026-11-01): Paystack fee 10 / 25 / 50
-- plus a flat 50 stamp duty from 10,000 up. Update here if Paystack changes its prices.
create or replace function public.withdrawal_fee(p_amount numeric) returns numeric
language plpgsql immutable as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be more than zero' using errcode = '22023';
  end if;
  if p_amount <= 5000 then return 10;
  elsif p_amount < 10000 then return 25;
  elsif p_amount <= 50000 then return 75;      -- 25 fee + 50 stamp duty
  else return 100;                             -- 50 fee + 50 stamp duty
  end if;
end $$;

-- 2. Saved bank accounts (the tasker's payout destinations) -----------------
-- Nobody but our server functions writes here. The browser may read a safe subset (see section 5).
create table if not exists public.withdrawal_bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  bank_code      text not null,
  bank_name      text not null,
  account_number text not null,
  account_name   text not null,                     -- the name PAYSTACK resolved, never typed text
  recipient_code text,                              -- Paystack RCP_..., filled at the first payout, then reused
  is_default     boolean not null default false,
  verified_at    timestamptz not null default now(),
  last_used_at   timestamptz,
  removed_at     timestamptz,                       -- soft delete: old withdrawals keep pointing at the row
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint wba_account_number_ok check (account_number ~ '^[0-9]{10}$'),
  constraint wba_bank_code_ok      check (bank_code ~ '^[0-9A-Za-z_-]{1,20}$'),
  constraint wba_names_ok          check (length(btrim(bank_name)) > 0 and length(btrim(account_name)) > 0),
  constraint wba_default_active    check (not (is_default and removed_at is not null))
);
alter table public.withdrawal_bank_accounts
  add column if not exists account_last4 text generated always as (right(account_number, 4)) stored;

-- one live row per user + bank + number; at most one default per user
create unique index if not exists wba_unique_active
  on public.withdrawal_bank_accounts (user_id, bank_code, account_number) where removed_at is null;
create unique index if not exists wba_one_default
  on public.withdrawal_bank_accounts (user_id) where is_default and removed_at is null;
create index if not exists wba_user_idx on public.withdrawal_bank_accounts (user_id, created_at);

-- 3. Withdrawals ------------------------------------------------------------
create table if not exists public.withdrawals (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  reference             text not null,
  amount                numeric not null,           -- gross: what the wallet was debited
  fee                   numeric not null default 0, -- paid by the tasker, kept inside amount
  net_amount            numeric not null,           -- amount - fee: what Paystack is told to send
  status                text not null default 'pending',
  bank_account_id       uuid references public.withdrawal_bank_accounts(id) on delete set null,
  bank_code             text not null,              -- snapshot of the destination at request time
  bank_name             text not null,
  account_number        text not null,
  account_name          text not null,
  recipient_code        text,
  paystack_transfer_code text,
  failure_reason        text,                       -- raw reason for us; the user sees the friendly ledger note
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  settled_at            timestamptz,
  constraint withdrawals_reference_key unique (reference),
  constraint withdrawals_status_ok     check (status in ('pending', 'processing', 'success', 'failed', 'reversed')),
  constraint withdrawals_reference_ok  check (reference ~ '^wd-[0-9a-f]{32}$'),
  constraint withdrawals_amount_ok     check (amount > 0 and amount = trunc(amount)),
  constraint withdrawals_fee_ok        check (fee >= 0),
  constraint withdrawals_net_ok        check (net_amount > 0 and net_amount = amount - fee),
  constraint withdrawals_account_ok    check (account_number ~ '^[0-9]{10}$')
);
alter table public.withdrawals
  add column if not exists account_last4 text generated always as (right(account_number, 4)) stored;

create index if not exists withdrawals_user_created_idx on public.withdrawals (user_id, created_at desc);
-- the database itself refuses a second open withdrawal for one user (also stops double taps)
create unique index if not exists withdrawals_one_open
  on public.withdrawals (user_id) where status in ('pending', 'processing');
create index if not exists withdrawals_open_age_idx
  on public.withdrawals (created_at) where status in ('pending', 'processing');
create unique index if not exists withdrawals_transfer_code_key
  on public.withdrawals (paystack_transfer_code) where paystack_transfer_code is not null;

-- 4. Triggers: money and destination fields can never be edited after creation -----
create or replace function public._withdrawal_before_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.user_id is distinct from OLD.user_id
     or NEW.reference is distinct from OLD.reference
     or NEW.amount is distinct from OLD.amount
     or NEW.fee is distinct from OLD.fee
     or NEW.net_amount is distinct from OLD.net_amount
     or NEW.bank_code is distinct from OLD.bank_code
     or NEW.account_number is distinct from OLD.account_number
     or NEW.account_name is distinct from OLD.account_name then
    raise exception 'Withdrawal amount and destination cannot be changed' using errcode = '42501';
  end if;
  NEW.updated_at := clock_timestamp();
  return NEW;
end $$;
drop trigger if exists withdrawals_before_update on public.withdrawals;
create trigger withdrawals_before_update before update on public.withdrawals
  for each row execute function public._withdrawal_before_update();

create or replace function public._wba_before_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.user_id is distinct from OLD.user_id
     or NEW.bank_code is distinct from OLD.bank_code
     or NEW.account_number is distinct from OLD.account_number
     or NEW.account_name is distinct from OLD.account_name then
    raise exception 'A saved bank account cannot be edited; remove it and add a new one' using errcode = '42501';
  end if;
  NEW.updated_at := clock_timestamp();
  return NEW;
end $$;
drop trigger if exists wba_before_update on public.withdrawal_bank_accounts;
create trigger wba_before_update before update on public.withdrawal_bank_accounts
  for each row execute function public._wba_before_update();

-- 5. Row level security and grants ---------------------------------------------
-- Users: read their OWN rows, and only the safe columns. The full account number, the Paystack
-- recipient / transfer codes and the raw failure reason are never readable from the browser.
-- NOTE for the front end: `select *` on these two tables is refused; list the columns.
alter table public.withdrawals              enable row level security;
alter table public.withdrawal_bank_accounts enable row level security;

do $$
declare t text; p record;
begin
  foreach t in array array['withdrawals', 'withdrawal_bank_accounts'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

create policy withdrawals_select_own on public.withdrawals
  for select to authenticated using (user_id = auth.uid());
create policy wba_select_own on public.withdrawal_bank_accounts
  for select to authenticated using (user_id = auth.uid() and removed_at is null);

revoke all on public.withdrawals              from public, anon, authenticated;
revoke all on public.withdrawal_bank_accounts from public, anon, authenticated;

grant select (id, user_id, reference, amount, fee, net_amount, status, bank_account_id, bank_code,
              bank_name, account_name, account_last4, created_at, updated_at, settled_at)
  on public.withdrawals to authenticated;
grant select (id, user_id, bank_code, bank_name, account_name, account_last4, is_default,
              verified_at, last_used_at, removed_at, created_at, updated_at)
  on public.withdrawal_bank_accounts to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    -- server code READS directly and WRITES only through the SECURITY DEFINER functions of W2b to W2d
    execute 'revoke all on public.withdrawals from service_role';
    execute 'revoke all on public.withdrawal_bank_accounts from service_role';
    execute 'grant select on public.withdrawals to service_role';
    execute 'grant select on public.withdrawal_bank_accounts to service_role';
  end if;
end $$;

-- 6. Who may call the two helpers (constants only, nothing secret) ----------------
revoke all on function public.withdrawal_limits()        from public, anon, authenticated;
revoke all on function public.withdrawal_fee(numeric)    from public, anon, authenticated;
grant execute on function public.withdrawal_limits()     to authenticated;
grant execute on function public.withdrawal_fee(numeric) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.withdrawal_limits() to service_role';
    execute 'grant execute on function public.withdrawal_fee(numeric) to service_role';
  end if;
end $$;
revoke all on function public._withdrawal_before_update() from public, anon, authenticated;
revoke all on function public._wba_before_update()        from public, anon, authenticated;

-- 7. Ledger allowances (wallet_transactions and notifications) ------------------------
-- We do not know which CHECK constraints the LIVE tables carry, so we TEST by trying the new
-- values inside a throw-away step. Only a CHECK that really refuses a new value is dropped
-- (and its definition is printed in the Results/Messages area so it can be re-added).
do $$
declare
  v_user uuid; p record; v_try int; v_con text; v_def text; v_state text;
begin
  select user_id into v_user from public.wallets limit 1;
  v_user := coalesce(v_user, gen_random_uuid());

  for p in
    select * from (values
      ('wallet_transactions',
       format('insert into public.wallet_transactions (user_id, type, amount, reference, status, note) values
                 (%1$L, ''withdrawal_refund'', 1, ''probe-1'', ''pending'',    ''probe''),
                 (%1$L, ''withdrawal'',        1, ''probe-2'', ''processing'', ''probe''),
                 (%1$L, ''withdrawal'',        1, ''probe-3'', ''completed'',  ''probe''),
                 (%1$L, ''withdrawal'',        1, ''probe-4'', ''failed'',     ''probe'')', v_user)),
      ('notifications',
       format('insert into public.notifications (user_id, type, title, message, data, is_read) values
                 (%1$L, ''withdrawal_update'', ''probe'', ''probe'', ''{}'', false),
                 (%1$L, ''bank_account'',      ''probe'', ''probe'', ''{}'', false)', v_user))
    ) as x(tbl, stmt)
  loop
    for v_try in 1..8 loop
      begin
        execute p.stmt;
        raise exception 'w2a_probe_ok';
      exception when others then
        v_state := sqlstate;
        if sqlerrm = 'w2a_probe_ok' then
          exit;                                   -- the new values are accepted; the probe rows were undone
        end if;
        get stacked diagnostics v_con = constraint_name;
        if v_state = '23514' and v_con is not null then
          select pg_get_constraintdef(c.oid) into v_def
            from pg_constraint c where c.conname = v_con and c.conrelid = to_regclass('public.' || p.tbl);
          execute format('alter table public.%I drop constraint %I', p.tbl, v_con);
          raise notice 'W2a: dropped CHECK % on % because it refused a new value. It was: %', v_con, p.tbl, v_def;
        else
          raise notice 'W2a: could not test % (SQLSTATE %, %). Run section A of w2a-tests.sql and tell the developer.',
            p.tbl, v_state, sqlerrm;
          exit;
        end if;
      end;
    end loop;
  end loop;
end $$;

-- Database-level "once" guards. Refund ledger rows use reference = <withdrawal reference> || '-refund'.
create unique index if not exists wallet_tx_withdrawal_once
  on public.wallet_transactions (reference)
  where type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$';
create unique index if not exists wallet_tx_withdrawal_refund_once
  on public.wallet_transactions (reference)
  where type = 'withdrawal_refund';

commit;

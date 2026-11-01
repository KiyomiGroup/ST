-- =====================================================================
-- W2b: withdrawal_create(p_user, p_amount, p_bank_account_id)
-- Additive and safe to run twice. Rollback: w2b-rollback.sql. Self-test: w2b-tests.sql.
-- Run in: Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- Needs w2a-tables.sql to have been run first.
-- Touches NO existing row and creates NO table. Nothing calls this function yet (the Edge Function
-- that will call it is built in W3b), so running it changes nothing for your users.
-- Does not change RLS or grants on wallets, wallet_transactions, escrow_payments, payments or payment_intents.
--
-- WHAT IT DOES (one transaction, all or nothing):
--   1. checks the user is a tasker, the amount is a whole positive naira number, and within min / max
--   2. locks the user's wallet (nobody else can move this wallet until we finish)
--   3. loads the SAVED bank account (must be this user's, not removed, past the cooldown)
--   4. refuses if another withdrawal is already open, if the 24h limit would be passed, or if the balance is short
--   5. debits the FULL amount from wallets.balance, ONCE
--   6. writes the withdrawals row (status pending, fee from withdrawal_fee) and the wallet_transactions row
--   7. returns the reference (wd- + 32 hex), fee and net amount
-- Refusals are raised as errors with their own SQLSTATE (table in the W2b handoff), so a refusal can
-- never leave a half-done debit behind.
-- =====================================================================
begin;

-- 0. Pre-flight --------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['wallets', 'wallet_transactions', 'notifications', 'taskers',
                    'withdrawals', 'withdrawal_bank_accounts']) as t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Missing tables: %. Nothing was changed. Run sql/withdrawals/w2a-tables.sql first (and sql/messaging-step6a.sql before it).', missing;
  end if;
  if to_regprocedure('public.withdrawal_fee(numeric)') is null
     or to_regprocedure('public.withdrawal_limits()') is null
     or to_regprocedure('public._ensure_wallet(uuid)') is null then
    raise exception 'Missing functions withdrawal_fee / withdrawal_limits / _ensure_wallet. Nothing was changed. Run sql/withdrawals/w2a-tables.sql first.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'W2b: role service_role was not found, so its grant is skipped.';
  end if;
end $$;

-- 1. The function ---------------------------------------------------------
-- SQLSTATE map (the Edge Function in W3b turns these into user messages; the message text is already plain English):
--   WD001 only taskers            WD002 amount not a whole positive naira number   WD003 below minimum
--   WD004 above maximum           WD005 daily limit                                WD006 balance too low
--   WD007 withdrawal in progress  WD008 saved account missing / removed / not yours  WD009 account inside cooldown
--   WD010 bad call (null user or account)
create or replace function public.withdrawal_create(p_user uuid, p_amount numeric, p_bank_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lim      jsonb := public.withdrawal_limits();
  v_min      numeric := (v_lim ->> 'min_amount')::numeric;
  v_max      numeric := (v_lim ->> 'max_amount')::numeric;
  v_daily    numeric := (v_lim ->> 'daily_max')::numeric;
  v_cool     numeric := coalesce((v_lim ->> 'new_account_cooldown_hours')::numeric, 0);
  v_wallet   public.wallets;
  v_acct     public.withdrawal_bank_accounts;
  v_used     numeric;
  v_left     numeric;
  v_fee      numeric;
  v_ref      text;
  v_wid      uuid;
  v_hours    numeric;
  v_balance  numeric;
begin
  -- a. who and what -------------------------------------------------------
  if p_user is null or p_bank_account_id is null then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WD010';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then
    raise exception 'Enter a whole naira amount greater than zero.' using errcode = 'WD002';
  end if;
  if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then
    raise exception 'Only taskers can withdraw money.' using errcode = 'WD001';
  end if;
  if p_amount < v_min then
    raise exception 'The minimum withdrawal is ₦%.', to_char(v_min, 'FM999,999,999') using errcode = 'WD003';
  end if;
  if p_amount > v_max then
    raise exception 'The most you can withdraw at once is ₦%.', to_char(v_max, 'FM999,999,999') using errcode = 'WD004';
  end if;

  -- b. lock the wallet. Everything below is serialised per user: a second caller waits here. ---
  perform public._ensure_wallet(p_user);
  select * into v_wallet from public.wallets where user_id = p_user for update;

  -- c. the saved account (same message for missing, removed and someone else's: no probing) ----
  select * into v_acct from public.withdrawal_bank_accounts
   where id = p_bank_account_id and user_id = p_user and removed_at is null
   for share;                                   -- a remove (W2d) must wait for us, then sees the open withdrawal
  if not found then
    raise exception 'That bank account is not available. Choose another or add a bank account.' using errcode = 'WD008';
  end if;
  if v_cool > 0 and v_acct.created_at + (v_cool * interval '1 hour') > now() then
    v_hours := ceil(extract(epoch from (v_acct.created_at + (v_cool * interval '1 hour') - now())) / 3600);
    raise exception 'This bank account was added recently. For your safety you can withdraw to it in about % hour(s).', v_hours
      using errcode = 'WD009';
  end if;

  -- d. one open withdrawal at a time --------------------------------------------
  if exists (select 1 from public.withdrawals w
              where w.user_id = p_user and w.status in ('pending', 'processing')) then
    raise exception 'You already have a withdrawal in progress. Please wait until it finishes.' using errcode = 'WD007';
  end if;

  -- e. rolling 24 hours (pending + processing + success; NOT failed or reversed) --------
  select coalesce(sum(w.amount), 0) into v_used
    from public.withdrawals w
   where w.user_id = p_user
     and w.status in ('pending', 'processing', 'success')
     and w.created_at > now() - interval '24 hours';
  if v_used + p_amount > v_daily then
    v_left := greatest(0, v_daily - v_used);
    if v_left < v_min then
      raise exception 'You have reached the daily withdrawal limit of ₦%. Please try again later.',
        to_char(v_daily, 'FM999,999,999') using errcode = 'WD005';
    end if;
    raise exception 'This would go over the daily limit of ₦%. You can withdraw up to ₦% more in the next 24 hours.',
      to_char(v_daily, 'FM999,999,999'), to_char(v_left, 'FM999,999,999') using errcode = 'WD005';
  end if;

  -- f. balance (re-read under the lock) ----------------------------------------------
  if v_wallet.balance < p_amount then
    raise exception 'Your available balance is not enough for this withdrawal.' using errcode = 'WD006';
  end if;

  -- g. fee. It is kept inside the amount: the wallet loses p_amount, Paystack is later sent p_amount - fee. ---
  v_fee := public.withdrawal_fee(p_amount);
  if v_fee >= p_amount then
    raise exception 'Enter a whole naira amount greater than zero.' using errcode = 'WD002';
  end if;

  -- h. debit ONCE, then write the two records --------------------------------------------
  update public.wallets
     set balance = balance - p_amount, updated_at = now()
   where user_id = p_user
  returning balance into v_balance;

  v_ref := 'wd-' || replace(gen_random_uuid()::text, '-', '');

  begin
    insert into public.withdrawals
      (user_id, reference, amount, fee, net_amount, status, bank_account_id,
       bank_code, bank_name, account_number, account_name)
    values
      (p_user, v_ref, p_amount, v_fee, p_amount - v_fee, 'pending', v_acct.id,
       v_acct.bank_code, v_acct.bank_name, v_acct.account_number, v_acct.account_name)
    returning id into v_wid;
  exception when unique_violation then
    -- the database's own guard (withdrawals_one_open) fired: undo everything, including the debit
    raise exception 'You already have a withdrawal in progress. Please wait until it finishes.' using errcode = 'WD007';
  end;

  insert into public.wallet_transactions (user_id, type, amount, reference, status, note)
  values (p_user, 'withdrawal', p_amount, v_ref, 'pending',
          '₦' || to_char(p_amount, 'FM999,999,999') || ' withdrawal to ' || v_acct.bank_name
          || ' ••••' || right(v_acct.account_number, 4)
          || ' (fee ₦' || to_char(v_fee, 'FM999,999,999') || ', you receive ₦'
          || to_char(p_amount - v_fee, 'FM999,999,999') || ')');

  update public.withdrawal_bank_accounts set last_used_at = now() where id = v_acct.id;

  -- i. result. No full account number here: the Edge Function reads it from the table with the service role. ---
  return jsonb_build_object(
    'withdrawal_id',   v_wid,
    'reference',       v_ref,
    'status',          'pending',
    'amount',          p_amount,
    'fee',             v_fee,
    'net_amount',      p_amount - v_fee,
    'bank_account_id', v_acct.id,
    'bank_code',       v_acct.bank_code,
    'bank_name',       v_acct.bank_name,
    'account_name',    v_acct.account_name,
    'account_last4',   right(v_acct.account_number, 4),
    'balance_after',   v_balance
  );
end $$;

-- 2. Who may call it: the server (service role) ONLY -------------------------------
revoke all on function public.withdrawal_create(uuid, numeric, uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.withdrawal_create(uuid, numeric, uuid) to service_role';
  end if;
end $$;

commit;

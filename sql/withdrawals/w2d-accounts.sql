-- =====================================================================
-- W2d: saved bank account functions (CR-1)
--   bank_account_add, bank_account_set_default, bank_account_remove, bank_account_set_recipient
-- Additive and safe to run twice. Rollback: w2d-rollback.sql. Self-test: w2d-tests.sql.
-- Run in: Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- Needs w2a-tables.sql to have been run first (and messaging-step6a.sql before it).
-- Touches NO existing row and creates NO table. Nothing calls these functions yet (the Edge Function
-- that will call them is built in W3c), so running this file changes nothing for your users.
-- Does not change RLS or grants on wallets, wallet_transactions, escrow_payments, payments or payment_intents.
--
-- WHO CAN CALL THEM: the server (service role) ONLY. The browser can never call them.
-- All four re-check that the user is a tasker. None of them moves money.
--
-- SQLSTATE map (the Edge Function in W3c passes the message through to the user ONLY when the code starts
-- with "WA"; the message text is already plain English and never contains an account number):
--   WA001 not a tasker                       WA002 bad call (a required value is missing)
--   WA003 bad input (bank, number, name)     WA004 already at the maximum number of saved accounts
--   WA005 account not found / removed / not the user's (one message for all three)
--   WA006 account is used by an open withdrawal (pending or processing): cannot be removed yet
--   WA007 bad recipient code
--
-- LOCK ORDER (same as W2b, so nothing can deadlock): (1) the wallet (advisory lock via _ensure_wallet, then
-- the wallets row FOR UPDATE), (2) the user's saved-account rows FOR UPDATE, (3) the withdrawals rows.
-- A tasker check always happens BEFORE the lock, so a customer never gets a wallet created.
-- =====================================================================
begin;

-- 0. Pre-flight --------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['wallets', 'notifications', 'taskers', 'withdrawals', 'withdrawal_bank_accounts']) as t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Missing tables: %. Nothing was changed. Run sql/withdrawals/w2a-tables.sql first (and sql/messaging-step6a.sql before it).', missing;
  end if;
  if to_regprocedure('public.withdrawal_limits()') is null
     or to_regprocedure('public._ensure_wallet(uuid)') is null
     or to_regprocedure('public._notify(uuid,text,text,text,jsonb)') is null then
    raise exception 'Missing functions withdrawal_limits / _ensure_wallet / _notify. Nothing was changed. Run sql/withdrawals/w2a-tables.sql first.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'W2d: role service_role was not found, so its grants are skipped.';
  end if;
end $$;

-- 1. bank_account_add ----------------------------------------------------------
-- Saves a bank account the Edge Function has ALREADY verified with Paystack: p_account_name must be the name
-- Paystack resolved, never text typed by the user (W3c guarantees this; this function cannot check it).
--  * same live bank + number again: returns the existing row, changes nothing, sends no notification
--  * the first live account becomes the default
--  * the limit comes from withdrawal_limits()->>'max_saved_accounts'
-- Result: { id, bank_code, bank_name, account_name, account_last4, is_default, already_saved }
-- The full account number and the recipient code are NEVER in a result.
create or replace function public.bank_account_add(
  p_user uuid, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_max     int := coalesce((public.withdrawal_limits() ->> 'max_saved_accounts')::int, 3);
  v_code    text := btrim(p_bank_code);
  v_bank    text := btrim(p_bank_name);
  v_num     text := btrim(p_account_number);
  v_name    text := btrim(p_account_name);
  v_acct    public.withdrawal_bank_accounts;
  v_live    int;
  v_dup     boolean := false;
begin
  -- a. who and what ------------------------------------------------------------
  if p_user is null or p_bank_code is null or p_bank_name is null or p_account_number is null or p_account_name is null then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WA002';
  end if;
  if v_code !~ '^[0-9A-Za-z_-]{1,20}$' then
    raise exception 'Choose a bank from the list.' using errcode = 'WA003';
  end if;
  if v_bank = '' or length(v_bank) > 200 then
    raise exception 'Choose a bank from the list.' using errcode = 'WA003';
  end if;
  if v_num !~ '^[0-9]{10}$' then
    raise exception 'Enter a valid 10-digit account number.' using errcode = 'WA003';
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'The account name could not be confirmed. Please check the details and try again.' using errcode = 'WA003';
  end if;
  if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then
    raise exception 'Only taskers can save bank accounts.' using errcode = 'WA001';
  end if;

  -- b. lock the wallet first (same order as withdrawal_create), then work on the account rows -----------
  perform public._ensure_wallet(p_user);
  perform 1 from public.wallets w where w.user_id = p_user for update;

  -- c. the same live account again: hand back the one we have --------------------------------------------
  select * into v_acct from public.withdrawal_bank_accounts a
   where a.user_id = p_user and a.bank_code = v_code and a.account_number = v_num and a.removed_at is null
   for update;
  if found then
    return jsonb_build_object(
      'id', v_acct.id, 'bank_code', v_acct.bank_code, 'bank_name', v_acct.bank_name,
      'account_name', v_acct.account_name, 'account_last4', right(v_acct.account_number, 4),
      'is_default', v_acct.is_default, 'already_saved', true);
  end if;

  -- d. the limit -------------------------------------------------------------------------------------------
  select count(*) into v_live from public.withdrawal_bank_accounts a where a.user_id = p_user and a.removed_at is null;
  if v_live >= v_max then
    raise exception 'You can save up to % bank accounts. Remove one before adding another.', v_max using errcode = 'WA004';
  end if;

  -- e. save it (the first live account becomes the default) -----------------------------------------------------
  begin
    insert into public.withdrawal_bank_accounts (user_id, bank_code, bank_name, account_number, account_name, is_default)
    values (p_user, v_code, v_bank, v_num, v_name, v_live = 0)
    returning * into v_acct;
  exception when unique_violation then
    -- the database's own guard fired (cannot normally happen under the lock): hand back the existing account
    select * into v_acct from public.withdrawal_bank_accounts a
     where a.user_id = p_user and a.bank_code = v_code and a.account_number = v_num and a.removed_at is null;
    if not found then
      raise exception 'Something went wrong. Please try again.' using errcode = 'WA002';
    end if;
    v_dup := true;
  end;

  -- f. tell the tasker (a stolen-session alarm). No account number in the message or the data. -------------------
  if not v_dup then
    perform public._notify(p_user, 'bank_account', '🏦 Bank account added',
      v_acct.bank_name || ' ••••' || right(v_acct.account_number, 4) || ' was added to your saved bank accounts. '
      || 'If this was not you, change your password and contact support right away.',
      jsonb_build_object('action', 'added', 'bank_account_id', v_acct.id, 'bank_name', v_acct.bank_name,
                         'account_last4', right(v_acct.account_number, 4)));
  end if;

  return jsonb_build_object(
    'id', v_acct.id, 'bank_code', v_acct.bank_code, 'bank_name', v_acct.bank_name,
    'account_name', v_acct.account_name, 'account_last4', right(v_acct.account_number, 4),
    'is_default', v_acct.is_default, 'already_saved', v_dup);
end $$;

-- 2. bank_account_set_default ----------------------------------------------------
-- Result: { id, is_default: true, changed }   (changed = false when it already was the default)
create or replace function public.bank_account_set_default(p_user uuid, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_acct public.withdrawal_bank_accounts;
begin
  if p_user is null or p_id is null then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WA002';
  end if;
  if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then
    raise exception 'Only taskers can save bank accounts.' using errcode = 'WA001';
  end if;

  perform public._ensure_wallet(p_user);
  perform 1 from public.wallets w where w.user_id = p_user for update;
  perform 1 from public.withdrawal_bank_accounts a where a.user_id = p_user and a.removed_at is null order by a.id for update;

  select * into v_acct from public.withdrawal_bank_accounts a
   where a.id = p_id and a.user_id = p_user and a.removed_at is null;
  if not found then
    raise exception 'That bank account is not available.' using errcode = 'WA005';
  end if;
  if v_acct.is_default then
    return jsonb_build_object('id', v_acct.id, 'is_default', true, 'changed', false);
  end if;

  -- the old default first, then the new one (the unique index allows only one default at a time)
  update public.withdrawal_bank_accounts set is_default = false
   where user_id = p_user and is_default and removed_at is null;
  update public.withdrawal_bank_accounts set is_default = true where id = v_acct.id;

  return jsonb_build_object('id', v_acct.id, 'is_default', true, 'changed', true);
end $$;

-- 3. bank_account_remove ----------------------------------------------------------
-- Soft delete (the row stays: old withdrawals point at it). Refused (WA006) while a pending or processing
-- withdrawal uses it. If it was the default, the OLDEST remaining live account becomes the default.
-- Removing an account that is already removed is a harmless success (a double tap or a stale page):
-- { removed: false, already_removed: true } and no notification.
-- Result: { id, removed, already_removed, new_default_id }
create or replace function public.bank_account_remove(p_user uuid, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_acct    public.withdrawal_bank_accounts;
  v_next    uuid;
begin
  if p_user is null or p_id is null then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WA002';
  end if;
  if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then
    raise exception 'Only taskers can save bank accounts.' using errcode = 'WA001';
  end if;

  -- (1) wallet, (2) the user's account rows, (3) then look at withdrawals: the same order as withdrawal_create
  perform public._ensure_wallet(p_user);
  perform 1 from public.wallets w where w.user_id = p_user for update;
  perform 1 from public.withdrawal_bank_accounts a where a.user_id = p_user and a.removed_at is null order by a.id for update;

  select * into v_acct from public.withdrawal_bank_accounts a where a.id = p_id and a.user_id = p_user;
  if not found then
    raise exception 'That bank account is not available.' using errcode = 'WA005';
  end if;
  if v_acct.removed_at is not null then
    return jsonb_build_object('id', v_acct.id, 'removed', false, 'already_removed', true, 'new_default_id', null);
  end if;

  if exists (select 1 from public.withdrawals w
              where w.bank_account_id = v_acct.id and w.status in ('pending', 'processing')) then
    raise exception 'This bank account is being used for a withdrawal in progress. You can remove it when that withdrawal finishes.'
      using errcode = 'WA006';
  end if;

  update public.withdrawal_bank_accounts set removed_at = now(), is_default = false where id = v_acct.id;

  if v_acct.is_default then
    select a.id into v_next from public.withdrawal_bank_accounts a
     where a.user_id = p_user and a.removed_at is null
     order by a.created_at, a.id limit 1;
    if v_next is not null then
      update public.withdrawal_bank_accounts set is_default = true where id = v_next;
    end if;
  end if;

  perform public._notify(p_user, 'bank_account', '🏦 Bank account removed',
    v_acct.bank_name || ' ••••' || right(v_acct.account_number, 4) || ' was removed from your saved bank accounts. '
    || 'If this was not you, change your password and contact support right away.',
    jsonb_build_object('action', 'removed', 'bank_account_id', v_acct.id, 'bank_name', v_acct.bank_name,
                       'account_last4', right(v_acct.account_number, 4)));

  return jsonb_build_object('id', v_acct.id, 'removed', true, 'already_removed', false, 'new_default_id', v_next);
end $$;

-- 4. bank_account_set_recipient --------------------------------------------------------
-- Stores the Paystack recipient code (RCP_...) on a saved account, ONCE: it only fills an empty value.
-- If a code is already stored (even a different one) nothing is overwritten and the stored code is returned,
-- so two requests racing each other end up using the same recipient.
-- Result: { id, applied, recipient_code }   (server only: the code is never sent to the browser)
create or replace function public.bank_account_set_recipient(p_user uuid, p_id uuid, p_recipient_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := btrim(p_recipient_code);
  v_acct public.withdrawal_bank_accounts;
begin
  if p_user is null or p_id is null then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WA002';
  end if;
  if v_code is null or v_code !~ '^[0-9A-Za-z_-]{1,64}$' then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WA007';
  end if;
  if not exists (select 1 from public.taskers t where t.user_id::text = p_user::text) then
    raise exception 'Only taskers can save bank accounts.' using errcode = 'WA001';
  end if;

  perform public._ensure_wallet(p_user);
  perform 1 from public.wallets w where w.user_id = p_user for update;

  select * into v_acct from public.withdrawal_bank_accounts a
   where a.id = p_id and a.user_id = p_user and a.removed_at is null
   for update;
  if not found then
    raise exception 'That bank account is not available.' using errcode = 'WA005';
  end if;

  if coalesce(btrim(v_acct.recipient_code), '') <> '' then
    return jsonb_build_object('id', v_acct.id, 'applied', false, 'recipient_code', v_acct.recipient_code);
  end if;

  update public.withdrawal_bank_accounts set recipient_code = v_code where id = v_acct.id;
  return jsonb_build_object('id', v_acct.id, 'applied', true, 'recipient_code', v_code);
end $$;

-- 5. Who may call them: the server (service role) ONLY ---------------------------------
revoke all on function public.bank_account_add(uuid, text, text, text, text)  from public, anon, authenticated;
revoke all on function public.bank_account_set_default(uuid, uuid)            from public, anon, authenticated;
revoke all on function public.bank_account_remove(uuid, uuid)                 from public, anon, authenticated;
revoke all on function public.bank_account_set_recipient(uuid, uuid, text)    from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.bank_account_add(uuid, text, text, text, text) to service_role';
    execute 'grant execute on function public.bank_account_set_default(uuid, uuid) to service_role';
    execute 'grant execute on function public.bank_account_remove(uuid, uuid) to service_role';
    execute 'grant execute on function public.bank_account_set_recipient(uuid, uuid, text) to service_role';
  end if;
end $$;

commit;

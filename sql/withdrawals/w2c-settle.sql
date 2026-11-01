-- =====================================================================
-- W2c-1: settle functions for withdrawals
--   withdrawal_mark_processing(reference, transfer_code, recipient_code)
--   withdrawal_succeed(reference, transfer_code)
--   withdrawal_fail(reference, status, reason)      status = 'failed' or 'reversed'; refunds exactly once
--   withdrawal_stuck_list(minutes)
-- Additive and safe to run twice. Rollback: w2c-rollback.sql. Self-test: w2c-tests.sql.
-- Run in: Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- Needs w2a-tables.sql and w2b-create.sql to have been run first.
-- Touches NO existing row and creates NO table. Nothing calls these functions yet (the Edge Functions
-- that will call them are built in W3b, W4b and W5), so running this file changes nothing for your users.
-- Does not change RLS or grants on wallets, wallet_transactions, escrow_payments, payments or payment_intents.
--
-- ALLOWED STATE MOVES (anything else is refused, and the refusal is recorded; see the W2c-1 handoff):
--   pending    -> processing   mark_processing
--   pending    -> success      succeed   (the webhook can arrive before we marked it processing)
--   processing -> success      succeed
--   pending    -> failed|reversed     fail   (refund once)
--   processing -> failed|reversed     fail   (refund once)
--   success    -> reversed     fail('reversed')   (the bank sent the money back: refund once)
--   Same move again (duplicate webhook, retry)     -> harmless no-op, no second refund, no second notification
--   failed|reversed -> success                     -> REFUSED (the money was already returned), recorded on the row
--   success -> failed                              -> REFUSED (cannot fail after paying out), recorded on the row
--   failed -> reversed, reversed -> failed         -> no-op (already refunded, nothing more to do)
-- Lock order (same as W2b): wallet (advisory lock, then row FOR UPDATE), then the withdrawals row.
-- Unknown reference: returns {"found": false} and changes nothing (a webhook for something that is not ours gets a 200).
-- =====================================================================
begin;

-- 0. Pre-flight --------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['wallets', 'wallet_transactions', 'notifications', 'withdrawals', 'withdrawal_bank_accounts']) as t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Missing tables: %. Nothing was changed. Run sql/withdrawals/w2a-tables.sql first (and sql/messaging-step6a.sql before it).', missing;
  end if;
  if to_regprocedure('public._ensure_wallet(uuid)') is null
     or to_regprocedure('public._notify(uuid,text,text,text,jsonb)') is null then
    raise exception 'Missing helper functions _ensure_wallet / _notify. Nothing was changed. Run sql/messaging-step6a.sql first.';
  end if;
  if to_regprocedure('public.withdrawal_create(uuid,numeric,uuid)') is null then
    raise exception 'Missing withdrawal_create. Nothing was changed. Run sql/withdrawals/w2b-create.sql first.';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'wallet_tx_withdrawal_refund_once') then
    raise exception 'Missing index wallet_tx_withdrawal_refund_once (made by w2a-tables.sql). Nothing was changed. Run sql/withdrawals/w2a-tables.sql first.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'W2c-1: role service_role was not found, so its grants are skipped.';
  end if;
end $$;

-- 1. Internal helpers (nobody can call these except our own functions) ---------------
-- Turns a Paystack reason into something safe to keep: no run of 10+ digits (could be an account number), max 300 chars.
create or replace function public._withdrawal_clean_reason(p_reason text) returns text
language sql immutable as $$
  select left(regexp_replace(btrim(coalesce(p_reason, '')), '[0-9]{10,}', '**********', 'g'), 300)
$$;

-- Finds the withdrawal and takes the locks in the agreed order: wallet first, then the withdrawals row.
-- Returns an all-null row when the reference is not ours.
create or replace function public._withdrawal_lock(p_reference text) returns public.withdrawals
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_row public.withdrawals;
begin
  select w.user_id into v_user from public.withdrawals w where w.reference = p_reference;   -- user_id can never change (W2a trigger)
  if v_user is null then
    return null;
  end if;
  perform public._ensure_wallet(v_user);
  perform 1 from public.wallets where user_id = v_user for update;
  select * into v_row from public.withdrawals where reference = p_reference for update;     -- re-read under the lock
  return v_row;
end $$;

-- 2. withdrawal_mark_processing ---------------------------------------------------------
-- SQLSTATE: WD013 bad call (null / empty reference)   WD014 transfer code already belongs to another withdrawal
create or replace function public.withdrawal_mark_processing(p_reference text, p_transfer_code text, p_recipient_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref  text := btrim(coalesce(p_reference, ''));
  v_tc   text := nullif(btrim(coalesce(p_transfer_code, '')), '');
  v_rc   text := nullif(btrim(coalesce(p_recipient_code, '')), '');
  v      public.withdrawals;
begin
  if v_ref = '' then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WD013';
  end if;
  v := public._withdrawal_lock(v_ref);
  if v.id is null then
    return jsonb_build_object('ok', false, 'found', false, 'applied', false, 'reason', 'unknown reference');
  end if;

  if v.status = 'pending' then
    begin
      update public.withdrawals
         set status = 'processing',
             paystack_transfer_code = coalesce(paystack_transfer_code, v_tc),
             recipient_code         = coalesce(recipient_code, v_rc)
       where id = v.id;
    exception when unique_violation then
      raise exception 'That transfer code already belongs to another withdrawal.' using errcode = 'WD014';
    end;
    update public.wallet_transactions
       set status = 'processing'
     where reference = v.reference and type = 'withdrawal' and status = 'pending';
    return jsonb_build_object('ok', true, 'found', true, 'applied', true, 'reference', v.reference,
                              'from_status', 'pending', 'status', 'processing');
  elsif v.status = 'processing' then
    -- repeat call: only fill codes that are still empty, never overwrite
    begin
      update public.withdrawals
         set paystack_transfer_code = coalesce(paystack_transfer_code, v_tc),
             recipient_code         = coalesce(recipient_code, v_rc)
       where id = v.id and (paystack_transfer_code is null or recipient_code is null);
    exception when unique_violation then
      raise exception 'That transfer code already belongs to another withdrawal.' using errcode = 'WD014';
    end;
    return jsonb_build_object('ok', true, 'found', true, 'applied', false, 'reference', v.reference,
                              'status', 'processing', 'reason', 'already processing');
  end if;

  -- success / failed / reversed: the webhook or reconcile got there first. Nothing to do, not a problem.
  return jsonb_build_object('ok', true, 'found', true, 'applied', false, 'reference', v.reference,
                            'status', v.status, 'reason', 'already settled');
end $$;

-- 3. withdrawal_succeed -----------------------------------------------------------------
create or replace function public.withdrawal_succeed(p_reference text, p_transfer_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref  text := btrim(coalesce(p_reference, ''));
  v_tc   text := nullif(btrim(coalesce(p_transfer_code, '')), '');
  v      public.withdrawals;
  v_tag  constant text := 'ANOMALY: success reported after the money was already returned to the wallet. Check Paystack by hand.';
begin
  if v_ref = '' then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WD013';
  end if;
  v := public._withdrawal_lock(v_ref);
  if v.id is null then
    return jsonb_build_object('ok', false, 'found', false, 'applied', false, 'reason', 'unknown reference');
  end if;

  if v.status in ('pending', 'processing') then
    begin
      update public.withdrawals
         set status = 'success', settled_at = now(),
             paystack_transfer_code = coalesce(paystack_transfer_code, v_tc)
       where id = v.id;
    exception when unique_violation then
      raise exception 'That transfer code already belongs to another withdrawal.' using errcode = 'WD014';
    end;
    update public.wallet_transactions
       set status = 'completed'
     where reference = v.reference and type = 'withdrawal';
    perform public._notify(v.user_id, 'withdrawal_update', 'Withdrawal sent',
      '₦' || to_char(v.net_amount, 'FM999,999,999') || ' has been sent to ' || v.bank_name || ' ••••' || v.account_last4 || '.',
      jsonb_build_object('reference', v.reference, 'status', 'success', 'amount', v.amount, 'net_amount', v.net_amount));
    return jsonb_build_object('ok', true, 'found', true, 'applied', true, 'reference', v.reference,
                              'from_status', v.status, 'status', 'success');

  elsif v.status = 'success' then
    return jsonb_build_object('ok', true, 'found', true, 'applied', false, 'reference', v.reference,
                              'status', 'success', 'reason', 'already success');

  else  -- failed or reversed: the wallet already got the money back. NEVER move to success.
    update public.withdrawals
       set failure_reason = left(coalesce(failure_reason || ' | ', '') || v_tag, 500)
     where id = v.id and coalesce(failure_reason, '') not like '%ANOMALY: success reported%';
    raise warning 'withdrawal_succeed refused: reference % is % and was already refunded', v.reference, v.status;
    return jsonb_build_object('ok', false, 'found', true, 'applied', false, 'refused', true, 'reference', v.reference,
                              'status', v.status, 'reason', 'already refunded; success refused and recorded');
  end if;
end $$;

-- 4. withdrawal_fail (failed or reversed) ------------------------------------------------
-- The wallet gets the FULL gross amount back (the fee was inside it). One refund ever per withdrawal.
-- SQLSTATE: WD012 status is not 'failed' or 'reversed' (a bug in the caller)
create or replace function public.withdrawal_fail(p_reference text, p_status text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ref     text := btrim(coalesce(p_reference, ''));
  v_status  text := lower(btrim(coalesce(p_status, '')));
  v         public.withdrawals;
  v_reason  text := public._withdrawal_clean_reason(p_reason);
  v_dest    text;
  v_balance numeric;
  v_tag     constant text := 'ANOMALY: failure reported after a successful payout. Check Paystack by hand.';
begin
  if v_ref = '' then
    raise exception 'Something went wrong. Please try again.' using errcode = 'WD013';
  end if;
  if v_status not in ('failed', 'reversed') then
    raise exception 'Status must be failed or reversed.' using errcode = 'WD012';
  end if;
  v := public._withdrawal_lock(v_ref);
  if v.id is null then
    return jsonb_build_object('ok', false, 'found', false, 'applied', false, 'reason', 'unknown reference');
  end if;

  -- already refunded (failed or reversed): duplicate delivery or a late second event. Nothing to do.
  if v.status in ('failed', 'reversed') then
    return jsonb_build_object('ok', true, 'found', true, 'applied', false, 'refunded', false, 'reference', v.reference,
                              'status', v.status, 'reason', 'already refunded');
  end if;

  -- a payout that succeeded can only be reversed, never "failed"
  if v.status = 'success' and v_status <> 'reversed' then
    update public.withdrawals
       set failure_reason = left(coalesce(failure_reason || ' | ', '') || v_tag, 500)
     where id = v.id and coalesce(failure_reason, '') not like '%ANOMALY: failure reported%';
    raise warning 'withdrawal_fail refused: reference % already succeeded and cannot be marked %', v.reference, v_status;
    return jsonb_build_object('ok', false, 'found', true, 'applied', false, 'refused', true, 'reference', v.reference,
                              'status', 'success', 'reason', 'already success; only reversed is allowed, refused and recorded');
  end if;

  -- pending / processing -> failed|reversed, or success -> reversed. Refund ONCE.
  v_dest := '₦' || to_char(v.amount, 'FM999,999,999') || ' withdrawal to ' || v.bank_name || ' ••••' || v.account_last4;

  -- 1) the refund ledger row first: its unique index (reference = <ref>-refund) is the second guard against a double refund
  begin
    insert into public.wallet_transactions (user_id, type, amount, reference, status, note)
    values (v.user_id, 'withdrawal_refund', v.amount, v.reference || '-refund', 'completed',
            'Withdrawal refunded: ₦' || to_char(v.amount, 'FM999,999,999') || ' returned to your wallet');
  exception when unique_violation then
    raise warning 'withdrawal_fail refused: a refund row already exists for %', v.reference;
    return jsonb_build_object('ok', false, 'found', true, 'applied', false, 'refused', true, 'reference', v.reference,
                              'status', v.status, 'reason', 'a refund row already exists; nothing credited');
  end;

  -- 2) credit the wallet
  update public.wallets set balance = balance + v.amount, updated_at = now()
   where user_id = v.user_id
  returning balance into v_balance;

  -- 3) settle the withdrawal and the original ledger row (reversed is stored as failed in the ledger, with its own note)
  update public.withdrawals
     set status = v_status, settled_at = now(), failure_reason = nullif(v_reason, '')
   where id = v.id;
  update public.wallet_transactions
     set status = 'failed',
         note = v_dest || case v_status
                  when 'reversed' then ' was reversed. The money was returned to your wallet.'
                  else ' did not go through. The money was returned to your wallet.' end
   where reference = v.reference and type = 'withdrawal';

  -- 4) tell the tasker
  perform public._notify(v.user_id, 'withdrawal_update',
    case v_status when 'reversed' then 'Withdrawal reversed' else 'Withdrawal failed' end,
    'Your ' || v_dest || case v_status when 'reversed' then ' was reversed.' else ' did not go through.' end
      || ' ₦' || to_char(v.amount, 'FM999,999,999') || ' has been returned to your wallet.',
    jsonb_build_object('reference', v.reference, 'status', v_status, 'amount', v.amount));

  return jsonb_build_object('ok', true, 'found', true, 'applied', true, 'refunded', true, 'reference', v.reference,
                            'from_status', v.status, 'status', v_status, 'refund_amount', v.amount, 'balance_after', v_balance);
end $$;

-- 3b. stuck list ------------------------------------------------------------------------
-- Open withdrawals (pending / processing) older than p_minutes (default 15, never less than 1), oldest first, max 100 rows.
-- No full account number, no recipient code.
create or replace function public.withdrawal_stuck_list(p_minutes integer default 15)
returns table (reference text, user_id uuid, status text, amount numeric, fee numeric, net_amount numeric,
               bank_name text, account_last4 text, paystack_transfer_code text, created_at timestamptz,
               age_minutes integer, failure_reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.reference, w.user_id, w.status, w.amount, w.fee, w.net_amount, w.bank_name, w.account_last4,
         w.paystack_transfer_code, w.created_at,
         floor(extract(epoch from (now() - w.created_at)) / 60)::integer,
         w.failure_reason
    from public.withdrawals w
   where w.status in ('pending', 'processing')
     and w.created_at <= now() - (greatest(coalesce(p_minutes, 15), 1) * interval '1 minute')
   order by w.created_at
   limit 100
$$;

-- 5. Who may call what: the server (service role) ONLY; helpers: nobody ----------------------
revoke all on function public._withdrawal_clean_reason(text)                         from public, anon, authenticated;
revoke all on function public._withdrawal_lock(text)                                 from public, anon, authenticated;
revoke all on function public.withdrawal_mark_processing(text, text, text)           from public, anon, authenticated;
revoke all on function public.withdrawal_succeed(text, text)                         from public, anon, authenticated;
revoke all on function public.withdrawal_fail(text, text, text)                      from public, anon, authenticated;
revoke all on function public.withdrawal_stuck_list(integer)                         from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public._withdrawal_clean_reason(text) from service_role';
    execute 'revoke all on function public._withdrawal_lock(text) from service_role';
    execute 'grant execute on function public.withdrawal_mark_processing(text, text, text) to service_role';
    execute 'grant execute on function public.withdrawal_succeed(text, text) to service_role';
    execute 'grant execute on function public.withdrawal_fail(text, text, text) to service_role';
    execute 'grant execute on function public.withdrawal_stuck_list(integer) to service_role';
  end if;
end $$;

commit;

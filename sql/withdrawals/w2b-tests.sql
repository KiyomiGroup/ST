-- =====================================================================
-- W2b self-test. Run AFTER w2a-tables.sql and w2b-create.sql.
-- Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- It makes temporary test rows, runs withdrawal_create against them, checks the results, and UNDOES
-- everything before it ends (nothing is left in your tables, no real balance changes).
-- The result table has a SUMMARY row first, then one row per check.
-- Success = the SUMMARY row says "0 failed". Only if something says FAIL, copy the FAIL rows
-- (select the cells, Ctrl+C) and send them back.
-- Rows that start with INFO are not tests.
-- NOTE: the real two-at-once (concurrency) test cannot run in the SQL editor (it needs two connections);
-- it is run by the developer and listed in the W2b handoff.
-- =====================================================================

create or replace function pg_temp.t(p_label text, p_ok boolean, p_detail text default '') returns text
language sql as $$
  select case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end || ' | ' || p_label
         || case when not coalesce(p_ok, false) and p_detail <> '' then ' | ' || p_detail else '' end
$$;

-- call withdrawal_create AS the service role; a refusal comes back as {"err": SQLSTATE, "msg": text}
create or replace function pg_temp.wc(p_user uuid, p_amount numeric, p_acct uuid, p_role text default 'service_role') returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  begin
    execute format('set local role %I', p_role);
    v := public.withdrawal_create(p_user, p_amount, p_acct);
  exception when others then
    v := jsonb_build_object('err', sqlstate, 'msg', sqlerrm);
  end;
  execute 'reset role';
  return v;
end $$;

create or replace function pg_temp.bal(p_user uuid) returns numeric language sql as $$
  select balance from public.wallets where user_id = p_user $$;
create or replace function pg_temp.n_wd(p_user uuid) returns bigint language sql as $$
  select count(*) from public.withdrawals where user_id = p_user $$;
create or replace function pg_temp.n_tx(p_user uuid) returns bigint language sql as $$
  select count(*) from public.wallet_transactions where user_id = p_user and type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$' $$;

-- put a wallet at an exact balance (creates it if needed)
create or replace function pg_temp.setbal(p_user uuid, p_bal numeric) returns void language plpgsql as $$
begin
  perform public._ensure_wallet(p_user);
  update public.wallets set balance = p_bal where user_id = p_user;
end $$;

-- close any open withdrawal of this user so the next one is allowed (status failed: not counted in the 24h total)
create or replace function pg_temp.unblock(p_user uuid) returns void language sql as $$
  update public.withdrawals set status = 'failed', settled_at = now()
   where user_id = p_user and status in ('pending', 'processing') $$;

-- a saved account row; returns its id
create or replace function pg_temp.acct(p_user uuid, p_num text, p_age_hours numeric default 0, p_removed boolean default false,
                                        p_name text default 'TEST PERSON') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.withdrawal_bank_accounts (user_id, bank_code, bank_name, account_number, account_name, removed_at, created_at)
  values (p_user, '058', 'Test Bank', p_num, p_name, case when p_removed then now() else null end,
          now() - (p_age_hours * interval '1 hour'))
  returning id into v;
  return v;
end $$;

-- an old withdrawal row, to build up the 24 hour history
create or replace function pg_temp.hist(p_user uuid, p_amount numeric, p_status text, p_age_hours numeric) returns void
language plpgsql as $$
begin
  insert into public.withdrawals (user_id, reference, amount, fee, net_amount, status, bank_code, bank_name, account_number,
                                  account_name, created_at)
  values (p_user, 'wd-' || replace(gen_random_uuid()::text, '-', ''), p_amount, 10, p_amount - 10, p_status, '058', 'Test Bank',
          '0000000000', 'HISTORY', now() - (p_age_hours * interval '1 hour'));
end $$;

create or replace function pg_temp.w2b_run() returns setof text
language plpgsql as $fn$
declare
  v_res  text[] := '{}';
  ua     uuid := gen_random_uuid();      -- the test tasker
  ub     uuid := gen_random_uuid();      -- another user (owner of someone else's account)
  uc     uuid := gen_random_uuid();      -- not a tasker
  ud     uuid := gen_random_uuid();      -- a tasker with no wallet yet
  mode   text := 'isolated';
  a1 uuid; a2 uuid; ab uuid; arem uuid; acool uuid;
  r jsonb; r2 jsonb; r3 jsonb; v_t text; v_pass int; v_fail int; v_b0 numeric; v_row public.withdrawals; v_tx record;
  v_acct_num constant text := '0123456789';
  v_n bigint; v_ok boolean; v_probe_ok boolean := false; v_ub_last timestamptz;
begin
  begin  -- everything below is undone at the end by raising 'w2b_done'

    -- 0. Can fresh test users be created here? (If the live tables insist on real users, borrow one: still undone at the end.)
    begin
      begin
        insert into public.taskers (user_id) values (ua::text);
        perform public._ensure_wallet(ua);
        insert into public.wallet_transactions (user_id, type, amount, reference, status, note)
          values (ua, 'withdrawal', 1, 'wd-' || repeat('0', 32), 'pending', 'probe');
        insert into public.notifications (user_id, type, title, message, data, is_read)
          values (ua, 'withdrawal_update', 'probe', 'probe', '{}', false);
        raise exception 'w2b_probe_ok';
      exception when others then
        if sqlerrm = 'w2b_probe_ok' then v_probe_ok := true; end if;
      end;
    end;
    if not v_probe_ok then
      -- borrow an existing tasker that has no withdrawals yet; everything we do to them is undone at the end
      select t.user_id::uuid into ua from public.taskers t
       where t.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and not exists (select 1 from public.withdrawals w where w.user_id::text = t.user_id)
       limit 1;
      mode := 'borrowed (all changes undone)';
      if ua is null then
        v_res := v_res || 'FAIL | test setup: could not create or find a tasker to test with. Send this row back.';
        raise exception 'w2b_done';
      end if;
    else
      insert into public.taskers (user_id) values (ua::text);
    end if;
    v_res := v_res || ('INFO | test tasker mode: ' || mode);

    perform pg_temp.setbal(ua, 10000);
    a1   := pg_temp.acct(ua, v_acct_num);
    a2   := pg_temp.acct(ua, '0123456780');
    ab   := pg_temp.acct(ub, '0222222222');
    arem := pg_temp.acct(ua, '0333333333', 0, true);

    -- A. who may call it ---------------------------------------------------------------------
    v_res := v_res || pg_temp.t('withdrawal_create is SECURITY DEFINER with a fixed search_path',
      exists (select 1 from pg_proc p where p.oid = 'public.withdrawal_create(uuid,numeric,uuid)'::regprocedure
              and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')));
    v_res := v_res || pg_temp.t('anon cannot execute it', not has_function_privilege('anon', 'public.withdrawal_create(uuid,numeric,uuid)', 'execute'));
    v_res := v_res || pg_temp.t('logged-in users (authenticated) cannot execute it', not has_function_privilege('authenticated', 'public.withdrawal_create(uuid,numeric,uuid)', 'execute'));
    v_res := v_res || pg_temp.t('public (everyone) cannot execute it', not has_function_privilege('public', 'public.withdrawal_create(uuid,numeric,uuid)', 'execute'));
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      v_res := v_res || pg_temp.t('service_role can execute it', has_function_privilege('service_role', 'public.withdrawal_create(uuid,numeric,uuid)', 'execute'));
      r := pg_temp.wc(ua, 1000, a1, 'authenticated');
      v_res := v_res || pg_temp.t('calling it as a logged-in user is refused (42501)', r ->> 'err' = '42501', r::text);
      r := pg_temp.wc(ua, 1000, a1, 'anon');
      v_res := v_res || pg_temp.t('calling it as anon is refused (42501)', r ->> 'err' = '42501', r::text);
    end if;
    v_res := v_res || pg_temp.t('refused calls changed nothing (balance, rows)',
      pg_temp.bal(ua) = 10000 and pg_temp.n_wd(ua) = 0 and pg_temp.n_tx(ua) = 0);

    -- B. refusals leave NOTHING behind -------------------------------------------------------------
    r := pg_temp.wc(uc, 1000, a1);
    v_res := v_res || pg_temp.t('a customer (not a tasker) is refused WD001', r ->> 'err' = 'WD001', r::text);
    v_res := v_res || pg_temp.t('...and got no wallet debit and no rows', pg_temp.n_wd(uc) = 0 and pg_temp.n_tx(uc) = 0);

    r := pg_temp.wc(null, 1000, a1);   v_res := v_res || pg_temp.t('null user refused WD010', r ->> 'err' = 'WD010', r::text);
    r := pg_temp.wc(ua, 1000, null);   v_res := v_res || pg_temp.t('null account refused WD010', r ->> 'err' = 'WD010', r::text);
    r := pg_temp.wc(ua, null, a1);     v_res := v_res || pg_temp.t('null amount refused WD002', r ->> 'err' = 'WD002', r::text);
    r := pg_temp.wc(ua, 0, a1);        v_res := v_res || pg_temp.t('amount 0 refused WD002', r ->> 'err' = 'WD002', r::text);
    r := pg_temp.wc(ua, -500, a1);     v_res := v_res || pg_temp.t('negative amount refused WD002', r ->> 'err' = 'WD002', r::text);
    r := pg_temp.wc(ua, 1000.50, a1);  v_res := v_res || pg_temp.t('amount with kobo (1000.50) refused WD002', r ->> 'err' = 'WD002', r::text);
    r := pg_temp.wc(ua, 499, a1);      v_res := v_res || pg_temp.t('499 refused WD003 (minimum 500)', r ->> 'err' = 'WD003' and r ->> 'msg' like '%500%', r::text);
    r := pg_temp.wc(ua, 500001, a1);   v_res := v_res || pg_temp.t('500001 refused WD004 (maximum 500,000)', r ->> 'err' = 'WD004' and r ->> 'msg' like '%500,000%', r::text);
    r := pg_temp.wc(ua, 1000, gen_random_uuid());
    v_res := v_res || pg_temp.t('unknown account id refused WD008', r ->> 'err' = 'WD008', r::text);
    r2 := pg_temp.wc(ua, 1000, ab);
    v_res := v_res || pg_temp.t('SOMEONE ELSE''S account refused WD008', r2 ->> 'err' = 'WD008', r2::text);
    r3 := pg_temp.wc(ua, 1000, arem);
    v_res := v_res || pg_temp.t('a removed account refused WD008', r3 ->> 'err' = 'WD008', r3::text);
    v_res := v_res || pg_temp.t('missing / someone else''s / removed give the SAME message (no probing)',
      r ->> 'msg' = r2 ->> 'msg' and r2 ->> 'msg' = r3 ->> 'msg');
    r := pg_temp.wc(ua, 20000, a1);
    v_res := v_res || pg_temp.t('amount above the balance refused WD006', r ->> 'err' = 'WD006', r::text);
    v_res := v_res || pg_temp.t('ALL those refusals left the wallet and tables untouched',
      pg_temp.bal(ua) = 10000 and pg_temp.n_wd(ua) = 0 and pg_temp.n_tx(ua) = 0,
      'balance=' || coalesce(pg_temp.bal(ua)::text, 'null') || ' wd=' || pg_temp.n_wd(ua) || ' tx=' || pg_temp.n_tx(ua));
    v_res := v_res || pg_temp.t('someone else''s account row was not touched (last_used_at still empty)',
      (select last_used_at is null from public.withdrawal_bank_accounts where id = ab));

    -- C. a tasker with no wallet row yet: refused for balance, no crash -----------------------------
    if mode = 'isolated' then
      insert into public.taskers (user_id) values (ud::text);
      r := pg_temp.wc(ud, 1000, pg_temp.acct(ud, '0444444444'));
      v_res := v_res || pg_temp.t('tasker with no wallet gets "balance not enough" (WD006), not a crash', r ->> 'err' = 'WD006', r::text);
    end if;

    -- D. the successful withdrawal, checked to the last naira -------------------------------------------
    v_b0 := pg_temp.bal(ua);
    r := pg_temp.wc(ua, 2000, a1);
    v_res := v_res || pg_temp.t('withdrawing 2000 works', (r ->> 'reference') is not null and (r ->> 'err') is null, r::text);
    v_res := v_res || pg_temp.t('reference looks like wd- + 32 lowercase hex', (r ->> 'reference') ~ '^wd-[0-9a-f]{32}$', r::text);
    v_res := v_res || pg_temp.t('fee is 10 and net is 1990 (2000 is in the first tier)', (r ->> 'fee')::numeric = 10 and (r ->> 'net_amount')::numeric = 1990, r::text);
    v_res := v_res || pg_temp.t('wallet balance dropped by exactly 2000, once', pg_temp.bal(ua) = v_b0 - 2000, 'balance=' || pg_temp.bal(ua));
    v_res := v_res || pg_temp.t('balance_after in the result equals the real balance', (r ->> 'balance_after')::numeric = pg_temp.bal(ua));
    select * into v_row from public.withdrawals where reference = r ->> 'reference';
    v_res := v_res || pg_temp.t('withdrawals row exists, status pending', v_row.id is not null and v_row.status = 'pending');
    v_res := v_res || pg_temp.t('withdrawals row: amount 2000, fee 10, net 1990', v_row.amount = 2000 and v_row.fee = 10 and v_row.net_amount = 1990);
    v_res := v_res || pg_temp.t('withdrawals row belongs to the right user and account',
      v_row.user_id = ua and v_row.bank_account_id = a1);
    v_res := v_res || pg_temp.t('destination snapshot copied from the saved account',
      v_row.bank_code = '058' and v_row.bank_name = 'Test Bank' and v_row.account_number = v_acct_num and v_row.account_name = 'TEST PERSON');
    v_res := v_res || pg_temp.t('no Paystack codes yet (recipient / transfer code empty)', v_row.recipient_code is null and v_row.paystack_transfer_code is null);
    select * into v_tx from public.wallet_transactions where user_id = ua and type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$';
    v_res := v_res || pg_temp.t('exactly one ledger row, type withdrawal, status pending',
      pg_temp.n_tx(ua) = 1 and v_tx.status = 'pending');
    v_res := v_res || pg_temp.t('ledger amount is the GROSS 2000, positive', v_tx.amount = 2000);
    v_res := v_res || pg_temp.t('ledger reference equals the withdrawal reference', v_tx.reference = r ->> 'reference');
    v_res := v_res || pg_temp.t('ledger note shows last 4 digits only, never the full number',
      v_tx.note like '%6789%' and v_tx.note not like '%' || v_acct_num || '%', v_tx.note);
    v_res := v_res || pg_temp.t('the result does not contain the full account number', position(v_acct_num in r::text) = 0, r::text);
    v_res := v_res || pg_temp.t('the saved account got last_used_at set',
      (select last_used_at is not null from public.withdrawal_bank_accounts where id = a1));
    v_res := v_res || pg_temp.t('the OTHER saved account was not touched',
      (select last_used_at is null from public.withdrawal_bank_accounts where id = a2));

    -- E. double submit / second open withdrawal -------------------------------------------------------
    r2 := pg_temp.wc(ua, 2000, a1);
    v_res := v_res || pg_temp.t('double submit refused WD007 (withdrawal in progress)', r2 ->> 'err' = 'WD007' and r2 ->> 'msg' like '%in progress%', r2::text);
    r2 := pg_temp.wc(ua, 700, a2);
    v_res := v_res || pg_temp.t('a second withdrawal to ANOTHER account is also refused WD007', r2 ->> 'err' = 'WD007', r2::text);
    v_res := v_res || pg_temp.t('...and nothing extra was debited or written',
      pg_temp.bal(ua) = v_b0 - 2000 and pg_temp.n_wd(ua) = 1 and pg_temp.n_tx(ua) = 1);
    update public.withdrawals set status = 'processing' where reference = r ->> 'reference';
    r2 := pg_temp.wc(ua, 700, a1);
    v_res := v_res || pg_temp.t('still refused while the first one is PROCESSING', r2 ->> 'err' = 'WD007', r2::text);

    -- F. after it finishes, the next one is allowed ------------------------------------------------------
    update public.withdrawals set status = 'success', settled_at = now() where reference = r ->> 'reference';
    r2 := pg_temp.wc(ua, 700, a2);
    v_res := v_res || pg_temp.t('after the first is SUCCESS, a new withdrawal works (to the other account)', (r2 ->> 'reference') is not null, r2::text);
    v_res := v_res || pg_temp.t('exact arithmetic after two withdrawals: 10000 - 2000 - 700 = 7300', pg_temp.bal(ua) = 7300, 'balance=' || pg_temp.bal(ua));
    v_res := v_res || pg_temp.t('two different references', (r ->> 'reference') <> (r2 ->> 'reference'));
    v_res := v_res || pg_temp.t('ledger now has two rows, amounts sum to what left the wallet',
      pg_temp.n_tx(ua) = 2 and (select sum(amount) from public.wallet_transactions where user_id = ua and type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$') = 2700);
    update public.withdrawals set status = 'failed', settled_at = now() where reference = r2 ->> 'reference';
    r3 := pg_temp.wc(ua, 600, a1);
    v_res := v_res || pg_temp.t('after a FAILED one, a new withdrawal is allowed', (r3 ->> 'reference') is not null, r3::text);
    perform pg_temp.unblock(ua);

    -- G. limits: min / max / fee boundaries --------------------------------------------------------------
    perform pg_temp.setbal(ua, 2000000);
    delete from public.withdrawals where user_id = ua;     -- test-only: clean history (undone at the end)
    delete from public.wallet_transactions where user_id = ua and type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$';
    r := pg_temp.wc(ua, 500, a1);    v_res := v_res || pg_temp.t('exactly 500 (the minimum) works, fee 10', (r ->> 'reference') is not null and (r ->> 'fee')::numeric = 10, r::text);
    perform pg_temp.unblock(ua);
    r := pg_temp.wc(ua, 5000, a1);   v_res := v_res || pg_temp.t('5000 -> fee 10, net 4990', (r ->> 'fee')::numeric = 10 and (r ->> 'net_amount')::numeric = 4990, r::text);
    perform pg_temp.unblock(ua);
    r := pg_temp.wc(ua, 5001, a1);   v_res := v_res || pg_temp.t('5001 -> fee 25, net 4976', (r ->> 'fee')::numeric = 25 and (r ->> 'net_amount')::numeric = 4976, r::text);
    perform pg_temp.unblock(ua);
    r := pg_temp.wc(ua, 10000, a1);  v_res := v_res || pg_temp.t('10000 -> fee 75, net 9925', (r ->> 'fee')::numeric = 75 and (r ->> 'net_amount')::numeric = 9925, r::text);
    perform pg_temp.unblock(ua);
    r := pg_temp.wc(ua, 50001, a1);  v_res := v_res || pg_temp.t('50001 -> fee 100, net 49901', (r ->> 'fee')::numeric = 100 and (r ->> 'net_amount')::numeric = 49901, r::text);
    perform pg_temp.unblock(ua);
    r := pg_temp.wc(ua, 500000, a1); v_res := v_res || pg_temp.t('exactly 500000 (the maximum) works', (r ->> 'reference') is not null, r::text);
    perform pg_temp.unblock(ua);
    v_res := v_res || pg_temp.t('ledger rows equal withdrawals rows (6 each)', pg_temp.n_tx(ua) = pg_temp.n_wd(ua), pg_temp.n_tx(ua) || ' vs ' || pg_temp.n_wd(ua));

    -- H. rolling 24 hours ----------------------------------------------------------------------------------
    delete from public.withdrawals where user_id = ua;
    delete from public.wallet_transactions where user_id = ua and type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$';
    perform pg_temp.setbal(ua, 2000000);
    perform pg_temp.hist(ua, 400000, 'success', 5);
    perform pg_temp.hist(ua, 400000, 'success', 20);
    perform pg_temp.hist(ua, 500000, 'failed', 3);       -- does not count
    perform pg_temp.hist(ua, 500000, 'reversed', 3);     -- does not count
    perform pg_temp.hist(ua, 900000, 'success', 25);     -- older than 24h: does not count
    r := pg_temp.wc(ua, 200001, a1);
    v_res := v_res || pg_temp.t('800,000 used: asking 200,001 is refused WD005', r ->> 'err' = 'WD005', r::text);
    v_res := v_res || pg_temp.t('...and the message says how much is still allowed (200,000)', r ->> 'msg' like '%200,000%', r ->> 'msg');
    v_res := v_res || pg_temp.t('failed, reversed and 25-hour-old rows were NOT counted (else it would have been "reached")',
      r ->> 'msg' not like '%reached%', r ->> 'msg');
    r := pg_temp.wc(ua, 200000, a1);
    v_res := v_res || pg_temp.t('asking exactly the remaining 200,000 works (total = 1,000,000)', (r ->> 'reference') is not null, r::text);
    update public.withdrawals set status = 'processing' where reference = r ->> 'reference';
    r2 := pg_temp.wc(ua, 500, a1);
    v_res := v_res || pg_temp.t('pending/processing counts toward the day: with one open, the open-withdrawal rule answers first (WD007)', r2 ->> 'err' = 'WD007', r2::text);
    update public.withdrawals set status = 'success', settled_at = now() where reference = r ->> 'reference';
    r2 := pg_temp.wc(ua, 500, a1);
    v_res := v_res || pg_temp.t('at exactly 1,000,000 used, even 500 is refused WD005 ("reached")', r2 ->> 'err' = 'WD005' and r2 ->> 'msg' like '%reached%', r2::text);

    -- I. another day-limit boundary (700,000 already sent) ------------------------------------------------------------
    delete from public.withdrawals where user_id = ua;
    delete from public.wallet_transactions where user_id = ua and type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$';
    perform pg_temp.hist(ua, 700000, 'success', 2);
    r := pg_temp.wc(ua, 300001, a1);
    v_res := v_res || pg_temp.t('700,000 used in the last 24h: asking 300,001 is refused WD005', r ->> 'err' = 'WD005', r::text);
    r := pg_temp.wc(ua, 300000, a1);
    v_res := v_res || pg_temp.t('...and asking exactly 300,000 works', (r ->> 'reference') is not null, r::text);
    perform pg_temp.unblock(ua);

    -- J. the cooldown switch (turned on only inside this test; undone at the end) -----------------------------
    delete from public.withdrawals where user_id = ua;
    delete from public.wallet_transactions where user_id = ua and type = 'withdrawal' and reference ~ '^wd-[0-9a-f]{32}$';
    perform pg_temp.setbal(ua, 100000);
    r := pg_temp.wc(ua, 1000, a1);
    v_res := v_res || pg_temp.t('cooldown is OFF by default: an account saved just now can be paid at once', (r ->> 'reference') is not null, r::text);
    perform pg_temp.unblock(ua);
    execute $e$create or replace function public.withdrawal_limits() returns jsonb language sql immutable as
      $f$ select jsonb_build_object('min_amount',500,'max_amount',500000,'daily_max',1000000,'max_saved_accounts',3,'new_account_cooldown_hours',24) $f$$e$;
    acool := pg_temp.acct(ua, '0555555555', 23);     -- saved 23 hours ago
    r := pg_temp.wc(ua, 1000, acool);
    v_res := v_res || pg_temp.t('cooldown 24h: account saved 23h ago refused WD009', r ->> 'err' = 'WD009', r::text);
    v_res := v_res || pg_temp.t('...message says about 1 hour left', r ->> 'msg' like '%1 hour%', r ->> 'msg');
    r := pg_temp.wc(ua, 1000, a1);
    v_res := v_res || pg_temp.t('cooldown 24h: the just-saved account is refused too (WD009)', r ->> 'err' = 'WD009' and r ->> 'msg' like '%24 hour%', r::text);
    acool := pg_temp.acct(ua, '0666666666', 25);     -- saved 25 hours ago
    r := pg_temp.wc(ua, 1000, acool);
    v_res := v_res || pg_temp.t('cooldown 24h: an account saved 25h ago works', (r ->> 'reference') is not null, r::text);
    v_res := v_res || pg_temp.t('refused cooldown calls debited nothing (only the one allowed withdrawal exists)',
      pg_temp.n_wd(ua) = 2 and pg_temp.bal(ua) = 100000 - 1000 - 1000);

    -- K. the money tables were NOT loosened (state check) -------------------------------------------------------
    foreach v_t in array array['wallets', 'wallet_transactions', 'escrow_payments', 'payment_intents'] loop
      if to_regclass('public.' || v_t) is not null then
        v_res := v_res || pg_temp.t('browser has no write access on ' || v_t,
          not (has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
            or has_table_privilege('authenticated', 'public.' || v_t, 'UPDATE')
            or has_table_privilege('authenticated', 'public.' || v_t, 'DELETE')));
      end if;
    end loop;

    raise exception 'w2b_done';       -- undo every test row, every balance change and the temporary limits function
  exception when others then
    if sqlerrm <> 'w2b_done' then
      v_res := v_res || ('FAIL | the test run itself crashed: SQLSTATE ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  select count(*) filter (where x like 'PASS |%'), count(*) filter (where x like 'FAIL |%')
    into v_pass, v_fail from unnest(v_res) as x;
  return next 'SUMMARY | W2b: ' || v_pass || ' passed, ' || v_fail || ' failed';
  foreach v_t in array v_res loop
    return next v_t;
  end loop;
end $fn$;

select * from pg_temp.w2b_run();

-- =====================================================================
-- W2c-1 self-test. Run AFTER w2a-tables.sql, w2b-create.sql and w2c-settle.sql.
-- Supabase dashboard > SQL Editor > New query > paste the WHOLE file > Run.
-- It makes temporary test rows, runs the settle functions against them, checks the results, and UNDOES
-- everything before it ends (nothing is left in your tables, no real balance changes).
-- The result table has a SUMMARY row first, then one row per check.
-- Success = the SUMMARY row says "0 failed". Only if something says FAIL, copy the FAIL rows
-- (select the cells, Ctrl+C) and send them back.
-- Rows that start with INFO are not tests.
-- NOTE: the real two-at-once (concurrency) test cannot run in the SQL editor (it needs two connections);
-- it is run by the developer and listed in the W2c-1 handoff.
-- =====================================================================

create or replace function pg_temp.t(p_label text, p_ok boolean, p_detail text default '') returns text
language sql as $$
  select case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end || ' | ' || p_label
         || case when not coalesce(p_ok, false) and p_detail <> '' then ' | ' || p_detail else '' end
$$;

-- run any of the settle functions AS the service role; a refusal that raises comes back as {"err": SQLSTATE, "msg": text}
create or replace function pg_temp.sv(p_sql text, p_role text default 'service_role') returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('err', sqlstate, 'msg', sqlerrm);
  end;
  execute 'reset role';
  return v;
end $$;

create or replace function pg_temp.mp(p_ref text, p_tc text, p_rc text, p_role text default 'service_role') returns jsonb
language sql as $$ select pg_temp.sv(format('select public.withdrawal_mark_processing(%L, %L, %L)', p_ref, p_tc, p_rc), p_role) $$;
create or replace function pg_temp.su(p_ref text, p_tc text, p_role text default 'service_role') returns jsonb
language sql as $$ select pg_temp.sv(format('select public.withdrawal_succeed(%L, %L)', p_ref, p_tc), p_role) $$;
create or replace function pg_temp.fl(p_ref text, p_status text, p_reason text, p_role text default 'service_role') returns jsonb
language sql as $$ select pg_temp.sv(format('select public.withdrawal_fail(%L, %L, %L)', p_ref, p_status, p_reason), p_role) $$;

create or replace function pg_temp.bal(p_user uuid) returns numeric language sql as $$
  select balance from public.wallets where user_id = p_user $$;
create or replace function pg_temp.setbal(p_user uuid, p_bal numeric) returns void language plpgsql as $$
begin
  perform public._ensure_wallet(p_user);
  update public.wallets set balance = p_bal where user_id = p_user;
end $$;
create or replace function pg_temp.wst(p_ref text) returns text language sql as $$
  select status from public.withdrawals where reference = p_ref $$;
create or replace function pg_temp.lst(p_ref text) returns text language sql as $$
  select status from public.wallet_transactions where reference = p_ref and type = 'withdrawal' $$;
create or replace function pg_temp.n_refund(p_ref text) returns bigint language sql as $$
  select count(*) from public.wallet_transactions where type = 'withdrawal_refund' and reference = p_ref || '-refund' $$;
create or replace function pg_temp.n_note(p_user uuid, p_ref text) returns bigint language sql as $$
  select count(*) from public.notifications where user_id = p_user and type = 'withdrawal_update' and data ->> 'reference' = p_ref $$;

-- start a real withdrawal through withdrawal_create (as the service role) and return its reference
create or replace function pg_temp.mk(p_user uuid, p_amount numeric, p_acct uuid) returns text language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role service_role';
  v := public.withdrawal_create(p_user, p_amount, p_acct);
  execute 'reset role';
  return v ->> 'reference';
end $$;

create or replace function pg_temp.w2c_run() returns setof text
language plpgsql as $fn$
declare
  v_res  text[] := '{}';
  ua     uuid := gen_random_uuid();      -- the test tasker
  mode   text := 'isolated';
  a1 uuid;
  r jsonb; r2 jsonb; v_t text; v_pass int; v_fail int; v_probe_ok boolean := false;
  ref1 text; ref2 text; ref3 text; ref4 text; ref5 text; ref6 text; ref7 text;
  v_row public.withdrawals; v_tx public.wallet_transactions; v_n bigint; v_start numeric := 100000; v_sum numeric;
begin
  begin  -- everything below is undone at the end by raising 'w2c_done'

    -- 0. Can a fresh test user be created here? (If the live tables insist on real users, borrow one: still undone at the end.)
    begin
      begin
        insert into public.taskers (user_id) values (ua::text);
        perform public._ensure_wallet(ua);
        insert into public.wallet_transactions (user_id, type, amount, reference, status, note)
          values (ua, 'withdrawal_refund', 1, 'wd-' || repeat('0', 32) || '-refund', 'completed', 'probe');
        insert into public.notifications (user_id, type, title, message, data, is_read)
          values (ua, 'withdrawal_update', 'probe', 'probe', '{}', false);
        raise exception 'w2c_probe_ok';
      exception when others then
        if sqlerrm = 'w2c_probe_ok' then v_probe_ok := true; end if;
      end;
    end;
    if not v_probe_ok then
      select t.user_id::uuid into ua from public.taskers t
       where t.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and not exists (select 1 from public.withdrawals w where w.user_id::text = t.user_id)
       limit 1;
      mode := 'borrowed (all changes undone)';
      if ua is null then
        v_res := v_res || 'FAIL | test setup: could not create or find a tasker to test with. Send this row back.';
        raise exception 'w2c_done';
      end if;
    else
      insert into public.taskers (user_id) values (ua::text);
    end if;
    v_res := v_res || ('INFO | test tasker mode: ' || mode);

    perform pg_temp.setbal(ua, v_start);
    insert into public.withdrawal_bank_accounts (user_id, bank_code, bank_name, account_number, account_name)
      values (ua, '058', 'Test Bank', '0123456789', 'TEST PERSON') returning id into a1;

    -- A. who may call what ----------------------------------------------------------------------
    foreach v_t in array array['withdrawal_mark_processing(text,text,text)', 'withdrawal_succeed(text,text)',
                               'withdrawal_fail(text,text,text)', 'withdrawal_stuck_list(integer)'] loop
      v_res := v_res || pg_temp.t(v_t || ' is SECURITY DEFINER with a fixed search_path',
        exists (select 1 from pg_proc p where p.oid = ('public.' || v_t)::regprocedure
                and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')));
      v_res := v_res || pg_temp.t(v_t || ': anon cannot execute', not has_function_privilege('anon', 'public.' || v_t, 'execute'));
      v_res := v_res || pg_temp.t(v_t || ': logged-in users cannot execute', not has_function_privilege('authenticated', 'public.' || v_t, 'execute'));
      v_res := v_res || pg_temp.t(v_t || ': public cannot execute', not has_function_privilege('public', 'public.' || v_t, 'execute'));
      if exists (select 1 from pg_roles where rolname = 'service_role') then
        v_res := v_res || pg_temp.t(v_t || ': service_role can execute', has_function_privilege('service_role', 'public.' || v_t, 'execute'));
      end if;
    end loop;
    foreach v_t in array array['_withdrawal_lock(text)', '_withdrawal_clean_reason(text)'] loop
      v_res := v_res || pg_temp.t('helper ' || v_t || ' cannot be executed by anon / logged-in users / public',
        not has_function_privilege('anon', 'public.' || v_t, 'execute')
        and not has_function_privilege('authenticated', 'public.' || v_t, 'execute')
        and not has_function_privilege('public', 'public.' || v_t, 'execute'));
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      ref1 := pg_temp.mk(ua, 1000, a1);
      v_res := v_res || pg_temp.t('setup: a withdrawal was created through withdrawal_create (pending)', pg_temp.wst(ref1) = 'pending', coalesce(ref1, 'null'));
      r := pg_temp.mp(ref1, 'TRF_x', 'RCP_x', 'authenticated');
      v_res := v_res || pg_temp.t('mark_processing as a logged-in user is refused (42501)', r ->> 'err' = '42501', r::text);
      r := pg_temp.su(ref1, 'TRF_x', 'anon');
      v_res := v_res || pg_temp.t('succeed as anon is refused (42501)', r ->> 'err' = '42501', r::text);
      r := pg_temp.fl(ref1, 'failed', 'x', 'authenticated');
      v_res := v_res || pg_temp.t('fail as a logged-in user is refused (42501)', r ->> 'err' = '42501', r::text);
      v_res := v_res || pg_temp.t('those refused calls changed nothing', pg_temp.wst(ref1) = 'pending' and pg_temp.bal(ua) = v_start - 1000);
      perform pg_temp.fl(ref1, 'failed', 'cleanup');       -- close it (refund) so the next test can open its own
    else
      ref1 := pg_temp.mk(ua, 1000, a1);
      perform pg_temp.fl(ref1, 'failed', 'cleanup');
    end if;
    perform pg_temp.setbal(ua, v_start);
    delete from public.notifications where user_id = ua;

    -- B. mark_processing ------------------------------------------------------------------------
    ref1 := pg_temp.mk(ua, 2000, a1);
    r := pg_temp.mp(ref1, 'TRF_b1', 'RCP_b1');
    v_res := v_res || pg_temp.t('B1 pending -> processing: applied', r ->> 'applied' = 'true' and r ->> 'status' = 'processing', r::text);
    select * into v_row from public.withdrawals where reference = ref1;
    v_res := v_res || pg_temp.t('B2 transfer code and recipient code stored', v_row.paystack_transfer_code = 'TRF_b1' and v_row.recipient_code = 'RCP_b1');
    v_res := v_res || pg_temp.t('B3 withdrawals.status = processing and ledger row = processing', pg_temp.wst(ref1) = 'processing' and pg_temp.lst(ref1) = 'processing');
    v_res := v_res || pg_temp.t('B4 the wallet was not touched (debited once at creation: 98000)', pg_temp.bal(ua) = v_start - 2000);
    r := pg_temp.mp(ref1, 'TRF_other', 'RCP_other');
    v_res := v_res || pg_temp.t('B5 second call: harmless no-op (applied false)', r ->> 'applied' = 'false' and r ->> 'ok' = 'true' and r ->> 'status' = 'processing', r::text);
    select * into v_row from public.withdrawals where reference = ref1;
    v_res := v_res || pg_temp.t('B6 a repeat call never overwrites the stored codes', v_row.paystack_transfer_code = 'TRF_b1' and v_row.recipient_code = 'RCP_b1');
    r := pg_temp.mp('wd-' || repeat('a', 32), 'T', 'R');
    v_res := v_res || pg_temp.t('B7 unknown reference: found false, nothing raised', r ->> 'found' = 'false' and r ->> 'err' is null, r::text);
    r := pg_temp.mp('not-a-reference', 'T', 'R');
    v_res := v_res || pg_temp.t('B8 malformed reference: found false, nothing raised', r ->> 'found' = 'false' and r ->> 'err' is null, r::text);
    r := pg_temp.mp(null, 'T', 'R');
    v_res := v_res || pg_temp.t('B9 null reference raises WD013', r ->> 'err' = 'WD013', r::text);
    r := pg_temp.mp('   ', 'T', 'R');
    v_res := v_res || pg_temp.t('B10 blank reference raises WD013', r ->> 'err' = 'WD013', r::text);
    perform pg_temp.su(ref1, 'TRF_b1');                    -- finish it (success, keeps TRF_b1)
    r := pg_temp.mp(ref1, 'TRF_late', 'RCP_late');
    v_res := v_res || pg_temp.t('B11 mark_processing on an already-success withdrawal: no-op, status stays success',
      r ->> 'applied' = 'false' and r ->> 'status' = 'success' and pg_temp.wst(ref1) = 'success' and pg_temp.lst(ref1) = 'completed', r::text);
    ref2 := pg_temp.mk(ua, 1500, a1);
    r := pg_temp.mp(ref2, 'TRF_b1', 'RCP_b2');
    v_res := v_res || pg_temp.t('B12 a transfer code already used by another withdrawal raises WD014', r ->> 'err' = 'WD014', r::text);
    v_res := v_res || pg_temp.t('B13 ...and nothing changed (still pending, ledger pending, no code)',
      pg_temp.wst(ref2) = 'pending' and pg_temp.lst(ref2) = 'pending'
      and (select paystack_transfer_code from public.withdrawals where reference = ref2) is null);
    r := pg_temp.mp(ref2, null, null);
    v_res := v_res || pg_temp.t('B14 mark_processing with empty codes still moves pending -> processing', r ->> 'applied' = 'true' and pg_temp.wst(ref2) = 'processing', r::text);
    r := pg_temp.mp(ref2, 'TRF_b2', 'RCP_b2');
    select * into v_row from public.withdrawals where reference = ref2;
    v_res := v_res || pg_temp.t('B15 a later call fills codes that were empty', v_row.paystack_transfer_code = 'TRF_b2' and v_row.recipient_code = 'RCP_b2', r::text);
    perform pg_temp.fl(ref2, 'failed', 'cleanup');

    -- C. succeed --------------------------------------------------------------------------------
    perform pg_temp.setbal(ua, v_start);
    delete from public.notifications where user_id = ua;
    ref3 := pg_temp.mk(ua, 5000, a1);
    perform pg_temp.mp(ref3, 'TRF_c3', 'RCP_c3');
    r := pg_temp.su(ref3, 'TRF_c3');
    v_res := v_res || pg_temp.t('C1 processing -> success: applied', r ->> 'applied' = 'true' and r ->> 'status' = 'success' and r ->> 'from_status' = 'processing', r::text);
    select * into v_row from public.withdrawals where reference = ref3;
    v_res := v_res || pg_temp.t('C2 settled_at is set; failure_reason is empty', v_row.settled_at is not null and v_row.failure_reason is null);
    v_res := v_res || pg_temp.t('C3 ledger row = completed; amount unchanged (gross, positive)',
      pg_temp.lst(ref3) = 'completed' and (select amount from public.wallet_transactions where reference = ref3 and type = 'withdrawal') = 5000);
    v_res := v_res || pg_temp.t('C4 the wallet is untouched by success (100000 - 5000)', pg_temp.bal(ua) = v_start - 5000);
    v_res := v_res || pg_temp.t('C5 exactly one notification, and it says what the tasker receives (₦4,990)',
      pg_temp.n_note(ua, ref3) = 1
      and (select message from public.notifications where user_id = ua and data ->> 'reference' = ref3) like '%₦4,990%'
      and (select title from public.notifications where user_id = ua and data ->> 'reference' = ref3) = 'Withdrawal sent');
    v_res := v_res || pg_temp.t('C6 the notification holds no full account number',
      not exists (select 1 from public.notifications where user_id = ua and (message like '%0123456789%' or data::text like '%0123456789%')));
    r := pg_temp.su(ref3, 'TRF_c3');
    v_res := v_res || pg_temp.t('C7 duplicate success: no-op, still one notification, wallet unchanged',
      r ->> 'applied' = 'false' and r ->> 'ok' = 'true' and pg_temp.n_note(ua, ref3) = 1 and pg_temp.bal(ua) = v_start - 5000, r::text);
    r := pg_temp.su('wd-' || repeat('b', 32), 'T');
    v_res := v_res || pg_temp.t('C8 succeed with an unknown reference: found false, nothing raised', r ->> 'found' = 'false' and r ->> 'err' is null, r::text);
    r := pg_temp.su(null, 'T');
    v_res := v_res || pg_temp.t('C9 succeed with a null reference raises WD013', r ->> 'err' = 'WD013', r::text);
    ref4 := pg_temp.mk(ua, 3000, a1);                      -- the webhook arrives before mark_processing
    r := pg_temp.su(ref4, 'TRF_c4');
    v_res := v_res || pg_temp.t('C10 pending -> success directly (webhook first): applied, transfer code stored',
      r ->> 'applied' = 'true' and r ->> 'from_status' = 'pending' and pg_temp.wst(ref4) = 'success' and pg_temp.lst(ref4) = 'completed'
      and (select paystack_transfer_code from public.withdrawals where reference = ref4) = 'TRF_c4', r::text);
    r := pg_temp.mp(ref4, 'TRF_late', 'RCP_late');
    v_res := v_res || pg_temp.t('C11 mark_processing arriving after success changes nothing', r ->> 'applied' = 'false' and pg_temp.wst(ref4) = 'success');

    -- D. fail: exactly-once refund --------------------------------------------------------------
    perform pg_temp.setbal(ua, v_start);
    delete from public.notifications where user_id = ua;
    delete from public.wallet_transactions where user_id = ua;
    ref5 := pg_temp.mk(ua, 4000, a1);
    perform pg_temp.mp(ref5, 'TRF_d5', 'RCP_d5');
    v_res := v_res || pg_temp.t('D0 before: wallet is 96000', pg_temp.bal(ua) = v_start - 4000);
    r := pg_temp.fl(ref5, 'failed', 'Transfer failed for account 0123456789 at bank');
    v_res := v_res || pg_temp.t('D1 processing -> failed: applied, refunded, refund amount 4000 (the FULL amount, fee included)',
      r ->> 'applied' = 'true' and r ->> 'refunded' = 'true' and (r ->> 'refund_amount')::numeric = 4000 and r ->> 'status' = 'failed', r::text);
    v_res := v_res || pg_temp.t('D2 wallet is exactly back to 100000', pg_temp.bal(ua) = v_start);
    v_res := v_res || pg_temp.t('D3 exactly one refund ledger row: type withdrawal_refund, +4000, completed, reference <ref>-refund',
      pg_temp.n_refund(ref5) = 1
      and exists (select 1 from public.wallet_transactions where type = 'withdrawal_refund' and reference = ref5 || '-refund'
                  and amount = 4000 and status = 'completed' and user_id = ua));
    v_res := v_res || pg_temp.t('D4 the original ledger row is failed and its note says the money was returned',
      pg_temp.lst(ref5) = 'failed'
      and (select note from public.wallet_transactions where reference = ref5 and type = 'withdrawal') like '%did not go through%returned to your wallet%');
    select * into v_row from public.withdrawals where reference = ref5;
    v_res := v_res || pg_temp.t('D5 withdrawals row: failed, settled_at set, reason kept but the 10-digit number is masked',
      v_row.status = 'failed' and v_row.settled_at is not null and v_row.failure_reason like 'Transfer failed for account **********%'
      and v_row.failure_reason not like '%0123456789%', coalesce(v_row.failure_reason, 'null'));
    v_res := v_res || pg_temp.t('D6 exactly one notification, "Withdrawal failed", says the money was returned, no full account number',
      pg_temp.n_note(ua, ref5) = 1
      and (select title from public.notifications where user_id = ua and data ->> 'reference' = ref5) = 'Withdrawal failed'
      and (select message from public.notifications where user_id = ua and data ->> 'reference' = ref5) like '%returned to your wallet%'
      and not exists (select 1 from public.notifications where user_id = ua and (message like '%0123456789%' or data::text like '%0123456789%')));
    v_res := v_res || pg_temp.t('D7 the raw reason is NOT in the ledger note or the notification',
      not exists (select 1 from public.wallet_transactions where user_id = ua and note like '%Transfer failed for account%')
      and not exists (select 1 from public.notifications where user_id = ua and message like '%Transfer failed for account%'));
    r := pg_temp.fl(ref5, 'failed', 'again');
    r2 := pg_temp.fl(ref5, 'failed', 'again');
    v_res := v_res || pg_temp.t('D8 fail called twice more: no-ops, still ONE refund, wallet still 100000, still one notification',
      r ->> 'applied' = 'false' and r2 ->> 'applied' = 'false' and r ->> 'ok' = 'true'
      and pg_temp.n_refund(ref5) = 1 and pg_temp.bal(ua) = v_start and pg_temp.n_note(ua, ref5) = 1, r::text);
    r := pg_temp.fl(ref5, 'reversed', 'late reversal event');
    v_res := v_res || pg_temp.t('D9 a reversed event after failed is a no-op (already refunded): no second refund',
      r ->> 'applied' = 'false' and pg_temp.n_refund(ref5) = 1 and pg_temp.bal(ua) = v_start and pg_temp.wst(ref5) = 'failed', r::text);
    ref6 := pg_temp.mk(ua, 6000, a1);                      -- fail straight from pending (Paystack rejected the call)
    r := pg_temp.fl(ref6, 'FAILED', null);
    v_res := v_res || pg_temp.t('D10 pending -> failed straight away (upper-case status accepted, null reason ok): refunded once',
      r ->> 'applied' = 'true' and r ->> 'from_status' = 'pending' and pg_temp.bal(ua) = v_start and pg_temp.n_refund(ref6) = 1
      and (select failure_reason from public.withdrawals where reference = ref6) is null, r::text);
    ref7 := pg_temp.mk(ua, 7000, a1);
    r := pg_temp.fl(ref7, 'reversed', 'Transfer reversed');
    v_res := v_res || pg_temp.t('D11 processing/pending -> reversed: refunded once, status reversed',
      r ->> 'applied' = 'true' and r ->> 'status' = 'reversed' and pg_temp.wst(ref7) = 'reversed' and pg_temp.bal(ua) = v_start and pg_temp.n_refund(ref7) = 1, r::text);
    v_res := v_res || pg_temp.t('D12 reversed is stored as failed in the ledger, with a note that says reversed',
      pg_temp.lst(ref7) = 'failed'
      and (select note from public.wallet_transactions where reference = ref7 and type = 'withdrawal') like '%was reversed%returned to your wallet%');
    v_res := v_res || pg_temp.t('D13 the reversed notification title says "Withdrawal reversed"',
      (select title from public.notifications where user_id = ua and data ->> 'reference' = ref7) = 'Withdrawal reversed');
    r := pg_temp.fl(ref5, 'success', 'x');
    v_res := v_res || pg_temp.t('D14 a status other than failed/reversed raises WD012', r ->> 'err' = 'WD012', r::text);
    r := pg_temp.fl(ref5, null, 'x');
    v_res := v_res || pg_temp.t('D15 a null status raises WD012', r ->> 'err' = 'WD012', r::text);
    r := pg_temp.fl('wd-' || repeat('c', 32), 'failed', 'x');
    v_res := v_res || pg_temp.t('D16 fail with an unknown reference: found false, nothing raised, no money moved',
      r ->> 'found' = 'false' and r ->> 'err' is null and pg_temp.bal(ua) = v_start, r::text);
    r := pg_temp.fl(null, 'failed', 'x');
    v_res := v_res || pg_temp.t('D17 fail with a null reference raises WD013', r ->> 'err' = 'WD013', r::text);
    r := pg_temp.fl(ref5, 'failed', repeat('x', 1000));
    v_res := v_res || pg_temp.t('D18 (no-op call) a very long reason cannot break anything', r ->> 'ok' = 'true');
    -- reason length cap, on a fresh withdrawal
    perform pg_temp.setbal(ua, v_start);
    ref1 := pg_temp.mk(ua, 800, a1);
    perform pg_temp.fl(ref1, 'failed', repeat('x', 1000));
    v_res := v_res || pg_temp.t('D19 a 1000-character reason is stored cut to 300',
      (select length(failure_reason) from public.withdrawals where reference = ref1) = 300);

    -- E. success then reversed / failed; failed then success -----------------------------------
    perform pg_temp.setbal(ua, v_start);
    delete from public.notifications where user_id = ua;
    ref1 := pg_temp.mk(ua, 3000, a1);
    perform pg_temp.mp(ref1, 'TRF_e1', 'RCP_e1');
    perform pg_temp.su(ref1, 'TRF_e1');
    v_res := v_res || pg_temp.t('E0 after success the wallet is 97000', pg_temp.bal(ua) = v_start - 3000);
    r := pg_temp.fl(ref1, 'failed', 'weird failed after success');
    v_res := v_res || pg_temp.t('E1 success -> failed is REFUSED (ok false, refused true); status stays success; no money moved',
      r ->> 'ok' = 'false' and r ->> 'refused' = 'true' and pg_temp.wst(ref1) = 'success' and pg_temp.bal(ua) = v_start - 3000 and pg_temp.n_refund(ref1) = 0, r::text);
    v_res := v_res || pg_temp.t('E2 ...and the refusal is recorded on the row (ANOMALY text in failure_reason)',
      (select failure_reason from public.withdrawals where reference = ref1) like '%ANOMALY: failure reported after a successful payout%');
    perform pg_temp.fl(ref1, 'failed', 'weird again');
    v_res := v_res || pg_temp.t('E3 refusing twice records the anomaly only ONCE',
      (select length(failure_reason) - length(replace(failure_reason, 'ANOMALY', '')) from public.withdrawals where reference = ref1) = length('ANOMALY'));
    r := pg_temp.fl(ref1, 'reversed', 'Transfer reversed by the bank');
    v_res := v_res || pg_temp.t('E4 success -> reversed IS allowed: refunded once, wallet back to 100000, status reversed',
      r ->> 'applied' = 'true' and r ->> 'from_status' = 'success' and pg_temp.wst(ref1) = 'reversed' and pg_temp.bal(ua) = v_start and pg_temp.n_refund(ref1) = 1, r::text);
    v_res := v_res || pg_temp.t('E5 the ledger row moved from completed to failed with a reversed note',
      pg_temp.lst(ref1) = 'failed' and (select note from public.wallet_transactions where reference = ref1 and type = 'withdrawal') like '%was reversed%');
    v_res := v_res || pg_temp.t('E6 two notifications for it: "Withdrawal sent", then "Withdrawal reversed"',
      pg_temp.n_note(ua, ref1) = 2
      and exists (select 1 from public.notifications where user_id = ua and data ->> 'reference' = ref1 and title = 'Withdrawal sent')
      and exists (select 1 from public.notifications where user_id = ua and data ->> 'reference' = ref1 and title = 'Withdrawal reversed'));
    r := pg_temp.fl(ref1, 'reversed', 'duplicate reversal');
    v_res := v_res || pg_temp.t('E7 reversed delivered twice: second is a no-op, still ONE refund, wallet still 100000',
      r ->> 'applied' = 'false' and pg_temp.n_refund(ref1) = 1 and pg_temp.bal(ua) = v_start and pg_temp.n_note(ua, ref1) = 2, r::text);
    r := pg_temp.su(ref1, 'TRF_e1');
    v_res := v_res || pg_temp.t('E8 reversed -> success is REFUSED and recorded; status stays reversed; wallet unchanged',
      r ->> 'ok' = 'false' and r ->> 'refused' = 'true' and pg_temp.wst(ref1) = 'reversed' and pg_temp.bal(ua) = v_start
      and (select failure_reason from public.withdrawals where reference = ref1) like '%ANOMALY: success reported after the money was already returned%', r::text);
    ref2 := pg_temp.mk(ua, 2500, a1);
    perform pg_temp.fl(ref2, 'failed', 'rejected');
    r := pg_temp.su(ref2, 'TRF_e2');
    v_res := v_res || pg_temp.t('E9 failed -> success is REFUSED and recorded; ledger stays failed; no notification "sent"',
      r ->> 'refused' = 'true' and pg_temp.wst(ref2) = 'failed' and pg_temp.lst(ref2) = 'failed' and pg_temp.bal(ua) = v_start
      and not exists (select 1 from public.notifications where user_id = ua and data ->> 'reference' = ref2 and title = 'Withdrawal sent'), r::text);
    v_res := v_res || pg_temp.t('E10 ...and the refused success did not store its transfer code',
      (select paystack_transfer_code from public.withdrawals where reference = ref2) is null);
    r := pg_temp.su(ref2, 'TRF_e2');
    v_res := v_res || pg_temp.t('E11 refusing the same late success twice records the anomaly only ONCE',
      (select length(failure_reason) - length(replace(failure_reason, 'ANOMALY', '')) from public.withdrawals where reference = ref2) = length('ANOMALY'));

    -- F. a refund row that already exists blocks a second credit ---------------------------------
    perform pg_temp.setbal(ua, v_start);
    ref1 := pg_temp.mk(ua, 2000, a1);
    insert into public.wallet_transactions (user_id, type, amount, reference, status, note)
      values (ua, 'withdrawal_refund', 2000, ref1 || '-refund', 'completed', 'rogue refund row (test)');
    r := pg_temp.fl(ref1, 'failed', 'x');
    v_res := v_res || pg_temp.t('F1 if a refund row already exists, nothing more is credited and the call says refused',
      r ->> 'ok' = 'false' and r ->> 'refused' = 'true' and pg_temp.bal(ua) = v_start - 2000, r::text);
    v_res := v_res || pg_temp.t('F2 ...and the withdrawal was left as it was (pending), not half-settled',
      pg_temp.wst(ref1) = 'pending' and pg_temp.lst(ref1) = 'pending');
    delete from public.wallet_transactions where reference = ref1 || '-refund';
    perform pg_temp.fl(ref1, 'failed', 'cleanup');

    -- G. the ledger adds up ----------------------------------------------------------------------
    perform pg_temp.setbal(ua, v_start);
    delete from public.notifications where user_id = ua;
    delete from public.wallet_transactions where user_id = ua;
    delete from public.withdrawals where user_id = ua;
    ref1 := pg_temp.mk(ua, 1000, a1); perform pg_temp.mp(ref1, 'TRF_g1', 'RCP_g'); perform pg_temp.su(ref1, 'TRF_g1');                 -- paid out
    ref2 := pg_temp.mk(ua, 2000, a1); perform pg_temp.mp(ref2, 'TRF_g2', 'RCP_g'); perform pg_temp.fl(ref2, 'failed', 'declined');     -- refunded
    ref3 := pg_temp.mk(ua, 3000, a1); perform pg_temp.mp(ref3, 'TRF_g3', 'RCP_g'); perform pg_temp.su(ref3, 'TRF_g3'); perform pg_temp.fl(ref3, 'reversed', 'bank reversed'); perform pg_temp.fl(ref3, 'reversed', 'dup'); -- paid then returned
    ref4 := pg_temp.mk(ua, 4000, a1); perform pg_temp.fl(ref4, 'failed', 'rejected'); perform pg_temp.fl(ref4, 'failed', 'rejected again');           -- rejected at once
    ref5 := pg_temp.mk(ua, 5000, a1); perform pg_temp.mp(ref5, 'TRF_g5', 'RCP_g');                                                      -- still processing
    v_res := v_res || pg_temp.t('G1 wallet = 100000 - 1000 (paid) - 5000 (still processing) = 94000', pg_temp.bal(ua) = 94000, pg_temp.bal(ua)::text);
    select coalesce(sum(case when type = 'withdrawal' then -amount when type = 'withdrawal_refund' then amount else 0 end), 0)
      into v_sum from public.wallet_transactions where user_id = ua;
    v_res := v_res || pg_temp.t('G2 start + (refunds - debits) over the ledger = the wallet balance, to the naira', v_start + v_sum = pg_temp.bal(ua), (v_start + v_sum)::text);
    v_res := v_res || pg_temp.t('G3 every withdrawal has at most ONE refund row',
      not exists (select 1 from public.wallet_transactions where user_id = ua and type = 'withdrawal_refund' group by reference having count(*) > 1)
      and (select count(*) from public.wallet_transactions where user_id = ua and type = 'withdrawal_refund') = 3);
    v_res := v_res || pg_temp.t('G4 statuses: success / failed / reversed / failed / processing',
      array[pg_temp.wst(ref1), pg_temp.wst(ref2), pg_temp.wst(ref3), pg_temp.wst(ref4), pg_temp.wst(ref5)]
        = array['success', 'failed', 'reversed', 'failed', 'processing']);
    v_res := v_res || pg_temp.t('G5 ledger statuses: completed / failed / failed / failed / processing',
      array[pg_temp.lst(ref1), pg_temp.lst(ref2), pg_temp.lst(ref3), pg_temp.lst(ref4), pg_temp.lst(ref5)]
        = array['completed', 'failed', 'failed', 'failed', 'processing']);
    v_res := v_res || pg_temp.t('G6 money kept inside the platform books: the sum of what was paid out (open + success) is 6000 (1000 + 5000)',
      (select coalesce(sum(amount), 0) from public.withdrawals where user_id = ua and status in ('processing', 'success')) = 6000);
    -- the 24h allowance: failed and reversed free it again (W2b counts pending + processing + success only)
    v_res := v_res || pg_temp.t('G7 the daily allowance counts only the 6000 that is really out (failed and reversed freed it)',
      (select coalesce(sum(amount), 0) from public.withdrawals where user_id = ua and status in ('pending', 'processing', 'success')
         and created_at > now() - interval '24 hours') = 6000);

    -- H. stuck list ------------------------------------------------------------------------------
    perform pg_temp.fl(ref5, 'failed', 'cleanup');         -- close the open one so a new old-looking one can exist
    ref1 := pg_temp.mk(ua, 1000, a1);
    update public.withdrawals set created_at = now() - interval '20 minutes' where reference = ref1;
    select count(*) into v_n from public.withdrawal_stuck_list(15) s where s.reference = ref1;
    v_res := v_res || pg_temp.t('H1 a pending withdrawal 20 minutes old is in the stuck list (15 min)', v_n = 1);
    select count(*) into v_n from public.withdrawal_stuck_list(30) s where s.reference = ref1;
    v_res := v_res || pg_temp.t('H2 ...and not in a 30 minute list', v_n = 0);
    select count(*) into v_n from public.withdrawal_stuck_list(null) s where s.reference = ref1;
    v_res := v_res || pg_temp.t('H3 a null minutes argument means 15', v_n = 1);
    select count(*) into v_n from public.withdrawal_stuck_list(0) s where s.reference = ref1;
    v_res := v_res || pg_temp.t('H4 a zero or negative argument is raised to 1 minute (it is listed, nothing breaks)', v_n = 1);
    select count(*) into v_n from public.withdrawal_stuck_list(-50) s where s.reference = ref1;
    v_res := v_res || pg_temp.t('H5 negative minutes: same', v_n = 1);
    perform pg_temp.mp(ref1, 'TRF_h1', 'RCP_h');
    select count(*) into v_n from public.withdrawal_stuck_list(15) s where s.reference = ref1 and s.status = 'processing' and s.age_minutes >= 20;
    v_res := v_res || pg_temp.t('H6 a processing withdrawal is listed too, with its age in minutes', v_n = 1);
    select count(*) into v_n from pg_proc p
     where p.proname = 'withdrawal_stuck_list'
       and (array_to_string(p.proargnames, ',') like '%account_number%' or array_to_string(p.proargnames, ',') like '%recipient_code%');
    v_res := v_res || pg_temp.t('H7 the stuck list has no full account number and no recipient code column', v_n = 0);
    perform pg_temp.su(ref1, 'TRF_h1');
    select count(*) into v_n from public.withdrawal_stuck_list(1) s where s.reference = ref1;
    v_res := v_res || pg_temp.t('H8 once it is success it is no longer listed', v_n = 0);
    select count(*) into v_n from public.withdrawal_stuck_list(1) s where s.reference in (ref2, ref3, ref4);
    v_res := v_res || pg_temp.t('H9 failed / reversed withdrawals are never listed', v_n = 0);
    ref2 := pg_temp.mk(ua, 1200, a1);                      -- fresh, 0 minutes old
    select count(*) into v_n from public.withdrawal_stuck_list(15) s where s.reference = ref2;
    v_res := v_res || pg_temp.t('H10 a brand-new pending withdrawal is NOT listed (15 min)', v_n = 0);
    perform pg_temp.fl(ref2, 'failed', 'cleanup');

    -- I. nothing about the money tables was loosened ------------------------------------------------
    foreach v_t in array array['wallets', 'wallet_transactions', 'escrow_payments', 'payment_intents', 'withdrawals', 'withdrawal_bank_accounts'] loop
      if to_regclass('public.' || v_t) is not null then
        v_res := v_res || pg_temp.t('browser has no write access on ' || v_t,
          not (has_table_privilege('authenticated', 'public.' || v_t, 'INSERT')
            or has_table_privilege('authenticated', 'public.' || v_t, 'UPDATE')
            or has_table_privilege('authenticated', 'public.' || v_t, 'DELETE')));
      end if;
    end loop;

    raise exception 'w2c_done';       -- undo every test row and every balance change
  exception when others then
    if sqlerrm <> 'w2c_done' then
      v_res := v_res || ('FAIL | the test run itself crashed: SQLSTATE ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  select count(*) filter (where x like 'PASS |%'), count(*) filter (where x like 'FAIL |%')
    into v_pass, v_fail from unnest(v_res) as x;
  return next 'SUMMARY | W2c-1: ' || v_pass || ' passed, ' || v_fail || ' failed';
  foreach v_t in array v_res loop
    return next v_t;
  end loop;
end $fn$;

select * from pg_temp.w2c_run();

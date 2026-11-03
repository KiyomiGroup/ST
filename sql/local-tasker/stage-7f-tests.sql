-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7F tests (coordinators use the tasker wallet and withdrawals).
-- WRITTEN, NEVER RUN (no Postgres was available when it was written: the first real run may need a small fix).
-- Requires the withdrawal SQL (W2a, W2b, W2c-settle, W2d) AND stage-7f-core.sql.
-- Select the WHOLE file and press Run in the Supabase SQL editor.
-- It makes throwaway people and a throwaway wallet, calls the withdrawal functions as the SERVER does, and ROLLS EVERYTHING
-- BACK by raising an error on purpose: an error box that starts "STAGE 7F TESTS" and ends "RESULT: ALL PASS" is the NORMAL result.
-- A "SKIP:" line means a check could not run in this project: a SKIP is NOT a pass. An "INFO:" line is a finding, not a test.
-- No money moves, no Paystack call, no transfer. Nothing is left behind.
-- ============================================================================
do $$
declare
  v_out text := ''; v_have boolean := true; v_err text; v_n int;
  cA uuid := gen_random_uuid();      -- active coordinator WITH a public.users row
  cB uuid := gen_random_uuid();      -- active coordinator WITHOUT a public.users row (shows whether that matters)
  cS uuid := gen_random_uuid();      -- coordinator who is switched off
  cust uuid := gen_random_uuid();    -- a plain customer
  v_tasker uuid; v_res jsonb; v_acct uuid; v_lim jsonb; v_min numeric; v_before numeric; v_after numeric; v_code text; v_msg text;
  v_fn text; v_def text;
begin
  -- 1. the helper: exists, security definer, closed to browsers ------------------------------------------------------
  v_out := v_out || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.is_wallet_owner(uuid)') and p.prosecdef) then 'PASS: ' else 'FAIL: ' end || 'is_wallet_owner(uuid) exists and is security definer' || E'\n';
  v_out := v_out || case when has_function_privilege('anon', 'public.is_wallet_owner(uuid)', 'execute') or has_function_privilege('authenticated', 'public.is_wallet_owner(uuid)', 'execute') then 'FAIL: ' else 'PASS: ' end || 'browsers (anon and signed-in) cannot execute the helper' || E'\n';
  v_out := v_out || case when exists (select 1 from pg_roles where rolname = 'service_role') and has_function_privilege('service_role', 'public.is_wallet_owner(uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end || 'service_role can execute the helper' || E'\n';

  -- 2. the five functions carry the one-line change and nothing else about taskers was left in that spot ---------------
  foreach v_fn in array array['withdrawal_create', 'bank_account_add', 'bank_account_set_default', 'bank_account_remove', 'bank_account_set_recipient'] loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn;
    v_out := v_out || case when v_def like '%if not public.is_wallet_owner(p_user) then%' and v_def not like '%from public.taskers t where t.user_id::text = p_user::text%' then 'PASS: ' else 'FAIL: ' end
          || v_fn || ' now asks is_wallet_owner and the old taskers-only line is gone' || E'\n';
  end loop;

  -- 3. throwaway people ---------------------------------------------------------------------------------------------
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st7f-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cS, cust]) as u;
  insert into public.users (id, name, role, profile_details) values
    (cA, 'ST7F coordinator A', 'customer', '{}'), (cS, 'ST7F coordinator S', 'customer', '{}'), (cust, 'ST7F customer', 'customer', '{}')
  on conflict (id) do nothing;
  begin
    insert into public.coordinators (user_id, display_name, status) values (cA, 'ST7F A', 'active'), (cB, 'ST7F B', 'active'), (cS, 'ST7F S', 'active');
    update public.coordinators set status = 'inactive' where user_id = cS;
  exception when others then v_have := false; v_err := sqlerrm; end;

  if not v_have then
    v_out := v_out || 'SKIP: could not create throwaway coordinators in this project (' || coalesce(v_err, '?') || '), so the behaviour checks did not run' || E'\n';
  else
    -- 4. the helper's answers
    v_out := v_out || case when public.is_wallet_owner(cA) then 'PASS: ' else 'FAIL: ' end || 'an active coordinator is a wallet owner' || E'\n';
    v_out := v_out || case when not public.is_wallet_owner(cS) then 'PASS: ' else 'FAIL: ' end || 'a coordinator who is switched off is NOT a wallet owner' || E'\n';
    v_out := v_out || case when not public.is_wallet_owner(cust) then 'PASS: ' else 'FAIL: ' end || 'a customer is NOT a wallet owner' || E'\n';
    v_out := v_out || case when not public.is_wallet_owner(gen_random_uuid()) then 'PASS: ' else 'FAIL: ' end || 'an unknown person is NOT a wallet owner' || E'\n';
    v_out := v_out || case when not public.is_wallet_owner(null) then 'PASS: ' else 'FAIL: ' end || 'null is NOT a wallet owner' || E'\n';
    select t.user_id into v_tasker from public.taskers t order by t.user_id limit 1;
    if v_tasker is null then v_out := v_out || 'SKIP: no tasker exists in this project, so "a tasker is still a wallet owner" was not checked' || E'\n';
    else v_out := v_out || case when public.is_wallet_owner(v_tasker) then 'PASS: ' else 'FAIL: ' end || 'a real tasker is still a wallet owner (unchanged)' || E'\n'; end if;

    -- 5. refusals, as the server calls them (the database decides, not the page)
    -- bank_account_add: customer, switched-off coordinator, unknown person -> WA001
    v_code := null; begin perform public.bank_account_add(cust, '058', 'Test Bank', '0123456789', 'TEST PERSON'); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WA001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'a customer cannot save a bank account (WA001)' || E'\n';
    v_code := null; begin perform public.bank_account_add(cS, '058', 'Test Bank', '0123456789', 'TEST PERSON'); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WA001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'a switched-off coordinator cannot save a bank account (WA001)' || E'\n';
    v_code := null; begin perform public.bank_account_add(gen_random_uuid(), '058', 'Test Bank', '0123456789', 'TEST PERSON'); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WA001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'an unknown person cannot save a bank account (WA001)' || E'\n';
    v_code := null; begin perform public.bank_account_set_default(cust, gen_random_uuid()); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WA001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'a customer cannot set a default account (WA001)' || E'\n';
    v_code := null; begin perform public.bank_account_remove(cS, gen_random_uuid()); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WA001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'a switched-off coordinator cannot remove an account (WA001)' || E'\n';
    v_code := null; begin perform public.bank_account_set_recipient(cust, gen_random_uuid(), 'RCP_test'); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WA001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'a customer cannot attach a recipient code (WA001)' || E'\n';
    v_code := null; begin perform public.withdrawal_create(cust, 1000, gen_random_uuid()); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WD001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'a customer cannot withdraw (WD001)' || E'\n';
    v_code := null; begin perform public.withdrawal_create(cS, 1000, gen_random_uuid()); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WD001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'a switched-off coordinator cannot withdraw (WD001)' || E'\n';
    v_code := null; begin perform public.withdrawal_create(gen_random_uuid(), 1000, gen_random_uuid()); v_code := 'no error'; exception when others then v_code := sqlstate; end;
    v_out := v_out || case when v_code = 'WD001' then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || '): ' end || 'an unknown person cannot withdraw (WD001)' || E'\n';

    -- 6. an ACTIVE coordinator (with a public.users row) saves an account and asks for a withdrawal within the limits
    v_res := null; v_code := null;
    begin v_res := public.bank_account_add(cA, '058', 'Test Bank', '0123456789', 'TEST PERSON'); exception when others then v_code := sqlstate; v_msg := sqlerrm; end;
    v_out := v_out || case when v_res ->> 'id' is not null then 'PASS: ' else 'FAIL(' || coalesce(v_code, '?') || ' ' || coalesce(v_msg, '') || '): ' end || 'an active coordinator can save a bank account' || E'\n';
    v_out := v_out || case when v_res is not null and not (v_res::text like '%0123456789%') then 'PASS: ' else 'FAIL: ' end || 'the answer holds the last 4 digits only, never the full number' || E'\n';
    if v_res ->> 'id' is not null then
      v_acct := (v_res ->> 'id')::uuid;
      v_lim := public.withdrawal_limits(); v_min := coalesce((v_lim ->> 'min_amount')::numeric, 1000);
      perform public._ensure_wallet(cA);
      update public.wallets set balance = v_min * 3 where user_id = cA;
      select balance into v_before from public.wallets where user_id = cA;
      v_res := null; v_code := null; v_msg := null;
      begin v_res := public.withdrawal_create(cA, v_min, v_acct); exception when others then v_code := sqlstate; v_msg := sqlerrm; end;
      select balance into v_after from public.wallets where user_id = cA;
      if v_res is not null then
        v_out := v_out || 'PASS: an active coordinator can ask for a withdrawal of the minimum (' || v_min || ')' || E'\n';
        v_out := v_out || case when v_after < v_before then 'PASS: ' else 'FAIL: ' end || 'the wallet balance went down when the withdrawal was created (' || v_before || ' to ' || v_after || ')' || E'\n';
        v_out := v_out || case when exists (select 1 from public.withdrawals w where w.user_id = cA) then 'PASS: ' else 'FAIL: ' end || 'a withdrawal row exists for the coordinator (undone at the end)' || E'\n';
      elsif v_code in ('WD001', 'WA001') then
        v_out := v_out || 'FAIL(' || v_code || '): the role check still refused an active coordinator' || E'\n';
      else
        v_out := v_out || 'INFO: withdrawal_create got PAST the role check but refused for another reason (' || coalesce(v_code, '?') || ': ' || coalesce(v_msg, '') || '). Read it: if it is the "clearing" rule or a cooldown, that is that rule working, not 7F failing.' || E'\n';
      end if;
      -- a SECOND coordinator without a public.users row
      v_res := null; v_code := null; v_msg := null;
      begin v_res := public.bank_account_add(cB, '058', 'Test Bank', '0234567891', 'TEST PERSON'); exception when others then v_code := sqlstate; v_msg := sqlerrm; end;
      v_out := v_out || case when v_res ->> 'id' is not null then 'INFO: a coordinator with NO public.users row can also save an account' else 'INFO: a coordinator with NO public.users row could NOT save an account (' || coalesce(v_code, '?') || ': ' || coalesce(v_msg, '') || '). If you see 23503 here, some real coordinators may need a public.users row; tell the AI.' end || E'\n';
    else
      v_out := v_out || 'SKIP: no saved account, so the withdrawal check could not run' || E'\n';
    end if;

    -- 7. a real tasker still passes the role check (rolled back)
    if v_tasker is not null then
      v_code := null; begin perform public.withdrawal_create(v_tasker, 1000, gen_random_uuid()); v_code := 'no error'; exception when others then v_code := sqlstate; end;
      v_out := v_out || case when v_code is distinct from 'WD001' then 'PASS: ' else 'FAIL: ' end || 'a real tasker still passes the role check in withdrawal_create (got ' || coalesce(v_code, '?') || ', anything but WD001 is right here)' || E'\n';
    end if;

    -- 8. no taskers row was made for any coordinator, test or real
    select count(*) into v_n from public.taskers t where t.user_id::text in (select c.user_id::text from public.coordinators c);
    v_out := v_out || case when v_n = 0 then 'PASS: ' else 'FAIL(' || v_n || '): ' end || 'no coordinator has a row in public.taskers (query: taskers joined to coordinators)' || E'\n';
  end if;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 7F TESTS\n%', v_out;
end $$;

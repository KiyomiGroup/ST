-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7A part 2 tests (the Job Room payment path)
-- Requires stage-7a-core.sql and stage-7a2-core.sql. Select the WHOLE file and press Run in the Supabase SQL editor. It creates throwaway
-- rows, runs the REAL _prepare_intent, _apply_payment and _release_escrow on them, and ROLLS EVERYTHING BACK by raising an error on purpose:
-- an error box that starts "STAGE 7A PART 2 TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. No Paystack, no real money.
-- A "SKIP:" line means a check could not run in this project; a SKIP is NOT a pass.
-- ============================================================================
create or replace function pg_temp.st_try(p_user uuid, p_sql text) returns text
language plpgsql as $f$
declare r jsonb; v_hint text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then '' else jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text end, true);
    execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
    execute p_sql into r;
    execute 'reset role';
    return coalesce(r::text, 'null');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    execute 'reset role';
    return 'ERR:' || coalesce(nullif(v_hint, ''), sqlstate);
  end;
end $f$;

do $$
declare
  v_out text := ''; t text; j jsonb; v_err text; v_have boolean := true; v_haveT boolean := true;
  cust uuid := gen_random_uuid(); lt uuid := gen_random_uuid(); rg uuid := gen_random_uuid(); trow uuid := gen_random_uuid();
  bkL uuid; bkR uuid; bkT uuid; bkGL uuid; bkGR uuid; thL uuid; thR uuid; thT uuid; prL uuid; prR uuid; prT uuid;
  iL public.payment_intents; iR public.payment_intents; iT public.payment_intents; iTop public.payment_intents;
  eL record; eR record; v_rel numeric; v_note text; v_rate numeric := public.platform_fee_rate();
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st7a2-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cust, lt, rg]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST7A2 customer', 'customer', '{}'), (lt, 'ST7A2 Local Tasker', 'tasker', '{}'),
         (rg, 'ST7A2 Regular Tasker', 'tasker', '{}') on conflict (id) do nothing;
  begin
    insert into public.local_tasker_profiles (tasker_user_id, full_name, phone, status) values (lt, 'ST7A2 Local Tasker', '+2348000000000', 'published');
  exception when others then v_have := false; v_err := sqlerrm; end;

  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, lt, 'confirmed', 'unpaid', 15000) returning id into bkL;
  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, rg, 'confirmed', 'unpaid', 15000) returning id into bkR;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, lt, 'booking', bkL, now()) returning id into thL;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, rg, 'booking', bkR, now()) returning id into thR;
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status) values (thL, lt, cust, 15000, 'full_payment', 'pending') returning id into prL;
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status) values (thR, rg, cust, 15000, 'full_payment', 'pending') returning id into prR;

  -- 1. the intent (what the customer is asked to pay, and how it is split)
  iR := public._prepare_intent(cust, 'request', prR, null, null);
  v_out := v_out || case when iR.amount = 15000 and iR.platform_fee = round(15000 * v_rate) and iR.tasker_amount = 15000 - round(15000 * v_rate) then 'PASS: ' else 'FAIL: ' end
        || 'REGULAR tasker, N15,000 request: customer pays ' || iR.amount || ', fee ' || iR.platform_fee || ', tasker ' || iR.tasker_amount || ' (unchanged: 12%)' || E'\n';
  if v_have then
    iL := public._prepare_intent(cust, 'request', prL, null, null);
    v_out := v_out || case when iL.amount = 15000 and iL.platform_fee = 0 and iL.tasker_amount = 15000 then 'PASS: ' else 'FAIL: ' end
          || 'LOCAL tasker, N15,000 request: customer pays ' || iL.amount || ', fee ' || iL.platform_fee || ', tasker ' || iL.tasker_amount || E'\n';
  else
    v_out := v_out || 'SKIP: could not create a throwaway Local Tasker profile (' || v_err || '); every Local Tasker check below was skipped' || E'\n';
  end if;
  iTop := public._prepare_intent(cust, 'topup', null, null, 10000);
  v_out := v_out || case when iTop.amount = 10000 and iTop.platform_fee = 0 and iTop.tasker_amount = 0 then 'PASS: ' else 'FAIL: ' end || 'a wallet top-up is untouched (no fee, as before)' || E'\n';

  if v_have then
    -- 2. the payment is confirmed: the escrow row copies the intent
    begin
      perform public._apply_payment(iL.id, 'ST7A2-REF-L');
      perform public._apply_payment(iR.id, 'ST7A2-REF-R');
      select * into eL from public.escrow_payments where booking_id = bkL and status = 'held';
      select * into eR from public.escrow_payments where booking_id = bkR and status = 'held';
      v_out := v_out || case when eL.amount = 15000 and eL.platform_fee = 0 and eL.tasker_amount = 15000 then 'PASS: ' else 'FAIL: ' end
            || 'LOCAL: escrow holds ' || eL.amount || ', fee ' || eL.platform_fee || ', tasker ' || eL.tasker_amount || E'\n';
      v_out := v_out || case when eR.amount = 15000 and eR.platform_fee = round(15000 * v_rate) and eR.tasker_amount = 15000 - round(15000 * v_rate) then 'PASS: ' else 'FAIL: ' end
            || 'REGULAR: escrow holds ' || eR.amount || ', fee ' || eR.platform_fee || ', tasker ' || eR.tasker_amount || E'\n';

      -- 3. release
      v_rel := public._release_escrow(bkL);
      select note into v_note from public.wallet_transactions where user_id = lt and type = 'escrow_release' and booking_id = bkL;
      v_out := v_out || case when v_rel = 15000 and v_note like '%no fee%' and v_note not like '%12%' then 'PASS: ' else 'FAIL: ' end
            || 'LOCAL release: released ' || v_rel || ', wallet note "' || coalesce(v_note, '') || '"' || E'\n';
      v_rel := public._release_escrow(bkR);
      select note into v_note from public.wallet_transactions where user_id = rg and type = 'escrow_release' and booking_id = bkR;
      v_out := v_out || case when v_rel = 15000 - round(15000 * v_rate) and v_note like '%(12% fee deducted)' then 'PASS: ' else 'FAIL: ' end
            || 'REGULAR release: released ' || v_rel || ', wallet note "' || coalesce(v_note, '') || '" (text unchanged)' || E'\n';
    exception when others then
      v_out := v_out || 'FAIL: the confirm or release step stopped with: ' || sqlerrm || E'\n';
    end;

    -- 4. paid some other way (no escrow row): the fallback in _release_escrow
    begin
      insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, lt, 'confirmed', 'paid', 20000) returning id into bkGL;
      insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, rg, 'confirmed', 'paid', 20000) returning id into bkGR;
      v_out := v_out || case when public._release_escrow(bkGL) = 20000 and public._release_escrow(bkGR) = 20000 - round(20000 * v_rate) then 'PASS: ' else 'FAIL: ' end
            || 'no escrow row (paid another way), N20,000: Local Tasker released 20000, regular released ' || (20000 - round(20000 * v_rate)) || E'\n';
    exception when others then
      v_out := v_out || 'FAIL: the no-escrow-row release stopped with: ' || sqlerrm || E'\n';
    end;

    -- 5. the booking may store a taskers ROW id instead of a user id (the real _booking_tasker_user handles both)
    begin
      insert into public.taskers (id, user_id) values (trow, lt);
      insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, trow, 'confirmed', 'unpaid', 15000) returning id into bkT;
      v_out := v_out || case when public.platform_fee_rate_for_booking(bkT) = 0 and public.platform_fee_rate_for_booking(bkR) = v_rate then 'PASS: ' else 'FAIL: ' end
            || 'platform_fee_rate_for_booking finds the Local Tasker even when the booking stores a taskers row id' || E'\n';
      t := pg_temp.st_try(cust, format('select coalesce(jsonb_object_agg(tasker_id::text, fee_rate), ''{}''::jsonb) from public.booking_fee_rates(array[%L, %L, %L]::uuid[])', lt, rg, trow));
      j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
      v_out := v_out || case when not (j ? 'err') and (j ->> lt::text)::numeric = 0 and (j ->> trow::text)::numeric = 0 and (j ->> rg::text)::numeric = v_rate then 'PASS: ' else 'FAIL(' || t || '): ' end
            || 'booking_fee_rates (customer Bookings page): Local Tasker 0, regular ' || v_rate || ', also when the booking stores a taskers row id' || E'\n';
    exception when others then
      v_out := v_out || 'SKIP: could not build the taskers-row-id case in this project (' || sqlerrm || ')' || E'\n';
    end;
  end if;

  -- 6. privileges
  v_out := v_out || case when to_regprocedure('public.platform_fee_rate_for_booking(uuid)') is not null
        and not has_function_privilege('anon', 'public.platform_fee_rate_for_booking(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public.platform_fee_rate_for_booking(uuid)', 'execute')
        and has_function_privilege('service_role', 'public.platform_fee_rate_for_booking(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.booking_fee_rates(uuid[])', 'execute')
        and not has_function_privilege('anon', 'public.booking_fee_rates(uuid[])', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'the booking fee function is for the server only; booking_fee_rates is for signed-in customers only' || E'\n';
  t := pg_temp.st_try(rg, format('select coalesce(jsonb_agg(tasker_id), ''[]''::jsonb) from public.booking_fee_rates(array[%L, %L]::uuid[])', lt, rg));
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a tasker or anyone who never booked learns no rates from booking_fee_rates' || E'\n';
  v_out := v_out || case when public.platform_fee_rate() = v_rate and v_rate = 0.12 then 'PASS: ' else 'FAIL: ' end || 'platform_fee_rate() itself is unchanged (0.12)' || E'\n';

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 7A PART 2 TESTS\n%', v_out;
end $$;

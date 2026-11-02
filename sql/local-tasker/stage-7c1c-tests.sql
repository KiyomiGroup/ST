-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7C-1c tests (the read function behind the code-entry card). Requires stage-7c1c-core.sql and stage-7c1b-core.sql.
-- Select the WHOLE file and press Run. Throwaway rows, REAL payment path, calls made AS the coordinator. Everything is ROLLED BACK by an error on purpose:
-- an error box that starts "STAGE 7C-1C TESTS" and ends "RESULT: ALL PASS" is NORMAL. No Paystack, no real money. A SKIP is NOT a pass.
-- NOT covered: consent_revoked (needs consent rows whose columns are not known to me); the card in a browser (see the browser tests).
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

-- Builds one paid booking through the REAL path: booking, thread, payment request, intent, confirmed payment (escrow row held).
create or replace function pg_temp.st_mk(p_cust uuid, p_tasker uuid, p_amount numeric, p_coord uuid, p_pay boolean) returns uuid
language plpgsql as $f$
declare bk uuid; th uuid; pr uuid; i public.payment_intents;
begin
  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount)
    values (p_cust, p_tasker, 'confirmed', case when p_pay then 'unpaid' else 'paid' end, p_amount) returning id into bk;
  if p_coord is not null then
    -- The real project creates this row by itself when a booking is made for a Local Tasker, so UPDATE it if it exists and insert only if it does not.
    update public.local_booking_state set tasker_user_id = p_tasker, coordinator_id = p_coord, original_coordinator_id = p_coord, lt_status = 'assigned' where booking_id = bk;
    if not found then
      insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values (bk, p_tasker, p_coord, p_coord, 'assigned');
    end if;
  end if;
  if p_pay then
    insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (p_cust, p_tasker, 'booking', bk, now()) returning id into th;
    insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status) values (th, p_tasker, p_cust, p_amount, 'full_payment', 'pending') returning id into pr;
    i := public._prepare_intent(p_cust, 'request', pr, null, null);
    perform public._apply_payment(i.id, 'ST7E-' || substr(bk::text, 1, 8));
  end if;
  return bk;
end $f$;

do $$
declare
  v_out text := ''; t text; v_err text; v_have boolean := true;
  cust uuid := gen_random_uuid(); lt uuid := gen_random_uuid(); cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid();
  bk uuid; v_code text; v_dis uuid; n int; a int; before_row text; after_row text; v_other text;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st7c1c-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cust, lt, cA, cB]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST7C1C customer', 'customer', '{}'), (lt, 'ST7C1C Local Tasker', 'tasker', '{}') on conflict (id) do nothing;
  begin
    insert into public.local_tasker_profiles (tasker_user_id, full_name, phone, status) values (lt, 'ST7C1C Local Tasker', '+2348000000000', 'published');
    insert into public.coordinators (user_id, display_name, status) values (cA, 'ST7C1C A', 'active'), (cB, 'ST7C1C B', 'active');
  exception when others then v_have := false; v_err := sqlerrm; end;

  if not v_have then
    v_out := v_out || 'SKIP: could not create a throwaway Local Tasker or coordinators (' || v_err || '); every check was skipped' || E'\n';
  else
    -- A. unpaid
    bk := pg_temp.st_mk(cust, lt, 10000, cA, false);
    update public.bookings set payment_status = 'unpaid' where id = bk;
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like '%"state": "not_paid"%' and t like '%"remaining": 3%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unpaid booking says not_paid with 3 attempts' || E'\n';
    foreach v_other in array array['pending', 'refunded'] loop
      update public.bookings set payment_status = v_other where id = bk;
      t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
      v_out := v_out || case when t like '%"state": "not_paid"%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'payment status ' || v_other || ' says not_paid (the card never offers the field)' || E'\n';
    end loop;

    -- B. paid and held: ready, no code in the answer, nothing written
    bk := pg_temp.st_mk(cust, lt, 50000, cA, true);
    select completion_code into v_code from public.booking_secrets where booking_id = bk;
    select to_jsonb(b)::text into before_row from public.bookings b where b.id = bk;
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
    select to_jsonb(b)::text into after_row from public.bookings b where b.id = bk;
    v_out := v_out || case when t like '%"state": "ready"%' and t like '%"remaining": 3%' and v_code is not null and t not like '%' || v_code || '%' then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'a paid booking says ready with 3 attempts and the answer does not contain the code' || E'\n';
    v_out := v_out || case when before_row = after_row then 'PASS: ' else 'FAIL: ' end || 'reading the state changed nothing on the booking' || E'\n';
    v_out := v_out || case when t not like '%amount%' and t not like '%code%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the answer carries only state and remaining (no amount, no code field)' || E'\n';

    -- C. who may read
    t := pg_temp.st_try(cB, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like 'ERR:not_found%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot read it' || E'\n';
    t := pg_temp.st_try(cust, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot read it' || E'\n';
    t := pg_temp.st_try(null, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-out visitor cannot read it' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', gen_random_uuid()));
    v_out := v_out || case when t like 'ERR:not_found%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unknown booking is not_found' || E'\n';

    -- D. attempts count down, then locked (the state agrees with what the real submit call does)
    t := pg_temp.st_try(cA, format('select public.local_booking_submit_code(%L, %L)', bk, case when v_code = '000000' then '111111' else '000000' end));
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like '%"state": "ready"%' and t like '%"remaining": 2%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after one wrong code: ready, 2 attempts left' || E'\n';
    for n in 1..2 loop
      t := pg_temp.st_try(cA, format('select public.local_booking_submit_code(%L, %L)', bk, case when v_code = '000000' then '111111' else '000000' end));
    end loop;
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like '%"state": "locked"%' and t like '%"remaining": 0%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after three wrong codes: locked, 0 attempts left' || E'\n';

    -- E. frozen: the cheap way (status disputed), then a REAL problem report
    bk := pg_temp.st_mk(cust, lt, 10000, cA, true);
    update public.bookings set status = 'disputed' where id = bk;
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like '%"state": "frozen"%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a disputed booking says frozen' || E'\n';
    bk := pg_temp.st_mk(cust, lt, 10000, cA, true);
    t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''other'', ''Reporting a problem so that the booking is frozen'')', bk, gen_random_uuid()));
    select d.id into v_dis from public.job_disputes d join public.message_threads m on m.id = d.thread_id where m.context_id::text = bk::text limit 1;
    if t like 'ERR:%' or v_dis is null then
      v_out := v_out || 'SKIP(' || t || '): a real problem report could not be opened, so that frozen check was NOT run' || E'\n';
    else
      t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
      v_out := v_out || case when t like '%"state": "frozen"%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a real open problem report says frozen' || E'\n';
      t := pg_temp.st_try(cA, format('select public.local_booking_withdraw_problem(%L, %L)', bk, v_dis));
      t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
      v_out := v_out || case when t like '%"state": "ready"%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after the report is withdrawn it says ready again' || E'\n';
    end if;

    -- F. released, and closed
    bk := pg_temp.st_mk(cust, lt, 50000, cA, true);
    select completion_code into v_code from public.booking_secrets where booking_id = bk;
    t := pg_temp.st_try(cA, format('select public.local_booking_submit_code(%L, %L)', bk, v_code));
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like '%"state": "released"%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after the right code, the state is released' || E'\n';
    bk := pg_temp.st_mk(cust, lt, 10000, cA, false);
    update public.bookings set payment_status = 'unpaid', status = 'cancelled' where id = bk;
    t := pg_temp.st_try(cA, format('select public.local_booking_code_state(%L)', bk));
    v_out := v_out || case when t like '%"state": "closed"%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a cancelled booking says closed' || E'\n';
  end if;

  v_out := v_out || case when not has_function_privilege('anon', 'public.local_booking_code_state(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_code_state(uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end || 'signed-out visitors have no execute right; signed-in users do (the function checks the caller itself)' || E'\n';

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; elsif v_out like '%SKIP%' then v_out := v_out || 'RESULT: INCOMPLETE (a SKIP above is not a pass)'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 7C-1C TESTS\n%', v_out;
end $$;

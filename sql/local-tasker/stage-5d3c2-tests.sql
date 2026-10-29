-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3c-2 tests (a price going down: reduction reported for support)
-- Requires everything up to stage-5d3b-core.sql and stage-5d3c2-core.sql.
-- Select the WHOLE file and press Run in the Supabase SQL editor. It creates throwaway rows and ROLLS THEM BACK by raising an error
-- on purpose: an error box that starts "STAGE 5D-3c-2 TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" means a fixture row could not be made (a paid payment request needs columns this file may not fill in the real
-- project); the checks that need it are then skipped, which is NOT a pass for those checks.
-- ============================================================================
create or replace function pg_temp.st_try(p_user uuid, p_sql text) returns text
language plpgsql as $f$
declare r jsonb; v_hint text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then '' else jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text end, true);
    execute 'set local role authenticated';
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
  v_out text := ''; j jsonb; t text; n1 int; n2 int; fp1 text; fp2 text; v_seed boolean := true; v_pr uuid; v_dp uuid; v_red uuid;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); tk uuid := gen_random_uuid();
  bk1 uuid; bk2 uuid; bk3 uuid; bk4 uuid; bk5 uuid; th1 uuid; th5 uuid; v_kind text := 'full_payment';
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid(); r5 uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5d3c2-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cust, tk]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5D3C2 A', 'active'), (cB, 'ST5D3C2 B', 'active');
  insert into public.users (id, name, role, profile_details) values (cust, 'ST5D3C2 customer', 'customer', '{}'), (tk, 'ST5D3C2 Local Tasker', 'tasker', '{}');
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk1;   -- approved, one payment
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk2;   -- not approved yet
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk3;   -- another coordinator
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'cancelled', 'unpaid') returning id into bk4;   -- closed
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk5;   -- approved, a payment in progress
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values
    (bk1, tk, cA, cA, 'quote_approved'), (bk2, tk, cA, cA, 'assigned'), (bk3, tk, cB, cB, 'quote_approved'), (bk4, tk, cA, cA, 'quote_approved'), (bk5, tk, cA, cA, 'quote_approved');
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk1, now()) returning id into th1;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk5, now()) returning id into th5;

  -- 1. privileges
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_reductions', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_reductions', 'update')
        and not has_table_privilege('authenticated', 'public.local_booking_reductions', 'delete') and not has_table_privilege('anon', 'public.local_booking_reductions', 'select')
        and has_function_privilege('authenticated', 'public.local_booking_request_reduction(uuid,uuid,numeric,text,text)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_reduction(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_request_reduction(uuid,uuid,numeric,text,text)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_reduction_block(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_reduction_paid(uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'the table cannot be written from the browser; the two functions are callable by signed-in users only; helpers are not callable' || E'\n';

  -- 2. who may call, bad input, not approved, closed, nothing paid
  t := pg_temp.st_try(cB, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot request a reduction (not found)' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot call it (not found)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 50, ''Job was smaller'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an amount under 100 is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000.5, ''Job was smaller'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a fractional amount is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''no'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a reason under 5 characters is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller'', null)', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'no confirmation method is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller'', ''phone_call'')', bk2, r1));
  v_out := v_out || case when t in ('ERR:not_approved') then 'PASS: ' else 'FAIL(' || t || '): ' end || 'before the customer approved the quote it is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller'', ''phone_call'')', bk4, r1));
  v_out := v_out || case when t = 'ERR:booking_closed' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a closed booking is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_paid' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nothing paid yet: refused with not_paid (change the quote instead), no report opened' || E'\n';
  v_out := v_out || case when not exists (select 1 from public.job_disputes where thread_id = th1) and (select status from public.bookings where id = bk1) = 'confirmed' then 'PASS: ' else 'FAIL: ' end
        || 'and the booking was not frozen' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_reduction(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when (j ->> 'can_request')::boolean is false and j ->> 'blocked' = 'not_paid' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the read says blocked: not_paid' || E'\n';

  -- 3. fixtures: one PAID request of 10000 on bk1, one PROCESSING request on bk5
  begin
    begin
      insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, title, reason, status) values (th1, tk, cust, 10000, v_kind, 'Quote', 'Quote', 'pending') returning id into v_pr;
    exception when others then
      v_kind := 'additional_cost';
      insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, title, reason, status) values (th1, tk, cust, 10000, v_kind, 'Quote', 'Quote', 'pending') returning id into v_pr;
    end;
    update public.payment_requests set status = 'paid', paid_at = now() where id = v_pr;
    insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, title, reason, status) values (th5, tk, cust, 5000, 'additional_cost', 'Extra', 'Extra', 'pending');
    update public.payment_requests set status = 'processing' where thread_id = th5;
  exception when others then
    v_seed := false; v_out := v_out || 'SKIP: could not make the payment fixtures (' || sqlerrm || '): the success and limit checks are skipped' || E'\n';
  end;

  if v_seed then
    t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller'', ''phone_call'')', bk5, r5));
    v_out := v_out || case when t in ('ERR:payment_started', 'ERR:not_paid') then 'PASS(' || t || '): ' else 'FAIL(' || t || '): ' end || 'while a payment is in progress (and nothing is paid) it is refused' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 10001, ''Job was smaller'', ''phone_call'')', bk1, r2));
    v_out := v_out || case when t = 'ERR:over_limit' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a reduction above what was paid is refused' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_reduction(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when (j ->> 'can_request')::boolean and (j ->> 'room')::numeric = 10000 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the read allows a request and shows 10000 as the most that can be asked' || E'\n';

    -- success: one real problem report (wrong_amount), booking frozen, nothing in the money tables changed
    select md5(string_agg(to_jsonb(p)::text, '|' order by p.id)) into fp1 from public.payment_requests p where p.thread_id = th1;
    select count(*) into n1 from public.escrow_payments where booking_id = bk1;
    t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller than quoted'', ''phone_call'')', bk1, r3));
    j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when (j ->> 'requested')::boolean and not (j ->> 'duplicate')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a valid reduction is accepted' || E'\n';
    v_dp := (j ->> 'dispute_id')::uuid;
    v_out := v_out || case when exists (select 1 from public.job_disputes where id = v_dp and category = 'wrong_amount' and status = 'open' and opened_by_role = 'tasker' and opened_by = tk and thread_id = th1) then 'PASS: ' else 'FAIL: ' end
          || 'it opened a real problem report: category wrong_amount, open, role tasker, in the booking''s Job Room' || E'\n';
    v_out := v_out || case when (select reason from public.job_disputes where id = v_dp) like 'PRICE REDUCTION%' and (select reason from public.job_disputes where id = v_dp) like '%NGN 4,000%'
          and (select reason from public.job_disputes where id = v_dp) like '%Paid so far: NGN 10,000%' and (select reason from public.job_disputes where id = v_dp) like '%on a phone call%'
          and (select reason from public.job_disputes where id = v_dp) like '%Job was smaller than quoted' then 'PASS: ' else 'FAIL: ' end
          || 'the reason carries the amount, the amount paid, how it was confirmed and why' || E'\n';
    v_out := v_out || case when (select status from public.bookings where id = bk1) = 'disputed' then 'PASS: ' else 'FAIL: ' end || 'the booking is frozen (disputed) by the real trigger' || E'\n';
    select md5(string_agg(to_jsonb(p)::text, '|' order by p.id)) into fp2 from public.payment_requests p where p.thread_id = th1;
    select count(*) into n2 from public.escrow_payments where booking_id = bk1;
    v_out := v_out || case when fp1 = fp2 and n1 = n2 and (select agreed_price from public.message_threads where id = th1) is not distinct from null
          and not exists (select 1 from public.payment_requests where thread_id = th1 and kind = 'refund') then 'PASS: ' else 'FAIL: ' end
          || 'the payment requests, the escrow rows and the agreed price are unchanged, and no refund request exists' || E'\n';
    v_out := v_out || case when (select count(*) from public.local_booking_events where booking_id = bk1 and kind = 'reduction_requested') = 1
          and (select count(*) from public.local_tasker_audit_log where action = 'local_booking_reduction_requested' and entity_id = bk1::text) = 1
          and (select count(*) from public.local_booking_problem_reports where dispute_id = v_dp) = 1 then 'PASS: ' else 'FAIL: ' end
          || 'one reduction event, one audit row and one problem-report link' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 4000, ''Job was smaller than quoted'', ''phone_call'')', bk1, r3));
    v_out := v_out || case when t like '%"duplicate": true%' and (select count(*) from public.job_disputes where thread_id = th1) = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'a retry with the same request id changes nothing' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 1000, ''Another reason here'', ''message'')', bk1, r4));
    v_out := v_out || case when t = 'ERR:dispute_open' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a second reduction while the report is open is refused' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_reduction(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when jsonb_array_length(j -> 'items') = 1 and (j -> 'items' -> 0 ->> 'can_withdraw')::boolean and (j -> 'items' -> 0 ->> 'status') = 'open'
          and (j -> 'items' -> 0 ->> 'amount')::numeric = 4000 and j ->> 'blocked' = 'dispute_open' and (j ->> 'room')::numeric = 6000 then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'the read lists it as open and withdrawable, room left 6000, blocked while it is open' || E'\n';

    -- withdraw through the existing 5D-3b function, then it can be asked again and the room is back
    t := pg_temp.st_try(cA, format('select public.local_booking_withdraw_problem(%L, %L)', bk1, v_dp));
    v_out := v_out || case when t like '%"withdrawn": true%' and (select status from public.bookings where id = bk1) = 'confirmed' then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'withdrawing the report gives the booking its earlier status back' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_reduction(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when (j ->> 'can_request')::boolean and (j ->> 'room')::numeric = 10000 and (j -> 'items' -> 0 ->> 'status') = 'withdrawn' then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'after the withdrawal the 4000 counts for nothing again (room 10000) and the list shows it withdrawn' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_request_reduction(%L, %L, 10000, ''Whole job not done'', ''in_person'')', bk1, r4));
    j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when (j ->> 'requested')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a new reduction for the whole amount paid is accepted after the withdrawal' || E'\n';
  end if;

  -- 4. immutability
  begin update public.local_booking_reductions set why = 'edited' where booking_id = bk1; v_out := v_out || 'FAIL: a reduction record could be edited' || E'\n';
  exception when others then v_out := v_out || 'PASS: a reduction record cannot be edited' || E'\n'; end;
  begin delete from public.local_booking_reductions where booking_id = bk1; v_out := v_out || 'FAIL: a reduction record could be deleted' || E'\n';
  exception when others then v_out := v_out || 'PASS: a reduction record cannot be deleted' || E'\n'; end;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 5D-3c-2 TESTS\n%', v_out;
end $$;

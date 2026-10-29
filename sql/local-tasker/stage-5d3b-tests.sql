-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3b tests (coordinator cancel, problem report for the Local Tasker, withdraw, closeout read)
-- Requires everything up to stage-5d3a-core.sql and stage-5d3b-core.sql.
-- Select the WHOLE file (from "create or replace function pg_temp" to the last "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 5D-3b TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" is normal when the real project differs from the stand-in (it is not a failure).
-- The tests use the REAL Job Room tables (bookings, message_threads, payment_requests, job_disputes ...) and the REAL guard triggers,
-- and call the functions as a signed-in user, so they prove the guards let the function through and still stop a direct browser write.
-- If a table needs a column this file does not fill, the test prints "SKIP:" with the database message instead of failing.
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

-- a fingerprint of the booking row without the columns this stage is allowed to change
create or replace function pg_temp.st_bk_fp(p uuid) returns text language sql as $f$
  select md5((to_jsonb(b) - 'status' - 'updated_at' - 'dispute_reason')::text) from public.bookings b where id = p $f$;

do $$
declare
  v_out text := ''; j jsonb; t text; n1 int; n2 int; n3 int; n4 int; fp text; i int; v_dis uuid;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cS uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid(); tk uuid := gen_random_uuid();
  bk1 uuid; bk2 uuid; bk3 uuid; bk4 uuid; bk5 uuid; bk6 uuid; bk7 uuid; bk8 uuid; bk9 uuid; bk10 uuid; bk11 uuid; bk12 uuid; bk13 uuid;
  th1 uuid; th2 uuid; th3 uuid; th7 uuid; th9 uuid; th10 uuid; th11 uuid; th12 uuid; pr1 uuid; pr2 uuid; pr3 uuid;
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5d3b-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cS, cust, cust2, tk]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5D3B A', 'active'), (cB, 'ST5D3B B', 'active'), (cS, 'ST5D3B S', 'active');
  -- the real message_threads table has foreign keys to public.users
  insert into public.users (id, name, role, profile_details) values (cust, 'ST5D3B customer', 'customer', '{}'), (cust2, 'ST5D3B customer 2', 'customer', '{}'), (tk, 'ST5D3B Local Tasker', 'tasker', '{}');

  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'pending', 'unpaid') returning id into bk1;
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk2;   -- money held (set below)
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk3;   -- a payment has started
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust2, tk, 'pending', 'unpaid') returning id into bk4;     -- another coordinator
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'pending', 'unpaid') returning id into bk5;      -- regular booking
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'pending', 'unpaid') returning id into bk6;      -- no Job Room yet
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk7;     -- problem report flow
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'awaiting_confirmation', 'unpaid') returning id into bk8;
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk9;     -- a paid request, booking says unpaid
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk10;    -- rate limit
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk11;    -- escrow held, booking says unpaid
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'pending', 'unpaid') returning id into bk12;     -- no Job Room, report creates one
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk13;    -- a captured gift card
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values
    (bk1, tk, cA, cA, 'quote_approved'), (bk2, tk, cA, cA, 'quote_approved'), (bk3, tk, cA, cA, 'quote_approved'), (bk4, tk, cS, cS, 'quote_approved'),
    (bk6, tk, cA, cA, 'assigned'), (bk7, tk, cA, cA, 'quote_approved'), (bk8, tk, cA, cA, 'quote_approved'), (bk9, tk, cA, cA, 'quote_approved'),
    (bk10, tk, cA, cA, 'quote_approved'), (bk11, tk, cA, cA, 'quote_approved'), (bk12, tk, cA, cA, 'assigned'), (bk13, tk, cA, cA, 'quote_approved');
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk1, now()) returning id into th1;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk2, now()) returning id into th2;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk3, now()) returning id into th3;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk7, now()) returning id into th7;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk9, now()) returning id into th9;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk10, now()) returning id into th10;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk11, now()) returning id into th11;
  -- bk1: two unpaid requests (pending, failed) and a pending job request
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status) values (th1, tk, cust, 20000, 'full_payment', 'pending') returning id into pr1;
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status) values (th1, tk, cust, 1500, 'transport', 'failed');
  insert into public.job_requests (thread_id, customer_id, tasker_id, requested_by, kind, status) values (th1, cust, tk, cust, 'reschedule', 'pending');
  -- bk2: money held (paid request, booking paid, escrow held)
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status, paid_at) values (th2, tk, cust, 20000, 'full_payment', 'paid', now());
  update public.bookings set payment_status = 'paid' where id = bk2;
  insert into public.escrow_payments (booking_id, status, amount, tasker_amount, platform_fee) values (bk2, 'held', 20000, 17600, 2400);
  -- bk3: a payment has just started
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status) values (th3, tk, cust, 20000, 'full_payment', 'processing');
  -- bk9: a paid request although the booking row still says unpaid; bk11: only escrow says held
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status, paid_at) values (th9, tk, cust, 5000, 'transport', 'paid', now());
  insert into public.escrow_payments (booking_id, status, amount, tasker_amount, platform_fee) values (bk11, 'held', 20000, 17600, 2400);

  -- bk13: a gift card was captured for it (only if the project has gift_card_holds; otherwise this check says SKIP)
  begin
    execute format('insert into public.gift_card_holds (booking_id, user_id, status, amount, price) values (%L, %L, ''captured'', 1000, 1000)', bk13, cust);
  exception when others then
    v_out := v_out || 'SKIP: could not add a captured gift hold (' || sqlerrm || ')' || E'\n'; bk13 := null;
  end;

  -- 1. privileges
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_cancellations', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_cancellations', 'update')
        and not has_table_privilege('authenticated', 'public.local_booking_cancellations', 'delete') and not has_table_privilege('anon', 'public.local_booking_cancellations', 'select')
        and not has_table_privilege('authenticated', 'public.local_booking_problem_reports', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_problem_reports', 'update')
        and not has_table_privilege('authenticated', 'public.local_booking_problem_reports', 'delete') and not has_table_privilege('anon', 'public.local_booking_problem_reports', 'select') then 'PASS: ' else 'FAIL: ' end
        || 'nobody can write the two new tables from the browser; visitors cannot read them' || E'\n';
  v_out := v_out || case when has_function_privilege('authenticated', 'public.local_booking_cancel(uuid,uuid,text,text)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_open_problem(uuid,uuid,text,text)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_withdraw_problem(uuid,uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_closeout(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_cancel(uuid,uuid,text,text)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_open_problem(uuid,uuid,text,text)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_withdraw_problem(uuid,uuid)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_closeout(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_cancel_block(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_report_block(uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'signed-in users can call the four functions, visitors cannot, and the two helpers are not callable from the browser' || E'\n';

  -- 2. the real guards are live: a DIRECT browser write is still refused (so passing them below is the function's doing)
  t := pg_temp.st_try(cust, format('with u as (update public.bookings set status = ''cancelled'' where id = %L returning 1) select jsonb_build_object(''n'', count(*)) from u', bk2));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'control: a customer cannot cancel a paid, held booking by writing to bookings directly' || E'\n';
  t := pg_temp.st_try(cust, format('with u as (update public.bookings set status = ''disputed'' where id = %L returning 1) select jsonb_build_object(''n'', count(*)) from u', bk1));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'control: a customer cannot move a booking to "disputed" by writing to bookings directly' || E'\n';

  -- 3. who may call
  t := pg_temp.st_try(cB, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot cancel (not found)' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot use the coordinator cancel' || E'\n';
  t := pg_temp.st_try(null, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk1, r1));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a visitor with no login is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk5, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular booking (no Local Tasker state) is not found' || E'\n';
  update public.coordinators set status = 'suspended' where user_id = cS;
  t := pg_temp.st_try(cS, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk4, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a suspended coordinator cannot cancel' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_booking_open_problem(%L, %L, ''no_show'', ''The Local Tasker never came'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot open a problem report' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_booking_open_problem(%L, %L, ''no_show'', ''The Local Tasker never came'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot use the coordinator report' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_booking_closeout(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot read the closeout card' || E'\n';
  t := pg_temp.st_try(null, format('select public.local_booking_closeout(%L)', bk1));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a visitor cannot read the closeout card' || E'\n';

  -- 4. bad input
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''because'', null)', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unknown cancel reason is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, null, ''customer_asked'', null)', bk1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a cancel with no request id is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''other'', ''  '')', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'reason "other" needs a note' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', %L)', bk1, r1, repeat('x', 301)));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a note over 300 characters is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''nonsense'', ''The Local Tasker never came'')', bk7, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unknown problem category is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''no_show'', ''too short'')', bk7, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a problem description under 10 characters is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''no_show'', %L)', bk7, r1, repeat('x', 1001)));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a problem description over 1000 characters is refused' || E'\n';
  select count(*) into n1 from public.local_booking_cancellations; select count(*) into n2 from public.job_disputes;
  v_out := v_out || case when n1 = 0 and n2 = 0 then 'PASS: ' else 'FAIL: ' end || 'none of the refused calls wrote anything' || E'\n';

  -- 5. closeout read before anything happens
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when (j ->> 'can_cancel')::boolean and (j ->> 'can_report')::boolean and j -> 'cancellation' = 'null'::jsonb and j -> 'problems' = '[]'::jsonb then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'closeout: an unpaid booking can be cancelled or reported, nothing recorded yet' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk2)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when not (j ->> 'can_cancel')::boolean and j ->> 'cancel_blocked' = 'money_held' and (j ->> 'can_report')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'closeout: a booking with money held cannot be cancelled (money_held) but can be reported' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk3)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'cancel_blocked' = 'payment_started' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'closeout: a payment that just started blocks cancelling (payment_started)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk9)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'cancel_blocked' = 'money_held' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'closeout: a paid request blocks cancelling even if the booking row still says unpaid' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk11)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'cancel_blocked' = 'money_held' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'closeout: held escrow blocks cancelling even if the booking row says unpaid' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk8)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'cancel_blocked' = 'wrong_status' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'closeout: awaiting_confirmation blocks cancelling (wrong_status)' || E'\n';

  if bk13 is not null then
    t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk13)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when j ->> 'cancel_blocked' = 'money_held' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'closeout: a captured gift card blocks cancelling' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk13, gen_random_uuid()));
    v_out := v_out || case when t = 'ERR:money_held' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'cancel is refused when a gift card is captured' || E'\n';
  end if;

  -- 6. cancel: refused when money is involved, and nothing changes
  fp := pg_temp.st_bk_fp(bk2);
  select count(*) into n1 from public.payment_requests where thread_id = th2 and status = 'paid';
  for t in select pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk2, gen_random_uuid())) loop
    v_out := v_out || case when t = 'ERR:money_held' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'cancel is refused when money is held (money_held)' || E'\n';
  end loop;
  v_out := v_out || case when (select status from public.bookings where id = bk2) = 'confirmed' and pg_temp.st_bk_fp(bk2) = fp
        and (select count(*) from public.payment_requests where thread_id = th2 and status = 'paid') = n1 and not exists (select 1 from public.local_booking_cancellations where booking_id = bk2) then 'PASS: ' else 'FAIL: ' end
        || 'the refused cancel changed nothing' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk3, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:payment_started' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'cancel is refused while a payment has just started' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk9, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:money_held' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'cancel is refused when a request is paid even though the booking says unpaid' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk11, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:money_held' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'cancel is refused when escrow is held even though the booking says unpaid' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk8, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:wrong_status' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'cancel is refused while the job is awaiting confirmation' || E'\n';

  -- 7. cancel: the happy path (bk1)
  fp := pg_temp.st_bk_fp(bk1);
  select count(*) into n1 from public.payment_intents; select count(*) into n2 from public.escrow_payments;
  select count(*) into n3 from public.payment_requests where status = 'paid';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_unreachable'', ''Phone off for two days'')', bk1, r1)); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'cancelled')::boolean and (j ->> 'changed')::boolean and (j ->> 'requests_cancelled')::int = 2 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'an unpaid booking is cancelled and two unpaid requests are reported as cancelled' || E'\n';
  v_out := v_out || case when (select status from public.bookings where id = bk1) = 'cancelled' then 'PASS: ' else 'FAIL: ' end || 'the booking status is "cancelled" (the real bookings guard let the function through)' || E'\n';
  v_out := v_out || case when (select count(*) from public.payment_requests where thread_id = th1 and status = 'cancelled') = 2 and not exists (select 1 from public.payment_requests where thread_id = th1 and status in ('pending', 'failed')) then 'PASS: ' else 'FAIL: ' end
        || 'the pending and the failed payment request are cancelled' || E'\n';
  v_out := v_out || case when (select status from public.job_requests where thread_id = th1) = 'expired' then 'PASS: ' else 'FAIL: ' end || 'the pending job request is expired' || E'\n';
  v_out := v_out || case when pg_temp.st_bk_fp(bk1) = fp then 'PASS: ' else 'FAIL: ' end || 'only status (and its timestamp) changed on the booking row: payment_status, amount, code, owners untouched' || E'\n';
  v_out := v_out || case when (select count(*) from public.payment_intents) = n1 and (select count(*) from public.escrow_payments) = n2 and (select count(*) from public.payment_requests where status = 'paid') = n3 then 'PASS: ' else 'FAIL: ' end
        || 'no payment intent, escrow row or paid request was touched' || E'\n';
  v_out := v_out || case when (select lt_status from public.local_booking_state where booking_id = bk1) = 'quote_approved' then 'PASS: ' else 'FAIL: ' end || 'lt_status is unchanged' || E'\n';
  select count(*) into n1 from public.job_events where booking_id = bk1 and kind = 'cancelled' and actor_id = tk and customer_id = cust and note like 'Customer could not be reached - Phone off for two days';
  v_out := v_out || case when n1 = 1 then 'PASS: ' else 'FAIL(' || n1 || '): ' end || 'one job event "cancelled" with the reason and note' || E'\n';
  select count(*) into n1 from public.notifications where user_id = cust and type = 'job_update' and (data ->> 'booking_id')::uuid = bk1;
  v_out := v_out || case when n1 = 1 then 'PASS: ' else 'FAIL(' || n1 || '): ' end || 'the customer is notified once' || E'\n';
  select count(*) into n1 from public.messages where thread_id = th1 and type = 'system' and body like 'Job cancelled%';
  v_out := v_out || case when n1 = 1 then 'PASS: ' else 'FAIL(' || n1 || '): ' end || 'the Job Room shows one "Job cancelled" line' || E'\n';
  select count(*) into n1 from public.local_booking_events where booking_id = bk1 and kind = 'cancelled' and to_status = 'customer_unreachable';
  select count(*) into n2 from public.local_tasker_audit_log where action = 'local_booking_cancelled' and entity_id = bk1::text;
  v_out := v_out || case when n1 = 1 and n2 = 1 then 'PASS: ' else 'FAIL(' || n1 || '/' || n2 || '): ' end || 'one booking event and one audit row' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when not (j ->> 'can_cancel')::boolean and j ->> 'cancel_blocked' = 'booking_closed' and not (j ->> 'can_report')::boolean and j -> 'cancellation' ->> 'reason' = 'customer_unreachable' and j ->> 'booking_status' = 'cancelled' then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'closeout after cancelling: closed, nothing more to do, the cancellation is shown' || E'\n';

  -- 8. retry and reuse
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_unreachable'', ''Phone off for two days'')', bk1, r1)); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'duplicate')::boolean and not (j ->> 'changed')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a retry with the same request id returns the earlier result' || E'\n';
  select count(*) into n1 from public.job_events where booking_id = bk1 and kind = 'cancelled';
  v_out := v_out || case when n1 = 1 then 'PASS: ' else 'FAIL(' || n1 || '): ' end || 'the retry wrote no second event' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_unreachable'', null)', bk6, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a request id used for another booking is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk1, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:booking_closed' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a cancelled booking cannot be cancelled again' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''other'', ''Reporting a cancelled booking'')', bk1, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:booking_closed' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a cancelled booking cannot be reported' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk1, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:booking_closed' then 'PASS: ' else 'FAIL(' || t || '): ' end || '5D-3a: a cancelled booking refuses exceptions' || E'\n';

  -- 9. cancel with no Job Room yet (bk6), reason without a note
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''tasker_unavailable'', null)', bk6, gen_random_uuid())); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'changed')::boolean and (j ->> 'requests_cancelled')::int = 0 and (select status from public.bookings where id = bk6) = 'cancelled' then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'a booking with no Job Room yet can be cancelled' || E'\n';

  -- 10. problem report for the Local Tasker (bk7)
  fp := pg_temp.st_bk_fp(bk7);
  select count(*) into n1 from public.payment_requests; select count(*) into n2 from public.escrow_payments; select count(*) into n3 from public.payment_intents;
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''no_show'', ''The customer was not at home at the agreed time'')', bk7, r2)); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'changed')::boolean and not (j ->> 'duplicate')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a problem report is opened for the Local Tasker' || E'\n';
  select d.id into v_dis from public.job_disputes d where d.thread_id = th7;
  v_out := v_out || case when (select count(*) from public.job_disputes where thread_id = th7) = 1 and (select opened_by from public.job_disputes where id = v_dis) = tk
        and (select opened_by_role from public.job_disputes where id = v_dis) = 'tasker' and (select status from public.job_disputes where id = v_dis) = 'open'
        and (select category from public.job_disputes where id = v_dis) = 'no_show' then 'PASS: ' else 'FAIL: ' end
        || 'a real job_disputes row: role tasker, opened by the Local Tasker, open, right category' || E'\n';
  v_out := v_out || case when (select status from public.bookings where id = bk7) = 'disputed' and (select booking_prev_status from public.job_disputes where id = v_dis) = 'confirmed'
        and (select dispute_reason from public.bookings where id = bk7) like 'The customer was not at home%' then 'PASS: ' else 'FAIL: ' end
        || 'the real trigger froze the booking: status "disputed", earlier status remembered' || E'\n';
  v_out := v_out || case when public.job_booking_frozen(bk7) then 'PASS: ' else 'FAIL: ' end || 'job_booking_frozen is now true' || E'\n';
  select count(*) into n4 from public.dispute_events where dispute_id = v_dis and kind = 'opened' and actor_id = cA and thread_id = th7;
  v_out := v_out || case when n4 = 1 then 'PASS: ' else 'FAIL(' || n4 || '): ' end || 'one dispute event "opened" by the coordinator' || E'\n';
  v_out := v_out || case when (select count(*) from public.local_booking_problem_reports where booking_id = bk7 and dispute_id = v_dis and coordinator_id = cA) = 1 then 'PASS: ' else 'FAIL: ' end || 'one problem-report record linking the coordinator to the report' || E'\n';
  select count(*) into n4 from public.local_booking_events where booking_id = bk7 and kind = 'problem_reported' and to_status = 'no_show';
  v_out := v_out || case when n4 = 1 and (select count(*) from public.local_tasker_audit_log where action = 'local_booking_problem_reported' and entity_id = bk7::text) = 1 then 'PASS: ' else 'FAIL: ' end || 'one booking event and one audit row' || E'\n';
  v_out := v_out || case when (select count(*) from public.notifications where user_id = cust and title = 'A problem was reported on your job' and (data ->> 'booking_id')::uuid = bk7) = 1 then 'PASS: ' else 'FAIL: ' end || 'the customer is notified' || E'\n';
  v_out := v_out || case when pg_temp.st_bk_fp(bk7) = fp and (select count(*) from public.payment_requests) = n1 and (select count(*) from public.escrow_payments) = n2 and (select count(*) from public.payment_intents) = n3 then 'PASS: ' else 'FAIL: ' end
        || 'reporting moved no money and touched no payment field' || E'\n';
  -- while frozen
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''other'', ''A second report on the same booking'')', bk7, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:dispute_open' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a second report while one is open is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_cancel(%L, %L, ''customer_asked'', null)', bk7, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:dispute_open' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'cancel is refused while a report is open' || E'\n';
  -- NOTE: the 5D-1/5D-2/5D-3a functions test "closed or status disputed" BEFORE "frozen", so for a reported booking they refuse with the hint
  -- booking_closed (the wording says "closed"). Refusal is what matters here; the wording is a known limitation (handoff section 12).
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk7, gen_random_uuid()));
  v_out := v_out || case when t in ('ERR:dispute_open', 'ERR:booking_closed') then 'PASS: ' else 'FAIL(' || t || '): ' end || '5D-2: no step on the day while a report is open (refused with ' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk7, gen_random_uuid()));
  v_out := v_out || case when t in ('ERR:dispute_open', 'ERR:booking_closed') then 'PASS: ' else 'FAIL(' || t || '): ' end || '5D-3a: no exception while a report is open (refused with ' || t || ')' || E'\n';
  -- retry
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''no_show'', ''The customer was not at home at the agreed time'')', bk7, r2)); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'duplicate')::boolean and (select count(*) from public.job_disputes where thread_id = th7) = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a retry returns the earlier report and opens no second one' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''other'', ''Using the same request id for another thing'')', bk7, r2));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a request id reused with a different category is refused' || E'\n';
  -- closeout while frozen
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk7)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when not (j ->> 'can_report')::boolean and j ->> 'report_blocked' = 'dispute_open' and j ->> 'cancel_blocked' = 'dispute_open'
        and jsonb_array_length(j -> 'problems') = 1 and (j -> 'problems' -> 0 ->> 'can_withdraw')::boolean and j -> 'problems' -> 0 ->> 'status' = 'open' then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'closeout while frozen: nothing new can be done, the report is listed and can be withdrawn' || E'\n';

  -- 11. withdraw
  t := pg_temp.st_try(cB, format('select public.local_booking_withdraw_problem(%L, %L)', bk7, v_dis));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot withdraw it' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_booking_withdraw_problem(%L, %L)', bk7, v_dis));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot use the coordinator withdraw' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_withdraw_problem(%L, %L)', bk7, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unknown report id is not found' || E'\n';
  -- a report opened by the customer (not through this path) cannot be withdrawn here
  insert into public.job_disputes (thread_id, opened_by, opened_by_role, category, reason) values (th10, cust, 'customer', 'other', 'Opened by the customer in the Job Room') returning id into pr3;
  t := pg_temp.st_try(cA, format('select public.local_booking_withdraw_problem(%L, %L)', bk10, pr3));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a report the customer opened cannot be withdrawn by the coordinator' || E'\n';
  update public.job_disputes set status = 'withdrawn' where id = pr3;
  t := pg_temp.st_try(cA, format('select public.local_booking_withdraw_problem(%L, %L)', bk7, v_dis)); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'withdrawn')::boolean and (j ->> 'changed')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator withdraws their own open report' || E'\n';
  v_out := v_out || case when (select status from public.job_disputes where id = v_dis) = 'withdrawn' and (select status from public.bookings where id = bk7) = 'confirmed'
        and not public.job_booking_frozen(bk7) and (select dispute_reason from public.bookings where id = bk7) is null then 'PASS: ' else 'FAIL: ' end
        || 'the real trigger gave the booking its earlier status back and lifted the freeze' || E'\n';
  v_out := v_out || case when (select count(*) from public.dispute_events where dispute_id = v_dis and kind = 'withdrawn' and actor_id = cA) = 1
        and (select count(*) from public.local_booking_events where booking_id = bk7 and kind = 'problem_withdrawn') = 1
        and (select count(*) from public.local_tasker_audit_log where action = 'local_booking_problem_withdrawn' and entity_id = bk7::text) = 1 then 'PASS: ' else 'FAIL: ' end
        || 'one dispute event, one booking event and one audit row for the withdrawal' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_withdraw_problem(%L, %L)', bk7, v_dis)); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and not (j ->> 'changed')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'withdrawing twice is harmless' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk7, gen_random_uuid())); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'changed')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after the withdrawal the booking works again (a step can be recorded)' || E'\n';
  -- support has started reviewing: no withdrawal
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''not_done'', ''The work was never done at all'')', bk7, r3)); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'changed')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after a withdrawal a new report can be opened' || E'\n';
  select dispute_id into pr3 from public.local_booking_problem_reports where request_id = r3;
  update public.job_disputes set status = 'under_review' where id = pr3;
  t := pg_temp.st_try(cA, format('select public.local_booking_withdraw_problem(%L, %L)', bk7, pr3));
  v_out := v_out || case when t = 'ERR:not_open' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'once support is reviewing, the coordinator cannot withdraw' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk7)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when jsonb_array_length(j -> 'problems') = 2 and j -> 'problems' -> 0 ->> 'status' = 'under_review' and not (j -> 'problems' -> 0 ->> 'can_withdraw')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'closeout lists both reports, newest first, and the one under review cannot be withdrawn' || E'\n';

  -- 12. a report on a booking with money held, and on one with no Job Room yet
  fp := pg_temp.st_bk_fp(bk2); select count(*) into n1 from public.escrow_payments where status = 'held'; select count(*) into n2 from public.payment_requests where status = 'paid';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''payment_issue'', ''The customer paid but the Local Tasker cannot come'')', bk2, gen_random_uuid())); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'changed')::boolean and (select status from public.bookings where id = bk2) = 'disputed' and pg_temp.st_bk_fp(bk2) = fp
        and (select count(*) from public.escrow_payments where status = 'held') = n1 and (select count(*) from public.payment_requests where status = 'paid') = n2 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'a booking with money held can be reported; the money stays exactly where it was' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''no_show'', ''The Local Tasker did not come to the job'')', bk12, gen_random_uuid())); j := case when t like 'ERR:%' then null else t::jsonb end;
  v_out := v_out || case when j is not null and (j ->> 'changed')::boolean and exists (select 1 from public.message_threads where context_type = 'booking' and context_id = bk12 and customer_id = cust and tasker_id = tk)
        and (select count(*) from public.job_disputes d join public.message_threads m on m.id = d.thread_id where m.context_id = bk12) = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'a booking with no Job Room yet gets one, and the report is opened in it' || E'\n';

  -- 13. the 3-in-24-hours rule
  select count(*) into n1 from public.job_disputes d where d.thread_id = th10;           -- one (withdrawn, opened by the customer above)
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''other'', ''Second report for the rate limit test'')', bk10, gen_random_uuid())); j := case when t like 'ERR:%' then null else t::jsonb end;
  update public.job_disputes set status = 'withdrawn' where thread_id = th10 and status = 'open';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''other'', ''Third report for the rate limit test'')', bk10, gen_random_uuid())); j := case when t like 'ERR:%' then null else t::jsonb end;
  update public.job_disputes set status = 'withdrawn' where thread_id = th10 and status = 'open';
  t := pg_temp.st_try(cA, format('select public.local_booking_open_problem(%L, %L, ''other'', ''Fourth report for the rate limit test'')', bk10, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:too_many' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a fourth report within 24 hours is refused (same limit as open_job_dispute)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_closeout(%L)', bk10)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'report_blocked' = 'too_many' and not (j ->> 'can_report')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'closeout shows the limit as the reason' || E'\n';

  -- 14. immutability and cascade
  begin update public.local_booking_cancellations set note = 'edited' where booking_id = bk1; v_out := v_out || 'FAIL: a cancellation record could be edited' || E'\n';
  exception when others then v_out := v_out || 'PASS: a cancellation record cannot be edited' || E'\n'; end;
  begin delete from public.local_booking_cancellations where booking_id = bk1; v_out := v_out || 'FAIL: a cancellation record could be deleted' || E'\n';
  exception when others then v_out := v_out || 'PASS: a cancellation record cannot be deleted' || E'\n'; end;
  begin update public.local_booking_problem_reports set category = 'other' where booking_id = bk7; v_out := v_out || 'FAIL: a report record could be edited' || E'\n';
  exception when others then v_out := v_out || 'PASS: a problem-report record cannot be edited' || E'\n'; end;
  begin delete from public.local_booking_problem_reports where booking_id = bk7; v_out := v_out || 'FAIL: a report record could be deleted' || E'\n';
  exception when others then v_out := v_out || 'PASS: a problem-report record cannot be deleted' || E'\n'; end;
  begin delete from public.bookings where id = bk6; v_out := v_out || 'PASS: deleting a booking removes its cancellation record without error' || E'\n';
  exception when others then v_out := v_out || 'FAIL: deleting a cancelled booking failed (' || sqlerrm || ')' || E'\n'; end;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 5D-3b TESTS\n%', v_out;
end $$;

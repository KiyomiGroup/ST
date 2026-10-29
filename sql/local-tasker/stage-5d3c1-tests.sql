-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3c-1 tests (extra costs after approval)
-- Requires everything up to stage-5d3b-core.sql and stage-5d3c1-core.sql.
-- NOT RUN by the author: written, never executed anywhere (no database was available). Expect to fix a fixture on the first run.
-- Select the WHOLE file and press Run in the Supabase SQL editor. It creates throwaway rows and ROLLS THEM BACK by raising an error
-- on purpose: an error box that starts "STAGE 5D-3c-1 TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" means a fixture row could not be made (the quote needs a confirmation row with columns this file may not fill);
-- the checks that need it are then skipped, which is NOT a pass for those checks.
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
  v_out text := ''; j jsonb; t text; n1 int; n2 int; fp1 text; fp2 text; v_seed boolean := true; v_conf uuid; v_pr uuid; v_x uuid;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); tk uuid := gen_random_uuid();
  bk1 uuid; bk2 uuid; bk3 uuid; bk4 uuid; th1 uuid;
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5d3c1-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cust, tk]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5D3C1 A', 'active'), (cB, 'ST5D3C1 B', 'active');
  insert into public.users (id, name, role, profile_details) values (cust, 'ST5D3C1 customer', 'customer', '{}'), (tk, 'ST5D3C1 Local Tasker', 'tasker', '{}');
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk1;   -- approved, quote 30000
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk2;   -- not approved yet
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk3;   -- another coordinator
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'cancelled', 'unpaid') returning id into bk4;   -- closed
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values
    (bk1, tk, cA, cA, 'quote_approved'), (bk2, tk, cA, cA, 'assigned'), (bk3, tk, cB, cB, 'quote_approved'), (bk4, tk, cA, cA, 'quote_approved');
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk1, now()) returning id into th1;

  -- the current quote of bk1 (total 30000): needs a confirmation row; if the project's columns differ, the dependent checks SKIP
  begin
    insert into public.local_booking_confirmations (booking_id, tasker_user_id, coordinator_id, request_id, outcome, called_name, called_number, called_at, proposed_price)
    values (bk1, tk, cA, gen_random_uuid(), 'confirmed', 'Test', '+2340000000000', now(), 30000) returning id into v_conf;
    insert into public.local_booking_quotes (booking_id, confirmation_id, coordinator_id, request_id, version, service_fee, total)
    values (bk1, v_conf, cA, gen_random_uuid(), 1, 30000, 30000);
  exception when others then
    v_seed := false; v_out := v_out || 'SKIP: could not make the quote fixture (' || sqlerrm || '): the limit and success checks are skipped' || E'\n';
  end;

  -- 1. privileges
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_extra_costs', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_extra_costs', 'update')
        and not has_table_privilege('authenticated', 'public.local_booking_extra_costs', 'delete') and not has_table_privilege('anon', 'public.local_booking_extra_costs', 'select')
        and has_function_privilege('authenticated', 'public.local_booking_request_extra(uuid,uuid,text,numeric,text,text,text)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_cancel_extra(uuid,uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_extras(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_request_extra(uuid,uuid,text,numeric,text,text,text)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_extra_block(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_extra_room(uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'the table cannot be written from the browser; the three functions are callable by signed-in users only; helpers are not callable' || E'\n';

  -- 2. who may call, bad input, closed / not approved
  t := pg_temp.st_try(cB, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot request an extra cost (not found)' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot call it (not found)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''materials'', 50, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an amount under 100 is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000.5, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a fractional amount is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''invoice'', 5000, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a kind other than additional_cost / materials / transport is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000, ''Pipes'', ''Extra pipes needed'', null)', bk1, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'no confirmation method is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk2, r1));
  v_out := v_out || case when t = 'ERR:not_approved' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'before the customer approved the quote it is refused (change the quote instead)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk4, r1));
  v_out := v_out || case when t = 'ERR:booking_closed' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a closed booking is refused' || E'\n';

  if v_seed then
    -- 3. success: one pending add-on request + chat card, nothing else changes
    select md5((to_jsonb(b) - 'updated_at')::text) into fp1 from public.bookings b where id = bk1;
    select count(*) into n1 from public.escrow_payments where booking_id = bk1;
    t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk1, r1));
    j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when (j ->> 'requested')::boolean and not (j ->> 'duplicate')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a valid extra cost is accepted' || E'\n';
    v_pr := (j ->> 'payment_request_id')::uuid;
    v_out := v_out || case when exists (select 1 from public.payment_requests where id = v_pr and status = 'pending' and kind = 'materials' and amount = 5000 and customer_id = cust and thread_id = th1)
          then 'PASS: ' else 'FAIL: ' end || 'a pending materials payment request of 5000 exists in the booking''s Job Room' || E'\n';
    v_out := v_out || case when exists (select 1 from public.messages where payment_request_id = v_pr and type = 'payment_request') then 'PASS: ' else 'FAIL: ' end || 'its chat card exists' || E'\n';
    select md5((to_jsonb(b) - 'updated_at')::text) into fp2 from public.bookings b where id = bk1;
    select count(*) into n2 from public.escrow_payments where booking_id = bk1;
    v_out := v_out || case when fp1 = fp2 and n1 = n2 and (select agreed_price from public.message_threads where id = th1) is not distinct from null then 'PASS: ' else 'FAIL: ' end
          || 'the booking row, the escrow rows and the agreed price are unchanged' || E'\n';
    v_out := v_out || case when (select count(*) from public.local_booking_events where booking_id = bk1 and kind = 'extra_requested') = 1
          and (select count(*) from public.local_tasker_audit_log where action = 'local_booking_extra_requested' and entity_id = bk1::text) = 1 then 'PASS: ' else 'FAIL: ' end
          || 'one booking event and one audit row' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''materials'', 5000, ''Pipes'', ''Extra pipes needed'', ''phone_call'')', bk1, r1));
    v_out := v_out || case when t like '%"duplicate": true%' and (select count(*) from public.payment_requests where thread_id = th1 and kind = 'materials') = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'a retry with the same request id changes nothing' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''transport'', 1000, ''Taxi'', ''Taxi to the shop'', ''message'')', bk1, r2));
    v_out := v_out || case when t = 'ERR:one_waiting' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a second request while the first waits is refused' || E'\n';

    -- 4. withdraw, then the limit
    select id into v_x from public.local_booking_extra_costs where booking_id = bk1;
    t := pg_temp.st_try(cB, format('select public.local_booking_cancel_extra(%L, %L)', bk1, v_x));
    v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot withdraw it' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_cancel_extra(%L, %L)', bk1, v_x));
    v_out := v_out || case when t like '%"changed": true%' and (select status from public.payment_requests where id = v_pr) = 'cancelled' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unpaid extra cost can be withdrawn' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_cancel_extra(%L, %L)', bk1, v_x));
    v_out := v_out || case when t like '%"changed": false%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'withdrawing twice is harmless' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''additional_cost'', 40000, ''Big job'', ''More than the quote'', ''in_person'')', bk1, r3));
    v_out := v_out || case when t = 'ERR:over_limit' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'extra costs above the quote total are refused' || E'\n';
    -- a paid one cannot be withdrawn
    t := pg_temp.st_try(cA, format('select public.local_booking_request_extra(%L, %L, ''additional_cost'', 4000, ''Extra labour'', ''Another hour of work'', ''in_person'')', bk1, r4));
    j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    update public.payment_requests set status = 'paid', paid_at = now() where id = (j ->> 'payment_request_id')::uuid;
    t := pg_temp.st_try(cA, format('select public.local_booking_cancel_extra(%L, %L)', bk1, (select id from public.local_booking_extra_costs where payment_request_id = (j ->> 'payment_request_id')::uuid)));
    v_out := v_out || case when t = 'ERR:not_pending' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a paid extra cost cannot be withdrawn' || E'\n';
    t := pg_temp.st_try(cA, format('select public.local_booking_extras(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when (j -> 'items') is not null and jsonb_array_length(j -> 'items') = 2 and (j ->> 'room')::numeric = 26000 then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'the read lists both requests and the room left is quote total minus the extras not withdrawn (26000)' || E'\n';
  end if;

  -- 5. immutability
  begin update public.local_booking_extra_costs set title = 'edited' where booking_id = bk1; v_out := v_out || 'FAIL: an extra-cost record could be edited' || E'\n';
  exception when others then v_out := v_out || 'PASS: an extra-cost record cannot be edited' || E'\n'; end;
  begin delete from public.local_booking_extra_costs where booking_id = bk1; v_out := v_out || 'FAIL: an extra-cost record could be deleted' || E'\n';
  exception when others then v_out := v_out || 'PASS: an extra-cost record cannot be deleted' || E'\n'; end;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 5D-3c-1 TESTS\n%', v_out;
end $$;

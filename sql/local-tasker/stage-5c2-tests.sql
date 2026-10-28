-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5C-2 tests (itemised quote) and, again, the 5C-1 confirmation tests adapted to it
-- Requires stage-2d-core, 4b1-core, 4b2-core, 4c1-core, 5a1-core, 5a2-core, stage-5c1-core.sql, stage-5c2-core.sql (and 5b-core for one check).
-- NOTE: stage-5c1-tests.sql expects the 5C-1 behaviour (a raw step to quote_sent). Run it BEFORE stage-5c2-core.sql.
-- After 5C-2 is installed, THIS file is the test for the state machine (it repeats the 5C-1 checks, sending quotes the new way).
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 5C-2 TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- ============================================================================
do $$
declare
  v_out text := ''; v_adm boolean; v_hint text; v_state text; n int; j jsonb; bk uuid; bk2 uuid; bk3 uuid; bk4 uuid; q1 uuid; cid uuid; sig1 text; sig2 text;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid(); r uuid;
  now_ts timestamptz := now();
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5c-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cust]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST5C customer', 'customer', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5C A', 'active'), (cB, 'ST5C B', 'active');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi', '+2348011112222', 'Yaba, Sabo', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.save_local_tasker_service(t1, null, 'Solid Wood Wardrobe Repair', 'carpentry', 12500, '/job', 'Standard labour fee. Customer supplies timber.', null, array['Wardrobes'], 'available_this_week', true, 'in_person', 'Form 7', null);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk; execute 'reset role';

  perform set_config('st.test_admin', '1', true); v_adm := public.is_local_tasker_admin(); perform set_config('st.test_admin', '', true);
  -- (v_adm is false in the real project, where is_local_tasker_admin() reads the owner's admin table; the two administrator
  --  steps below are then recorded as SKIP and the result is written directly, so the quote gate is still tested.)

  -- 1. privileges
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_confirmations', 'insert')
                          and not has_table_privilege('authenticated', 'public.local_booking_confirmations', 'update')
                          and not has_table_privilege('authenticated', 'public.local_booking_confirmations', 'delete')
                          and not has_table_privilege('anon', 'public.local_booking_confirmations', 'select')
                     then 'PASS: ' else 'FAIL: ' end || 'nobody can write the confirmation table from the browser; visitors cannot read it' || E'\n';
  v_out := v_out || case when not has_function_privilege('anon', 'public.local_booking_record_confirmation(uuid,uuid,text,text,text,timestamptz,boolean,boolean,numeric,text,numeric,numeric,text,text,text,boolean,boolean)', 'execute')
                          and not has_function_privilege('anon', 'public.local_booking_confirmations(uuid)', 'execute')
                          and not has_function_privilege('anon', 'public.local_booking_second_check(uuid,boolean,text)', 'execute')
                          and has_function_privilege('authenticated', 'public.local_booking_record_confirmation(uuid,uuid,text,text,text,timestamptz,boolean,boolean,numeric,text,numeric,numeric,text,text,text,boolean,boolean)', 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'only signed-in users can call the three new functions' || E'\n';

  -- 2. the coordinator cannot mark acceptance or refusal without the capture step
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_step(bk, 'awaiting_tasker_confirmation', null); execute 'reset role';
  foreach v_state in array array['tasker_confirmed', 'tasker_declined'] loop
    v_hint := null;
    begin execute 'set local role authenticated'; perform public.local_booking_step(bk, v_state, null); execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'use_confirmation' and (select lt_status from public.local_booking_state where booking_id = bk) = 'awaiting_tasker_confirmation'
                       then 'PASS: ' else 'FAIL: ' end || 'step to ' || v_state || ' is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_hint := null;
  begin execute 'set local role service_role'; perform public._local_booking_transition(bk, 'tasker_confirmed', cA, 'coordinator', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'use_confirmation' then 'PASS: ' else 'FAIL: ' end || 'even the internal transition refuses tasker_confirmed without the capture step' || E'\n';

  -- 3. no direct table access for a coordinator (price cannot be written outside the record)
  v_hint := null;
  begin execute 'set local role authenticated';
    insert into public.local_booking_confirmations (booking_id, tasker_user_id, coordinator_id, request_id, outcome, called_name, called_number, called_at, available, can_do, proposed_price, duration_text, read_back_confirmed)
    values (bk, t1, cA, gen_random_uuid(), 'confirmed', 'x', '08011112222', now(), true, true, 1, '1 hour', true);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint = '42501' then 'PASS: ' else 'FAIL: ' end || 'a coordinator cannot insert a confirmation (or a price) directly (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; update public.local_booking_confirmations set proposed_price = 1; execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint = '42501' then 'PASS: ' else 'FAIL: ' end || 'a coordinator cannot update a price directly (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 4. invalid records are refused and leave nothing behind
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  for n in 1..9 loop
    v_hint := null; r := gen_random_uuid();
    begin execute 'set local role authenticated';
      perform public.local_booking_record_confirmation(bk, r,
        case n when 1 then 'maybe' else 'confirmed' end,
        case n when 2 then '' else 'Baba Alabi' end,
        case n when 3 then 'call me' else '0801 111 2222' end,
        case n when 4 then now() + interval '2 hours' else now() end,
        case n when 5 then false else true end, true,
        case n when 6 then 0 when 9 then -5 else 12500 end,
        case n when 7 then '' else '2 hours' end, 1000, 500, null, null, null,
        case n when 8 then false else true end, false);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'invalid record #' || n || ' is refused ('
             || (array['unknown outcome','no name','bad number','future call time','not available','zero price','no duration','price not read back','negative price'])[n]
             || '; ' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_out := v_out || case when not exists (select 1 from public.local_booking_confirmations where booking_id = bk)
                          and (select lt_status from public.local_booking_state where booking_id = bk) = 'awaiting_tasker_confirmation'
                     then 'PASS: ' else 'FAIL: ' end || 'no refused record left a row or moved the booking' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.local_booking_record_confirmation(bk, null, 'confirmed', 'Baba', '08011112222', now(), true, true, 100, '1h', 0, 0, null, null, null, true, false);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'a record without a request id is refused' || E'\n';

  -- 5. who may record
  for n in 1..3 loop
    v_hint := null;
    perform set_config('request.jwt.claims', case n when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   else '{}' end, true);
    begin execute 'set local role authenticated';
      perform public.local_booking_record_confirmation(bk, gen_random_uuid(), 'confirmed', 'Baba', '08011112222', now(), true, true, 100, '1h', 0, 0, null, null, null, true, false);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || (array['another coordinator','the customer','no signed-in user'])[n] || ' gets not_found when recording (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);

  -- 6. no answer: logged, booking waits
  execute 'set local role authenticated';
  j := public.local_booking_record_confirmation(bk, gen_random_uuid(), 'no_answer', 'Baba Alabi', '0801 111 2222', now(), null, null, null, null, null, null, null, null, 'Rang twice', false, false);
  execute 'reset role';
  v_out := v_out || case when j->>'outcome' = 'no_answer' and j->>'lt_status' = 'awaiting_tasker_confirmation' and not (j->>'changed')::boolean
                          and exists (select 1 from public.local_booking_events where booking_id = bk and kind = 'confirmation_recorded' and note = 'No answer')
                     then 'PASS: ' else 'FAIL: ' end || 'a call with no answer is logged and the booking keeps waiting' || E'\n';

  -- 7. confirmed
  select md5(b::text) into sig1 from public.bookings b where id = bk;
  r := gen_random_uuid();
  execute 'set local role authenticated';
  j := public.local_booking_record_confirmation(bk, r, 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 12500.50, '2 hours', 1500, 3000, 'Hinges', 'No work after 5pm', 'Agreed on the phone', true, false);
  execute 'reset role';
  select md5(b::text) into sig2 from public.bookings b where id = bk;
  cid := (j->>'confirmation_id')::uuid;
  v_out := v_out || case when j->>'lt_status' = 'tasker_confirmed' and (select lt_status from public.local_booking_state where booking_id = bk) = 'tasker_confirmed'
                          and exists (select 1 from public.local_booking_confirmations where id = cid and coordinator_id = cA and tasker_user_id = t1 and proposed_price = 12500.50
                                       and transport_amount = 1500 and materials_amount = 3000 and read_back_confirmed and second_check_status = 'off'
                                       and number_matches_profile and called_name = 'Baba Alabi' and superseded_at is null)
                     then 'PASS: ' else 'FAIL: ' end || 'a confirmed call is stored in full and moves the booking to tasker_confirmed; second check is OFF by default; number matches the profile' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_booking_events where booking_id = bk and kind = 'confirmation_recorded' and note like 'Local Tasker confirmed, price%12,500.50%' and actor_id = cA)
                          and exists (select 1 from public.local_booking_events where booking_id = bk and kind = 'status_changed' and to_status = 'tasker_confirmed')
                          and exists (select 1 from public.local_tasker_audit_log where action = 'local_booking_confirmation' and entity_id = bk::text and after_data->>'confirmation_id' = cid::text)
                     then 'PASS: ' else 'FAIL: ' end || 'audit rows exist: booking event, status event and audit-log row' || E'\n';
  v_out := v_out || case when sig1 = sig2 then 'PASS: ' else 'FAIL: ' end || 'recording the call changed nothing on the booking row (price, payment status, amount, code)' || E'\n';
  execute 'set local role authenticated';
  j := public.local_booking_record_confirmation(bk, r, 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 12500.50, '2 hours', 1500, 3000, null, null, null, true, false);
  execute 'reset role';
  v_out := v_out || case when (j->>'duplicate')::boolean and (select count(*) from public.local_booking_confirmations where booking_id = bk and outcome = 'confirmed') = 1
                     then 'PASS: ' else 'FAIL: ' end || 'a retried save with the same request id adds no second row' || E'\n';

  -- 8. the price cannot be edited, by anyone
  foreach v_state in array array['proposed_price = 1', 'transport_amount = 0', 'called_number = ''0000''', 'outcome = ''declined''', 'superseded_at = null, proposed_price = 2'] loop
    v_hint := null;
    begin execute 'update public.local_booking_confirmations set ' || v_state || ' where id = ''' || cid || '''';
    exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'immutable' then 'PASS: ' else 'FAIL: ' end || 'editing a recorded confirmation is rejected even by the database owner (' || v_state || ')' || E'\n';
  end loop;
  v_hint := null;
  begin delete from public.local_booking_confirmations where id = cid; exception when others then get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint = 'P0001' then 'PASS: ' else 'FAIL: ' end || 'a recorded confirmation cannot be deleted' || E'\n';

  -- 9. quote_sent now allowed; recording again is not allowed from there
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk, gen_random_uuid(), null, null, 0, null, null, null); execute 'reset role';
  v_out := v_out || case when j->>'lt_status' = 'quote_sent' then 'PASS: ' else 'FAIL: ' end || 'with a valid confirmation the booking can reach quote_sent' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.local_booking_record_confirmation(bk, gen_random_uuid(), 'confirmed', 'Baba', '08011112222', now(), true, true, 99999, '1h', 0, 0, null, null, null, true, false);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'invalid_transition' then 'PASS: ' else 'FAIL: ' end || 'a new price cannot be recorded behind a sent quote; the booking must first go back to the tasker (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 10. a changed price needs a new recorded call; the old record is retired
  execute 'set local role authenticated'; perform public.local_booking_step(bk, 'awaiting_tasker_confirmation', 'Customer wants a change'); execute 'reset role';
  v_out := v_out || case when (select superseded_at from public.local_booking_confirmations where id = cid) is not null
                          and exists (select 1 from public.local_booking_events where booking_id = bk and kind = 'confirmation_superseded')
                     then 'PASS: ' else 'FAIL: ' end || 'sending the booking back retires the old confirmation (with an event)' || E'\n';
  execute 'set local role authenticated';
  j := public.local_booking_record_confirmation(bk, gen_random_uuid(), 'confirmed', 'Baba Alabi', '08011112222', now(), true, true, 14000, '3 hours', 0, 0, null, null, null, true, true);
  execute 'reset role';
  v_out := v_out || case when (select count(*) from public.local_booking_confirmations where booking_id = bk and superseded_at is null and outcome = 'confirmed') = 1
                          and (select proposed_price from public.local_booking_confirmations where booking_id = bk and superseded_at is null and outcome = 'confirmed') = 14000
                          and (select count(*) from public.local_booking_confirmations where booking_id = bk and outcome = 'confirmed') = 2
                     then 'PASS: ' else 'FAIL: ' end || 'the new price (14000) is the single current record; the old one is kept as history' || E'\n';

  -- 11. optional second check
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_send_quote(bk, gen_random_uuid(), null, null, 0, null, null, null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'second_check_pending' then 'PASS: ' else 'FAIL: ' end || 'while a second check is asked for, the quote cannot be sent (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  select id into cid from public.local_booking_confirmations where booking_id = bk and superseded_at is null and outcome = 'confirmed';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_second_check(cid, true, 'x'); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'a coordinator cannot pass their own second check' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text, true);
  perform set_config('st.test_admin', '1', true);
  if v_adm then execute 'set local role authenticated'; j := public.local_booking_second_check(cid, true, 'Called Baba back, price confirmed'); execute 'reset role';
  else v_out := v_out || 'SKIP: administrator function not testable here (result written directly)' || E'\n';
       update public.local_booking_confirmations set second_check_status = 'passed', second_check_by = cB, second_check_at = now(), second_check_note = 'direct' where id = cid; end if;
  perform set_config('st.test_admin', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk, gen_random_uuid(), null, null, 0, null, null, null); execute 'reset role';
  v_out := v_out || case when j->>'lt_status' = 'quote_sent' and exists (select 1 from public.local_booking_events where booking_id = bk and kind = 'second_check_passed' and actor_role = 'admin')
                     then 'PASS: ' else 'FAIL: ' end || 'after "passed" is recorded, the quote can be sent (second check is audited)' || E'\n';
  -- failed second check blocks too
  execute 'set local role authenticated'; perform public.local_booking_step(bk, 'awaiting_tasker_confirmation', null);
  perform public.local_booking_record_confirmation(bk, gen_random_uuid(), 'confirmed', 'Baba Alabi', '08011112222', now(), true, true, 15000, '3 hours', 0, 0, null, null, null, true, true); execute 'reset role';
  select id into cid from public.local_booking_confirmations where booking_id = bk and superseded_at is null and outcome = 'confirmed';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text, true);
  perform set_config('st.test_admin', '1', true);
  if v_adm then execute 'set local role authenticated'; perform public.local_booking_second_check(cid, false, 'Price did not match'); execute 'reset role';
  else update public.local_booking_confirmations set second_check_status = 'failed', second_check_by = cB, second_check_at = now() where id = cid; end if;
  perform set_config('st.test_admin', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_send_quote(bk, gen_random_uuid(), null, null, 0, null, null, null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'second_check_pending' then 'PASS: ' else 'FAIL: ' end || 'a failed second check also blocks the quote' || E'\n';

  -- 12. declined
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk2; execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.local_booking_record_confirmation(bk2, gen_random_uuid(), 'declined', 'Baba Alabi', '08011112222', now(), false, false, null, null, 0, 0, null, null, null, false, false);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'a refusal needs a reason' || E'\n';
  execute 'set local role authenticated';
  j := public.local_booking_record_confirmation(bk2, gen_random_uuid(), 'declined', 'Baba Alabi', '08011112222', now(), false, false, null, null, 0, 0, null, 'Travelling that week', null, false, false);
  execute 'reset role';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_send_quote(bk2, gen_random_uuid(), null, null, 0, null, null, null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when j->>'lt_status' = 'tasker_declined' and v_hint = 'invalid_transition'
                          and (select proposed_price from public.local_booking_confirmations where id = (j->>'confirmation_id')::uuid) is null
                     then 'PASS: ' else 'FAIL: ' end || 'a declined booking is tasker_declined, stores no price and cannot reach quote_sent' || E'\n';

  -- 13. the quote gate itself: even if the state were reached without a record, quote_sent is refused
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk3; execute 'reset role';
  execute 'set local role service_role';
  perform public._local_booking_transition(bk3, 'awaiting_tasker_confirmation', cA, 'coordinator', null);
  perform set_config('st.lt_capture', '1', true);
  perform public._local_booking_transition(bk3, 'tasker_confirmed', cA, 'coordinator', null);   -- simulates a bypass of the capture step
  perform set_config('st.lt_capture', '', true);
  v_hint := null;
  begin perform public._local_booking_transition(bk3, 'quote_sent', cA, 'coordinator', null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  execute 'reset role';
  v_out := v_out || case when v_hint = 'confirmation_required' and (select lt_status from public.local_booking_state where booking_id = bk3) = 'tasker_confirmed'
                     then 'PASS: ' else 'FAIL: ' end || 'a booking cannot reach quote_sent without a valid recorded confirmation (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 14. a closed booking and an open problem report
  update public.bookings set status = 'cancelled' where id = bk3;
  update public.local_booking_state set lt_status = 'awaiting_tasker_confirmation' where booking_id = bk3;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.local_booking_record_confirmation(bk3, gen_random_uuid(), 'confirmed', 'Baba', '08011112222', now(), true, true, 100, '1h', 0, 0, null, null, null, true, false);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'booking_closed' then 'PASS: ' else 'FAIL: ' end || 'a closed booking refuses a record (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 15. reading
  execute 'set local role authenticated'; j := public.local_booking_confirmations(bk); execute 'reset role';
  v_out := v_out || case when j->>'tasker_phone' = '+2348011112222' and j->>'tasker_name' = 'Baba Alabi' and jsonb_array_length(j->'attempts') >= 3
                          and (j->'current'->>'proposed_price')::numeric = 15000
                          and position('request_id' in j::text) = 0 and position('coordinator_id' in j::text) = 0 and position('completion_code' in j::text) = 0
                     then 'PASS: ' else 'FAIL: ' end || 'the managing coordinator reads the current record, attempts, tasker name and phone; no request id or internal ids' || E'\n';
  for n in 1..2 loop
    v_hint := null;
    perform set_config('request.jwt.claims', case n when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text else jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text end, true);
    begin execute 'set local role authenticated'; perform public.local_booking_confirmations(bk); execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || (array['another coordinator','the customer'])[n] || ' cannot read the confirmation (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; select count(*) into n from public.local_booking_confirmations; execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'a coordinator reading the table directly sees nothing (administrators only)' || E'\n';

  -- 16. 5B booking detail still works and shows the new events
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated'; j := public.local_booking_detail(bk); execute 'reset role';
    v_out := v_out || case when j->>'lt_status' is not null and exists (select 1 from jsonb_array_elements(j->'events') e where e->>'kind' = 'confirmation_recorded')
                       then 'PASS: ' else 'FAIL: ' end || '5B booking detail still works and lists the confirmation events' || E'\n';
  exception when undefined_function then execute 'reset role'; v_out := v_out || 'SKIP: 5B not installed' || E'\n'; end;

  -- ===== 5C-2: the quote ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk4; execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.local_booking_record_confirmation(bk4, gen_random_uuid(), 'confirmed', 'Baba Alabi', '08011112222', now(), true, true, 20000, '1 day', 2000, 5000, 'Hinges', null, null, true, false);
  execute 'reset role';
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_quotes', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_quotes', 'update')
                          and not has_table_privilege('anon', 'public.local_booking_quotes', 'select')
                          and has_function_privilege('authenticated', 'public.local_booking_send_quote(uuid,uuid,numeric,numeric,numeric,text,text,text)', 'execute')
                          and not has_function_privilege('anon', 'public.local_booking_quote(uuid)', 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'no browser access to the quote table; quote functions for signed-in users only' || E'\n';
  v_out := v_out || case when not exists (select 1 from pg_proc p where p.proname = 'local_booking_send_quote' and pg_get_function_arguments(p.oid) ~* 'fee|price|service')
                     then 'PASS: ' else 'FAIL: ' end || 'the quote function has no parameter that could set the service fee' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_step(bk4, 'quote_sent', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'use_quote' then 'PASS: ' else 'FAIL: ' end || 'the raw step to quote_sent is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_hint := null;
  begin execute 'set local role service_role'; perform public._local_booking_transition(bk4, 'quote_sent', cA, 'coordinator', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'use_quote' then 'PASS: ' else 'FAIL: ' end || 'even the internal transition refuses quote_sent without a quote' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated';
    insert into public.local_booking_quotes (booking_id, confirmation_id, coordinator_id, request_id, version, service_fee, total)
    select bk4, id, cA, gen_random_uuid(), 1, 1, 1 from public.local_booking_confirmations where booking_id = bk4;
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint = '42501' then 'PASS: ' else 'FAIL: ' end || 'a coordinator cannot insert a quote (or a service fee) directly (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  -- refused quotes
  for n in 1..6 loop
    v_hint := null;
    begin execute 'set local role authenticated';
      perform public.local_booking_send_quote(bk4, gen_random_uuid(),
        case n when 1 then 2500 when 3 then 50 else 1500 end,
        case n when 2 then 6000 else null end,
        case n when 4 then 500 when 5 then 25000 when 6 then -1 else 0 end,
        case n when 5 then 'Parking' else null end, null, null);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = (case when n in (1, 2) then 'exceeds_confirmed' else 'bad_input' end) then 'PASS: ' else 'FAIL: ' end
             || 'refused quote #' || n || ' (' || (array['transport above what the tasker said','materials above what the tasker said','transport under 100','other cost without a label','other cost above the service fee','negative amount'])[n]
             || '; ' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_out := v_out || case when not exists (select 1 from public.local_booking_quotes where booking_id = bk4) and (select lt_status from public.local_booking_state where booking_id = bk4) = 'tasker_confirmed'
                     then 'PASS: ' else 'FAIL: ' end || 'refused quotes left nothing behind' || E'\n';
  select md5(b::text) into sig1 from public.bookings b where id = bk4;
  r := gen_random_uuid();
  execute 'set local role authenticated';
  j := public.local_booking_send_quote(bk4, r, 1500, null, 1000, 'Parking fee', 'Customer must arrange access', 'First quote');
  execute 'reset role';
  select md5(b::text) into sig2 from public.bookings b where id = bk4;
  select id into q1 from public.local_booking_quotes where booking_id = bk4 and superseded_at is null;
  v_out := v_out || case when j->>'lt_status' = 'quote_sent' and (j->>'total')::numeric = 27500 and (j->>'version')::int = 1
                          and exists (select 1 from public.local_booking_quotes q join public.local_booking_confirmations c on c.id = q.confirmation_id
                                       where q.id = q1 and q.service_fee = c.proposed_price and q.service_fee = 20000 and q.transport_amount = 1500 and q.materials_amount = 5000 and q.other_amount = 1000
                                         and q.total = 27500 and q.coordinator_id = cA)
                     then 'PASS: ' else 'FAIL: ' end || 'quote v1: service fee 20000 copied from the confirmation, transport lowered to 1500, materials 5000, other 1000, total 27500, booking at quote_sent' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_booking_events where booking_id = bk4 and kind = 'quote_recorded' and note like 'Quote version 1, total%27,500.00%' and actor_id = cA)
                          and exists (select 1 from public.local_tasker_audit_log where action = 'local_booking_quote' and entity_id = bk4::text and after_data->>'quote_id' = q1::text)
                     then 'PASS: ' else 'FAIL: ' end || 'audit rows exist for the quote (event and audit log)' || E'\n';
  v_out := v_out || case when sig1 = sig2 then 'PASS: ' else 'FAIL: ' end || 'the booking row (amount, payment status, code) is unchanged by the quote' || E'\n';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk4, r, 1500, null, 1000, 'Parking fee', 'x', null); execute 'reset role';
  v_out := v_out || case when (j->>'duplicate')::boolean and (select count(*) from public.local_booking_quotes where booking_id = bk4) = 1 then 'PASS: ' else 'FAIL: ' end || 'a retried send adds no second quote' || E'\n';
  foreach v_state in array array['service_fee = 1', 'total = 1', 'transport_amount = 0', 'superseded_at = null, total = 5'] loop
    v_hint := null;
    begin execute 'update public.local_booking_quotes set ' || v_state || ' where id = ''' || q1 || '''';
    exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'immutable' then 'PASS: ' else 'FAIL: ' end || 'editing a recorded quote is rejected even for the database owner (' || v_state || ')' || E'\n';
  end loop;
  v_hint := null;
  begin delete from public.local_booking_quotes where id = q1; exception when others then get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint = 'P0001' then 'PASS: ' else 'FAIL: ' end || 'a recorded quote cannot be deleted' || E'\n';
  -- read
  execute 'set local role authenticated'; j := public.local_booking_quote(bk4); execute 'reset role';
  v_out := v_out || case when (j->'current'->>'total')::numeric = 27500 and jsonb_array_length(j->'current'->'lines') = 4
                          and (select string_agg(l->>'payment_kind', ',' order by (l->>'sort')::int) from jsonb_array_elements(j->'current'->'lines') l) = 'full_payment,transport,materials,additional_cost'
                          and (select (l->>'held_in_escrow')::boolean from jsonb_array_elements(j->'current'->'lines') l where l->>'key' = 'service_fee') is true
                          and (select count(*) from jsonb_array_elements(j->'current'->'lines') l where (l->>'held_in_escrow')::boolean) = 1
                          and (j->'confirmed'->>'transport_amount')::numeric = 2000 and position('commission' in lower(j::text)) = 0
                          and position('request_id' in j::text) = 0 and position('completion_code' in j::text) = 0
                     then 'PASS: ' else 'FAIL: ' end || 'read: four lines mapped to the Job Room kinds (service fee in escrow, add-ons not), what the confirmation allows, no commission line, no internal ids' || E'\n';
  for n in 1..2 loop
    v_hint := null;
    perform set_config('request.jwt.claims', case n when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text else jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text end, true);
    begin execute 'set local role authenticated'; perform public.local_booking_quote(bk4); perform public.local_booking_send_quote(bk4, gen_random_uuid(), null, null, 0, null, null, null); execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || (array['another coordinator','the customer'])[n] || ' cannot read or send a quote (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  -- the customer declines (internal, 5D), the coordinator revises: v2, v1 retired, still one current
  execute 'set local role service_role'; perform public._local_booking_transition(bk4, 'quote_declined', cust, 'customer', 'Too much'); execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk4, gen_random_uuid(), 0, null, 0, null, null, 'Dropped transport'); execute 'reset role';
  v_out := v_out || case when (j->>'version')::int = 2 and (j->>'total')::numeric = 25000 and j->>'lt_status' = 'quote_sent'
                          and (select superseded_at from public.local_booking_quotes where id = q1) is not null
                          and (select count(*) from public.local_booking_quotes where booking_id = bk4 and superseded_at is null) = 1
                          and exists (select 1 from public.local_booking_events where booking_id = bk4 and kind = 'quote_superseded')
                     then 'PASS: ' else 'FAIL: ' end || 'after a customer decline, a revised quote v2 (25000) retires v1 and stays the single current one' || E'\n';
  -- a changed price needs a new call; the old quote is retired and the next quote follows the new price
  execute 'set local role authenticated'; perform public.local_booking_step(bk4, 'awaiting_tasker_confirmation', 'Tasker changed the price'); execute 'reset role';
  v_out := v_out || case when not exists (select 1 from public.local_booking_quotes where booking_id = bk4 and superseded_at is null) then 'PASS: ' else 'FAIL: ' end || 'sending the booking back to the tasker retires the current quote' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_send_quote(bk4, gen_random_uuid(), null, null, 0, null, null, null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'invalid_transition' then 'PASS: ' else 'FAIL: ' end || 'no quote can be sent while waiting for the tasker (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  execute 'set local role authenticated';
  perform public.local_booking_record_confirmation(bk4, gen_random_uuid(), 'confirmed', 'Baba Alabi', '08011112222', now(), true, true, 22000, '1 day', 0, 0, null, null, null, true, false);
  j := public.local_booking_send_quote(bk4, gen_random_uuid(), null, null, 0, null, null, null);
  execute 'reset role';
  v_out := v_out || case when (j->>'version')::int = 3 and (j->>'total')::numeric = 22000
                          and (select service_fee from public.local_booking_quotes where booking_id = bk4 and superseded_at is null) = 22000
                     then 'PASS: ' else 'FAIL: ' end || 'the next quote follows the NEW recorded price (22000) and is version 3' || E'\n';
  -- the total cap
  execute 'set local role authenticated'; perform public.local_booking_step(bk4, 'awaiting_tasker_confirmation', null);
  perform public.local_booking_record_confirmation(bk4, gen_random_uuid(), 'confirmed', 'Baba Alabi', '08011112222', now(), true, true, 10000000, '1 week', 0, 0, null, null, null, true, false); execute 'reset role';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_send_quote(bk4, gen_random_uuid(), null, null, 100, 'Extra', null, null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'a total above 10,000,000 is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 17. deleting a booking takes its confirmations with it (account removal)
  delete from public.bookings where id = bk2; delete from public.bookings where id = bk4;
  v_out := v_out || case when not exists (select 1 from public.local_booking_confirmations where booking_id = bk2) and not exists (select 1 from public.local_booking_quotes where booking_id = bk4)
                     then 'PASS: ' else 'FAIL: ' end || 'deleting a booking removes its confirmations and quotes without error' || E'\n';

  v_out := v_out || case when position('FAIL: ' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 5C-2 TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

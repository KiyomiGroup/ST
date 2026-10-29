-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3a tests (customer unreachable, tasker no-show, going-back rule)
-- Requires everything up to stage-5d2-core.sql and stage-5d3a-core.sql.
-- Select the WHOLE file (from "create or replace function pg_temp" to the last "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 5D-3a TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" is normal when the real project differs from the stand-in (it is not a failure).
-- The tests put bookings straight into the "quote approved" state (the editor runs as the database owner).
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
    return 'ERR:' || coalesce(nullif(v_hint, ''), sqlstate);
  end;
end $f$;

do $$
declare
  v_out text := ''; j jsonb; t text; n1 int; n2 int; n3 int; n4 int; sig1 text; sig2 text; i int;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cS uuid := gen_random_uuid(); cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid(); tk uuid := gen_random_uuid();
  bk uuid; bk2 uuid; bk3 uuid; bk4 uuid; bk5 uuid; bk6 uuid; bk7 uuid;
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); rx uuid;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5d3a-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cS, cust, cust2, tk]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5D3A A', 'active'), (cB, 'ST5D3A B', 'active'), (cS, 'ST5D3A S', 'active');
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk2;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk3;
  insert into public.bookings (customer_id, tasker_id) values (cust2, tk) returning id into bk4;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk5;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk6;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk7;
  -- bk quote_sent; bk2 approved (no-show tests); bk3 approved (arrived tests); bk4 approved, another customer + coordinator S; bk5 regular (no state);
  -- bk6 awaiting the Local Tasker; bk7 approved (going back allowed before arrival)
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values
    (bk, tk, cA, cA, 'quote_sent'), (bk2, tk, cA, cA, 'quote_approved'), (bk3, tk, cA, cA, 'quote_approved'), (bk4, tk, cS, cS, 'quote_approved'),
    (bk6, tk, cA, cA, 'awaiting_tasker_confirmation'), (bk7, tk, cA, cA, 'quote_approved');

  -- 1. privileges
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_exceptions', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_exceptions', 'update')
        and not has_table_privilege('authenticated', 'public.local_booking_exceptions', 'delete') and not has_table_privilege('anon', 'public.local_booking_exceptions', 'select') then 'PASS: ' else 'FAIL: ' end
        || 'nobody can write the exception table from the browser; visitors cannot read it' || E'\n';
  v_out := v_out || case when has_function_privilege('authenticated', 'public.local_booking_record_exception(uuid,uuid,text,timestamptz,text)', 'execute')
        and has_function_privilege('authenticated', 'public.local_booking_exceptions(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_record_exception(uuid,uuid,text,timestamptz,text)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_customer_exceptions(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_no_show_standing(uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'signed-in users can call the three functions, visitors cannot, and the internal helper is not callable from the browser' || E'\n';

  -- 2. who may call
  t := pg_temp.st_try(cB, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator gets "not found"' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot record an exception' || E'\n';
  t := pg_temp.st_try(null, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk, r1));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a visitor with no login is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk5, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular booking (no Local Tasker state) is not found' || E'\n';
  update public.coordinators set status = 'suspended' where user_id = cS;
  t := pg_temp.st_try(cS, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk4, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a suspended coordinator is refused' || E'\n';
  update public.coordinators set status = 'active' where user_id = cS;

  -- 3. bad input, wrong step
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''teleported'', null, null)', bk, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unknown exception is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, null, ''customer_unreachable'', null, null)', bk));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a missing request id is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, %L)', bk, r1, repeat('x', 301)));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a note over 300 characters is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk6, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:wrong_step' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'unreachable is refused while the Local Tasker is still being asked' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:wrong_step' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a no-show is refused before the customer approved the quote' || E'\n';
  select count(*) into n1 from public.local_booking_exceptions where booking_id in (bk, bk6, bk4);
  v_out := v_out || case when n1 = 0 then 'PASS: ' else 'FAIL: ' end || 'the refused calls left nothing behind' || E'\n';

  -- 4. customer unreachable: record, retry, bad times, limit of five
  select md5(b::text) into sig1 from public.bookings b where id = bk;
  select count(*) into n1 from public.payment_requests; select count(*) into n2 from public.payment_intents;
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, ''Phone off'')', bk, r1));
  v_out := v_out || case when t like '%"changed": true%' and t like '%"duplicate": false%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'unreachable is recorded while the quote waits for the customer' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, ''Phone off'')', bk, r1));
  select count(*) into n3 from public.local_booking_exceptions where booking_id = bk;
  v_out := v_out || case when t like '%"duplicate": true%' and n3 = 1 then 'PASS: ' else 'FAIL(' || t || '/' || n3 || '): ' end || 'a retry with the same request id returns the earlier result and adds nothing' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a request id cannot be reused for a different exception' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', now() + interval ''1 hour'', null)', bk, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:bad_time' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a time in the future is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', now() - interval ''4 days'', null)', bk, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:bad_time' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a time more than 3 days back is refused' || E'\n';
  for i in 1..4 loop
    perform pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk, gen_random_uuid()));
  end loop;
  select count(*) into n3 from public.local_booking_exceptions where booking_id = bk;
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''customer_unreachable'', null, null)', bk, gen_random_uuid()));
  v_out := v_out || case when n3 = 5 and t = 'ERR:limit_reached' then 'PASS: ' else 'FAIL(' || n3 || '/' || t || '): ' end || 'five attempts are allowed, the sixth is refused' || E'\n';
  select md5(b::text) into sig2 from public.bookings b where id = bk;
  v_out := v_out || case when sig1 = sig2 then 'PASS: ' else 'FAIL: ' end || 'the booking row is byte-for-byte unchanged by the exceptions' || E'\n';
  v_out := v_out || case when (select count(*) from public.payment_requests) = n1 and (select count(*) from public.payment_intents) = n2 then 'PASS: ' else 'FAIL: ' end || 'no payment request or payment intent was created' || E'\n';
  v_out := v_out || case when (select lt_status from public.local_booking_state where booking_id = bk) = 'quote_sent' then 'PASS: ' else 'FAIL: ' end || 'the Local Tasker status did not move' || E'\n';

  -- 5. tasker no-show: record, once, blocks the day-of steps
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, ''Not at the house'')', bk2, r2));
  v_out := v_out || case when t like '%"changed": true%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a no-show is recorded on an approved booking' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk2, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:already_recorded' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a second no-show for the same quote is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk2, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:no_show_standing' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'while a no-show stands, no day-of step can be recorded' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_milestones(%L)', bk2));
  v_out := v_out || case when t::jsonb->>'blocked_reason' = 'no_show' and not (t::jsonb->>'can_record')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the milestone read says "no_show" and offers nothing' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_exceptions(%L)', bk2));
  j := t::jsonb;
  v_out := v_out || case when (j->>'no_show_standing')::boolean and not (j->>'can_no_show')::boolean and j->>'no_show_blocked' = 'already_recorded' and (j->>'can_unreachable')::boolean
        and jsonb_array_length(j->'items') = 1 and (j->>'can_go_back')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator read shows the standing no-show and what can still be recorded' || E'\n';
  -- a no-show stops standing once the quote is replaced (the booking was sent back and quoted again)
  begin
    insert into public.local_booking_quotes (booking_id, created_at) values (bk2, clock_timestamp() - interval '1 hour');
    t := pg_temp.st_try(cA, format('select public.local_booking_milestones(%L)', bk2));
    if t::jsonb->>'blocked_reason' = 'no_show' then
      update public.local_booking_quotes set superseded_at = clock_timestamp() where booking_id = bk2 and superseded_at is null;
      insert into public.local_booking_quotes (booking_id, created_at) values (bk2, clock_timestamp() + interval '1 second');
      t := pg_temp.st_try(cA, format('select public.local_booking_milestones(%L)', bk2));
      v_out := v_out || case when t::jsonb->>'blocked_reason' is null and (t::jsonb->>'can_record')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after the quote is replaced the old no-show no longer blocks the day-of steps' || E'\n';
    else
      v_out := v_out || 'FAIL(' || t || '): a no-show recorded after the current quote must stand' || E'\n';
    end if;
  exception when others then v_out := v_out || 'SKIP: could not create stand-in quotes in this project (' || sqlerrm || '); the quote-replacement rule is UNVERIFIED here' || E'\n'; end;

  -- 6. arrived blocks a no-show and blocks going back
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk3, gen_random_uuid()));
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''arrived'', null, null)', bk3, gen_random_uuid()));
  v_out := v_out || case when t like '%"changed": true%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'setup: address confirmed and arrived recorded on the third booking' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk3, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:already_arrived' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a no-show is refused once the Local Tasker is recorded as arrived' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_exceptions(%L)', bk3));
  v_out := v_out || case when not (t::jsonb->>'can_go_back')::boolean and t::jsonb->>'no_show_blocked' = 'already_arrived' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator read says the booking can no longer go back' || E'\n';
  begin
    update public.local_booking_state set lt_status = 'awaiting_tasker_confirmation' where booking_id = bk3;
    v_out := v_out || 'FAIL: the booking was sent back after arrival' || E'\n';
  exception when others then
    get stacked diagnostics t = pg_exception_hint;
    v_out := v_out || case when t = 'work_started' then 'PASS: ' else 'FAIL(' || coalesce(t, sqlerrm) || '): ' end || 'sending the booking back is refused once "arrived" is recorded' || E'\n';
  end;
  v_out := v_out || case when (select lt_status from public.local_booking_state where booking_id = bk3) = 'quote_approved' then 'PASS: ' else 'FAIL: ' end || 'the refused move left the status as it was' || E'\n';
  -- going back is still fine before anyone has arrived, and other moves are untouched
  perform pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk7, gen_random_uuid()));
  begin
    update public.local_booking_state set lt_status = 'awaiting_tasker_confirmation' where booking_id = bk7;
    v_out := v_out || 'PASS: before arrival (only "address confirmed" recorded) the booking can still be sent back' || E'\n';
  exception when others then v_out := v_out || 'FAIL(' || sqlerrm || '): going back before arrival was refused' || E'\n'; end;
  begin
    update public.local_booking_state set lt_status = 'quote_sent' where booking_id = bk3;
    v_out := v_out || 'PASS: other status moves are not affected by the going-back rule' || E'\n';
  exception when others then v_out := v_out || 'FAIL(' || sqlerrm || '): an unrelated status move was refused' || E'\n'; end;
  update public.local_booking_state set lt_status = 'quote_approved' where booking_id = bk3;

  -- 7. customer read
  t := pg_temp.st_try(cust, 'select public.local_booking_customer_exceptions(null)');
  j := t::jsonb;
  v_out := v_out || case when jsonb_array_length(j) = 2 and (select count(*) from jsonb_array_elements(j) e where (e->>'booking_id')::uuid in (bk, bk2)) = 2 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer sees the exceptions of their own bookings only' || E'\n';
  v_out := v_out || case when t not like '%coordinator%' and t not like '%note%' and t not like '%request%' and t not like '%recorded_at%' and t not like '%Phone off%' and t not like '%Not at the house%' then 'PASS: ' else 'FAIL: ' end || 'the customer read has no coordinator id, note, request id or recording time' || E'\n';
  t := pg_temp.st_try(cust2, 'select public.local_booking_customer_exceptions(null)');
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another customer sees nothing' || E'\n';
  t := pg_temp.st_try(null, 'select public.local_booking_customer_exceptions(null)');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a visitor cannot read exceptions' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_booking_exceptions(%L)', bk));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot read these exceptions' || E'\n';

  -- 8. audit
  select count(*) into n1 from public.local_booking_events where booking_id = bk and kind = 'exception';
  select count(*) into n2 from public.local_tasker_audit_log where action = 'local_booking_exception' and entity_id = bk::text;
  v_out := v_out || case when n1 = 5 and n2 = 5 then 'PASS: ' else 'FAIL(' || n1 || '/' || n2 || '): ' end || 'every exception left one event row and one audit row' || E'\n';

  -- 9. immutability
  begin update public.local_booking_exceptions set kind = 'tasker_no_show' where booking_id = bk; v_out := v_out || 'FAIL: an exception could be edited' || E'\n';
  exception when others then v_out := v_out || 'PASS: a recorded exception cannot be edited' || E'\n'; end;
  begin delete from public.local_booking_exceptions where booking_id = bk; v_out := v_out || 'FAIL: an exception could be deleted' || E'\n';
  exception when others then v_out := v_out || 'PASS: a recorded exception cannot be deleted' || E'\n'; end;

  -- 10. closed booking and open problem report
  update public.bookings set status = 'completed' where id = bk7;
  update public.local_booking_state set lt_status = 'quote_approved' where booking_id = bk7;
  t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk7, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:booking_closed' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a closed booking refuses exceptions' || E'\n';
  update public.bookings set status = 'pending' where id = bk7;
  begin
    insert into public.job_disputes (booking_id, status) values (bk7, 'open');
    t := pg_temp.st_try(cA, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk7, gen_random_uuid()));
    v_out := v_out || case when t = 'ERR:dispute_open' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an open problem report freezes exceptions' || E'\n';
    delete from public.job_disputes where booking_id = bk7;
  exception when others then v_out := v_out || 'SKIP: could not open a problem report with the stand-in columns (' || sqlerrm || ')' || E'\n'; end;

  -- 11. cascade
  t := pg_temp.st_try(cS, format('select public.local_booking_record_exception(%L, %L, ''tasker_no_show'', null, null)', bk4, gen_random_uuid()));
  v_out := v_out || case when t like '%"changed": true%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the booking''s own coordinator can record on it' || E'\n';
  begin delete from public.bookings where id = bk4; v_out := v_out || 'PASS: deleting a booking removes its exceptions without error' || E'\n';
  exception when others then v_out := v_out || 'FAIL: deleting a booking with exceptions failed (' || sqlerrm || ')' || E'\n'; end;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 5D-3a TESTS\n%', v_out;
end $$;

-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-2 tests (milestones on the day of the job)
-- Requires everything up to stage-5d1-core.sql and stage-5d2-core.sql.
-- Select the WHOLE file (from "create or replace function pg_temp" to the last "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 5D-2 TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" is normal when the real project differs from the stand-in (it is not a failure).
-- The tests put bookings straight into the "quote approved" state (the editor runs as the database owner); the approval flow itself is covered by stage-5d1-tests.sql.
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
  v_out text := ''; j jsonb; t text; n1 int; n2 int; n3 int; n4 int; sig1 text; sig2 text;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cS uuid := gen_random_uuid(); cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid(); tk uuid := gen_random_uuid();
  bk uuid; bk2 uuid; bk3 uuid; bk4 uuid; bk5 uuid;
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid(); r5 uuid := gen_random_uuid(); rx uuid;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5d2-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cS, cust, cust2, tk]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5D2 A', 'active'), (cB, 'ST5D2 B', 'active'), (cS, 'ST5D2 S', 'active');
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk2;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk3;
  insert into public.bookings (customer_id, tasker_id) values (cust2, tk) returning id into bk4;
  insert into public.bookings (customer_id, tasker_id) values (cust, tk) returning id into bk5;
  -- bk: quote sent (not approved yet); bk2: approved, unpaid; bk3: approved, will be closed; bk4: approved, another customer, coordinator S; bk5: no state row (a regular booking)
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values
    (bk, tk, cA, cA, 'quote_sent'), (bk2, tk, cA, cA, 'quote_approved'), (bk3, tk, cA, cA, 'quote_approved'), (bk4, tk, cS, cS, 'quote_approved');

  -- 1. privileges
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_milestones', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_milestones', 'update')
        and not has_table_privilege('authenticated', 'public.local_booking_milestones', 'delete') and not has_table_privilege('anon', 'public.local_booking_milestones', 'select') then 'PASS: ' else 'FAIL: ' end
        || 'nobody can write the milestone table from the browser; visitors cannot read it' || E'\n';
  v_out := v_out || case when has_function_privilege('authenticated', 'public.local_booking_record_milestone(uuid,uuid,text,timestamptz,text)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_record_milestone(uuid,uuid,text,timestamptz,text)', 'execute')
        and not has_function_privilege('anon', 'public.local_booking_customer_milestones(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_booking_milestone_block(uuid,text)', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'signed-in users can call the three functions, visitors cannot, and the internal helper is not callable from the browser' || E'\n';

  -- 2. before approval, and who may call
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk, r1));
  v_out := v_out || case when t = 'ERR:not_approved' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nothing can be recorded before the customer approves the quote' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk2, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator gets "not found" for this booking' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk2, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot record a milestone' || E'\n';
  t := pg_temp.st_try(null, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk2, r1));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a visitor with no login is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk5, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular booking (no Local Tasker state) is not found' || E'\n';
  update public.coordinators set status = 'suspended' where user_id = cS;
  t := pg_temp.st_try(cS, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk4, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a suspended coordinator is refused' || E'\n';
  update public.coordinators set status = 'active' where user_id = cS;

  -- 3. bad input
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''teleported'', null, null)', bk2, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unknown milestone is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, null, ''arrived'', null, null)', bk2));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a missing request id is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, %L)', bk2, r1, repeat('x', 301)));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a note over 300 characters is refused' || E'\n';
  select count(*) into n1 from public.local_booking_milestones where booking_id = bk2;
  v_out := v_out || case when n1 = 0 then 'PASS: ' else 'FAIL: ' end || 'the refused calls left nothing behind' || E'\n';

  -- 4. order, retry, duplicates
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''arrived'', null, null)', bk2, r1));
  v_out := v_out || case when t = 'ERR:out_of_order' then 'PASS: ' else 'FAIL(' || t || '): ' end || '"arrived" before "address confirmed" is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', now() - interval ''20 minutes'', ''Spoke to Baba'')', bk2, r1));
  v_out := v_out || case when t like '%"changed": true%' and t like '%address_confirmed%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator records "address confirmed"' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk2, r1));
  v_out := v_out || case when t like '%"duplicate": true%' and t like '%"changed": false%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the same request again returns the earlier result (retry-safe)' || E'\n';
  select count(*) into n1 from public.local_booking_milestones where booking_id = bk2;
  v_out := v_out || case when n1 = 1 then 'PASS: ' else 'FAIL: ' end || 'a retry wrote no second row' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''arrived'', null, null)', bk2, r1));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a request id used for something else is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk2, r2));
  v_out := v_out || case when t = 'ERR:already_recorded' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'recording the same milestone twice with a new request is refused' || E'\n';

  -- 5. times
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''arrived'', now() + interval ''1 hour'', null)', bk2, r2));
  v_out := v_out || case when t = 'ERR:bad_time' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a time in the future is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''arrived'', now() - interval ''5 days'', null)', bk2, r2));
  v_out := v_out || case when t = 'ERR:bad_time' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a time more than 3 days back is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''arrived'', now() - interval ''40 minutes'', null)', bk2, r2));
  v_out := v_out || case when t = 'ERR:bad_time' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a time earlier than the previous step is refused' || E'\n';

  -- 6. arrived, then the payment gate on "started"
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''arrived'', null, null)', bk2, r2));
  v_out := v_out || case when t like '%"changed": true%' then 'PASS: ' else 'FAIL(' || t || '): ' end || '"arrived" recorded (time defaults to now)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''started'', null, null)', bk2, r3));
  v_out := v_out || case when t = 'ERR:payment_needed' then 'PASS: ' else 'FAIL(' || t || '): ' end || '"started" is refused while the booking is unpaid' || E'\n';
  update public.bookings set payment_status = 'pending' where id = bk2;
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''started'', null, null)', bk2, r3));
  v_out := v_out || case when t = 'ERR:payment_needed' then 'PASS: ' else 'FAIL(' || t || '): ' end || '"started" is still refused while the payment is only pending' || E'\n';
  update public.bookings set payment_status = 'paid' where id = bk2;
  select md5(b::text) into sig1 from public.bookings b where id = bk2;
  select count(*) into n1 from public.payment_requests; select count(*) into n2 from public.payment_intents;
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''started'', null, ''Work began'')', bk2, r3));
  v_out := v_out || case when t like '%"changed": true%' then 'PASS: ' else 'FAIL(' || t || '): ' end || '"started" is recorded once the payment is on record' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''finished'', null, null)', bk2, r4));
  v_out := v_out || case when t like '%"changed": true%' then 'PASS: ' else 'FAIL(' || t || '): ' end || '"finished" is recorded' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''finished'', null, null)', bk2, r5));
  v_out := v_out || case when t = 'ERR:already_recorded' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nothing can be recorded after "finished"' || E'\n';

  -- 7. no money object and no status is touched
  select md5(b::text) into sig2 from public.bookings b where id = bk2;
  v_out := v_out || case when sig1 = sig2 then 'PASS: ' else 'FAIL: ' end || 'the booking row (status, payment, amount, code) is byte-for-byte unchanged by the milestones' || E'\n';
  v_out := v_out || case when (select count(*) from public.payment_requests) = n1 and (select count(*) from public.payment_intents) = n2 then 'PASS: ' else 'FAIL: ' end || 'no payment request or payment intent was created' || E'\n';
  v_out := v_out || case when (select lt_status from public.local_booking_state where booking_id = bk2) = 'quote_approved' then 'PASS: ' else 'FAIL: ' end || 'the Local Tasker status did not move (finished is a record, not a completion)' || E'\n';

  -- 8. coordinator read
  t := pg_temp.st_try(cA, format('select public.local_booking_milestones(%L)', bk2));
  j := t::jsonb;
  v_out := v_out || case when (select string_agg(x->>'kind', ',') from jsonb_array_elements(j->'items') x) = 'address_confirmed,arrived,started,finished'
        and j->>'next_kind' is null and (j->>'can_record')::boolean = false and j->>'blocked_reason' = 'all_recorded' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator sees four milestones in order, nothing left to record' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_milestones(%L)', bk3));
  j := t::jsonb;
  v_out := v_out || case when j->>'next_kind' = 'address_confirmed' and (j->>'can_record')::boolean and jsonb_array_length(j->'items') = 0 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a fresh approved booking offers "address confirmed" first' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_booking_milestones(%L)', bk));
  v_out := v_out || case when t::jsonb->>'blocked_reason' = 'not_approved' and not (t::jsonb->>'can_record')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'before approval the read says "not approved" and nothing can be recorded' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_booking_milestones(%L)', bk2));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot read these milestones' || E'\n';

  -- 9. customer read
  t := pg_temp.st_try(cust, 'select public.local_booking_customer_milestones(null)');
  j := t::jsonb;
  v_out := v_out || case when jsonb_array_length(j) = 1 and (j->0->>'booking_id')::uuid = bk2 and jsonb_array_length(j->0->'items') = 4 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer sees the four milestones of their own booking only' || E'\n';
  v_out := v_out || case when t not like '%coordinator%' and t not like '%note%' and t not like '%request%' and t not like '%recorded_at%' and t not like '%Work began%' then 'PASS: ' else 'FAIL: ' end || 'the customer read has no coordinator id, note, request id or recording time' || E'\n';
  t := pg_temp.st_try(cust2, 'select public.local_booking_customer_milestones(null)');
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another customer sees nothing' || E'\n';
  t := pg_temp.st_try(null, 'select public.local_booking_customer_milestones(null)');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a visitor cannot read milestones' || E'\n';

  -- 10. audit
  select count(*) into n1 from public.local_booking_events where booking_id = bk2 and kind = 'milestone';
  select count(*) into n2 from public.local_tasker_audit_log where action = 'local_booking_milestone' and entity_id = bk2::text;
  v_out := v_out || case when n1 = 4 and n2 = 4 then 'PASS: ' else 'FAIL(' || n1 || '/' || n2 || '): ' end || 'every milestone left one event row and one audit row' || E'\n';

  -- 11. immutability and cascade
  begin update public.local_booking_milestones set kind = 'arrived' where booking_id = bk2 and kind = 'finished'; v_out := v_out || 'FAIL: a milestone could be edited' || E'\n';
  exception when others then v_out := v_out || 'PASS: a recorded milestone cannot be edited' || E'\n'; end;
  begin delete from public.local_booking_milestones where booking_id = bk2; v_out := v_out || 'FAIL: a milestone could be deleted' || E'\n';
  exception when others then v_out := v_out || 'PASS: a recorded milestone cannot be deleted' || E'\n'; end;

  -- 12. closed booking and open problem report
  update public.bookings set status = 'completed' where id = bk3;
  t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk3, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:booking_closed' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a closed booking refuses milestones' || E'\n';
  update public.bookings set status = 'pending' where id = bk3;
  begin
    insert into public.job_disputes (booking_id, status) values (bk3, 'open');
    t := pg_temp.st_try(cA, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk3, gen_random_uuid()));
    v_out := v_out || case when t = 'ERR:dispute_open' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an open problem report freezes milestones' || E'\n';
    delete from public.job_disputes where booking_id = bk3;
  exception when others then v_out := v_out || 'SKIP: could not open a problem report with the stand-in columns (' || sqlerrm || ')' || E'\n'; end;

  -- 13. another customer's booking handled by coordinator S works for S only; cascade delete of a booking with milestones
  t := pg_temp.st_try(cS, format('select public.local_booking_record_milestone(%L, %L, ''address_confirmed'', null, null)', bk4, gen_random_uuid()));
  v_out := v_out || case when t like '%"changed": true%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the booking''s own coordinator can record on it' || E'\n';
  begin delete from public.bookings where id = bk4; v_out := v_out || 'PASS: deleting a booking removes its milestones without error' || E'\n';
  exception when others then v_out := v_out || 'FAIL: deleting a booking with milestones failed (' || sqlerrm || ')' || E'\n'; end;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 5D-2 TESTS\n%', v_out;
end $$;

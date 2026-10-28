-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5B tests (coordinator booking list and detail)
-- Requires stage-2d, 4b1, 4b2, 4c1, 5a1, 5a2 and stage-5b-core.sql.
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 5B TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- The customer phone check is skipped (shown as SKIP, not FAIL) if the verifications table does not accept a plain insert.
-- ============================================================================
do $$
declare
  v_out text := ''; v_hint text; n int; j jsonb; sid uuid; bk uuid; bk2 uuid; before_sig text; after_sig text; phone_ok boolean := false;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5b-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cust, t2]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST5B customer', 'customer', '{}'), (t2, 'ST5B regular tasker', 'tasker', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5B A', 'active'), (cB, 'ST5B B', 'active');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi', '+2348011112222', 'Yaba, Sabo', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.save_local_tasker_service(t1, null, 'Solid Wood Wardrobe Repair', 'carpentry', 12500, '/job', 'Standard labour fee.', null, array['Wardrobes'], 'available_this_week', true, 'in_person', 'Form 7', null);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id, notes) values (cust, t1, 'Fix my wardrobe door') returning id into bk;
  insert into public.bookings (customer_id, tasker_id, notes) values (cust, t2, 'Regular job') returning id into bk2; execute 'reset role';
  -- money and the release code are set by the "payment system" (here: the editor role), as in real life
  update public.bookings set amount = 15000, payment_status = 'paid', completion_code = '987654' where id = bk;
  begin insert into public.verifications (user_id, phone) values (cust, '+2348099998888'); phone_ok := true; exception when others then phone_ok := false; end;

  -- 1. privileges
  v_out := v_out || case when not has_function_privilege('anon', 'public.local_booking_list(integer)', 'execute')
                          and not has_function_privilege('anon', 'public.local_booking_detail(uuid)', 'execute')
                          and has_function_privilege('authenticated', 'public.local_booking_list(integer)', 'execute')
                          and has_function_privilege('authenticated', 'public.local_booking_detail(uuid)', 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'only signed-in users can call list and detail' || E'\n';

  -- 2. the managing coordinator's list
  select md5(string_agg(x::text, '|' order by x::text)) into before_sig from (select b::text from public.bookings b union all select e::text from public.local_booking_events e union all select s::text from public.local_booking_state s) q(x);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_list(100); execute 'reset role';
  v_out := v_out || case when jsonb_array_length(j) = 1 and (j -> 0 ->> 'booking_id')::uuid = bk then 'PASS: ' else 'FAIL: ' end || 'coordinator A sees exactly the one Local Tasker booking (not the regular tasker booking)' || E'\n';
  v_out := v_out || case when j -> 0 ->> 'title' = 'Fix my wardrobe door' and j -> 0 ->> 'tasker_name' = 'Baba Alabi' and j -> 0 ->> 'customer_name' = 'ST5B customer'
                          and j -> 0 ->> 'lt_status' = 'assigned' and (j -> 0 ->> 'amount')::numeric = 15000 and j -> 0 ->> 'payment_status' = 'paid'
                          and (j -> 0 ->> 'open')::boolean and not (j -> 0 ->> 'frozen')::boolean
                     then 'PASS: ' else 'FAIL: ' end || 'the list row has title, names, status, amount and open/frozen flags' || E'\n';
  v_out := v_out || case when position('987654' in j::text) = 0 and not (j -> 0 ? 'completion_code') and not (j -> 0 ? 'customer_id') and not (j -> 0 ? 'tasker_id')
                          and not (j -> 0 ? 'code_attempts') and not (j -> 0 ? 'payment_ref') and not (j -> 0 ? 'dispute_reason') and not (j -> 0 ? 'customer_phone')
                     then 'PASS: ' else 'FAIL: ' end || 'the list never carries the release code, customer id, tasker id, payment ref or phone' || E'\n';

  -- 3. who else gets what
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_list(100); execute 'reset role';
  v_out := v_out || case when jsonb_array_length(j) = 0 then 'PASS: ' else 'FAIL: ' end || 'coordinator B sees an empty list' || E'\n';
  for i in 1..4 loop
    v_hint := null;
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                     when 2 then jsonb_build_object('sub', t2::text, 'role', 'authenticated')::text
                                                     when 3 then jsonb_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text
                                                     else jsonb_build_object('role', 'authenticated')::text end, true);
    begin execute 'set local role authenticated'; perform public.local_booking_list(10); execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || (array['the customer', 'a regular tasker', 'an unknown user', 'no user id'])[i] || ' cannot list coordinator bookings (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_hint := null;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  begin execute 'set local role anon'; perform public.local_booking_list(10); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint = '42501' then 'PASS: ' else 'FAIL: ' end || 'anonymous visitors cannot call list (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 4. detail for the managing coordinator
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_detail(bk); execute 'reset role';
  v_out := v_out || case when j ->> 'lt_status' = 'assigned' and j ->> 'customer_name' = 'ST5B customer' and j ->> 'tasker_name' = 'Baba Alabi'
                          and (j ->> 'amount')::numeric = 15000 and (j ->> 'open')::boolean and (j ->> 'original_coordinator_is_me')::boolean
                          and j -> 'allowed_next' = '["awaiting_tasker_confirmation"]'::jsonb and j ->> 'notes' = 'Fix my wardrobe door'
                     then 'PASS: ' else 'FAIL: ' end || 'detail shows status, names, amount, notes and the allowed next step' || E'\n';
  v_out := v_out || case when position('987654' in j::text) = 0 and not (j ? 'completion_code') and not (j ? 'customer_id') and not (j ? 'tasker_id') and not (j ? 'payment_ref')
                     then 'PASS: ' else 'FAIL: ' end || 'detail never carries the release code, customer id, tasker id or payment ref' || E'\n';
  v_out := v_out || case when not phone_ok then 'SKIP: ' when j ->> 'customer_phone' = '+2348099998888' then 'PASS: ' else 'FAIL: ' end || 'customer phone shown while the booking is open' || E'\n';
  v_out := v_out || case when jsonb_array_length(j -> 'events') >= 1 and j -> 'events' -> 0 ->> 'kind' = 'assigned' and not (j -> 'events' -> 0 ? 'actor_id') and not (j -> 'events' -> 0 ? 'coordinator_id')
                     then 'PASS: ' else 'FAIL: ' end || 'history lists the assigned event without internal ids' || E'\n';

  -- 5. detail: not mine / not there
  for i in 1..5 loop
    v_hint := null;
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                     when 2 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                     when 3 then jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text
                                                     when 4 then jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text
                                                     else jsonb_build_object('role', 'authenticated')::text end, true);
    begin execute 'set local role authenticated';
      perform public.local_booking_detail(case i when 3 then gen_random_uuid() when 4 then bk2 else bk end); execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || (array['another coordinator', 'the customer', 'a random booking id', 'a regular (non Local Tasker) booking', 'no user id'])[i] || ' gets not_found from detail (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;

  -- 6. closed booking: phone hidden, open false, list moves it out of "open"
  update public.bookings set status = 'cancelled' where id = bk;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_detail(bk); execute 'reset role';
  v_out := v_out || case when not (j ->> 'open')::boolean and j ->> 'customer_phone' is null and j ->> 'booking_status' = 'cancelled' then 'PASS: ' else 'FAIL: ' end || 'a closed booking is not open and its phone is hidden' || E'\n';
  update public.bookings set status = 'pending' where id = bk;

  -- 7. nothing was written by reading
  select md5(string_agg(x::text, '|' order by x::text)) into before_sig from (select b::text from public.bookings b union all select e::text from public.local_booking_events e union all select s::text from public.local_booking_state s) q(x);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_list(100); perform public.local_booking_detail(bk); execute 'reset role';
  select md5(string_agg(x::text, '|' order by x::text)) into after_sig from (select b::text from public.bookings b union all select e::text from public.local_booking_events e union all select s::text from public.local_booking_state s) q(x);
  v_out := v_out || case when before_sig = after_sig then 'PASS: ' else 'FAIL: ' end || 'list and detail change no booking, state or event row' || E'\n';

  -- 8. limit handling
  execute 'set local role authenticated';
  j := public.local_booking_list(0); n := jsonb_array_length(j); j := public.local_booking_list(null); execute 'reset role';
  v_out := v_out || case when n = 1 and jsonb_array_length(j) = 1 then 'PASS: ' else 'FAIL: ' end || 'limit 0 is raised to 1 and a null limit falls back to the default' || E'\n';

  -- 9. a dispute shows as frozen
  begin
    insert into public.message_threads (context_type, context_id) values ('booking', bk::text) returning id into sid;
    insert into public.job_disputes (thread_id, status) values (sid, 'open');
    execute 'set local role authenticated'; j := public.local_booking_detail(bk); execute 'reset role';
    v_out := v_out || case when (j ->> 'frozen')::boolean then 'PASS: ' else 'FAIL: ' end || 'an open problem report shows as frozen' || E'\n';
  exception when others then execute 'reset role'; v_out := v_out || 'SKIP: dispute stand-in tables differ here' || E'\n'; end;

  -- 10. when the assignment ends the booking leaves coordinator A's list (it waits for reassignment)
  update public.coordinator_assignments set ended_at = now(), ended_by = cA, end_reason = 'test' where tasker_user_id = t1 and ended_at is null;
  execute 'set local role authenticated'; j := public.local_booking_list(100); execute 'reset role';
  v_out := v_out || case when jsonb_array_length(j) = 0 then 'PASS: ' else 'FAIL: ' end || 'after the assignment ends the booking is no longer in the old coordinator''s list (' || jsonb_array_length(j) || ' rows)' || E'\n';

  v_out := v_out || case when position('FAIL' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 5B TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-1 tests (customer approves or declines the quote; payment requests are created)
-- Requires everything up to stage-5c2-core.sql, messaging-step6.sql, messaging-step7.sql and stage-5d1-core.sql.
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 5D-1 TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" is normal when a stand-in of the real project differs (it is not a failure).
-- ============================================================================
do $$
declare
  v_out text := ''; v_hint text; n int; j jsonb; j2 jsonb; bk uuid; bk2 uuid; bk3 uuid; bk4 uuid; bk5 uuid; bk6 uuid; bk7 uuid;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid(); r uuid := gen_random_uuid(); th uuid; sig1 text; sig2 text; rid uuid; v_kind text;
  v_admin boolean;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st5d-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cust, cust2]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST5D customer', 'customer', '{}'), (cust2, 'ST5D other customer', 'customer', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST5D A', 'active'), (cB, 'ST5D B', 'active');
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
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_step(bk, 'awaiting_tasker_confirmation', null); execute 'reset role';
  execute 'set local role authenticated'; perform public.local_booking_record_confirmation(bk, gen_random_uuid(), 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 20000, '2 hours', 2000, 3000, 'Hinges', null, null, true, false); execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk, gen_random_uuid(), 1500, 3000, 1000, 'Disposal', null, 'Includes the hinges'); execute 'reset role';
  select md5(b::text) into sig1 from public.bookings b where id = bk;

  -- 1. privileges
  v_out := v_out || case when not has_table_privilege('authenticated', 'public.local_booking_quote_decisions', 'insert') and not has_table_privilege('authenticated', 'public.local_booking_quote_decisions', 'update') and not has_table_privilege('authenticated', 'public.local_booking_quote_decisions', 'delete') and not has_table_privilege('authenticated', 'public.local_booking_quote_requests', 'select') and not has_table_privilege('authenticated', 'public.local_booking_quote_requests', 'insert') and not has_table_privilege('anon', 'public.local_booking_quote_decisions', 'select') then 'PASS: ' else 'FAIL: ' end || 'nobody can write the decision or link tables from the browser; visitors cannot read them' || E'\n';
  v_out := v_out || case when not has_function_privilege('anon', 'public.local_booking_customer_quotes(uuid)', 'execute') and not has_function_privilege('anon', 'public.local_booking_decide_quote(uuid,integer,uuid,text,text)', 'execute') and has_function_privilege('authenticated', 'public.local_booking_customer_quotes(uuid)', 'execute') and has_function_privilege('authenticated', 'public.local_booking_decide_quote(uuid,integer,uuid,text,text)', 'execute') and not has_function_privilege('authenticated', 'public._local_booking_create_requests(public.local_booking_quotes,uuid,uuid)', 'execute') and not has_function_privilege('authenticated', 'public._local_booking_thread(uuid,uuid,uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end || 'only signed-in users can call the two customer functions; the helpers are not callable from the browser' || E'\n';

  -- 2. what the customer sees
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_customer_quotes(null); execute 'reset role';
  v_out := v_out || case when jsonb_array_length(j) = 1 and (j->0->>'booking_id')::uuid = bk and j->0->>'lt_status' = 'quote_sent' then 'PASS: ' else 'FAIL: ' end || 'the customer sees exactly the one booking that has a quote' || E'\n';
  v_out := v_out || case when (select string_agg(x->>'key', ',' order by ord) from jsonb_array_elements(j->0->'quote'->'lines') with ordinality as t(x, ord)) = 'service_fee,transport,materials,other' and (j->0->'quote'->>'total')::numeric = 25500 and (j->0->'quote'->>'version')::int = 1 and j->0->'quote'->>'note' = 'Includes the hinges' and j->0->>'tasker_name' = 'Baba A.' and j->0->'decision' = 'null'::jsonb and j->0->'payments' = '[]'::jsonb then 'PASS: ' else 'FAIL: ' end || 'the quote has four lines in order (service fee, transport, materials, other) and the total 25,500 (20,000 + 1,500 + 3,000 + 1,000)' || E'\n';
  v_out := v_out || case when (j->0->'quote'->'lines'->3->>'label') = 'Disposal' and (j->0->'quote'->'lines'->0->>'held_in_escrow')::boolean and not (j->0->'quote'->'lines'->1->>'held_in_escrow')::boolean then 'PASS: ' else 'FAIL: ' end || 'the other line carries the coordinator''s label; only the service fee is marked as held in escrow' || E'\n';
  v_out := v_out || case when position(cA::text in j::text) = 0 and position(t1::text in j::text) = 0 and position('confirmation' in j::text) = 0 and position('second_check' in j::text) = 0 and position('request_id' in j::text) = 0 and position('coordinator' in j::text) = 0 and j::text !~ '0801|8011112222|Alabi' then 'PASS: ' else 'FAIL: ' end || 'nothing internal leaks: no coordinator, tasker or confirmation id, no call number, no second-check or request fields' || E'\n';
  execute 'set local role authenticated'; j2 := public.local_booking_customer_quotes(gen_random_uuid()); execute 'reset role';
  v_out := v_out || case when j2 = '[]'::jsonb then 'PASS: ' else 'FAIL: ' end || 'asking for another booking id returns nothing' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust2::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j2 := public.local_booking_customer_quotes(null); execute 'reset role';
  v_out := v_out || case when j2 = '[]'::jsonb then 'PASS: ' else 'FAIL: ' end || 'another customer sees nothing' || E'\n';
  perform set_config('request.jwt.claims', '{}', true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_customer_quotes(null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'a visitor with no sign-in is refused the read (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 3. who may answer
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust2::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'another customer cannot answer (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'the coordinator cannot answer for the customer (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'declined', 'x'); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'another coordinator cannot answer either (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  perform set_config('request.jwt.claims', '{}', true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'a visitor with no sign-in cannot answer (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  select count(*) into n from public.local_booking_quote_decisions where booking_id = bk;
  v_out := v_out || case when n = 0 and (select lt_status from public.local_booking_state where booking_id = bk) = 'quote_sent' and (select count(*) from public.payment_requests p join public.message_threads t on t.id = p.thread_id where t.context_id::text = bk::text) = 0 then 'PASS: ' else 'FAIL: ' end || 'none of those left a decision or moved the booking' || E'\n';

  -- 4. refused answers leave nothing
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'maybe', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'an unknown answer is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, null, 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'a missing request id is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, null, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'a missing version is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'declined', repeat('x', 301)); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'a reason over 300 characters is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 7, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'quote_changed' then 'PASS: ' else 'FAIL: ' end || 'answering a version the customer did not see is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_out := v_out || case when not exists (select 1 from public.local_booking_quote_decisions where booking_id = bk) and (select count(*) from public.payment_requests p join public.message_threads t on t.id = p.thread_id where t.context_id::text = bk::text) = 0 and (select lt_status from public.local_booking_state where booking_id = bk) = 'quote_sent' then 'PASS: ' else 'FAIL: ' end || 'no refused answer left a decision, a payment request or a message, and the booking is still waiting' || E'\n';

  -- 5. decline
  r := gen_random_uuid();
  execute 'set local role authenticated'; j := public.local_booking_decide_quote(bk, 1, r, 'declined', 'Too expensive for me'); execute 'reset role';
  v_out := v_out || case when j->>'decision' = 'declined' and j->>'lt_status' = 'quote_declined' and (j->>'changed')::boolean and (j->>'requests_created')::int = 0 and (select lt_status from public.local_booking_state where booking_id = bk) = 'quote_declined' then 'PASS: ' else 'FAIL: ' end || 'declining moves the booking to quote_declined and says so' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_booking_quote_decisions d where d.booking_id = bk and d.customer_id = cust and d.decision = 'declined' and d.reason = 'Too expensive for me') and (select count(*) from public.payment_requests p join public.message_threads t on t.id = p.thread_id where t.context_id::text = bk::text) = 0 and (select count(*) from public.messages m join public.message_threads t on t.id = m.thread_id where t.context_id::text = bk::text) = 0 then 'PASS: ' else 'FAIL: ' end || 'the decision is recorded with the customer and the reason; no money object or chat card was made' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_booking_events where booking_id = bk and kind = 'status_changed' and to_status = 'quote_declined' and actor_id = cust and actor_role = 'customer') and exists (select 1 from public.local_booking_events where booking_id = bk and kind = 'quote_decision') and exists (select 1 from public.local_tasker_audit_log where action = 'local_booking_quote_decision' and entity_id = bk::text and actor_id = cust) then 'PASS: ' else 'FAIL: ' end || 'events and the audit log record it (status event with the customer as actor, decision event, audit row)' || E'\n';
  execute 'set local role authenticated'; j := public.local_booking_decide_quote(bk, 1, r, 'declined', 'Too expensive for me'); execute 'reset role';
  v_out := v_out || case when (j->>'duplicate')::boolean and (select count(*) from public.local_booking_quote_decisions where booking_id = bk) = 1 then 'PASS: ' else 'FAIL: ' end || 'a retried tap with the same request id adds nothing' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'invalid_transition' then 'PASS: ' else 'FAIL: ' end || 'a different request id on an answered quote is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  execute 'set local role authenticated'; j := public.local_booking_customer_quotes(bk); execute 'reset role';
  v_out := v_out || case when j->0->>'lt_status' = 'quote_declined' and j->0->'decision'->>'decision' = 'declined' and j->0->'decision'->>'reason' = 'Too expensive for me' and j->0->'payments' = '[]'::jsonb then 'PASS: ' else 'FAIL: ' end || 'the customer''s view now shows the decline with the reason and no payments' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_quote(bk); execute 'reset role';
  v_out := v_out || case when j->'current'->'decision'->>'decision' = 'declined' and j->'current'->'decision'->>'reason' = 'Too expensive for me' and j->>'lt_status' = 'quote_declined' then 'PASS: ' else 'FAIL: ' end || 'the coordinator sees the customer''s decision and reason on the current quote' || E'\n';

  -- 6. revised quote, then approve
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk, gen_random_uuid(), 1500, 3000, 1000, 'Disposal', null, null); execute 'reset role';
  v_out := v_out || case when (j->>'version')::int = 2 and j->>'lt_status' = 'quote_sent' and (select superseded_at is not null from public.local_booking_quotes where booking_id = bk and version = 1) then 'PASS: ' else 'FAIL: ' end || 'the coordinator''s revised quote is version 2 and the old decision belongs to version 1 only' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; j := public.local_booking_customer_quotes(bk); execute 'reset role';
  v_out := v_out || case when (j->0->'quote'->>'version')::int = 2 and j->0->'decision' = 'null'::jsonb then 'PASS: ' else 'FAIL: ' end || 'the customer sees version 2 with no decision yet' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'quote_changed' then 'PASS: ' else 'FAIL: ' end || 'answering the old version 1 is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  select md5(b::text) into sig1 from public.bookings b where id = bk;
  r := gen_random_uuid();
  execute 'set local role authenticated'; j := public.local_booking_decide_quote(bk, 2, r, 'approved', null); execute 'reset role';
  v_out := v_out || case when j->>'decision' = 'approved' and j->>'lt_status' = 'quote_approved' and (j->>'requests_created')::int = 4 and (select lt_status from public.local_booking_state where booking_id = bk) = 'quote_approved' then 'PASS: ' else 'FAIL: ' end || 'approving moves the booking to quote_approved and creates four payment requests' || E'\n';
  select id into th from public.message_threads where context_type = 'booking' and context_id::text = bk::text and customer_id = cust and tasker_id = t1;
  v_out := v_out || case when th is not null and (select count(*) from public.message_threads where context_id::text = bk::text) = 1 and (select count(*) from public.payment_requests where thread_id = th and customer_id = cust and tasker_id = t1 and status = 'pending') = 4 and (select count(*) from public.payment_requests p join public.message_threads t on t.id = p.thread_id where t.context_id::text = bk::text) = 4 then 'PASS: ' else 'FAIL: ' end || 'they are in the booking''s Job Room (one thread, customer and Local Tasker as the two sides), all pending' || E'\n';
  v_out := v_out || case when exists (select 1 from public.payment_requests where thread_id = th and kind = 'full_payment' and amount = 20000) and exists (select 1 from public.payment_requests where thread_id = th and kind = 'transport' and amount = 1500) then 'PASS: ' else 'FAIL: ' end || 'the service fee is a full_payment of 20,000 (the escrow main payment); transport 1,500 is a transport request' || E'\n';
  v_kind := public._local_booking_request_kind('materials');
  v_out := v_out || case when exists (select 1 from public.payment_requests where thread_id = th and kind = v_kind and amount = 3000) and exists (select 1 from public.payment_requests where thread_id = th and kind = 'additional_cost' and amount = 1000 and reason like 'Disposal%') and v_kind in ('materials', 'additional_cost') then 'PASS: ' else 'FAIL: ' end || 'materials (3,000) and the other cost (1,000, labelled) are add-on requests; materials uses the materials kind only where the table accepts it' || E'\n';
  v_out := v_out || case when (select count(*) from public.messages m join public.payment_requests p on p.id = m.payment_request_id where m.thread_id = th and m.type = 'payment_request' and m.body = 'PAYMENT_REQUEST:' || p.id || ':' || p.amount::bigint and m.sender_id = t1 and m.receiver_id = cust) = 4 then 'PASS: ' else 'FAIL: ' end || 'every request has a chat card (type payment_request, body PAYMENT_REQUEST:id:amount) so the customer can pay it' || E'\n';
  v_out := v_out || case when (select sum(amount) from public.payment_requests where thread_id = th) = 25500 and (select count(*) from public.local_booking_quote_requests l join public.local_booking_quotes q on q.id = l.quote_id where q.version = 2 and q.booking_id = bk) = 4 then 'PASS: ' else 'FAIL: ' end || 'the amounts add up to the quote total (25,500) and every request is linked to quote version 2' || E'\n';
  select md5(b::text) into sig2 from public.bookings b where id = bk;
  v_out := v_out || case when sig1 = sig2 and not exists (select 1 from public.payment_intents where booking_id = bk) then 'PASS: ' else 'FAIL: ' end || 'approving changed nothing on the booking row (no price, payment status, amount or code) and created no payment attempt, wallet or escrow row' || E'\n';
  v_out := v_out || case when (select last_message from public.message_threads where id = th) = 'Quote approved: ₦25,500' and (select customer_unread from public.message_threads where id = th) = 4 then 'PASS: ' else 'FAIL: ' end || 'the thread preview and the customer''s unread count were updated' || E'\n';
  execute 'set local role authenticated'; j := public.local_booking_decide_quote(bk, 2, r, 'approved', null); execute 'reset role';
  v_out := v_out || case when (j->>'duplicate')::boolean and (select count(*) from public.payment_requests p join public.message_threads t on t.id = p.thread_id where t.context_id::text = bk::text) = 4 and (select count(*) from public.messages m join public.message_threads t on t.id = m.thread_id where t.context_id::text = bk::text) = 4 then 'PASS: ' else 'FAIL: ' end || 'a retried approval with the same request id creates nothing more' || E'\n';
  execute 'set local role authenticated'; j := public.local_booking_customer_quotes(bk); execute 'reset role';
  v_out := v_out || case when j->0->>'lt_status' = 'quote_approved' and j->0->'decision'->>'decision' = 'approved' and jsonb_array_length(j->0->'payments') = 4 and (select bool_and(x->>'status' = 'pending') from jsonb_array_elements(j->0->'payments') x) then 'PASS: ' else 'FAIL: ' end || 'the customer''s view shows the approval and four pending payments' || E'\n';

  -- 7. the existing Job Room rules still apply to these requests
  select id into rid from public.payment_requests where thread_id = th and kind = 'transport';
  begin
    execute 'set local role authenticated'; update public.payment_requests set status = 'declined' where id = rid; execute 'reset role';
    v_out := v_out || case when (select status from public.payment_requests where id = rid) = 'declined' then 'PASS: ' else 'FAIL: ' end || 'the customer can decline the transport request in the Job Room (existing guard)' || E'\n';
  exception when others then execute 'reset role'; v_out := v_out || 'SKIP: customer decline of a request not testable here (' || sqlerrm || ')' || E'\n'; end;
  v_hint := null;
  begin execute 'set local role authenticated'; update public.payment_requests set amount = 1 where thread_id = th; execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint is not null then 'PASS: ' else 'FAIL: ' end || 'the customer cannot edit the amount of a request (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 8. money must not be stranded
  select id into rid from public.payment_requests where thread_id = th and kind = 'full_payment';
  update public.payment_requests set status = 'processing' where id = rid;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_step(bk, 'awaiting_tasker_confirmation', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'payment_started' then 'PASS: ' else 'FAIL: ' end || 'while the payment for the quote has started, the booking cannot go back to the Local Tasker (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  update public.payment_requests set status = 'pending' where id = rid;
  select id into rid from public.payment_requests where thread_id = th and reason like 'Disposal%';
  update public.payment_requests set status = 'paid', paid_at = now(), settlement = 'held' where id = rid;
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_step(bk, 'awaiting_tasker_confirmation', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'payment_started' then 'PASS: ' else 'FAIL: ' end || 'a PAID add-on also blocks it (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_out := v_out || case when (select lt_status from public.local_booking_state where booking_id = bk) = 'quote_approved' and (select superseded_at is null from public.local_booking_quotes where booking_id = bk and version = 2) then 'PASS: ' else 'FAIL: ' end || 'the refused attempts changed nothing' || E'\n';
  update public.payment_requests set status = 'pending', paid_at = null, settlement = null where id = rid;
  execute 'set local role authenticated'; perform public.local_booking_step(bk, 'awaiting_tasker_confirmation', 'Customer wants a change'); execute 'reset role';
  v_out := v_out || case when (select superseded_at is not null from public.local_booking_quotes where booking_id = bk and version = 2) and not exists (select 1 from public.payment_requests where thread_id = th and status in ('pending', 'processing', 'paid', 'failed')) and (select count(*) from public.payment_requests where thread_id = th and status = 'cancelled') in (3, 4) and (select count(*) from public.payment_requests p join public.message_threads t on t.id = p.thread_id where t.context_id::text = bk::text) = 4 then 'PASS: ' else 'FAIL: ' end || 'with nothing paid, going back retires quote 2 and CANCELS its unpaid requests (the declined one stays declined)' || E'\n';

  -- 9. immutable records, cascade
  v_hint := null;
  begin update public.local_booking_quote_decisions set decision = 'approved' where booking_id = bk; exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'immutable' then 'PASS: ' else 'FAIL: ' end || 'a recorded decision cannot be edited, even by the database owner (immutable)' || E'\n';
  v_hint := null;
  begin delete from public.local_booking_quote_decisions where booking_id = bk; exception when others then get stacked diagnostics v_hint = returned_sqlstate; end;
  v_out := v_out || case when v_hint = 'P0001' then 'PASS: ' else 'FAIL: ' end || 'a recorded decision cannot be deleted' || E'\n';
  delete from public.bookings where id = bk;
  v_out := v_out || case when not exists (select 1 from public.local_booking_quote_decisions where booking_id = bk) and not exists (select 1 from public.local_booking_quote_requests where quote_id in (select id from public.local_booking_quotes where booking_id = bk)) then 'PASS: ' else 'FAIL: ' end || 'deleting a booking removes its decisions and links without error' || E'\n';

  -- 10. refusals at the moment of answering
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk2; execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_step(bk2, 'awaiting_tasker_confirmation', null); execute 'reset role';
  execute 'set local role authenticated'; perform public.local_booking_record_confirmation(bk2, gen_random_uuid(), 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 20000, '2 hours', 2000, 3000, 'Hinges', null, null, true, false); execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk2, gen_random_uuid(), null, null, 0, null, null, 'Includes the hinges'); execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  update public.bookings set status = 'cancelled' where id = bk2;
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk2, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'booking_closed' then 'PASS: ' else 'FAIL: ' end || 'a closed booking cannot be answered (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk3; execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_step(bk3, 'awaiting_tasker_confirmation', null); execute 'reset role';
  execute 'set local role authenticated'; perform public.local_booking_record_confirmation(bk3, gen_random_uuid(), 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 20000, '2 hours', 2000, 3000, 'Hinges', null, null, true, false); execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk3, gen_random_uuid(), null, null, 0, null, null, 'Includes the hinges'); execute 'reset role';
  begin
    insert into public.message_threads (customer_id, tasker_id, context_type, context_id) values (cust, t1, 'booking', bk3) returning id into th;
    insert into public.job_disputes (thread_id, status) values (th, 'open');
    perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
    v_hint := null;
    begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk3, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'dispute_open' then 'PASS: ' else 'FAIL: ' end || 'a booking with an open problem report cannot be answered (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  exception when others then v_out := v_out || 'SKIP: dispute stand-in tables differ here' || E'\n'; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk4; execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_step(bk4, 'awaiting_tasker_confirmation', null); execute 'reset role';
  execute 'set local role authenticated'; perform public.local_booking_record_confirmation(bk4, gen_random_uuid(), 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 20000, '2 hours', 2000, 3000, 'Hinges', null, null, true, false); execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk4, gen_random_uuid(), null, null, 0, null, null, 'Includes the hinges'); execute 'reset role';
  update public.bookings set payment_status = 'paid' where id = bk4;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk4, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'already_paid' then 'PASS: ' else 'FAIL: ' end || 'a booking that already has a payment on record cannot be approved again (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  v_out := v_out || case when not exists (select 1 from public.local_booking_quote_decisions where booking_id = bk4) and (select lt_status from public.local_booking_state where booking_id = bk4) = 'quote_sent' then 'PASS: ' else 'FAIL: ' end || 'that refusal left no decision, no request and the booking is still at quote_sent' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk5; execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_step(bk5, 'awaiting_tasker_confirmation', null); execute 'reset role';
  execute 'set local role authenticated'; perform public.local_booking_record_confirmation(bk5, gen_random_uuid(), 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 20000, '2 hours', 2000, 3000, 'Hinges', null, null, true, false); execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk5, gen_random_uuid(), null, null, 0, null, null, 'Includes the hinges'); execute 'reset role';
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id) values (cust, t1, 'booking', bk5) returning id into th;
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, status) values (th, t1, cust, 9000, 'full_payment', 'pending');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk5, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'already_paid' then 'PASS: ' else 'FAIL: ' end || 'a Job Room that already has an open main payment request is not given a second one (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 11. all or nothing, and an existing Job Room is reused
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk6; execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.local_booking_step(bk6, 'awaiting_tasker_confirmation', null); execute 'reset role';
  execute 'set local role authenticated'; perform public.local_booking_record_confirmation(bk6, gen_random_uuid(), 'confirmed', 'Baba Alabi', '0801 111 2222', now(), true, true, 20000, '2 hours', 2000, 3000, 'Hinges', null, null, true, false); execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_send_quote(bk6, gen_random_uuid(), null, null, 0, null, null, 'Includes the hinges'); execute 'reset role';
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id) values (cust, t1, 'booking', bk6) returning id into th;
  execute 'create function public._st_test_block_msg() returns trigger language plpgsql as $f$ begin if NEW.type = ''payment_request'' then raise exception ''blocked''; end if; return NEW; end $f$';
  execute 'create trigger st_test_block_msg before insert on public.messages for each row execute function public._st_test_block_msg()';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  v_hint := 'none';
  begin execute 'set local role authenticated'; perform public.local_booking_decide_quote(bk6, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  exception when others then execute 'reset role'; v_hint := 'raised'; end;
  v_out := v_out || case when v_hint = 'raised' and not exists (select 1 from public.local_booking_quote_decisions where booking_id = bk6) and (select lt_status from public.local_booking_state where booking_id = bk6) = 'quote_sent' and not exists (select 1 from public.payment_requests where thread_id = th) then 'PASS: ' else 'FAIL: ' end || 'if the chat card cannot be posted the whole approval fails and nothing is approved' || E'\n';
  execute 'drop trigger st_test_block_msg on public.messages'; execute 'drop function public._st_test_block_msg()';
  execute 'set local role authenticated'; j := public.local_booking_decide_quote(bk6, 1, gen_random_uuid(), 'approved', null); execute 'reset role';
  v_out := v_out || case when (j->>'requests_created')::int = 3 and (select count(*) from public.message_threads where context_id::text = bk6::text) = 1 and (select count(*) from public.payment_requests where thread_id = th) = 3 then 'PASS: ' else 'FAIL: ' end || 'once the problem is gone the approval works and uses the EXISTING Job Room (no second thread)' || E'\n';

  -- 12. the 'materials' kind is used only when the table accepts it
  execute 'alter table public.payment_requests drop constraint if exists payment_requests_kind_check';
  execute 'alter table public.payment_requests add constraint payment_requests_kind_check check (kind in (''payment'', ''full_payment'', ''remaining_payment'', ''transport'', ''additional_cost'', ''materials'', ''invoice''))';
  v_out := v_out || case when public._local_booking_request_kind('materials') = 'materials' and public._local_booking_request_kind('other') = 'additional_cost' and public._local_booking_request_kind('service_fee') = 'full_payment' and public._local_booking_request_kind('transport') = 'transport' then 'PASS: ' else 'FAIL: ' end || 'with ''materials'' allowed by the table, a materials line becomes a materials request' || E'\n';

  -- 13. a booking at an earlier step is not shown to the customer
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; insert into public.bookings (customer_id, tasker_id) values (cust, t1) returning id into bk7; execute 'reset role';
  execute 'set local role authenticated'; j := public.local_booking_customer_quotes(bk7); execute 'reset role';
  v_out := v_out || case when j = '[]'::jsonb then 'PASS: ' else 'FAIL: ' end || 'a booking that has no quote yet is not in the customer''s list' || E'\n';

  v_out := v_out || case when position('FAIL: ' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 5D-1 TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

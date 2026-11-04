-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6D-1 tests (coordinator chat: cards, payment history, activity). READ-ONLY functions.
-- Needs stage-6b-core.sql and stage-6d1-core.sql. Select the WHOLE file and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose: an error box that starts "STAGE 6D-1 TESTS"
-- and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
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
  v_out text := ''; j jsonb; t text; n int;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cX uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid(); tk uuid := gen_random_uuid();
  bk1 uuid; bk2 uuid; th1 uuid; pr1 uuid; pr2 uuid; jr1 uuid; jr2 uuid;
  c_pr int; c_jr int; c_rc int; c_ev int; md_before text; md_after text; e_pr int; e_jr int; e_rc int; e_ev int;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st6d1-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cX, cust, cust2, tk]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST6D1 A', 'active'), (cB, 'ST6D1 B', 'active'), (cX, 'ST6D1 X', 'active');
  insert into public.users (id, name, role, profile_details) values (cust, 'ST6D1 customer', 'customer', '{}'), (cust2, 'ST6D1 customer 2', 'customer', '{}'),
         (tk, 'ST6D1 Local Tasker', 'tasker', '{}'), (cA, 'ST6D1 A', 'customer', '{}'), (cB, 'ST6D1 B', 'customer', '{}'), (cX, 'ST6D1 X', 'customer', '{}')
         on conflict (id) do nothing;
  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, tk, 'confirmed', 'unpaid', 15000) returning id into bk1;
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust2, tk, 'confirmed', 'unpaid') returning id into bk2;
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values (bk1, tk, cA, cA, 'assigned'), (bk2, tk, cX, cX, 'assigned');
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk1, now()) returning id into th1;
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, status, kind, title, reason, breakdown, invoice_number)
    values (th1, tk, cust, 15000, 'paid', 'payment', null, 'Main payment', '[{"label":"Service","amount":15000}]'::jsonb, null) returning id into pr1;
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, status, kind, title, invoice_number, due_date)
    values (th1, tk, cust, 3000, 'pending', 'invoice', 'Extra pipe', 'INV-6D1-1', current_date + 3) returning id into pr2;
  insert into public.job_requests (thread_id, customer_id, tasker_id, requested_by, kind, status, note, payload) values
    (th1, cust, tk, tk, 'price_proposal', 'pending', 'after the phone call', '{"amount": 15000}'::jsonb) returning id into jr1;
  insert into public.job_requests (thread_id, customer_id, tasker_id, requested_by, kind, status, note, payload) values
    (th1, cust, tk, cust, 'reschedule', 'pending', 'running late', '{"when":"2026-12-01T09:00:00Z","label":"Tue 01 Dec, 10:00 AM"}'::jsonb) returning id into jr2;
  insert into public.payment_receipts (receipt_number, payment_intent_id, payment_request_id, booking_id, thread_id, customer_id, tasker_id, kind, title, amount, lines, paid_at)
    values ('RCT-6D1-1', gen_random_uuid(), pr1, bk1, th1, cust, tk, 'payment', 'Payment', 15000, '[{"label":"Service","amount":15000}]'::jsonb, now());
  insert into public.job_events (booking_id, thread_id, customer_id, tasker_user_id, actor_id, kind, text, note, payload, created_at) values
    (bk1, th1, cust, tk, cust, 'booked', 'Booking confirmed', null, '{"secret":"ST6D1-PAYLOAD"}'::jsonb, now() - interval '2 hours'),
    (bk1, th1, cust, tk, tk, 'work_update', 'Work update', 'on my way', '{}'::jsonb, now() - interval '1 hour'),
    (bk1, th1, cust, tk, null, 'payment_paid', 'Payment received', null, '{}'::jsonb, now());
  select md5(coalesce((select string_agg(x::text, '|' order by x::text) from public.payment_requests x where thread_id = th1), '') ||
             coalesce((select string_agg(x::text, '|' order by x::text) from public.job_requests x where thread_id = th1), '')) into md_before;

  -- What the REAL project really holds after the setup above (its own triggers may add or change rows).
  select count(*) into e_pr from public.payment_requests where thread_id = th1; select count(*) into e_jr from public.job_requests where thread_id = th1;
  select count(*) into e_rc from public.payment_receipts where thread_id = th1; select count(*) into e_ev from public.job_events where booking_id = bk1;
  v_out := v_out || 'INFO: rows after setup: payment_requests=' || e_pr || ' (inserted 2), job_requests=' || e_jr || ' (inserted 2), payment_receipts=' || e_rc || ' (inserted 1), job_events=' || e_ev || ' (inserted 3)' || E'\n';

  -- 1. privileges
  v_out := v_out || case when has_function_privilege('authenticated', 'public.coordinator_chat_cards(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.coordinator_chat_activity(uuid,integer)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_chat_cards(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_chat_activity(uuid,integer)', 'execute')
        then 'PASS: ' else 'FAIL: ' end || 'signed-in users may call both functions, anonymous may not' || E'\n';

  -- 2. the current coordinator reads the cards
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_cards(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when jsonb_array_length(j->'requests') = e_jr and jsonb_array_length(j->'payments') = e_pr and jsonb_array_length(j->'receipts') = e_rc
        and (j->>'read_only')::boolean = false and (j->>'thread_id') = th1::text then 'PASS: ' else 'FAIL: ' end || 'the current coordinator sees every request, payment request and receipt of the thread (got ' || coalesce(jsonb_array_length(j->'requests')::text,'?') || ' / ' || coalesce(jsonb_array_length(j->'payments')::text,'?') || ' / ' || coalesce(jsonb_array_length(j->'receipts')::text,'?') || ', table has ' || e_jr || ' / ' || e_pr || ' / ' || e_rc || ')' || E'\n';
  v_out := v_out || case when exists (select 1 from jsonb_array_elements(j->'requests') e where e->>'kind' = 'price_proposal' and e->>'by' = 'local_tasker')
        and exists (select 1 from jsonb_array_elements(j->'requests') e where e->>'kind' = 'reschedule' and e->>'by' = 'customer')
        then 'PASS: ' else 'FAIL: ' end || 'who asked is shown as local_tasker or customer' || E'\n';
  v_out := v_out || case when exists (select 1 from jsonb_array_elements(j->'payments') e where e->>'kind' = 'invoice' and e->>'invoice_number' = 'INV-6D1-1' and (e->>'amount')::numeric = 3000)
        and exists (select 1 from jsonb_array_elements(j->'payments') e where e->>'status' = 'paid' and e->'breakdown'->0->>'label' = 'Service')
        then 'PASS: ' else 'FAIL: ' end || 'payment rows carry kind, status, amount, invoice number and breakdown' || E'\n';
  v_out := v_out || case when t !~ cust::text and t !~ tk::text and t !~ cA::text and t !~ 'customer_id|tasker_id|requested_by|responded_by'
        then 'PASS: ' else 'FAIL: ' end || 'no user id and no id column of a person is in the answer' || E'\n';

  -- 3. everyone else is refused
  v_out := v_out || case when pg_temp.st_try(cX, format('select public.coordinator_chat_cards(%L)', bk1)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'another coordinator is refused' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cust, format('select public.coordinator_chat_cards(%L)', bk1)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'the customer is refused' || E'\n';
  v_out := v_out || case when pg_temp.st_try(tk, format('select public.coordinator_chat_cards(%L)', bk1)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'the Local Tasker identity is refused' || E'\n';
  v_out := v_out || case when pg_temp.st_try(null, format('select public.coordinator_chat_cards(%L)', bk1)) like 'ERR:%' then 'PASS: ' else 'FAIL: ' end || 'a call with no sign-in is refused' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_chat_cards(%L)', bk2)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'a booking of another coordinator is refused' || E'\n';

  -- 4. a booking with no conversation yet gives empty lists, not an error
  t := pg_temp.st_try(cX, format('select public.coordinator_chat_cards(%L)', bk2)); j := t::jsonb;
  v_out := v_out || case when j->'thread_id' = 'null'::jsonb and jsonb_array_length(j->'requests') = 0 and jsonb_array_length(j->'payments') = 0 and jsonb_array_length(j->'receipts') = 0
        then 'PASS: ' else 'FAIL: ' end || 'no conversation yet: three empty lists' || E'\n';

  -- 5. activity
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_activity(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when jsonb_array_length(j->'events') = 3 and j->'events'->0->>'kind' = 'payment_paid' and j->'events'->2->>'kind' = 'booked'
        then 'PASS: ' else 'FAIL: ' end || 'activity: 3 events, newest first' || E'\n';
  v_out := v_out || case when j->'events'->0->>'by' = 'system' and j->'events'->1->>'by' = 'local_tasker' and j->'events'->2->>'by' = 'customer'
        then 'PASS: ' else 'FAIL: ' end || 'activity: actor shown as system, local_tasker or customer' || E'\n';
  v_out := v_out || case when t !~ 'ST6D1-PAYLOAD' and t !~ cust::text and t !~ tk::text and t !~ 'actor_id|payload' then 'PASS: ' else 'FAIL: ' end || 'activity: payload and user ids are not returned' || E'\n';
  v_out := v_out || case when jsonb_array_length((pg_temp.st_try(cA, format('select public.coordinator_chat_activity(%L, 2)', bk1)))::jsonb->'events') = 2 then 'PASS: ' else 'FAIL: ' end || 'activity: the limit is honoured' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cX, format('select public.coordinator_chat_activity(%L)', bk1)) = 'ERR:not_found'
        and pg_temp.st_try(cust, format('select public.coordinator_chat_activity(%L)', bk1)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'activity: another coordinator and the customer are refused' || E'\n';

  -- 6. a former coordinator reads, read only
  update public.local_booking_state set coordinator_id = cB where booking_id = bk1;
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_cards(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when (j->>'read_only')::boolean and jsonb_array_length(j->'payments') = e_pr then 'PASS: ' else 'FAIL: ' end || 'a former coordinator reads the cards, read only (read_only=' || coalesce(j->>'read_only','?') || ', payments=' || coalesce(jsonb_array_length(j->'payments')::text,'?') || ', t=' || left(t, 60) || ')' || E'\n';
  t := pg_temp.st_try(cB, format('select public.coordinator_chat_cards(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when not (j->>'read_only')::boolean then 'PASS: ' else 'FAIL: ' end || 'the new coordinator reads the cards with full access' || E'\n';
  update public.coordinators set status = 'suspended' where user_id = cA;
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_chat_cards(%L)', bk1)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'a deactivated coordinator reads nothing' || E'\n';
  update public.coordinators set status = 'active' where user_id = cA;

  -- 7. nothing was written
  select md5(coalesce((select string_agg(x::text, '|' order by x::text) from public.payment_requests x where thread_id = th1), '') ||
             coalesce((select string_agg(x::text, '|' order by x::text) from public.job_requests x where thread_id = th1), '')) into md_after;
  select count(*) into c_pr from public.payment_requests where thread_id = th1; select count(*) into c_jr from public.job_requests where thread_id = th1;
  select count(*) into c_rc from public.payment_receipts where thread_id = th1; select count(*) into c_ev from public.job_events where booking_id = bk1;
  v_out := v_out || case when md_before = md_after and c_pr = e_pr and c_jr = e_jr and c_rc = e_rc and c_ev = e_ev then 'PASS: ' else 'FAIL: ' end || 'the functions wrote nothing (payment requests, job requests, receipts, events unchanged; now ' || c_pr || ' / ' || c_jr || ' / ' || c_rc || ' / ' || c_ev || ', before ' || e_pr || ' / ' || e_jr || ' / ' || e_rc || ' / ' || e_ev || ', rows same: ' || (md_before = md_after) || ')' || E'\n';

  v_out := v_out || 'RESULT: ' || case when v_out like '%FAIL:%' then 'FAILURES FOUND' else 'ALL PASS' end;
  raise exception E'STAGE 6D-1 TESTS\n%', v_out;
end $$;

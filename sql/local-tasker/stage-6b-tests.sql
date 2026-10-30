-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6B tests (coordinator chat and internal notes)
-- Requires everything up to stage-5d1-core.sql, stage-6a-core.sql and stage-6b-core.sql.
-- Select the WHOLE file and press Run in the Supabase SQL editor. It creates throwaway rows and ROLLS THEM BACK by raising an error
-- on purpose: an error box that starts "STAGE 6B TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" means a check could not run in this project (the administrator checks need a real administrator login there);
-- a SKIP is NOT a pass. A line that starts "NOTE:" is information, not a test.
-- ============================================================================
create or replace function pg_temp.st_try(p_user uuid, p_sql text, p_admin boolean default false) returns text
language plpgsql as $f$
declare r jsonb; v_hint text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then '' else jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text end, true);
    perform set_config('st.test_admin', case when p_admin then '1' else '' end, true);
    execute 'set local role authenticated';
    execute p_sql into r;
    execute 'reset role';
    perform set_config('st.test_admin', '', true);
    return coalesce(r::text, 'null');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    execute 'reset role';
    perform set_config('st.test_admin', '', true);
    return 'ERR:' || coalesce(nullif(v_hint, ''), sqlstate);
  end;
end $f$;

do $$
declare
  v_out text := ''; j jsonb; t text; n int; v_adm boolean; v_id text; v_id2 text; a0 int; c0 int; u0 int;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cS uuid := gen_random_uuid(); cX uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid(); tk uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  bk1 uuid; bk2 uuid; bkR uuid; bkT uuid; th1 uuid; thR uuid; r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid();
  n1 uuid := gen_random_uuid(); n2 uuid := gen_random_uuid(); n3 uuid := gen_random_uuid(); lm text; cu int; mk constant text := 'ST6B-SECRET-NOTE call Emeka on 0803 123 4567';
  v_bk1_md5 text; v_pay text; v_status text; base int := 0; rbase int := 0; cu1 int := 0;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st6b-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cS, cX, cust, cust2, tk, adm]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST6B Coordinator A', 'active'), (cB, 'ST6B Coordinator B', 'active'),
         (cS, 'ST6B Suspended', 'active'), (cX, 'ST6B Other', 'active');
  insert into public.users (id, name, role, profile_details) values (cust, 'ST6B customer', 'customer', '{}'), (cust2, 'ST6B customer 2', 'customer', '{}'),
         (tk, 'ST6B Local Tasker', 'tasker', '{}'), (cA, 'ST6B A', 'customer', '{}'), (cB, 'ST6B B', 'customer', '{}'), (cS, 'ST6B S', 'customer', '{}'), (cX, 'ST6B X', 'customer', '{}')
         on conflict (id) do nothing;
  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, tk, 'confirmed', 'unpaid', 15000) returning id into bk1;   -- Local Tasker, coordinator A
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust2, tk, 'confirmed', 'unpaid') returning id into bk2;                 -- Local Tasker, coordinator X
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bkR;                  -- REGULAR booking
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bkT;                  -- throwaway (cascade check)
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values
    (bk1, tk, cA, cA, 'assigned'), (bk2, tk, cX, cX, 'assigned');
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bkR, now()) returning id into thR;
  insert into public.messages (thread_id, sender_id, receiver_id, body, type) values (thR, cust, tk, 'regular booking message', 'text');
  select count(*) into rbase from public.messages where thread_id = thR;
  select md5(row(b.status, b.payment_status, b.amount, b.work_stage)::text) into v_bk1_md5 from public.bookings b where b.id = bk1;

  -- 1. privileges and policies
  v_out := v_out || case when has_function_privilege('authenticated', 'public.coordinator_chat_list(integer)', 'execute')
        and has_function_privilege('authenticated', 'public.coordinator_chat_thread(uuid,integer)', 'execute')
        and has_function_privilege('authenticated', 'public.coordinator_send_message(uuid,uuid,text)', 'execute')
        and has_function_privilege('authenticated', 'public.coordinator_add_note(uuid,uuid,text)', 'execute')
        and has_function_privilege('authenticated', 'public.coordinator_chat_mark_read(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.coordinator_chat_admin_read(uuid,text,integer)', 'execute')
        and has_function_privilege('authenticated', 'public.local_chat_access(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_chat_list(integer)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_chat_thread(uuid,integer)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_send_message(uuid,uuid,text)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_add_note(uuid,uuid,text)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_chat_mark_read(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_chat_admin_read(uuid,text,integer)', 'execute')
        and not has_function_privilege('anon', 'public.local_chat_access(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._lt_contains_contact(text)', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'the seven functions are callable by signed-in users only; the contact-detail helper is not callable from the browser' || E'\n';
  v_out := v_out || case when has_table_privilege('authenticated', 'public.coordinator_internal_notes', 'select')
        and not has_table_privilege('authenticated', 'public.coordinator_internal_notes', 'insert')
        and not has_table_privilege('authenticated', 'public.coordinator_internal_notes', 'update')
        and not has_table_privilege('authenticated', 'public.coordinator_internal_notes', 'delete')
        and not has_table_privilege('anon', 'public.coordinator_internal_notes', 'select')
        and not has_table_privilege('anon', 'public.coordinator_message_authors', 'select')
        and not has_table_privilege('authenticated', 'public.coordinator_message_authors', 'insert')
        and not has_table_privilege('authenticated', 'public.coordinator_thread_reads', 'select')
        and not has_table_privilege('anon', 'public.coordinator_thread_reads', 'select') then 'PASS: ' else 'FAIL: ' end
        || 'the notes table is select-only for signed-in users (RLS decides which rows), anonymous has nothing, the read marks have no browser access at all' || E'\n';
  v_out := v_out || case when (select count(*) from pg_policies where tablename in ('coordinator_internal_notes', 'coordinator_message_authors')) = 2
        and not exists (select 1 from pg_policies where tablename in ('coordinator_internal_notes', 'coordinator_message_authors') and cmd <> 'SELECT')
        and (select relrowsecurity from pg_class where oid = 'public.coordinator_internal_notes'::regclass)
        and (select relrowsecurity from pg_class where oid = 'public.coordinator_message_authors'::regclass)
        and (select relrowsecurity from pg_class where oid = 'public.coordinator_thread_reads'::regclass) then 'PASS: ' else 'FAIL: ' end
        || 'row level security is ON for the three tables; the only policies are the two coordinator SELECT policies (no administrator policy, no write policy)' || E'\n';

  -- 2. the inbox and the thread before anybody has written
  t := pg_temp.st_try(cust2, 'select public.coordinator_chat_list(50)');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a customer cannot use the coordinator inbox' || E'\n';
  t := pg_temp.st_try(tk, 'select public.coordinator_chat_list(50)');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the placeholder Local Tasker identity cannot use the coordinator inbox' || E'\n';
  t := pg_temp.st_try(null, 'select public.coordinator_chat_list(50)');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nobody signed in: not available' || E'\n';
  t := pg_temp.st_try(cB, 'select public.coordinator_chat_list(50)');
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a coordinator with no bookings gets an empty inbox' || E'\n';
  t := pg_temp.st_try(cA, 'select public.coordinator_chat_list(50)');
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when jsonb_array_length(j) = 1 and j -> 0 ->> 'booking_id' = bk1::text and j -> 0 ->> 'access' = 'coordinator' and (j -> 0 -> 'thread_id') = 'null'::jsonb
        and (j -> 0 ->> 'unread')::int = 0 and j -> 0 ->> 'customer_name' = 'ST6B customer' then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'coordinator A sees only their own booking, no thread yet, nothing unread (not coordinator X''s booking)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when (j -> 'thread_id') = 'null'::jsonb and j -> 'messages' = '[]'::jsonb and j -> 'notes' = '[]'::jsonb and not (j ->> 'read_only')::boolean and j ->> 'access' = 'coordinator' then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'reading a booking that has no thread yet does not create one and returns empty lists' || E'\n';
  select count(*) into n from public.message_threads where context_id::text = bk1::text;
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'still no thread after reading' || E'\n';
  foreach t in array array[cB::text, cust::text, cust2::text, tk::text] loop
    v_out := v_out || case when pg_temp.st_try(t::uuid, format('select public.coordinator_chat_thread(%L)', bk1)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end
          || 'a person who is not the coordinator of the booking cannot read its conversation function (' || left(t, 4) || ')' || E'\n';
  end loop;
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bkR));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular (non Local Tasker) booking is not reachable through the coordinator functions' || E'\n';

  -- 3. sending: who may, what is refused (nothing is created by a refusal)
  foreach t in array array[cB::text, cust::text, cust2::text, tk::text] loop
    v_out := v_out || case when pg_temp.st_try(t::uuid, format('select public.coordinator_send_message(%L, %L, ''hello'')', bk1, gen_random_uuid())) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end
          || 'only the booking''s coordinator can send (' || left(t, 4) || ' refused)' || E'\n';
  end loop;
  t := pg_temp.st_try(null, format('select public.coordinator_send_message(%L, %L, ''hello'')', bk1, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nobody signed in cannot send' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, ''hello'')', bkR, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular booking cannot be written to through this function' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, ''   '')', bk1, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an empty message is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, %L)', bk1, gen_random_uuid(), repeat('a', 2001)));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a message over 2000 characters is refused' || E'\n';
  n := 0;
  foreach t in array array['call me on 08031234567', 'ring 0803 123 4567 tonight', 'use +2348031234567', 'mail me at emeka@example.com', 'chat on wa.me/2348031234567',
                           'my number is the one on the card', 'text me on the other line', 'meet me off-platform please', 'Ref 0803-123-4567'] loop
    if pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, %L)', bk1, gen_random_uuid(), t)) = 'ERR:contact_info' then n := n + 1; end if;
  end loop;
  v_out := v_out || case when n = 9 then 'PASS: ' else 'FAIL(' || n || '/9): ' end || 'phone numbers, emails, chat links and off-platform requests are refused with the contact_info hint' || E'\n';
  select count(*) into n from public.message_threads where context_id::text = bk1::text;
  select count(*) into u0 from public.coordinator_message_authors where booking_id = bk1;
  v_out := v_out || case when n = 0 and u0 = 0 then 'PASS: ' else 'FAIL: ' end || 'no refusal created a thread, a message or an authorship row' || E'\n';

  -- 4. a real send
  t := pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, %L)', bk1, r1, '  Hello, I will confirm the plumber for Friday 9:00 to 11:30, labour ₦15,000.  '));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end; v_id := j ->> 'message_id'; th1 := (j ->> 'thread_id')::uuid;
  v_out := v_out || case when v_id is not null and th1 is not null and not (j ->> 'duplicate')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the current coordinator sends a message (amounts and times with commas and colons are fine)' || E'\n';
  select count(*) into n from public.message_threads where context_id::text = bk1::text;
  v_out := v_out || case when n = 1 and exists (select 1 from public.message_threads where id = th1 and customer_id = cust and tasker_id = tk and context_type = 'booking') then 'PASS: ' else 'FAIL(' || n || '): ' end
        || 'the thread is the single booking thread (customer + placeholder Local Tasker): no second chat' || E'\n';
  select count(*) into n from public.messages where thread_id = th1 and id::text = v_id and sender_id = tk and receiver_id = cust and type = 'text' and flagged = false
         and body = 'Hello, I will confirm the plumber for Friday 9:00 to 11:30, labour ₦15,000.';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'stored as the Local Tasker''s identity to the customer, plain text, trimmed' || E'\n';
  -- the real project may post its own lines or cards into a thread when it opens; count them so the checks below do not depend on that
  select count(*) - 1 into base from public.messages where thread_id = th1;
  select count(*) into n from public.coordinator_message_authors where message_id = v_id and coordinator_id = cA and booking_id = bk1 and request_id = r1;
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'the author (coordinator A) is recorded for that message' || E'\n';
  select last_message, customer_unread into lm, cu from public.message_threads where id = th1;
  cu1 := cu;
  v_out := v_out || case when lm like 'Hello, I will confirm the plumber%' and cu >= 1 and cu <= 1 + base + 1 then 'PASS: ' else 'FAIL(' || coalesce(lm, '-') || ',' || cu || '): ' end || 'the thread preview and the customer''s unread count were updated' || E'\n';
  select count(*) into n from public.local_booking_events where booking_id = bk1 and kind = 'thread_opened';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'the thread creation was logged once (by the 6A function)' || E'\n';
  t := pg_temp.st_try(cust, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = (base + 1)::text then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer reads the message through their normal access' || E'\n';
  -- retry safety
  t := pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, %L)', bk1, r1, 'a different text on a retry'));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  select count(*) into n from public.messages where thread_id = th1; select customer_unread into cu from public.message_threads where id = th1;
  v_out := v_out || case when (j ->> 'duplicate')::boolean and j ->> 'message_id' = v_id and n = base + 1 and cu = cu1 then 'PASS: ' else 'FAIL(' || t || ',' || n || ',' || cu || '): ' end
        || 'the same request id again gives the same message back (duplicate), nothing sent twice, unread not raised again' || E'\n';
  t := pg_temp.st_try(cB, format('select public.coordinator_send_message(%L, %L, ''x'')', bk1, r1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot reuse the request id' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, ''Second message, the pipe is ready for Friday'')', bk1, r2));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end; v_id2 := j ->> 'message_id';
  v_out := v_out || case when v_id2 is not null and v_id2 <> v_id and (j ->> 'thread_id')::uuid = th1 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a second message with a new request id goes into the same thread' || E'\n';

  -- 5. unread is per coordinator and clears when read
  insert into public.messages (thread_id, sender_id, receiver_id, body, type, created_at) values (th1, cust, tk, 'Thanks. Will he bring sealant?', 'text', clock_timestamp());
  insert into public.messages (thread_id, sender_id, receiver_id, body, type, created_at) values (th1, cust, tk, 'Also the gate code changed', 'text', clock_timestamp());
  t := pg_temp.st_try(cA, 'select public.coordinator_chat_list(50)'); j := t::jsonb;
  v_out := v_out || case when (j -> 0 ->> 'unread')::int = 2 and j -> 0 ->> 'thread_id' = th1::text and j -> 0 ->> 'last_message' is not null then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'two customer messages after the coordinator last spoke show as 2 unread, with the thread preview' || E'\n';
  t := pg_temp.st_try(cust, format('select public.coordinator_chat_mark_read(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a customer cannot mark a coordinator thread read' || E'\n';
  t := pg_temp.st_try(cB, format('select public.coordinator_chat_mark_read(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another coordinator cannot mark it read' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_mark_read(%L)', bk1));
  v_out := v_out || case when (t::jsonb ->> 'marked')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator marks it read' || E'\n';
  t := pg_temp.st_try(cA, 'select public.coordinator_chat_list(50)');
  v_out := v_out || case when (t::jsonb -> 0 ->> 'unread')::int = 0 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'unread is 0 after reading' || E'\n';
  insert into public.messages (thread_id, sender_id, receiver_id, body, type, created_at) values (th1, cust, tk, 'One more thing', 'text', clock_timestamp());
  t := pg_temp.st_try(cA, 'select public.coordinator_chat_list(50)');
  v_out := v_out || case when (t::jsonb -> 0 ->> 'unread')::int = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a new customer message shows as 1 unread again' || E'\n';
  -- what the coordinator sees in the thread
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when jsonb_array_length(j -> 'messages') = 5 + base and (j ->> 'total_messages')::int = 5 + base
        and (select count(*) from jsonb_array_elements(j -> 'messages') e where e ->> 'kind' = 'coordinator' and e ->> 'author_name' = 'ST6B Coordinator A' and (e ->> 'author_is_me')::boolean) = 2
        and (select count(*) from jsonb_array_elements(j -> 'messages') e where e ->> 'kind' = 'customer') = 3 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the thread shows every message (2 coordinator, 3 customer, plus any line the project posted itself): coordinator messages with the author''s name, customer messages as customer' || E'\n';
  v_out := v_out || case when t not like '%' || cust::text || '%' and t not like '%' || tk::text || '%' and t not like '%' || cA::text || '%' then 'PASS: ' else 'FAIL: ' end
        || 'the thread answer contains no user ids' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L, 2)', bk1)); j := t::jsonb;
  v_out := v_out || case when jsonb_array_length(j -> 'messages') = 2 and (j ->> 'total_messages')::int = 5 + base and j -> 'messages' -> 1 ->> 'body' = 'One more thing' then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the limit returns the NEWEST messages, oldest of them first, and says how many there are in total' || E'\n';
  -- a Job Room system line and a payment card posted on the Local Tasker side come back as local_tasker
  insert into public.messages (thread_id, sender_id, receiver_id, body, type, created_at) values (th1, tk, cust, 'Payment secured', 'system', clock_timestamp());
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when (select count(*) from jsonb_array_elements(j -> 'messages') e where e ->> 'kind' = 'local_tasker' and e ->> 'type' = 'system') = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'system lines in the thread are labelled local_tasker, not as a coordinator message' || E'\n';
  delete from public.messages where body = 'Payment secured' and thread_id = th1;

  -- 6. internal notes
  t := pg_temp.st_try(cA, format('select public.coordinator_add_note(%L, %L, %L)', bk1, n1, '   '));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an empty note is refused' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_add_note(%L, %L, %L)', bk1, n1, repeat('n', 2001)));
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a note over 2000 characters is refused' || E'\n';
  foreach t in array array[cB::text, cust::text, cust2::text, tk::text] loop
    v_out := v_out || case when pg_temp.st_try(t::uuid, format('select public.coordinator_add_note(%L, %L, %L)', bk1, gen_random_uuid(), mk)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end
          || 'only the booking''s coordinator can write a note (' || left(t, 4) || ' refused)' || E'\n';
  end loop;
  select count(*) into n from public.coordinator_internal_notes where booking_id = bk1;
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'no refused attempt left a note' || E'\n';
  select last_message, customer_unread into lm, cu from public.message_threads where id = th1; c0 := (select count(*) from public.messages where thread_id = th1); a0 := (select count(*) from public.local_tasker_audit_log where action = 'internal_note_added');
  t := pg_temp.st_try(cA, format('select public.coordinator_add_note(%L, %L, %L)', bk1, n1, mk));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'note_id' is not null and not (j ->> 'duplicate')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the coordinator writes an internal note (phone numbers ARE allowed in a note: it is not visible to the customer)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_add_note(%L, %L, %L)', bk1, n1, 'another text'));
  v_out := v_out || case when (t::jsonb ->> 'duplicate')::boolean and (select count(*) from public.coordinator_internal_notes where booking_id = bk1) = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the same request id again does not write a second note' || E'\n';
  v_out := v_out || case when (select count(*) from public.messages where thread_id = th1) = c0
        and (select last_message from public.message_threads where id = th1) is not distinct from lm
        and (select customer_unread from public.message_threads where id = th1) = cu
        and not exists (select 1 from public.messages where body like '%ST6B-SECRET%')
        and not exists (select 1 from public.message_threads where last_message like '%ST6B-SECRET%') then 'PASS: ' else 'FAIL: ' end
        || 'a note never enters messages, never changes the thread preview, never raises the customer''s unread count' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where action = 'internal_note_added' and entity_id = bk1::text and actor_id = cA and after_data::text not like '%ST6B-SECRET%' and (after_data ->> 'length')::int = char_length(mk);
  v_out := v_out || case when n = 1 and (select count(*) from public.local_tasker_audit_log where action = 'internal_note_added') = a0 + 1 then 'PASS: ' else 'FAIL(' || n || '): ' end
        || 'exactly one audit row was written, with the length and NOT the text' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when jsonb_array_length(j -> 'notes') = 1 and j -> 'notes' -> 0 ->> 'body' = mk and j -> 'notes' -> 0 ->> 'author_name' = 'ST6B Coordinator A' and (j -> 'notes' -> 0 ->> 'author_is_me')::boolean
        and not exists (select 1 from jsonb_array_elements(j -> 'messages') e where e ->> 'body' like '%ST6B-SECRET%') then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the coordinator sees the note in the notes list, with their name, and never inside the messages list' || E'\n';

  -- 6b. ACCEPTANCE: nobody but the coordinators of the booking can read a note, by any query
  t := pg_temp.st_try(cust, 'select to_jsonb(count(*)) from public.coordinator_internal_notes');
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'THE CUSTOMER''S QUERY AGAINST THE NOTES TABLE RETURNS NOTHING (acceptance criterion)' || E'\n';
  t := pg_temp.st_try(cust, format('select to_jsonb(count(*)) from public.coordinator_internal_notes where booking_id = %L or body like ''%%SECRET%%''', bk1));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot find a note by booking id or by its words either' || E'\n';
  t := pg_temp.st_try(cust, 'select to_jsonb(count(*)) from (select * from public.coordinator_internal_notes) q');
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nor through a sub-select' || E'\n';
  t := pg_temp.st_try(cust, 'select to_jsonb(count(*)) from public.coordinator_message_authors');
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer reads no authorship rows' || E'\n';
  t := pg_temp.st_try(cust, 'select to_jsonb(count(*)) from public.coordinator_thread_reads');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the read-mark table is closed to the browser' || E'\n';
  foreach t in array array[cust2::text, tk::text, cB::text, cX::text] loop
    v_out := v_out || case when pg_temp.st_try(t::uuid, 'select to_jsonb(count(*)) from public.coordinator_internal_notes') = '0' then 'PASS: ' else 'FAIL: ' end
          || 'notes table: nothing for ' || left(t, 4) || ' (another customer / the placeholder / a coordinator of another booking)' || E'\n';
  end loop;
  t := pg_temp.st_try(null, 'select to_jsonb(count(*)) from public.coordinator_internal_notes');
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in session with no user reads nothing' || E'\n';
  perform set_config('st.test_admin', '1', true);
  t := pg_temp.st_try(adm, 'select to_jsonb(count(*)) from public.coordinator_internal_notes', true);
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an administrator has NO direct table access to notes (only the audited function)' || E'\n';
  perform set_config('st.test_admin', '', true);
  t := pg_temp.st_try(cust, format('select to_jsonb(count(*)) from public.messages where body like ''%%SECRET%%'' or thread_id = %L and body like ''%%Emeka%%''', th1));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer finds no note text in messages' || E'\n';
  t := pg_temp.st_try(cust, 'select to_jsonb(count(*)) from public.message_threads where last_message like ''%SECRET%''');
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nor in the thread preview' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_thread_labels(array[%L]::uuid[])', th1));
  v_out := v_out || case when t not like '%SECRET%' and t not like '%Emeka%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer-side label function does not carry a note' || E'\n';
  t := pg_temp.st_try(cust, 'select public.coordinator_chat_list(50)');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot use the coordinator inbox function' || E'\n';
  t := pg_temp.st_try(cust, format('select public.coordinator_chat_thread(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot use the coordinator conversation function' || E'\n';
  -- writes from the browser
  t := pg_temp.st_try(cust, format('with i as (insert into public.coordinator_internal_notes (booking_id, author_id, request_id, body) values (%L, %L, gen_random_uuid(), ''x'') returning 1) select to_jsonb(count(*)) from i', bk1, cust));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer cannot insert a note' || E'\n';
  t := pg_temp.st_try(cA, format('with i as (insert into public.coordinator_internal_notes (booking_id, author_id, request_id, body) values (%L, %L, gen_random_uuid(), ''x'') returning 1) select to_jsonb(count(*)) from i', bk1, cA));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'not even the coordinator can insert a note directly (only through the function)' || E'\n';
  t := pg_temp.st_try(cA, format('with u as (update public.coordinator_internal_notes set body = ''edited'' where booking_id = %L returning 1) select to_jsonb(count(*)) from u', bk1));
  v_out := v_out || case when t like 'ERR:%' or t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator cannot edit a note' || E'\n';
  t := pg_temp.st_try(cA, format('with d as (delete from public.coordinator_internal_notes where booking_id = %L returning 1) select to_jsonb(count(*)) from d', bk1));
  v_out := v_out || case when t like 'ERR:%' or t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator cannot delete a note' || E'\n';
  t := pg_temp.st_try(cA, format('with i as (insert into public.messages (thread_id, sender_id, receiver_id, body, type) values (%L, %L, %L, ''direct'', ''text'') returning 1) select to_jsonb(count(*)) from i', th1, tk, cust));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a coordinator still cannot write to messages directly (6A rule kept)' || E'\n';
  begin update public.coordinator_internal_notes set body = 'x' where booking_id = bk1; v_out := v_out || 'FAIL: a note could be edited by the owner role' || E'\n';
  exception when others then v_out := v_out || case when sqlerrm like '%cannot be edited%' then 'PASS: ' else 'FAIL(' || sqlerrm || '): ' end || 'a note cannot be edited, even by a database owner (immutable trigger)' || E'\n'; end;
  begin delete from public.coordinator_internal_notes where booking_id = bk1; v_out := v_out || 'FAIL: a note could be deleted by the owner role' || E'\n';
  exception when others then v_out := v_out || case when sqlerrm like '%cannot be deleted%' then 'PASS: ' else 'FAIL(' || sqlerrm || '): ' end || 'a note cannot be deleted' || E'\n'; end;
  begin update public.coordinator_message_authors set coordinator_id = cB where message_id = v_id; v_out := v_out || 'FAIL: authorship could be edited' || E'\n';
  exception when others then v_out := v_out || case when sqlerrm like '%cannot be edited%' then 'PASS: ' else 'FAIL(' || sqlerrm || '): ' end || 'message authorship cannot be edited' || E'\n'; end;

  -- 7. reassignment A -> B (A keeps read-only history, B gets everything, nobody loses anything)
  update public.local_booking_state set coordinator_id = cB where booking_id = bk1;
  perform public._local_booking_log(bk1, 'reassigned', null, null, cB, cA, adm, 'admin', null);
  t := pg_temp.st_try(cB, format('select public.coordinator_chat_thread(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'access' = 'coordinator' and not (j ->> 'read_only')::boolean and jsonb_array_length(j -> 'messages') = 5 + base and jsonb_array_length(j -> 'notes') = 1
        and not exists (select 1 from jsonb_array_elements(j -> 'messages') e where (e ->> 'author_is_me')::boolean) and exists (select 1 from jsonb_array_elements(j -> 'messages') e where e ->> 'author_name' = 'ST6B Coordinator A') then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the NEW coordinator reads the whole history and the earlier notes, and sees who wrote the earlier messages' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1)); j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'access' = 'former_coordinator' and (j ->> 'read_only')::boolean and jsonb_array_length(j -> 'messages') = 5 + base and jsonb_array_length(j -> 'notes') = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the OLD coordinator still reads the history, marked read only (acceptance criterion)' || E'\n';
  t := pg_temp.st_try(cA, 'select public.coordinator_chat_list(50)'); j := t::jsonb;
  v_out := v_out || case when j -> 0 ->> 'access' = 'former_coordinator' and (j -> 0 ->> 'unread')::int = 0 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the old coordinator''s inbox lists it as former (read only), never as unread' || E'\n';
  t := pg_temp.st_try(cB, 'select public.coordinator_chat_list(50)'); j := t::jsonb;
  v_out := v_out || case when j -> 0 ->> 'access' = 'coordinator' and (j -> 0 ->> 'unread')::int = 3 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the new coordinator''s inbox lists it as theirs, unread counted from their own read marks (3 customer messages)' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, ''still me'')', bk1, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:read_only' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the old coordinator cannot send' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_add_note(%L, %L, ''still me'')', bk1, gen_random_uuid()));
  v_out := v_out || case when t = 'ERR:read_only' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the old coordinator cannot write a note' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_mark_read(%L)', bk1));
  v_out := v_out || case when not (t::jsonb ->> 'marked')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the old coordinator marks nothing' || E'\n';
  t := pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.coordinator_internal_notes where booking_id = %L', bk1));
  v_out := v_out || case when t = '1' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the old coordinator reads the notes table for that booking (read only)' || E'\n';
  t := pg_temp.st_try(cB, format('select to_jsonb(count(*)) from public.coordinator_internal_notes where booking_id = %L', bk1));
  v_out := v_out || case when t = '1' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the new coordinator reads the notes table for that booking' || E'\n';
  t := pg_temp.st_try(cB, format('select public.coordinator_send_message(%L, %L, ''Hello, I am your new coordinator now'')', bk1, r3));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when j ->> 'message_id' is not null and (j ->> 'thread_id')::uuid = th1 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the new coordinator sends into the same thread' || E'\n';
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when (select count(*) from jsonb_array_elements(j -> 'messages') e where e ->> 'author_name' = 'ST6B Coordinator B' and not (e ->> 'author_is_me')::boolean) = 1
        and (select count(*) from jsonb_array_elements(j -> 'messages') e where e ->> 'author_name' = 'ST6B Coordinator A' and (e ->> 'author_is_me')::boolean) = 2 then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'each message keeps the name of the coordinator who wrote it, across the reassignment' || E'\n';
  t := pg_temp.st_try(cB, format('select public.coordinator_add_note(%L, %L, ''Handover: customer prefers mornings'')', bk1, n2));
  v_out := v_out || case when t like '{%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the new coordinator writes a note' || E'\n';
  t := pg_temp.st_try(cX, format('select public.coordinator_chat_thread(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a third coordinator still sees nothing' || E'\n';
  t := pg_temp.st_try(cX, 'select to_jsonb(count(*)) from public.coordinator_internal_notes');
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a third coordinator reads no notes of this booking' || E'\n';
  -- 6A and 6B access functions agree
  v_out := v_out || case when pg_temp.st_try(cA, format('select to_jsonb(public.local_chat_access(%L))', bk1)) = pg_temp.st_try(cA, format('select to_jsonb(public.local_thread_access(%L))', th1))
        and pg_temp.st_try(cB, format('select to_jsonb(public.local_chat_access(%L))', bk1)) = pg_temp.st_try(cB, format('select to_jsonb(public.local_thread_access(%L))', th1))
        and pg_temp.st_try(cX, format('select to_jsonb(public.local_chat_access(%L))', bk1)) = pg_temp.st_try(cX, format('select to_jsonb(public.local_thread_access(%L))', th1)) then 'PASS: ' else 'FAIL: ' end
        || 'the booking-based access check gives the same answer as the 6A thread-based check for A, B and X' || E'\n';
  -- nobody is the coordinator (needs_reassignment): former ones read, nobody writes
  update public.local_booking_state set coordinator_id = null, lt_status = 'needs_reassignment' where booking_id = bk1;
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_message(%L, %L, ''x'')', bk1, gen_random_uuid())) = 'ERR:read_only'
        and pg_temp.st_try(cB, format('select public.coordinator_add_note(%L, %L, ''x'')', bk1, gen_random_uuid())) = 'ERR:read_only'
        and (pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1))::jsonb ->> 'read_only')::boolean then 'PASS: ' else 'FAIL: ' end
        || 'while the booking waits for a new coordinator, former coordinators read and nobody can write' || E'\n';
  update public.local_booking_state set coordinator_id = cB, lt_status = 'assigned' where booking_id = bk1;

  -- 8. a deactivated coordinator has no access at all
  update public.coordinators set status = 'suspended' where user_id = cA;
  v_out := v_out || case when pg_temp.st_try(cA, 'select public.coordinator_chat_list(50)') = 'ERR:not_found'
        and pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1)) = 'ERR:not_found'
        and pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.coordinator_internal_notes where booking_id = %L', bk1)) = '0' then 'PASS: ' else 'FAIL: ' end
        || 'a deactivated former coordinator reads nothing (inbox, thread, notes)' || E'\n';
  update public.coordinators set status = 'active' where user_id = cA;
  update public.coordinators set status = 'suspended' where user_id = cB;
  v_out := v_out || case when pg_temp.st_try(cB, format('select public.coordinator_send_message(%L, %L, ''x'')', bk1, gen_random_uuid())) = 'ERR:not_found'
        and pg_temp.st_try(cB, format('select public.coordinator_add_note(%L, %L, ''x'')', bk1, gen_random_uuid())) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end
        || 'a deactivated current coordinator can neither send nor write a note' || E'\n';
  update public.coordinators set status = 'active' where user_id = cB;

  -- 9. admin: only through the audited function
  perform set_config('st.test_admin', '1', true); v_adm := public.is_local_tasker_admin(); perform set_config('st.test_admin', '', true);
  v_out := v_out || case when pg_temp.st_try(cB, format('select public.coordinator_chat_admin_read(%L, ''Customer complaint about the booking'', 50)', bk1)) = 'ERR:not_found'
        and pg_temp.st_try(cust, format('select public.coordinator_chat_admin_read(%L, ''Customer complaint about the booking'', 50)', bk1)) = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end
        || 'a coordinator (even the current one) and a customer cannot use the admin read' || E'\n';
  if v_adm then
    a0 := (select count(*) from public.local_tasker_audit_log where action = 'chat_admin_read');
    t := pg_temp.st_try(adm, format('select public.coordinator_chat_admin_read(%L, ''short'', 50)', bk1), true);
    v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a reason under 10 characters is refused' || E'\n';
    t := pg_temp.st_try(adm, format('select public.coordinator_chat_admin_read(%L, ''Customer complaint about the booking'', 50)', bkR), true);
    v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular booking is not readable through this function' || E'\n';
    v_out := v_out || case when (select count(*) from public.local_tasker_audit_log where action = 'chat_admin_read') = a0 then 'PASS: ' else 'FAIL: ' end || 'refused calls wrote no audit row' || E'\n';
    t := pg_temp.st_try(adm, format('select public.coordinator_chat_admin_read(%L, ''Customer complaint about the booking'', 3)', bk1), true);
    j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    select count(*) into n from public.local_tasker_audit_log where action = 'chat_admin_read' and actor_id = adm and entity_id = bk1::text and after_data ->> 'reason' = 'Customer complaint about the booking';
    v_out := v_out || case when jsonb_array_length(j -> 'messages') = 3 and jsonb_array_length(j -> 'notes') = 2 and (j ->> 'total_messages')::int = 6 + base and n = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'the admin read returns only the limit asked for, the notes, and writes exactly one audit row with the reason' || E'\n';
    t := pg_temp.st_try(adm, format('select public.coordinator_chat_admin_read(%L, ''Customer complaint about the booking'', 50)', bk1), true);
    j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    v_out := v_out || case when (select count(*) from jsonb_array_elements(j -> 'messages') e where e ->> 'kind' = 'coordinator' and e ->> 'author_name' in ('ST6B Coordinator A', 'ST6B Coordinator B')) = 3
          and (select count(*) from jsonb_array_elements(j -> 'messages') e where e ->> 'kind' = 'customer') = 3 then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'the admin sees which coordinator wrote each message' || E'\n';
  else
    v_out := v_out || 'SKIP: administrator function not testable here (no administrator login in this project); the six admin-success checks did not run' || E'\n';
  end if;

  -- 10. cascade, regular threads and money untouched
  insert into public.coordinator_internal_notes (booking_id, author_id, request_id, body) values (bkT, cA, gen_random_uuid(), 'throwaway');
  insert into public.coordinator_message_authors (message_id, booking_id, coordinator_id, request_id) values ('throwaway', bkT, cA, gen_random_uuid());
  delete from public.bookings where id = bkT;
  v_out := v_out || case when not exists (select 1 from public.coordinator_internal_notes where booking_id = bkT) and not exists (select 1 from public.coordinator_message_authors where booking_id = bkT) then 'PASS: ' else 'FAIL: ' end
        || 'removing a booking removes its notes and authorship with it (the only way history goes)' || E'\n';
  v_out := v_out || case when (select count(*) from public.messages where thread_id = thR) = rbase and (select count(*) from public.message_threads where context_id::text = bkR::text) = 1
        and not exists (select 1 from public.coordinator_message_authors where booking_id = bkR) then 'PASS: ' else 'FAIL: ' end || 'the regular booking thread is untouched' || E'\n';
  v_out := v_out || case when (select md5(row(b.status, b.payment_status, b.amount, b.work_stage)::text) from public.bookings b where b.id = bk1) = v_bk1_md5 then 'PASS: ' else 'FAIL: ' end
        || 'booking status, payment status and amount unchanged by any of this' || E'\n';

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 6B TESTS\n%', v_out;
end $$;

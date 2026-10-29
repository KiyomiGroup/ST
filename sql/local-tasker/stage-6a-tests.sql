-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6A tests (the booking-specific coordinator thread)
-- Requires everything up to stage-5d1-core.sql and stage-6a-core.sql.
-- Select the WHOLE file and press Run in the Supabase SQL editor. It creates throwaway rows and ROLLS THEM BACK by raising an error
-- on purpose: an error box that starts "STAGE 6A TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- A line that starts "SKIP:" means a check could not run in this project (the administrator check needs a real administrator login there);
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
  v_out text := ''; j jsonb; t text; n int; v_adm boolean; v_nouser int;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cS uuid := gen_random_uuid(); cX uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid(); tk uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  bk1 uuid; bk2 uuid; bk3 uuid; bkR uuid; th1 uuid; th2 uuid; thR uuid; m1 uuid; a0 int;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st6a-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cS, cX, cust, cust2, tk, adm]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST6A Coordinator A', 'active'), (cB, 'ST6A Coordinator B', 'active'),
         (cS, 'ST6A Suspended', 'active'), (cX, 'ST6A Other', 'active');
  insert into public.users (id, name, role, profile_details) values (cust, 'ST6A customer', 'customer', '{}'), (cust2, 'ST6A customer 2', 'customer', '{}'),
         (tk, 'ST6A Local Tasker', 'tasker', '{}'), (cA, 'ST6A A', 'customer', '{}'), (cB, 'ST6A B', 'customer', '{}'), (cS, 'ST6A S', 'customer', '{}'), (cX, 'ST6A X', 'customer', '{}')
         on conflict (id) do nothing;
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk1;   -- Local Tasker, coordinator A
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust2, tk, 'confirmed', 'unpaid') returning id into bk2;  -- Local Tasker, coordinator X
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk3;   -- Local Tasker, coordinator S (suspended later)
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bkR;   -- a REGULAR booking (no Local Tasker row)
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values
    (bk1, tk, cA, cA, 'assigned'), (bk2, tk, cX, cX, 'assigned'), (bk3, tk, cS, cS, 'assigned');
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bkR, now()) returning id into thR;
  insert into public.messages (thread_id, sender_id, receiver_id, body, type) values (thR, cust, tk, 'regular booking message', 'text');
  select count(*) into a0 from public.local_tasker_audit_log;

  -- 1. privileges
  v_out := v_out || case when has_function_privilege('authenticated', 'public.open_local_thread(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.local_thread_labels(uuid[])', 'execute')
        and has_function_privilege('authenticated', 'public.local_thread_admin_read(uuid,text,integer)', 'execute')
        and has_function_privilege('authenticated', 'public.local_thread_access(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.open_local_thread(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.local_thread_labels(uuid[])', 'execute')
        and not has_function_privilege('anon', 'public.local_thread_admin_read(uuid,text,integer)', 'execute')
        and not has_function_privilege('anon', 'public.local_thread_access(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public._local_thread_booking(uuid)', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'the four functions are callable by signed-in users only; the internal helper is not callable' || E'\n';
  v_out := v_out || case when (select count(*) from pg_policies where policyname in ('lt_thread_coord_select', 'lt_msg_coord_select') and cmd = 'SELECT') = 2
        and not exists (select 1 from pg_policies where policyname in ('lt_thread_coord_select', 'lt_msg_coord_select') and cmd <> 'SELECT') then 'PASS: ' else 'FAIL: ' end
        || 'exactly two policies were added, both SELECT only (no insert, update or delete for coordinators)' || E'\n';

  -- 2. who can open the thread
  t := pg_temp.st_try(cB, format('select public.open_local_thread(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a coordinator who does not manage the booking cannot open it (not found)' || E'\n';
  t := pg_temp.st_try(cust2, format('select public.open_local_thread(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another customer cannot open it (not found)' || E'\n';
  t := pg_temp.st_try(tk, format('select public.open_local_thread(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the placeholder Local Tasker identity cannot open it' || E'\n';
  t := pg_temp.st_try(null, format('select public.open_local_thread(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nobody signed in: not found' || E'\n';
  t := pg_temp.st_try(cust, format('select public.open_local_thread(%L)', bkR));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular (non Local Tasker) booking is not opened by this function' || E'\n';
  t := pg_temp.st_try(cA, format('select public.open_local_thread(%L)', bk1));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end; th1 := (j ->> 'thread_id')::uuid;
  v_out := v_out || case when th1 is not null and j ->> 'role' = 'coordinator' and (j ->> 'created')::boolean and not (j ->> 'read_only')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the current coordinator opens (creates) the thread' || E'\n';
  t := pg_temp.st_try(cust, format('select public.open_local_thread(%L)', bk1));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when (j ->> 'thread_id')::uuid = th1 and j ->> 'role' = 'customer' and not (j ->> 'created')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the customer gets the SAME thread (no second chat), not created again' || E'\n';
  select count(*) into n from public.message_threads where context_id::text = bk1::text;
  v_out := v_out || case when n = 1 and exists (select 1 from public.message_threads where id = th1 and customer_id = cust and tasker_id = tk) then 'PASS: ' else 'FAIL: ' end
        || 'one thread only, parties are the customer and the placeholder Local Tasker' || E'\n';
  select count(*) into n from public.local_booking_events where booking_id = bk1 and kind = 'thread_opened';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'one thread_opened event, not repeated on the second open' || E'\n';
  insert into public.messages (thread_id, sender_id, receiver_id, body, type) values (th1, cust, tk, 'hello coordinator', 'text') returning id into m1;
  insert into public.messages (thread_id, sender_id, receiver_id, body, type) values (th1, cust, tk, 'second message', 'text');
  -- thread of the other coordinator
  t := pg_temp.st_try(cX, format('select public.open_local_thread(%L)', bk2));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end; th2 := (j ->> 'thread_id')::uuid;
  insert into public.messages (thread_id, sender_id, receiver_id, body, type) values (th2, cust2, tk, 'private to X', 'text');

  -- 3. what each person can READ (the real policies decide; messages_guard etc. are not involved in reads)
  t := pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '2' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'coordinator A reads both messages of their booking' || E'\n';
  t := pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.message_threads where id = %L', th1));
  v_out := v_out || case when t = '1' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'coordinator A sees the thread row' || E'\n';
  t := pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.messages where thread_id in (%L, %L)', th2, thR));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'coordinator A cannot read another coordinator''s thread or a regular booking thread' || E'\n';
  t := pg_temp.st_try(cB, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'COORDINATOR B CANNOT READ the thread of coordinator A (acceptance criterion)' || E'\n';
  t := pg_temp.st_try(cB, format('select to_jsonb(count(*)) from public.message_threads where id = %L', th1));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'coordinator B cannot see the thread row either' || E'\n';
  t := pg_temp.st_try(cust, format('select to_jsonb(count(*)) from public.messages where thread_id in (%L, %L)', th1, thR));
  v_out := v_out || case when t = '3' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the customer still reads their own threads (existing policy, regular thread unchanged)' || E'\n';
  t := pg_temp.st_try(cust2, format('select to_jsonb(count(*)) from public.messages where thread_id in (%L, %L)', th1, thR));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another customer reads nothing of them' || E'\n';
  t := pg_temp.st_try(null, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '0' or t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'nobody signed in reads nothing' || E'\n';

  -- 4. a coordinator cannot write or delete from the browser in this stage
  t := pg_temp.st_try(cA, format('with i as (insert into public.messages (thread_id, sender_id, receiver_id, body, type) values (%L, %L, %L, ''from coordinator'', ''text'') returning 1) select to_jsonb(count(*)) from i', th1, cA, cust));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator cannot insert a message directly (that is Stage 6B, through a function)' || E'\n';
  t := pg_temp.st_try(cA, format('with d as (delete from public.messages where thread_id = %L returning 1) select to_jsonb(count(*)) from d', th1));
  v_out := v_out || case when t in ('0') or t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator cannot delete messages' || E'\n';
  t := pg_temp.st_try(cA, format('with u as (update public.messages set body = ''edited'' where thread_id = %L returning 1) select to_jsonb(count(*)) from u', th1));
  v_out := v_out || case when t in ('0') or t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the coordinator cannot edit messages' || E'\n';
  select count(*) into n from public.messages where thread_id = th1;
  v_out := v_out || case when n = 2 and not exists (select 1 from public.messages where body in ('edited', 'from coordinator')) then 'PASS: ' else 'FAIL(' || n || '): ' end || 'history is intact' || E'\n';

  -- 5. reassignment A -> B: B gains access to the whole history, A keeps READ-ONLY history
  update public.local_booking_state set coordinator_id = cB where booking_id = bk1;
  perform public._local_booking_log(bk1, 'reassigned', null, null, cB, cA, adm, 'admin', null);
  t := pg_temp.st_try(cB, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '2' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after reassignment the NEW coordinator reads the whole history' || E'\n';
  t := pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '2' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'after reassignment the OLD coordinator still reads the history (acceptance criterion)' || E'\n';
  t := pg_temp.st_try(cA, format('select to_jsonb(public.local_thread_access(%L))', th1));
  v_out := v_out || case when t = '"former_coordinator"' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the old coordinator is a former coordinator (read only)' || E'\n';
  t := pg_temp.st_try(cB, format('select to_jsonb(public.local_thread_access(%L))', th1));
  v_out := v_out || case when t = '"coordinator"' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the new coordinator is the coordinator' || E'\n';
  t := pg_temp.st_try(cA, format('select public.open_local_thread(%L)', bk1));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when (j ->> 'thread_id')::uuid = th1 and (j ->> 'read_only')::boolean and j ->> 'role' = 'former_coordinator' and not (j ->> 'created')::boolean then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the old coordinator gets the existing thread marked read only' || E'\n';
  t := pg_temp.st_try(cX, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a third coordinator still sees nothing' || E'\n';
  -- no coordinator at all (needs_reassignment): nobody is current, former ones read, no one creates
  update public.local_booking_state set coordinator_id = null, lt_status = 'needs_reassignment' where booking_id = bk1;
  t := pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '2' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'while the booking waits for a new coordinator, former coordinators still read the history' || E'\n';
  update public.local_booking_state set coordinator_id = cB, lt_status = 'assigned' where booking_id = bk1;
  -- the customer's contact label follows the reassignment
  t := pg_temp.st_try(cust, format('select public.local_thread_labels(array[%L, %L]::uuid[])', th1, thR));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when jsonb_array_length(j) = 1 and j -> 0 ->> 'coordinator_name' = 'ST6A Coordinator B' and (j -> 0 ->> 'coordinator_assigned')::boolean
        and not (j -> 0 ? 'coordinator_id') and t not like '%' || cB::text || '%' then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'the customer sees the NEW coordinator as the contact for the Local Tasker thread only (regular thread absent, no ids returned)' || E'\n';
  update public.local_booking_state set coordinator_id = null, lt_status = 'needs_reassignment' where booking_id = bk1;
  t := pg_temp.st_try(cust, format('select public.local_thread_labels(array[%L]::uuid[])', th1));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when jsonb_array_length(j) = 1 and not (j -> 0 ->> 'coordinator_assigned')::boolean and (j -> 0 -> 'coordinator_name') = 'null'::jsonb then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'while no coordinator is assigned the label has no name (the page says "StreetTasker coordinator")' || E'\n';
  update public.local_booking_state set coordinator_id = cB, lt_status = 'assigned' where booking_id = bk1;
  t := pg_temp.st_try(cust2, format('select public.local_thread_labels(array[%L]::uuid[])', th1));
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another customer gets nothing for this thread' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_thread_labels(array[%L]::uuid[])', th1));
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a coordinator gets no labels (customer side only)' || E'\n';

  -- 6. a deactivated coordinator has no access, current or former
  update public.coordinators set status = 'suspended' where user_id = cA;
  t := pg_temp.st_try(cA, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a deactivated former coordinator reads nothing' || E'\n';
  update public.coordinators set status = 'active' where user_id = cA;
  update public.coordinators set status = 'suspended' where user_id = cB;
  t := pg_temp.st_try(cB, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1));
  v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a deactivated current coordinator reads nothing' || E'\n';
  t := pg_temp.st_try(cB, format('select public.open_local_thread(%L)', bk1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a deactivated coordinator cannot open the thread' || E'\n';
  update public.coordinators set status = 'active' where user_id = cB;

  -- 7. admin: only through the audited function
  perform set_config('st.test_admin', '1', true); v_adm := public.is_local_tasker_admin(); perform set_config('st.test_admin', '', true);
  t := pg_temp.st_try(cA, format('select public.local_thread_admin_read(%L, ''Customer complaint about the booking'', 50)', th1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a coordinator (even the current one) cannot use the admin read' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_thread_admin_read(%L, ''Customer complaint about the booking'', 50)', th1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a customer cannot use the admin read' || E'\n';
  if v_adm then
    select count(*) into a0 from public.local_tasker_audit_log where action = 'thread_admin_read';
    t := pg_temp.st_try(adm, format('select public.local_thread_admin_read(%L, ''short'', 50)', th1), true);
    v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a reason under 10 characters is refused' || E'\n';
    t := pg_temp.st_try(adm, format('select public.local_thread_admin_read(%L, ''Customer complaint about the booking'', 50)', thR), true);
    v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a regular booking thread is not readable through this function' || E'\n';
    select count(*) into n from public.local_tasker_audit_log where action = 'thread_admin_read';
    v_out := v_out || case when n = a0 then 'PASS: ' else 'FAIL: ' end || 'refused calls wrote no audit row' || E'\n';
    t := pg_temp.st_try(adm, format('select public.local_thread_admin_read(%L, ''Customer complaint about the booking'', 1)', th1), true);
    j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
    select count(*) into n from public.local_tasker_audit_log where action = 'thread_admin_read' and actor_id = adm and entity_id = th1::text
       and after_data ->> 'reason' = 'Customer complaint about the booking';
    v_out := v_out || case when jsonb_array_length(j -> 'messages') = 1 and (j ->> 'total')::int = 2 and n = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end
          || 'the admin read returns only the limit asked for and writes exactly one audit row with the reason' || E'\n';
    t := pg_temp.st_try(adm, format('select to_jsonb(count(*)) from public.messages where thread_id = %L', th1), true);
    v_out := v_out || case when t = '0' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the administrator has NO direct table access to the messages (only the audited function)' || E'\n';
  else
    v_out := v_out || 'SKIP: administrator function not testable here (no administrator login in this project); the five admin-success checks did not run' || E'\n';
  end if;

  -- 8. regular threads and money untouched
  select count(*) into n from public.messages where thread_id = thR;
  v_out := v_out || case when n = 1 and (select count(*) from public.message_threads where context_id::text = bkR::text) = 1 then 'PASS: ' else 'FAIL: ' end || 'the regular booking thread is untouched' || E'\n';
  v_out := v_out || case when (select payment_status from public.bookings where id = bk1) = 'unpaid' and (select status from public.bookings where id = bk1) = 'confirmed' then 'PASS: ' else 'FAIL: ' end
        || 'booking status and payment status unchanged' || E'\n';

  -- 9. information for the next stage (not a test)
  select count(*) into v_nouser from public.coordinators c where not exists (select 1 from public.users u where u.id = c.user_id);
  v_out := v_out || 'NOTE: coordinators with no public.users row: ' || v_nouser || ' (messages.sender_id points at public.users; Stage 6B must make sure a coordinator who sends has such a row)' || E'\n';

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 6A TESTS\n%', v_out;
end $$;

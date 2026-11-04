-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6D-3 tests (coordinator chat: attachments and location).
-- Needs stage-6b-core.sql and stage-6d3-core.sql. Select the WHOLE file and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose: an error box that starts "STAGE 6D-3 TESTS"
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
  cust uuid := gen_random_uuid(); tk uuid := gen_random_uuid();
  bk1 uuid; bk2 uuid; th1 uuid; th2 uuid; v_att record; v_msg record; req1 uuid := gen_random_uuid(); req2 uuid := gen_random_uuid();
  p_ok text; p_pdf text; p_bad text; p_other text;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st6d3-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cX, cust, tk]) as u;
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST6D3 A', 'active'), (cB, 'ST6D3 B', 'active'), (cX, 'ST6D3 X', 'active');
  insert into public.users (id, name, role, profile_details) values (cust, 'ST6D3 customer', 'customer', '{}'),
         (tk, 'ST6D3 Local Tasker', 'tasker', '{}'), (cA, 'ST6D3 A', 'customer', '{}'), (cB, 'ST6D3 B', 'customer', '{}'), (cX, 'ST6D3 X', 'customer', '{}')
         on conflict (id) do nothing;
  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, tk, 'confirmed', 'unpaid', 15000) returning id into bk1;
  insert into public.bookings (customer_id, tasker_id, status, payment_status) values (cust, tk, 'confirmed', 'unpaid') returning id into bk2;
  insert into public.local_booking_state (booking_id, tasker_user_id, coordinator_id, original_coordinator_id, lt_status) values (bk1, tk, cA, cA, 'assigned'), (bk2, tk, cX, cX, 'assigned');
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk1, now()) returning id into th1;
  insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at) values (cust, tk, 'booking', bk2, now()) returning id into th2;

  -- files "already uploaded" to the bucket (the real guard reads size and mimetype from here)
  p_ok := th1 || '/ok-photo.jpg'; p_pdf := th1 || '/doc.pdf'; p_bad := th1 || '/bad.pdf'; p_other := th2 || '/other.jpg';
  insert into storage.objects (bucket_id, name, metadata) values
    ('job-evidence', p_ok, '{"size": 120000, "mimetype": "image/jpeg"}'::jsonb),
    ('job-evidence', p_pdf, '{"size": 90000, "mimetype": "application/pdf"}'::jsonb),
    ('job-evidence', p_bad, '{"size": 90000, "mimetype": "application/pdf"}'::jsonb),
    ('job-evidence', p_other, '{"size": 1000, "mimetype": "image/jpeg"}'::jsonb);

  -- 1. privileges
  v_out := v_out || case when has_function_privilege('authenticated', 'public.coordinator_send_attachment(uuid,uuid,text,text,text,text)', 'execute')
        and has_function_privilege('authenticated', 'public.coordinator_send_location(uuid,uuid,numeric,numeric,text)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_send_attachment(uuid,uuid,text,text,text,text)', 'execute')
        and not has_function_privilege('anon', 'public.coordinator_send_location(uuid,uuid,numeric,numeric,text)', 'execute')
        and not has_function_privilege('authenticated', 'public._lt_6d3_post(uuid,uuid,uuid,text,text,jsonb,text)', 'execute')
        then 'PASS: ' else 'FAIL: ' end || 'signed-in users call the two functions, anonymous may not, the internal helper is closed' || E'\n';

  -- 2. the current coordinator sends a photo
  t := pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, %L)', bk1, req1, 'photo', p_ok, 'ok-photo.jpg', 'the leak'));
  v_out := v_out || case when t not like 'ERR:%' and (t::jsonb->>'duplicate')::boolean = false then 'PASS: ' else 'FAIL: ' end || 'the coordinator sends a photo (' || left(t, 80) || ')' || E'\n';
  select * into v_att from public.job_attachments where thread_id = th1 and storage_path = p_ok;
  v_out := v_out || case when v_att.id is not null and v_att.uploader_id = tk and v_att.kind = 'photo' and v_att.mime = 'image/jpeg' and v_att.size = 120000 and v_att.label = 'the leak'
        then 'PASS: ' else 'FAIL: ' end || 'the attachment row: uploader is the Local Tasker identity, mime and size come from storage, label kept' || E'\n';
  select * into v_msg from public.messages where thread_id = th1 and type = 'image' order by created_at desc limit 1;
  v_out := v_out || case when v_msg.sender_id = tk and v_msg.receiver_id = cust and v_msg.body = 'the leak' and v_msg.payload->>'attachment_id' = v_att.id::text and v_msg.payload->>'path' = p_ok
        then 'PASS: ' else 'FAIL: ' end || 'the message: sent by the Local Tasker identity to the customer, carries attachment_id and path' || E'\n';
  v_out := v_out || case when exists (select 1 from public.coordinator_message_authors a where a.message_id = v_msg.id::text and a.coordinator_id = cA and a.request_id = req1)
        then 'PASS: ' else 'FAIL: ' end || 'the coordinator who sent it is recorded' || E'\n';

  -- 3. the same request id again
  t := pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, %L)', bk1, req1, 'photo', p_ok, 'ok-photo.jpg', 'the leak'));
  select count(*) into n from public.messages where thread_id = th1 and type = 'image';
  v_out := v_out || case when t not like 'ERR:%' and (t::jsonb->>'duplicate')::boolean and n = 1 then 'PASS: ' else 'FAIL: ' end || 'a retried send is answered with the first one, nothing sent twice' || E'\n';

  -- 4. a file (PDF) is a file message
  t := pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, req2, 'file', p_pdf, 'quote.pdf'));
  select count(*) into n from public.messages where thread_id = th1 and type = 'file' and body = 'quote.pdf';
  v_out := v_out || case when t not like 'ERR:%' and n = 1 then 'PASS: ' else 'FAIL: ' end || 'a PDF is sent as a file message named after the file (' || left(t, 60) || ')' || E'\n';

  -- 5. refusals
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'photo', p_bad, 'x.pdf')) = 'ERR:bad_file'
        then 'PASS: ' else 'FAIL: ' end || 'a PDF sent as a photo is refused by the real guard (bad_file)' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'photo', th1 || '/never-uploaded.jpg', 'n.jpg')) = 'ERR:bad_file'
        then 'PASS: ' else 'FAIL: ' end || 'a file that was never uploaded is refused (bad_file)' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'photo', p_other, 'o.jpg')) = 'ERR:bad_input'
        then 'PASS: ' else 'FAIL: ' end || 'a path under another conversation is refused (bad_input)' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, %L)', bk1, gen_random_uuid(), 'file', p_pdf, 'again.pdf', 'call me on 08031234567')) = 'ERR:contact_info'
        then 'PASS: ' else 'FAIL: ' end || 'contact details in a caption are refused (contact_info)' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'bogus', p_pdf, 'z.pdf')) = 'ERR:bad_input'
        then 'PASS: ' else 'FAIL: ' end || 'an unknown kind is refused (bad_input)' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cX, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'file', p_pdf, 'z.pdf')) = 'ERR:not_found'
        and pg_temp.st_try(cust, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'file', p_pdf, 'z.pdf')) = 'ERR:not_found'
        and pg_temp.st_try(tk, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'file', p_pdf, 'z.pdf')) = 'ERR:not_found'
        and pg_temp.st_try(null, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'file', p_pdf, 'z.pdf')) like 'ERR:%'
        then 'PASS: ' else 'FAIL: ' end || 'another coordinator, the customer, the Local Tasker identity and a call with no sign-in are refused' || E'\n';

  -- 6. location
  t := pg_temp.st_try(cA, format('select public.coordinator_send_location(%L, %L, 6.4541, 3.3947, %L)', bk1, gen_random_uuid(), 'Job address'));
  select count(*) into n from public.messages where thread_id = th1 and type = 'location' and (payload->>'lat')::numeric = 6.4541 and payload->>'label' = 'Job address' and sender_id = tk;
  v_out := v_out || case when t not like 'ERR:%' and n = 1 then 'PASS: ' else 'FAIL: ' end || 'a location is sent as a location message' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_location(%L, %L, 123, 3.3, null)', bk1, gen_random_uuid())) = 'ERR:bad_input'
        and pg_temp.st_try(cX, format('select public.coordinator_send_location(%L, %L, 6.4, 3.3, null)', bk1, gen_random_uuid())) = 'ERR:not_found'
        then 'PASS: ' else 'FAIL: ' end || 'a location out of range (bad_input) and another coordinator (not_found) are refused' || E'\n';

  -- 7. the conversation shows the attachments, with only the safe payload keys
  insert into public.messages (thread_id, sender_id, receiver_id, body, type, payload)
    values (th1, cust, tk, 'pin', 'location', '{"lat": 6.5, "lng": 3.4, "secret": "ST6D3-SECRET"}'::jsonb);
  t := pg_temp.st_try(cA, format('select public.coordinator_chat_thread(%L)', bk1)); j := t::jsonb;
  v_out := v_out || case when exists (select 1 from jsonb_array_elements(j->'messages') e where e->>'type' = 'image' and e->'payload'->>'path' = p_ok and e->'payload'->>'attachment_id' = v_att.id::text and e->>'kind' = 'coordinator')
        and exists (select 1 from jsonb_array_elements(j->'messages') e where e->>'type' = 'location' and (e->'payload'->>'lat')::numeric = 6.5)
        then 'PASS: ' else 'FAIL: ' end || 'the conversation returns the payload of images and locations' || E'\n';
  v_out := v_out || case when t !~ 'ST6D3-SECRET' and t !~ tk::text and t !~ cA::text then 'PASS: ' else 'FAIL: ' end || 'no extra payload key and no user id in the conversation' || E'\n';

  -- 8. storage helper
  v_out := v_out || case when pg_temp.st_try(cA, format('select public._lt_coord_thread_ok(%L, true)', th1::text)) = 'true'
        and pg_temp.st_try(cX, format('select public._lt_coord_thread_ok(%L, false)', th1::text)) = 'false'
        and pg_temp.st_try(cust, format('select public._lt_coord_thread_ok(%L, false)', th1::text)) = 'false'
        and pg_temp.st_try(cA, format('select public._lt_coord_thread_ok(%L, true)', th2::text)) = 'false'
        and pg_temp.st_try(cA, 'select public._lt_coord_thread_ok(''not-a-uuid'', true)') = 'false'
        then 'PASS: ' else 'FAIL: ' end || 'storage helper: current coordinator yes, another coordinator / customer / other booking / junk no' || E'\n';
  v_out := v_out || case when exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job_evidence_coord_insert')
        and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job_evidence_coord_select')
        and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job_evidence_insert')
        and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job_evidence_select')
        then 'PASS: ' else 'FAIL: ' end || 'both new storage policies exist and the two original ones are still there' || E'\n';

  -- 9. a former coordinator reads but cannot send
  update public.local_booking_state set coordinator_id = cB where booking_id = bk1;
  v_out := v_out || case when pg_temp.st_try(cA, format('select public.coordinator_send_attachment(%L, %L, %L, %L, %L, null)', bk1, gen_random_uuid(), 'file', p_pdf, 'z.pdf')) = 'ERR:read_only'
        and pg_temp.st_try(cA, format('select public.coordinator_send_location(%L, %L, 6.4, 3.3, null)', bk1, gen_random_uuid())) = 'ERR:read_only'
        then 'PASS: ' else 'FAIL: ' end || 'a former coordinator cannot send (read_only)' || E'\n';
  v_out := v_out || case when pg_temp.st_try(cA, format('select public._lt_coord_thread_ok(%L, true)', th1::text)) = 'false'
        and pg_temp.st_try(cA, format('select public._lt_coord_thread_ok(%L, false)', th1::text)) = 'true'
        and pg_temp.st_try(cB, format('select public._lt_coord_thread_ok(%L, true)', th1::text)) = 'true'
        then 'PASS: ' else 'FAIL: ' end || 'storage helper: former coordinator reads only, the new coordinator writes' || E'\n';

  v_out := v_out || 'RESULT: ' || case when v_out like '%FAIL:%' then 'FAILURES FOUND' else 'ALL PASS' end;
  raise exception E'STAGE 6D-3 TESTS\n%', v_out;
end $$;

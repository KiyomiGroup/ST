-- ============================================================================
-- StreetTasker Local Tasker: STAGE 4C-1 tests (publish, unpublish, public-safe functions)
-- Requires stage-2d-core.sql, stage-4b1-core.sql, stage-4b2-core.sql and stage-4c1-core.sql to have been run.
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 4C-1 TESTS" is the NORMAL result. Copy it only if a FAIL appears.
-- ============================================================================
do $$
declare
  v_out text := ''; v_hint text; v_state text; v_msg text; n int; j jsonb; sid uuid; ph uuid;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  v_path text; v_audit_text text;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st4c1-' || substr(u::text, 1, 8) || '@local-tasker.invalid'
  from unnest(array[cA, cB, cust, t2]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST4C1 customer', 'customer', '{}'), (t2, 'ST4C1 regular tasker', 'tasker', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST4C1 A', 'active'), (cB, 'ST4C1 B', 'active');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi', '+2348011112222', 'Yaba, Sabo', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  execute 'reset role';

  -- 1. privileges
  v_out := v_out || case when not has_function_privilege('anon', 'public.publish_local_tasker(uuid)', 'execute')
                          and not has_function_privilege('anon', 'public.unpublish_local_tasker(uuid,text)', 'execute')
                          and not has_function_privilege('anon', 'public.local_tasker_publish_status(uuid)', 'execute')
                          and has_function_privilege('authenticated', 'public.publish_local_tasker(uuid)', 'execute')
                          and has_function_privilege('authenticated', 'public.unpublish_local_tasker(uuid,text)', 'execute')
                          and has_function_privilege('authenticated', 'public.local_tasker_publish_status(uuid)', 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'only signed-in users can call publish, unpublish and the checklist' || E'\n';
  v_out := v_out || case when not has_function_privilege('authenticated', 'public._local_tasker_readiness(uuid)', 'execute')
                          and not has_function_privilege('anon', 'public._local_tasker_readiness(uuid)', 'execute')
                          and not has_function_privilege('authenticated', 'public._local_tasker_sync_public(uuid)', 'execute')
                          and not has_function_privilege('anon', 'public._local_tasker_sync_public(uuid)', 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'the two internal functions cannot be called from the browser' || E'\n';
  v_out := v_out || case when has_function_privilege('anon', 'public.local_tasker_public_info(text[])', 'execute')
                          and has_function_privilege('anon', 'public.local_tasker_public_photos(uuid)', 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'visitors can call the two customer-safe functions' || E'\n';

  -- 2. no service yet => refused, nothing published
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  v_hint := null; v_msg := null;
  begin execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text; end;
  v_out := v_out || case when v_hint = 'not_ready' and v_msg like '%service%'
                          and exists (select 1 from public.local_tasker_profiles where tasker_user_id = t1 and status = 'draft' and published_at is null)
                          and exists (select 1 from public.taskers where user_id = t1::text and available = false)
                     then 'PASS: ' else 'FAIL: ' end || 'publish with no service is refused (' || coalesce(v_hint, 'no error') || ') and nothing changes' || E'\n';
  execute 'set local role authenticated';
  j := public.local_tasker_publish_status(t1);
  execute 'reset role';
  v_out := v_out || case when not (j->>'ready')::boolean and j->>'status' = 'draft'
                          and exists (select 1 from jsonb_array_elements(j->'checks') c where c->>'key' = 'service' and not (c->>'ok')::boolean)
                          and exists (select 1 from jsonb_array_elements(j->'checks') c where c->>'key' = 'agreement_profile' and (c->>'ok')::boolean)
                          and exists (select 1 from jsonb_array_elements(j->'checks') c where c->>'key' = 'private_clear' and (c->>'ok')::boolean)
                     then 'PASS: ' else 'FAIL: ' end || 'checklist shows: not ready, service missing, profile agreement and private-data checks fine' || E'\n';

  -- 3. add a service (4B-1 function)
  execute 'set local role authenticated';
  j := public.save_local_tasker_service(t1, null, 'Solid Wood Wardrobe Repair', 'carpentry', 12500, '/job', 'Standard labour fee. Customer supplies timber.', null, array['Wardrobes'], 'available_this_week', true, 'in_person', 'Form 7', null);
  execute 'reset role';
  sid := (j->>'service_id')::uuid;
  execute 'set local role authenticated';
  j := public.local_tasker_publish_status(t1);
  execute 'reset role';
  v_out := v_out || case when (j->>'ready')::boolean and (j->>'services')::int = 1
                          and exists (select 1 from jsonb_array_elements(j->'checks') c where c->>'key' = 'verification' and not (c->>'ok')::boolean and not (c->>'blocking')::boolean)
                     then 'PASS: ' else 'FAIL: ' end || 'with a service the person is ready; missing verification record is only a recommendation' || E'\n';

  -- 4. before publish: hidden from visitors and customers; public-safe function returns nothing
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.services where id = sid;
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'draft service is not in the anonymous marketplace query' || E'\n';
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_info(array[t1::text, t2::text]);
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'public info returns nothing for a draft (and nothing for a regular tasker)' || E'\n';

  -- 5. who may NOT publish
  for i in 1..4 loop
    v_hint := null;
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   when 3 then jsonb_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text
                                                   else jsonb_build_object('role', 'authenticated')::text end, true);
    begin execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'publish refused for ' || (array['another coordinator', 'a customer', 'an unknown user', 'no user id'])[i] || ' (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_hint := null;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  begin execute 'set local role anon'; perform public.publish_local_tasker(t1); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_state = returned_sqlstate; v_hint := v_state; end;
  v_out := v_out || case when v_hint = '42501' then 'PASS: ' else 'FAIL: ' end || 'anonymous visitors cannot call publish (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  update public.coordinators set status = 'suspended' where user_id = cA;
  v_hint := null;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  begin execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  update public.coordinators set status = 'active' where user_id = cA;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'publish refused for a suspended coordinator' || E'\n';

  -- 6. private contact data on the public rows blocks publishing
  update public.taskers set phone = '08011112222' where user_id = t1::text;
  v_hint := null; v_msg := null;
  begin execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text; end;
  update public.taskers set phone = null where user_id = t1::text;
  v_out := v_out || case when v_hint = 'not_ready' and v_msg like '%private_clear%' then 'PASS: ' else 'FAIL: ' end || 'a phone number on the public tasker row blocks publishing (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 7. a photo without the photos agreement blocks publishing
  v_path := t1::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into public.local_tasker_photos (tasker_user_id, storage_path, caption, is_cover, added_by) values (t1, v_path, 'Wardrobe', true, cA) returning id into ph;
  v_hint := null; v_msg := null;
  begin execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text; end;
  v_out := v_out || case when v_hint = 'not_ready' and v_msg like '%agreement_photos%' then 'PASS: ' else 'FAIL: ' end || 'a photo without the photos agreement blocks publishing (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by) values (t1, 'photos', 'in_person', cA);

  -- 8. publish
  execute 'set local role authenticated';
  j := public.publish_local_tasker(t1);
  execute 'reset role';
  v_out := v_out || case when j->>'status' = 'published' and not (j->>'already_published')::boolean and (j->>'primary_service_id')::uuid = sid then 'PASS: ' else 'FAIL: ' end || 'publish works and names the primary service' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_profiles where tasker_user_id = t1 and status = 'published' and published_at is not null and published_by = cA)
                     then 'PASS: ' else 'FAIL: ' end || 'profile is published with time and coordinator' || E'\n';
  v_out := v_out || case when exists (select 1 from public.taskers where user_id = t1::text and available and service = 'Solid Wood Wardrobe Repair' and category = 'carpentry'
                                        and rate_value = 12500 and rate = '₦12,500/job' and location = 'Yaba, Sabo' and bio = 'Standard labour fee. Customer supplies timber.'
                                        and photo_url is null and photo is null and phone is null and whatsapp is null and coalesce(is_verified, false) = false)
                     then 'PASS: ' else 'FAIL: ' end || 'the public tasker row mirrors the service (rate text, location, bio), no photo link, no phone, not verified' || E'\n';
  select after_data::text into v_audit_text from public.local_tasker_audit_log where action = 'local_tasker_published' and entity_id = t1::text and actor_id = cA and actor_role = 'coordinator' order by created_at desc limit 1;
  v_out := v_out || case when v_audit_text is not null and v_audit_text not like '%2348011112222%' and v_audit_text not like '%Alabi%' and v_audit_text not like '%08011112222%'
                     then 'PASS: ' else 'FAIL: ' end || 'one audit row, with no phone or full name in it' || E'\n';

  -- 9. after publish: visible to visitors and customers
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.services where id = sid;
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'published service appears in the anonymous marketplace query' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.taskers where user_id = t1::text;
  select count(*) + n into n from public.users where id = t1;
  execute 'reset role';
  v_out := v_out || case when n = 2 then 'PASS: ' else 'FAIL: ' end || 'a customer can see the published users and taskers rows' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_info(array[t1::text, t2::text]);
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'public info lists only the published Local Tasker, not the regular tasker' || E'\n';
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_info(array[t1::text]) where cover_path = v_path;
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'public info carries the cover photo path' || E'\n';
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_photos(t1);
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'public photos list the one photo' || E'\n';

  -- 10. the photo FILE: readable only while published and not removed
  insert into storage.objects (bucket_id, name) values ('local-tasker-photos', v_path);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from storage.objects where bucket_id = 'local-tasker-photos' and name = v_path;
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'a visitor can read the photo file of a published person' || E'\n';
  execute 'set local role anon';
  select count(*) into n from storage.objects where bucket_id = 'local-tasker-photos';
  execute 'reset role';
  v_out := v_out || case when n = (select count(*) from storage.objects o where o.bucket_id = 'local-tasker-photos' and public.local_tasker_photo_is_public(o.name)) then 'PASS: ' else 'FAIL: ' end || 'a visitor sees exactly the public photo files and no others' || E'\n';

  -- 11. publishing again refreshes the listing (price change), no second "published" audit row
  -- (the session was left as an anonymous visitor by step 10: sign in as coordinator A BEFORE editing the service)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.save_local_tasker_service(t1, sid, 'Solid Wood Wardrobe Repair', 'carpentry', 15000, '/job', 'Standard labour fee. Customer supplies timber.', 'Yaba, Sabo', array['Wardrobes'], 'available_this_week', true, null, null, null);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.publish_local_tasker(t1);
  execute 'reset role';
  v_out := v_out || case when (j->>'already_published')::boolean
                          and exists (select 1 from public.taskers where user_id = t1::text and rate_value = 15000 and rate = '₦15,000/job')
                          and (select count(*) from public.local_tasker_audit_log where action = 'local_tasker_published' and entity_id = t1::text) = 1
                          and (select count(*) from public.local_tasker_audit_log where action = 'local_tasker_listing_refreshed' and entity_id = t1::text) = 1
                     then 'PASS: ' else 'FAIL: ' end || 'publishing again refreshes the public row and is logged as a refresh' || E'\n';

  -- 12. unpublish
  v_hint := null;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text, true);
  begin execute 'set local role authenticated'; perform public.unpublish_local_tasker(t1, null); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' and exists (select 1 from public.local_tasker_profiles where tasker_user_id = t1 and status = 'published')
                     then 'PASS: ' else 'FAIL: ' end || 'another coordinator cannot unpublish' || E'\n';
  v_hint := null;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  begin execute 'set local role authenticated'; perform public.unpublish_local_tasker(t1, repeat('x', 301)); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'a reason over 300 characters is refused' || E'\n';
  execute 'set local role authenticated';
  j := public.unpublish_local_tasker(t1, 'Asked to pause for two weeks');
  execute 'reset role';
  v_out := v_out || case when (j->>'changed')::boolean and j->>'status' = 'ready'
                          and exists (select 1 from public.local_tasker_profiles where tasker_user_id = t1 and status = 'ready')
                          and exists (select 1 from public.taskers where user_id = t1::text and available = false)
                          and exists (select 1 from public.local_tasker_audit_log where action = 'local_tasker_unpublished' and entity_id = t1::text and after_data->>'reason' = 'Asked to pause for two weeks')
                     then 'PASS: ' else 'FAIL: ' end || 'unpublish hides the person, closes the listing and is logged with the reason' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.services where id = sid;
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'after unpublish the service is gone from the anonymous marketplace query' || E'\n';
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_info(array[t1::text]);
  select count(*) + n into n from public.local_tasker_public_photos(t1);
  select count(*) + n into n from storage.objects where bucket_id = 'local-tasker-photos' and name = v_path;
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'after unpublish public info, public photos and the photo file are all closed' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.unpublish_local_tasker(t1, null);
  execute 'reset role';
  v_out := v_out || case when not (j->>'changed')::boolean then 'PASS: ' else 'FAIL: ' end || 'unpublishing someone who is not published changes nothing' || E'\n';

  -- 13. a removed photo is closed even while published; a retired person cannot be published
  execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  update public.local_tasker_photos set removed_at = now(), removed_by = cA, is_cover = false where id = ph;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from storage.objects where bucket_id = 'local-tasker-photos' and name = v_path;
  select count(*) + n into n from public.local_tasker_public_photos(t1);
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'a removed photo is not readable even while the person is published' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.unpublish_local_tasker(t1, null); execute 'reset role';
  update public.local_tasker_profiles set status = 'inactive' where tasker_user_id = t1;
  v_hint := null; v_msg := null;
  begin execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text; end;
  v_out := v_out || case when v_hint = 'not_ready' and v_msg like '%not_retired%' then 'PASS: ' else 'FAIL: ' end || 'a retired (inactive) Local Tasker cannot be published (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- 14. Local Taskers cannot apply to customer tasks (the 2C trigger); a regular tasker is not stopped by it
  v_state := null; v_msg := null;
  begin insert into public.task_applications (tasker_id) values (t1);
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  v_out := v_out || case when v_state = 'P0001' and v_msg like 'Local Taskers cannot apply%' then 'PASS: ' else 'FAIL: ' end || 'a direct insert into task_applications for a Local Tasker is refused (' || coalesce(v_state, 'no error') || ')' || E'\n';
  v_state := null;
  begin insert into public.task_applications (tasker_id) values (t2);
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  v_out := v_out || case when v_state is distinct from 'P0001' or v_msg not like 'Local Taskers cannot apply%' then 'PASS: ' else 'FAIL: ' end || 'the same insert for a regular tasker is not stopped by the Local Tasker block' || E'\n';

  v_out := v_out || case when position('FAIL' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 4C-1 TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

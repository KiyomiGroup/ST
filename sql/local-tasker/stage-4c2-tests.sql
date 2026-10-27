-- ============================================================================
-- StreetTasker Local Tasker: STAGE 4C-2 tests (public cards for the Local Taskers page)
-- Requires stage-2d-core.sql, stage-4b1-core.sql, stage-4b2-core.sql, stage-4c1-core.sql and stage-4c2-core.sql.
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 4C-2 TESTS" and ends "RESULT: ALL PASS" is the NORMAL result.
-- ============================================================================
do $$
declare
  v_out text := ''; n int; j jsonb; sid uuid; r record;
  cA uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid(); v_path text;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st4c2-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, t2]) as u;
  insert into public.users (id, name, role, profile_details) values (t2, 'ST4C2 regular tasker', 'tasker', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST4C2 A', 'active');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi', '+2348011112222', 'Yaba, Sabo', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  execute 'reset role';

  -- privileges
  v_out := v_out || case when has_function_privilege('anon', 'public.local_tasker_public_cards(int)', 'execute')
                          and has_function_privilege('authenticated', 'public.local_tasker_public_cards(int)', 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'visitors and signed-in users can call the public cards function' || E'\n';

  -- a draft person with a service is NOT listed
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.save_local_tasker_service(t1, null, 'Solid Wood Wardrobe Repair', 'carpentry', 12500, '/job', 'Standard labour fee. Customer supplies timber.', null, array['Wardrobes'], 'available_this_week', true, 'in_person', 'Form 7', null);
  execute 'reset role';
  sid := (j->>'service_id')::uuid;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_cards(12);
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'a draft Local Tasker is not listed' || E'\n';

  -- publish (with a cover photo and the photos agreement), then list
  v_path := t1::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into public.local_tasker_consents (tasker_user_id, purpose, method, recorded_by) values (t1, 'photos', 'in_person', cA);
  insert into public.local_tasker_photos (tasker_user_id, storage_path, caption, is_cover, added_by) values (t1, v_path, 'Wardrobe', true, cA);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.publish_local_tasker(t1); execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_cards(12);
  select * into r from public.local_tasker_public_cards(12) limit 1;
  execute 'reset role';
  v_out := v_out || case when n = 1 and r.user_id = t1::text and r.display_name = 'Baba A.' and r.service_name = 'Solid Wood Wardrobe Repair'
                          and r.price = 12500 and r.rate_unit = '/job' and r.location = 'Yaba, Sabo' and r.cover_path = v_path
                          and r.specialties = array['Wardrobes']
                     then 'PASS: ' else 'FAIL: ' end || 'a published Local Tasker is listed with public name, service, price, area and cover path' || E'\n';
  v_out := v_out || case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                where s.nspname = 'public' and p.proname = 'local_tasker_public_cards'
                                  and pg_get_function_result(p.oid) !~* '(phone|full_name|whatsapp|notes|status)')= 1
                     then 'PASS: ' else 'FAIL: ' end || 'the function result has no phone, full name, whatsapp, notes or status column' || E'\n';

  -- a regular tasker is never listed; limit is respected and clamped
  insert into public.services (user_id, service_name, category, price, rate_unit, description, available) values (t2, 'Regular job', 'other', 5000, '/job', 'A regular tasker service', true);
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_cards(12) where user_id = t2::text;
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'a regular tasker is not listed' || E'\n';
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_cards(0);
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'a limit of 0 is raised to 1 (not an error, not unlimited)' || E'\n';

  -- paused service => not listed (no primary service)
  update public.services set available = false where id = sid;
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_cards(12);
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'a person whose only service is paused is not listed' || E'\n';
  update public.services set available = true where id = sid;

  -- removed photo => listed without a cover path
  update public.local_tasker_photos set removed_at = now(), removed_by = cA, is_cover = false where tasker_user_id = t1;
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_cards(12) where cover_path is null;
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'a removed photo is not offered as the cover' || E'\n';

  -- unpublish => gone
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; perform public.unpublish_local_tasker(t1, null); execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.local_tasker_public_cards(12);
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'after unpublish the person is no longer listed' || E'\n';

  v_out := v_out || case when position('FAIL' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 4C-2 TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

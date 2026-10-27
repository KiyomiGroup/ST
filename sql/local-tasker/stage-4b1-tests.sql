-- ============================================================================
-- StreetTasker Local Tasker: STAGE 4B-1 tests (save_local_tasker_service)
-- Requires stage-2d-core.sql and stage-4b1-core.sql to have been run.
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 4B-1 TESTS" is the NORMAL result. Copy it only if a FAIL appears.
-- ============================================================================
do $$
declare
  v_out text := ''; v_hint text; v_state text; n int; j jsonb; sid uuid; sid2 uuid;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid();
  fn text := 'public.save_local_tasker_service(uuid,uuid,text,text,numeric,text,text,text,text[],text,boolean,text,text,text)';
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st4b1-' || substr(u::text, 1, 8) || '@local-tasker.invalid'
  from unnest(array[cA, cB, cust]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST4B1 customer', 'customer', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST4B1 A', 'active'), (cB, 'ST4B1 B', 'active');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi', '+2348011112222', 'Yaba, Sabo', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  execute 'reset role';

  v_out := v_out || case when not has_function_privilege('anon', fn, 'execute') and has_function_privilege('authenticated', fn, 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'signed-in users can call it, anonymous users cannot' || E'\n';

  -- consent is required the first time
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin
    execute 'set local role authenticated';
    perform public.save_local_tasker_service(t1, null, 'Solid Wood Wardrobe Repair', 'carpentry', 12500, '/job', 'Standard labour fee. Customer supplies timber.', null, array['Wardrobes'], 'available_this_week', true, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'consent_required' and (select count(*) from public.services where user_id = t1) = 0 then 'PASS: ' else 'FAIL: ' end || 'first service without an agreement method is refused and writes nothing (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- create with consent
  execute 'set local role authenticated';
  j := public.save_local_tasker_service(t1, null, '  Solid Wood Wardrobe Repair ', 'carpentry', 12500, '/job', 'Standard labour fee. Customer supplies timber.', '', array[' Wardrobes ', 'Doors'], 'available_this_week', true, 'in_person', 'Form 7', 'Agreed at the shop');
  execute 'reset role';
  sid := (j->>'service_id')::uuid;
  v_out := v_out || case when (j->>'created')::boolean and sid is not null then 'PASS: ' else 'FAIL: ' end || 'service created' || E'\n';
  v_out := v_out || case when exists (select 1 from public.services s where s.id = sid and s.user_id = t1 and s.service_name = 'Solid Wood Wardrobe Repair' and s.price = 12500 and s.rate_unit = '/job'
                          and s.location = 'Yaba, Sabo' and s.specialties = array['Wardrobes','Doors'] and s.available and not s.verified and s.rating = 0 and s.reviews_count = 0)
                     then 'PASS: ' else 'FAIL: ' end || 'row has trimmed values, location defaults to their areas, no rating or verified flag' || E'\n';
  v_out := v_out || case when (select count(*) from public.local_tasker_consents where tasker_user_id = t1 and purpose = 'publish_info' and method = 'in_person' and recorded_by = cA and evidence_ref = 'Form 7') = 1
                     then 'PASS: ' else 'FAIL: ' end || 'one publish_info agreement recorded by the coordinator' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where entity_id = sid::text and action = 'local_tasker_service_created' and actor_id = cA and actor_role = 'coordinator';
  v_out := v_out || case when n = 1 and exists (select 1 from public.local_tasker_audit_log where action = 'consent_recorded' and after_data->>'purpose' = 'publish_info')
                     then 'PASS: ' else 'FAIL: ' end || 'audit rows for the service and the agreement' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_profiles where tasker_user_id = t1 and status = 'draft' and published_at is null)
                          and exists (select 1 from public.taskers where user_id = t1::text and available = false)
                     then 'PASS: ' else 'FAIL: ' end || 'profile still a draft, tasker row not available (nothing published)' || E'\n';

  -- anonymous and customers cannot see the draft service (hidden by the existing restrictive policy)
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  select count(*) into n from public.services where id = sid;
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'anonymous visitors cannot see the draft service' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.services where id = sid;
  execute 'reset role';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'a customer cannot see the draft service' || E'\n';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.services where id = sid;
  execute 'reset role';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'the managing coordinator can see it' || E'\n';

  -- update: price + pause; agreement not asked again, not recorded again
  execute 'set local role authenticated';
  j := public.save_local_tasker_service(t1, sid, 'Solid Wood Wardrobe Repair', 'carpentry', 15000, '/job', 'Standard labour fee. Customer supplies timber.', 'Yaba, Sabo', array['Wardrobes','Doors'], 'available_this_week', false, null, null, null);
  execute 'reset role';
  v_out := v_out || case when j->'changed' @> '["price","active"]'::jsonb and jsonb_array_length(j->'changed') = 2 and not (j->>'created')::boolean then 'PASS: ' else 'FAIL: ' end || 'update reports price and active changed (' || (j->>'changed') || ')' || E'\n';
  v_out := v_out || case when exists (select 1 from public.services where id = sid and price = 15000 and available = false) and (select count(*) from public.local_tasker_consents where tasker_user_id = t1 and purpose = 'publish_info') = 1
                     then 'PASS: ' else 'FAIL: ' end || 'price changed, service paused, no second agreement' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_audit_log where entity_id = sid::text and action = 'local_tasker_service_updated' and (before_data->>'price')::numeric = 12500 and (after_data->>'price')::numeric = 15000 and after_data->'changed_fields' @> '["price"]'::jsonb)
                     then 'PASS: ' else 'FAIL: ' end || 'audit keeps price before and after' || E'\n';

  -- no-op
  select count(*) into n from public.local_tasker_audit_log where action like 'local_tasker_service_%';
  execute 'set local role authenticated';
  j := public.save_local_tasker_service(t1, sid, 'Solid Wood Wardrobe Repair', 'carpentry', 15000, '/job', 'Standard labour fee. Customer supplies timber.', 'Yaba, Sabo', array['Wardrobes','Doors'], 'available_this_week', false, null, null, null);
  execute 'reset role';
  v_out := v_out || case when jsonb_array_length(j->'changed') = 0 and (select count(*) from public.local_tasker_audit_log where action like 'local_tasker_service_%') = n then 'PASS: ' else 'FAIL: ' end || 'saving without changes writes no audit row' || E'\n';

  -- a service of someone else cannot be changed through this tasker id
  declare t2 uuid := gen_random_uuid(); sid_other uuid := gen_random_uuid(); begin
    insert into auth.users (id, aud, role, email) values (t2, 'authenticated', 'authenticated', 'st4b1-other@local-tasker.invalid');
    insert into public.users (id, name, role, profile_details) values (t2, 'Other tasker', 'tasker', '{}');
    insert into public.services (id, user_id, service_name, category, price) values (sid_other, t2, 'Other service', 'cleaning', 100);
    v_hint := null;
    begin
      execute 'set local role authenticated';
      perform public.save_local_tasker_service(t1, sid_other, 'Hijacked', 'cleaning', 1, '/job', 'Hijacked description', null, null, null, true, null, null, null);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' and exists (select 1 from public.services where id = sid_other and service_name = 'Other service') then 'PASS: ' else 'FAIL: ' end || 'another user''s service cannot be changed (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end;

  -- who may NOT save
  for i in 1..4 loop
    v_hint := null;
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   when 3 then jsonb_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text
                                                   else jsonb_build_object('role', 'authenticated')::text end, true);
    begin
      execute 'set local role authenticated';
      perform public.save_local_tasker_service(t1, null, 'Hacked service', 'cleaning', 1000, '/job', 'Hacked description here', null, null, null, true, 'in_person', null, null);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'refused for ' || (array['another coordinator', 'a customer', 'an unknown user', 'a caller with no user id'])[i] || ' (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  select count(*) into n from public.services where user_id = t1;
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || '  ...and the refused calls created nothing' || E'\n';

  begin
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
    execute 'set local role anon';
    perform public.save_local_tasker_service(t1, null, 'Hacked service', 'cleaning', 1000, '/job', 'Hacked description here', null, null, null, true, 'in_person', null, null);
    execute 'reset role'; v_out := v_out || 'FAIL: anonymous caller was allowed' || E'\n';
  exception when others then
    execute 'reset role'; get stacked diagnostics v_state = returned_sqlstate;
    v_out := v_out || case when v_state = '42501' then 'PASS: ' else 'FAIL: ' end || 'anonymous caller refused (sqlstate ' || v_state || ')' || E'\n';
  end;

  -- suspended coordinator / ended assignment
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  update public.coordinators set status = 'suspended' where user_id = cA;
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.save_local_tasker_service(t1, null, 'Another service', 'cleaning', 1000, '/job', 'Another description here', null, null, null, true, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'suspended coordinator refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  update public.coordinators set status = 'active' where user_id = cA;
  update public.coordinator_assignments set ended_at = now(), end_reason = 'test' where tasker_user_id = t1 and ended_at is null;
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.save_local_tasker_service(t1, null, 'Another service', 'cleaning', 1000, '/job', 'Another description here', null, null, null, true, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'coordinator whose assignment ended is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason) values (t1, cA, cA, 'test');

  -- bad input
  for i in 1..9 loop
    v_hint := null;
    begin
      execute 'set local role authenticated';
      perform public.save_local_tasker_service(t1, null,
        case when i = 1 then 'ab' else 'Good service name' end,
        case when i = 2 then 'Bad Category!' else 'cleaning' end,
        case when i = 3 then 0 when i = 4 then 99999999 else 1000 end,
        case when i = 5 then '/year' else '/job' end,
        case when i = 6 then 'short' else 'A long enough description' end,
        case when i = 7 then repeat('x', 201) else null end,
        case when i = 8 then (select array_agg('s' || g) from generate_series(1, 11) g) else null end,
        case when i = 9 then 'whenever' else 'available_now' end,
        true, null, null, null);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'refused: ' || (array['2-letter name', 'bad category', 'zero price', 'price over 10 million', 'unknown unit', 'short description', 'location over 200', '11 specialties', 'unknown availability'])[i] || ' (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;

  -- duplicate name on create
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.save_local_tasker_service(t1, null, 'SOLID wood wardrobe repair', 'carpentry', 1000, '/job', 'Enough description here', null, null, null, true, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'duplicate_name' then 'PASS: ' else 'FAIL: ' end || 'a second service with the same name is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- limit of 5
  for i in 2..5 loop
    execute 'set local role authenticated';
    perform public.save_local_tasker_service(t1, null, 'Service number ' || i, 'cleaning', 1000, '/job', 'Enough description here', null, null, null, true, null, null, null);
    execute 'reset role';
  end loop;
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.save_local_tasker_service(t1, null, 'Service number 6', 'cleaning', 1000, '/job', 'Enough description here', null, null, null, true, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'service_limit' and (select count(*) from public.services where user_id = t1) = 5 then 'PASS: ' else 'FAIL: ' end || 'a 6th service is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  v_out := v_out || case when position('FAIL' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 4B-1 TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

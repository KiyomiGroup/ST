-- ============================================================================
-- StreetTasker Local Tasker: STAGE 4A-3 tests (update_local_tasker_profile)
-- Requires stage-2d-core.sql and stage-4a3-core.sql to have been run.
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows and ROLLS THEM BACK by raising an error on purpose:
-- an error box that starts "STAGE 4A-3 TESTS" is the NORMAL result. Copy it only if a FAIL appears.
-- ============================================================================
do $$
declare
  v_out text := ''; v_hint text; v_state text; n int; j jsonb;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cS uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid();
  before_prof jsonb; after_prof jsonb;
  fn text := 'public.update_local_tasker_profile(uuid,text,text,text,text,text[],text)';
begin
  -- setup as the SQL editor owner
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st4a3-' || substr(u::text, 1, 8) || '@local-tasker.invalid'
  from unnest(array[cA, cB, cS, cust]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST4A3 customer', 'customer', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST4A3 A', 'active'), (cB, 'ST4A3 B', 'active'), (cS, 'ST4A3 S', 'active');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi', '+2348011112222', 'Yaba', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  execute 'reset role';
  -- a second Local Tasker for coordinator S, then S is suspended after creating one for the "suspended" case
  select to_jsonb(p) into before_prof from public.local_tasker_profiles p where tasker_user_id = t1;

  -- privileges
  v_out := v_out || case when not has_function_privilege('anon', fn, 'execute') and has_function_privilege('authenticated', fn, 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'signed-in users can call it, anonymous users cannot' || E'\n';

  -- happy path as coordinator A
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.update_local_tasker_profile(t1, '  Baba Alabi A. ', 'Baba Alabi Adebayo', '+234 803 000 1111', 'Yaba, Sabo', array[' Carpentry ', 'Tiling'], 'Weekdays after 2pm');
  execute 'reset role';
  v_out := v_out || case when j->'changed' @> '["full_name","phone","areas_served","skills","availability_notes","public_name"]'::jsonb and jsonb_array_length(j->'changed') = 6
                     then 'PASS: ' else 'FAIL: ' end || 'reports all six changed fields (' || (j->>'changed') || ')' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = t1 and p.full_name = 'Baba Alabi Adebayo'
                          and p.phone = '+234 803 000 1111' and p.areas_served = 'Yaba, Sabo' and p.skills = array['Carpentry','Tiling'] and p.availability_notes = 'Weekdays after 2pm')
                     then 'PASS: ' else 'FAIL: ' end || 'private profile updated, skills trimmed' || E'\n';
  v_out := v_out || case when exists (select 1 from public.users u where u.id = t1 and u.name = 'Baba Alabi A.')
                          and exists (select 1 from public.taskers t where t.user_id = t1::text and t.name = 'Baba Alabi A.')
                     then 'PASS: ' else 'FAIL: ' end || 'public name updated in users and taskers' || E'\n';
  v_out := v_out || case when exists (select 1 from public.taskers t where t.user_id = t1::text and t.phone is null and t.whatsapp is null)
                          and exists (select 1 from public.users u where u.id = t1 and u.whatsapp is null and u.dob is null)
                     then 'PASS: ' else 'FAIL: ' end || 'phone never copied to users or taskers' || E'\n';
  select to_jsonb(p) into after_prof from public.local_tasker_profiles p where tasker_user_id = t1;
  v_out := v_out || case when after_prof - 'full_name' - 'phone' - 'areas_served' - 'skills' - 'availability_notes' - 'updated_at'
                           = before_prof - 'full_name' - 'phone' - 'areas_served' - 'skills' - 'availability_notes' - 'updated_at'
                     then 'PASS: ' else 'FAIL: ' end || 'status, publishing, verification and created_by untouched' || E'\n';
  v_out := v_out || case when (select count(*) from public.coordinator_assignments where tasker_user_id = t1 and ended_at is null and coordinator_id = cA) = 1
                          and (select count(*) from public.local_tasker_consents where tasker_user_id = t1) = 1
                     then 'PASS: ' else 'FAIL: ' end || 'assignment and consent untouched' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where action = 'local_tasker_updated' and entity_id = t1::text and actor_id = cA and actor_role = 'coordinator'
     and after_data->'changed_fields' @> '["phone","full_name"]'::jsonb;
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'one audit row by the coordinator listing changed field names' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where action = 'local_tasker_updated' and (after_data::text like '%803 000 1111%' or after_data::text like '%Adebayo%' or coalesce(before_data::text, '') like '%2348011112222%' or coalesce(before_data::text, '') like '%Baba Alabi"%');
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'audit holds no phone and no full name' || E'\n';

  -- no-op save writes nothing
  select count(*) into n from public.local_tasker_audit_log where action = 'local_tasker_updated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.update_local_tasker_profile(t1, 'Baba Alabi A.', 'Baba Alabi Adebayo', '+234 803 000 1111', 'Yaba, Sabo', array['Carpentry','Tiling'], 'Weekdays after 2pm');
  execute 'reset role';
  v_out := v_out || case when jsonb_array_length(j->'changed') = 0 and (select count(*) from public.local_tasker_audit_log where action = 'local_tasker_updated') = n
                     then 'PASS: ' else 'FAIL: ' end || 'saving without changes reports none and writes no audit row' || E'\n';

  -- clearing the optional fields works
  execute 'set local role authenticated';
  j := public.update_local_tasker_profile(t1, 'Baba Alabi A.', 'Baba Alabi Adebayo', '+234 803 000 1111', '', array[]::text[], '   ');
  execute 'reset role';
  v_out := v_out || case when exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = t1 and p.areas_served is null and p.availability_notes is null and p.skills = '{}')
                     then 'PASS: ' else 'FAIL: ' end || 'optional fields can be cleared' || E'\n';

  -- who may NOT edit: another coordinator, a customer, an unknown user, no user
  for i in 1..4 loop
    v_hint := null; v_state := null;
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   when 3 then jsonb_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text
                                                   else jsonb_build_object('role', 'authenticated')::text end, true);
    begin
      execute 'set local role authenticated';
      perform public.update_local_tasker_profile(t1, 'Hacked', 'Hacked Name', '+2340000000', null, null, null);
      execute 'reset role';
    exception when others then
      execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'refused for ' || (array['another coordinator', 'a customer', 'an unknown user', 'a caller with no user id'])[i] || ' (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_out := v_out || case when exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = t1 and p.full_name = 'Baba Alabi Adebayo') and exists (select 1 from public.users where id = t1 and name = 'Baba Alabi A.')
                     then 'PASS: ' else 'FAIL: ' end || '  ...and nothing was changed by the refused calls' || E'\n';

  -- anonymous role
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
    execute 'set local role anon';
    perform public.update_local_tasker_profile(t1, 'Hacked', 'Hacked Name', '+2340000000', null, null, null);
    execute 'reset role'; v_out := v_out || 'FAIL: anonymous caller was allowed' || E'\n';
  exception when others then
    execute 'reset role'; get stacked diagnostics v_state = returned_sqlstate;
    v_out := v_out || case when v_state = '42501' then 'PASS: ' else 'FAIL: ' end || 'anonymous caller refused (sqlstate ' || v_state || ')' || E'\n';
  end;

  -- suspended coordinator loses the right
  update public.coordinators set status = 'suspended' where user_id = cA;
  v_hint := null;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.update_local_tasker_profile(t1, 'Baba Alabi A.', 'Baba Alabi Adebayo', '+234 803 000 1111', null, null, null);
    execute 'reset role';
  exception when others then
    execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint;
  end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'suspended coordinator refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  update public.coordinators set status = 'active' where user_id = cA;

  -- an ended assignment loses the right
  update public.coordinator_assignments set ended_at = now(), end_reason = 'test' where tasker_user_id = t1 and ended_at is null;
  v_hint := null;
  begin
    execute 'set local role authenticated';
    perform public.update_local_tasker_profile(t1, 'Baba Alabi A.', 'Baba Alabi Adebayo', '+234 803 000 1111', null, null, null);
    execute 'reset role';
  exception when others then
    execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint;
  end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'coordinator whose assignment ended is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason) values (t1, cA, cA, 'test');

  -- bad input
  for i in 1..6 loop
    v_hint := null;
    begin
      execute 'set local role authenticated';
      perform public.update_local_tasker_profile(t1,
        case when i = 1 then 'A' else 'Baba Alabi A.' end,
        case when i = 2 then '' else 'Baba Alabi Adebayo' end,
        case when i = 3 then '123' else '+234 803 000 1111' end,
        case when i = 4 then repeat('x', 301) else null end,
        case when i = 5 then (select array_agg('s' || g) from generate_series(1, 21) g) when i = 6 then array['ok', ''] else null end,
        null);
      execute 'reset role';
    exception when others then
      execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'refused: ' || (array['1-letter public name', 'empty full name', 'short phone', 'areas over 300', '21 skills', 'empty skill'])[i] || ' (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;

  v_out := v_out || case when position('FAIL' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 4A-3 TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

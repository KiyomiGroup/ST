-- ============================================================================
-- StreetTasker Local Tasker: STAGE 4B-2 tests (portfolio photos)
-- Requires stage-2d-core.sql and stage-4b2-core.sql to have been run.
-- Select the WHOLE file (from "do $$" to "end $$;") and press Run in the Supabase SQL editor.
-- It creates throwaway rows (including fake file records) and ROLLS THEM BACK by raising an error on
-- purpose: an error box that starts "STAGE 4B-2 TESTS" is the NORMAL result. Copy it only if a FAIL appears.
-- ============================================================================
do $$
declare
  v_out text := ''; v_hint text; v_state text; n int; j jsonb; i int;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid(); req2 uuid := gen_random_uuid();
  p1 text; p2 text; p3 text; px text; pid1 uuid; pid2 uuid; pid3 uuid; pid_other uuid;
  fa text := 'public.add_local_tasker_photo(uuid,text,text,boolean,text,text,text)';
  fu text := 'public.update_local_tasker_photo(uuid,uuid,text,boolean)';
  fr text := 'public.remove_local_tasker_photo(uuid,uuid)';
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st4b2-' || substr(u::text, 1, 8) || '@local-tasker.invalid'
  from unnest(array[cA, cB, cust]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST4B2 customer', 'customer', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST4B2 A', 'active'), (cB, 'ST4B2 B', 'active');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours'),
         (t2, 'authenticated', 'authenticated', public.local_tasker_identity_email(req2), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi', '+2348011112222', 'Yaba, Sabo', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  perform public.create_local_tasker(cB, req2, t2, 'Ngozi O.', 'Ngozi Obi', '+2348033334444', 'Ikeja', array['Cleaning'], 'Weekends', 'in_person', 'f2', null);
  execute 'reset role';

  p1 := t1::text || '/' || gen_random_uuid()::text || '.jpg';
  p2 := t1::text || '/' || gen_random_uuid()::text || '.png';
  p3 := t1::text || '/' || gen_random_uuid()::text || '.webp';

  v_out := v_out || case when not has_function_privilege('anon', fa, 'execute') and has_function_privilege('authenticated', fa, 'execute')
                          and not has_function_privilege('anon', fu, 'execute') and has_function_privilege('authenticated', fu, 'execute')
                          and not has_function_privilege('anon', fr, 'execute') and has_function_privilege('authenticated', fr, 'execute')
                     then 'PASS: ' else 'FAIL: ' end || 'signed-in users can call the three functions, anonymous users cannot' || E'\n';
  v_out := v_out || case when exists (select 1 from storage.buckets where id = 'local-tasker-photos' and not public and file_size_limit = 5242880
                          and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'])
                     then 'PASS: ' else 'FAIL: ' end || 'bucket is private, 5 MB, jpeg/png/webp only' || E'\n';

  -- ---- storage policies ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name, owner, metadata) values ('local-tasker-photos', p1, cA, '{"size": 1000}');
    execute 'reset role'; v_out := v_out || 'PASS: the managing coordinator can upload into the folder of their Local Tasker' || E'\n';
  exception when others then execute 'reset role'; v_out := v_out || 'FAIL: the managing coordinator could not upload (' || sqlerrm || ')' || E'\n'; end;

  for i in 1..5 loop
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   when 3 then jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text
                                                   when 4 then jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text
                                                   else jsonb_build_object('role', 'anon')::text end, true);
    px := case i when 3 then t1::text || '/not-a-uuid.jpg' when 4 then t1::text || '/' || gen_random_uuid()::text || '.gif'
                 else t1::text || '/' || gen_random_uuid()::text || '.jpg' end;
    begin
      execute case when i = 5 then 'set local role anon' else 'set local role authenticated' end;
      insert into storage.objects (bucket_id, name, owner, metadata) values ('local-tasker-photos', px, cA, '{"size": 1000}');
      execute 'reset role'; v_out := v_out || 'FAIL: upload allowed for ' || (array['another coordinator', 'a customer', 'a badly named file', 'a .gif file', 'an anonymous visitor'])[i] || E'\n';
    exception when others then execute 'reset role';
      v_out := v_out || 'PASS: upload refused for ' || (array['another coordinator', 'a customer', 'a badly named file', 'a .gif file', 'an anonymous visitor'])[i] || E'\n'; end;
  end loop;

  -- the file is readable by the managing coordinator only
  for i in 1..4 loop
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 3 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   else jsonb_build_object('role', 'anon')::text end, true);
    execute case when i = 4 then 'set local role anon' else 'set local role authenticated' end;
    select count(*) into n from storage.objects where bucket_id = 'local-tasker-photos' and name = p1;
    execute 'reset role';
    v_out := v_out || case when n = (case when i = 1 then 1 else 0 end) then 'PASS: ' else 'FAIL: ' end || 'file visible to ' || (array['the managing coordinator', 'another coordinator (hidden)', 'a customer (hidden)', 'an anonymous visitor (hidden)'])[i] || E'\n';
  end loop;
  -- no update/delete from the browser
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from storage.objects where bucket_id = 'local-tasker-photos' and name = p1;
  get diagnostics n = row_count;
  update storage.objects set name = name where bucket_id = 'local-tasker-photos' and name = p1;
  execute 'reset role';
  v_out := v_out || case when n = 0 and exists (select 1 from storage.objects where name = p1) then 'PASS: ' else 'FAIL: ' end || 'a coordinator cannot delete a file from the browser' || E'\n';

  -- ---- add: agreement first ----
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.add_local_tasker_photo(t1, p1, 'Wardrobe', false, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'consent_required' and (select count(*) from public.local_tasker_photos where tasker_user_id = t1) = 0 then 'PASS: ' else 'FAIL: ' end || 'first photo without an agreement method is refused and writes nothing (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  execute 'set local role authenticated';
  j := public.add_local_tasker_photo(t1, p1, '  Wardrobe  ', false, 'in_person', 'Form 9', 'Showed the photos');
  execute 'reset role';
  pid1 := (j->>'photo_id')::uuid;
  v_out := v_out || case when (j->>'created')::boolean and (j->>'is_cover')::boolean and pid1 is not null then 'PASS: ' else 'FAIL: ' end || 'first photo added and is the cover automatically' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_photos where id = pid1 and caption = 'Wardrobe' and storage_path = p1 and added_by = cA and removed_at is null)
                     then 'PASS: ' else 'FAIL: ' end || 'row has the trimmed caption, the path and the coordinator' || E'\n';
  v_out := v_out || case when (select count(*) from public.local_tasker_consents where tasker_user_id = t1 and purpose = 'photos' and method = 'in_person' and recorded_by = cA and evidence_ref = 'Form 9') = 1
                          and exists (select 1 from public.local_tasker_audit_log where action = 'consent_recorded' and after_data->>'purpose' = 'photos')
                     then 'PASS: ' else 'FAIL: ' end || 'one photos agreement recorded and audited' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_audit_log where action = 'local_tasker_photo_added' and entity_id = pid1::text and actor_id = cA)
                          and not exists (select 1 from public.local_tasker_audit_log where action like 'local_tasker_photo_%' and (after_data::text like '%' || t1::text || '/%' or after_data::text like '%Wardrobe%'))
                     then 'PASS: ' else 'FAIL: ' end || 'photo audit row exists and holds no file path or caption text' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_profiles where tasker_user_id = t1 and status = 'draft' and published_at is null)
                     then 'PASS: ' else 'FAIL: ' end || 'profile still a draft (nothing published)' || E'\n';

  -- retry of the same path: no duplicate row, no second agreement
  execute 'set local role authenticated';
  j := public.add_local_tasker_photo(t1, p1, 'Wardrobe', false, null, null, null);
  execute 'reset role';
  v_out := v_out || case when not (j->>'created')::boolean and (j->>'photo_id')::uuid = pid1 and (select count(*) from public.local_tasker_photos where tasker_user_id = t1) = 1
                          and (select count(*) from public.local_tasker_consents where tasker_user_id = t1 and purpose = 'photos') = 1
                     then 'PASS: ' else 'FAIL: ' end || 'repeating the same add is harmless (no second row, no second agreement)' || E'\n';

  -- missing file / bad paths
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.add_local_tasker_photo(t1, t1::text || '/' || gen_random_uuid()::text || '.jpg', null, false, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'upload_missing' then 'PASS: ' else 'FAIL: ' end || 'a path with no uploaded file is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  for i in 1..4 loop
    v_hint := null;
    begin execute 'set local role authenticated';
      perform public.add_local_tasker_photo(t1,
        case i when 1 then t2::text || '/' || gen_random_uuid()::text || '.jpg' when 2 then t1::text || '/x.jpg'
               when 3 then t1::text || '/' || gen_random_uuid()::text || '.gif' else t1::text || '/../' || t2::text || '/a.jpg' end,
        null, false, null, null, null);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'refused: ' || (array['another person''s folder', 'badly named file', 'wrong extension', 'path tricks'])[i] || ' (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.add_local_tasker_photo(t1, p1, repeat('x', 121), false, null, null, null);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'caption over 120 refused on add (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- second and third photos: no agreement needed; cover rules
  insert into storage.objects (bucket_id, name, owner, metadata) values ('local-tasker-photos', p2, cA, '{"size": 2000}'), ('local-tasker-photos', p3, cA, '{"size": 2000}');
  execute 'set local role authenticated';
  j := public.add_local_tasker_photo(t1, p2, null, false, null, null, null);
  pid2 := (j->>'photo_id')::uuid;
  v_out := v_out || case when (j->>'created')::boolean and not (j->>'is_cover')::boolean then 'PASS: ' else 'FAIL: ' end || 'second photo added without a new agreement and is not the cover' || E'\n';
  j := public.add_local_tasker_photo(t1, p3, 'Door', true, null, null, null);
  pid3 := (j->>'photo_id')::uuid;
  execute 'reset role';
  v_out := v_out || case when (j->>'is_cover')::boolean and (select count(*) from public.local_tasker_photos where tasker_user_id = t1 and is_cover and removed_at is null) = 1
                          and exists (select 1 from public.local_tasker_photos where id = pid3 and is_cover) and exists (select 1 from public.local_tasker_photos where id = pid1 and not is_cover)
                     then 'PASS: ' else 'FAIL: ' end || 'adding with make-cover moves the cover (exactly one cover)' || E'\n';

  -- ---- update ----
  execute 'set local role authenticated';
  j := public.update_local_tasker_photo(t1, pid2, 'Side view', true);
  execute 'reset role';
  v_out := v_out || case when j->'changed' @> '["caption","cover"]'::jsonb and jsonb_array_length(j->'changed') = 2
                          and exists (select 1 from public.local_tasker_photos where id = pid2 and is_cover and caption = 'Side view')
                          and (select count(*) from public.local_tasker_photos where tasker_user_id = t1 and is_cover and removed_at is null) = 1
                     then 'PASS: ' else 'FAIL: ' end || 'update changes caption and cover, still exactly one cover (' || (j->>'changed') || ')' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where action like 'local_tasker_photo_%';
  execute 'set local role authenticated';
  j := public.update_local_tasker_photo(t1, pid2, 'Side view', false);
  execute 'reset role';
  v_out := v_out || case when jsonb_array_length(j->'changed') = 0 and (select count(*) from public.local_tasker_audit_log where action like 'local_tasker_photo_%') = n
                          and exists (select 1 from public.local_tasker_photos where id = pid2 and is_cover) then 'PASS: ' else 'FAIL: ' end || 'saving without changes writes nothing (and p_make_cover=false never removes a cover)' || E'\n';
  execute 'set local role authenticated';
  j := public.update_local_tasker_photo(t1, pid2, '', false);
  execute 'reset role';
  v_out := v_out || case when j->'changed' @> '["caption"]'::jsonb and exists (select 1 from public.local_tasker_photos where id = pid2 and caption is null) then 'PASS: ' else 'FAIL: ' end || 'an empty caption clears it' || E'\n';
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.update_local_tasker_photo(t1, pid2, repeat('x', 121), false);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'bad_input' then 'PASS: ' else 'FAIL: ' end || 'caption over 120 refused on update (' || coalesce(v_hint, 'no error') || ')' || E'\n';

  -- ---- RLS on the table ----
  for i in 1..4 loop
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 3 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   else jsonb_build_object('role', 'anon')::text end, true);
    begin
      execute case when i = 4 then 'set local role anon' else 'set local role authenticated' end;
      select count(*) into n from public.local_tasker_photos where tasker_user_id = t1;
      execute 'reset role';
    exception when others then execute 'reset role'; n := 0; end;
    v_out := v_out || case when n = (case when i = 1 then 3 else 0 end) then 'PASS: ' else 'FAIL: ' end || 'photo rows visible to ' || (array['the managing coordinator (3)', 'another coordinator (0)', 'a customer (0)', 'an anonymous visitor (0)'])[i] || ' (' || n || ')' || E'\n';
  end loop;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.local_tasker_photos (tasker_user_id, storage_path) values (t1, t1::text || '/' || gen_random_uuid()::text || '.jpg');
    execute 'reset role'; v_out := v_out || 'FAIL: a coordinator wrote the photos table directly' || E'\n';
  exception when others then execute 'reset role'; v_out := v_out || 'PASS: the browser cannot write the photos table directly' || E'\n'; end;

  -- ---- remove ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cA::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.remove_local_tasker_photo(t1, pid2);
  execute 'reset role';
  v_out := v_out || case when (j->>'removed')::boolean and (j->>'new_cover')::uuid = pid1
                          and exists (select 1 from public.local_tasker_photos where id = pid2 and removed_at is not null and removed_by = cA and not is_cover)
                          and exists (select 1 from storage.objects where name = p2)
                          and (select count(*) from public.local_tasker_photos where tasker_user_id = t1 and is_cover and removed_at is null) = 1
                     then 'PASS: ' else 'FAIL: ' end || 'removing the cover marks it removed (row and file kept) and the oldest remaining photo becomes the cover' || E'\n';
  v_out := v_out || case when exists (select 1 from public.local_tasker_audit_log where action = 'local_tasker_photo_removed' and entity_id = pid2::text and (before_data->>'was_cover')::boolean) then 'PASS: ' else 'FAIL: ' end || 'removal audited' || E'\n';
  for i in 1..3 loop
    v_hint := null;
    begin execute 'set local role authenticated';
      if i = 1 then perform public.remove_local_tasker_photo(t1, pid2);
      elsif i = 2 then perform public.update_local_tasker_photo(t1, pid2, 'x', true);
      else perform public.add_local_tasker_photo(t1, p2, null, false, null, null, null); end if;
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when (i < 3 and v_hint = 'not_found') or (i = 3 and v_hint = 'bad_input') then 'PASS: ' else 'FAIL: ' end || 'a removed photo cannot be ' || (array['removed again', 'edited', 're-added'])[i] || ' (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;

  -- a photo of ANOTHER person cannot be touched through this tasker id
  insert into storage.objects (bucket_id, name, owner, metadata) values ('local-tasker-photos', t2::text || '/' || gen_random_uuid()::text || '.jpg', cB, '{"size": 10}');
  insert into public.local_tasker_photos (tasker_user_id, storage_path, is_cover, added_by)
    select t2, name, true, cB from storage.objects where name like t2::text || '/%' returning id into pid_other;
  for i in 1..2 loop
    v_hint := null;
    begin execute 'set local role authenticated';
      if i = 1 then perform public.update_local_tasker_photo(t1, pid_other, 'Hijack', false); else perform public.remove_local_tasker_photo(t1, pid_other); end if;
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
    v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'another person''s photo cannot be ' || (array['edited', 'removed'])[i] || ' through this person''s id (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  end loop;
  v_out := v_out || case when exists (select 1 from public.local_tasker_photos where id = pid_other and removed_at is null and caption is null) then 'PASS: ' else 'FAIL: ' end || '  ...and it is unchanged' || E'\n';

  -- ---- who may NOT call ----
  select count(*) into n from public.local_tasker_photos where tasker_user_id = t1 and removed_at is null;
  for i in 1..4 loop
    perform set_config('request.jwt.claims', case i when 1 then jsonb_build_object('sub', cB::text, 'role', 'authenticated')::text
                                                   when 2 then jsonb_build_object('sub', cust::text, 'role', 'authenticated')::text
                                                   when 3 then jsonb_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text
                                                   else jsonb_build_object('role', 'authenticated')::text end, true);
    v_hint := null; v_state := '';
    declare k int; begin
      for k in 1..3 loop
        v_hint := null;
        begin execute 'set local role authenticated';
          if k = 1 then perform public.add_local_tasker_photo(t1, p1, null, false, 'in_person', null, null);
          elsif k = 2 then perform public.update_local_tasker_photo(t1, pid1, 'Hacked', true);
          else perform public.remove_local_tasker_photo(t1, pid1); end if;
          execute 'reset role';
        exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
        v_state := v_state || coalesce(v_hint, 'none') || ' ';
      end loop;
    end;
    v_out := v_out || case when v_state = 'not_found not_found not_found ' then 'PASS: ' else 'FAIL: ' end || 'add/update/remove refused for ' || (array['another coordinator', 'a customer', 'an unknown user', 'a caller with no user id'])[i] || ' (' || btrim(v_state) || ')' || E'\n';
  end loop;
  v_out := v_out || case when (select count(*) from public.local_tasker_photos where tasker_user_id = t1 and removed_at is null) = n
                          and exists (select 1 from public.local_tasker_photos where id = pid1 and caption = 'Wardrobe' and removed_at is null) then 'PASS: ' else 'FAIL: ' end || '  ...and the refused calls changed nothing' || E'\n';
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
    execute 'set local role anon';
    perform public.remove_local_tasker_photo(t1, pid1);
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
    perform public.update_local_tasker_photo(t1, pid1, 'Hacked', false);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  execute 'set local role authenticated';
  select count(*) into i from public.local_tasker_photos where tasker_user_id = t1;
  begin insert into storage.objects (bucket_id, name, owner, metadata) values ('local-tasker-photos', t1::text || '/' || gen_random_uuid()::text || '.jpg', cA, '{}'); n := 1;
  exception when others then n := 0; end;
  execute 'reset role';
  v_out := v_out || case when v_hint = 'not_found' and i = 0 and n = 0 then 'PASS: ' else 'FAIL: ' end || 'suspended coordinator refused by the function, the table and the bucket (' || coalesce(v_hint, 'no error') || ', rows ' || i || ', upload ' || n || ')' || E'\n';
  update public.coordinators set status = 'active' where user_id = cA;
  update public.coordinator_assignments set ended_at = now(), end_reason = 'test' where tasker_user_id = t1 and ended_at is null;
  v_hint := null;
  begin execute 'set local role authenticated';
    perform public.remove_local_tasker_photo(t1, pid1);
    execute 'reset role';
  exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; end;
  v_out := v_out || case when v_hint = 'not_found' then 'PASS: ' else 'FAIL: ' end || 'coordinator whose assignment ended is refused (' || coalesce(v_hint, 'no error') || ')' || E'\n';
  insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason) values (t1, cA, cA, 'test');

  -- ---- limit of 8 ----
  for i in 1..8 loop
    px := t1::text || '/' || gen_random_uuid()::text || '.jpg';
    insert into storage.objects (bucket_id, name, owner, metadata) values ('local-tasker-photos', px, cA, '{"size": 10}');
    begin execute 'set local role authenticated';
      perform public.add_local_tasker_photo(t1, px, null, false, null, null, null);
      execute 'reset role';
    exception when others then execute 'reset role'; get stacked diagnostics v_hint = pg_exception_hint; exit; end;
    v_hint := null;
  end loop;
  select count(*) into n from public.local_tasker_photos where tasker_user_id = t1 and removed_at is null;
  v_out := v_out || case when v_hint = 'photo_limit' and n = 8 then 'PASS: ' else 'FAIL: ' end || 'a 9th photo is refused; removed photos do not count (' || coalesce(v_hint, 'no error') || ', ' || n || ' active)' || E'\n';

  -- ---- other storage policies must be limited to a bucket, or they could expose this one ----
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
     and policyname not like 'lt_photos_%'
     and cmd in ('SELECT', 'INSERT', 'ALL')
     and (roles && array['public', 'anon', 'authenticated']::name[])
     and coalesce(qual, with_check, '') not like '%bucket_id%';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'every other storage policy is limited to named buckets (' || n || ' that are not: they could expose the photo bucket; send their names)' || E'\n';

  v_out := v_out || case when position('FAIL' in v_out) > 0 then E'\nRESULT: AT LEAST ONE FAIL' else E'\nRESULT: ALL PASS' end;
  raise exception 'STAGE 4B-2 TESTS (everything was rolled back on purpose):%', E'\n' || v_out;
end $$;

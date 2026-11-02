-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7B tests (verified payout destination)
-- Requires stage-7b-core.sql (and everything before it up to 4A: create_local_tasker).
-- Select the WHOLE file and press Run in the Supabase SQL editor. It creates throwaway rows and ROLLS THEM BACK by raising an error
-- on purpose: an error box that starts "STAGE 7B TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. Copy it only if a FAIL appears.
-- NOTE: these tests use FAKE recipient codes. They never call Paystack. Nothing here proves a Paystack call works.
-- ============================================================================
create or replace function pg_temp.st_try(p_user uuid, p_sql text, p_role text default 'authenticated') returns text
language plpgsql as $f$
declare r text; v_hint text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then '' else jsonb_build_object('sub', p_user::text, 'role', p_role)::text end, true);
    execute 'set local role ' || p_role;
    execute p_sql into r;
    execute 'reset role';
    return coalesce(r, 'null');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    execute 'reset role';
    return 'ERR:' || coalesce(nullif(v_hint, ''), sqlstate);
  end;
end $f$;

do $$
declare
  v_out text := ''; t text; n int; j jsonb; a0 int;
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cS uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); req1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); req2 uuid := gen_random_uuid();
  acc1 uuid; acc2 uuid;
  save1 constant text := 'select public.local_payout_save(%L, %L, ''058'', ''Guaranty Trust Bank'', ''6789'', %L, %L, %L, %L, %L)::text';
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st7b-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cS, cust]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST7B customer', 'customer', '{}');
  insert into public.coordinators (user_id, display_name, status) values (cA, 'ST7B A', 'active'), (cB, 'ST7B B', 'active'), (cS, 'ST7B S', 'suspended');
  insert into auth.users (id, aud, role, email, banned_until)
  values (t1, 'authenticated', 'authenticated', public.local_tasker_identity_email(req1), now() + interval '876000 hours'),
         (t2, 'authenticated', 'authenticated', public.local_tasker_identity_email(req2), now() + interval '876000 hours');
  execute 'set local role service_role';
  perform public.create_local_tasker(cA, req1, t1, 'Baba A.', 'Baba Alabi Adebayo', '+2348011112222', 'Yaba', array['Carpentry'], 'Weekdays', 'in_person', 'f1', null);
  perform public.create_local_tasker(cA, req2, t2, 'Chi K.', 'Chika', '+2348033334444', 'Yaba', array['Tiling'], 'Weekdays', 'in_person', 'f2', null);
  execute 'reset role';

  -- 1. privileges: the table is invisible to the browser roles; the write path is server only
  v_out := v_out || case when not has_table_privilege('anon', 'public.local_payout_accounts', 'select')
        and not has_table_privilege('authenticated', 'public.local_payout_accounts', 'select')
        and not has_table_privilege('authenticated', 'public.local_payout_accounts', 'insert')
        and not has_table_privilege('authenticated', 'public.local_payout_accounts', 'update')
        and not has_table_privilege('anon', 'public.local_payout_attempts', 'select')
        and not has_table_privilege('authenticated', 'public.local_payout_attempts', 'select')
        then 'PASS: ' else 'FAIL: ' end || 'anon and signed-in users have no privilege on the payout tables' || E'\n';
  v_out := v_out || case when not has_function_privilege('authenticated', 'public.local_payout_save(uuid,uuid,text,text,text,text,text,text,text,text)', 'execute')
        and not has_function_privilege('authenticated', 'public.local_payout_begin(uuid,uuid,text)', 'execute')
        and not has_function_privilege('authenticated', 'public.local_payout_check_name(uuid,text)', 'execute')
        and not has_function_privilege('anon', 'public.local_payout_account(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.local_payout_account(uuid)', 'execute')
        and has_function_privilege('service_role', 'public.local_payout_save(uuid,uuid,text,text,text,text,text,text,text,text)', 'execute')
        then 'PASS: ' else 'FAIL: ' end || 'save, begin and check_name are server-only; the masked read is for signed-in users only' || E'\n';
  t := pg_temp.st_try(cA, 'select count(*)::text from public.local_payout_accounts');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL: ' end || 'a coordinator cannot SELECT the table directly (' || t || ')' || E'\n';
  t := pg_temp.st_try(null, 'select count(*)::text from public.local_payout_accounts', 'anon');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL: ' end || 'anon cannot SELECT the table (' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format(save1, cA, t1, 'BABA ALABI ADEBAYO', 'RCP_fake000001', 'in_person', null, null));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL: ' end || 'a coordinator cannot call local_payout_save from the browser (' || t || ')' || E'\n';

  -- 2. the name rule
  v_out := v_out || case when public.local_payout_names_match('Baba Alabi Adebayo', 'BABA ALABI ADEBAYO')
        and public.local_payout_names_match('Baba Alabi Adebayo', 'ADEBAYO, Baba Alabi')
        and public.local_payout_names_match('Baba Alabi Adebayo', 'Baba Alabi Olu Adebayo')
        and public.local_payout_names_match('baba  alabi-adebayo', 'Baba Alabi Adebayo')
        then 'PASS: ' else 'FAIL: ' end || 'name rule accepts case, order, punctuation and one extra middle name' || E'\n';
  v_out := v_out || case when not public.local_payout_names_match('Baba Alabi Adebayo', 'Baba Alabi')
        and not public.local_payout_names_match('Baba Alabi Adebayo', 'Baba Alabi Olu Femi Adebayo')
        and not public.local_payout_names_match('Baba Alabi Adebayo', 'Chika Okoro Obi')
        and not public.local_payout_names_match('Baba Alabi Adebayo', 'Baba Alabi Adebayo Trading Company')
        and not public.local_payout_names_match('Chika', 'Chika')
        and not public.local_payout_names_match(null, 'Baba Alabi')
        and not public.local_payout_names_match('Baba Alabi Adebayo', '')
        then 'PASS: ' else 'FAIL: ' end || 'name rule refuses a missing word, two extra words, another person, a one-word registered name, empty' || E'\n';

  -- 3. begin: authority and throttle
  t := pg_temp.st_try(cA, format('select public.local_payout_begin(%L, %L, ''resolve'')::text', cA, t1), 'service_role');
  v_out := v_out || case when t like '%"ok": true%' then 'PASS: ' else 'FAIL: ' end || 'the managing active coordinator may start a lookup (' || t || ')' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_payout_begin(%L, %L, ''resolve'')::text', cB, t1), 'service_role');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'another coordinator gets not_found (' || t || ')' || E'\n';
  t := pg_temp.st_try(cS, format('select public.local_payout_begin(%L, %L, ''resolve'')::text', cS, t1), 'service_role');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'a suspended coordinator gets not_found (' || t || ')' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_payout_begin(%L, %L, ''resolve'')::text', cust, t1), 'service_role');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'a customer id gets not_found (' || t || ')' || E'\n';
  for n in 1..19 loop perform public.local_payout_begin(cA, t1, 'resolve'); end loop;     -- 1 + 19 = 20 so far
  t := pg_temp.st_try(cA, format('select public.local_payout_begin(%L, %L, ''resolve'')::text', cA, t1), 'service_role');
  v_out := v_out || case when t = 'ERR:rate_limited' then 'PASS: ' else 'FAIL: ' end || 'the 21st lookup in an hour is refused (' || t || ')' || E'\n';
  delete from public.local_payout_attempts;                                                -- reset the throttle for the rest of the tests

  -- 4. save: refusals first (nothing may be written)
  t := pg_temp.st_try(cB, format(save1, cB, t1, 'BABA ALABI ADEBAYO', 'RCP_fake000001', 'in_person', null, null), 'service_role');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'save by a coordinator who does not manage this person is refused (' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format(save1, cA, t1, 'CHIKA OKORO OBI', 'RCP_fake000001', 'in_person', null, null), 'service_role');
  v_out := v_out || case when t = 'ERR:name_mismatch' then 'PASS: ' else 'FAIL: ' end || 'save with a bank name that is not theirs is refused (' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format(save1, cA, t2, 'CHIKA', 'RCP_fake000009', 'in_person', null, null), 'service_role');
  v_out := v_out || case when t = 'ERR:name_mismatch' then 'PASS: ' else 'FAIL: ' end || 'a registered name of one word can never match (' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format(save1, cA, t1, 'BABA ALABI ADEBAYO', 'RCP_fake000001', null, null, null), 'service_role');
  v_out := v_out || case when t = 'ERR:consent_required' then 'PASS: ' else 'FAIL: ' end || 'save without recording how they agreed is refused (' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format(save1, cA, t1, 'BABA ALABI ADEBAYO', 'RCP_fake000001', 'in_person', 'acct 0123456789', null), 'service_role');
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL: ' end || 'an account number typed into the reference box is refused (' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format(save1, cA, t1, 'BABA ALABI ADEBAYO', 'bad code', 'in_person', null, null), 'service_role');
  v_out := v_out || case when t = 'ERR:bad_input' then 'PASS: ' else 'FAIL: ' end || 'a malformed recipient code is refused (' || t || ')' || E'\n';
  select count(*) into n from public.local_payout_accounts;
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'no refused save left a row (' || n || ')' || E'\n';
  select count(*) into n from public.local_tasker_consents where purpose = 'payout';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'no refused save left a payout consent (' || n || ')' || E'\n';

  -- 5. save: first registration
  execute 'set local role service_role';
  j := public.local_payout_save(cA, t1, '058', 'Guaranty Trust Bank', '6789', 'BABA ALABI ADEBAYO', 'RCP_fake000001', 'phone', 'form 12', 'said yes on the phone');
  execute 'reset role';
  v_out := v_out || case when (j->>'changed')::boolean and (j->>'replaced')::boolean is false then 'PASS: ' else 'FAIL: ' end || 'first save registers the account (' || j::text || ')' || E'\n';
  select count(*) into n from public.local_tasker_consents where tasker_user_id = t1 and purpose = 'payout' and method = 'phone' and recorded_by = cA;
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'a fresh payout consent row was written by the coordinator (' || n || ')' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where action in ('payout_account_registered', 'consent_recorded') and after_data->>'tasker_user_id' = t1::text and created_at >= now() - interval '1 minute' and (action = 'payout_account_registered' or after_data->>'purpose' = 'payout');
  v_out := v_out || case when n = 2 then 'PASS: ' else 'FAIL: ' end || 'two audit rows (consent_recorded, payout_account_registered) (' || n || ')' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where (before_data::text || after_data::text) ~ '[0-9]{9,}|RCP_';
  v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL: ' end || 'no audit row holds a long digit run or a recipient code (' || n || ')' || E'\n';
  select id into acc1 from public.local_payout_accounts where tasker_user_id = t1 and status = 'active';

  -- 6. masked read
  t := pg_temp.st_try(cA, format('select public.local_payout_account(%L)::text', t1));
  v_out := v_out || case when t like '%******6789%' and t like '%"has_account": true%' and t like '%BABA ALABI ADEBAYO%' then 'PASS: ' else 'FAIL: ' end || 'the managing coordinator reads the MASKED account (' || t || ')' || E'\n';
  v_out := v_out || case when t not like '%RCP_%' and t !~ '[0-9]{7,}' and t not like '%recipient%' then 'PASS: ' else 'FAIL: ' end || 'the masked read holds no recipient code and no long number' || E'\n';
  t := pg_temp.st_try(cB, format('select public.local_payout_account(%L)::text', t1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'another coordinator cannot read it (' || t || ')' || E'\n';
  t := pg_temp.st_try(cust, format('select public.local_payout_account(%L)::text', t1));
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'a customer cannot read it (' || t || ')' || E'\n';
  t := pg_temp.st_try(null, format('select public.local_payout_account(%L)::text', t1), 'anon');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL: ' end || 'anon cannot call the read (' || t || ')' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_payout_account(%L)::text', t2));
  v_out := v_out || case when t like '%"has_account": false%' then 'PASS: ' else 'FAIL: ' end || 'a person with no account reads has_account false (' || t || ')' || E'\n';

  -- 7. retry and change
  execute 'set local role service_role';
  j := public.local_payout_save(cA, t1, '058', 'Guaranty Trust Bank', '6789', 'BABA ALABI ADEBAYO', 'RCP_fake000001', 'phone', null, null);
  execute 'reset role';
  select count(*) into n from public.local_tasker_consents where tasker_user_id = t1 and purpose = 'payout';
  v_out := v_out || case when (j->>'changed')::boolean is false and n = 1 then 'PASS: ' else 'FAIL: ' end || 'saving the same recipient again changes nothing and adds no consent (' || j::text || ', consents ' || n || ')' || E'\n';
  execute 'set local role service_role';
  j := public.local_payout_save(cA, t1, '057', 'Zenith Bank', '1111', 'Adebayo Baba Alabi', 'RCP_fake000002', 'in_person', null, null);
  execute 'reset role';
  select count(*) into n from public.local_payout_accounts where tasker_user_id = t1;
  v_out := v_out || case when (j->>'changed')::boolean and (j->>'replaced')::boolean and n = 2 then 'PASS: ' else 'FAIL: ' end || 'a different account replaces the first and keeps history (' || j::text || ', rows ' || n || ')' || E'\n';
  select count(*) into n from public.local_payout_accounts where tasker_user_id = t1 and status = 'active';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'exactly one active account (' || n || ')' || E'\n';
  select count(*) into n from public.local_payout_accounts where id = acc1 and status = 'superseded' and superseded_by = cA and superseded_at is not null;
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'the old account is superseded, with who and when' || E'\n';
  select count(*) into n from public.local_tasker_consents where tasker_user_id = t1 and purpose = 'payout';
  v_out := v_out || case when n = 2 then 'PASS: ' else 'FAIL: ' end || 'the change needed and wrote a NEW consent row (' || n || ')' || E'\n';
  select count(*) into n from public.local_tasker_audit_log where action = 'payout_account_changed' and after_data->>'last4' = '1111';
  v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL: ' end || 'the change wrote a payout_account_changed audit row' || E'\n';
  t := pg_temp.st_try(cA, format('select public.local_payout_account(%L)::text', t1));
  v_out := v_out || case when t like '%******1111%' and t like '%Zenith%' and t not like '%6789%' then 'PASS: ' else 'FAIL: ' end || 'the read now shows the new account only (' || t || ')' || E'\n';

  -- 8. history cannot be edited, even by the table owner
  begin update public.local_payout_accounts set recipient_code = 'RCP_hacked0001' where id = acc1; v_out := v_out || 'FAIL: history row was edited' || E'\n';
  exception when others then v_out := v_out || 'PASS: editing a history row is refused (' || sqlerrm || ')' || E'\n'; end;
  begin update public.local_payout_accounts set status = 'active', superseded_at = null where id = acc1; v_out := v_out || 'FAIL: superseded row was re-activated' || E'\n';
  exception when others then v_out := v_out || 'PASS: re-activating a superseded row is refused' || E'\n'; end;
  begin delete from public.local_payout_accounts where id = acc1; v_out := v_out || 'FAIL: row was deleted' || E'\n';
  exception when others then v_out := v_out || 'PASS: deleting a row is refused' || E'\n'; end;
  begin truncate public.local_payout_accounts; v_out := v_out || 'FAIL: table was truncated' || E'\n';
  exception when others then v_out := v_out || 'PASS: truncating the table is refused' || E'\n'; end;
  begin insert into public.local_payout_accounts (tasker_user_id, bank_code, bank_name, account_last4, account_name_resolved, recipient_code, consent_id, verified_by)
        select t1, '058', 'Bank X', '1234', 'Baba Alabi Adebayo', 'RCP_fake000003', consent_id, cA from public.local_payout_accounts where status = 'active';
        v_out := v_out || 'FAIL: a second active account was inserted' || E'\n';
  exception when unique_violation then v_out := v_out || 'PASS: a second active account for one person is impossible' || E'\n'; end;

  -- 9. retired person refused
  update public.local_tasker_profiles set status = 'inactive' where tasker_user_id = t1;
  t := pg_temp.st_try(cA, format(save1, cA, t1, 'BABA ALABI ADEBAYO', 'RCP_fake000004', 'in_person', null, null), 'service_role');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL: ' end || 'a retired Local Tasker cannot get a new destination (' || t || ')' || E'\n';

  raise exception E'STAGE 7B TESTS\n%\nRESULT: %', v_out, case when v_out like '%FAIL:%' then 'FAILURES FOUND' else 'ALL PASS' end;
end $$;

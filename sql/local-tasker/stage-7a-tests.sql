-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7A tests (Part 1: fee rate per tasker)
-- Requires stage-7a-core.sql. Select the WHOLE file and press Run in the Supabase SQL editor. It creates throwaway rows and ROLLS THEM BACK by
-- raising an error on purpose: an error box that starts "STAGE 7A TESTS" and ends "RESULT: ALL PASS" is the NORMAL result.
-- A line that starts "SKIP:" means a check could not run in this project; a SKIP is NOT a pass.
-- ============================================================================
create or replace function pg_temp.st_try(p_user uuid, p_sql text) returns text
language plpgsql as $f$
declare r jsonb; v_hint text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then '' else jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text end, true);
    execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
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
  v_out text := ''; t text; j jsonb; v_rate numeric; v_have boolean := true; v_err text;
  lt uuid := gen_random_uuid(); rg uuid := gen_random_uuid(); cust uuid := gen_random_uuid(); cust2 uuid := gen_random_uuid(); unbooked uuid := gen_random_uuid();
  bkL uuid; bkR uuid; v_md5 text; v_md5b text; v_pre numeric;
begin
  v_pre := public.platform_fee_rate();

  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st7a-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[lt, rg, cust, cust2, unbooked]) as u;
  insert into public.users (id, name, role, profile_details) values (cust, 'ST7A customer', 'customer', '{}'), (cust2, 'ST7A customer 2', 'customer', '{}'),
         (lt, 'ST7A Local Tasker', 'tasker', '{}'), (rg, 'ST7A Regular Tasker', 'tasker', '{}'), (unbooked, 'ST7A Unbooked', 'tasker', '{}') on conflict (id) do nothing;
  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, lt, 'confirmed', 'unpaid', 15000) returning id into bkL;
  insert into public.bookings (customer_id, tasker_id, status, payment_status, amount) values (cust, rg, 'confirmed', 'unpaid', 15000) returning id into bkR;
  select md5(string_agg(row(b.status, b.payment_status, b.amount)::text, '|' order by b.id)) into v_md5 from public.bookings b where b.id in (bkL, bkR);

  -- a throwaway Local Tasker profile (the real table may need more columns than this: then the Local Tasker checks SKIP, they are not passed)
  begin
    insert into public.local_tasker_profiles (tasker_user_id, full_name, phone, status) values (lt, 'ST7A Local Tasker', '+2348000000000', 'published');
  exception when others then
    v_have := false; v_err := sqlerrm;
  end;

  -- 1. privileges
  v_out := v_out || case when not has_function_privilege('anon', 'public.platform_fee_rate_for_tasker(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public.platform_fee_rate_for_tasker(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.is_local_tasker_user(uuid)', 'execute')
        and not has_function_privilege('authenticated', 'public.is_local_tasker_user(uuid)', 'execute')
        and has_function_privilege('service_role', 'public.platform_fee_rate_for_tasker(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.booking_fee_rates(uuid[])', 'execute')
        and not has_function_privilege('anon', 'public.booking_fee_rates(uuid[])', 'execute') then 'PASS: ' else 'FAIL: ' end
        || 'the fee functions cannot be called by the browser (anon, signed-in); only booking_fee_rates can, and not anon' || E'\n';

  -- 2. the rate itself, with numbers
  v_out := v_out || case when public.platform_fee_rate() = v_pre then 'PASS: ' else 'FAIL: ' end || 'platform_fee_rate() is unchanged (' || v_pre || ')' || E'\n';
  v_rate := public.platform_fee_rate_for_tasker(rg);
  v_out := v_out || case when v_rate = v_pre
        and round(15000 * v_rate) = round(15000 * v_pre) and 15000 - round(15000 * v_rate) = 15000 - round(15000 * v_pre) then 'PASS: ' else 'FAIL: ' end
        || 'REGULAR tasker: rate ' || v_rate || ', N15,000 job: fee ' || round(15000 * v_rate) || ', tasker nets ' || (15000 - round(15000 * v_rate))
        || '; N18,500: fee ' || round(18500 * v_rate) || ', nets ' || (18500 - round(18500 * v_rate)) || E'\n';
  v_out := v_out || case when public.platform_fee_rate_for_tasker(null) = v_pre and public.platform_fee_rate_for_tasker(gen_random_uuid()) = v_pre then 'PASS: ' else 'FAIL: ' end
        || 'an unknown or missing tasker gets the normal rate (never 0 by accident)' || E'\n';
  if v_have then
    v_rate := public.platform_fee_rate_for_tasker(lt);
    v_out := v_out || case when v_rate = 0 and round(15000 * v_rate) = 0 and 15000 - round(15000 * v_rate) = 15000 and 18500 - round(18500 * v_rate) = 18500 then 'PASS: ' else 'FAIL: ' end
          || 'LOCAL tasker: rate ' || v_rate || ', N15,000 job: fee 0, tasker nets 15000; N18,500: fee 0, nets 18500' || E'\n';
    update public.local_tasker_profiles set status = 'ready' where tasker_user_id = lt;
    v_out := v_out || case when public.platform_fee_rate_for_tasker(lt) = 0 then 'PASS: ' else 'FAIL: ' end || 'still 0 when the person is unpublished (decision D-7A-1)' || E'\n';
    update public.local_tasker_profiles set status = 'published' where tasker_user_id = lt;
  else
    v_out := v_out || 'SKIP: could not create a throwaway Local Tasker profile in this project (' || v_err || '); the Local Tasker checks did not run' || E'\n';
  end if;

  -- 3. customer-safe read
  t := pg_temp.st_try(cust, format('select coalesce(jsonb_object_agg(tasker_id::text, fee_rate), ''{}''::jsonb) from public.booking_fee_rates(array[%L, %L, %L]::uuid[])', lt, rg, unbooked));
  j := case when t like 'ERR:%' then jsonb_build_object('err', t) else t::jsonb end;
  v_out := v_out || case when not (j ? 'err') and (j ->> rg::text)::numeric = v_pre and not (j ? unbooked::text)
        and (not v_have or (j ->> lt::text)::numeric = 0) and (select count(*) from jsonb_object_keys(j)) = case when v_have then 2 else 1 end then 'PASS: ' else 'FAIL(' || t || '): ' end
        || 'a customer gets the rate for taskers they booked, and nothing for a tasker they never booked' || E'\n';
  t := pg_temp.st_try(cust2, format('select coalesce(jsonb_agg(tasker_id), ''[]''::jsonb) from public.booking_fee_rates(array[%L, %L]::uuid[])', lt, rg));
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'another customer learns nothing about taskers they never booked' || E'\n';
  t := pg_temp.st_try(null, format('select coalesce(jsonb_agg(tasker_id), ''[]''::jsonb) from public.booking_fee_rates(array[%L]::uuid[])', lt));
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'anonymous cannot call it' || E'\n';
  t := pg_temp.st_try(cust, 'select coalesce(jsonb_agg(tasker_id), ''[]''::jsonb) from public.booking_fee_rates(null::uuid[])');
  v_out := v_out || case when t = '[]' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an empty or null list returns nothing' || E'\n';
  t := pg_temp.st_try(cust, 'select to_jsonb(public.platform_fee_rate_for_tasker(gen_random_uuid()))');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in customer cannot call the fee function directly' || E'\n';

  -- 4. nothing else changed
  select md5(string_agg(row(b.status, b.payment_status, b.amount)::text, '|' order by b.id)) into v_md5b from public.bookings b where b.id in (bkL, bkR);
  v_out := v_out || case when v_md5 = v_md5b then 'PASS: ' else 'FAIL: ' end || 'bookings are unchanged (status, payment status, amount)' || E'\n';
  v_out := v_out || 'NOTE: this part changes no money path. _prepare_intent and _release_escrow still use platform_fee_rate() until Part 2 is applied.' || E'\n';

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 7A TESTS\n%', v_out;
end $$;

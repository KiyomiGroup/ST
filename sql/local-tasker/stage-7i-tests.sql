-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7I tests (my_coordinator_upgrades, read only).
-- Requires stage-7i-core.sql. Select the WHOLE file and press Run in the Supabase SQL editor.
-- It adds ONE throwaway history row for a real active coordinator (tier 98 to 99, which no real coordinator has),
-- reads it back as that coordinator, and ROLLS EVERYTHING BACK by raising an error on purpose:
-- an error box that starts "STAGE 7I TESTS" and ends "RESULT: ALL PASS" is the NORMAL result.
-- A "SKIP:" line means a check could not run in this project; a SKIP is NOT a pass.
-- No payment, no Paystack, no tier change.
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
  v_out text := ''; t text; v_a uuid; v_b uuid; v_row jsonb; v_ref text := 'st7i-test-' || substr(gen_random_uuid()::text, 1, 8);
begin
  -- 1. the function exists and is SECURITY DEFINER
  v_out := v_out || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.my_coordinator_upgrades()') and p.prosecdef) then 'PASS: ' else 'FAIL: ' end || 'my_coordinator_upgrades() exists and is security definer' || E'\n';

  -- 2. grants
  v_out := v_out || case when has_function_privilege('anon', 'public.my_coordinator_upgrades()', 'execute') then 'FAIL: ' else 'PASS: ' end || 'anon cannot execute it' || E'\n';
  v_out := v_out || case when has_function_privilege('authenticated', 'public.my_coordinator_upgrades()', 'execute') then 'PASS: ' else 'FAIL: ' end || 'a signed-in user can execute it' || E'\n';
  v_out := v_out || case when has_table_privilege('authenticated', 'public.coordinator_tier_upgrades', 'select') or has_table_privilege('anon', 'public.coordinator_tier_upgrades', 'select') then 'FAIL: ' else 'PASS: ' end || 'browsers still cannot read coordinator_tier_upgrades directly (the 7G rule holds)' || E'\n';

  -- 3. real sessions, switched like the browser's
  t := pg_temp.st_try(null, 'select public.my_coordinator_upgrades()');
  v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'anon is refused' || E'\n';
  t := pg_temp.st_try(gen_random_uuid(), 'select public.my_coordinator_upgrades()');
  v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in person who is not an active coordinator is refused (not_found)' || E'\n';

  select c.user_id into v_a from public.coordinators c where public.is_active_coordinator(c.user_id) order by c.user_id limit 1;
  select c.user_id into v_b from public.coordinators c where public.is_active_coordinator(c.user_id) and c.user_id <> v_a order by c.user_id limit 1;

  if v_a is null then
    v_out := v_out || 'SKIP: no active coordinator exists in this project, so the content checks could not run' || E'\n';
  else
    t := pg_temp.st_try(v_a, 'select public.my_coordinator_upgrades()');
    v_out := v_out || case when t like '[%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an active coordinator reads a list' || E'\n';

    -- one throwaway row (rolled back at the end)
    insert into public.coordinator_tier_upgrades (coordinator_id, from_tier, to_tier, amount_kobo, payment_reference)
    values (v_a, 98, 99, 5000000, v_ref);
    t := pg_temp.st_try(v_a, 'select public.my_coordinator_upgrades()');
    v_row := (t::jsonb) -> 0;
    v_out := v_out || case when v_row ->> 'payment_reference' = v_ref and (v_row ->> 'from_tier')::int = 98 and (v_row ->> 'to_tier')::int = 99
                                and (v_row ->> 'amount_kobo')::bigint = 5000000 and (v_row ->> 'capacity')::int = 510 and v_row ->> 'created_at' is not null
                           then 'PASS: ' else 'FAIL(' || coalesce(v_row::text, 'null') || '): ' end
              || 'the newest row has the tier step, amount, capacity (from the schedule) and reference' || E'\n';
    v_out := v_out || case when (select count(*) from jsonb_array_elements(t::jsonb)) = (select count(*) from public.coordinator_tier_upgrades u where u.coordinator_id = v_a)
                           then 'PASS: ' else 'FAIL: ' end || 'it returns every one of that coordinator''s rows (and not more)' || E'\n';

    if v_b is null then
      v_out := v_out || 'SKIP: only one active coordinator exists, so the "another coordinator cannot see it" check could not run' || E'\n';
    else
      t := pg_temp.st_try(v_b, 'select public.my_coordinator_upgrades()');
      v_out := v_out || case when t like '[%' and position(v_ref in t) = 0 then 'PASS: ' else 'FAIL: ' end || 'another active coordinator does not see that row' || E'\n';
    end if;

    -- the table itself is still closed to a signed-in coordinator
    t := pg_temp.st_try(v_a, 'select to_jsonb(count(*)) from public.coordinator_tier_upgrades');
    v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a coordinator still cannot read the history table directly' || E'\n';
  end if;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 7I TESTS\n%', v_out;
end $$;

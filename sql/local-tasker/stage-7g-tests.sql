-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7G-1 tests (coordinator tiers: model and capacity).
-- Requires stage-7g-core.sql. Select the WHOLE file and press Run in the Supabase SQL editor.
-- It creates throwaway coordinators and Local Taskers, fills and upgrades them, and ROLLS EVERYTHING BACK by raising an error on purpose:
-- an error box that starts "STAGE 7G TESTS" and ends "RESULT: ALL PASS" is the NORMAL result. No payment, no Paystack.
-- A "SKIP:" line means a check could not run in this project; a SKIP is NOT a pass.
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

-- add one active assignment for a throwaway Local Tasker; returns '' or the hint of the refusal
create or replace function pg_temp.st_assign(p_coord uuid) returns text
language plpgsql as $f$
declare t uuid := gen_random_uuid(); v_hint text; v_msg text;
begin
  insert into auth.users (id, aud, role, email) values (t, 'authenticated', 'authenticated', 'st7g-' || substr(t::text, 1, 8) || '@local-tasker.invalid');
  insert into public.users (id, name, role, profile_details) values (t, 'ST7G LT', 'tasker', '{}') on conflict (id) do nothing;
  begin
    insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason) values (t, p_coord, p_coord, 'st7g test');
    return '';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    return coalesce(nullif(v_hint, ''), sqlstate) || '|' || v_msg;
  end;
end $f$;

do $$
declare
  v_out text := ''; t text; v_err text; v_have boolean := true; j jsonb; n int; i int; r record; exp_cap int[]; exp_price bigint[];
  cA uuid := gen_random_uuid(); cB uuid := gen_random_uuid(); cC uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
begin
  -- 1. the schedule, tiers 1 to 8, against the table in DECISIONS.md
  exp_cap := array[10, 20, 30, 35, 40, 45, 50, 55];
  exp_price := array[0, 5000000, 10000000, 15000000, 20000000, 25000000, 30000000, 35000000];   -- kobo: 0; 50,000; 100,000; 150,000; 200,000; 250,000; 300,000; 350,000 naira
  for i in 1..8 loop
    select * into r from public.coordinator_tier_terms(i);
    v_out := v_out || case when r.tier = i and r.capacity = exp_cap[i] and r.price_kobo = exp_price[i] then 'PASS: ' else 'FAIL(' || coalesce(r.capacity::text, '?') || '/' || coalesce(r.price_kobo::text, '?') || '): ' end
          || 'tier ' || i || ' allows ' || exp_cap[i] || ' and costs ' || (exp_price[i] / 100) || ' naira to reach' || E'\n';
  end loop;
  foreach i in array array[0, -1, 101] loop
    t := null;
    begin perform * from public.coordinator_tier_terms(i); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
    v_out := v_out || case when t = 'bad_tier' then 'PASS: ' else 'FAIL(' || coalesce(t, '?') || '): ' end || 'tier ' || i || ' is refused as unknown' || E'\n';
  end loop;
  t := null;
  begin perform * from public.coordinator_tier_terms(null); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
  v_out := v_out || case when t = 'bad_tier' then 'PASS: ' else 'FAIL: ' end || 'a null tier is refused' || E'\n';

  -- 2. throwaway people
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'st7g-' || substr(u::text, 1, 8) || '@local-tasker.invalid' from unnest(array[cA, cB, cC, stranger]) as u;
  insert into public.users (id, name, role, profile_details) values (stranger, 'ST7G stranger', 'customer', '{}') on conflict (id) do nothing;
  begin
    insert into public.coordinators (user_id, display_name, status) values (cA, 'ST7G A', 'active'), (cB, 'ST7G B', 'active'), (cC, 'ST7G C', 'active');
  exception when others then v_have := false; v_err := sqlerrm; end;

  if not v_have then
    v_out := v_out || 'SKIP: could not create throwaway coordinators (' || v_err || '); every check that needs them was skipped' || E'\n';
  else
    -- 3. state rows: backfilled and automatic
    select count(*) into n from public.coordinators c where not exists (select 1 from public.coordinator_tiers_state s where s.coordinator_id = c.user_id);
    v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'every coordinator has a tier row (existing ones backfilled, new ones created by the trigger)' || E'\n';
    v_out := v_out || case when (select tier from public.coordinator_tiers_state where coordinator_id = cA) = 1 and public.coordinator_capacity(cA) = 10 then 'PASS: ' else 'FAIL: ' end || 'a new coordinator starts at tier 1 with capacity 10' || E'\n';
    v_out := v_out || case when public.coordinator_capacity(gen_random_uuid()) = 10 then 'PASS: ' else 'FAIL: ' end || 'a coordinator with no tier row counts as tier 1' || E'\n';

    -- 4. tier 1: the 11th active Local Tasker is refused with the same hint as before
    begin
      for i in 1..10 loop t := pg_temp.st_assign(cA); if t <> '' then v_err := t; exit; end if; end loop;
      v_out := v_out || case when (select count(*) from public.coordinator_assignments where coordinator_id = cA and ended_at is null) = 10 then 'PASS: ' else 'FAIL(' || coalesce(v_err, '?') || '): ' end || 'a tier 1 coordinator can take 10 active Local Taskers' || E'\n';
      t := pg_temp.st_assign(cA);
      v_out := v_out || case when t like 'coordinator_cap|%maximum of 10 active%tier 1%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the 11th is refused with hint coordinator_cap and a message that names 10 and tier 1' || E'\n';

      -- 5. upgrades: skipping, repeating, reusing a reference
      t := null; begin perform public.coordinator_apply_upgrade(cB, 3, 'st7g-ref-skip'); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
      v_out := v_out || case when t = 'tier_skip' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'tier 1 to tier 3 is refused (no skipping)' || E'\n';
      t := null; begin perform public.coordinator_apply_upgrade(cB, 1, 'st7g-ref-same'); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
      v_out := v_out || case when t = 'tier_already_applied' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'upgrading to the tier already held is refused' || E'\n';
      t := null; begin perform public.coordinator_apply_upgrade(cB, 2, '   '); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
      v_out := v_out || case when t = 'bad_input' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a blank payment reference is refused' || E'\n';
      t := null; begin perform public.coordinator_apply_upgrade(gen_random_uuid(), 2, 'st7g-ref-nobody'); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
      v_out := v_out || case when t = 'not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an unknown coordinator is refused' || E'\n';
      v_out := v_out || case when (select tier from public.coordinator_tiers_state where coordinator_id = cB) = 1 and not exists (select 1 from public.coordinator_tier_upgrades where coordinator_id = cB) then 'PASS: ' else 'FAIL: ' end || 'the refused attempts changed nothing' || E'\n';

      j := public.coordinator_apply_upgrade(cA, 2, 'st7g-ref-A2');
      v_out := v_out || case when (j ->> 'tier')::int = 2 and (j ->> 'capacity')::int = 20 and (j ->> 'amount_kobo')::bigint = 5000000 then 'PASS: ' else 'FAIL(' || j::text || '): ' end || 'tier 1 to tier 2 works: capacity 20, price 50,000 naira taken from the schedule' || E'\n';
      t := null; begin perform public.coordinator_apply_upgrade(cA, 2, 'st7g-ref-A2-again'); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
      v_out := v_out || case when t = 'tier_already_applied' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the same upgrade twice is refused' || E'\n';
      t := null; begin perform public.coordinator_apply_upgrade(cB, 2, 'st7g-ref-A2'); t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
      v_out := v_out || case when t = 'payment_reused' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'one payment reference cannot pay for two upgrades' || E'\n';
      select count(*) into n from public.coordinator_tier_upgrades where coordinator_id = cA;
      v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'exactly one ledger row exists for the upgrade' || E'\n';
      select count(*) into n from public.local_tasker_audit_log l where to_jsonb(l)::text like '%coordinator_tier_upgraded%' and to_jsonb(l)::text like '%' || cA::text || '%';   -- column names of the log are not assumed
      v_out := v_out || case when n = 1 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'exactly one audit row was written' || E'\n';

      -- 6. tier 2: places 11 to 20 open up, the 21st is refused
      for i in 1..10 loop t := pg_temp.st_assign(cA); if t <> '' then v_err := t; exit; end if; end loop;
      v_out := v_out || case when (select count(*) from public.coordinator_assignments where coordinator_id = cA and ended_at is null) = 20 then 'PASS: ' else 'FAIL(' || coalesce(v_err, '?') || '): ' end || 'after the upgrade the same coordinator can take 20 active Local Taskers' || E'\n';
      t := pg_temp.st_assign(cA);
      v_out := v_out || case when t like 'coordinator_cap|%maximum of 20 active%tier 2%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the 21st is refused (hint coordinator_cap, names 20 and tier 2)' || E'\n';

      -- 7. ending an assignment frees a place (C8)
      begin
        update public.coordinator_assignments set ended_at = now(), ended_by = cA, end_reason = 'st7g test'
         where id = (select id from public.coordinator_assignments where coordinator_id = cA and ended_at is null order by assigned_at limit 1);
        t := pg_temp.st_assign(cA);
        v_out := v_out || case when t = '' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'ending one assignment frees a place for a new one' || E'\n';
      exception when others then v_out := v_out || 'SKIP: could not end an assignment (' || sqlerrm || '); the freed-place check was skipped' || E'\n'; end;

      -- 8. a coordinator ABOVE capacity keeps everyone but cannot add more (simulated by lowering the stored tier directly, which no function does)
      update public.coordinator_tiers_state set tier = 1 where coordinator_id = cA;
      select count(*) into n from public.coordinator_assignments where coordinator_id = cA and ended_at is null;
      t := pg_temp.st_assign(cA);
      v_out := v_out || case when t like 'coordinator_cap|%' and (select count(*) from public.coordinator_assignments where coordinator_id = cA and ended_at is null) = n and n > 10 then 'PASS: ' else 'FAIL(' || t || '): ' end
            || 'a coordinator above capacity (' || n || ' people, capacity 10) keeps all of them and cannot add another' || E'\n';
      t := pg_temp.st_try(cA, 'select public.my_coordinator_plan()');
      if t like 'ERR:%' then v_out := v_out || 'FAIL(' || t || '): the coordinator can read their plan' || E'\n';
      else j := t::jsonb;
        v_out := v_out || case when (j ->> 'over_capacity')::boolean and (j ->> 'places_left')::int = 0 and (j ->> 'active_count')::int = n and (j ->> 'capacity')::int = 10 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the plan says over capacity, 0 places left' || E'\n';
      end if;
      update public.coordinator_tiers_state set tier = 2 where coordinator_id = cA;
    exception when others then
      v_out := v_out || 'SKIP: could not create throwaway Local Tasker assignments (' || sqlerrm || '); the capacity and upgrade checks were skipped' || E'\n';
    end;

    -- 9. the plan for a fresh tier 1 coordinator
    t := pg_temp.st_try(cC, 'select public.my_coordinator_plan()');
    if t like 'ERR:%' then v_out := v_out || 'FAIL(' || t || '): a tier 1 coordinator can read their plan' || E'\n';
    else j := t::jsonb;
      v_out := v_out || case when (j ->> 'tier')::int = 1 and (j ->> 'capacity')::int = 10 and (j ->> 'active_count')::int = 0 and (j ->> 'places_left')::int = 10 and not (j ->> 'over_capacity')::boolean
            and (j -> 'next' ->> 'tier')::int = 2 and (j -> 'next' ->> 'capacity')::int = 20 and (j -> 'next' ->> 'price_kobo')::bigint = 5000000 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'the plan shows tier 1, 10 places left, and the next tier (20 places, 50,000 naira)' || E'\n';
    end if;
    t := pg_temp.st_try(stranger, 'select public.my_coordinator_plan()');
    v_out := v_out || case when t = 'ERR:not_found' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in person who is not a coordinator cannot read a plan' || E'\n';
    t := pg_temp.st_try(null, 'select public.my_coordinator_plan()');
    v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL: ' end || 'no session: refused' || E'\n';

    -- 10. no browser write path, and nothing gives a tier without payment
    t := pg_temp.st_try(cC, 'select public.coordinator_apply_upgrade(''' || cC || '''::uuid, 2, ''st7g-ref-browser'')');
    v_out := v_out || case when t like 'ERR:%' and (select tier from public.coordinator_tiers_state where coordinator_id = cC) = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in coordinator cannot raise their own tier' || E'\n';
    t := pg_temp.st_try(cC, 'with u as (update public.coordinator_tiers_state set tier = 8 where coordinator_id = ''' || cC || '''::uuid returning 1) select to_jsonb(count(*)) from u');
    v_out := v_out || case when t like 'ERR:%' and (select tier from public.coordinator_tiers_state where coordinator_id = cC) = 1 then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in coordinator cannot write the tier table' || E'\n';
    t := pg_temp.st_try(cC, 'select to_jsonb(count(*)) from public.coordinator_tiers_state');
    v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in coordinator cannot read the tier table directly' || E'\n';
    t := pg_temp.st_try(cC, 'select to_jsonb(count(*)) from public.coordinator_tier_upgrades');
    v_out := v_out || case when t like 'ERR:%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'a signed-in coordinator cannot read the upgrade ledger directly' || E'\n';
    v_out := v_out || case when not has_function_privilege('anon', 'public.coordinator_apply_upgrade(uuid,integer,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.coordinator_apply_upgrade(uuid,integer,text)', 'execute')
          and has_function_privilege('service_role', 'public.coordinator_apply_upgrade(uuid,integer,text)', 'execute') then 'PASS: ' else 'FAIL: ' end || 'only the service role may run the upgrade function' || E'\n';
    select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname ~* '(tier|capacity)' and p.proname !~* '^(coordinator_tier_terms|coordinator_capacity|my_coordinator_plan|coordinator_apply_upgrade|coordinator_tiers_state_seed|coordinator_tier_upgrades_immutable)$'
       and p.prokind = 'f';
    v_out := v_out || case when n = 0 then 'PASS: ' else 'FAIL(' || n || '): ' end || 'no other function about tiers or capacity exists (no free-tier or downgrade function)' || E'\n';

    -- 11. the ledger is history
    t := null; begin update public.coordinator_tier_upgrades set amount_kobo = 1 where coordinator_id = cA; t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
    v_out := v_out || case when t = 'immutable' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an upgrade record cannot be edited' || E'\n';
    t := null; begin delete from public.coordinator_tier_upgrades where coordinator_id = cA; t := 'no error'; exception when others then get stacked diagnostics t = pg_exception_hint; end;
    v_out := v_out || case when t = 'immutable' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an upgrade record cannot be deleted' || E'\n';

    -- 12. the guard still protects what it protected before
    update public.coordinators set status = 'inactive' where user_id = cC;
    t := pg_temp.st_assign(cC);
    v_out := v_out || case when t like '%not active%' then 'PASS: ' else 'FAIL(' || t || '): ' end || 'an inactive coordinator still cannot receive a Local Tasker' || E'\n';
    t := null;
    begin
      insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason) values (gen_random_uuid(), gen_random_uuid(), cC, 'st7g test');
      t := 'no error';
    exception when others then t := sqlerrm; end;
    v_out := v_out || case when t <> 'no error' then 'PASS: ' else 'FAIL: ' end || 'an assignment to a coordinator that does not exist is still refused' || E'\n';
  end if;

  if v_out like '%FAIL%' then v_out := v_out || 'RESULT: FAILURES ABOVE'; else v_out := v_out || 'RESULT: ALL PASS'; end if;
  raise exception E'STAGE 7G TESTS\n%', v_out;
end $$;

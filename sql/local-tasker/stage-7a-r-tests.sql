-- ============================================================================
-- StreetTasker Local Tasker: STAGE 7A-R tests. READ-ONLY (creates and changes nothing). Requires stage-7a-r-core.sql.
-- Select the WHOLE file, press Run. You get a table: check | result | detail. The last row says "RESULT: ALL PASS" or "RESULT: n FAIL".
-- A SKIP means the check could not run in this project (for example no Local Tasker exists yet). A SKIP is NOT a pass. INFO is not a check.
-- ============================================================================
with
rate as (select public.platform_fee_rate() as r),
lt as (select (select tasker_user_id from public.local_tasker_profiles order by 1 limit 1) as id),
amounts(n) as (values (100::numeric), (104), (108), (333), (1000), (1250), (12345), (50000), (250000), (10000000)),
res(ord, chk, result, detail) as (
  select 1, 'platform_fee_rate() is 0.12 today', case when r = 0.12 then 'PASS' else 'FAIL' end, 'platform_fee_rate() = ' || r::text from rate
  union all
  select 2, 'a regular (unknown) tasker gets the platform rate',
         case when public.platform_fee_rate_for_tasker(gen_random_uuid()) = r then 'PASS' else 'FAIL' end,
         'rate_for_tasker = ' || public.platform_fee_rate_for_tasker(gen_random_uuid())::text from rate
  union all
  select 3, 'a NULL tasker gets the platform rate',
         case when public.platform_fee_rate_for_tasker(null) = r then 'PASS' else 'FAIL' end,
         'rate_for_tasker(null) = ' || coalesce(public.platform_fee_rate_for_tasker(null)::text, 'null') from rate
  union all
  select 4, 'a REAL Local Tasker gets the platform rate (no 0% path)',
         case when lt.id is null then 'SKIP' when public.platform_fee_rate_for_tasker(lt.id) = r then 'PASS' else 'FAIL' end,
         case when lt.id is null then 'no row in local_tasker_profiles yet' else 'rate_for_tasker(local tasker) = ' || public.platform_fee_rate_for_tasker(lt.id)::text end
    from rate, lt
  union all
  select 10 + row_number() over (order by n), 'booking of ' || n::text || ': fee 12%, tasker 88%, parts add up',
         case when round(n * public.platform_fee_rate_for_tasker(coalesce(lt.id, gen_random_uuid()))) = round(n * 0.12)
               and n - round(n * public.platform_fee_rate_for_tasker(coalesce(lt.id, gen_random_uuid()))) = n - round(n * 0.12)
              then 'PASS' else 'FAIL' end,
         'fee ' || round(n * public.platform_fee_rate_for_tasker(coalesce(lt.id, gen_random_uuid())))::text
           || ' | tasker ' || (n - round(n * public.platform_fee_rate_for_tasker(coalesce(lt.id, gen_random_uuid()))))::text
    from amounts, lt
  union all
  select 30, 'worked example 50,000 gives fee 6,000 and tasker 44,000',
         case when round(50000 * public.platform_fee_rate_for_tasker(gen_random_uuid())) = 6000 then 'PASS' else 'FAIL' end,
         'fee ' || round(50000 * public.platform_fee_rate_for_tasker(gen_random_uuid()))::text
  union all
  select 31, 'platform_fee_rate_for_booking returns the platform rate for an existing booking',
         case when b.id is null then 'SKIP' when public.platform_fee_rate_for_booking(b.id) = r then 'PASS' else 'FAIL' end,
         case when b.id is null then 'no booking exists yet' else 'rate_for_booking = ' || public.platform_fee_rate_for_booking(b.id)::text end
    from rate left join lateral (select id from public.bookings limit 1) b on true
  union all
  select 32, 'platform_fee_rate_for_booking returns NULL for a missing booking (gift-card-pay then refuses)',
         case when public.platform_fee_rate_for_booking(gen_random_uuid()) is null then 'PASS' else 'FAIL' end, ''
  union all
  select 40, 'the rate function has no Local Tasker branch',
         case when pg_get_functiondef('public.platform_fee_rate_for_tasker(uuid)'::regprocedure) ilike '%local_tasker%' then 'FAIL' else 'PASS' end,
         'body does not mention local_tasker'
  union all
  select 41, 'the customer-side booking_fee_rates function is gone',
         case when to_regprocedure('public.booking_fee_rates(uuid[])') is null then 'PASS' else 'FAIL' end, ''
  union all
  select 42, 'no 0% branch in _prepare_intent / _release_escrow',
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('_prepare_intent', '_release_escrow')
                             and pg_get_functiondef(p.oid) ilike '%is_local_tasker%')
              then 'FAIL' else 'PASS' end,
         'neither body calls is_local_tasker_user'
  union all
  select 43, 'browser roles cannot call the rate functions',
         case when has_function_privilege('anon', 'public.platform_fee_rate_for_tasker(uuid)', 'execute')
                or has_function_privilege('authenticated', 'public.platform_fee_rate_for_tasker(uuid)', 'execute')
                or has_function_privilege('anon', 'public.platform_fee_rate_for_booking(uuid)', 'execute')
                or has_function_privilege('authenticated', 'public.platform_fee_rate_for_booking(uuid)', 'execute') then 'FAIL' else 'PASS' end,
         'anon and authenticated have no execute right'
  union all
  select 90, 'INFO: payments already taken at 0% fee (kept as paid; only NEW payments change)', 'INFO',
         (select count(*)::text || ' payment_intents rows with platform_fee = 0 and amount > 0' from public.payment_intents where coalesce(platform_fee, 0) = 0 and coalesce(amount, 0) > 0)
)
select "check", result, detail from (
  select ord, chk as "check", result, detail from res
  union all
  select 999, 'RESULT', case when count(*) filter (where result = 'FAIL') = 0 then 'ALL PASS' else count(*) filter (where result = 'FAIL')::text || ' FAIL' end,
         count(*) filter (where result = 'PASS')::text || ' PASS, ' || count(*) filter (where result = 'SKIP')::text || ' SKIP'
    from res
) x order by ord;

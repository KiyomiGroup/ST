\set ON_ERROR_STOP off
create temp table res(n int, ok boolean, t text);
create or replace function pg_temp.chk(n int, ok boolean, t text) returns void language sql as $$ insert into res values (n, coalesce(ok,false), t) $$;
set app.perm = 'revenue.view';
select set_config('x.r', public.admin_revenue_report('week','2026-10-26','2026-11-12')::text, false);
select set_config('x.s', public.admin_revenue_report('day','2026-11-06','2026-11-12')::text, false);
select set_config('x.m', public.admin_revenue_report('month','2026-09-01','2026-11-12')::text, false);
select pg_temp.chk(1, (current_setting('x.r')::jsonb->>'ok')::boolean, 'report ok');
select pg_temp.chk(2, (current_setting('x.r')::jsonb#>>'{streams,regular_commission,kobo}')::bigint = 120000+60000+40000+30000, 'regular commission = 250000 (four jobs in range, midnight rule, no local, no 2025 row)');
select pg_temp.chk(3, (current_setting('x.r')::jsonb#>>'{streams,regular_commission,rows}')::int = 4, 'regular rows = 4');
select pg_temp.chk(4, (current_setting('x.r')::jsonb#>>'{streams,local_commission,kobo}')::bigint = 30000 and (current_setting('x.r')::jsonb#>>'{streams,local_commission,rows}')::int = 1, 'local platform share 30000, zero-share row skipped');
select pg_temp.chk(5, (current_setting('x.r')::jsonb#>>'{streams,coordinator_share,kobo}')::bigint = 50000, 'coordinator share kept apart as memo (50000)');
select pg_temp.chk(6, (current_setting('x.r')::jsonb#>>'{streams,subscription,kobo}')::bigint = 300000, 'subscription = receipts with a paid time only, in range (300000)');
select pg_temp.chk(7, (current_setting('x.r')::jsonb#>>'{streams,coordinator_plan,kobo}')::bigint = 500050, 'coordinator plan = paid tier_upgrade only, exact kobo (500050); pending, failed and archive excluded');
select pg_temp.chk(8, (current_setting('x.r')::jsonb#>>'{streams,withdrawal_fee,kobo}')::bigint = 10000 and (current_setting('x.r')::jsonb#>>'{streams,withdrawal_fee,rows}')::int = 1, 'withdrawal fee: only the successful row with a fee (10000)');
select pg_temp.chk(9, (current_setting('x.r')::jsonb#>>'{held,kobo}')::bigint = 350025 and (current_setting('x.r')::jsonb#>>'{held,rows}')::int = 2, 'held commission = held escrow rows only (350025)');
select pg_temp.chk(10, not (current_setting('x.r')::jsonb ? 'total') and not (current_setting('x.r')::jsonb->'streams' ? 'total'), 'no grand total key anywhere');
-- weekly series: weeks start Monday; 26 Oct, 2 Nov, 9 Nov
select pg_temp.chk(11, jsonb_array_length(current_setting('x.r')::jsonb->'series') = 3, 'series has 3 weeks');
select pg_temp.chk(12, (select (e->>'regular_commission')::bigint from jsonb_array_elements(current_setting('x.r')::jsonb->'series') e where e->>'period'='2026-11-02') = 60000, 'week of 2 Nov regular = 60000');
select pg_temp.chk(13, (select (e->>'regular_commission')::bigint from jsonb_array_elements(current_setting('x.r')::jsonb->'series') e where e->>'period'='2026-11-09') = 190000, 'week of 9 Nov regular = 190000 (WAT day boundary: 00:30 WAT Monday counted in that week)');
select pg_temp.chk(14, (select (e->>'regular_commission')::bigint from jsonb_array_elements(current_setting('x.r')::jsonb->'series') e where e->>'period'='2026-10-26') = 0, 'empty week shows 0, not missing');
select pg_temp.chk(15, (select sum((e->>'regular_commission')::bigint) from jsonb_array_elements(current_setting('x.r')::jsonb->'series') e) = (current_setting('x.r')::jsonb#>>'{streams,regular_commission,kobo}')::bigint, 'series sums to the stream total');
-- daily
select pg_temp.chk(16, jsonb_array_length(current_setting('x.s')::jsonb->'series') = 7, 'day series has 7 days');
select pg_temp.chk(17, (select (e->>'subscription')::bigint from jsonb_array_elements(current_setting('x.s')::jsonb->'series') e where e->>'period'='2026-11-06') = 300000, 'subscription lands on 6 Nov');
-- monthly
select pg_temp.chk(18, jsonb_array_length(current_setting('x.m')::jsonb->'series') = 3, 'month series has Sep, Oct, Nov');
select pg_temp.chk(19, (select (e->>'subscription')::bigint from jsonb_array_elements(current_setting('x.m')::jsonb->'series') e where e->>'period'='2026-10-01') = 700000, 'October subscription = 700000');
-- list
select set_config('x.l', public.admin_revenue_list('regular_commission','2026-10-26','2026-11-12',0)::text, false);
select pg_temp.chk(20, (current_setting('x.l')::jsonb->>'total')::int = 4 and (current_setting('x.l')::jsonb->>'total_kobo')::bigint = 250000 and jsonb_array_length(current_setting('x.l')::jsonb->'items') = 4, 'list total and rows agree with the report');
select pg_temp.chk(21, current_setting('x.l')::jsonb#>>'{items,0,reference}' = 'w1', 'newest first');
select pg_temp.chk(22, (public.admin_revenue_list('bogus','2026-10-26','2026-11-12',0)->>'stream') = 'regular_commission', 'unknown stream falls back, no error');
select pg_temp.chk(23, (public.admin_revenue_list('subscription','2026-10-01','2026-11-12',-5)->>'offset')::int = 0, 'negative offset becomes 0');
select pg_temp.chk(24, (public.admin_revenue_report('year','2026-10-26','2026-11-12')->>'bucket') = 'week', 'unknown bucket becomes week');
select pg_temp.chk(25, (public.admin_revenue_report('week','2026-11-12','2026-10-26')->>'ok')::boolean = false, 'start after end refused');
select pg_temp.chk(26, (public.admin_revenue_report('day','2024-01-01','2026-11-12')->>'ok')::boolean = false, 'range over 400 days refused');
select pg_temp.chk(27, (public.admin_revenue_report('week')->>'ok')::boolean and (public.admin_revenue_report('week')->>'to')::date = (now() at time zone 'Africa/Lagos')::date, 'defaults work (12 weeks to today)');
-- missing optional tables
drop table public.subscription_receipts; drop table public.withdrawals;
select pg_temp.chk(28, (public.admin_revenue_report('week','2026-10-26','2026-11-12')#>>'{streams,subscription,kobo}')::bigint = 0 and (public.admin_revenue_report('week','2026-10-26','2026-11-12')#>>'{streams,withdrawal_fee,kobo}')::bigint = 0, 'missing subscription_receipts and withdrawals tables: zero, no error');
-- permissions
do $$ begin
  set local app.perm = 'transactions.view';
  begin perform public.admin_revenue_report('week'); perform pg_temp.chk(29, false, 'no permission refused'); exception when sqlstate '42501' then perform pg_temp.chk(29, true, 'report refused without revenue.view'); end;
  begin perform public.admin_revenue_list('subscription'); perform pg_temp.chk(30, false, 'no permission refused'); exception when sqlstate '42501' then perform pg_temp.chk(30, true, 'list refused without revenue.view'); end;
  set local app.perm = '';
  begin perform public.admin_revenue_report('week'); perform pg_temp.chk(31, false, 'empty permission refused'); exception when sqlstate '42501' then perform pg_temp.chk(31, true, 'refused with no permission at all'); end;
end $$;
-- the browser roles cannot call helpers, only the two admin functions
select pg_temp.chk(32, not has_function_privilege('authenticated','public._a16_events()','execute') and not has_function_privilege('anon','public.admin_revenue_report(text,date,date)','execute') and has_function_privilege('authenticated','public.admin_revenue_report(text,date,date)','execute'), 'grants: helpers closed, anon closed, authenticated open');
-- nothing written
select pg_temp.chk(33, (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not in ('rel_events','payment_intents','escrow_payments','test_archive_payment_intents')) = 0, 'A16 created no table');
select n, case when ok then 'PASS' else 'FAIL' end r, t from res order by n;
select count(*) filter (where not ok) as failures, count(*) as total from res;

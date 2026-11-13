\set ON_ERROR_STOP off
create temp table res(n int, ok boolean, t text);
create or replace function pg_temp.chk(n int, ok boolean, t text) returns void language sql as $$ insert into res values (n, coalesce(ok,false), t) $$;
-- view-only admin first
set app.perm = 'subscriptions.view';
select set_config('x.o', public.admin_subscriptions_overview()::text, false);
select pg_temp.chk(1, (current_setting('x.o')::jsonb->>'ok')::boolean, 'overview ok');
select pg_temp.chk(2, (current_setting('x.o')::jsonb#>>'{subscribers,total}')::int = 5
   and (current_setting('x.o')::jsonb#>>'{subscribers,by_status,active}')::int = 2 and (current_setting('x.o')::jsonb#>>'{subscribers,by_status,past_due}')::int = 1
   and (current_setting('x.o')::jsonb#>>'{subscribers,by_status,cancelled}')::int = 1 and (current_setting('x.o')::jsonb#>>'{subscribers,by_status,expired}')::int = 1
   and (current_setting('x.o')::jsonb#>>'{subscribers,by_status,other}')::int = 0, 'status counts: 5 people = 2 active, 1 past due, 1 cancelled, 1 expired');
select pg_temp.chk(3, (current_setting('x.o')::jsonb#>>'{subscribers,ending_soon}')::int = 1 and (current_setting('x.o')::jsonb#>>'{subscribers,cancel_at_period_end}')::int = 1, 'ending soon = 1 (active, within 7 days); cancel-at-period-end = 1');
select pg_temp.chk(4, (select (e->>'label' = 'Pro' and (e->>'active')::int = 1 and (e->>'past_due')::int = 1 and (e->>'ended')::int = 1) from jsonb_array_elements(current_setting('x.o')::jsonb->'by_plan') e where e->>'plan' = 'pro')
   and (select (e->>'label' = 'Legacy' and (e->>'ended')::int = 1) from jsonb_array_elements(current_setting('x.o')::jsonb->'by_plan') e where e->>'plan' = 'legacy'), 'by plan: names from the plans table, active / past due / ended');
select pg_temp.chk(5, (current_setting('x.o')::jsonb#>>'{revenue_month,allowed}')::boolean = false and not (current_setting('x.o')::jsonb->'revenue_month' ? 'kobo'), 'revenue hidden without subscriptions.revenue.view (no number at all)');
select pg_temp.chk(6, (current_setting('x.o')::jsonb#>>'{payments,allowed}')::boolean = false and not (current_setting('x.o')::jsonb->'payments' ? 'needs_review'), 'payment counts hidden without subscriptions.payments.view');
select pg_temp.chk(7, (current_setting('x.o')::jsonb#>>'{card_authorizations,exists}')::boolean and (current_setting('x.o')::jsonb#>>'{card_authorizations,rows}')::int = 2, 'card authorizations: only a row count (2), flagged for rule R-C');
select set_config('x.pl', public.admin_subscription_plans()::text, false);
select pg_temp.chk(8, jsonb_array_length(current_setting('x.pl')::jsonb->'items') = 3 and current_setting('x.pl')::jsonb#>>'{items,0,plan}' = 'legacy' and current_setting('x.pl')::jsonb#>>'{items,2,plan}' = 'premium', 'plans: three, cheapest first');
select pg_temp.chk(9, (select (e->>'price_kobo')::bigint = 300000 and (e->>'offers_per_month')::int = 20 and (e->>'listing_limit')::int = 10 and e->>'membership_label' = 'PRO'
   and (e->>'active')::int = 1 and (e->>'past_due')::int = 1 and (e->>'ended')::int = 1 and (e->>'is_active')::boolean from jsonb_array_elements(current_setting('x.pl')::jsonb->'items') e where e->>'plan' = 'pro'), 'Pro plan: stored price, allowance, limit, label and people on it');
select pg_temp.chk(10, (select not (e->>'is_active')::boolean from jsonb_array_elements(current_setting('x.pl')::jsonb->'items') e where e->>'plan' = 'legacy'), 'inactive plan shown as inactive');
-- subscribers
select set_config('x.l', public.admin_subscriber_list(null,'all',0)::text, false);
select pg_temp.chk(11, (current_setting('x.l')::jsonb->>'total')::int = 5 and jsonb_array_length(current_setting('x.l')::jsonb->'items') = 5, 'list: 5 people');
select pg_temp.chk(12, current_setting('x.l')::jsonb#>>'{items,0,name}' = 'Chi Nwosu' and current_setting('x.l')::jsonb#>>'{items,1,name}' = 'Ada Okoro' and current_setting('x.l')::jsonb#>>'{items,2,name}' = 'Bola Ade', 'live plans first, soonest end first (past due, then 3 days, then 20 days); ended ones last');
select pg_temp.chk(13, (select count(*) from jsonb_array_elements(current_setting('x.l')::jsonb->'items') e where e->>'status' in ('cancelled','expired')) = 2 and current_setting('x.l')::jsonb#>>'{items,3,status}' in ('cancelled','expired'), 'ended last');
select pg_temp.chk(14, (public.admin_subscriber_list(null,'ended',0)->>'total')::int = 2 and (public.admin_subscriber_list(null,'active',0)->>'total')::int = 2 and (public.admin_subscriber_list(null,'past_due',0)->>'total')::int = 1
   and (public.admin_subscriber_list(null,'ending_soon',0)->>'total')::int = 1 and (public.admin_subscriber_list(null,'cancel_at_end',0)->>'total')::int = 1, 'status filters');
select pg_temp.chk(15, (public.admin_subscriber_list('ada',null,0)->>'total')::int = 1 and (public.admin_subscriber_list('  OKORO ',null,0)->>'total')::int = 1 and (public.admin_subscriber_list('00000000-0000-0000-0000-000000000003',null,0)->>'total')::int = 1, 'search by name (any case) and by user id');
select pg_temp.chk(16, (public.admin_subscriber_list('%',null,0)->>'total')::int = 0 and (public.admin_subscriber_list('_',null,0)->>'total')::int = 0, 'a % or _ in the search is literal, not a wildcard');
select pg_temp.chk(17, (public.admin_subscriber_list('ada@example.com',null,0)->>'total')::int = 0, 'email is not searchable and not returned');
select pg_temp.chk(18, public.admin_subscriber_list(null,'all',3)->>'offset' = '3' and jsonb_array_length(public.admin_subscriber_list(null,'all',3)->'items') = 2 and jsonb_array_length(public.admin_subscriber_list(null,'all',25)->'items') = 0, 'paging by offset, empty past the end');
select pg_temp.chk(19, (public.admin_subscriber_list(null,'bogus',-4)->>'status') = 'all' and (public.admin_subscriber_list(null,'all',-4)->>'offset') = '0', 'bad status becomes all; negative offset becomes 0');
select pg_temp.chk(20, (select (e->>'plan_label' = 'Pro' and (e->>'days_left')::int between 2 and 3 and (e->>'cancel_at_period_end')::boolean) from jsonb_array_elements(current_setting('x.l')::jsonb->'items') e where e->>'name' = 'Ada Okoro')
   and (select e->>'pending_plan' = 'pro' from jsonb_array_elements(current_setting('x.l')::jsonb->'items') e where e->>'name' = 'Bola Ade'), 'row fields: plan label, days left, cancel-at-period-end, pending plan');
-- detail (view only: no receipts)
select set_config('x.d', public.admin_subscriber_detail('00000000-0000-0000-0000-000000000001')::text, false);
select pg_temp.chk(21, (current_setting('x.d')::jsonb->>'ok')::boolean and current_setting('x.d')::jsonb#>>'{subscription,plan_label}' = 'Pro' and current_setting('x.d')::jsonb->>'name' = 'Ada Okoro', 'detail: person and plan');
select pg_temp.chk(22, (current_setting('x.d')::jsonb->>'receipts_allowed')::boolean = false and current_setting('x.d')::jsonb->'receipts' = 'null'::jsonb, 'detail without payments permission: no receipts, no amounts');
select pg_temp.chk(23, jsonb_array_length(current_setting('x.d')::jsonb->'timeline') = 4 and current_setting('x.d')::jsonb#>>'{timeline,0,kind}' = 'payment_applied', 'timeline: 3 events + 1 admin entry, newest first');
select pg_temp.chk(24, (select length(e->>'note') = 300 from jsonb_array_elements(current_setting('x.d')::jsonb->'timeline') e where e->>'kind' = 'renewal_notice_sent'), 'long note cut to 300 characters');
select pg_temp.chk(25, (select (e->>'has_approval')::boolean from jsonb_array_elements(current_setting('x.d')::jsonb->'timeline') e where e->>'src' = 'admin')
   and (select not (e->>'has_approval')::boolean from jsonb_array_elements(public.admin_subscriber_detail('00000000-0000-0000-0000-000000000002')->'timeline') e where e->>'src' = 'admin'), 'admin entry says whether an approval id was recorded');
select pg_temp.chk(26, (public.admin_subscriber_detail('00000000-0000-0000-0000-0000000000ff')->>'ok')::boolean = false and (public.admin_subscriber_detail(null)->>'ok')::boolean = false, 'unknown or missing person: ok false');
-- audit
select set_config('x.a', public.admin_subscription_audit('all',0)::text, false);
select pg_temp.chk(27, (current_setting('x.a')::jsonb->>'total')::int = 6 and (public.admin_subscription_audit('admin',0)->>'total')::int = 2 and (public.admin_subscription_audit('event',0)->>'total')::int = 4, 'audit: 6 = 2 admin + 4 events');
select pg_temp.chk(28, (select bool_and(e->>'at' >= lag_at) from (select e, lag(e->>'at', 1, '0') over () as lag_at from jsonb_array_elements(current_setting('x.a')::jsonb->'items') e) q(e, lag_at)) is not null
   and current_setting('x.a')::jsonb#>>'{items,0,at}' > current_setting('x.a')::jsonb#>>'{items,5,at}', 'audit newest first');
select pg_temp.chk(29, (public.admin_subscription_audit('bogus',-1)->>'source') = 'all' and (public.admin_subscription_audit('bogus',-1)->>'offset') = '0', 'bad source / offset fall back');
select pg_temp.chk(30, length(current_setting('x.a')) > 0 and (select bool_and(length(coalesce(e->>'actor','')) <= 8) from jsonb_array_elements(current_setting('x.a')::jsonb->'items') e), 'actor shown as a short id only');
-- payments need their own permission
do $$ begin
  begin perform public.admin_subscription_payments('review'); perform pg_temp.chk(31, false, 'payments refused with subscriptions.view only'); exception when sqlstate '42501' then perform pg_temp.chk(31, true, 'payments refused with subscriptions.view only'); end;
end $$;
-- full permissions
set app.perm = 'subscriptions.view,subscriptions.payments.view,subscriptions.revenue.view';
select set_config('x.o2', public.admin_subscriptions_overview()::text, false);
select pg_temp.chk(32, (current_setting('x.o2')::jsonb#>>'{revenue_month,kobo}')::bigint = 1300000 and (current_setting('x.o2')::jsonb#>>'{revenue_month,rows}')::int = 3, 'revenue this Lagos month = 1300000 kobo (3 paid receipts; last month and unpaid excluded)');
select pg_temp.chk(33, (current_setting('x.o2')::jsonb#>>'{payments,needs_review}')::int = 2 and (current_setting('x.o2')::jsonb#>>'{payments,not_completed}')::int = 2, 'needs review = 2, not completed = 2');
select set_config('x.r', public.admin_subscription_payments('review',0)::text, false);
select pg_temp.chk(34, (current_setting('x.r')::jsonb->>'total')::int = 2 and (select bool_or(e->>'reference' = 'PAY-9' and (e->>'amount_kobo')::bigint = 300000 and e->>'reason' like 'Paid, but no receipt%') from jsonb_array_elements(current_setting('x.r')::jsonb->'items') e), 'review: paid with no receipt; naira converted to kobo (3000 -> 300000)');
select pg_temp.chk(35, (select bool_or(e->>'reference' = 'PAY-4' and e->>'reason' like '%no subscription row%' and e->>'name' = 'Dayo Bello') from jsonb_array_elements(current_setting('x.r')::jsonb->'items') e), 'review: paid receipt for a person with no subscription row');
select pg_temp.chk(36, not exists (select 1 from jsonb_array_elements(current_setting('x.r')::jsonb->'items') e where e->>'reference' in ('JOB-1','TU-1','PAY-1')), 'job and coordinator-plan payments are not here; a matched payment is not flagged');
select set_config('x.n', public.admin_subscription_payments('not_paid',0)::text, false);
select pg_temp.chk(37, (current_setting('x.n')::jsonb->>'total')::int = 2 and (select bool_or(e->>'reference' = 'PAY-8' and e->>'reason' = 'Still pending after a day.') from jsonb_array_elements(current_setting('x.n')::jsonb->'items') e)
   and (select bool_or(e->>'reference' = 'PAY-7' and e->>'status' = 'failed') from jsonb_array_elements(current_setting('x.n')::jsonb->'items') e), 'not completed: failed and pending, status as stored');
select set_config('x.rc', public.admin_subscription_payments('receipts',0)::text, false);
select pg_temp.chk(38, (current_setting('x.rc')::jsonb->>'total')::int = 4 and (current_setting('x.rc')::jsonb->>'total_kobo')::bigint = 1600000 and (current_setting('x.rc')::jsonb#>>'{counts,receipts}')::int = 4 and (current_setting('x.rc')::jsonb#>>'{counts,review}')::int = 2 and (current_setting('x.rc')::jsonb#>>'{counts,not_paid}')::int = 2, 'receipts: 4 paid (unpaid receipt skipped), 1600000 kobo; counts for every tab');
select pg_temp.chk(39, (public.admin_subscription_payments('bogus',-9)->>'filter') = 'review' and (public.admin_subscription_payments('bogus',-9)->>'offset') = '0', 'bad filter or offset fall back');
select set_config('x.d2', public.admin_subscriber_detail('00000000-0000-0000-0000-000000000001')::text, false);
select pg_temp.chk(40, (current_setting('x.d2')::jsonb->>'receipts_allowed')::boolean and jsonb_array_length(current_setting('x.d2')::jsonb->'receipts') = 2 and (current_setting('x.d2')::jsonb#>>'{receipts,0,amount_kobo}')::bigint = 300000, 'detail with payments permission: 2 receipts, newest first');
select set_config('x.d4', public.admin_subscriber_detail('00000000-0000-0000-0000-000000000004')::text, false);
select pg_temp.chk(41, (current_setting('x.d4')::jsonb->>'ok')::boolean and current_setting('x.d4')::jsonb->'subscription' = 'null'::jsonb and jsonb_array_length(current_setting('x.d4')::jsonb->'receipts') = 1, 'person with a receipt but no subscription row still opens');
-- nothing secret anywhere
select pg_temp.chk(42, (current_setting('x.o2') || current_setting('x.pl') || current_setting('x.l') || current_setting('x.d2') || current_setting('x.a') || current_setting('x.r') || current_setting('x.n') || current_setting('x.rc')) !~* 'AUTH_SECRET|authorization_code|4081|@example\.com',
   'no authorization code, card digits or email in any output');
-- permission refusals for each browser function
set app.perm = 'transactions.view';
do $$ begin
  begin perform public.admin_subscriptions_overview(); perform pg_temp.chk(43, false, 'overview refused'); exception when sqlstate '42501' then perform pg_temp.chk(43, true, 'overview refused without permission'); end;
  begin perform public.admin_subscription_plans(); perform pg_temp.chk(44, false, 'plans refused'); exception when sqlstate '42501' then perform pg_temp.chk(44, true, 'plans refused without permission'); end;
  begin perform public.admin_subscriber_list(); perform pg_temp.chk(45, false, 'list refused'); exception when sqlstate '42501' then perform pg_temp.chk(45, true, 'list refused without permission'); end;
  begin perform public.admin_subscriber_detail('00000000-0000-0000-0000-000000000001'); perform pg_temp.chk(46, false, 'detail refused'); exception when sqlstate '42501' then perform pg_temp.chk(46, true, 'detail refused without permission'); end;
  begin perform public.admin_subscription_payments(); perform pg_temp.chk(47, false, 'payments refused'); exception when sqlstate '42501' then perform pg_temp.chk(47, true, 'payments refused without permission'); end;
  begin perform public.admin_subscription_audit(); perform pg_temp.chk(48, false, 'audit refused'); exception when sqlstate '42501' then perform pg_temp.chk(48, true, 'audit refused without permission'); end;
  set local app.perm = '';
  begin perform public.admin_subscriptions_overview(); perform pg_temp.chk(49, false, 'empty permission refused'); exception when sqlstate '42501' then perform pg_temp.chk(49, true, 'refused with no permission at all'); end;
end $$;
select pg_temp.chk(50, not has_function_privilege('authenticated','public._a18_subs()','execute') and not has_function_privilege('authenticated','public._a18_pay_rows()','execute') and not has_function_privilege('authenticated','public._a18_events()','execute')
   and not has_function_privilege('anon','public.admin_subscriptions_overview()','execute') and has_function_privilege('authenticated','public.admin_subscriptions_overview()','execute')
   and has_function_privilege('authenticated','public.admin_subscription_audit(text,integer)','execute'), 'grants: helpers closed, anon closed, authenticated open');
select pg_temp.chk(51, (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m')) = 8, 'A18 created no table or view (8 stand-in tables only)');
select pg_temp.chk(52, (select count(*) from public.subscriptions) = 5 and (select count(*) from public.subscription_receipts) = 5 and (select count(*) from public.payment_intents) = 9 and (select count(*) from public.subscription_admin_log) = 2, 'no data changed');
-- optional tables missing: still answers, never errors
set app.perm = 'subscriptions.view,subscriptions.payments.view,subscriptions.revenue.view';
drop table public.subscription_events; drop table public.subscription_admin_log; drop table public.subscription_plans; drop table public.subscription_receipts; drop table public.subscription_card_authorizations;
select set_config('x.m', public.admin_subscriptions_overview()::text, false);
select pg_temp.chk(53, (current_setting('x.m')::jsonb->>'ok')::boolean and (current_setting('x.m')::jsonb#>>'{card_authorizations,exists}')::boolean = false and (current_setting('x.m')::jsonb#>>'{revenue_month,kobo}')::bigint = 0 and (current_setting('x.m')::jsonb#>>'{subscribers,total}')::int = 5, 'missing optional tables: overview still works, zero revenue, no card table reported');
select pg_temp.chk(54, (public.admin_subscription_plans()->>'available')::boolean = false and (public.admin_subscription_audit()->>'total')::int = 0 and (public.admin_subscriber_detail('00000000-0000-0000-0000-000000000001')->>'ok')::boolean, 'missing plans / events / log tables: plans say not available, audit empty, detail still opens');
select n, case when ok then 'PASS' else 'FAIL' end r, t from res order by n;
select count(*) filter (where not ok) as failures, count(*) as total from res;

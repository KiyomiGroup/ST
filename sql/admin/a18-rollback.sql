-- Rollback for stage A18 (Subscriptions, read only). Safe to run twice. Drops only the functions A18 added. No table or data is touched.
drop function if exists public.admin_subscriptions_overview();
drop function if exists public.admin_subscription_plans();
drop function if exists public.admin_subscriber_list(text, text, integer);
drop function if exists public.admin_subscriber_detail(uuid);
drop function if exists public.admin_subscription_payments(text, integer);
drop function if exists public.admin_subscription_audit(text, integer);
drop function if exists public._a18_pay_rows();
drop function if exists public._a18_events();
drop function if exists public._a18_receipts();
drop function if exists public._a18_plans();
drop function if exists public._a18_subs();
drop function if exists public._a18_like(text);
drop function if exists public._a18_bool(text);
drop function if exists public._a18_bigint(text);
drop function if exists public._a18_ts(text);
drop function if exists public._a18_pick(jsonb, text[]);
select 'ROLLED BACK: A18 functions removed.' as a18_rollback;

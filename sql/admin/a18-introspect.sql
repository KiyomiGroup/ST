-- StreetTasker Admin, stage A18: read-only look at the real subscription tables. Writes nothing. Run the WHOLE file and send me the result of each block.
-- It lists column names and types, row counts and the plan rows. It never selects authorization_code, card details, email or phone.

-- 1. Columns of every subscription table
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('subscriptions','subscription_plans','subscription_receipts','subscription_events','subscription_admin_log',
                      'subscription_payment_details','subscription_settings','subscription_card_authorizations','offer_credits','offer_usage')
 order by table_name, ordinal_position;

-- 2. Row counts
select 'subscriptions' t, count(*) from public.subscriptions
union all select 'subscription_plans', count(*) from public.subscription_plans
union all select 'subscription_receipts', count(*) from public.subscription_receipts
union all select 'subscription_events', count(*) from public.subscription_events
union all select 'subscription_admin_log', count(*) from public.subscription_admin_log
union all select 'subscription_card_authorizations', count(*) from public.subscription_card_authorizations;

-- 3. The plans as stored (no personal data in this table)
select * from public.subscription_plans;

-- 4. Distinct statuses and kinds in use
select 'subscriptions.status' k, status::text v, count(*) from public.subscriptions group by 2
union all select 'receipts.kind', kind::text, count(*) from public.subscription_receipts group by 2
union all select 'payment_intents(subscription).status', status::text, count(*) from public.payment_intents where purpose = 'subscription' group by 2;

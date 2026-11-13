-- StreetTasker Admin, stage A18 follow-up: the SAME look as a18-introspect.sql, but as ONE query so the Supabase editor
-- shows everything (the editor only shows the last result of a file; your CSV held only block 4).
-- READ ONLY. Never selects authorization_code, card details, email or phone. The plans table holds no personal data.
-- Send the CSV of the result. Columns: part, k, v.

select 'columns' as part, c.table_name || '.' || c.column_name as k, c.data_type as v
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in ('subscriptions','subscription_plans','subscription_receipts','subscription_events','subscription_admin_log',
                        'subscription_payment_details','subscription_settings','subscription_card_authorizations','offer_credits','offer_usage')
union all select 'rows', 'subscriptions', count(*)::text from public.subscriptions
union all select 'rows', 'subscription_plans', count(*)::text from public.subscription_plans
union all select 'rows', 'subscription_receipts', count(*)::text from public.subscription_receipts
union all select 'rows', 'subscription_events', count(*)::text from public.subscription_events
union all select 'rows', 'subscription_admin_log', count(*)::text from public.subscription_admin_log
union all select 'rows', 'subscription_card_authorizations', count(*)::text from public.subscription_card_authorizations
union all select 'plan', 'row ' || row_number() over (), to_jsonb(p)::text from public.subscription_plans p
union all select 'status', 'subscriptions.status=' || status::text, count(*)::text from public.subscriptions group by status
union all select 'status', 'receipts.kind=' || kind::text, count(*)::text from public.subscription_receipts group by kind
union all select 'status', 'payment_intents(subscription).status=' || status::text, count(*)::text from public.payment_intents where purpose = 'subscription' group by status
order by 1, 2;

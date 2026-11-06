-- M19 phone notifications verify (read only). Every row should say PASS (the last row says INFO).
select 'push_subscriptions exists and browsers cannot read or write it directly' as check,
       case when to_regclass('public.push_subscriptions') is not null
             and not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT')
             and not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
             and not has_table_privilege('anon', 'public.push_subscriptions', 'SELECT') then 'PASS' else 'FAIL' end as result
union all select 'save and remove functions: signed-in only',
       case when has_function_privilege('authenticated', 'public.push_save_subscription(text,text,text,text)', 'EXECUTE')
             and has_function_privilege('authenticated', 'public.push_remove_subscription(text)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.push_save_subscription(text,text,text,text)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.push_remove_subscription(text)', 'EXECUTE') then 'PASS' else 'FAIL' end
union all select 'INFO devices saved so far: ' || (select count(*) from public.push_subscriptions), 'INFO';

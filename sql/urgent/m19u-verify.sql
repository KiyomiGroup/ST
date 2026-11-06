-- M19 urgent verify (read only). Every row should say PASS (the last row says INFO).
select 'urgent_payments exists and browsers cannot touch it' as check,
       case when to_regclass('public.urgent_payments') is not null
             and not has_table_privilege('authenticated', 'public.urgent_payments', 'SELECT')
             and not has_table_privilege('authenticated', 'public.urgent_payments', 'INSERT')
             and not has_table_privilege('anon', 'public.urgent_payments', 'SELECT') then 'PASS' else 'FAIL' end as result
union all select 'guard trigger on tasks exists',
       case when exists (select 1 from pg_trigger where tgname = 'zz_m19_urgent_guard' and not tgisinternal) then 'PASS' else 'FAIL' end
union all select 'claim function can be run by signed-in people only',
       case when has_function_privilege('authenticated', 'public._m19_urgent_claim(text,text)', 'EXECUTE')
             and not has_function_privilege('anon', 'public._m19_urgent_claim(text,text)', 'EXECUTE') then 'PASS' else 'FAIL' end
union all select 'INFO verified urgent payments so far: ' || (select count(*) from public.urgent_payments), 'INFO';

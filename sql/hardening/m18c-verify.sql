-- M18 step C verify (read only). Every row should say PASS (the last row says INFO, that is normal).
select 'report_contact_violation exists and only signed-in people can run it' as check,
       case when to_regprocedure('public.report_contact_violation()') is not null
             and has_function_privilege('authenticated', 'public.report_contact_violation()', 'EXECUTE')
             and not has_function_privilege('anon', 'public.report_contact_violation()', 'EXECUTE') then 'PASS' else 'FAIL' end as result
union all select 'users guard covers the violation and flag columns',
       case when pg_get_functiondef('public._m18_users_guard()'::regprocedure) like '%contact_violations%' then 'PASS' else 'FAIL' end
union all select 'browsers cannot write verifications (they can still read their own)',
       case when to_regclass('public.verifications') is null then 'PASS'
            when has_table_privilege('authenticated', 'public.verifications', 'INSERT') or has_table_privilege('authenticated', 'public.verifications', 'UPDATE')
              or has_table_privilege('authenticated', 'public.verifications', 'DELETE') then 'FAIL'
            when has_table_privilege('authenticated', 'public.verifications', 'SELECT') then 'PASS' else 'FAIL' end
union all select 'INFO step C permissions removed: ' || (select count(*) from public._m18_revoked where step = 'C'), 'INFO';

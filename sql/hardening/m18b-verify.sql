-- M18 step B verify (read only). Every row should say PASS.
select 'anon has no INSERT, UPDATE or DELETE on any public table' as check,
       case when exists (select 1 from pg_class c, unnest(array['INSERT','UPDATE','DELETE']) p
                          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and has_table_privilege('anon', c.oid, p)) then 'FAIL' else 'PASS' end as result
union all select '_policy_backup_steps is closed to anon and signed-in users',
       case when to_regclass('public._policy_backup_steps') is null then 'PASS'
            when has_table_privilege('anon', 'public._policy_backup_steps', 'SELECT') or has_table_privilege('authenticated', 'public._policy_backup_steps', 'SELECT')
              or has_table_privilege('authenticated', 'public._policy_backup_steps', 'INSERT') then 'FAIL' else 'PASS' end
union all select 'guard triggers exist on taskers, services, users',
       case when (select count(*) from pg_trigger where tgname in ('zz_m18_taskers_guard','zz_m18_services_guard','zz_m18_users_guard') and not tgisinternal) = 3 then 'PASS' else 'FAIL' end
union all select 'signed-in people can still write their own rows (grants kept)',
       case when has_table_privilege('authenticated', 'public.users', 'UPDATE') and has_table_privilege('authenticated', 'public.taskers', 'UPDATE')
             and has_table_privilege('authenticated', 'public.services', 'UPDATE') and has_table_privilege('authenticated', 'public.tasks', 'UPDATE')
             and has_table_privilege('authenticated', 'public.messages', 'INSERT') then 'PASS' else 'FAIL' end
union all select 'INFO step B permissions removed: ' || (select count(*) from public._m18_revoked where step = 'B'), 'INFO';

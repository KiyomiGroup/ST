-- M18 verify (read only). Every row should say PASS.
select 'nobody signed in or out can TRUNCATE any public table' as check,
       case when exists (select 1 from pg_class c, unnest(array['anon','authenticated']) r
                          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and has_table_privilege(r, c.oid, 'TRUNCATE')) then 'FAIL' else 'PASS' end as result
union all select 'no REFERENCES or TRIGGER for browsers',
       case when exists (select 1 from pg_class c, unnest(array['anon','authenticated']) r, unnest(array['REFERENCES','TRIGGER']) p
                          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and has_table_privilege(r, c.oid, p)) then 'FAIL' else 'PASS' end
union all select 'no DELETE on bookings, tasks, users, taskers for browsers',
       case when exists (select 1 from unnest(array['bookings','tasks','users','taskers']) t, unnest(array['anon','authenticated']) r
                          where has_table_privilege(r, ('public.' || t)::regclass, 'DELETE')) then 'FAIL' else 'PASS' end
union all select 'a signed-in owner can still delete their own service (row rules decide which)',
       case when has_table_privilege('authenticated', 'public.services', 'DELETE') then 'PASS' else 'FAIL' end
union all select 'anon cannot delete services', case when not has_table_privilege('anon', 'public.services', 'DELETE') then 'PASS' else 'FAIL' end
union all select 'signed-in people can still insert and update bookings, tasks, services (the pages need it)',
       case when has_table_privilege('authenticated', 'public.bookings', 'UPDATE') and has_table_privilege('authenticated', 'public.tasks', 'INSERT')
             and has_table_privilege('authenticated', 'public.services', 'UPDATE') then 'PASS' else 'FAIL' end
union all select 'INFO permissions removed: ' || (select count(*) from public._m18_revoked), 'INFO';

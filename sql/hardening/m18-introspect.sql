-- M18 step 1 (READ ONLY): shows what browsers and anonymous visitors may do on your tables. Run it, export the 3 rows as CSV, send it to me.
select 'grants' as kind,
       coalesce(string_agg(grantee || ' ' || table_name || ' ' || privilege_type, E'\n' order by table_name, grantee, privilege_type), '') as detail
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
union all
select 'policies',
       coalesce(string_agg(tablename || ' | ' || policyname || ' | ' || cmd || ' | roles=' || array_to_string(roles, ',') || ' | using=' || coalesce(qual, '-') || ' | check=' || coalesce(with_check, '-'), E'\n' order by tablename, cmd, policyname), '')
  from pg_policies where schemaname = 'public' and tablename in ('bookings', 'tasks', 'services', 'users', 'taskers')
union all
select 'column_grants',
       coalesce(string_agg(grantee || ' ' || table_name || '.' || column_name || ' ' || privilege_type, E'\n' order by table_name, column_name), '')
  from information_schema.column_privileges
 where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')
   and table_name in ('bookings', 'tasks', 'services', 'users', 'taskers');

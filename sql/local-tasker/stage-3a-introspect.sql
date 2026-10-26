-- Stage 3A introspect: read-only. One query, one row per section.
-- Run in the Supabase SQL editor, then Export > Download CSV.
select 'columns' as section,
       coalesce(jsonb_agg(jsonb_build_object(
         'table', c.table_name, 'col', c.column_name, 'type', c.data_type,
         'nullable', c.is_nullable, 'default', c.column_default)
         order by c.table_name, c.ordinal_position), '[]'::jsonb)::text as result
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('coordinators', 'coordinator_assignments', 'local_tasker_profiles')
union all
select 'functions',
       coalesce(jsonb_agg(jsonb_build_object(
         'name', p.proname,
         'args', pg_get_function_identity_arguments(p.oid),
         'returns', pg_get_function_result(p.oid),
         'security_definer', p.prosecdef,
         'anon_can_run', has_function_privilege('anon', p.oid, 'execute'),
         'signed_in_can_run', has_function_privilege('authenticated', p.oid, 'execute'),
         'service_can_run', has_function_privilege('service_role', p.oid, 'execute'))
         order by p.proname), '[]'::jsonb)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like '%coordinator%' or p.proname like 'local_tasker%')
union all
select 'policies',
       coalesce(jsonb_agg(jsonb_build_object(
         'table', tablename, 'policy', policyname, 'cmd', cmd,
         'roles', roles, 'using', qual, 'check', with_check)
         order by tablename, policyname), '[]'::jsonb)::text
from pg_policies
where schemaname = 'public'
  and tablename in ('coordinators', 'coordinator_assignments', 'local_tasker_profiles')
union all
select 'client_grants',
       coalesce(jsonb_agg(jsonb_build_object(
         'table', table_name, 'role', grantee, 'privilege', privilege_type)
         order by table_name, grantee, privilege_type), '[]'::jsonb)::text
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('coordinators', 'coordinator_assignments', 'local_tasker_profiles')
  and grantee in ('anon', 'authenticated')
union all
select 'coordinator_rows',
       coalesce(jsonb_agg(to_jsonb(co)), '[]'::jsonb)::text
from public.coordinators co;

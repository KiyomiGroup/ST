-- Stage 4A-2 introspect: read-only. One query, one row per section.
-- Run in the Supabase SQL editor, then Export > Download CSV.
select 'consent_columns' as section,
       coalesce(jsonb_agg(jsonb_build_object(
         'col', c.column_name, 'type', c.data_type, 'nullable', c.is_nullable, 'default', c.column_default)
         order by c.ordinal_position), '[]'::jsonb)::text as result
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'local_tasker_consents'
union all
select 'check_constraints',
       coalesce(jsonb_agg(jsonb_build_object(
         'table', cl.relname, 'name', con.conname, 'definition', pg_get_constraintdef(con.oid))
         order by cl.relname, con.conname), '[]'::jsonb)::text
from pg_constraint con
join pg_class cl on cl.oid = con.conrelid
join pg_namespace n on n.oid = cl.relnamespace
where n.nspname = 'public' and con.contype = 'c'
  and cl.relname in ('local_tasker_consents', 'local_tasker_profiles', 'coordinator_assignments')
union all
select 'consent_policies_and_grants',
       jsonb_build_object(
         'policies', coalesce((select jsonb_agg(jsonb_build_object('policy', policyname, 'cmd', cmd, 'roles', roles, 'using', qual))
                               from pg_policies where schemaname = 'public' and tablename = 'local_tasker_consents'), '[]'::jsonb),
         'client_grants', coalesce((select jsonb_agg(jsonb_build_object('role', grantee, 'privilege', privilege_type))
                               from information_schema.role_table_grants
                               where table_schema = 'public' and table_name = 'local_tasker_consents'
                                 and grantee in ('anon', 'authenticated')), '[]'::jsonb))::text;

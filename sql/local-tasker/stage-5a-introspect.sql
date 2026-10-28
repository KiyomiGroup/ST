-- Stage 5A introspect: READ-ONLY. One query, one row per section. Changes nothing.
-- Run in the Supabase SQL editor (paste all, Run), then Export > Download CSV and upload the CSV.
-- Covers the booking tables and everything that touches them, so 5A can be written against the real schema.
with t as (
  select c.oid, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (c.relname ilike '%booking%' or c.relname in ('payments','payment','escrow','escrows','transactions','wallets','wallet_transactions','notifications','reviews'))
)
select 'tables' as section, coalesce((select jsonb_agg(relname order by relname) from t), '[]'::jsonb)::text as result
union all
select 'columns', coalesce(jsonb_agg(jsonb_build_object('table', c.table_name, 'col', c.column_name, 'type', c.data_type,
         'nullable', c.is_nullable, 'default', c.column_default) order by c.table_name, c.ordinal_position), '[]'::jsonb)::text
from information_schema.columns c where c.table_schema = 'public' and c.table_name in (select relname from t)
union all
select 'constraints', coalesce(jsonb_agg(jsonb_build_object('table', cl.relname, 'name', con.conname, 'type', con.contype,
         'definition', pg_get_constraintdef(con.oid)) order by cl.relname, con.conname), '[]'::jsonb)::text
from pg_constraint con join pg_class cl on cl.oid = con.conrelid where con.conrelid in (select oid from t)
union all
select 'triggers', coalesce(jsonb_agg(jsonb_build_object('table', cl.relname, 'name', tg.tgname,
         'definition', pg_get_triggerdef(tg.oid)) order by cl.relname, tg.tgname), '[]'::jsonb)::text
from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid where tg.tgrelid in (select oid from t) and not tg.tgisinternal
union all
select 'policies', coalesce(jsonb_agg(jsonb_build_object('table', p.tablename, 'policy', p.policyname, 'cmd', p.cmd,
         'permissive', p.permissive, 'roles', p.roles, 'using', p.qual, 'check', p.with_check) order by p.tablename, p.policyname), '[]'::jsonb)::text
from pg_policies p where p.schemaname = 'public' and p.tablename in (select relname from t)
union all
select 'client_grants', coalesce(jsonb_agg(jsonb_build_object('table', g.table_name, 'role', g.grantee, 'privilege', g.privilege_type)
         order by g.table_name, g.grantee, g.privilege_type), '[]'::jsonb)::text
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.table_name in (select relname from t) and g.grantee in ('anon', 'authenticated')
union all
select 'booking_status_counts', coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'n', s.n) order by s.n desc), '[]'::jsonb)::text
from (select status::text as status, count(*) as n from public.bookings group by 1) s
union all
-- functions that mention bookings: signature, security mode and full source (read for money / release / escrow rules)
select 'functions_touching_bookings', coalesce(jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
         'security_definer', p.prosecdef, 'source', p.prosrc) order by p.proname), '[]'::jsonb)::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ilike '%booking%'
  and p.proname not like 'local\_tasker\_%' and p.proname not like '\_local\_tasker\_%';

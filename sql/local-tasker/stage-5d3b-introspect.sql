-- Stage 5D-3b introspect: READ-ONLY. One query, one row per item (about 30 rows, well under the 100-row editor limit). Changes nothing.
-- How to run: Supabase > SQL Editor > New query > paste ALL of this > Run > "Export" > "Download CSV" > upload the CSV here.
-- Why: 5D-3b (coordinator cancel, problem report on behalf of a Local Tasker) must copy what the real job_cancel and
-- open_job_dispute do, and must not trip the guard trigger on bookings. Their source was not in the last CSV.
with
fn as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and (p.proname in ('job_cancel', 'open_job_dispute', 'withdraw_job_dispute', 'job_booking_frozen', 'support_resolve_dispute',
                        '_settle_after_dispute', '_booking_tasker_user', '_notify')
          or p.oid in (select tg.tgfoid from pg_trigger tg
                        where not tg.tgisinternal
                          and tg.tgrelid in ('public.bookings'::regclass, 'public.job_disputes'::regclass,
                                             'public.payment_requests'::regclass, 'public.job_requests'::regclass)))
),
tb as (select unnest(array['bookings', 'payment_requests', 'job_requests', 'job_disputes']) as t)
select 'function'::text as section, f.proname::text as name,
       ('(' || f.args || ') security_definer=' || f.prosecdef::text || E'\n' || f.prosrc)::text as detail
  from fn f
union all
select 'columns', c.table_name::text,
       jsonb_agg(jsonb_build_object('col', c.column_name, 'type', c.data_type, 'null', c.is_nullable, 'default', c.column_default)
                 order by c.ordinal_position)::text
  from information_schema.columns c where c.table_schema = 'public' and c.table_name in (select t from tb) group by c.table_name
union all
select 'constraints', cl.relname::text, string_agg(con.conname || ': ' || pg_get_constraintdef(con.oid), E'\n' order by con.conname)
  from pg_constraint con join pg_class cl on cl.oid = con.conrelid
 where con.conrelid in (select ('public.' || t)::regclass from tb) and con.contype in ('c', 'u', 'f', 'p')
 group by cl.relname
union all
select 'triggers', cl.relname::text, string_agg(pg_get_triggerdef(tg.oid), E'\n' order by tg.tgname)
  from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid
 where tg.tgrelid in (select ('public.' || t)::regclass from tb) and not tg.tgisinternal group by cl.relname
union all
select 'policies', p.tablename::text,
       string_agg(p.policyname || ' [' || p.cmd || ' ' || coalesce(p.roles::text, '') || '] using ' || coalesce(p.qual, '-') || ' check ' || coalesce(p.with_check, '-'), E'\n' order by p.policyname)
  from pg_policies p where p.schemaname = 'public' and p.tablename in (select t from tb) group by p.tablename
union all
select 'client_grants', g.table_name::text, string_agg(g.grantee || ':' || g.privilege_type, ', ' order by g.grantee, g.privilege_type)
  from information_schema.role_table_grants g
 where g.table_schema = 'public' and g.table_name in (select t from tb) and g.grantee in ('anon', 'authenticated') group by g.table_name
union all
select 'status_counts', 'bookings.status / payment_status',
       coalesce((select jsonb_agg(jsonb_build_object('status', s.status, 'payment_status', s.payment_status, 'n', s.n) order by s.n desc)::text
                   from (select status::text, payment_status::text, count(*) as n from public.bookings group by 1, 2) s), '[]')
union all
select 'status_counts', 'payment_requests.kind / status',
       coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'status', s.status, 'n', s.n) order by s.n desc)::text
                   from (select kind::text, status::text, count(*) as n from public.payment_requests group by 1, 2) s), '[]')
order by 1, 2;

-- Stage 5D-3c INTROSPECT (read-only, one query, one row per section).
-- Run in the Supabase SQL editor, then Export > Download CSV and upload the CSV.
-- Changes nothing. Returns the real source of the Job Room price / refund / extra-cost objects.
with fn as (
  select 'function' as kind, p.proname::text as name,
         pg_get_functiondef(p.oid) as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and ( p.proname in ('price_respond','job_custom_request','job_request_respond',
                        'job_requests_guard','job_money_snapshot','_release_escrow',
                        '_settle_after_dispute','support_resolve_dispute','job_cancel')
          or p.proname ilike '%refund%'
          or p.proname ilike '%price%'
          or p.proname ilike '%add_on%' or p.proname ilike '%addon%' )
),
trg as (
  select 'trigger' as kind, c.relname::text || '.' || t.tgname::text as name,
         pg_get_triggerdef(t.oid) as body
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and c.relname in ('job_requests','payment_requests','escrow_payments','bookings')
),
cons as (
  select 'constraint' as kind, c.conrelid::regclass::text || '.' || c.conname::text as name,
         pg_get_constraintdef(c.oid) as body
  from pg_constraint c
  where c.conrelid in ('public.job_requests'::regclass, 'public.payment_requests'::regclass,
                       'public.escrow_payments'::regclass)
),
cols as (
  select 'columns' as kind, table_name::text as name,
         string_agg(column_name || ' ' || data_type || case when is_nullable='NO' then ' NOT NULL' else '' end,
                    E'\n' order by ordinal_position) as body
  from information_schema.columns
  where table_schema='public' and table_name in ('job_requests','payment_requests','escrow_payments','refunds')
  group by table_name
)
select * from fn
union all select * from trg
union all select * from cons
union all select * from cols
order by kind, name;

-- Stage 7A INTROSPECT (read-only, one query). Run in the Supabase SQL editor, then Export > Download CSV and upload the CSV.
-- Changes nothing. Returns the real source of every function that decides or uses the platform fee, so Part 2 can patch them exactly.
with fn as (
  select 'function' as kind, p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
         pg_get_functiondef(p.oid) as body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and ( p.proname in ('platform_fee_rate','_prepare_intent','_release_escrow','_settle_after_dispute','support_resolve_dispute',
                        'gift_request_settle','gift_hold_capture','gift_hold_create','gift_request_pay_start','gift_request_info')
          or p.prosrc ilike '%platform_fee_rate%' or p.prosrc ilike '%0.12%' or p.prosrc ilike '%0.88%' )
),
cols as (
  select 'columns' as kind, table_name::text as name,
         string_agg(column_name || ' ' || data_type || coalesce(' default ' || column_default, '')
                    || case when is_generated = 'ALWAYS' then ' GENERATED' else '' end, E'\n' order by ordinal_position) as body
  from information_schema.columns
  where table_schema = 'public' and table_name in ('payment_intents','escrow_payments','payments')
  group by table_name
),
trg as (
  select 'trigger' as kind, c.relname::text || '.' || t.tgname::text as name, pg_get_triggerdef(t.oid) as body
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal and c.relname in ('payment_intents','escrow_payments','payments')
)
select * from fn union all select * from cols union all select * from trg order by kind, name;

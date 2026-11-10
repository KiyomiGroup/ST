-- StreetTasker Admin, stage A8 (Regular Taskers): READ-ONLY schema check, version 2. Changes nothing.
-- v2 fix: membership_for_users is a FUNCTION (uuid[] -> jsonb), not a view, so it is now read from pg_proc.
-- Run the whole file in the Supabase SQL editor and paste me the result grid (or download it as CSV and upload it).
select section, detail from (
  select 1 as o, 'COLUMNS ' || c.table_name as section,
         string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as detail
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name not like 'test_archive%'
     and (c.table_name in ('taskers', 'tasker_profiles', 'services', 'task_applications', 'wallets', 'wallet_transactions', 'identity_verifications', 'tasks', 'subscriptions', 'reviews', 'admin_account_flags')
          or c.table_name ilike 'idv%' or c.table_name ilike '%withdraw%' or c.table_name ilike '%payout%')
   group by c.table_name
  union all
  select 2, 'TRIGGER ' || event_object_table || '.' || trigger_name, action_timing || ' ' || event_manipulation
    from information_schema.triggers
   where trigger_schema = 'public' and event_object_table in ('taskers', 'tasker_profiles', 'services')
  union all
  select 3, 'COUNTS',
         'taskers=' || (select count(*) from public.taskers)
         || ', services=' || (select count(*) from public.services)
         || ', users with tasker role=' || (select count(*) from public.users where role = 'tasker')
  union all
  select 4, 'FUNCTION ' || p.proname,
         'args (' || pg_get_function_identity_arguments(p.oid) || ') returns ' || pg_get_function_result(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('membership_for_users', 'platform_fee_rate')
  union all
  select 5, 'MISSING TABLES',
         coalesce((select string_agg(t, ', ') from unnest(array['taskers','tasker_profiles','services','task_applications','wallets','wallet_transactions','identity_verifications','reviews','admin_account_flags']) t
                    where to_regclass('public.' || t) is null), '(none missing)')
) t order by o, section;

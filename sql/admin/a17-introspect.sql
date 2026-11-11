-- StreetTasker Admin, stage A17 (Earnings and payouts watch): READ-ONLY schema check. Changes nothing.
-- Run the WHOLE file in the Supabase SQL editor, then send me the result grid (or download it as CSV and upload it).
-- It shows only structure, statuses and counts. No names, bank numbers or amounts per person are returned.
select section, detail from (
  select 1 as o, 'COLUMNS ' || c.table_name as section,
         string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as detail
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name not like 'test_archive%'
     and (c.table_name in ('wallets', 'wallet_transactions', 'withdrawals', 'withdrawal_bank_accounts', 'local_payouts', 'local_payout_accounts',
                           'local_payout_runs', 'local_tasker_profiles')
          or c.table_name ilike '%withdraw%' or c.table_name ilike '%payout%')
   group by c.table_name
  union all
  select 2, 'STATUS ' || t.tbl, t.vals from (
    select 'withdrawals' as tbl, string_agg(status || '=' || n, ', ' order by status) as vals
      from (select coalesce(status::text, '(null)') as status, count(*) n from public.withdrawals group by 1) s
  ) t
  union all
  select 2, 'STATUS local_payouts', string_agg(status || '=' || n, ', ' order by status)
    from (select coalesce(to_jsonb(p)->>'status', '(no status column)') as status, count(*) n from public.local_payouts p group by 1) s
  union all
  select 3, 'CHECK ' || conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
    from pg_constraint
   where contype = 'c' and conrelid::regclass::text in ('withdrawals', 'local_payouts', 'public.withdrawals', 'public.local_payouts')
  union all
  select 4, 'FUNCTION ' || p.proname, 'args (' || pg_get_function_identity_arguments(p.oid) || ') returns ' || pg_get_function_result(p.oid)
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname ilike 'withdrawal%' or p.proname ilike 'local_payout%' or p.proname ilike '%payout%' or p.proname ilike '%reconcil%')
  union all
  select 5, 'SOURCE ' || p.proname, pg_get_functiondef(p.oid)
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('withdrawal_stuck_list', 'withdrawal_clearing_mine', 'withdrawal_create', 'withdrawal_fail', 'withdrawal_succeed')
  union all
  select 6, 'TRIGGER ' || event_object_table || '.' || trigger_name, action_timing || ' ' || event_manipulation
    from information_schema.triggers
   where trigger_schema = 'public' and event_object_table in ('withdrawals', 'local_payouts', 'wallets', 'wallet_transactions')
  union all
  select 7, 'COUNTS',
         'withdrawals=' || (select count(*) from public.withdrawals)
         || ', local_payouts=' || (select count(*) from public.local_payouts)
         || ', wallets=' || (select count(*) from public.wallets)
         || ', wallet_transactions=' || (select count(*) from public.wallet_transactions)
  union all
  select 8, 'CRON', jobname || ' | ' || schedule || ' | ' || left(command, 120)
    from cron.job where jobname ilike '%withdraw%' or jobname ilike '%payout%' or jobname ilike '%reconcil%'
) x
order by o, section;

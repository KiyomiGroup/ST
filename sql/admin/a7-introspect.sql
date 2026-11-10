-- StreetTasker Admin, stage A7 (Customers): READ-ONLY schema check. Changes nothing. Run the whole file in the Supabase SQL editor
-- and paste me the result grid (one table of text rows). It lists the columns, triggers and policies A7 must respect.
select section, detail from (
  select 1 as o, 'COLUMNS ' || c.table_name as section,
         string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as detail
    from information_schema.columns c
   where c.table_schema = 'public'
     and (c.table_name in ('users', 'bookings', 'reviews', 'wallets', 'gift_cards', 'referrals')
          or c.table_name ilike '%report%' or c.table_name ilike '%flag%' or c.table_name ilike '%dispute%' or c.table_name ilike '%block%')
   group by c.table_name
  union all
  select 2, 'TRIGGER ' || event_object_table || '.' || trigger_name, action_timing || ' ' || event_manipulation
    from information_schema.triggers
   where trigger_schema = 'public' and event_object_table in ('users', 'bookings')
  union all
  select 3, 'POLICY ' || tablename || '.' || policyname, cmd || ' | ' || coalesce(qual, '')
    from pg_policies where schemaname = 'public' and tablename = 'users'
  union all
  select 4, 'ROLE VALUES', coalesce(string_agg(distinct role::text, ', '), '(none)') from public.users
  union all
  select 5, 'COUNTS', 'users=' || (select count(*) from public.users) || ', customers=' || (select count(*) from public.users where role = 'customer')
) t order by o, section;

-- StreetTasker Admin, stage A14 (Services, reviews, reports, community): READ-ONLY schema check. Changes nothing.
-- Why first: A14 adds a hide control, and a hide only works if the public site's reads respect it. I have not seen the columns, policies
-- or triggers of reviews, profile_reviews, comments, feed_posts or any "report" table, so I will not guess them (guessing broke A8's first run).
-- Run the whole file in the Supabase SQL editor and paste me the result grid (or download it as CSV and upload it).
select section, detail from (
  select 1 as o, 'COLUMNS ' || c.table_name as section,
         string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as detail
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name not like 'test_archive%'
     and (c.table_name in ('services', 'reviews', 'profile_reviews', 'comments', 'feed_posts', 'rating_summary', 'users')
          or c.table_name ilike '%report%' or c.table_name ilike '%flag%' or c.table_name ilike '%moderat%' or c.table_name ilike '%hidden%')
   group by c.table_name
  union all
  select 2, 'TRIGGER ' || event_object_table || '.' || trigger_name, action_timing || ' ' || event_manipulation
    from information_schema.triggers
   where trigger_schema = 'public' and event_object_table in ('services', 'reviews', 'profile_reviews', 'comments', 'feed_posts')
  union all
  select 3, 'POLICY ' || p.tablename || '.' || p.policyname,
         p.cmd || ' to ' || array_to_string(p.roles, ',') || ' using (' || coalesce(p.qual, '-') || ')'
    from pg_policies p
   where p.schemaname = 'public' and p.tablename in ('services', 'reviews', 'profile_reviews', 'comments', 'feed_posts')
  union all
  select 4, 'COUNTS',
         (select string_agg(t || '=' || case when to_regclass('public.' || t) is null then 'table missing'
                  else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text end, ', ')
            from unnest(array['services', 'reviews', 'profile_reviews', 'comments', 'feed_posts']) t)
  union all
  select 5, 'FUNCTION ' || p.proname, 'args (' || pg_get_function_identity_arguments(p.oid) || ') returns ' || pg_get_function_result(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname ilike '%review%' or p.proname ilike '%report%' or p.proname ilike '%hide%' or p.proname ilike '%hidden%' or p.proname ilike '%feed%' or p.proname ilike '%comment%')
  union all
  select 6, 'VIEW ' || v.table_name, left(v.view_definition, 600)
    from information_schema.views v
   where v.table_schema = 'public' and (v.table_name ilike '%review%' or v.table_name ilike '%service%' or v.table_name ilike '%feed%' or v.table_name ilike '%rating%')
  union all
  select 7, 'MISSING TABLES',
         coalesce((select string_agg(t, ', ') from unnest(array['services', 'reviews', 'profile_reviews', 'comments', 'feed_posts', 'rating_summary']) t
                    where to_regclass('public.' || t) is null), '(none missing)')
) t order by o, section;

-- StreetTasker Admin, stage A14b introspect (READ ONLY, changes nothing): the source of the functions and policies that decide what the PUBLIC sees of
-- services and reviews. A hide only works if these respect it, so I need to read them before writing one. Run the whole file and send the result (CSV).
select 'FUNCTION ' || p.proname as what, pg_get_functiondef(p.oid) as source
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
   and (p.proname in ('profile_reviews', '_reviews_refresh_summary', '_reviews_after_change', 'submit_review', 'coordinator_submit_review', 'decline_review', 'review_state',
                     'services_listing_gate', 'services_listing_status_lock', 'zz_m18_services_guard', '_sub_keep_paused_hidden', 'local_tasker_row_visible', 'local_tasker_hidden_ids')
        or p.proname ilike '%sub_sync_tasker_visibility%' or p.proname ilike '%services_live_limit%' or p.proname ilike '%services_mark_republish%')
union all
select 'POLICY ' || tablename || '.' || policyname, cmd || ' to ' || array_to_string(roles, ',') || ' using (' || coalesce(qual, '-') || ') check (' || coalesce(with_check, '-') || ')'
  from pg_policies where schemaname = 'public' and tablename in ('services', 'reviews', 'rating_summary', 'feed_posts', 'comments')
union all
select 'RLS ' || c.relname, 'rls_enabled=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('services', 'reviews', 'rating_summary', 'feed_posts', 'comments')
union all
select 'VIEW ' || table_name, left(view_definition, 1500) from information_schema.views
 where table_schema = 'public' and (table_name ilike '%service%' or table_name ilike '%review%' or table_name ilike '%tasker%' or table_name ilike '%featured%')
order by 1;

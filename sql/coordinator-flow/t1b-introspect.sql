-- Stage T1b: READ-ONLY. Run each block and paste ALL results. (Names and function text only; no keys are returned.)
-- Needed to set the 3-live-services rule, the main service, and the separate profile picture without breaking the existing publish code.

-- Block 1: the functions that decide which services are live, and the triggers on services (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('_local_tasker_sync_public','_local_tasker_readiness','services_listing_gate','services_listing_status_lock','_m18_services_guard','_sub_sync_tasker_visibility','coordinator_manages_tasker');

-- Block 2: the two queries of t1-introspect.sql that failed, corrected
select s.user_id, count(*) filter (where s.available) as live, count(*) as total
from public.services s join public.local_tasker_profiles p on p.tasker_user_id = s.user_id group by 1 order by 2 desc limit 20;
select available, listing_status, count(*) from public.services group by 1, 2;
select id, name, public from storage.buckets;

-- Block 3: where a profile picture lives today (columns that look like pictures, on the tables that matter)
select table_name, column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name in ('users', 'taskers', 'local_tasker_profiles')
  and (column_name ilike '%avatar%' or column_name ilike '%photo%' or column_name ilike '%picture%' or column_name ilike '%image%');

-- Block 4: the public Local Tasker page and the flyer: which table and columns they read (names only)
select table_name, column_name from information_schema.columns
where table_schema = 'public' and table_name = 'taskers' order by ordinal_position;

-- Block 5: storage rules for the photo bucket (names and the check text only)
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual ilike '%local-tasker%' or with_check ilike '%local-tasker%');

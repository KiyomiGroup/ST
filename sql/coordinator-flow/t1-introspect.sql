-- Stage T1 (Local Tasker setup rules): READ-ONLY. Changes nothing. Run each block and paste ALL results to the next AI.
-- Needed for: main service, max 3 published services, "publish again after editing", separate profile picture, shop flyer.

-- Block 1: services and Local Tasker tables (columns)
select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns
where table_schema='public' and table_name in ('services','local_tasker_profiles','local_tasker_photos') order by table_name, ordinal_position;

-- Block 2: functions that save/publish/unpublish (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('save_local_tasker_service','update_local_tasker_profile','publish_local_tasker','unpublish_local_tasker','local_tasker_publish_status','add_local_tasker_photo','update_local_tasker_photo','remove_local_tasker_photo');

-- Block 3: triggers on those tables (names only: a full definition can contain secret keys)
select c.relname as table_name, tgname, t.tgfoid::regproc as runs_function
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not tgisinternal and c.relname in ('services','local_tasker_profiles','local_tasker_photos');

-- Block 4: how many live services each Local Tasker has now (is anyone already over 3?)
select s.user_id, count(*) filter (where s.status='active' or s.status='published') as live, count(*) as total
from public.services s join public.local_tasker_profiles p on p.tasker_user_id=s.user_id group by 1 order by 2 desc limit 20;
select status, count(*) from public.services group by 1;

-- Block 5: where the profile picture lives today
select column_name from information_schema.columns where table_schema='public' and table_name in ('users','local_tasker_profiles') and (column_name ilike '%avatar%' or column_name ilike '%photo%' or column_name ilike '%picture%' or column_name ilike '%image%');
select id, name, public from storage.buckets;

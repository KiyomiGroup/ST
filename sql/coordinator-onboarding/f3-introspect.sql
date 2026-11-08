-- Stage F-3: READ-ONLY. Changes nothing. Run each block in the Supabase SQL editor and paste ALL results to the next AI.
-- Needed to make your coordinator account the "center coordinator" (top plan free) and to let an administrator move Local Taskers to another coordinator.

-- Block 1: who published the Local Taskers, and who manages them now
select p.tasker_user_id, p.full_name, p.status, p.published_by, u.email as published_by_email
from public.local_tasker_profiles p left join auth.users u on u.id = p.published_by
order by p.created_at;

-- Block 2: coordinator tables and their columns (plan, tier, assignments)
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and (table_name ilike '%coordinator%' or table_name ilike '%assignment%')
order by table_name, ordinal_position;

-- Block 3: functions about plan, tier, assignment and reassignment (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname ilike '%reassign%' or p.proname ilike '%coordinator_plan%' or p.proname ilike '%coordinator_tier%'
       or p.proname in ('coordinator_manages_tasker','is_local_tasker_admin','my_coordinator_plan','idv_is_exempt'));

-- Block 4: triggers on the assignment and coordinator tables
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public' and (event_object_table ilike '%coordinator%' or event_object_table ilike '%assignment%' or event_object_table = 'local_booking_state');

-- Block 5: your coordinators
select c.*, u.email from public.coordinators c left join auth.users u on u.id = c.user_id;

-- G-1: READ-ONLY. Changes nothing. Run each block in the Supabase SQL editor and paste ALL results back.
-- Why: "Save profile and continue" on the Add Local Tasker page fails inside the database function create_local_tasker
-- with "No operator matches the given name and argument types". The source of that function (and the functions and triggers
-- it runs) is not in the project files, so the exact line cannot be fixed without reading it.

-- Block 1: the function and everything it calls on the way (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname in ('create_local_tasker','local_tasker_find_request','local_tasker_assignment_guard','coordinator_capacity',
                     'my_coordinator_plan','coordinator_tier_terms','is_active_coordinator','local_tasker_audit','_local_booking_follow_assignment')
       or pg_get_functiondef(p.oid) ilike '%coordinator_center%');

-- Block 2: triggers on the tables create_local_tasker writes to
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('local_tasker_profiles','coordinator_assignments','local_tasker_consents','users','taskers','audit_log');

-- Block 3: column types of the tables involved (a text column compared with a uuid column is the usual cause)
select table_name, column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('coordinator_assignments','local_tasker_profiles','local_tasker_consents','coordinators','coordinator_tiers_state','coordinator_center')
order by table_name, ordinal_position;

-- Block 4: the Edge Function log line has the real message too. Supabase > Edge Functions > local-tasker-create > Logs:
-- look for "create_local_tasker failed" after redeploying the new index.ts, then press Save once on the form.

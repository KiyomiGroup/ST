-- READ-ONLY. Run each block in the Supabase SQL editor and send the result of each as a CSV.
-- Stage V1b-2 needs these to reuse the existing audit, notification and consent code correctly.
-- Nothing here changes anything. Results may contain function source: that is expected.

-- 1. Bodies of the helpers V1b-2 will call or must not break
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer, p.prosrc as source
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('_notify', 'can_notify', 'local_tasker_audit', 'local_tasker_audit_append_only',
                    'local_tasker_consent_guard', 'coordinator_manages_tasker', 'is_local_tasker_admin',
                    'local_tasker_touch_updated_at')
order by p.proname;

-- 2. Constraints on the local tasker tables (the allowed consent purposes live here)
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.local_tasker_consents'::regclass, 'public.local_tasker_profiles'::regclass)
order by 1, 2;

-- 3. Columns of the audit table and of the coordinator tables
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('local_tasker_audit', 'coordinators', 'local_tasker_assignments')
order by table_name, ordinal_position;

-- 4. Triggers on the audit and consent tables (append-only guards)
select event_object_table as table_name, trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('local_tasker_audit', 'local_tasker_consents', 'notifications')
order by 1, 2;

-- Didit stage V0: READ-ONLY introspection. Changes nothing.
-- Run each block in the Supabase SQL editor and export the result as CSV (same way as the earlier introspect files).
-- NOT RUN by the AI that wrote it (no database available). Fix any typo you hit and tell the next session.

-- 1. Columns of the tables that carry verification state
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('verifications','users','taskers','local_tasker_profiles','local_tasker_consents','notifications')
order by table_name, ordinal_position;

-- 2. RLS policies on those tables (who can write is_verified / verifications today)
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('verifications','users','taskers','local_tasker_profiles','local_tasker_consents','notifications')
order by tablename, policyname;

-- 3. Triggers on those tables (guard triggers may already block is_verified edits)
select event_object_table as table_name, trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('verifications','users','taskers','local_tasker_profiles')
order by event_object_table, trigger_name;

-- 4. Table and column grants for the browser roles
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public' and grantee in ('anon','authenticated')
  and table_name in ('verifications','users','taskers','local_tasker_profiles')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and grantee in ('anon','authenticated')
  and table_name in ('users','taskers')
  and column_name in ('is_verified','verified','verified_at')
order by table_name, column_name, grantee;

-- 5. Source of the existing server-side function the browser calls today
select p.proname, pg_get_function_arguments(p.oid) as args, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as body
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('process_verification','validate_nigerian_id','is_active_coordinator','is_coordinator');

-- 6. Existing audit and consent helpers (names only), so the new code reuses them
select p.proname, pg_get_function_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname ilike '%audit%' or p.proname ilike '%consent%' or p.proname ilike '%notif%')
order by p.proname;

-- 7. How many rows exist today, and which hold a raw ID number (data-minimisation decision)
select status, count(*) as rows_total, count(id_number) as rows_with_id_number
from public.verifications group by status order by status;

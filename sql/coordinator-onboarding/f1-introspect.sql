-- Stage F1: READ-ONLY. Changes nothing. Run each block in the Supabase SQL editor and paste ALL results to the next AI.
-- Needed to (a) make the database refuse publishing a Local Tasker whose identity is not verified, and (b) remove the administrator call-back from the database.

-- Block 1: publishing functions and the status checklist (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('publish_local_tasker','local_tasker_publish_status','idv_my_status','idv_local_status','idv_can_publish','idv_subject_kind');

-- Block 2: every function that mentions the administrator call-back (second check)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and pg_get_functiondef(p.oid) ilike '%second_check%';

-- Block 3: columns and constraints that hold the second check
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and column_name ilike '%second_check%';

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace and pg_get_constraintdef(oid) ilike '%second_check%';

-- Block 4: how many bookings are waiting on a call-back right now
select second_check_status, count(*) from public.local_booking_confirmations group by 1;

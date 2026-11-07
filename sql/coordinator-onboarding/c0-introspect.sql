-- Coordinator onboarding C0: READ-ONLY look at how coordinators exist today. Changes nothing.
-- Run each block in the Supabase SQL editor and paste the results to the next AI. Needed before stage S2.

-- Block 1: coordinator tables and their columns
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and (table_name ilike '%coordinator%' or table_name in ('profiles','users'))
order by table_name, ordinal_position;

-- Block 2: coordinator functions (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_coordinator','is_active_coordinator');

-- Block 3: policies on the coordinators table
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'coordinators';

-- Block 4: triggers that run when someone signs up (auth.users) and on public.coordinators
select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where (event_object_schema = 'auth' and event_object_table = 'users') or (event_object_schema = 'public' and event_object_table = 'coordinators');

-- Block 5: how many coordinators exist and one sample row with personal fields hidden
select count(*) as coordinators from public.coordinators;

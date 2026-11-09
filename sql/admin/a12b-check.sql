-- A12b-0: READ ONLY. Changes nothing. Run the whole file in the Supabase SQL editor.
-- It returns ONE cell called "definitions". Copy that cell and paste it in the chat.
-- It contains function source code only (no customer data, no keys).
select string_agg(
         '-- ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || E'\n' || pg_get_functiondef(p.oid),
         E'\n\n' order by p.proname) as definitions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and (
        (p.proname like 'local\_booking\_%'
          and (p.proname ilike '%reassign%' or p.proname ilike '%unlock%' or p.proname ilike '%exception%'))
     or p.proname in ('bookings_guard', 'bookings_guard_stage', 'bookings_hide_code')
     or p.prosrc ilike '%needs_reassignment%'
     or p.prosrc ilike '%code_attempts%'
      );

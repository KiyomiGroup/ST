create or replace function public.idv_consent_version()
 returns text language sql immutable set search_path to 'public', 'pg_temp'
as $$ select 'v1'::text $$;
create or replace function public.idv_coordinator_consent_version()
 returns text language sql immutable set search_path to 'public', 'pg_temp'
as $$ select 'coordinator-v1'::text $$;
select 'DONE: VR1b removed' as result;

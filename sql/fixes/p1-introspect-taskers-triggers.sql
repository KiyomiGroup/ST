-- READ ONLY. Paste into the Supabase SQL editor and run. Changes nothing.
-- Shows every trigger on public.taskers and the source of the function it runs,
-- so we can see which one rejects the "extra profile details" save (profile_details).
select
  t.tgname                          as trigger_name,
  pg_get_triggerdef(t.oid)          as trigger_def,
  p.proname                         as function_name,
  pg_get_functiondef(p.oid)         as function_source
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.taskers'::regclass
  and not t.tgisinternal
order by t.tgname;

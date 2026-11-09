-- StreetTasker Admin Control Centre, stage A9: ROLLBACK. Safe to run twice.
-- Puts admin_reassign_local_tasker back to the body saved by a9-coordinators.sql (the F-6 body, which allows "support"),
-- or drops it if there was none before A9, then drops every admin_coordinator_* function.
-- After this, /admin/coordinators.html cannot load data.
do $r$
declare v_def text;
begin
  select b.definition into v_def from public.admin_function_backups b where b.name = 'admin_reassign_local_tasker(uuid,uuid,text)';
  if v_def is not null then
    execute v_def;
    delete from public.admin_function_backups where name = 'admin_reassign_local_tasker(uuid,uuid,text)';
    raise notice 'DONE: admin_reassign_local_tasker restored to its earlier body.';
  elsif to_regprocedure('public.admin_reassign_local_tasker(uuid,uuid,text)') is not null
        and pg_get_functiondef('public.admin_reassign_local_tasker(uuid,uuid,text)'::regprocedure) ilike '%admin_has(''coordinators.assign'')%' then
    drop function public.admin_reassign_local_tasker(uuid, uuid, text);
    raise notice 'DONE: admin_reassign_local_tasker dropped (there was no earlier version).';
  else
    raise notice 'Nothing to restore.';
  end if;
end
$r$;
drop function if exists public.admin_coordinator_overview();
drop function if exists public.admin_coordinator_workers(uuid);
drop function if exists public.admin_coordinator_applications(text);
drop function if exists public.admin_coordinator_application_approve(uuid, integer);
drop function if exists public.admin_coordinator_application_reject(uuid, text);
drop function if exists public.admin_coordinator_code_create(text, integer);
drop function if exists public.admin_coordinator_assign_local_tasker(uuid, uuid, text);
drop function if exists public.admin_coordinator_deactivate(uuid, text);

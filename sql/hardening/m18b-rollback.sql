-- Undoes m18b-core.sql only (step A stays; use m18-rollback.sql for that).
drop trigger if exists zz_m18_taskers_guard on public.taskers;
drop trigger if exists zz_m18_services_guard on public.services;
drop trigger if exists zz_m18_users_guard on public.users;
drop function if exists public._m18_taskers_guard();
drop function if exists public._m18_services_guard();
drop function if exists public._m18_users_guard();
do $m18$
declare x record;
begin
  if to_regclass('public._m18_revoked') is null then return; end if;
  for x in select id, role_name, table_name, privilege from public._m18_revoked where step = 'B' loop
    execute format('grant %s on public.%I to %I', x.privilege, x.table_name, x.role_name);
    delete from public._m18_revoked where id = x.id;
  end loop;
end $m18$;

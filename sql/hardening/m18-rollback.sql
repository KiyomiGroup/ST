-- Gives back exactly what m18-core.sql took away, then removes the note table.
do $m18$
declare x record;
begin
  if to_regclass('public._m18_revoked') is null then return; end if;
  for x in select role_name, table_name, privilege from public._m18_revoked loop
    execute format('grant %s on public.%I to %I', x.privilege, x.table_name, x.role_name);
  end loop;
end $m18$;
drop table if exists public._m18_revoked;

-- Undoes m18c-core.sql only (steps A and B stay).
drop function if exists public.report_contact_violation();
create or replace function public._m18_users_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $m18$
begin
  if current_user in ('authenticated', 'anon') and TG_OP = 'UPDATE' then
    NEW.is_verified := OLD.is_verified;
    NEW.verified_at := OLD.verified_at;
  end if;
  return NEW;
end $m18$;
do $m18$
declare x record;
begin
  if to_regclass('public._m18_revoked') is null then return; end if;
  for x in select id, role_name, table_name, privilege from public._m18_revoked where step = 'C' loop
    execute format('grant %s on public.%I to %I', x.privilege, x.table_name, x.role_name);
    delete from public._m18_revoked where id = x.id;
  end loop;
end $m18$;

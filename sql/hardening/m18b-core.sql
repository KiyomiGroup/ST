-- StreetTasker M18 step B. Run the WHOLE file once, AFTER m18-core.sql.
-- 1) Not-signed-in visitors (anon) lose INSERT, UPDATE, DELETE on every public table. Every write feature on the site needs a signed-in user,
--    and the row rules already refuse anon, so nothing changes for real use.
-- 2) The leftover table _policy_backup_steps (nothing on the site uses it) is closed to anon and signed-in users completely.
-- 3) Signed-in people can no longer change their own rating, review count, plan, free limit or verified fields on taskers, services and users.
--    A change from a browser is silently ignored (the old value stays); the server (functions, edge functions, SQL editor) can still change them.
create table if not exists public._m18_revoked (
  id bigserial primary key, role_name text not null, table_name text not null, privilege text not null, revoked_at timestamptz not null default now()
);
alter table public._m18_revoked add column if not exists step text not null default 'A';
alter table public._m18_revoked enable row level security;
revoke all on public._m18_revoked from public, anon, authenticated;

do $m18$
declare t record; p text;
begin
  for t in select c.oid, c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname <> '_m18_revoked' loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', t.oid, p) then
        insert into public._m18_revoked (role_name, table_name, privilege, step) values ('anon', t.relname, p, 'B');
        execute format('revoke %s on public.%I from anon', p, t.relname);
      end if;
    end loop;
  end loop;

  if to_regclass('public._policy_backup_steps') is not null then
    for t in select c.oid, c.relname from pg_class c where c.oid = 'public._policy_backup_steps'::regclass loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege('anon', t.oid, p) then
          insert into public._m18_revoked (role_name, table_name, privilege, step) values ('anon', t.relname, p, 'B');
          execute format('revoke %s on public.%I from anon', p, t.relname);
        end if;
        if has_table_privilege('authenticated', t.oid, p) then
          insert into public._m18_revoked (role_name, table_name, privilege, step) values ('authenticated', t.relname, p, 'B');
          execute format('revoke %s on public.%I from authenticated', p, t.relname);
        end if;
      end loop;
    end loop;
    execute 'alter table public._policy_backup_steps enable row level security';
  end if;
end $m18$;

-- Guards: current_user is 'authenticated' or 'anon' only for a direct call from a browser; our functions and the server run as another role.
create or replace function public._m18_taskers_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $m18$
begin
  if current_user in ('authenticated', 'anon') and TG_OP = 'UPDATE' then
    NEW.rating := OLD.rating;
    NEW.review_count := OLD.review_count;
    NEW.subscription_plan := OLD.subscription_plan;
    NEW.subscription_status := OLD.subscription_status;
    NEW.free_limit := OLD.free_limit;
    NEW.is_verified := OLD.is_verified;
    NEW.verified := OLD.verified;
    NEW.verified_at := OLD.verified_at;
  end if;
  return NEW;
end $m18$;
drop trigger if exists zz_m18_taskers_guard on public.taskers;
create trigger zz_m18_taskers_guard before update on public.taskers for each row execute function public._m18_taskers_guard();

create or replace function public._m18_services_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $m18$
begin
  if current_user in ('authenticated', 'anon') and TG_OP = 'UPDATE' then
    NEW.rating := OLD.rating;
    NEW.reviews_count := OLD.reviews_count;
    NEW.verified := OLD.verified;
  end if;
  return NEW;
end $m18$;
drop trigger if exists zz_m18_services_guard on public.services;
create trigger zz_m18_services_guard before update on public.services for each row execute function public._m18_services_guard();

create or replace function public._m18_users_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $m18$
begin
  if current_user in ('authenticated', 'anon') and TG_OP = 'UPDATE' then
    NEW.is_verified := OLD.is_verified;
    NEW.verified_at := OLD.verified_at;
  end if;
  return NEW;
end $m18$;
drop trigger if exists zz_m18_users_guard on public.users;
create trigger zz_m18_users_guard before update on public.users for each row execute function public._m18_users_guard();

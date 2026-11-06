-- StreetTasker M18 step C. Run the WHOLE file once, AFTER m18b-core.sql.
-- 1) Contact-sharing violations are counted by the database: new function report_contact_violation() (counts the signed-in person, flags at 3).
--    Browsers can no longer write users.contact_violations, is_flagged, flagged_reason (a browser change is silently ignored).
-- 2) verifications: no page ever writes this table (only reads), but a signed-in person could set their own row to "approved".
--    Browsers lose INSERT, UPDATE, DELETE on it. Reading your own row still works.
create table if not exists public._m18_revoked (
  id bigserial primary key, role_name text not null, table_name text not null, privilege text not null, revoked_at timestamptz not null default now()
);
alter table public._m18_revoked add column if not exists step text not null default 'A';
alter table public._m18_revoked enable row level security;
revoke all on public._m18_revoked from public, anon, authenticated;

create or replace function public.report_contact_violation() returns integer
language plpgsql security definer set search_path = public, pg_temp as $m18$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then return null; end if;
  update public.users set contact_violations = coalesce(contact_violations, 0) + 1 where id = v_uid returning contact_violations into v_n;
  if coalesce(v_n, 0) >= 3 then
    update public.users set is_flagged = true, flagged_reason = 'Repeated contact sharing violations' where id = v_uid and is_flagged is not true;
  end if;
  return v_n;
end $m18$;
revoke all on function public.report_contact_violation() from public, anon;
grant execute on function public.report_contact_violation() to authenticated;

create or replace function public._m18_users_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $m18$
begin
  if current_user in ('authenticated', 'anon') and TG_OP = 'UPDATE' then
    NEW.is_verified := OLD.is_verified;
    NEW.verified_at := OLD.verified_at;
    NEW.contact_violations := OLD.contact_violations;
    NEW.is_flagged := OLD.is_flagged;
    NEW.flagged_reason := OLD.flagged_reason;
  end if;
  return NEW;
end $m18$;
drop trigger if exists zz_m18_users_guard on public.users;
create trigger zz_m18_users_guard before update on public.users for each row execute function public._m18_users_guard();

do $m18$
declare p text;
begin
  if to_regclass('public.verifications') is not null then
    foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', 'public.verifications', p) then
        insert into public._m18_revoked (role_name, table_name, privilege, step) values ('authenticated', 'verifications', p, 'C');
        execute format('revoke %s on public.verifications from authenticated', p);
      end if;
    end loop;
  end if;
end $m18$;

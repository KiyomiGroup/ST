-- StreetTasker M18 step A: remove table permissions no page uses. Run the WHOLE file once.
-- Checked in the code: no page ever TRUNCATES anything, and no page deletes a row of bookings, tasks, users or taskers
-- (only services can be deleted by their owner, and that stays). Server functions and edge functions use other roles and are not affected.
-- What it takes away from anon (not signed in) and authenticated (signed in):
--   TRUNCATE, REFERENCES, TRIGGER on every public table; DELETE on bookings, tasks, users, taskers; DELETE on services for anon.
-- Everything taken away is first written to public._m18_revoked, so the rollback gives back exactly that and nothing else.
create table if not exists public._m18_revoked (
  id bigserial primary key, role_name text not null, table_name text not null, privilege text not null, revoked_at timestamptz not null default now()
);
alter table public._m18_revoked enable row level security;
revoke all on public._m18_revoked from public, anon, authenticated;

do $m18$
declare t record; r text; p text; wanted text[];
begin
  for t in select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname <> '_m18_revoked' loop
    foreach r in array array['anon', 'authenticated'] loop
      wanted := array['TRUNCATE', 'REFERENCES', 'TRIGGER'];
      if t.relname in ('bookings', 'tasks', 'users', 'taskers') then wanted := array_append(wanted, 'DELETE'); end if;
      if t.relname = 'services' and r = 'anon' then wanted := array_append(wanted, 'DELETE'); end if;
      foreach p in array wanted loop
        if has_table_privilege(r, t.oid, p) then
          insert into public._m18_revoked (role_name, table_name, privilege) values (r, t.relname, p);
          execute format('revoke %s on public.%I from %I', p, t.relname, r);
        end if;
      end loop;
    end loop;
  end loop;
end $m18$;

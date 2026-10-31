-- SCRATCH POSTGRES ONLY. Tests for v1a-tables.sql. Run as superuser in ONE psql session:
--   psql -v ON_ERROR_STOP=1 -f v1a-scratch-setup.sql -f v1a-tables.sql -f v1a-tests.sql
-- Each check records PASS/FAIL; the last statement fails the run if any check failed.

create temp table results (n serial, label text, ok boolean, detail text);

-- Runs stmt as role_name and compares the outcome with `want`:
-- 'ok' (no error) or a SQLSTATE such as 42501 (no privilege), 23505 (unique), 23514 (check).
create function pg_temp.expect(label text, role_name text, stmt text, want text) returns void
language plpgsql as $$
declare got text := 'ok';
begin
  begin
    execute format('set local role %I', role_name);
    execute stmt;
  exception when others then
    got := sqlstate;
  end;
  execute 'reset role';
  insert into pg_temp.results(label, ok, detail) values (label, got = want, 'want ' || want || ', got ' || got);
end $$;

-- 1. RLS is on for both tables
insert into results(label, ok, detail)
select 'RLS enabled on ' || relname, relrowsecurity, ''
from pg_class where oid in ('public.identity_verifications'::regclass, 'public.identity_verification_events'::regclass);

-- 2. No policies exist (access is by functions only)
insert into results(label, ok, detail)
select 'no policies on the two tables', count(*) = 0, count(*) || ' policies'
from pg_policies where tablename in ('identity_verifications', 'identity_verification_events');

-- 3. Browser roles cannot read or write either table
select pg_temp.expect(r || ' ' || op || ' on ' || t, r, stmt, '42501')
from (values ('select', 'select * from public.%s'),
             ('insert', 'insert into public.%s default values'),
             ('update', 'update public.%s set provider_status = null'),
             ('delete', 'delete from public.%s')) as o(op, tmpl),
     (values ('identity_verifications'), ('identity_verification_events')) as tb(t),
     (values ('anon'), ('authenticated')) as ro(r),
     lateral (select format(o.tmpl, tb.t) as stmt) s;

-- 4. service_role can write and read
select pg_temp.expect('service_role insert', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000001', 'tasker_regular', 'sandbox', '00000000-0000-0000-0000-000000000001')$q$, 'ok');
select pg_temp.expect('service_role select', 'service_role', 'select * from public.identity_verifications', 'ok');
select pg_temp.expect('service_role insert event', 'service_role',
  $q$insert into public.identity_verification_events(event_id, outcome) values ('evt-1', 'applied')$q$, 'ok');

-- 5. Open-row rule
select pg_temp.expect('2nd open row, same user + env rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000001', 'tasker_regular', 'sandbox', '00000000-0000-0000-0000-000000000001')$q$, '23505');
select pg_temp.expect('open row in the OTHER env allowed', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000001', 'tasker_regular', 'live', '00000000-0000-0000-0000-000000000001')$q$, 'ok');
select pg_temp.expect('open row for a different user allowed', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000002', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000002')$q$, 'ok');
select pg_temp.expect('close the sandbox row (VERIFIED)', 'service_role',
  $q$update public.identity_verifications set status = 'VERIFIED'
     where user_id = '00000000-0000-0000-0000-000000000001' and environment = 'sandbox'$q$, 'ok');
select pg_temp.expect('new open row allowed after the old one closed', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000001', 'tasker_regular', 'sandbox', '00000000-0000-0000-0000-000000000001')$q$, 'ok');
select pg_temp.expect('and a further open row is rejected again', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000001', 'tasker_regular', 'sandbox', '00000000-0000-0000-0000-000000000001')$q$, '23505');
-- every closed status really frees the slot
select pg_temp.expect('FAILED / EXPIRED / ABANDONED also close', 'service_role',
  $q$update public.identity_verifications set status = 'FAILED'
     where user_id = '00000000-0000-0000-0000-000000000002';
     insert into public.identity_verifications(user_id, subject_kind, environment, created_by, status)
     values ('00000000-0000-0000-0000-000000000002', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000002', 'EXPIRED');
     insert into public.identity_verifications(user_id, subject_kind, environment, created_by, status)
     values ('00000000-0000-0000-0000-000000000002', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000002', 'ABANDONED');
     insert into public.identity_verifications(user_id, subject_kind, environment, created_by, status)
     values ('00000000-0000-0000-0000-000000000002', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000002', 'IN_PROGRESS')$q$, 'ok');
-- every non-closed status counts as open
select pg_temp.expect(s || ' counts as open', 'service_role',
  format($q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by, status)
     values ('00000000-0000-0000-0000-000000000002', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000002', %L)$q$, s), '23505')
from unnest(array['NOT_STARTED', 'IN_PROGRESS', 'PENDING', 'REVIEW_REQUIRED', 'RESUBMIT_REQUESTED']) as s;

-- 6. Value checks
select pg_temp.expect('bad status rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by, status)
     values ('00000000-0000-0000-0000-000000000003', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000003', 'APPROVED')$q$, '23514');
select pg_temp.expect('bad subject_kind rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000003', 'admin', 'sandbox', '00000000-0000-0000-0000-000000000003')$q$, '23514');
select pg_temp.expect('bad environment rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000003', 'customer', 'staging', '00000000-0000-0000-0000-000000000003')$q$, '23514');
select pg_temp.expect('bad nin_database_match rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by, nin_database_match)
     values ('00000000-0000-0000-0000-000000000003', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000003', 'match')$q$, '23514');
select pg_temp.expect('provider other than didit rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by, provider)
     values ('00000000-0000-0000-0000-000000000003', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000003', 'dojah')$q$, '23514');
select pg_temp.expect('missing user_id rejected', 'service_role',
  $q$insert into public.identity_verifications(subject_kind, environment, created_by)
     values ('customer', 'sandbox', '00000000-0000-0000-0000-000000000003')$q$, '23502');

-- 7. Uniqueness of session id and request id
select pg_temp.expect('provider_session_id unique: first', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by, provider_session_id, request_id)
     values ('00000000-0000-0000-0000-000000000004', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000004', 'sess-1', 'req-1')$q$, 'ok');
select pg_temp.expect('provider_session_id unique: duplicate rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by, provider_session_id)
     values ('00000000-0000-0000-0000-000000000005', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000005', 'sess-1')$q$, '23505');
select pg_temp.expect('same created_by + request_id rejected', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by, request_id)
     values ('00000000-0000-0000-0000-000000000006', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000004', 'req-1')$q$, '23505');
select pg_temp.expect('two rows with NULL session id and NULL request id allowed', 'service_role',
  $q$insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
     values ('00000000-0000-0000-0000-000000000007', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000007'),
            ('00000000-0000-0000-0000-000000000008', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000008')$q$, 'ok');

-- 8. Event ledger
select pg_temp.expect('duplicate event_id rejected by the primary key', 'service_role',
  $q$insert into public.identity_verification_events(event_id) values ('evt-1')$q$, '23505');
select pg_temp.expect('duplicate event_id with ON CONFLICT DO NOTHING is a no-op', 'service_role',
  $q$insert into public.identity_verification_events(event_id) values ('evt-1') on conflict (event_id) do nothing$q$, 'ok');
select pg_temp.expect('bad outcome rejected', 'service_role',
  $q$insert into public.identity_verification_events(event_id, outcome) values ('evt-2', 'maybe')$q$, '23514');
insert into results(label, ok, detail)
select 'ON CONFLICT DO NOTHING left exactly one evt-1 row', count(*) = 1, count(*) || ' rows'
from public.identity_verification_events where event_id = 'evt-1';

-- 9. updated_at moves on update (separate statements so now() differs)
insert into public.identity_verifications(user_id, subject_kind, environment, created_by)
values ('00000000-0000-0000-0000-000000000009', 'customer', 'sandbox', '00000000-0000-0000-0000-000000000009');
select pg_sleep(0.05);
update public.identity_verifications set status = 'IN_PROGRESS' where user_id = '00000000-0000-0000-0000-000000000009';
insert into results(label, ok, detail)
select 'updated_at advances on update', updated_at > created_at, updated_at - created_at || ''
from public.identity_verifications where user_id = '00000000-0000-0000-0000-000000000009';

-- 10. Browser roles cannot run the trigger function directly
select pg_temp.expect('anon cannot execute idv_touch_updated_at', 'anon', 'select public.idv_touch_updated_at()', '42501');
select pg_temp.expect('authenticated cannot execute idv_touch_updated_at', 'authenticated', 'select public.idv_touch_updated_at()', '42501');

-- Report
select n, case when ok then 'PASS' else 'FAIL' end as result, label, detail from results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
do $$
begin
  if exists (select 1 from pg_temp.results where not ok) then
    raise exception 'V1a tests FAILED';
  end if;
end $$;

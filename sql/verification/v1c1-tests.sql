-- SCRATCH POSTGRES ONLY. Tests for v1c1-consent.sql. ONE psql session, from the folder with the SQL files,
-- on a FRESH database:
--   psql -v ON_ERROR_STOP=1 -f v1a-scratch-setup.sql -f v1a-tables.sql -f v1b1-idv-apply-core.sql \
--        -f v1b2-scratch-standins.sql -f v1c1-scratch-standins.sql -f v1c1-consent.sql -f v1c1-tests.sql
-- users/coordinators/assignments/consents/audit are STAND-INS (see the two scratch-standins files).

create temp table results (n serial, label text, ok boolean, detail text);
create function pg_temp.chk(p_label text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into pg_temp.results(label, ok, detail) values (p_label, coalesce(p_ok, false), p_detail) $$;

-- Run an expression as a role, optionally as a signed-in user (auth.uid()). Returns the value as text,
-- or 'ERR:<sqlstate>:<hint>' on failure.
create function pg_temp.as_(p_uid uuid, p_role text, p_expr text) returns text
language plpgsql as $$
declare v text; h text; st text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    if p_expr like 'stmt:%' then
      execute substr(p_expr, 6); v := 'ok';
    else
      execute 'select (' || p_expr || ')::text' into v;
    end if;
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    st := sqlstate;
    v := 'ERR:' || st || ':' || coalesce(h, '');
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- fixtures
create function pg_temp.mk_user() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); begin insert into public.users(id, name) values (u, 'Ada Test'); return u; end $$;
create function pg_temp.mk_coord(p_status text default 'active') returns uuid language plpgsql as $$
declare c uuid := gen_random_uuid(); begin insert into public.coordinators(user_id, display_name, status) values (c, 'Coord', p_status); return c; end $$;
create function pg_temp.mk_local(p_coord uuid default null, p_ended boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); begin
  insert into public.users(id, name) values (u, 'Local Person');
  insert into public.local_tasker_profiles(tasker_user_id, full_name, phone) values (u, 'Local Person', '+2348000000000');
  if p_coord is not null then
    insert into public.coordinator_assignments(coordinator_id, tasker_user_id, ended_at) values (p_coord, u, case when p_ended then now() end);
  end if;
  return u; end $$;
create function pg_temp.n_audit(p_action text, p_entity_id text) returns bigint language sql as
$$ select count(*) from public.local_tasker_audit_log where action = p_action and entity_id = p_entity_id $$;

-- ===== A. the purpose list =====
do $$
declare u uuid := pg_temp.mk_local(); got text;
begin
  insert into public.local_tasker_consents(tasker_user_id, purpose, method, recorded_by) values (u, 'identity_verification', 'in_person', gen_random_uuid());
  insert into public.local_tasker_consents(tasker_user_id, purpose, method, recorded_by) values (u, 'profile', 'phone', gen_random_uuid());
  perform pg_temp.chk('identity_verification and the old purposes are accepted', (select count(*) from public.local_tasker_consents where tasker_user_id = u) = 2);
  begin insert into public.local_tasker_consents(tasker_user_id, purpose, method, recorded_by) values (u, 'made_up', 'phone', gen_random_uuid()); got := 'inserted';
  exception when check_violation then got := 'refused'; end;
  perform pg_temp.chk('an unknown purpose is still refused', got = 'refused', got);
end $$;

-- ===== B. self consent =====
do $$
declare u uuid := pg_temp.mk_user(); r text; id1 text; id2 text;
begin
  perform pg_temp.chk('anon cannot run idv_give_consent', pg_temp.as_(null, 'anon', $q$public.idv_give_consent('v1')$q$) like 'ERR:42501%');
  r := pg_temp.as_(null, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('signed in role with no user id is refused (not_signed_in)', r = 'ERR:P0001:not_signed_in', r);
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('old-text')$q$);
  perform pg_temp.chk('wrong consent version refused', r = 'ERR:P0001:consent_version_mismatch', r);
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent(null)$q$);
  perform pg_temp.chk('null consent version refused', r = 'ERR:P0001:consent_version_mismatch', r);
  perform pg_temp.chk('nothing stored by the refusals', (select count(*) from public.identity_verification_consents where user_id = u) = 0);

  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  id1 := r::jsonb->>'consent_id';
  perform pg_temp.chk('consent given: created true, row stored with version and method', (r::jsonb->>'created')::boolean
    and (select consent_version = 'v1' and method = 'self_checkbox' and revoked_at is null from public.identity_verification_consents where id = id1::uuid), r);
  perform pg_temp.chk('one audit row (consent_recorded) with version only, actor = the user',
    pg_temp.n_audit('consent_recorded', id1) = 1
    and (select after_data = '{"purpose":"identity_verification","method":"self_checkbox","version":"v1"}'::jsonb and actor_id = u
           from public.local_tasker_audit_log where entity_id = id1));
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('giving it again: created false, same id, no second row or audit',
    not (r::jsonb->>'created')::boolean and r::jsonb->>'consent_id' = id1
    and (select count(*) from public.identity_verification_consents where user_id = u) = 1 and pg_temp.n_audit('consent_recorded', id1) = 1, r);

  -- browser roles cannot touch the table
  perform pg_temp.chk('authenticated cannot delete', pg_temp.as_(u, 'authenticated', $q$stmt:delete from public.identity_verification_consents$q$) like 'ERR:42501%');
  perform pg_temp.chk('authenticated cannot select the consent table', pg_temp.as_(u, 'authenticated', $q$(select count(*) from public.identity_verification_consents)$q$) like 'ERR:42501%');
  perform pg_temp.chk('authenticated cannot insert', pg_temp.as_(u, 'authenticated', format($q$stmt:insert into public.identity_verification_consents(user_id, consent_version) values (%L, 'v1')$q$, gen_random_uuid())) like 'ERR:42501%');
  perform pg_temp.chk('authenticated cannot update', pg_temp.as_(u, 'authenticated', $q$stmt:update public.identity_verification_consents set revoked_at = now()$q$) like 'ERR:42501%');
  perform pg_temp.chk('anon cannot select', pg_temp.as_(null, 'anon', $q$(select count(*) from public.identity_verification_consents)$q$) like 'ERR:42501%');

  -- a Local Tasker identity cannot give self consent
  r := pg_temp.as_(pg_temp.mk_local(), 'authenticated', $q$public.idv_give_consent('v1')$q$);
  r := pg_temp.as_((select tasker_user_id from public.local_tasker_profiles limit 1), 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('a Local Tasker identity cannot give self consent', r = 'ERR:P0001:not_for_local_tasker', r);
end $$;

-- ===== C. withdraw, give again, guard =====
do $$
declare u uuid := pg_temp.mk_user(); other uuid := pg_temp.mk_user(); r text; id1 text; id2 text; got text;
begin
  id1 := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$)::jsonb->>'consent_id';
  perform pg_temp.as_(other, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('has_consent true after consent (regular tasker and customer)',
    pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'tasker_regular')$q$, u)) = 'true'
    and pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'customer')$q$, u)) = 'true');
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_withdraw_consent('changed my mind')$q$);
  perform pg_temp.chk('withdraw: revoked 1, fields set, audit row', (r::jsonb->>'revoked')::int = 1
    and (select revoked_at is not null and revoked_by = u and revoke_reason = 'changed my mind' from public.identity_verification_consents where id = id1::uuid)
    and pg_temp.n_audit('consent_revoked', id1) = 1, r);
  perform pg_temp.chk('withdraw does not touch someone else''s consent',
    (select count(*) from public.identity_verification_consents where user_id = other and revoked_at is null) = 1);
  perform pg_temp.chk('has_consent false after withdrawal', pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'customer')$q$, u)) = 'false');
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_withdraw_consent()$q$);
  perform pg_temp.chk('second withdraw: revoked 0, no new audit', (r::jsonb->>'revoked')::int = 0 and pg_temp.n_audit('consent_revoked', id1) = 1, r);
  perform pg_temp.chk('withdraw with a too-long reason refused', pg_temp.as_(u, 'authenticated', format($q$public.idv_withdraw_consent(%L)$q$, repeat('x', 501))) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('withdraw not signed in refused', pg_temp.as_(null, 'authenticated', $q$public.idv_withdraw_consent()$q$) = 'ERR:P0001:not_signed_in');
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  id2 := r::jsonb->>'consent_id';
  perform pg_temp.chk('consenting again after withdrawal makes a NEW row (history kept)', (r::jsonb->>'created')::boolean and id2 <> id1
    and (select count(*) from public.identity_verification_consents where user_id = u) = 2);
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('giving it again with a withdrawn row in history returns the LIVE consent id',
    not (r::jsonb->>'created')::boolean and r::jsonb->>'consent_id' = id2, r);
  -- guard trigger (as superuser, the strongest caller)
  begin update public.identity_verification_consents set consent_version = 'v9' where id = id2::uuid; got := 'updated'; exception when others then got := sqlerrm; end;
  perform pg_temp.chk('guard: version cannot be edited', got = 'A consent record cannot be edited. Record a new one.', got);
  begin update public.identity_verification_consents set revoked_at = now() + interval '1 day' where id = id1::uuid; got := 'updated'; exception when others then got := sqlerrm; end;
  perform pg_temp.chk('guard: a withdrawn consent cannot be changed', got = 'This consent has already been withdrawn.', got);
  begin delete from public.identity_verification_consents where id = id2::uuid; got := 'deleted'; exception when others then got := sqlerrm; end;
  perform pg_temp.chk('guard: no deletes', got = 'Consent records cannot be deleted.', got);
end $$;

-- ===== D. Local Tasker consent by a coordinator =====
do $$
declare c uuid := pg_temp.mk_coord(); c2 uuid := pg_temp.mk_coord(); csus uuid := pg_temp.mk_coord('suspended');
        t uuid := pg_temp.mk_local(c); tended uuid := pg_temp.mk_local(c, true); tnone uuid := pg_temp.mk_local(); plain uuid := pg_temp.mk_user();
        r text; id1 text;
begin
  perform pg_temp.chk('anon cannot run idv_record_local_consent', pg_temp.as_(null, 'anon', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, t)) like 'ERR:42501%');
  perform pg_temp.chk('not signed in refused', pg_temp.as_(null, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, t)) = 'ERR:P0001:not_signed_in');
  perform pg_temp.chk('a user who is not a coordinator refused', pg_temp.as_(plain, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, t)) = 'ERR:P0001:not_active_coordinator');
  perform pg_temp.chk('a suspended coordinator refused', pg_temp.as_(csus, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, t)) = 'ERR:P0001:not_active_coordinator');
  perform pg_temp.chk('another coordinator (not assigned) refused', pg_temp.as_(c2, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, t)) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('an ended assignment refused', pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, tended)) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('a Local Tasker with no assignment refused', pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, tnone)) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('an unknown id refused', pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, gen_random_uuid())) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('null tasker refused', pg_temp.as_(c, 'authenticated', $q$public.idv_record_local_consent(null, 'in_person')$q$) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('bad method refused', pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'telepathy')$q$, t)) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('null method refused', pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, null)$q$, t)) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('over-long evidence ref refused', pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'written', %L)$q$, t, repeat('x', 501))) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('over-long details refused', pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'written', null, %L)$q$, t, repeat('x', 1001))) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('nothing stored by any refusal', (select count(*) from public.local_tasker_consents where purpose = 'identity_verification' and tasker_user_id in (t, tended, tnone)) = 0);
  perform pg_temp.chk('has_consent false before any consent', pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'tasker_local')$q$, t)) = 'false');

  r := pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person', '  note-1  ', 'with the tasker present')$q$, t));
  id1 := r::jsonb->>'consent_id';
  perform pg_temp.chk('assigned coordinator records consent: created, purpose, method, recorded_by, trimmed evidence',
    (r::jsonb->>'created')::boolean and (select purpose = 'identity_verification' and method = 'in_person' and recorded_by = c
        and evidence_ref = 'note-1' and details = 'with the tasker present' and revoked_at is null
        from public.local_tasker_consents where id = id1::uuid), r);
  perform pg_temp.chk('audit row consent_recorded for the local consent, actor = the coordinator, role coordinator, no free text',
    (select after_data = jsonb_build_object('tasker_user_id', t, 'purpose', 'identity_verification', 'method', 'in_person')
        and actor_id = c and actor_role = 'coordinator' from public.local_tasker_audit_log where entity_id = id1 and action = 'consent_recorded'));
  perform pg_temp.chk('has_consent true for the Local Tasker, and false for a regular user id',
    pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'tasker_local')$q$, t)) = 'true'
    and pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'tasker_regular')$q$, t)) = 'false');
  r := pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'phone')$q$, t));
  perform pg_temp.chk('recording again reuses the live consent (created false, same id, no new row or audit)',
    not (r::jsonb->>'created')::boolean and r::jsonb->>'consent_id' = id1
    and (select count(*) from public.local_tasker_consents where tasker_user_id = t and purpose = 'identity_verification') = 1
    and pg_temp.n_audit('consent_recorded', id1) = 1, r);
  -- withdrawn (set by a support person directly, as no function offers it yet) -> not valid; a new one can be recorded
  update public.local_tasker_consents set revoked_at = now(), revoked_by = c where id = id1::uuid;
  perform pg_temp.chk('has_consent false once that consent is withdrawn', pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'tasker_local')$q$, t)) = 'false');
  r := pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'written')$q$, t));
  perform pg_temp.chk('after withdrawal a new consent can be recorded (new row)', (r::jsonb->>'created')::boolean and r::jsonb->>'consent_id' <> id1
    and pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'tasker_local')$q$, t)) = 'true', r);
  -- consent of a different purpose does not count
  insert into public.local_tasker_consents(tasker_user_id, purpose, method, recorded_by) values (tnone, 'profile', 'in_person', c);
  perform pg_temp.chk('a consent for another purpose does not count', pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'tasker_local')$q$, tnone)) = 'false');
end $$;

-- ===== E. idv_has_consent, version bump, privileges =====
do $$
declare u uuid := pg_temp.mk_user(); r text;
begin
  perform pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('idv_consent_version is v1 and readable by authenticated and service_role',
    pg_temp.as_(u, 'authenticated', $q$public.idv_consent_version()$q$) = 'v1' and pg_temp.as_(null, 'service_role', $q$public.idv_consent_version()$q$) = 'v1');
  perform pg_temp.chk('unknown subject kind raises', pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'robot')$q$, u)) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('null user -> false', pg_temp.as_(null, 'service_role', $q$public.idv_has_consent(null, 'customer')$q$) = 'false');
  perform pg_temp.chk('anon and authenticated cannot run idv_has_consent',
    pg_temp.as_(null, 'anon', format($q$public.idv_has_consent(%L, 'customer')$q$, u)) like 'ERR:42501%'
    and pg_temp.as_(u, 'authenticated', format($q$public.idv_has_consent(%L, 'customer')$q$, u)) like 'ERR:42501%');
  perform pg_temp.chk('anon cannot run idv_withdraw_consent or idv_consent_version',
    pg_temp.as_(null, 'anon', $q$public.idv_withdraw_consent()$q$) like 'ERR:42501%' and pg_temp.as_(null, 'anon', $q$public.idv_consent_version()$q$) like 'ERR:42501%');
  -- service_role keeps Supabase's default EXECUTE, but it has no user id, so the function refuses it
  perform pg_temp.chk('service_role calling the give function has no user id and is refused',
    pg_temp.as_(null, 'service_role', $q$public.idv_give_consent('v1')$q$) = 'ERR:P0001:not_signed_in');
end $$;
-- Bump the version: old consents stop counting, the old text is refused
create or replace function public.idv_consent_version() returns text language sql immutable set search_path = public, pg_temp as $$ select 'v2'::text $$;
do $$
declare u uuid := (select user_id from public.identity_verification_consents where revoked_at is null limit 1); r text;
begin
  perform pg_temp.chk('after a version bump the old consent no longer counts',
    pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'customer')$q$, u)) = 'false');
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('after a version bump the old text is refused', r = 'ERR:P0001:consent_version_mismatch', r);
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v2')$q$);
  perform pg_temp.chk('the new text can be accepted and then counts', (r::jsonb->>'created')::boolean
    and pg_temp.as_(null, 'service_role', format($q$public.idv_has_consent(%L, 'customer')$q$, u)) = 'true', r);
end $$;
create or replace function public.idv_consent_version() returns text language sql immutable set search_path = public, pg_temp as $$ select 'v1'::text $$;

-- ===== F. an audit failure means no consent is recorded =====
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'audit boom'; end $$;
create trigger t_audit_boom before insert on public.local_tasker_audit_log for each row execute function pg_temp.boom();
do $$
declare u uuid := pg_temp.mk_user(); c uuid := pg_temp.mk_coord(); t uuid; r text;
begin
  t := pg_temp.mk_local(c);
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('self consent: audit failure -> error and no row', r like 'ERR:P0001%' and not exists (select 1 from public.identity_verification_consents where user_id = u), r);
  r := pg_temp.as_(c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, t));
  perform pg_temp.chk('local consent: audit failure -> error and no row', r like 'ERR:P0001%' and not exists (select 1 from public.local_tasker_consents where tasker_user_id = t), r);
end $$;
drop trigger t_audit_boom on public.local_tasker_audit_log;

-- ===== G. migration safety: re-run, rollback, re-apply =====
\i v1c1-consent.sql
select pg_temp.chk('re-running v1c1 keeps existing consent rows', (select count(*) from public.identity_verification_consents) >= 3);
select pg_temp.chk('re-running v1c1 keeps the 7-value purpose list',
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'local_tasker_consents_purpose_check') like '%identity_verification%');
\i v1c1-rollback.sql
select pg_temp.chk('rollback drops the five functions and the guard function',
  not exists (select 1 from pg_proc where proname in ('idv_has_consent', 'idv_record_local_consent', 'idv_withdraw_consent', 'idv_give_consent', 'idv_consent_version', 'idv_consent_guard')));
select pg_temp.chk('rollback keeps the self consent table and its rows', (select count(*) from public.identity_verification_consents) >= 3);
select pg_temp.chk('rollback keeps the existing identity_verification consent rows',
  (select count(*) from public.local_tasker_consents where purpose = 'identity_verification') >= 1);
do $$
declare got text;
begin
  begin insert into public.local_tasker_consents(tasker_user_id, purpose, method, recorded_by)
        values ((select tasker_user_id from public.local_tasker_profiles limit 1), 'identity_verification', 'phone', gen_random_uuid()); got := 'inserted';
  exception when check_violation then got := 'refused'; end;
  perform pg_temp.chk('after rollback a NEW identity_verification consent is refused again', got = 'refused', got);
end $$;
\i v1c1-consent.sql
do $$
declare u uuid := pg_temp.mk_user(); r text;
begin
  r := pg_temp.as_(u, 'authenticated', $q$public.idv_give_consent('v1')$q$);
  perform pg_temp.chk('re-applied after rollback: works again', (r::jsonb->>'created')::boolean, r);
end $$;

-- Report
select n, case when ok then 'PASS' else 'FAIL' end as result, label, detail from results where not ok order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
do $$ begin
  if exists (select 1 from pg_temp.results where not ok) then raise exception 'V1c-1 tests FAILED'; end if;
end $$;

-- SCRATCH POSTGRES ONLY. Tests for v1c2-idv-start-read.sql. ONE psql session, from the folder with the SQL files,
-- on a FRESH database:
--   psql -v ON_ERROR_STOP=1 -f v1a-scratch-setup.sql -f v1a-tables.sql -f v1b1-idv-apply-core.sql \
--        -f v1b2-scratch-standins.sql -f v1c1-scratch-standins.sql -f v1b2-idv-apply-effects.sql \
--        -f v1c1-consent.sql -f v1c2-idv-start-read.sql -f v1c2-tests.sql
-- users/taskers/coordinators/assignments/consents/audit are STAND-INS (see the two scratch-standins files).

create temp table results (n serial, label text, ok boolean, detail text);
create function pg_temp.chk(p_label text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into pg_temp.results(label, ok, detail) values (p_label, coalesce(p_ok, false), p_detail) $$;

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
create function pg_temp.mk_tasker() returns uuid language plpgsql as $$
declare u uuid := pg_temp.mk_user(); begin insert into public.taskers(user_id) values (u::text); return u; end $$;
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
create function pg_temp.give(p_u uuid) returns void language plpgsql as $$
begin perform pg_temp.as_(p_u, 'authenticated', $q$public.idv_give_consent('v1')$q$); end $$;
create function pg_temp.lcons(p_c uuid, p_t uuid) returns void language plpgsql as $$
begin perform pg_temp.as_(p_c, 'authenticated', format($q$public.idv_record_local_consent(%L, 'in_person')$q$, p_t)); end $$;
-- start as the server (service_role)
create function pg_temp.st(p_caller uuid, p_mode text, p_target uuid, p_env text default 'sandbox', p_req text default null) returns text
language plpgsql as $$
begin return pg_temp.as_(null, 'service_role', format($q$public.idv_start_attempt(%L, %L, %L, %L, %L)$q$, p_caller, p_mode, p_target, p_env, p_req)); end $$;
-- apply a Didit event as the server
create function pg_temp.evt(p_session text, p_status text, p_ts timestamptz default now(), p_live boolean default null, p_face boolean default null,
                            p_nin text default null, p_fetched boolean default false) returns text
language plpgsql as $$
begin return pg_temp.as_(null, 'service_role', format(
  $q$public.idv_apply_event(%L, %L, 'status.updated', %L, 'sandbox', %L, null, %L, %L, %L, null, %L, false, null)$q$,
  gen_random_uuid()::text, p_session, p_status, p_ts, p_fetched, p_live, p_face, p_nin)); end $$;
create function pg_temp.vid(p_st text) returns uuid language sql as $$ select (p_st::jsonb->>'verification_id')::uuid $$;
create function pg_temp.status_of(p_id uuid) returns text language sql as $$ select status from public.identity_verifications where id = p_id $$;
create function pg_temp.n_audit(p_action text, p_entity_id text) returns bigint language sql as
$$ select count(*) from public.local_tasker_audit_log where action = p_action and entity_id = p_entity_id $$;

-- ===== A. who may run what =====
do $$
declare u uuid := pg_temp.mk_user(); r text;
begin
  perform pg_temp.chk('anon cannot run idv_start_attempt', pg_temp.as_(null, 'anon', format($q$public.idv_start_attempt(%L, 'self', null, 'sandbox', null)$q$, u)) like 'ERR:42501%');
  perform pg_temp.chk('authenticated cannot run idv_start_attempt', pg_temp.as_(u, 'authenticated', format($q$public.idv_start_attempt(%L, 'self', null, 'sandbox', null)$q$, u)) like 'ERR:42501%');
  perform pg_temp.chk('authenticated cannot run idv_attach_session', pg_temp.as_(u, 'authenticated', format($q$public.idv_attach_session(%L, 's1', null)$q$, gen_random_uuid())) like 'ERR:42501%');
  perform pg_temp.chk('authenticated cannot run idv_mark_pending', pg_temp.as_(u, 'authenticated', format($q$public.idv_mark_pending(%L)$q$, gen_random_uuid())) like 'ERR:42501%');
  perform pg_temp.chk('authenticated cannot run the private helper idv_subject_kind', pg_temp.as_(u, 'authenticated', format($q$public.idv_subject_kind(%L)$q$, u)) like 'ERR:42501%');
  perform pg_temp.chk('anon cannot run the three read functions',
    pg_temp.as_(null, 'anon', $q$public.idv_my_status()$q$) like 'ERR:42501%'
    and pg_temp.as_(null, 'anon', $q$public.idv_local_status_list()$q$) like 'ERR:42501%'
    and pg_temp.as_(null, 'anon', format($q$public.idv_local_status(%L)$q$, u)) like 'ERR:42501%');
  perform pg_temp.chk('service_role cannot run the browser read functions with no user (refused, not_signed_in)',
    pg_temp.as_(null, 'service_role', $q$public.idv_my_status()$q$) = 'ERR:P0001:not_signed_in');
  perform pg_temp.chk('browser roles still hold no privilege on the two tables',
    pg_temp.as_(u, 'authenticated', $q$(select count(*) from public.identity_verifications)$q$) like 'ERR:42501%'
    and pg_temp.as_(u, 'authenticated', $q$stmt:update public.identity_verifications set status = 'VERIFIED'$q$) like 'ERR:42501%'
    and pg_temp.as_(null, 'anon', $q$(select count(*) from public.identity_verification_events)$q$) like 'ERR:42501%');
end $$;

-- ===== B. start in self mode =====
do $$
declare cust uuid := pg_temp.mk_user(); tk uuid := pg_temp.mk_tasker(); loc uuid := pg_temp.mk_local(); r text; r2 text; v uuid; n0 bigint;
begin
  -- input checks
  perform pg_temp.chk('null caller refused', pg_temp.st(null, 'self', null) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('bad mode refused', pg_temp.st(cust, 'admin', null) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('null mode refused', pg_temp.st(cust, null, null) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('bad environment refused', pg_temp.st(cust, 'self', null, 'prod') = 'ERR:P0001:bad_input');
  perform pg_temp.chk('null environment refused', pg_temp.st(cust, 'self', null, null) = 'ERR:P0001:bad_input');
  perform pg_temp.chk('too-long request id refused', pg_temp.st(cust, 'self', null, 'sandbox', repeat('x', 101)) = 'ERR:P0001:bad_input');
  -- consent required
  r := pg_temp.st(cust, 'self', null);
  perform pg_temp.chk('customer without consent: consent_required', r = 'ERR:P0001:consent_required', r);
  perform pg_temp.chk('regular tasker without consent: consent_required', pg_temp.st(tk, 'self', null) = 'ERR:P0001:consent_required');
  perform pg_temp.chk('nothing stored by the refusals', (select count(*) from public.identity_verifications where user_id in (cust, tk)) = 0);
  -- a Local Tasker identity cannot use self mode
  perform pg_temp.chk('a Local Tasker cannot start in self mode', pg_temp.st(loc, 'self', null) = 'ERR:P0001:not_for_local_tasker');

  -- customer with consent
  perform pg_temp.give(cust);
  r := pg_temp.st(cust, 'self', gen_random_uuid());      -- a browser-supplied target must be ignored in self mode
  v := pg_temp.vid(r);
  perform pg_temp.chk('customer start: created, NOT_STARTED, kind customer, no session yet, user = caller',
    (r::jsonb->>'reused')::boolean = false and r::jsonb->>'status' = 'NOT_STARTED' and r::jsonb->>'subject_kind' = 'customer'
    and r::jsonb->>'provider_session_id' is null and (r::jsonb->>'user_id')::uuid = cust, r);
  perform pg_temp.chk('stored row: user, kind, environment, created_by = caller, no provider fields',
    (select user_id = cust and subject_kind = 'customer' and environment = 'sandbox' and created_by = cust
            and provider_session_id is null and liveness_ok is null and face_match_ok is null from public.identity_verifications where id = v));
  perform pg_temp.chk('one audit row idv.attempt_created with kind and mode only, actor = caller',
    pg_temp.n_audit('idv.attempt_created', v::text) = 1
    and (select after_data = '{"subject_kind":"customer","mode":"self"}'::jsonb and actor_id = cust from public.local_tasker_audit_log where entity_id = v::text and action = 'idv.attempt_created'));
  -- reuse of the open attempt
  r2 := pg_temp.st(cust, 'self', null);
  perform pg_temp.chk('second start reuses the open attempt (same id, reused true, no new row or audit)',
    (r2::jsonb->>'reused')::boolean and pg_temp.vid(r2) = v
    and (select count(*) from public.identity_verifications where user_id = cust) = 1 and pg_temp.n_audit('idv.attempt_created', v::text) = 1, r2);

  -- regular tasker gets the tasker kind
  perform pg_temp.give(tk);
  r := pg_temp.st(tk, 'self', null);
  perform pg_temp.chk('regular tasker start: kind tasker_regular', r::jsonb->>'subject_kind' = 'tasker_regular', r);

  -- request-id retry
  declare c2 uuid := pg_temp.mk_user(); a text; b text;
  begin
    perform pg_temp.give(c2);
    a := pg_temp.st(c2, 'self', null, 'sandbox', 'req-1');
    b := pg_temp.st(c2, 'self', null, 'sandbox', 'req-1');
    perform pg_temp.chk('same request id returns the same attempt', pg_temp.vid(a) = pg_temp.vid(b) and (b::jsonb->>'reused')::boolean, b);
    perform pg_temp.chk('request id is stored on the row', (select request_id = 'req-1' from public.identity_verifications where id = pg_temp.vid(a)));
    perform pg_temp.as_(c2, 'authenticated', $q$public.idv_withdraw_consent('x')$q$);
    perform pg_temp.chk('after withdrawal the same request id is refused (consent_required), the row is untouched',
      pg_temp.st(c2, 'self', null, 'sandbox', 'req-1') = 'ERR:P0001:consent_required' and pg_temp.status_of(pg_temp.vid(a)) = 'NOT_STARTED');
    perform pg_temp.chk('after withdrawal a plain start is refused too', pg_temp.st(c2, 'self', null) = 'ERR:P0001:consent_required');
  end;
end $$;

-- ===== C. start in proxy mode (coordinator for a Local Tasker) =====
do $$
declare c uuid := pg_temp.mk_coord(); c2 uuid := pg_temp.mk_coord(); csus uuid := pg_temp.mk_coord('suspended'); plain uuid := pg_temp.mk_user();
  t uuid; t_other uuid; t_ended uuid; t_susp uuid; r text; v uuid;
begin
  t := pg_temp.mk_local(c); t_other := pg_temp.mk_local(c2); t_ended := pg_temp.mk_local(c, true); t_susp := pg_temp.mk_local(csus);
  perform pg_temp.lcons(c, t); perform pg_temp.lcons(c2, t_other);
  perform pg_temp.chk('proxy: caller who is not a coordinator refused', pg_temp.st(plain, 'proxy', t) = 'ERR:P0001:not_active_coordinator');
  perform pg_temp.chk('proxy: suspended coordinator refused', pg_temp.st(csus, 'proxy', t_susp) = 'ERR:P0001:not_active_coordinator');
  perform pg_temp.chk('proxy: tasker assigned to another coordinator refused', pg_temp.st(c, 'proxy', t_other) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('proxy: ended assignment refused', pg_temp.st(c, 'proxy', t_ended) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('proxy: null target refused', pg_temp.st(c, 'proxy', null) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('proxy: unknown target refused', pg_temp.st(c, 'proxy', gen_random_uuid()) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('proxy: assigned tasker without consent refused', pg_temp.st(c, 'proxy', (select x from (select pg_temp.mk_local(c) x) q)) = 'ERR:P0001:consent_required');
  perform pg_temp.chk('proxy: nothing stored by the refusals', (select count(*) from public.identity_verifications where user_id in (t_other, t_ended, t_susp)) = 0);

  r := pg_temp.st(c, 'proxy', t, 'sandbox', 'p-1');
  v := pg_temp.vid(r);
  perform pg_temp.chk('proxy start: created for the tasker, kind tasker_local, created_by = coordinator',
    not (r::jsonb->>'reused')::boolean and (r::jsonb->>'user_id')::uuid = t and r::jsonb->>'subject_kind' = 'tasker_local'
    and (select created_by = c and user_id = t from public.identity_verifications where id = v), r);
  perform pg_temp.chk('proxy audit row: mode proxy, actor = coordinator, role coordinator',
    (select after_data = '{"subject_kind":"tasker_local","mode":"proxy"}'::jsonb and actor_id = c and actor_role = 'coordinator'
       from public.local_tasker_audit_log where entity_id = v::text and action = 'idv.attempt_created'));
  perform pg_temp.chk('proxy: same request id again returns the same attempt', pg_temp.vid(pg_temp.st(c, 'proxy', t, 'sandbox', 'p-1')) = v);
  t_other := pg_temp.mk_local(c); perform pg_temp.lcons(c, t_other);
  perform pg_temp.chk('proxy: same request id for a DIFFERENT tasker refused (bad_input)',
    pg_temp.st(c, 'proxy', t_other, 'sandbox', 'p-1') = 'ERR:P0001:bad_input');
  perform pg_temp.chk('proxy: another start reuses the open attempt', pg_temp.vid(pg_temp.st(c, 'proxy', t)) = v);
  -- a consent withdrawn by... (Local consent has no withdraw function yet) -> simulate a withdrawn live consent
  update public.local_tasker_consents set revoked_at = now(), revoked_by = c where tasker_user_id = t and purpose = 'identity_verification';
  perform pg_temp.chk('proxy: withdrawn Local Tasker consent -> consent_required', pg_temp.st(c, 'proxy', t) = 'ERR:P0001:consent_required');
end $$;

-- ===== D. attach session =====
do $$
declare u uuid := pg_temp.mk_user(); v uuid; r text; w uuid;
begin
  perform pg_temp.give(u); v := pg_temp.vid(pg_temp.st(u, 'self', null));
  perform pg_temp.chk('attach: unknown attempt', pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 's', null)$q$, gen_random_uuid())) = 'ERR:P0001:not_found');
  perform pg_temp.chk('attach: null id / empty session / too long refused',
    pg_temp.as_(null, 'service_role', $q$public.idv_attach_session(null, 's', null)$q$) = 'ERR:P0001:bad_input'
    and pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, '  ', null)$q$, v)) = 'ERR:P0001:bad_input'
    and pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, %L, null)$q$, v, repeat('x', 201))) = 'ERR:P0001:bad_input');
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-A', 'wf-1')$q$, v));
  perform pg_temp.chk('attach sets session and workflow, status unchanged',
    (r::jsonb->>'attached')::boolean and (select provider_session_id = 'sess-A' and workflow_id = 'wf-1' and status = 'NOT_STARTED' from public.identity_verifications where id = v), r);
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-A', 'wf-1')$q$, v));
  perform pg_temp.chk('attaching the same session again is a no-op', not (r::jsonb->>'attached')::boolean, r);
  perform pg_temp.chk('attaching a different session is refused', pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-B', null)$q$, v)) = 'ERR:P0001:session_already_set');
  perform pg_temp.chk('the session is unchanged after the refusal', (select provider_session_id = 'sess-A' from public.identity_verifications where id = v));
  r := pg_temp.st(u, 'self', null);
  perform pg_temp.chk('a reused attempt now returns its session id', r::jsonb->>'provider_session_id' = 'sess-A' and (r::jsonb->>'reused')::boolean, r);
  -- closed attempt
  perform pg_temp.evt('sess-A', 'Declined');
  perform pg_temp.chk('attach on a closed attempt refused (not_open)', pg_temp.status_of(v) = 'FAILED'
    and pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-Z', null)$q$, v)) = 'ERR:P0001:not_open');
end $$;

-- ===== E. mark pending =====
do $$
declare u uuid := pg_temp.mk_user(); v uuid; r text; u2 uuid := pg_temp.mk_user(); v2 uuid;
begin
  perform pg_temp.give(u); v := pg_temp.vid(pg_temp.st(u, 'self', null));
  perform pg_temp.chk('pending: unknown attempt', pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, gen_random_uuid())) = 'ERR:P0001:not_found');
  perform pg_temp.chk('pending: null id refused', pg_temp.as_(null, 'service_role', $q$public.idv_mark_pending(null)$q$) = 'ERR:P0001:bad_input');
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, v));
  perform pg_temp.chk('pending: no session yet -> no change', not (r::jsonb->>'changed')::boolean and pg_temp.status_of(v) = 'NOT_STARTED', r);
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-P', null)$q$, v));
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, v));
  perform pg_temp.chk('pending: NOT_STARTED with a session -> PENDING', (r::jsonb->>'changed')::boolean and pg_temp.status_of(v) = 'PENDING', r);
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, v));
  perform pg_temp.chk('pending: again -> no change', not (r::jsonb->>'changed')::boolean and pg_temp.status_of(v) = 'PENDING', r);
  perform pg_temp.chk('pending: the open-attempt index still holds (start reuses it)', pg_temp.vid(pg_temp.st(u, 'self', null)) = v);
  perform pg_temp.evt('sess-P', 'In Progress');
  perform pg_temp.chk('a later In Progress event moves PENDING on (apply_event still owns the status)', pg_temp.status_of(v) = 'IN_PROGRESS');
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, v));
  perform pg_temp.chk('pending: IN_PROGRESS -> PENDING', (r::jsonb->>'changed')::boolean and pg_temp.status_of(v) = 'PENDING', r);
  perform pg_temp.evt('sess-P', 'In Review');
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, v));
  perform pg_temp.chk('pending: REVIEW_REQUIRED is never moved back to PENDING', not (r::jsonb->>'changed')::boolean and pg_temp.status_of(v) = 'REVIEW_REQUIRED', r);
  -- terminal rows are never touched
  perform pg_temp.give(u2); v2 := pg_temp.vid(pg_temp.st(u2, 'self', null));
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-T', null)$q$, v2));
  perform pg_temp.evt('sess-T', 'Declined');
  r := pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, v2));
  perform pg_temp.chk('pending: FAILED stays FAILED', not (r::jsonb->>'changed')::boolean and pg_temp.status_of(v2) = 'FAILED', r);
end $$;

-- ===== F. verified people, new attempts after a closed one, the 24 hour cap =====
do $$
declare u uuid := pg_temp.mk_user(); v uuid; v2 uuid; r text; n int; f uuid := pg_temp.mk_user(); fv uuid;
begin
  perform pg_temp.give(u); v := pg_temp.vid(pg_temp.st(u, 'self', null));
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-V', null)$q$, v));
  perform pg_temp.evt('sess-V', 'Approved', now(), true, true, 'full_match', true);
  perform pg_temp.chk('setup: Approved with a re-fetched decision -> VERIFIED (by apply_event)', pg_temp.status_of(v) = 'VERIFIED');
  perform pg_temp.chk('start for a VERIFIED person refused (already_verified), no new row',
    pg_temp.st(u, 'self', null) = 'ERR:P0001:already_verified' and (select count(*) from public.identity_verifications where user_id = u) = 1);
  perform pg_temp.chk('already_verified also wins over a retried request id', pg_temp.st(u, 'self', null, 'sandbox', 'zz') = 'ERR:P0001:already_verified');
  perform pg_temp.evt('sess-V', 'Kyc Expired', now() + interval '1 second');
  perform pg_temp.chk('setup: Kyc Expired -> EXPIRED', pg_temp.status_of(v) = 'EXPIRED');
  r := pg_temp.st(u, 'self', null);
  if r like 'ERR%' then raise exception 'start after Kyc Expired: %', r; end if;
  v2 := pg_temp.vid(r);
  perform pg_temp.chk('after Kyc Expired a NEW attempt is created, the old one stays EXPIRED',
    not (r::jsonb->>'reused')::boolean and v2 <> v and pg_temp.status_of(v) = 'EXPIRED' and pg_temp.status_of(v2) = 'NOT_STARTED', r);

  -- FAILED -> a new attempt is allowed; the cap is 5 new attempts per 24 h per environment
  for n in 1..3 loop
    perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, %L, null)$q$, v2, 'sess-F' || n));
    perform pg_temp.evt('sess-F' || n, 'Declined');
    v2 := pg_temp.vid(pg_temp.st(u, 'self', null));
  end loop;
  perform pg_temp.chk('user has 5 attempts so far (1 expired + 4 more, the last one still open)', (select count(*) from public.identity_verifications where user_id = u and environment = 'sandbox') = 5);
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-F5', null)$q$, v2));
  perform pg_temp.evt('sess-F5', 'Declined');
  perform pg_temp.chk('the sixth attempt inside 24 hours is refused (too_many_attempts)', pg_temp.st(u, 'self', null) = 'ERR:P0001:too_many_attempts');
  perform pg_temp.chk('the cap is per environment: live is still allowed', pg_temp.st(u, 'self', null, 'live') is not null and pg_temp.st(u, 'self', null, 'live') not like 'ERR%');
  update public.identity_verifications set created_at = now() - interval '25 hours' where user_id = u and environment = 'sandbox' and status = 'EXPIRED';
  perform pg_temp.chk('attempts older than 24 hours stop counting', pg_temp.st(u, 'self', null) not like 'ERR%');
end $$;

-- ===== G. my status =====
do $$
declare a uuid := pg_temp.mk_user(); b uuid := pg_temp.mk_tasker(); loc uuid := pg_temp.mk_local(); r jsonb; va uuid; vb uuid; txt text;
begin
  perform pg_temp.chk('my_status: not signed in', pg_temp.as_(null, 'authenticated', $q$public.idv_my_status()$q$) = 'ERR:P0001:not_signed_in');
  perform pg_temp.chk('my_status: a Local Tasker identity refused', pg_temp.as_(loc, 'authenticated', $q$public.idv_my_status()$q$) = 'ERR:P0001:not_for_local_tasker');
  r := pg_temp.as_(a, 'authenticated', $q$public.idv_my_status()$q$)::jsonb;
  perform pg_temp.chk('my_status for a new customer: NOT_STARTED, no attempt, no consent, not verified, version v1, kind customer',
    r->>'status' = 'NOT_STARTED' and not (r->>'has_attempt')::boolean and not (r->>'has_open_attempt')::boolean and not (r->>'verified')::boolean
    and not (r->>'consent_given')::boolean and r->>'consent_version' = 'v1' and r->>'subject_kind' = 'customer' and not (r->>'needs_review')::boolean, r::text);
  perform pg_temp.give(a);
  r := pg_temp.as_(a, 'authenticated', $q$public.idv_my_status()$q$)::jsonb;
  perform pg_temp.chk('my_status after consent: consent_given true, still no attempt', (r->>'consent_given')::boolean and not (r->>'has_attempt')::boolean, r::text);
  va := pg_temp.vid(pg_temp.st(a, 'self', null));
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-G1', 'wf-secret')$q$, va));
  r := pg_temp.as_(a, 'authenticated', $q$public.idv_my_status()$q$)::jsonb;
  perform pg_temp.chk('my_status with an open attempt: NOT_STARTED, has_attempt and has_open_attempt true, started_at set',
    r->>'status' = 'NOT_STARTED' and (r->>'has_attempt')::boolean and (r->>'has_open_attempt')::boolean and r->>'started_at' is not null and r->>'completed_at' is null, r::text);
  perform pg_temp.give(b); vb := pg_temp.vid(pg_temp.st(b, 'self', null));
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-G2', null)$q$, vb));
  perform pg_temp.evt('sess-G2', 'Declined');
  r := pg_temp.as_(b, 'authenticated', $q$public.idv_my_status()$q$)::jsonb;
  perform pg_temp.chk('my_status sees only its own row: b is FAILED, a is still NOT_STARTED; kind tasker_regular',
    r->>'status' = 'FAILED' and r->>'subject_kind' = 'tasker_regular' and not (r->>'has_open_attempt')::boolean and r->>'completed_at' is not null
    and pg_temp.as_(a, 'authenticated', $q$public.idv_my_status()$q$)::jsonb->>'status' = 'NOT_STARTED', r::text);
  -- review: scores are stored but never shown
  perform pg_temp.evt('sess-G1', 'Approved', now(), false, true, 'full_match', true);   -- failed liveness -> REVIEW_REQUIRED, scores stored
  perform pg_temp.chk('setup: Approved with failed liveness -> REVIEW_REQUIRED with scores stored',
    pg_temp.status_of(va) = 'REVIEW_REQUIRED' and (select liveness_ok = false and face_match_ok = true and nin_database_match = 'full_match' from public.identity_verifications where id = va));
  txt := pg_temp.as_(a, 'authenticated', $q$public.idv_my_status()$q$);
  r := txt::jsonb;
  perform pg_temp.chk('my_status: REVIEW_REQUIRED sets needs_review', r->>'status' = 'REVIEW_REQUIRED' and (r->>'needs_review')::boolean, txt);
  perform pg_temp.chk('my_status: exact key list (no scores, reason codes, session or workflow)',
    (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['completed_at','consent_given','consent_version','has_attempt','has_open_attempt','needs_review','started_at','status','subject_kind','updated_at','verified'], txt);
  perform pg_temp.chk('my_status text contains no session id, workflow id or check names',
    txt not like '%sess-G1%' and txt not like '%wf-secret%' and txt not like '%liveness%' and txt not like '%face%' and txt not like '%nin%' and txt not like '%full_match%' and txt not like '%reason%', txt);
  -- verified flag
  declare c uuid := pg_temp.mk_user(); vc uuid; t2 text;
  begin
    perform pg_temp.give(c); vc := pg_temp.vid(pg_temp.st(c, 'self', null));
    perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-G3', null)$q$, vc));
    perform pg_temp.evt('sess-G3', 'Approved', now(), true, true, 'full_match', true);
    r := pg_temp.as_(c, 'authenticated', $q$public.idv_my_status()$q$)::jsonb;
    perform pg_temp.chk('my_status: VERIFIED -> verified true, closed, completed_at set', r->>'status' = 'VERIFIED' and (r->>'verified')::boolean and not (r->>'has_open_attempt')::boolean and r->>'completed_at' is not null, r::text);
  end;
end $$;

-- ===== H. coordinator reads =====
do $$
declare c uuid := pg_temp.mk_coord(); c2 uuid := pg_temp.mk_coord(); csus uuid := pg_temp.mk_coord('suspended'); c3 uuid := pg_temp.mk_coord(); plain uuid := pg_temp.mk_user();
  t1 uuid; t2 uuid; t3 uuid; t_other uuid; t_ended uuid; v uuid; r jsonb; txt text; lst jsonb;
begin
  t1 := pg_temp.mk_local(c); t2 := pg_temp.mk_local(c); t3 := pg_temp.mk_local(c); t_other := pg_temp.mk_local(c2); t_ended := pg_temp.mk_local(c, true);
  perform pg_temp.chk('local_status: not signed in', pg_temp.as_(null, 'authenticated', format($q$public.idv_local_status(%L)$q$, t1)) = 'ERR:P0001:not_signed_in');
  perform pg_temp.chk('local_status: not a coordinator', pg_temp.as_(plain, 'authenticated', format($q$public.idv_local_status(%L)$q$, t1)) = 'ERR:P0001:not_active_coordinator');
  perform pg_temp.chk('local_status: suspended coordinator', pg_temp.as_(csus, 'authenticated', format($q$public.idv_local_status(%L)$q$, t1)) = 'ERR:P0001:not_active_coordinator');
  perform pg_temp.chk('local_status: another coordinator''s tasker', pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, t_other)) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('local_status: ended assignment', pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, t_ended)) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('local_status: null / unknown tasker',
    pg_temp.as_(c, 'authenticated', $q$public.idv_local_status(null)$q$) = 'ERR:P0001:not_assigned'
    and pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, gen_random_uuid())) = 'ERR:P0001:not_assigned');
  perform pg_temp.chk('local_status_list: not signed in / not a coordinator / suspended',
    pg_temp.as_(null, 'authenticated', $q$public.idv_local_status_list()$q$) = 'ERR:P0001:not_signed_in'
    and pg_temp.as_(plain, 'authenticated', $q$public.idv_local_status_list()$q$) = 'ERR:P0001:not_active_coordinator'
    and pg_temp.as_(csus, 'authenticated', $q$public.idv_local_status_list()$q$) = 'ERR:P0001:not_active_coordinator');
  perform pg_temp.chk('local_status_list: a coordinator with nobody assigned gets []', pg_temp.as_(c3, 'authenticated', $q$public.idv_local_status_list()$q$) = '[]');

  r := pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, t1))::jsonb;
  perform pg_temp.chk('local_status before anything: NOT_STARTED, no attempt, no consent',
    r->>'status' = 'NOT_STARTED' and not (r->>'has_attempt')::boolean and not (r->>'consent_given')::boolean and not (r->>'verified')::boolean and (r->>'tasker_user_id')::uuid = t1, r::text);
  perform pg_temp.lcons(c, t1); perform pg_temp.lcons(c, t2); perform pg_temp.lcons(c, t3);
  r := pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, t1))::jsonb;
  perform pg_temp.chk('local_status after consent: consent_given true', (r->>'consent_given')::boolean, r::text);
  -- t1: review; t2: verified; t3: open attempt
  v := pg_temp.vid(pg_temp.st(c, 'proxy', t1)); perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-H1', 'wf-hidden')$q$, v));
  perform pg_temp.evt('sess-H1', 'In Review');
  v := pg_temp.vid(pg_temp.st(c, 'proxy', t2)); perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-H2', null)$q$, v));
  perform pg_temp.evt('sess-H2', 'Approved', now(), true, true, 'full_match', true);
  v := pg_temp.vid(pg_temp.st(c, 'proxy', t3));
  txt := pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, t1));
  r := txt::jsonb;
  perform pg_temp.chk('local_status: review -> needs_review true', r->>'status' = 'REVIEW_REQUIRED' and (r->>'needs_review')::boolean and (r->>'has_open_attempt')::boolean, txt);
  perform pg_temp.chk('local_status: exact key list (no scores, reason codes, session or workflow)',
    (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['completed_at','consent_given','has_attempt','has_open_attempt','needs_review','started_at','status','tasker_user_id','updated_at','verified'], txt);
  perform pg_temp.chk('local_status text contains no session id, workflow id or check names',
    txt not like '%sess-H1%' and txt not like '%wf-hidden%' and txt not like '%liveness%' and txt not like '%face%' and txt not like '%nin_%' and txt not like '%reason%', txt);
  perform pg_temp.chk('local_status: verified one shows verified true',
    (pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, t2))::jsonb->>'verified')::boolean);

  txt := pg_temp.as_(c, 'authenticated', $q$public.idv_local_status_list()$q$);
  lst := txt::jsonb;
  perform pg_temp.chk('list: only the three assigned, un-ended Local Taskers (not the other coordinator''s, not the ended one)',
    jsonb_array_length(lst) = 3
    and not exists (select 1 from jsonb_array_elements(lst) e where (e->>'tasker_user_id')::uuid in (t_other, t_ended)), txt);
  perform pg_temp.chk('list: statuses and flags per tasker',
    (select e->>'status' = 'REVIEW_REQUIRED' and (e->>'needs_review')::boolean from jsonb_array_elements(lst) e where (e->>'tasker_user_id')::uuid = t1)
    and (select e->>'status' = 'VERIFIED' and (e->>'verified')::boolean and e->>'completed_at' is not null from jsonb_array_elements(lst) e where (e->>'tasker_user_id')::uuid = t2)
    and (select e->>'status' = 'NOT_STARTED' and (e->>'has_open_attempt')::boolean from jsonb_array_elements(lst) e where (e->>'tasker_user_id')::uuid = t3), txt);
  perform pg_temp.chk('list: exact key list per entry, no secrets in the text',
    (select array_agg(k order by k) from jsonb_object_keys(lst->0) k) = array['completed_at','consent_given','has_attempt','has_open_attempt','needs_review','status','tasker_user_id','verified']
    and txt not like '%sess-H%' and txt not like '%wf-hidden%' and txt not like '%liveness%' and txt not like '%reason%', txt);
  perform pg_temp.chk('list: the other coordinator sees only theirs',
    jsonb_array_length(pg_temp.as_(c2, 'authenticated', $q$public.idv_local_status_list()$q$)::jsonb) = 1
    and (pg_temp.as_(c2, 'authenticated', $q$public.idv_local_status_list()$q$)::jsonb->0->>'tasker_user_id')::uuid = t_other);
  -- an assignment that ends removes the tasker from the list and from local_status
  update public.coordinator_assignments set ended_at = now() where tasker_user_id = t3;
  perform pg_temp.chk('after an assignment ends the tasker leaves the list and local_status refuses',
    jsonb_array_length(pg_temp.as_(c, 'authenticated', $q$public.idv_local_status_list()$q$)::jsonb) = 2
    and pg_temp.as_(c, 'authenticated', format($q$public.idv_local_status(%L)$q$, t3)) = 'ERR:P0001:not_assigned');
  -- a coordinator who is suspended after the fact loses the list
  update public.coordinators set status = 'suspended' where user_id = c3;
  perform pg_temp.chk('a coordinator suspended later is refused', pg_temp.as_(c3, 'authenticated', $q$public.idv_local_status_list()$q$) = 'ERR:P0001:not_active_coordinator');
end $$;

-- ===== I. nothing here can verify anyone =====
do $$
declare u uuid := pg_temp.mk_tasker(); v uuid; loc uuid; c uuid := pg_temp.mk_coord(); before_n bigint;
begin
  select count(*) into before_n from public.identity_verifications where status = 'VERIFIED';
  perform pg_temp.give(u); v := pg_temp.vid(pg_temp.st(u, 'self', null));
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_attach_session(%L, 'sess-I', null)$q$, v));
  perform pg_temp.as_(null, 'service_role', format($q$public.idv_mark_pending(%L)$q$, v));
  perform pg_temp.as_(u, 'authenticated', $q$public.idv_my_status()$q$);
  perform pg_temp.chk('start + attach + pending + read leave the person unverified: no VERIFIED row, users and taskers flags false',
    (select count(*) from public.identity_verifications where status = 'VERIFIED') = before_n
    and (select coalesce(is_verified, false) = false and verified_at is null from public.users where id = u)
    and (select coalesce(is_verified, false) = false and coalesce(verified, false) = false and verified_at is null from public.taskers where user_id = u::text), pg_temp.status_of(v));
  perform pg_temp.chk('no new function accepts a status argument (only idv_apply_event does)',
    not exists (select 1 from pg_proc p where p.proname in ('idv_start_attempt', 'idv_attach_session', 'idv_mark_pending', 'idv_my_status', 'idv_local_status', 'idv_local_status_list')
                 and pg_get_function_arguments(p.oid) ilike '%status%'));
  perform pg_temp.chk('the three server functions are executable by service_role only; the three readers by authenticated (not anon)',
    has_function_privilege('service_role', 'public.idv_start_attempt(uuid,text,uuid,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.idv_start_attempt(uuid,text,uuid,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.idv_attach_session(uuid,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.idv_mark_pending(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.idv_my_status()', 'execute')
    and has_function_privilege('authenticated', 'public.idv_local_status(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.idv_local_status_list()', 'execute')
    and not has_function_privilege('anon', 'public.idv_my_status()', 'execute'));
end $$;

-- ===== J. audit failure undoes the start =====
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'audit boom'; end $$;
create trigger t_audit_boom before insert on public.local_tasker_audit_log for each row
  when (new.action = 'idv.attempt_created') execute function pg_temp.boom();
do $$
declare u uuid := pg_temp.mk_user(); r text;
begin
  perform pg_temp.give(u);
  r := pg_temp.st(u, 'self', null);
  perform pg_temp.chk('audit failure -> error and no attempt row', r like 'ERR:%' and not exists (select 1 from public.identity_verifications where user_id = u), r);
end $$;
drop trigger t_audit_boom on public.local_tasker_audit_log;

-- ===== K. migration safety: re-run, rollback, re-apply =====
\i v1c2-idv-start-read.sql
select pg_temp.chk('re-running v1c2 keeps existing attempt rows', (select count(*) from public.identity_verifications) >= 10);
do $$
declare u uuid := pg_temp.mk_user(); r text;
begin
  perform pg_temp.give(u);
  r := pg_temp.st(u, 'self', null);
  perform pg_temp.chk('after the re-run the grants still hold (service_role start works, authenticated refused)',
    r like '{%' and pg_temp.as_(u, 'authenticated', format($q$public.idv_start_attempt(%L, 'self', null, 'sandbox', null)$q$, u)) like 'ERR:42501%', r);
end $$;
\i v1c2-rollback.sql
select pg_temp.chk('rollback drops the seven functions',
  not exists (select 1 from pg_proc where proname in ('idv_start_attempt', 'idv_attach_session', 'idv_mark_pending', 'idv_my_status', 'idv_local_status', 'idv_local_status_list', 'idv_subject_kind')));
select pg_temp.chk('rollback keeps the attempt rows and the V1c-1 consent functions',
  (select count(*) from public.identity_verifications) >= 10
  and exists (select 1 from pg_proc where proname = 'idv_has_consent') and exists (select 1 from pg_proc where proname = 'idv_apply_event'));
\i v1c2-idv-start-read.sql
do $$
declare u uuid := pg_temp.mk_user(); r text;
begin
  perform pg_temp.give(u);
  r := pg_temp.st(u, 'self', null);
  perform pg_temp.chk('re-applied after rollback: works again', r like '{%' and pg_temp.as_(u, 'authenticated', $q$public.idv_my_status()$q$) like '{%', r);
end $$;

-- Report
select n, case when ok then 'PASS' else 'FAIL' end as result, label, detail from results where not ok order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
do $$ begin
  if exists (select 1 from pg_temp.results where not ok) then raise exception 'V1c-2 tests FAILED'; end if;
end $$;

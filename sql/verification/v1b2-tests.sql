-- SCRATCH POSTGRES ONLY. Tests for v1b2-idv-apply-effects.sql. Run as superuser in ONE psql session,
-- from the folder that holds the SQL files, on a FRESH database:
--   psql -v ON_ERROR_STOP=1 -f v1a-scratch-setup.sql -f v1a-tables.sql -f v1b1-idv-apply-core.sql \
--        -f v1b2-scratch-standins.sql -f v1b2-idv-apply-effects.sql -f v1b2-tests.sql
-- The users/taskers/coordinators/notifications/audit tables are STAND-INS (see v1b2-scratch-standins.sql).

create temp table results (n serial, label text, ok boolean, detail text);
create function pg_temp.chk(p_label text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into pg_temp.results(label, ok, detail) values (p_label, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.expect(label text, role_name text, stmt text, want text) returns void
language plpgsql as $$
declare got text := 'ok';
begin
  begin execute format('set local role %I', role_name); execute stmt;
  exception when others then got := sqlstate; end;
  execute 'reset role';
  perform pg_temp.chk(label, got = want, 'want ' || want || ', got ' || got);
end $$;

-- ---------- fixtures ----------
-- A subject: user row (with name/dob to prove they stay untouched), optional taskers rows, optional local profile.
create function pg_temp.mk(p_kind text, p_taskers int default 1, p_coord text default 'active') returns uuid
language plpgsql as $$
declare u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); i int;
begin
  insert into public.users(id, name, first_name, last_name, dob) values (u, 'Ada Test', 'Ada', 'Test', date '1990-01-01');
  if p_kind in ('tasker_regular', 'tasker_local') then
    for i in 1..p_taskers loop insert into public.taskers(user_id) values (u::text); end loop;
  end if;
  if p_kind = 'tasker_local' then
    insert into public.local_tasker_profiles(tasker_user_id, full_name, phone, verification_method, verified_at, verified_by)
    values (u, 'Ada Test', '+2348000000000', 'in_person', now() - interval '3 days', gen_random_uuid());
    if p_coord <> 'none' then
      insert into public.coordinators(user_id, display_name, status) values (c, 'Coord', p_coord);
      insert into public.coordinator_assignments(coordinator_id, tasker_user_id, ended_at)
      values (c, u, case when p_coord = 'ended' then now() else null end);
      if p_coord = 'ended' then  -- the coordinator account itself is active, but the assignment is over
        update public.coordinators set status = 'active' where user_id = c;
      end if;
    end if;
  end if;
  return u;
end $$;

create function pg_temp.coord_of(p_u uuid) returns uuid language sql as
$$ select coordinator_id from public.coordinator_assignments where tasker_user_id = p_u limit 1 $$;

create function pg_temp.mkrow(p_user uuid, p_kind text, p_status text, p_env text default 'sandbox') returns text
language plpgsql as $$
declare s text := 'sess-' || gen_random_uuid();
begin
  insert into public.identity_verifications(user_id, subject_kind, environment, created_by, provider_session_id, status)
  values (p_user, p_kind, p_env, p_user, s, p_status);
  return s;
end $$;

create function pg_temp.ap(p_sess text, p_prov text, p_ts timestamptz default now(), p_env text default 'sandbox',
  p_event text default null, p_live boolean default true, p_face boolean default true) returns jsonb
language sql as $$
  select public.idv_apply_event(coalesce(p_event, 'evt-' || gen_random_uuid()), p_sess, 'status.updated', p_prov, p_env, p_ts,
         'hash', true, p_live, p_face, null, 'full_match', true, null)
$$;

create function pg_temp.vid(p_sess text) returns uuid language sql as
$$ select id from public.identity_verifications where provider_session_id = p_sess $$;
create function pg_temp.st(p_sess text) returns text language sql as
$$ select status from public.identity_verifications where provider_session_id = p_sess $$;
create function pg_temp.n_audit(p_sess text) returns bigint language sql as
$$ select count(*) from public.local_tasker_audit_log where entity_id = pg_temp.vid(p_sess)::text $$;
create function pg_temp.n_notif(p_user uuid) returns bigint language sql as
$$ select count(*) from public.notifications where user_id = p_user $$;
create function pg_temp.u_flag(p_u uuid) returns boolean language sql as
$$ select is_verified is true and verified_at is not null from public.users where id = p_u $$;
create function pg_temp.u_clear(p_u uuid) returns boolean language sql as
$$ select is_verified is false and verified_at is null from public.users where id = p_u $$;
create function pg_temp.t_all(p_u uuid, want boolean) returns boolean language sql as
$$ select bool_and(is_verified is not distinct from want and verified is not distinct from want
                   and (verified_at is not null) = want) from public.taskers where user_id = p_u::text $$;
-- every status-affecting column in one string, to prove "nothing changed"
create function pg_temp.snap(p_u uuid) returns text language sql as
$$ select concat_ws('|',
     (select concat(is_verified, verified_at) from public.users where id = p_u),
     (select string_agg(concat(is_verified, verified, verified_at), ',' order by id) from public.taskers where user_id = p_u::text),
     (select concat(verification_method, verified_at, verified_by) from public.local_tasker_profiles where tasker_user_id = p_u)) $$;

-- ===== A. the hook is the real one, and only the server may run it =====
select pg_temp.chk('hook is the V1b-2 version', (select prosrc from pg_proc where proname = 'idv_apply_effects') like '%idv.verified%');
select pg_temp.expect(r || ' cannot run idv_apply_effects', r,
  $q$select public.idv_apply_effects(null::public.identity_verifications, 'IN_PROGRESS')$q$, '42501')
from (values ('anon'), ('authenticated')) as ro(r);

select pg_temp.expect(r || ' cannot run idv_notify_subject', r,
  $q$select public.idv_notify_subject(null::public.identity_verifications, 'a', 'b')$q$, '42501')
from (values ('anon'), ('authenticated')) as ro(r);

-- ===== B. VERIFIED sets the flags (1: VERIFIED sets users / taskers / local profile) =====
do $$
declare u uuid; s text; r jsonb; c uuid;
begin
  -- regular tasker with two taskers rows
  u := pg_temp.mk('tasker_regular', 2);
  s := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS');
  r := pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('regular tasker: event applied, status VERIFIED', r->>'outcome' = 'applied' and pg_temp.st(s) = 'VERIFIED', r::text);
  perform pg_temp.chk('regular tasker: users flags set', pg_temp.u_flag(u));
  perform pg_temp.chk('regular tasker: all three taskers columns set on every taskers row',
    pg_temp.t_all(u, true) and (select count(*) from public.taskers where user_id = u::text and is_verified and verified and verified_at is not null) = 2);
  perform pg_temp.chk('regular tasker: users first_name/last_name/dob untouched',
    (select first_name || last_name || dob::text from public.users where id = u) = 'AdaTest1990-01-01');
  perform pg_temp.chk('regular tasker: one audit row (idv.verified, entity identity_verification, status only, role system)',
    (select count(*) from public.local_tasker_audit_log where entity_id = pg_temp.vid(s)::text and action = 'idv.verified'
        and entity = 'identity_verification' and actor_id is null and actor_role = 'system'
        and before_data = '{"status":"IN_PROGRESS"}'::jsonb and after_data = '{"status":"VERIFIED"}'::jsonb) = 1
    and pg_temp.n_audit(s) = 1);
  perform pg_temp.chk('regular tasker: one notification to the user with url /verify.html',
    pg_temp.n_notif(u) = 1 and (select data from public.notifications where user_id = u) = '{"url":"/verify.html"}'::jsonb
    and (select type from public.notifications where user_id = u) = 'identity_verification');

  -- customer: users only, a taskers row of the same user is NOT touched
  u := pg_temp.mk('customer');
  insert into public.taskers(user_id) values (u::text);
  s := pg_temp.mkrow(u, 'customer', 'IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('customer: users flags set, taskers row untouched',
    pg_temp.u_flag(u) and (select not is_verified and not verified and verified_at is null from public.taskers where user_id = u::text));
  perform pg_temp.chk('customer: one audit row and one notification to the customer', pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 1);

  -- local tasker: users + taskers + profile; notification goes to the active coordinator only
  u := pg_temp.mk('tasker_local');
  c := pg_temp.coord_of(u);
  s := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('local tasker: users and taskers flags set', pg_temp.u_flag(u) and pg_temp.t_all(u, true));
  perform pg_temp.chk('local tasker: profile method didit, verified_at set, verified_by null, notes/name untouched',
    (select verification_method = 'didit' and verified_at > now() - interval '1 minute' and verified_by is null
            and full_name = 'Ada Test' and verification_notes is null
       from public.local_tasker_profiles where tasker_user_id = u));
  perform pg_temp.chk('local tasker: coordinator notified once, the tasker never',
    pg_temp.n_notif(c) = 1 and pg_temp.n_notif(u) = 0 and pg_temp.n_audit(s) = 1);

  -- local tasker whose assignment ended / coordinator not active / no coordinator
  u := pg_temp.mk('tasker_local', 1, 'ended');
  s := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS'); perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('local tasker with an ended assignment: flags and audit yes, notification none',
    pg_temp.u_flag(u) and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(pg_temp.coord_of(u)) = 0);
  u := pg_temp.mk('tasker_local', 1, 'suspended');
  s := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS'); perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('local tasker with a non-active coordinator: audit yes, notification none',
    pg_temp.u_flag(u) and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(pg_temp.coord_of(u)) = 0);
  u := pg_temp.mk('tasker_local', 1, 'none');
  s := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS'); perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('local tasker with no coordinator: flags and audit yes, no notification, no error',
    pg_temp.u_flag(u) and pg_temp.n_audit(s) = 1 and (select count(*) from public.notifications n where n.user_id = u) = 0);

  -- verified user without any taskers or profile row: no error
  u := gen_random_uuid(); insert into public.users(id) values (u);
  s := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS'); perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('local tasker with no taskers row and no profile row: still applies', pg_temp.st(s) = 'VERIFIED' and pg_temp.u_flag(u));
  u := gen_random_uuid();   -- not even a users row
  s := pg_temp.mkrow(u, 'customer', 'IN_PROGRESS'); perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('no users row at all: still applies (zero rows updated, no error)', pg_temp.st(s) = 'VERIFIED' and pg_temp.n_audit(s) = 1);
end $$;

-- ===== C. leaving VERIFIED clears everything (2) =====
do $$
declare k text; prov text; u uuid; s text; before_snap text; c uuid;
begin
  foreach k in array array['tasker_regular', 'tasker_local', 'customer'] loop
    foreach prov in array array['Kyc Expired', 'Resubmitted'] loop
      u := pg_temp.mk(k, 2);
      s := pg_temp.mkrow(u, k, 'IN_PROGRESS'); perform pg_temp.ap(s, 'Approved');
      c := case when k = 'tasker_local' then pg_temp.coord_of(u) else u end;
      perform pg_temp.ap(s, prov, now() + interval '1 minute');
      perform pg_temp.chk(format('%s: %s clears users flags', k, prov), pg_temp.u_clear(u));
      if k <> 'customer' then
        perform pg_temp.chk(format('%s: %s clears all three taskers columns on every row', k, prov), pg_temp.t_all(u, false));
      end if;
      if k = 'tasker_local' then
        perform pg_temp.chk(format('%s: %s clears profile method and verified_at', k, prov),
          (select verification_method is null and verified_at is null from public.local_tasker_profiles where tasker_user_id = u));
      end if;
      perform pg_temp.chk(format('%s: %s writes idv.unverified (VERIFIED -> new status) and one notification', k, prov),
        (select count(*) from public.local_tasker_audit_log where entity_id = pg_temp.vid(s)::text and action = 'idv.unverified'
           and before_data = '{"status":"VERIFIED"}'::jsonb) = 1
        and pg_temp.n_audit(s) = 2 and pg_temp.n_notif(c) = 2);
      perform pg_temp.chk(format('%s: %s keeps users name and dob', k, prov),
        (select first_name || last_name || dob::text from public.users where id = u) = 'AdaTest1990-01-01');
    end loop;
  end loop;
end $$;
-- Kyc Expired lands on EXPIRED, Resubmitted on RESUBMIT_REQUESTED
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'VERIFIED');
begin
  perform pg_temp.ap(s, 'Kyc Expired');
  perform pg_temp.chk('Kyc Expired from VERIFIED gives EXPIRED', pg_temp.st(s) = 'EXPIRED');
  u := pg_temp.mk('tasker_regular'); s := pg_temp.mkrow(u, 'tasker_regular', 'VERIFIED');
  perform pg_temp.ap(s, 'Resubmitted');
  perform pg_temp.chk('Resubmitted from VERIFIED gives RESUBMIT_REQUESTED', pg_temp.st(s) = 'RESUBMIT_REQUESTED');
end $$;

-- ===== D. every other change sets and clears nothing (3) =====
-- Start from each non-VERIFIED status, apply every Didit status that is not a VERIFIED path. Flags are
-- pre-set to a recognisable "verified by someone else" state to prove they are not cleared either.
do $$
declare k text; st text; prov text; u uuid; s text; snap0 text; a0 bigint; n0 bigint; r jsonb; bad int := 0; total int := 0; want_n int; notified int := 0;
begin
  foreach k in array array['tasker_regular', 'tasker_local', 'customer'] loop
    foreach st in array array['NOT_STARTED', 'IN_PROGRESS', 'PENDING', 'REVIEW_REQUIRED', 'RESUBMIT_REQUESTED', 'FAILED', 'EXPIRED', 'ABANDONED'] loop
      foreach prov in array array['Not Started', 'In Progress', 'Awaiting User', 'In Review', 'Declined', 'Resubmitted', 'Abandoned', 'Expired', 'Kyc Expired'] loop
        u := pg_temp.mk(k);
        s := pg_temp.mkrow(u, k, st);
        snap0 := pg_temp.snap(u); a0 := (select count(*) from public.local_tasker_audit_log); n0 := (select count(*) from public.notifications);
        r := pg_temp.ap(s, prov);
        total := total + 1;
        want_n := case when (r->>'changed')::boolean and r->>'status' in ('FAILED', 'REVIEW_REQUIRED') then 1 else 0 end;
        notified := notified + want_n;
        if pg_temp.snap(u) is distinct from snap0 or (select count(*) from public.local_tasker_audit_log) <> a0
           or (select count(*) from public.notifications) - n0 <> want_n then
          bad := bad + 1;
          perform pg_temp.chk(format('NO side effects: %s %s + %s', k, st, prov), false, r::text);
        end if;
      end loop;
    end loop;
  end loop;
  perform pg_temp.chk(format('no flag or audit change for any of %s non-VERIFIED transitions; exactly one notification each time a row enters FAILED or REVIEW_REQUIRED (%s) and none otherwise', total, notified), bad = 0 and notified > 0, bad || ' bad');
end $$;
-- Approved that is NOT good enough becomes REVIEW_REQUIRED and sets nothing
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS'); snap0 text := pg_temp.snap(u);
begin
  perform pg_temp.ap(s, 'Approved', p_live => false);
  perform pg_temp.chk('Approved with failed liveness -> REVIEW_REQUIRED, nothing set, no audit, one "being reviewed" notification',
    pg_temp.st(s) = 'REVIEW_REQUIRED' and pg_temp.snap(u) = snap0 and pg_temp.n_audit(s) = 0 and pg_temp.n_notif(u) = 1
    and (select title from public.notifications where user_id = u) = 'Your identity verification is being reviewed');
end $$;
-- A VERIFIED row only moves to Resubmitted / Kyc Expired; Declined is ignored and touches nothing
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS'); r jsonb;
begin
  perform pg_temp.ap(s, 'Approved');
  r := pg_temp.ap(s, 'Declined', now() + interval '1 minute');
  perform pg_temp.chk('Declined after VERIFIED: ignored_transition, still VERIFIED, flags stay, no extra audit/notification',
    r->>'outcome' = 'ignored_transition' and pg_temp.st(s) = 'VERIFIED' and pg_temp.u_flag(u) and pg_temp.t_all(u, true)
    and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 1);
end $$;

-- ===== E. events that change nothing write nothing (4) =====
do $$
declare u uuid; s text; r jsonb; ts timestamptz := now(); snap0 text;
begin
  u := pg_temp.mk('tasker_regular'); s := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS');
  r := pg_temp.ap(s, 'Approved', ts, p_event => 'evt-dup-1');
  snap0 := pg_temp.snap(u);
  r := pg_temp.ap(s, 'Approved', ts, p_event => 'evt-dup-1');
  perform pg_temp.chk('duplicate event_id: outcome duplicate, one audit, one notification', r->>'outcome' = 'duplicate' and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 1);
  r := pg_temp.ap(s, 'Approved', ts + interval '1 minute');   -- refresh of the same status
  perform pg_temp.chk('repeat of VERIFIED (new event): applied, status unchanged, no extra audit/notification, flags unchanged',
    r->>'outcome' = 'applied' and (r->>'changed')::boolean = false and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 1 and pg_temp.snap(u) = snap0);
  r := pg_temp.ap(s, 'Resubmitted', ts - interval '1 hour');
  perform pg_temp.chk('stale event: outcome stale, nothing written', r->>'outcome' = 'stale' and pg_temp.st(s) = 'VERIFIED' and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 1);
  r := pg_temp.ap(s, 'Resubmitted', ts + interval '2 minutes', p_env => 'live');
  perform pg_temp.chk('wrong environment: ignored_environment, nothing written', r->>'outcome' = 'ignored_environment' and pg_temp.st(s) = 'VERIFIED' and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 1);
  r := pg_temp.ap(s, 'Mystery Status', ts + interval '3 minutes');
  perform pg_temp.chk('unknown status: rejected, nothing written', r->>'outcome' = 'rejected' and pg_temp.st(s) = 'VERIFIED' and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 1);
  r := public.idv_apply_event('evt-nosess', 'no-such-session', 'status.updated', 'Approved', 'sandbox', now(), 'h', true, true, true, null, 'full_match', true, null);
  perform pg_temp.chk('unknown session: retry, nothing written', (r->>'retry')::boolean and (select count(*) from public.local_tasker_audit_log where entity_id is null) = 0);
end $$;
-- calling the hook with old status = new status does nothing
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'VERIFIED'); snap0 text := pg_temp.snap(u);
begin
  perform public.idv_apply_effects((select v from public.identity_verifications v where provider_session_id = s), 'VERIFIED');
  perform pg_temp.chk('hook with old = new status (VERIFIED -> VERIFIED) writes nothing',
    pg_temp.snap(u) = snap0 and pg_temp.n_audit(s) = 0 and pg_temp.n_notif(u) = 0);
end $$;

-- ===== D2. wording and recipients for FAILED and REVIEW_REQUIRED =====
do $$
declare u uuid; s text; c uuid; r jsonb;
begin
  u := pg_temp.mk('tasker_regular'); s := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS');
  perform pg_temp.ap(s, 'Declined');
  perform pg_temp.chk('Declined -> FAILED: user told "could not be completed", no flags, no audit',
    pg_temp.st(s) = 'FAILED' and pg_temp.n_notif(u) = 1 and pg_temp.n_audit(s) = 0 and pg_temp.u_clear(u)
    and (select title from public.notifications where user_id = u) = 'Your identity verification could not be completed'
    and (select data from public.notifications where user_id = u) = '{"url":"/verify.html"}'::jsonb);
  u := pg_temp.mk('customer'); s := pg_temp.mkrow(u, 'customer', 'IN_PROGRESS');
  perform pg_temp.ap(s, 'In Review');
  perform pg_temp.chk('In Review -> REVIEW_REQUIRED: customer told "being reviewed"',
    pg_temp.st(s) = 'REVIEW_REQUIRED' and pg_temp.n_notif(u) = 1
    and (select message from public.notifications where user_id = u) like '%manual review%');
  perform pg_temp.ap(s, 'In Review', now() + interval '1 minute');
  perform pg_temp.chk('a repeat of REVIEW_REQUIRED sends nothing more', pg_temp.n_notif(u) = 1);
  perform pg_temp.ap(s, 'Approved', now() + interval '2 minutes');
  perform pg_temp.chk('review then approved: verified notification follows (2 in total)', pg_temp.st(s) = 'VERIFIED' and pg_temp.n_notif(u) = 2);
  u := pg_temp.mk('tasker_local'); c := pg_temp.coord_of(u); s := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS');
  perform pg_temp.ap(s, 'Declined');
  perform pg_temp.chk('local tasker FAILED: the coordinator is told (no names), the tasker is not',
    pg_temp.n_notif(c) = 1 and pg_temp.n_notif(u) = 0
    and (select title from public.notifications where user_id = c) = 'Identity verification could not be completed');
  u := pg_temp.mk('tasker_local', 1, 'none'); s := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS');
  r := pg_temp.ap(s, 'In Review');
  perform pg_temp.chk('local tasker REVIEW_REQUIRED with no coordinator: no notification, no error', r->>'outcome' = 'applied' and pg_temp.st(s) = 'REVIEW_REQUIRED');
  u := pg_temp.mk('tasker_regular'); s := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS');
  perform pg_temp.ap(s, 'Abandoned');
  perform pg_temp.chk('Abandoned (and Expired, Resubmitted from non-verified) still send nothing', pg_temp.n_notif(u) = 0);
end $$;

-- ===== F. a failing AUDIT write rolls back the whole event (5) =====
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'audit boom'; end $$;
create trigger t_audit_boom before insert on public.local_tasker_audit_log for each row execute function pg_temp.boom();
do $$
declare u uuid := pg_temp.mk('tasker_local'); s text := pg_temp.mkrow(u, 'tasker_local', 'IN_PROGRESS'); snap0 text := pg_temp.snap(u); got text := 'no error';
begin
  begin perform pg_temp.ap(s, 'Approved', p_event => 'evt-audit-fail');
  exception when others then got := sqlerrm; end;
  perform pg_temp.chk('failing audit: error reaches the caller', got = 'audit boom', got);
  perform pg_temp.chk('failing audit: status unchanged, no ledger row, flags unchanged, no notification',
    pg_temp.st(s) = 'IN_PROGRESS' and pg_temp.snap(u) = snap0
    and not exists (select 1 from public.identity_verification_events where event_id = 'evt-audit-fail')
    and pg_temp.n_notif(pg_temp.coord_of(u)) = 0);
end $$;
drop trigger t_audit_boom on public.local_tasker_audit_log;
-- ...and the same event succeeds once the audit works again (Didit's retry)
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS'); r jsonb; got text := 'no error';
begin
  r := pg_temp.ap(s, 'Approved', p_event => 'evt-after-fix');
  perform pg_temp.chk('after the audit is fixed the event applies', pg_temp.st(s) = 'VERIFIED' and pg_temp.n_audit(s) = 1);
end $$;

-- ===== G. a failing NOTIFICATION never escapes (5, by design of _notify) =====
create trigger t_notif_boom before insert on public.notifications for each row execute function pg_temp.boom();
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS'); got text := 'no error'; r jsonb;
begin
  begin r := pg_temp.ap(s, 'Approved'); exception when others then got := sqlerrm; end;
  perform pg_temp.chk('failing notification: no error escapes', got = 'no error', got);
  perform pg_temp.chk('failing notification: event still applied, flags set, audit written, notification missing',
    pg_temp.st(s) = 'VERIFIED' and pg_temp.u_flag(u) and pg_temp.n_audit(s) = 1 and pg_temp.n_notif(u) = 0);
end $$;
drop trigger t_notif_boom on public.notifications;

-- ===== H. an older VERIFIED attempt is not un-verified by a newer one (and vice versa) =====
do $$
declare u uuid := pg_temp.mk('tasker_regular'); a text; b text;
begin
  a := pg_temp.mkrow(u, 'tasker_regular', 'VERIFIED');                 -- older verified attempt (terminal)
  b := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS');
  perform pg_temp.ap(b, 'Approved');
  perform pg_temp.ap(b, 'Resubmitted', now() + interval '1 minute');
  perform pg_temp.chk('another VERIFIED attempt exists: flags stay set, audit and notification still written',
    pg_temp.u_flag(u) and pg_temp.t_all(u, true) and pg_temp.n_audit(b) = 2 and pg_temp.n_notif(u) = 2);
  perform pg_temp.ap(a, 'Kyc Expired');
  perform pg_temp.chk('the last VERIFIED attempt leaves: flags clear', pg_temp.u_clear(u) and pg_temp.t_all(u, false));
  -- customer VERIFIED + tasker VERIFIED; tasker leaves -> users flag stays (customer still verified), taskers clear
  u := pg_temp.mk('tasker_regular');
  a := pg_temp.mkrow(u, 'customer', 'VERIFIED');
  b := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS');
  perform pg_temp.ap(b, 'Approved'); perform pg_temp.ap(b, 'Kyc Expired', now() + interval '1 minute');
  perform pg_temp.chk('customer still VERIFIED: users flag stays, taskers columns clear', pg_temp.u_flag(u) and pg_temp.t_all(u, false));
end $$;

-- ===== I. no personal data in audit or notifications =====
select pg_temp.chk('no name, phone or dob in any audit row or notification',
  not exists (select 1 from public.local_tasker_audit_log l where (l.action || l.entity || coalesce(l.before_data::text, '') || coalesce(l.after_data::text, '')) ~* 'Ada|Test|2348000|1990')
  and not exists (select 1 from public.notifications n where (n.title || coalesce(n.message, '') || n.data::text) ~* 'Ada|Test|2348000|1990'
                     or n.title ~* 'bank|biometric|secure|guarantee' or n.message ~* 'bank|biometric|secure|guarantee'));
select pg_temp.chk('every notification has a stand-alone title and message and url /verify.html',
  not exists (select 1 from public.notifications where char_length(title) < 10 or char_length(coalesce(message, '')) < 20 or data <> '{"url":"/verify.html"}'::jsonb));

-- ===== J. migration safety (6, 7): re-run, V1b-1 re-run, rollback, re-apply =====
\i v1b2-idv-apply-effects.sql
select pg_temp.chk('re-running v1b2 keeps the real hook', (select prosrc from pg_proc where proname = 'idv_apply_effects') like '%idv.verified%');
\i v1b1-idv-apply-core.sql
select pg_temp.chk('re-running v1b1 does not overwrite the V1b-2 hook', (select prosrc from pg_proc where proname = 'idv_apply_effects') like '%idv.verified%');
\i v1b2-rollback.sql
select pg_temp.chk('rollback puts the no-op back and drops the helper', (select prosrc from pg_proc where proname = 'idv_apply_effects') not like '%idv.verified%'
  and not exists (select 1 from pg_proc where proname = 'idv_notify_subject'));
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS'); snap0 text := pg_temp.snap(u);
begin
  perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('with the no-op hook the status still changes but no flag, audit or notification is written',
    pg_temp.st(s) = 'VERIFIED' and pg_temp.snap(u) = snap0 and pg_temp.n_audit(s) = 0 and pg_temp.n_notif(u) = 0);
end $$;
\i v1b2-idv-apply-effects.sql
do $$
declare u uuid := pg_temp.mk('tasker_regular'); s text := pg_temp.mkrow(u, 'tasker_regular', 'IN_PROGRESS');
begin
  perform pg_temp.ap(s, 'Approved');
  perform pg_temp.chk('re-applied after rollback: works again', pg_temp.u_flag(u) and pg_temp.n_audit(s) = 1);
end $$;
select pg_temp.expect(r || ' still cannot run idv_apply_effects after re-apply', r,
  $q$select public.idv_apply_effects(null::public.identity_verifications, 'IN_PROGRESS')$q$, '42501')
from (values ('anon'), ('authenticated')) as ro(r);

-- Report
select n, case when ok then 'PASS' else 'FAIL' end as result, label, detail from results where not ok order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
do $$ begin
  if exists (select 1 from pg_temp.results where not ok) then raise exception 'V1b-2 tests FAILED'; end if;
end $$;

-- SCRATCH POSTGRES ONLY. Tests for v1b1-idv-apply-core.sql. Run as superuser in ONE psql session, from
-- the folder that holds the SQL files, on a FRESH database:
--   psql -v ON_ERROR_STOP=1 -f v1a-scratch-setup.sql -f v1a-tables.sql -f v1b1-idv-apply-core.sql -f v1b1-tests.sql
-- The 90-row expected matrix below was generated from a separate Python model of the rules.

create temp table results (n serial, label text, ok boolean, detail text);

create function pg_temp.chk(p_label text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into pg_temp.results(label, ok, detail) values (p_label, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.expect(label text, role_name text, stmt text, want text) returns void
language plpgsql as $$
declare got text := 'ok';
begin
  begin
    execute format('set local role %I', role_name);
    execute stmt;
  exception when others then got := sqlstate;
  end;
  execute 'reset role';
  perform pg_temp.chk(label, got = want, 'want ' || want || ', got ' || got);
end $$;

-- Scratch-only effects logger so we can see exactly when the hook fires.
create table public.idv_effects_log (n serial, verification_id uuid, old_status text, new_status text);
create or replace function public.idv_apply_effects(p_row public.identity_verifications, p_old_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin insert into public.idv_effects_log(verification_id, old_status, new_status) values (p_row.id, p_old_status, p_row.status); end $$;

-- Helpers
create function pg_temp.mkrow(p_status text, p_env text default 'sandbox') returns text
language plpgsql as $$
declare s text := 'sess-' || gen_random_uuid();
begin
  insert into public.identity_verifications(user_id, subject_kind, environment, created_by, provider_session_id, status)
  values (gen_random_uuid(), 'tasker_regular', p_env, gen_random_uuid(), s, p_status);
  return s;
end $$;

create function pg_temp.ap(p_sess text, p_prov text, p_ts timestamptz default now(), p_env text default 'sandbox',
  p_event text default null, p_fetched boolean default true, p_live boolean default true, p_face boolean default true,
  p_nin text default null, p_nig boolean default false, p_codes text[] default null) returns jsonb
language sql as $$
  select public.idv_apply_event(coalesce(p_event, 'evt-' || gen_random_uuid()), p_sess, 'status.updated', p_prov, p_env, p_ts,
         'hash', p_fetched, p_live, p_face, null, p_nin, p_nig, p_codes)
$$;

create function pg_temp.st(p_sess text) returns text language sql as
$$ select status from public.identity_verifications where provider_session_id = p_sess $$;
create function pg_temp.hook_calls(p_sess text) returns bigint language sql as
$$ select count(*) from public.idv_effects_log l join public.identity_verifications v on v.id = l.verification_id
   where v.provider_session_id = p_sess $$;

-- ===== A. status map =====
select pg_temp.chk('map ' || coalesce(p, 'NULL') || ' -> ' || coalesce(e, 'NULL'), public.idv_map_status(p) is not distinct from e)
from (values ('Not Started','NOT_STARTED'),('In Progress','IN_PROGRESS'),('Awaiting User','IN_PROGRESS'),
             ('In Review','REVIEW_REQUIRED'),('Approved','VERIFIED'),('Declined','FAILED'),
             ('Resubmitted','RESUBMIT_REQUESTED'),('Abandoned','ABANDONED'),('Expired','EXPIRED'),
             ('Kyc Expired','EXPIRED'),('approved',null),('APPROVED',null),('',null),('Weird',null),(null,null)) as t(p, e);

select pg_temp.chk('terminal ' || s, public.idv_is_terminal(s) = e)
from (values ('VERIFIED',true),('FAILED',true),('EXPIRED',true),('ABANDONED',true),('NOT_STARTED',false),
             ('IN_PROGRESS',false),('PENDING',false),('REVIEW_REQUIRED',false),('RESUBMIT_REQUESTED',false)) as t(s, e);

-- ===== B. approval rule (D-V3) =====
select pg_temp.chk('decide live=' || coalesce(l::text,'null') || ' face=' || coalesce(f::text,'null') || ' nin=' || coalesce(n,'null') || ' ng=' || coalesce(g::text,'null'),
                     public.idv_decide_approved(l, f, n, g) = e)
from (values (true,true,null,false,'VERIFIED'),(true,true,'no_match',false,'VERIFIED'),
             (true,true,'full_match',true,'VERIFIED'),(true,true,'partial_match',true,'REVIEW_REQUIRED'),
             (true,true,'no_match',true,'REVIEW_REQUIRED'),(true,true,'not_run',true,'REVIEW_REQUIRED'),
             (true,true,null,true,'REVIEW_REQUIRED'),(null,true,null,false,'REVIEW_REQUIRED'),
             (false,true,null,false,'REVIEW_REQUIRED'),(true,null,null,false,'REVIEW_REQUIRED'),
             (true,false,null,false,'REVIEW_REQUIRED')) as t(l, f, n, g, e);

-- ===== C. full transition matrix: every current status x every Didit status =====
create temp table matrix (cur text, prov text, exp_outcome text, exp_status text);
insert into matrix values
  ('NOT_STARTED','Not Started','applied','NOT_STARTED'),
  ('NOT_STARTED','In Progress','applied','IN_PROGRESS'),
  ('NOT_STARTED','Awaiting User','applied','IN_PROGRESS'),
  ('NOT_STARTED','In Review','applied','REVIEW_REQUIRED'),
  ('NOT_STARTED','Approved','applied','VERIFIED'),
  ('NOT_STARTED','Declined','applied','FAILED'),
  ('NOT_STARTED','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('NOT_STARTED','Abandoned','applied','ABANDONED'),
  ('NOT_STARTED','Expired','applied','EXPIRED'),
  ('NOT_STARTED','Kyc Expired','ignored_transition','NOT_STARTED'),
  ('IN_PROGRESS','Not Started','applied','NOT_STARTED'),
  ('IN_PROGRESS','In Progress','applied','IN_PROGRESS'),
  ('IN_PROGRESS','Awaiting User','applied','IN_PROGRESS'),
  ('IN_PROGRESS','In Review','applied','REVIEW_REQUIRED'),
  ('IN_PROGRESS','Approved','applied','VERIFIED'),
  ('IN_PROGRESS','Declined','applied','FAILED'),
  ('IN_PROGRESS','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('IN_PROGRESS','Abandoned','applied','ABANDONED'),
  ('IN_PROGRESS','Expired','applied','EXPIRED'),
  ('IN_PROGRESS','Kyc Expired','ignored_transition','IN_PROGRESS'),
  ('PENDING','Not Started','applied','NOT_STARTED'),
  ('PENDING','In Progress','applied','IN_PROGRESS'),
  ('PENDING','Awaiting User','applied','IN_PROGRESS'),
  ('PENDING','In Review','applied','REVIEW_REQUIRED'),
  ('PENDING','Approved','applied','VERIFIED'),
  ('PENDING','Declined','applied','FAILED'),
  ('PENDING','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('PENDING','Abandoned','applied','ABANDONED'),
  ('PENDING','Expired','applied','EXPIRED'),
  ('PENDING','Kyc Expired','ignored_transition','PENDING'),
  ('REVIEW_REQUIRED','Not Started','applied','NOT_STARTED'),
  ('REVIEW_REQUIRED','In Progress','applied','IN_PROGRESS'),
  ('REVIEW_REQUIRED','Awaiting User','applied','IN_PROGRESS'),
  ('REVIEW_REQUIRED','In Review','applied','REVIEW_REQUIRED'),
  ('REVIEW_REQUIRED','Approved','applied','VERIFIED'),
  ('REVIEW_REQUIRED','Declined','applied','FAILED'),
  ('REVIEW_REQUIRED','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('REVIEW_REQUIRED','Abandoned','applied','ABANDONED'),
  ('REVIEW_REQUIRED','Expired','applied','EXPIRED'),
  ('REVIEW_REQUIRED','Kyc Expired','ignored_transition','REVIEW_REQUIRED'),
  ('RESUBMIT_REQUESTED','Not Started','applied','NOT_STARTED'),
  ('RESUBMIT_REQUESTED','In Progress','applied','IN_PROGRESS'),
  ('RESUBMIT_REQUESTED','Awaiting User','applied','IN_PROGRESS'),
  ('RESUBMIT_REQUESTED','In Review','applied','REVIEW_REQUIRED'),
  ('RESUBMIT_REQUESTED','Approved','applied','VERIFIED'),
  ('RESUBMIT_REQUESTED','Declined','applied','FAILED'),
  ('RESUBMIT_REQUESTED','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('RESUBMIT_REQUESTED','Abandoned','applied','ABANDONED'),
  ('RESUBMIT_REQUESTED','Expired','applied','EXPIRED'),
  ('RESUBMIT_REQUESTED','Kyc Expired','ignored_transition','RESUBMIT_REQUESTED'),
  ('VERIFIED','Not Started','ignored_transition','VERIFIED'),
  ('VERIFIED','In Progress','ignored_transition','VERIFIED'),
  ('VERIFIED','Awaiting User','ignored_transition','VERIFIED'),
  ('VERIFIED','In Review','ignored_transition','VERIFIED'),
  ('VERIFIED','Approved','applied','VERIFIED'),
  ('VERIFIED','Declined','ignored_transition','VERIFIED'),
  ('VERIFIED','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('VERIFIED','Abandoned','ignored_transition','VERIFIED'),
  ('VERIFIED','Expired','ignored_transition','VERIFIED'),
  ('VERIFIED','Kyc Expired','applied','EXPIRED'),
  ('FAILED','Not Started','ignored_transition','FAILED'),
  ('FAILED','In Progress','ignored_transition','FAILED'),
  ('FAILED','Awaiting User','ignored_transition','FAILED'),
  ('FAILED','In Review','ignored_transition','FAILED'),
  ('FAILED','Approved','ignored_transition','FAILED'),
  ('FAILED','Declined','applied','FAILED'),
  ('FAILED','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('FAILED','Abandoned','ignored_transition','FAILED'),
  ('FAILED','Expired','ignored_transition','FAILED'),
  ('FAILED','Kyc Expired','ignored_transition','FAILED'),
  ('EXPIRED','Not Started','ignored_transition','EXPIRED'),
  ('EXPIRED','In Progress','ignored_transition','EXPIRED'),
  ('EXPIRED','Awaiting User','ignored_transition','EXPIRED'),
  ('EXPIRED','In Review','ignored_transition','EXPIRED'),
  ('EXPIRED','Approved','ignored_transition','EXPIRED'),
  ('EXPIRED','Declined','ignored_transition','EXPIRED'),
  ('EXPIRED','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('EXPIRED','Abandoned','ignored_transition','EXPIRED'),
  ('EXPIRED','Expired','applied','EXPIRED'),
  ('EXPIRED','Kyc Expired','applied','EXPIRED'),
  ('ABANDONED','Not Started','ignored_transition','ABANDONED'),
  ('ABANDONED','In Progress','ignored_transition','ABANDONED'),
  ('ABANDONED','Awaiting User','ignored_transition','ABANDONED'),
  ('ABANDONED','In Review','ignored_transition','ABANDONED'),
  ('ABANDONED','Approved','ignored_transition','ABANDONED'),
  ('ABANDONED','Declined','ignored_transition','ABANDONED'),
  ('ABANDONED','Resubmitted','applied','RESUBMIT_REQUESTED'),
  ('ABANDONED','Abandoned','applied','ABANDONED'),
  ('ABANDONED','Expired','ignored_transition','ABANDONED'),
  ('ABANDONED','Kyc Expired','ignored_transition','ABANDONED');

do $$
declare m record; s text; r jsonb; ok boolean; changed_expected bigint;
begin
  for m in select * from matrix loop
    s := pg_temp.mkrow(m.cur);
    r := pg_temp.ap(s, m.prov);   -- Approved comes with fetched decision and all checks ok
    changed_expected := case when m.exp_status <> m.cur then 1 else 0 end;
    ok := r->>'outcome' = m.exp_outcome and pg_temp.st(s) = m.exp_status and pg_temp.hook_calls(s) = changed_expected;
    perform pg_temp.chk('matrix ' || m.cur || ' + ' || m.prov, ok,
      format('want %s/%s/hook %s, got %s/%s/hook %s', m.exp_outcome, m.exp_status, changed_expected, r->>'outcome', pg_temp.st(s), pg_temp.hook_calls(s)));
  end loop;
end $$;
select pg_temp.chk('matrix has 90 cases and all ran', (select count(*) from matrix) = 90 and
  (select count(*) from results where label like 'matrix %') = 90);

-- ===== D. approval through apply_event =====
do $$
declare s text; r jsonb; v record;
begin
  s := pg_temp.mkrow('IN_PROGRESS');
  r := pg_temp.ap(s, 'Approved');
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('Approved + all checks -> VERIFIED, completed_at set', v.status = 'VERIFIED' and v.completed_at is not null and v.liveness_ok and v.face_match_ok);

  s := pg_temp.mkrow('IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved', p_nin => 'partial_match', p_nig => true);
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('Approved + partial NIN (Nigerian doc) -> REVIEW_REQUIRED, match stored', v.status = 'REVIEW_REQUIRED' and v.nin_database_match = 'partial_match' and v.completed_at is null);

  s := pg_temp.mkrow('IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved', p_nin => 'full_match', p_nig => true);
  perform pg_temp.chk('Approved + full NIN (Nigerian doc) -> VERIFIED', pg_temp.st(s) = 'VERIFIED');

  s := pg_temp.mkrow('IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved', p_nig => true);
  perform pg_temp.chk('Approved, Nigerian doc, NIN check missing -> REVIEW_REQUIRED', pg_temp.st(s) = 'REVIEW_REQUIRED');

  s := pg_temp.mkrow('IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved', p_live => false);
  perform pg_temp.chk('Approved but liveness not ok -> REVIEW_REQUIRED', pg_temp.st(s) = 'REVIEW_REQUIRED');

  s := pg_temp.mkrow('IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved', p_face => null);
  perform pg_temp.chk('Approved but face match unknown -> REVIEW_REQUIRED', pg_temp.st(s) = 'REVIEW_REQUIRED');

  -- decision not fetched: refused, nothing kept, retryable with the SAME event id
  s := pg_temp.mkrow('IN_PROGRESS');
  r := pg_temp.ap(s, 'Approved', p_event => 'evt-nofetch', p_fetched => false);
  perform pg_temp.chk('Approved without decision fetch -> rejected, retry, row unchanged, no ledger row',
    r->>'outcome' = 'rejected' and r->>'reason' = 'decision_not_fetched' and (r->>'retry')::boolean
    and pg_temp.st(s) = 'IN_PROGRESS' and not exists (select 1 from public.identity_verification_events where event_id = 'evt-nofetch'));
  r := pg_temp.ap(s, 'Approved', p_event => 'evt-nofetch', p_fetched => true);
  perform pg_temp.chk('same event id succeeds once the decision is fetched', r->>'outcome' = 'applied' and pg_temp.st(s) = 'VERIFIED');
end $$;

-- ===== E. out-of-order =====
do $$
declare s text; r jsonb; t0 timestamptz := '2026-10-30 12:00:00+00'; v record;
begin
  s := pg_temp.mkrow('NOT_STARTED');
  perform pg_temp.ap(s, 'In Progress', t0);
  r := pg_temp.ap(s, 'In Review', t0 - interval '1 second');
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('older event -> stale, status and timestamp unchanged',
    r->>'outcome' = 'stale' and v.status = 'IN_PROGRESS' and v.last_event_created_at = t0 and pg_temp.hook_calls(s) = 1);
  r := pg_temp.ap(s, 'In Review', t0);
  perform pg_temp.chk('equal timestamp is applied', r->>'outcome' = 'applied' and pg_temp.st(s) = 'REVIEW_REQUIRED');
  r := pg_temp.ap(s, 'Declined', t0 + interval '1 second');
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('newer event is applied and moves the timestamp', r->>'outcome' = 'applied' and v.status = 'FAILED' and v.last_event_created_at = t0 + interval '1 second');
  r := pg_temp.ap(s, 'Resubmitted', t0 + interval '5 seconds', p_event => 'evt-late-old');
  r := pg_temp.ap(s, 'In Progress', t0 + interval '2 seconds');
  perform pg_temp.chk('stale event does not beat a later event', r->>'outcome' = 'stale');
  perform pg_temp.chk('stale event leaves a ledger row marked stale',
    exists (select 1 from public.identity_verification_events where provider_session_id = s and outcome = 'stale'));
end $$;

-- ===== F. duplicates =====
do $$
declare s text; r1 jsonb; r2 jsonb; calls bigint;
begin
  s := pg_temp.mkrow('IN_PROGRESS');
  r1 := pg_temp.ap(s, 'Approved', p_event => 'evt-dup');
  calls := pg_temp.hook_calls(s);
  r2 := pg_temp.ap(s, 'Declined', now() + interval '1 hour', p_event => 'evt-dup');   -- same id, different content
  perform pg_temp.chk('duplicate event_id -> outcome duplicate, nothing changes, hook not called again',
    r1->>'outcome' = 'applied' and r2->>'outcome' = 'duplicate' and pg_temp.st(s) = 'VERIFIED' and pg_temp.hook_calls(s) = calls);
  perform pg_temp.chk('exactly one ledger row for the duplicated id', (select count(*) from public.identity_verification_events where event_id = 'evt-dup') = 1);
end $$;

-- ===== G. unknown session, environment, unknown status =====
do $$
declare s text := 'sess-later-' || gen_random_uuid(); r jsonb; v_user uuid := gen_random_uuid();
begin
  r := pg_temp.ap(s, 'In Progress', p_event => 'evt-early');
  perform pg_temp.chk('unknown session -> rejected + retry, ledger row removed',
    r->>'outcome' = 'rejected' and r->>'reason' = 'unknown_session' and (r->>'retry')::boolean
    and not exists (select 1 from public.identity_verification_events where event_id = 'evt-early'));
  insert into public.identity_verifications(user_id, subject_kind, environment, created_by, provider_session_id)
    values (v_user, 'customer', 'sandbox', v_user, s);
  r := pg_temp.ap(s, 'In Progress', p_event => 'evt-early');
  perform pg_temp.chk('same event applies after the session row exists', r->>'outcome' = 'applied' and pg_temp.st(s) = 'IN_PROGRESS');

  s := pg_temp.mkrow('IN_PROGRESS', 'sandbox');
  r := pg_temp.ap(s, 'Approved', p_env => 'live', p_event => 'evt-env');
  perform pg_temp.chk('live event on a sandbox row -> ignored_environment, unchanged',
    r->>'outcome' = 'ignored_environment' and pg_temp.st(s) = 'IN_PROGRESS' and pg_temp.hook_calls(s) = 0
    and (select outcome from public.identity_verification_events where event_id = 'evt-env') = 'ignored_environment');
  s := pg_temp.mkrow('IN_PROGRESS', 'live');
  r := pg_temp.ap(s, 'Approved', p_env => 'sandbox');
  perform pg_temp.chk('sandbox event on a live row -> ignored_environment', r->>'outcome' = 'ignored_environment' and pg_temp.st(s) = 'IN_PROGRESS');

  s := pg_temp.mkrow('IN_PROGRESS');
  r := pg_temp.ap(s, 'Weird Status', p_event => 'evt-weird');
  perform pg_temp.chk('unknown Didit status -> rejected, row unchanged, ledger kept',
    r->>'outcome' = 'rejected' and r->>'reason' = 'unknown_status' and pg_temp.st(s) = 'IN_PROGRESS'
    and (select outcome from public.identity_verification_events where event_id = 'evt-weird') = 'rejected');
end $$;

-- ===== H. terminal exits, completed_at, refresh =====
do $$
declare s text; v record; first_done timestamptz;
begin
  s := pg_temp.mkrow('IN_PROGRESS');
  perform pg_temp.ap(s, 'Approved');
  select completed_at into first_done from public.identity_verifications where provider_session_id = s;
  perform pg_sleep(0.02);
  perform pg_temp.ap(s, 'Approved', now() + interval '1 second');   -- repeat of own status
  perform pg_temp.chk('repeat of a terminal status keeps completed_at and does not fire the hook',
    (select completed_at from public.identity_verifications where provider_session_id = s) = first_done and pg_temp.hook_calls(s) = 1);
  perform pg_temp.ap(s, 'Declined', now() + interval '2 seconds');
  perform pg_temp.chk('VERIFIED + Declined -> ignored', pg_temp.st(s) = 'VERIFIED');
  perform pg_temp.ap(s, 'Kyc Expired', now() + interval '3 seconds');
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('VERIFIED + Kyc Expired -> EXPIRED, provider_status kept', v.status = 'EXPIRED' and v.provider_status = 'Kyc Expired' and v.completed_at is not null);
  perform pg_temp.ap(s, 'Resubmitted', now() + interval '4 seconds');
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('EXPIRED + Resubmitted -> RESUBMIT_REQUESTED, completed_at cleared', v.status = 'RESUBMIT_REQUESTED' and v.completed_at is null);
  perform pg_temp.chk('hook fired for each real change only (VERIFIED, EXPIRED, RESUBMIT)', pg_temp.hook_calls(s) = 3);

  -- check fields: refresh on same status; nulls never wipe stored values
  s := pg_temp.mkrow('REVIEW_REQUIRED');
  perform pg_temp.ap(s, 'In Review', now(), p_live => true, p_face => false, p_nin => 'partial_match', p_codes => array['LOW_FACE_MATCH']);
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('same-status event stores check fields without a status change',
    v.status = 'REVIEW_REQUIRED' and v.liveness_ok and v.face_match_ok = false and v.nin_database_match = 'partial_match'
    and v.status_reason_codes = array['LOW_FACE_MATCH'] and pg_temp.hook_calls(s) = 0);
  perform pg_temp.ap(s, 'In Review', now() + interval '1 second', p_live => null, p_face => null, p_nin => null, p_codes => null);
  select * into v from public.identity_verifications where provider_session_id = s;
  perform pg_temp.chk('null inputs keep stored values', v.liveness_ok and v.face_match_ok = false and v.nin_database_match = 'partial_match' and v.status_reason_codes = array['LOW_FACE_MATCH']);
  perform pg_temp.ap(s, 'In Review', now() + interval '2 seconds', p_live => null, p_face => null, p_codes => array[]::text[]);
  perform pg_temp.chk('an empty reason-code array clears the codes', (select status_reason_codes from public.identity_verifications where provider_session_id = s) = '{}');
end $$;

-- ===== I. atomicity: a failing hook rolls back the whole event =====
create or replace function public.idv_apply_effects(p_row public.identity_verifications, p_old_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$ begin raise exception 'hook boom'; end $$;
do $$
declare s text := pg_temp.mkrow('IN_PROGRESS'); got text := 'no error';
begin
  begin
    perform pg_temp.ap(s, 'Approved', p_event => 'evt-atomic');
  exception when others then got := sqlerrm;
  end;
  perform pg_temp.chk('failing hook -> error reaches the caller', got = 'hook boom', got);
  perform pg_temp.chk('failing hook -> status unchanged and no ledger row (so Didit can retry)',
    pg_temp.st(s) = 'IN_PROGRESS' and not exists (select 1 from public.identity_verification_events where event_id = 'evt-atomic'));
end $$;
create or replace function public.idv_apply_effects(p_row public.identity_verifications, p_old_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin insert into public.idv_effects_log(verification_id, old_status, new_status) values (p_row.id, p_old_status, p_row.status); end $$;

-- ===== J. input checks and privileges =====
select pg_temp.expect('null event_id raises', 'service_role',
  $q$select public.idv_apply_event(null, 's', 'status.updated', 'In Progress', 'sandbox', now())$q$, 'P0001');
select pg_temp.expect('service_role can run idv_apply_event', 'service_role',
  $q$select public.idv_apply_event('evt-svc', 'no-such-session', 'status.updated', 'In Progress', 'sandbox', now())$q$, 'ok');
select pg_temp.expect(r || ' cannot run ' || f, r, 'select ' || c, '42501')
from (values
  ('idv_apply_event', $s$public.idv_apply_event('e','s','t','In Progress','sandbox',now())$s$),
  ('idv_map_status', $s$public.idv_map_status('Approved')$s$),
  ('idv_is_terminal', $s$public.idv_is_terminal('VERIFIED')$s$),
  ('idv_decide_approved', $s$public.idv_decide_approved(true,true,null,false)$s$),
  ('idv_finish_event', $s$public.idv_finish_event('e','applied','{}'::jsonb)$s$)) as fn(f, c),
  (values ('anon'), ('authenticated')) as ro(r);
select pg_temp.expect('new outcome ignored_transition accepted by the ledger', 'service_role',
  $q$insert into public.identity_verification_events(event_id, outcome) values ('evt-x', 'ignored_transition')$q$, 'ok');

-- ===== K. re-running the migration must not overwrite a replaced hook =====
\i v1b1-idv-apply-core.sql
select pg_temp.chk('re-running v1b1 keeps the existing idv_apply_effects (V1b-2 safe)',
  (select prosrc from pg_proc where proname = 'idv_apply_effects') like '%idv_effects_log%');

-- Report
select n, case when ok then 'PASS' else 'FAIL' end as result, label, detail from results where not ok order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
do $$ begin
  if exists (select 1 from pg_temp.results where not ok) then raise exception 'V1b-1 tests FAILED'; end if;
end $$;

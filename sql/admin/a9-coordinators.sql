-- StreetTasker Admin Control Centre, stage A9: Coordinators and applications.
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a9-rollback.sql.
-- Needs stages A1 and A2 (admin core). The last line says DONE or NOT DONE.
--
-- What it does:
--   1. REPLACES the permission check of the existing admin_reassign_local_tasker (stage F-6). Before: is_local_tasker_admin()
--      (= _is_support(), which stage A13 widened to every admin with disputes.manage). After: the admin permission
--      coordinators.assign, or the SQL editor / service role exactly as before. The rest of the body is the F-6 body, plus
--      Rule R-SELF (never to or from the acting admin's own coordinator account) and an admin activity-log row.
--      The old body is saved first in admin_function_backups (first run only).
--   2. Adds admin_coordinator_* functions for the new page /admin/coordinators.html:
--        reads  : overview, workers, applications
--        writes : application approve / reject (wrap the EXISTING admin_*_coordinator_application functions, which are
--                 called by name and unchanged), create a code (wraps admin_create_coordinator_code),
--                 assign or move a Local Tasker (uses the existing assignment guard: tier capacity is decided by the
--                 database and cannot be bypassed), deactivate a coordinator.
--   Every write checks the permission on the server, refuses the admin's own coordinator account, and writes one row to the
--   admin activity log (refusals too). No test link, code or token is ever written to the log.
-- Money rule: nothing here touches a wallet, escrow row, payment or price. A Local Tasker's identity, services, photos and
-- payout account are not touched.

-- 0. Backup table (same as A13; created if A13 was not run)
create table if not exists public.admin_function_backups (
  name        text primary key,
  definition  text not null,
  saved_at    timestamptz not null default now()
);
alter table public.admin_function_backups enable row level security;
revoke all on public.admin_function_backups from anon, authenticated;

do $pre$
begin
  if to_regclass('public.admin_users') is null or to_regprocedure('public.admin_guard(text,text)') is null
     or to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
end
$pre$;

-- 1. Save the old body of admin_reassign_local_tasker (only if it exists and no copy is saved yet)
do $bk$
begin
  if to_regprocedure('public.admin_reassign_local_tasker(uuid,uuid,text)') is not null then
    insert into public.admin_function_backups (name, definition)
    values ('admin_reassign_local_tasker(uuid,uuid,text)',
            pg_get_functiondef('public.admin_reassign_local_tasker(uuid,uuid,text)'::regprocedure))
    on conflict (name) do nothing;
  end if;
end
$bk$;

-- 2. Replace admin_reassign_local_tasker (same signature, same result shape, same error hints as F-6)
create or replace function public.admin_reassign_local_tasker(p_tasker uuid, p_to_coordinator uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_actor uuid := auth.uid();
  v_allowed boolean;
  v_cur public.coordinator_assignments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name text;
  v_moved integer;
begin
  -- A9: an admin who holds coordinators.assign, or the SQL editor / service role (as before). Not "support" any more.
  v_allowed := public.admin_has('coordinators.assign')
               or (v_actor is null and coalesce(auth.role(), 'service_role') = 'service_role');
  if not v_allowed then
    raise exception 'Not allowed.' using errcode = 'P0001', hint = 'not_allowed';
  end if;
  if p_tasker is null or p_to_coordinator is null then
    raise exception 'Choose a Local Tasker and a coordinator.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if coalesce(char_length(v_reason), 0) > 300 then
    raise exception 'The reason is too long (300 characters at most).' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if not public.is_active_coordinator(p_to_coordinator) then
    raise exception 'The new coordinator is not an active coordinator.' using errcode = 'P0001', hint = 'not_active_coordinator';
  end if;

  select * into v_cur from public.coordinator_assignments
   where tasker_user_id = p_tasker and ended_at is null for update;
  if not found then
    raise exception 'This Local Tasker has no active coordinator.' using errcode = 'P0001', hint = 'not_assigned';
  end if;
  if v_cur.coordinator_id = p_to_coordinator then
    raise exception 'This Local Tasker already belongs to that coordinator.' using errcode = 'P0001', hint = 'same_coordinator';
  end if;
  -- Rule R-SELF: an admin never moves Local Taskers to or from their own coordinator account
  if v_actor is not null and (p_to_coordinator = v_actor or v_cur.coordinator_id = v_actor or p_tasker = v_actor) then
    raise exception 'You cannot move Local Taskers to or from your own account.' using errcode = 'P0001', hint = 'own_account';
  end if;

  update public.coordinator_assignments
     set ended_at = now(), ended_by = v_actor, end_reason = coalesce(v_reason, 'Moved to another coordinator by an administrator')
   where id = v_cur.id;

  insert into public.coordinator_assignments (tasker_user_id, coordinator_id, previous_coordinator_id, assigned_by, assign_reason)
  values (p_tasker, p_to_coordinator, v_cur.coordinator_id, v_actor, coalesce(v_reason, 'Moved by an administrator'));
  -- if the new coordinator has no free place the guard raises 'coordinator_cap' here and the whole move is rolled back

  select count(*) into v_moved from public.local_booking_state s where s.tasker_user_id = p_tasker and s.coordinator_id = p_to_coordinator;

  begin
    perform public.local_tasker_audit('local_tasker_reassigned', 'local_tasker', p_tasker::text,
      jsonb_build_object('coordinator_id', v_cur.coordinator_id),
      jsonb_build_object('coordinator_id', p_to_coordinator, 'reason', v_reason, 'bookings_now_with_new', v_moved), v_actor);
  exception when others then null;
  end;

  if v_actor is not null then
    perform public.admin_log('coordinator.reassign_local_tasker', 'local_tasker', p_tasker::text,
      jsonb_build_object('coordinator_id', v_cur.coordinator_id), jsonb_build_object('coordinator_id', p_to_coordinator),
      v_reason, null, 'ok', jsonb_build_object('bookings_now_with_new', v_moved));
  end if;

  begin
    select u.name into v_name from public.users u where u.id = p_tasker;      -- the PUBLIC name only (notifications are also emailed)
    perform public._notify(v_cur.coordinator_id, 'coordinator_assignment', 'A Local Tasker was moved to another coordinator',
      coalesce(v_name, 'A Local Tasker') || ' is no longer in your care. An administrator moved them to another coordinator.',
      jsonb_build_object('url', '/coordinator-taskers.html'));
    perform public._notify(p_to_coordinator, 'coordinator_assignment', 'A Local Tasker was assigned to you',
      coalesce(v_name, 'A Local Tasker') || ' is now in your care. Open their profile to see their services and bookings.',
      jsonb_build_object('url', '/coordinator-tasker.html?id=' || p_tasker::text));
  exception when others then null;
  end;

  return jsonb_build_object('tasker_user_id', p_tasker, 'from_coordinator', v_cur.coordinator_id, 'to_coordinator', p_to_coordinator,
                            'bookings_with_new_coordinator', v_moved);
end $function$;

revoke all on function public.admin_reassign_local_tasker(uuid, uuid, text) from public, anon;
grant execute on function public.admin_reassign_local_tasker(uuid, uuid, text) to authenticated;   -- the function itself refuses everyone who is not allowed

-- 3. Reads --------------------------------------------------------------------------------------------------------

-- Coordinators with their workload, and the Local Taskers who have no coordinator.
create or replace function public.admin_coordinator_overview()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  v_coords jsonb; v_unassigned jsonb; v_reason text;
begin
  if not public.admin_has('coordinators.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  begin
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_coords from (
      select jsonb_build_object(
        'user_id', c.user_id,
        'name', coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id)),
        'email', (select a.email from auth.users a where a.id = c.user_id),
        'status', c.status,
        'created_at', c.created_at,
        'last_sign_in_at', (select a.last_sign_in_at from auth.users a where a.id = c.user_id),
        'tier', (select s.tier from public.coordinator_tiers_state s where s.coordinator_id = c.user_id),
        'capacity', public.coordinator_capacity(c.user_id),
        'workers', (select count(*) from public.coordinator_assignments a where a.coordinator_id = c.user_id and a.ended_at is null),
        'published', (select count(*) from public.coordinator_assignments a
                        join public.local_tasker_profiles p on p.tasker_user_id = a.tasker_user_id
                       where a.coordinator_id = c.user_id and a.ended_at is null and p.status = 'published'),
        'bookings_total', (select count(*) from public.local_booking_state s where s.coordinator_id = c.user_id),
        'is_me', (c.user_id = auth.uid())
      ) as x
      from public.coordinators c
    ) q;
  exception when others then
    v_coords := null; v_reason := 'The coordinator list could not be read (' || sqlstate || ').';
  end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'tasker_user_id', p.tasker_user_id, 'name', p.full_name, 'status', p.status, 'areas', p.areas_served)
             order by p.full_name), '[]'::jsonb)
      into v_unassigned
      from public.local_tasker_profiles p
     where not exists (select 1 from public.coordinator_assignments a where a.tasker_user_id = p.tasker_user_id and a.ended_at is null);
  exception when others then
    v_unassigned := null;
  end;
  return jsonb_build_object('ok', true,
    'coordinators', v_coords, 'coordinators_error', v_reason,
    'unassigned', v_unassigned,
    'can_assign', public.admin_has('coordinators.assign'),
    'can_manage', public.admin_has('coordinators.manage'),
    'can_review', public.admin_has('coordinators.applications.review'));
end $f$;

-- The Local Taskers one coordinator looks after now
create or replace function public.admin_coordinator_workers(p_coordinator uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare v jsonb;
begin
  if not public.admin_has('coordinators.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'tasker_user_id', a.tasker_user_id, 'name', p.full_name, 'status', p.status, 'areas', p.areas_served,
             'assigned_at', a.assigned_at,
             'bookings', (select count(*) from public.local_booking_state s where s.tasker_user_id = a.tasker_user_id))
             order by a.assigned_at desc), '[]'::jsonb)
      into v
      from public.coordinator_assignments a
      left join public.local_tasker_profiles p on p.tasker_user_id = a.tasker_user_id
     where a.coordinator_id = p_coordinator and a.ended_at is null;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'The list could not be read (' || sqlstate || ').');
  end;
  return jsonb_build_object('ok', true, 'workers', v);
end $f$;

-- Applications (applicant answers; never the token or the code itself)
create or replace function public.admin_coordinator_applications(p_status text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare v jsonb; v_keep text[] := array['id','full_name','email','phone','whatsapp','state','city','tasker_count','area_sqm',
      'can_meet_taskers','can_explain','explain_text','answers','status','created_at','token_expires_at','decided_at',
      'reject_reason','rejected_reason','decision_note','reviewed_at'];
begin
  if not public.admin_has('coordinators.applications.review') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_status is not null and p_status not in ('new', 'approved', 'rejected', 'passed') then
    return jsonb_build_object('ok', false, 'error', 'Unknown status.');
  end if;
  begin
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v from (
      select (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(to_jsonb(a)) e where e.key = any (v_keep))
             || jsonb_build_object(
                 'code_state', (select case when cc.used_at is not null then 'used'
                                            when cc.expires_at is not null and cc.expires_at < now() then 'expired'
                                            else 'issued' end
                                  from public.coordinator_codes cc where cc.application_id = a.id
                                  order by cc.expires_at desc nulls last limit 1)) as x
        from public.coordinator_applications a
       where p_status is null or a.status = p_status
       order by a.created_at desc
       limit 200
    ) q;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'Applications could not be read (' || sqlstate || ').');
  end;
  return jsonb_build_object('ok', true, 'applications', v);
end $f$;

-- 4. Application decisions (wrap the existing functions by name; nothing about them is changed) -------------------

create or replace function public.admin_coordinator_application_approve(p_application uuid, p_days integer default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_res jsonb; v_status text; v_link text;
begin
  if not public.admin_guard('coordinators.applications.review', 'coordinator.application_approve') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_application is null then return jsonb_build_object('ok', false, 'error', 'Choose an application.'); end if;
  if p_days is not null and (p_days < 1 or p_days > 60) then
    return jsonb_build_object('ok', false, 'error', 'The link can last 1 to 60 days.');
  end if;
  if to_regprocedure('public.admin_approve_coordinator_application(uuid,integer)') is null then
    return jsonb_build_object('ok', false, 'error', 'The existing approval function was not found. Nothing was changed.');
  end if;
  select a.status into v_status from public.coordinator_applications a where a.id = p_application;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'Application not found.'); end if;
  begin
    if p_days is null then
      execute format('select to_jsonb(public.admin_approve_coordinator_application(%L::uuid))', p_application) into v_res;
    else
      execute format('select to_jsonb(public.admin_approve_coordinator_application(%L::uuid, %s))', p_application, p_days) into v_res;
    end if;
  exception when others then
    perform public.admin_log('coordinator.application_approve', 'coordinator_application', p_application::text, null, null, null, null,
                             'error', jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false,
      'error', 'The existing approval function refused or failed. Nothing was recorded.', 'sqlstate', sqlstate);
  end;
  -- the existing function returns the test link; hand it to the page but never write it to the log
  v_link := coalesce(v_res #>> '{}', v_res ->> 'link', v_res ->> 'url', v_res ->> 'test_link');
  perform public.admin_log('coordinator.application_approve', 'coordinator_application', p_application::text,
                           jsonb_build_object('status', v_status), jsonb_build_object('status', 'approved'),
                           null, null, 'ok', jsonb_build_object('days', p_days));
  return jsonb_build_object('ok', true, 'link', v_link);
end $f$;

create or replace function public.admin_coordinator_application_reject(p_application uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_reason text := btrim(coalesce(p_reason, '')); v_status text;
begin
  if not public.admin_guard('coordinators.applications.review', 'coordinator.application_reject') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_application is null then return jsonb_build_object('ok', false, 'error', 'Choose an application.'); end if;
  if char_length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'The reason is too long (300 characters at most).'); end if;
  if to_regprocedure('public.admin_reject_coordinator_application(uuid,text)') is null then
    return jsonb_build_object('ok', false, 'error', 'The existing reject function was not found. Nothing was changed.');
  end if;
  select a.status into v_status from public.coordinator_applications a where a.id = p_application;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'Application not found.'); end if;
  begin
    execute format('select public.admin_reject_coordinator_application(%L::uuid, %L)', p_application, v_reason);
  exception when others then
    perform public.admin_log('coordinator.application_reject', 'coordinator_application', p_application::text, null, null, v_reason, null,
                             'error', jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false,
      'error', 'The existing reject function refused or failed. Nothing was recorded.', 'sqlstate', sqlstate);
  end;
  perform public.admin_log('coordinator.application_reject', 'coordinator_application', p_application::text,
                           jsonb_build_object('status', v_status), jsonb_build_object('status', 'rejected'), v_reason, null, 'ok', null);
  return jsonb_build_object('ok', true);
end $f$;

-- Optional: a manual coordinator sign-up code (the code is returned once and never logged)
create or replace function public.admin_coordinator_code_create(p_note text, p_days integer default 30)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_note text := btrim(coalesce(p_note, '')); v_res jsonb;
begin
  if not public.admin_guard('coordinators.manage', 'coordinator.code_create') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if char_length(v_note) < 3 or char_length(v_note) > 120 then
    return jsonb_build_object('ok', false, 'error', 'Write who the code is for (3 to 120 characters).');
  end if;
  if p_days is null or p_days < 1 or p_days > 60 then
    return jsonb_build_object('ok', false, 'error', 'The code can last 1 to 60 days.');
  end if;
  if to_regprocedure('public.admin_create_coordinator_code(text,integer)') is null then
    return jsonb_build_object('ok', false, 'error', 'The existing code function was not found. Nothing was changed.');
  end if;
  begin
    execute format('select to_jsonb(public.admin_create_coordinator_code(%L, %s))', v_note, p_days) into v_res;
  exception when others then
    perform public.admin_log('coordinator.code_create', 'coordinator_code', null, null, null, v_note, null, 'error',
                             jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'error', 'The existing code function refused or failed. Nothing was recorded.', 'sqlstate', sqlstate);
  end;
  perform public.admin_log('coordinator.code_create', 'coordinator_code', null, null, null, v_note, null, 'ok',
                           jsonb_build_object('days', p_days));
  return jsonb_build_object('ok', true, 'code', coalesce(v_res #>> '{}', v_res ->> 'code'));
end $f$;

-- 5. Assign (first time) or move a Local Tasker -------------------------------------------------------------------
-- The database's own guard decides whether the coordinator is active and has a free place on their plan.
create or replace function public.admin_coordinator_assign_local_tasker(p_tasker uuid, p_coordinator uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, '')); v_cur uuid; v_res jsonb; v_hint text; v_msg text; v_name text;
begin
  if not public.admin_guard('coordinators.assign', 'coordinator.assign_local_tasker') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_tasker is null or p_coordinator is null then
    return jsonb_build_object('ok', false, 'error', 'Choose a Local Tasker and a coordinator.');
  end if;
  if char_length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'The reason is too long (300 characters at most).'); end if;
  -- Rule R-SELF
  if p_coordinator = v_actor or p_tasker = v_actor
     or exists (select 1 from public.coordinator_assignments a where a.tasker_user_id = p_tasker and a.ended_at is null and a.coordinator_id = v_actor) then
    perform public.admin_log('coordinator.assign_local_tasker', 'local_tasker', p_tasker::text, null, null, v_reason, null, 'refused',
                             jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'You cannot assign Local Taskers to or from your own account.');
  end if;
  if not exists (select 1 from public.local_tasker_profiles p where p.tasker_user_id = p_tasker) then
    return jsonb_build_object('ok', false, 'error', 'That person is not a Local Tasker.');
  end if;
  if not public.is_active_coordinator(p_coordinator) then
    return jsonb_build_object('ok', false, 'error', 'That coordinator is not active.');
  end if;

  select a.coordinator_id into v_cur from public.coordinator_assignments a where a.tasker_user_id = p_tasker and a.ended_at is null;
  begin
    if v_cur is not null then
      -- already has a coordinator: this is a move (the replaced function checks the permission and R-SELF again)
      v_res := public.admin_reassign_local_tasker(p_tasker, p_coordinator, v_reason);
      return jsonb_build_object('ok', true, 'kind', 'moved', 'result', v_res);
    end if;

    insert into public.coordinator_assignments (tasker_user_id, coordinator_id, assigned_by, assign_reason)
    values (p_tasker, p_coordinator, v_actor, v_reason);
    -- the guard raises 'coordinator_cap' here if the coordinator has no free place; the whole call is undone

    begin
      perform public.local_tasker_audit('local_tasker_assigned', 'local_tasker', p_tasker::text, null,
        jsonb_build_object('coordinator_id', p_coordinator, 'reason', v_reason), v_actor);
    exception when others then null;
    end;
    begin
      select u.name into v_name from public.users u where u.id = p_tasker;
      perform public._notify(p_coordinator, 'coordinator_assignment', 'A Local Tasker was assigned to you',
        coalesce(v_name, 'A Local Tasker') || ' is now in your care. Open their profile to see their services and bookings.',
        jsonb_build_object('url', '/coordinator-tasker.html?id=' || p_tasker::text));
    exception when others then null;
    end;
    perform public.admin_log('coordinator.assign_local_tasker', 'local_tasker', p_tasker::text, null,
                             jsonb_build_object('coordinator_id', p_coordinator), v_reason, null, 'ok', null);
    return jsonb_build_object('ok', true, 'kind', 'assigned');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    perform public.admin_log('coordinator.assign_local_tasker', 'local_tasker', p_tasker::text, null, null, v_reason, null, 'refused',
                             jsonb_build_object('hint', v_hint, 'sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'hint', v_hint,
      'error', case
        when v_hint = 'coordinator_cap' or v_msg ilike '%capacity%' or v_msg ilike '%no free place%'
          then 'That coordinator has no free place on their plan. Nothing was changed.'
        when v_hint in ('same_coordinator', 'not_assigned', 'not_active_coordinator', 'own_account') then v_msg
        else 'The database refused this change. Nothing was changed.' end);
  end;
end $f$;

-- 6. Deactivate a coordinator (reversible: the row stays; status becomes 'deactivated') -------------------------------
create or replace function public.admin_coordinator_deactivate(p_coordinator uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_reason text := btrim(coalesce(p_reason, '')); v_status text; v_workers int; v_open int;
begin
  if not public.admin_guard('coordinators.manage', 'coordinator.deactivate') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_coordinator is null then return jsonb_build_object('ok', false, 'error', 'Choose a coordinator.'); end if;
  if char_length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'The reason is too long (300 characters at most).'); end if;
  if p_coordinator = auth.uid() then
    perform public.admin_log('coordinator.deactivate', 'coordinator', p_coordinator::text, null, null, v_reason, null, 'refused',
                             jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'You cannot deactivate your own coordinator account here.');
  end if;
  select c.status into v_status from public.coordinators c where c.user_id = p_coordinator for update;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'Coordinator not found.'); end if;
  if v_status = 'deactivated' then return jsonb_build_object('ok', false, 'error', 'This coordinator is already deactivated.'); end if;

  select count(*) into v_workers from public.coordinator_assignments a where a.coordinator_id = p_coordinator and a.ended_at is null;
  -- "open" = a booking that is not completed or cancelled (the same working guess as stage A1b; it errs on the side of blocking)
  select count(*) into v_open from public.local_booking_state s join public.bookings b on b.id = s.booking_id
   where s.coordinator_id = p_coordinator and coalesce(b.status, '') not in ('completed', 'cancelled');
  if v_workers > 0 or v_open > 0 then
    perform public.admin_log('coordinator.deactivate', 'coordinator', p_coordinator::text, null, null, v_reason, null, 'refused',
                             jsonb_build_object('workers', v_workers, 'open_bookings', v_open));
    return jsonb_build_object('ok', false, 'workers', v_workers, 'open_bookings', v_open,
      'error', 'This coordinator still looks after ' || v_workers || ' Local Tasker(s) and ' || v_open
               || ' open booking(s). Move the Local Taskers to another active coordinator first. Nothing was changed.');
  end if;

  update public.coordinators set status = 'deactivated' where user_id = p_coordinator;
  perform public.admin_log('coordinator.deactivate', 'coordinator', p_coordinator::text,
                           jsonb_build_object('status', v_status), jsonb_build_object('status', 'deactivated'), v_reason, null, 'ok', null);
  return jsonb_build_object('ok', true);
end $f$;

-- 7. Grants: the browser may call these functions and nothing else; each checks the admin permission itself
do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin\_coordinator\_%' loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$g$;

-- Result line
select case
  when to_regprocedure('public.admin_coordinator_overview()') is not null
   and to_regprocedure('public.admin_coordinator_assign_local_tasker(uuid,uuid,text)') is not null
   and pg_get_functiondef('public.admin_reassign_local_tasker(uuid,uuid,text)'::regprocedure) ilike '%admin_has(''coordinators.assign'')%'
  then 'DONE: A9 installed. Admins with the coordinator permissions can use /admin/coordinators.html. Reassign now needs coordinators.assign.'
  else 'NOT DONE: see the messages above.'
end as a9_result;

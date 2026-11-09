-- StreetTasker Admin Control Centre, stage A12b: Local booking operations.
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a12b-rollback.sql.
-- Needs A1 (admin core), A9 (admin_coordinator_assign_local_tasker) and A12a. The last line says DONE or NOT DONE.
--
-- Written from the REAL function sources the owner pasted (sql/admin/a12b-check.sql result, 2026-11-09), not from guesses.
-- What the real database does (and so what this file does):
--   * A booking has no coordinator of its own: it FOLLOWS its Local Tasker's coordinator (_local_booking_follow_assignment). So
--     "reassign a booking" = move that Local Tasker to another coordinator through the A9 function (permission, R-SELF and the
--     plan-limit guard all apply), then make sure the booking followed. Every open booking of that worker moves with them.
--   * The real unlock (local_booking_code_unlock) is open only to is_local_tasker_admin(), so an admin cannot call it. The admin
--     version below does the same single write (bookings.code_attempts = 0) after its own checks.
--   * Exceptions (customer unreachable, tasker no-show) are written by the coordinator and are immutable. Admin only READS them.
--
-- Adds (SECURITY DEFINER, execute for authenticated only, each checks its permission on the server):
--   admin_local_booking_coordinators()                          read   local_bookings.reassign   active coordinators and free places
--   admin_local_booking_reassign(booking, coordinator, reason)  write  local_bookings.reassign   (+ coordinators.assign, checked by A9)
--   admin_local_booking_unlock(booking, reason)                 write  local_bookings.unlock     reset the wrong-code counter
--   admin_local_exception_list(filter, offset)                  read   bookings.view             problems reported by coordinators
--   admin_booking_detail(booking)                               read   REPLACED: "Problems reported" now reads the real columns
--
-- Hard boundaries kept: no price, quote, consent, payment, escrow, wallet or payout row is written; the completion code is never read
-- or shown (the counter is reset, the code itself is untouched); the worker's agreement to a job is never bypassed.

do $pre$
begin
  if to_regprocedure('public.admin_guard(text,text)') is null or to_regprocedure('public.admin_has(text)') is null
     or to_regprocedure('public.admin_log(text,text,text,jsonb,jsonb,text,uuid,text,jsonb)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
  if to_regprocedure('public.admin_coordinator_assign_local_tasker(uuid,uuid,text)') is null then
    raise exception 'NOT DONE: stage A9 is not installed. Nothing was changed.';
  end if;
  if to_regprocedure('public._a12a_pick(jsonb,text[])') is null then
    raise exception 'NOT DONE: stage A12a is not installed (run sql/admin/a12a-bookings.sql first). Nothing was changed.';
  end if;
  if to_regprocedure('public._local_booking_follow_assignment(uuid)') is null or to_regprocedure('public._local_booking_is_open(text)') is null
     or to_regprocedure('public.job_booking_frozen(uuid)') is null or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null then
    raise exception 'NOT DONE: an existing Local booking helper function is missing. Nothing was changed.';
  end if;
end
$pre$;

-- 1. Fix to the A12a detail: the real local_booking_exceptions columns are happened_at and recorded_at (no created_at, no resolved_at).
create or replace function public.admin_booking_detail(p_booking uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  b public.bookings; s public.local_booking_state;
  v_booking jsonb; v_local jsonb; v_quote jsonb; v_miles jsonb; v_exc jsonb; v_levents jsonb; v_events jsonb; v_escrow jsonb; v_disp jsonb;
  v_failed text[] := '{}'::text[]; v_attempts integer;
begin
  if not public.admin_has('bookings.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_booking is null then return jsonb_build_object('ok', false, 'error', 'Choose a booking.'); end if;
  select * into b from public.bookings where id = p_booking;
  if not found then return jsonb_build_object('ok', false, 'error', 'Booking not found.'); end if;
  v_attempts := coalesce(nullif(to_jsonb(b) ->> 'code_attempts', '')::integer, 0);

  -- the booking itself (named keys only: no completion code, address, notes or phone)
  begin
    v_booking := public._a12a_pick(to_jsonb(b), array['id', 'status', 'payment_status', 'work_stage', 'amount', 'scheduled_time',
                                                       'created_at', 'completed_at', 'dispute_reason', 'service_id', 'task_id'])
      || jsonb_build_object('code_attempts', v_attempts,
           'locked', (v_attempts >= 3 and coalesce(b.status, '') not in ('completed', 'cancelled')),
           'customer_id', b.customer_id::text, 'tasker_id', b.tasker_id::text,
           'customer_name', (select u.name from public.users u where u.id::text = b.customer_id::text),
           'tasker_name', (select u.name from public.users u where u.id::text = b.tasker_id::text),
           'task_title', (select t.title from public.tasks t where t.id::text = to_jsonb(b) ->> 'task_id'));
  exception when others then v_failed := v_failed || 'booking'::text; v_booking := null;
  end;

  -- Local booking state, if this is a Local booking
  begin
    select * into s from public.local_booking_state where booking_id = p_booking limit 1;
    if found then
      v_local := jsonb_build_object('lt_status', s.lt_status, 'coordinator_id', s.coordinator_id, 'original_coordinator_id', s.original_coordinator_id,
        'worker_id', s.tasker_user_id,
        'worker_name', (select lp.full_name from public.local_tasker_profiles lp where lp.tasker_user_id = s.tasker_user_id),
        'coordinator_name', (select coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id)) from public.coordinators c where c.user_id = s.coordinator_id),
        'original_coordinator_name', (select coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id)) from public.coordinators c where c.user_id = s.original_coordinator_id));
    end if;
  exception when others then v_failed := v_failed || 'local'::text; v_local := null;
  end;

  if v_local is not null then
    begin
      select public._a12a_pick(to_jsonb(q), array['version', 'service_fee', 'transport_amount', 'materials_amount', 'created_at'])
        into v_quote from public.local_booking_quotes q where q.booking_id = p_booking and q.superseded_at is null order by q.version desc limit 1;
    exception when others then v_failed := v_failed || 'quote'::text; v_quote := null;
    end;
    begin
      select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(m), array['kind', 'created_at']) order by to_jsonb(m) ->> 'created_at'), '[]'::jsonb)
        into v_miles from public.local_booking_milestones m where to_jsonb(m) ->> 'booking_id' = p_booking::text;
    exception when others then v_failed := v_failed || 'milestones'::text; v_miles := null;
    end;
    begin
      select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(x), array['kind', 'happened_at', 'recorded_at']) order by to_jsonb(x) ->> 'happened_at'), '[]'::jsonb)
        into v_exc from public.local_booking_exceptions x where to_jsonb(x) ->> 'booking_id' = p_booking::text;
    exception when others then v_failed := v_failed || 'exceptions'::text; v_exc := null;
    end;
    begin
      select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(e), array['id', 'kind', 'event', 'event_type', 'created_at']) order by to_jsonb(e) ->> 'created_at', to_jsonb(e) ->> 'id'), '[]'::jsonb)
        into v_levents from (select * from public.local_booking_events le where to_jsonb(le) ->> 'booking_id' = p_booking::text limit 200) e;
    exception when others then v_failed := v_failed || 'local_events'::text; v_levents := null;
    end;
  end if;

  -- general timeline (job_events); key names only, no free text
  begin
    select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(e), array['id', 'kind', 'event', 'event_type', 'type', 'created_at']) order by to_jsonb(e) ->> 'created_at', to_jsonb(e) ->> 'id'), '[]'::jsonb)
      into v_events from (select * from public.job_events je where to_jsonb(je) ->> 'booking_id' = p_booking::text limit 200) e;
  exception when others then v_failed := v_failed || 'timeline'::text; v_events := null;
  end;

  -- payment held for the booking: read only; admin never moves, releases or refunds from here
  begin
    select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(p), array['status', 'amount', 'platform_fee', 'tasker_amount', 'created_at', 'released_at'])
                              order by to_jsonb(p) ->> 'created_at'), '[]'::jsonb)
      into v_escrow from public.escrow_payments p where to_jsonb(p) ->> 'booking_id' = p_booking::text;
  exception when others then v_failed := v_failed || 'payment'::text; v_escrow := null;
  end;

  -- disputes linked to this booking (by a booking_id key, or through the booking's chat thread)
  begin
    select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(d), array['id', 'status', 'category', 'opened_by_role', 'opened_at', 'resolved_at'])
                              order by to_jsonb(d) ->> 'opened_at'), '[]'::jsonb)
      into v_disp from public.job_disputes d
     where to_jsonb(d) ->> 'booking_id' = p_booking::text
        or exists (select 1 from public.message_threads t where t.id = d.thread_id and to_jsonb(t) ->> 'booking_id' = p_booking::text);
  exception when others then v_failed := v_failed || 'disputes'::text; v_disp := null;
  end;

  return jsonb_build_object('ok', true, 'booking', v_booking, 'local', v_local, 'quote', v_quote, 'milestones', v_miles, 'exceptions', v_exc,
    'local_events', v_levents, 'timeline', v_events, 'payment', v_escrow, 'disputes', v_disp, 'sections_failed', to_jsonb(v_failed));
end $f$;

-- 2. Coordinators the admin can choose from (read only) ----------------------------------------------------------------------
create or replace function public.admin_local_booking_coordinators()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
begin
  if not public.admin_has('local_bookings.reassign') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  return jsonb_build_object('ok', true, 'coordinators', coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', c.user_id,
             'name', coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id)),
             'workers', (select count(*) from public.coordinator_assignments a where a.coordinator_id = c.user_id and a.ended_at is null),
             'capacity', public.coordinator_capacity(c.user_id),
             'is_me', (c.user_id = auth.uid()))
             order by coalesce(nullif(c.display_name, ''), c.user_id::text))
      from public.coordinators c where c.status = 'active'), '[]'::jsonb));
exception when others then
  return jsonb_build_object('ok', false, 'error', 'Coordinators could not be read (' || sqlstate || ').');
end $f$;

-- 3. Reassign (H1) ------------------------------------------------------------------------------------------------------------
create or replace function public.admin_local_booking_reassign(p_booking uuid, p_coordinator uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, ''));
  s public.local_booking_state; b public.bookings; v_res jsonb; v_after public.local_booking_state; v_hint text;
begin
  if not public.admin_guard('local_bookings.reassign', 'local_booking.reassign') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_booking is null or p_coordinator is null then return jsonb_build_object('ok', false, 'error', 'Choose a booking and a coordinator.'); end if;
  if char_length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters.'); end if;
  if char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'The reason is too long (300 characters at most).'); end if;

  select * into s from public.local_booking_state where booking_id = p_booking;
  if not found then return jsonb_build_object('ok', false, 'error', 'This is not a Local Tasker booking.'); end if;
  select * into b from public.bookings where id = p_booking;
  if not found then return jsonb_build_object('ok', false, 'error', 'Booking not found.'); end if;
  if not public._local_booking_is_open(b.status) then
    return jsonb_build_object('ok', false, 'error', 'This booking is closed, so its coordinator cannot be changed.');
  end if;
  if p_coordinator = v_actor or s.tasker_user_id = v_actor or s.coordinator_id = v_actor then   -- Rule R-SELF
    perform public.admin_log('local_booking.reassign', 'booking', p_booking::text, null, null, v_reason, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This booking is in the care of your own coordinator account. Another admin must do this.');
  end if;
  if s.coordinator_id is not distinct from p_coordinator then
    return jsonb_build_object('ok', false, 'error', 'This booking is already with that coordinator.');
  end if;

  begin
    -- moves the Local Tasker (permission, R-SELF and the plan-limit guard are checked again inside)
    v_res := public.admin_coordinator_assign_local_tasker(s.tasker_user_id, p_coordinator, v_reason);
    if coalesce((v_res ->> 'ok')::boolean, false) is not true then
      raise exception 'assign refused' using errcode = 'P0001', hint = coalesce(v_res ->> 'error', 'refused');
    end if;
    -- the booking follows its worker; calling this again is harmless (it skips bookings that already match)
    perform public._local_booking_follow_assignment(s.tasker_user_id);
    select * into v_after from public.local_booking_state where booking_id = p_booking;
    if v_after.coordinator_id is distinct from p_coordinator then
      raise exception 'booking did not follow' using errcode = 'P0001', hint = 'The booking did not follow its worker to the new coordinator. Nothing was changed.';
    end if;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform public.admin_log('local_booking.reassign', 'booking', p_booking::text, null, null, v_reason, null, 'refused',
                             jsonb_build_object('hint', v_hint, 'sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'The database refused this change. Nothing was changed.'));
  end;

  begin
    perform public.local_tasker_audit('local_booking_reassigned_by_admin', 'booking', p_booking::text,
      jsonb_build_object('coordinator_id', s.coordinator_id, 'lt_status', s.lt_status),
      jsonb_build_object('coordinator_id', p_coordinator, 'lt_status', v_after.lt_status, 'reason', v_reason), v_actor);
  exception when others then null;
  end;
  perform public.admin_log('local_booking.reassign', 'booking', p_booking::text,
    jsonb_build_object('coordinator_id', s.coordinator_id, 'lt_status', s.lt_status),
    jsonb_build_object('coordinator_id', p_coordinator, 'lt_status', v_after.lt_status), v_reason, null, 'ok', null);
  return jsonb_build_object('ok', true, 'coordinator_id', p_coordinator, 'lt_status', v_after.lt_status);
end $f$;

-- 4. Unlock after three wrong completion codes (H3) ---------------------------------------------------------------------------
create or replace function public.admin_local_booking_unlock(p_booking uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_actor uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, ''));
  s public.local_booking_state; b public.bookings; v_old integer;
begin
  if not public.admin_guard('local_bookings.unlock', 'local_booking.unlock') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if p_booking is null then return jsonb_build_object('ok', false, 'error', 'Choose a booking.'); end if;
  if char_length(v_reason) < 10 then return jsonb_build_object('ok', false, 'error', 'Write a reason of at least 10 characters (for example, that you spoke to the customer).'); end if;
  if char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'The reason is too long (300 characters at most).'); end if;

  select * into s from public.local_booking_state where booking_id = p_booking;
  if not found then return jsonb_build_object('ok', false, 'error', 'This is not a Local Tasker booking.'); end if;
  select * into b from public.bookings where id = p_booking for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Booking not found.'); end if;
  if s.tasker_user_id = v_actor or s.coordinator_id = v_actor then   -- Rule R-SELF
    perform public.admin_log('local_booking.unlock', 'booking', p_booking::text, null, null, v_reason, null, 'refused', jsonb_build_object('why', 'own_account'));
    return jsonb_build_object('ok', false, 'error', 'This booking is in the care of your own coordinator account. Another admin must do this.');
  end if;
  if coalesce(b.status, '') in ('completed', 'cancelled') or b.payment_status = 'released' then
    return jsonb_build_object('ok', false, 'error', 'This booking is already closed, so there is nothing to unlock.');
  end if;
  if b.status = 'disputed' or public.job_booking_frozen(p_booking) then
    return jsonb_build_object('ok', false, 'error', 'A problem report or dispute is open on this booking. It cannot be unlocked until support has decided it.');
  end if;
  if b.payment_status is null or b.payment_status in ('unpaid', 'failed', '') then
    return jsonb_build_object('ok', false, 'error', 'Payment has not been made for this booking, so there is no code to unlock.');
  end if;
  v_old := coalesce(b.code_attempts, 0);
  if v_old < 3 then
    return jsonb_build_object('ok', false, 'error', 'This booking is not locked (wrong tries: ' || v_old || ').');
  end if;

  begin
    update public.bookings set code_attempts = 0 where id = p_booking;   -- the same single write as the coordinator-side unlock; the code itself is untouched
  exception when others then
    perform public.admin_log('local_booking.unlock', 'booking', p_booking::text, null, null, v_reason, null, 'error', jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'error', 'The database refused this change. Nothing was changed.');
  end;
  begin
    perform public.local_tasker_audit('release_code_unlocked_by_admin', 'booking', p_booking::text, jsonb_build_object('attempts', v_old),
      jsonb_build_object('booking_id', p_booking, 'reason', v_reason), v_actor);
  exception when others then null;
  end;
  perform public.admin_log('local_booking.unlock', 'booking', p_booking::text, jsonb_build_object('code_attempts', v_old),
                           jsonb_build_object('code_attempts', 0), v_reason, null, 'ok', null);
  if s.coordinator_id is not null then
    begin
      perform public._notify(s.coordinator_id, 'coordinator_assignment', 'A booking was unlocked',
        'An administrator reset the wrong-code counter on one of your bookings. The worker can enter the code again.',
        jsonb_build_object('url', '/coordinator-booking.html?id=' || p_booking::text));
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true);
end $f$;

-- 5. Problems queue (H4, read only) -------------------------------------------------------------------------------------------
create or replace function public.admin_local_exception_list(p_filter text default 'open', p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  v_filter text := coalesce(p_filter, 'open'); v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer; v_items jsonb; v_counts jsonb;
begin
  if not public.admin_has('bookings.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if v_filter not in ('open', 'limit_reached', 'no_show', 'all') then
    return jsonb_build_object('ok', false, 'error', 'Unknown filter.');
  end if;
  begin
    with ex as (
      select e.booking_id,
             count(*) filter (where e.kind = 'customer_unreachable') as unreachable,
             count(*) filter (where e.kind = 'tasker_no_show') as no_show,
             max(e.happened_at) as last_at
        from public.local_booking_exceptions e group by e.booking_id
    ), base as (
      select ex.*, b.status, s.lt_status, s.coordinator_id, public._local_booking_is_open(b.status) as is_open,
             (select u.name from public.users u where u.id::text = b.customer_id::text) as customer_name,
             (select lp.full_name from public.local_tasker_profiles lp where lp.tasker_user_id = s.tasker_user_id) as worker_name,
             (select coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id))
                from public.coordinators c where c.user_id = s.coordinator_id) as coordinator_name
        from ex join public.bookings b on b.id = ex.booking_id join public.local_booking_state s on s.booking_id = ex.booking_id
    ), filt as (
      select * from base
       where case v_filter when 'open' then is_open when 'limit_reached' then is_open and unreachable >= 5
                           when 'no_show' then is_open and no_show > 0 else true end
    ), pg as (
      select * from filt order by last_at desc nulls last, booking_id limit 50 offset v_off
    )
    select (select count(*) from filt),
           (select coalesce(jsonb_agg(jsonb_build_object(
                'id', pg.booking_id, 'status', pg.status, 'lt_status', pg.lt_status, 'customer_name', pg.customer_name,
                'tasker_name', pg.worker_name, 'coordinator_name', pg.coordinator_name, 'unreachable', pg.unreachable,
                'no_show', pg.no_show, 'last_at', pg.last_at, 'is_open', pg.is_open, 'limit_reached', (pg.unreachable >= 5))
                order by pg.last_at desc nulls last, pg.booking_id), '[]'::jsonb) from pg),
           jsonb_build_object(
             'all', (select count(*) from base),
             'open', (select count(*) from base where is_open),
             'limit_reached', (select count(*) from base where is_open and unreachable >= 5),
             'no_show', (select count(*) from base where is_open and no_show > 0))
      into v_total, v_items, v_counts;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'The list could not be read (' || sqlstate || ').');
  end;
  return jsonb_build_object('ok', true, 'total', v_total, 'offset', v_off, 'page_size', 50, 'items', v_items, 'counts', v_counts);
end $f$;

-- 6. Grants -------------------------------------------------------------------------------------------------------------------
do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_local_booking_coordinators', 'admin_local_booking_reassign',
                                                         'admin_local_booking_unlock', 'admin_local_exception_list', 'admin_booking_detail') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$g$;

select case
  when to_regprocedure('public.admin_local_booking_coordinators()') is not null
   and to_regprocedure('public.admin_local_booking_reassign(uuid,uuid,text)') is not null
   and to_regprocedure('public.admin_local_booking_unlock(uuid,text)') is not null
   and to_regprocedure('public.admin_local_exception_list(text,integer)') is not null
  then 'DONE: A12b installed. Admins with the Local booking permissions can use /admin/bookings.html.'
  else 'NOT DONE: see the messages above.'
end as a12b_result;

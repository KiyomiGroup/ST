-- StreetTasker Admin Control Centre, stage A12a: Bookings, Local bookings and Tasks (READ ONLY queues).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a12a-rollback.sql.
-- Needs stage A1 (admin core). The last line says DONE or NOT DONE.
--
-- What it adds (all SECURITY DEFINER, execute for authenticated only, each one checks the admin permission itself):
--   admin_booking_list(kind, search, filter, offset)   read  bookings.view   regular or Local bookings, 50 per page, with counts
--   admin_booking_detail(booking)                      read  bookings.view   one booking, its Local state, timeline, payment status
--   admin_task_list(search, filter, offset)            read  bookings.view   tasks customers posted, 50 per page, with counts
--
-- Nothing here writes anything. No table, policy or existing function is changed. No money moves.
-- Never returned: the street address (booking_private), the completion code, the customer's or worker's phone, booking notes, bank details.
-- Booking status values are the real ones the owner reported on 2026-11-09: pending, confirmed, completed, cancelled. Any other value is
-- shown exactly as stored and counted under "Other".
-- Guesses (docs/admin-control-centre/handoffs/A12a.md): the job_events, local_booking_events, _milestones, _exceptions, _quotes and
-- escrow_payments link to the booking is read by key name (booking_id) through to_jsonb, so a wrong column name gives an empty section,
-- never an error; a task's owner is read from user_id, customer_id or posted_by, whichever the row has.

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
end
$pre$;

-- 0. Helper: keep only the named keys of a row (a column never looked at can never leak). No browser access.
create or replace function public._a12a_pick(p_row jsonb, p_keys text[])
returns jsonb language sql immutable set search_path = public, pg_temp as $f$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(coalesce(p_row, '{}'::jsonb)) e where e.key = any (p_keys)
$f$;
revoke all on function public._a12a_pick(jsonb, text[]) from public, anon, authenticated;

-- 1. Booking list ----------------------------------------------------------------------------------------------------
-- p_kind: 'regular' (no Local booking state) or 'local' (has a local_booking_state row).
create or replace function public.admin_booking_list(p_kind text default 'regular', p_search text default null,
                                                     p_filter text default 'all', p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  v_kind text := coalesce(p_kind, 'regular');
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_filter text := coalesce(p_filter, 'all');
  v_total integer; v_items jsonb; v_counts jsonb;
begin
  if not public.admin_has('bookings.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if v_kind not in ('regular', 'local') then
    return jsonb_build_object('ok', false, 'error', 'Unknown list.');
  end if;
  if v_kind = 'regular' and v_filter not in ('all', 'pending', 'confirmed', 'completed', 'cancelled', 'other', 'locked', 'disputed') then
    return jsonb_build_object('ok', false, 'error', 'Unknown filter.');
  end if;
  if v_kind = 'local' and v_filter not in ('all', 'needs_reassignment', 'assigned', 'awaiting_tasker_confirmation', 'tasker_confirmed',
                                           'tasker_declined', 'quote_sent', 'quote_approved', 'quote_declined') then
    return jsonb_build_object('ok', false, 'error', 'Unknown filter.');
  end if;
  begin
    with base as (
      select b.id, b.status, b.payment_status, b.work_stage, b.amount, b.created_at, b.completed_at, b.scheduled_time,
             b.customer_id::text as customer_id, b.tasker_id::text as tasker_id,
             coalesce(nullif(to_jsonb(b) ->> 'code_attempts', '')::integer, 0) as code_attempts,
             nullif(btrim(coalesce(to_jsonb(b) ->> 'dispute_reason', '')), '') as dispute_reason,
             s.lt_status, s.coordinator_id, s.tasker_user_id as local_worker_id,
             (s.booking_id is not null) as is_local,
             (select u.name from public.users u where u.id::text = b.customer_id::text) as customer_name,
             (select u.name from public.users u where u.id::text = b.tasker_id::text) as tasker_name,
             (select lp.full_name from public.local_tasker_profiles lp where lp.tasker_user_id = s.tasker_user_id) as worker_name,
             (select coalesce(nullif(c.display_name, ''), (select u.name from public.users u where u.id = c.user_id))
                from public.coordinators c where c.user_id = s.coordinator_id) as coordinator_name
        from public.bookings b
        left join lateral (select x.* from public.local_booking_state x where x.booking_id = b.id limit 1) s on true
    ), mine as (
      select * from base where is_local = (v_kind = 'local')
    ), filt as (
      select m.* from mine m
       where (v_q is null
              or m.id::text = v_q
              or position(lower(v_q) in lower(coalesce(m.customer_name, ''))) > 0
              or position(lower(v_q) in lower(coalesce(m.tasker_name, ''))) > 0
              or position(lower(v_q) in lower(coalesce(m.worker_name, ''))) > 0)
         and case
               when v_filter = 'all' then true
               when v_kind = 'local' then m.lt_status = v_filter
               when v_filter = 'other' then coalesce(m.status, '') not in ('pending', 'confirmed', 'completed', 'cancelled')
               when v_filter = 'locked' then m.code_attempts >= 3 and coalesce(m.status, '') not in ('completed', 'cancelled')
               when v_filter = 'disputed' then m.dispute_reason is not null
               else m.status = v_filter end
    ), pg as (
      select * from filt order by created_at desc nulls last, id limit 50 offset v_off
    )
    select (select count(*) from filt),
           (select coalesce(jsonb_agg(jsonb_build_object(
                'id', pg.id, 'status', pg.status, 'payment_status', pg.payment_status, 'work_stage', pg.work_stage,
                'amount', pg.amount, 'created_at', pg.created_at, 'completed_at', pg.completed_at, 'scheduled_time', pg.scheduled_time,
                'customer_name', pg.customer_name, 'tasker_name', coalesce(pg.worker_name, pg.tasker_name),
                'locked', (pg.code_attempts >= 3 and coalesce(pg.status, '') not in ('completed', 'cancelled')),
                'disputed', (pg.dispute_reason is not null),
                'lt_status', pg.lt_status, 'coordinator_id', pg.coordinator_id, 'coordinator_name', pg.coordinator_name)
                order by pg.created_at desc nulls last, pg.id), '[]'::jsonb) from pg),
           case when v_kind = 'regular' then jsonb_build_object(
             'all', (select count(*) from mine),
             'pending', (select count(*) from mine where status = 'pending'),
             'confirmed', (select count(*) from mine where status = 'confirmed'),
             'completed', (select count(*) from mine where status = 'completed'),
             'cancelled', (select count(*) from mine where status = 'cancelled'),
             'other', (select count(*) from mine where coalesce(status, '') not in ('pending', 'confirmed', 'completed', 'cancelled')),
             'locked', (select count(*) from mine where code_attempts >= 3 and coalesce(status, '') not in ('completed', 'cancelled')),
             'disputed', (select count(*) from mine where dispute_reason is not null))
           else jsonb_build_object(
             'all', (select count(*) from mine),
             'needs_reassignment', (select count(*) from mine where lt_status = 'needs_reassignment'),
             'assigned', (select count(*) from mine where lt_status = 'assigned'),
             'awaiting_tasker_confirmation', (select count(*) from mine where lt_status = 'awaiting_tasker_confirmation'),
             'tasker_confirmed', (select count(*) from mine where lt_status = 'tasker_confirmed'),
             'tasker_declined', (select count(*) from mine where lt_status = 'tasker_declined'),
             'quote_sent', (select count(*) from mine where lt_status = 'quote_sent'),
             'quote_approved', (select count(*) from mine where lt_status = 'quote_approved'),
             'quote_declined', (select count(*) from mine where lt_status = 'quote_declined')) end
      into v_total, v_items, v_counts;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'The list could not be read (' || sqlstate || ').');
  end;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'total', v_total, 'offset', v_off, 'page_size', 50, 'items', v_items, 'counts', v_counts);
end $f$;

-- 2. Booking detail --------------------------------------------------------------------------------------------------
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
  exception when others then v_failed := v_failed || 'booking'; v_booking := null;
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
  exception when others then v_failed := v_failed || 'local'; v_local := null;
  end;

  if v_local is not null then
    begin
      select public._a12a_pick(to_jsonb(q), array['version', 'service_fee', 'transport_amount', 'materials_amount', 'created_at'])
        into v_quote from public.local_booking_quotes q where q.booking_id = p_booking and q.superseded_at is null order by q.version desc limit 1;
    exception when others then v_failed := v_failed || 'quote'; v_quote := null;
    end;
    begin
      select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(m), array['kind', 'created_at']) order by to_jsonb(m) ->> 'created_at'), '[]'::jsonb)
        into v_miles from public.local_booking_milestones m where to_jsonb(m) ->> 'booking_id' = p_booking::text;
    exception when others then v_failed := v_failed || 'milestones'; v_miles := null;
    end;
    begin
      select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(x), array['kind', 'created_at', 'resolved_at']) order by to_jsonb(x) ->> 'created_at'), '[]'::jsonb)
        into v_exc from public.local_booking_exceptions x where to_jsonb(x) ->> 'booking_id' = p_booking::text;
    exception when others then v_failed := v_failed || 'exceptions'; v_exc := null;
    end;
    begin
      select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(e), array['id', 'kind', 'event', 'event_type', 'created_at']) order by to_jsonb(e) ->> 'created_at', to_jsonb(e) ->> 'id'), '[]'::jsonb)
        into v_levents from (select * from public.local_booking_events le where to_jsonb(le) ->> 'booking_id' = p_booking::text limit 200) e;
    exception when others then v_failed := v_failed || 'local_events'; v_levents := null;
    end;
  end if;

  -- general timeline (job_events); key names only, no free text
  begin
    select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(e), array['id', 'kind', 'event', 'event_type', 'type', 'created_at']) order by to_jsonb(e) ->> 'created_at', to_jsonb(e) ->> 'id'), '[]'::jsonb)
      into v_events from (select * from public.job_events je where to_jsonb(je) ->> 'booking_id' = p_booking::text limit 200) e;
  exception when others then v_failed := v_failed || 'timeline'; v_events := null;
  end;

  -- payment held for the booking: read only; admin never moves, releases or refunds from here
  begin
    select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(p), array['status', 'amount', 'platform_fee', 'tasker_amount', 'created_at', 'released_at'])
                              order by to_jsonb(p) ->> 'created_at'), '[]'::jsonb)
      into v_escrow from public.escrow_payments p where to_jsonb(p) ->> 'booking_id' = p_booking::text;
  exception when others then v_failed := v_failed || 'payment'; v_escrow := null;
  end;

  -- disputes linked to this booking (by a booking_id key, or through the booking's chat thread)
  begin
    select coalesce(jsonb_agg(public._a12a_pick(to_jsonb(d), array['id', 'status', 'category', 'opened_by_role', 'opened_at', 'resolved_at'])
                              order by to_jsonb(d) ->> 'opened_at'), '[]'::jsonb)
      into v_disp from public.job_disputes d
     where to_jsonb(d) ->> 'booking_id' = p_booking::text
        or exists (select 1 from public.message_threads t where t.id = d.thread_id and to_jsonb(t) ->> 'booking_id' = p_booking::text);
  exception when others then v_failed := v_failed || 'disputes'; v_disp := null;
  end;

  return jsonb_build_object('ok', true, 'booking', v_booking, 'local', v_local, 'quote', v_quote, 'milestones', v_miles, 'exceptions', v_exc,
    'local_events', v_levents, 'timeline', v_events, 'payment', v_escrow, 'disputes', v_disp, 'sections_failed', to_jsonb(v_failed));
end $f$;

-- 3. Task list -------------------------------------------------------------------------------------------------------
create or replace function public.admin_task_list(p_search text default null, p_filter text default 'all', p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_filter text := coalesce(p_filter, 'all');
  v_total integer; v_items jsonb; v_counts jsonb;
begin
  if not public.admin_has('bookings.view') then
    return jsonb_build_object('ok', false, 'error', 'You do not have permission to do this.');
  end if;
  if v_filter not in ('all', 'open', 'in_progress', 'completed', 'cancelled', 'draft', 'other') then
    return jsonb_build_object('ok', false, 'error', 'Unknown filter.');
  end if;
  begin
    with base as (
      select t.id, t.title, t.status, t.budget, t.location, t.created_at,
             coalesce(to_jsonb(t) ->> 'user_id', to_jsonb(t) ->> 'customer_id', to_jsonb(t) ->> 'posted_by') as owner_id,
             (select u.name from public.users u
               where u.id::text = coalesce(to_jsonb(t) ->> 'user_id', to_jsonb(t) ->> 'customer_id', to_jsonb(t) ->> 'posted_by')) as owner_name
        from public.tasks t
    ), filt as (
      select b.* from base b
       where (v_q is null or b.id::text = v_q
              or position(lower(v_q) in lower(coalesce(b.title, ''))) > 0
              or position(lower(v_q) in lower(coalesce(b.owner_name, ''))) > 0)
         and case when v_filter = 'all' then true
                  when v_filter = 'other' then coalesce(b.status, '') not in ('open', 'in_progress', 'completed', 'cancelled', 'draft')
                  else b.status = v_filter end
    ), pg as (
      select * from filt order by created_at desc nulls last, id limit 50 offset v_off
    )
    select (select count(*) from filt),
           (select coalesce(jsonb_agg(jsonb_build_object('id', pg.id, 'title', pg.title, 'status', pg.status, 'budget', pg.budget,
                'location', pg.location, 'created_at', pg.created_at, 'owner_name', pg.owner_name)
                order by pg.created_at desc nulls last, pg.id), '[]'::jsonb) from pg),
           jsonb_build_object(
             'all', (select count(*) from base),
             'open', (select count(*) from base where status = 'open'),
             'in_progress', (select count(*) from base where status = 'in_progress'),
             'completed', (select count(*) from base where status = 'completed'),
             'cancelled', (select count(*) from base where status = 'cancelled'),
             'draft', (select count(*) from base where status = 'draft'),
             'other', (select count(*) from base where coalesce(status, '') not in ('open', 'in_progress', 'completed', 'cancelled', 'draft')))
      into v_total, v_items, v_counts;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'The list could not be read (' || sqlstate || ').');
  end;
  return jsonb_build_object('ok', true, 'total', v_total, 'offset', v_off, 'page_size', 50, 'items', v_items, 'counts', v_counts);
end $f$;

-- 4. Grants: the browser may call these three functions and nothing else; each checks the admin permission itself
do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname in ('admin_booking_list', 'admin_booking_detail', 'admin_task_list')) loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$g$;

-- Result line
select case
  when to_regprocedure('public.admin_booking_list(text,text,text,integer)') is not null
   and to_regprocedure('public.admin_booking_detail(uuid)') is not null
   and to_regprocedure('public.admin_task_list(text,text,integer)') is not null
  then 'DONE: A12a installed. Admins with bookings.view can use /admin/bookings.html.'
  else 'NOT DONE: see the messages above.'
end as a12a_result;

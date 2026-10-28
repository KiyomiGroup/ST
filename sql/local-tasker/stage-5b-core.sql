-- Stage 5B: coordinator booking list and booking detail (READ-ONLY functions).
-- Additive and re-runnable. Rollback: stage-5b-rollback.sql. Needs stage-5a1-core.sql and stage-5a2-core.sql to have been run first.
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- Two browser-callable functions, both read-only, both for the ACTIVE coordinator who currently manages the booking:
--   local_booking_list(p_limit)    one row per booking the coordinator manages (newest first)
--   local_booking_detail(p_booking) everything the coordinator is entitled to see on one booking
-- Contact rule (decision O5, default): the coordinator sees the customer's name for every booking they manage, and the
-- customer's phone only while the booking is still OPEN. Nothing about other coordinators' bookings.
-- NEVER returned: completion_code / release code, booking_secrets, code_attempts, payment_ref, dispute_reason,
-- customer_id, tasker_id, escrow or wallet data. Nothing here writes anything.
-- Job details (tasks / services) and the customer phone (verifications) are read inside guarded blocks: if one of those
-- tables or columns is not shaped as assumed, that one detail comes back null instead of the whole function failing.

create or replace function public.local_booking_list(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_out jsonb;
begin
  if v_me is null or not public.is_active_coordinator(v_me) then
    raise exception 'Not available.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select coalesce(jsonb_agg(x.row order by x.created_at desc, x.id), '[]'::jsonb) into v_out
  from (
    select b.id, b.created_at, jsonb_build_object(
      'booking_id', b.id,
      'tasker_user_id', s.tasker_user_id,
      'tasker_name', p.full_name,
      'customer_name', u.name,
      'title', coalesce(
         nullif(btrim(coalesce((select to_jsonb(t) ->> 'title' from public.tasks t where t.id = b.task_id), '')), ''),
         nullif(btrim(coalesce((select to_jsonb(sv) ->> 'service_name' from public.services sv where sv.id = b.service_id), '')), ''),
         nullif(left(btrim(coalesce(b.notes, '')), 60), ''), 'Booking'),
      'lt_status', s.lt_status,
      'booking_status', b.status,
      'work_stage', b.work_stage,
      'payment_status', b.payment_status,
      'amount', b.amount,
      'scheduled_time', b.scheduled_time,
      'created_at', b.created_at,
      'updated_at', s.updated_at,
      'frozen', public.job_booking_frozen(b.id),
      'open', public._local_booking_is_open(b.status) and b.status <> 'disputed'
    ) as row
    from public.local_booking_state s
    join public.bookings b on b.id = s.booking_id
    left join public.local_tasker_profiles p on p.tasker_user_id = s.tasker_user_id
    left join public.users u on u.id = b.customer_id
    where s.coordinator_id = v_me
    order by b.created_at desc, b.id
    limit v_lim
  ) x;
  return v_out;
end $$;
revoke all on function public.local_booking_list(integer) from public, anon;
grant execute on function public.local_booking_list(integer) to authenticated, service_role;

create or replace function public.local_booking_detail(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; v_open boolean;
  v_task jsonb := null; v_svc jsonb := null; v_cust_name text := null; v_phone text := null; v_tasker_name text := null; v_events jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  v_open := public._local_booking_is_open(b.status) and b.status <> 'disputed';

  select p.full_name into v_tasker_name from public.local_tasker_profiles p where p.tasker_user_id = s.tasker_user_id;
  select u.name into v_cust_name from public.users u where u.id = b.customer_id;

  begin
    select jsonb_build_object('title', to_jsonb(t) ->> 'title', 'description', to_jsonb(t) ->> 'description',
                              'location', to_jsonb(t) ->> 'location', 'category', to_jsonb(t) ->> 'category', 'budget', to_jsonb(t) ->> 'budget')
      into v_task from public.tasks t where t.id = b.task_id;
  exception when others then v_task := null; end;
  begin
    select jsonb_build_object('service_name', to_jsonb(sv) ->> 'service_name', 'category', to_jsonb(sv) ->> 'category',
                              'price', to_jsonb(sv) ->> 'price', 'rate_unit', to_jsonb(sv) ->> 'rate_unit', 'location', to_jsonb(sv) ->> 'location')
      into v_svc from public.services sv where sv.id = b.service_id;
  exception when others then v_svc := null; end;
  if v_open then
    begin
      execute 'select v.phone::text from public.verifications v where v.user_id = $1 limit 1' into v_phone using b.customer_id;
    exception when others then v_phone := null; end;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
                                               'actor_role', e.actor_role, 'note', e.note, 'created_at', e.created_at)
                           order by e.created_at desc, e.id), '[]'::jsonb)
    into v_events
    from (select * from public.local_booking_events where booking_id = p_booking order by created_at desc, id limit 50) e;

  return jsonb_build_object(
    'booking_id', b.id, 'lt_status', s.lt_status, 'booking_status', b.status, 'work_stage', b.work_stage,
    'payment_status', b.payment_status, 'amount', b.amount, 'scheduled_time', b.scheduled_time,
    'created_at', b.created_at, 'notes', b.notes,
    'tasker_user_id', s.tasker_user_id, 'tasker_name', v_tasker_name,
    'customer_name', v_cust_name, 'customer_phone', v_phone,
    'task', v_task, 'service', v_svc,
    'original_coordinator_is_me', s.original_coordinator_id is not distinct from v_me,
    'frozen', public.job_booking_frozen(b.id), 'open', v_open,
    'allowed_next', to_jsonb(public._local_booking_allowed_next(s.lt_status, 'coordinator')),
    'events', v_events);
end $$;
revoke all on function public.local_booking_detail(uuid) from public, anon;
grant execute on function public.local_booking_detail(uuid) to authenticated, service_role;

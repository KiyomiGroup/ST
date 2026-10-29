-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6A core (the booking-specific coordinator thread: SQL and customer side)
-- Additive and re-runnable. Rollback: stage-6a-rollback.sql. Needs stage-5a (local_booking_state / events) and stage-5d1-core.sql
-- (_local_booking_thread) first. Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- THE DESIGN (decision D7: no second chat system, existing helpers untouched)
--   A Local Tasker booking already has ONE Job Room thread: customer + the Local Tasker's placeholder identity, context_type 'booking',
--   context_id = the booking (stage 5D-1, _local_booking_thread). The Local Tasker cannot log in, so the COORDINATOR speaks for them.
--   This stage does NOT change open_thread, is_thread_party, _is_thread_member, job_money_snapshot or any existing policy. It adds:
--     1. local_thread_access(thread)      who the caller is on a Local Tasker booking thread: 'coordinator' (current, active),
--                                         'former_coordinator' (managed the booking before; READ ONLY) or null.
--     2. two additive SELECT policies     message_threads and messages: the current coordinator reads (all history), a former coordinator
--                                         reads the history, nobody else gains anything. No INSERT/UPDATE/DELETE policy is added:
--                                         a coordinator cannot write a message from the browser in this stage (sending is Stage 6B,
--                                         through a function). History is never deleted by anything here.
--     3. open_local_thread(booking)       the customer or the current coordinator opens (or creates) the booking's thread. A former
--                                         coordinator can only get the EXISTING thread, read only. Never loosens open_thread.
--     4. local_thread_labels(threads)     customer side: for the customer's own Local Tasker threads, who the contact is (the coordinator's
--                                         display name). Never returns an id.
--     5. local_thread_admin_read(...)     the ONLY admin way into a conversation: needs a written reason, writes the audit row FIRST,
--                                         returns at most 200 messages. No admin table policy is added.
-- NEVER touches: bookings, lt_status, money tables, payment_requests, escrow, wallets, any existing function or policy.
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.message_threads') is null or to_regclass('public.messages') is null
     or to_regclass('public.local_booking_state') is null or to_regclass('public.local_booking_events') is null
     or to_regclass('public.bookings') is null or to_regclass('public.coordinators') is null then
    raise exception 'A required table is missing (message_threads, messages, local_booking_state, local_booking_events, bookings, coordinators). Nothing was changed.';
  end if;
  if to_regprocedure('public.is_active_coordinator(uuid)') is null
     or to_regprocedure('public.is_local_tasker_admin()') is null
     or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null
     or to_regprocedure('public._local_booking_thread(uuid,uuid,uuid)') is null
     or to_regprocedure('public._local_booking_log(uuid,text,text,text,uuid,uuid,uuid,text,text)') is null then
    raise exception 'Run stage-5d1-core.sql (and the stages before it) first: a helper function is missing. Nothing was changed.';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.message_threads'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.messages'::regclass) then
    raise exception 'Row level security is OFF on message_threads or messages. Stop: tell the project owner before going on. Nothing was changed.';
  end if;
end $$;

-- 1. The booking behind a thread (only for a Local Tasker booking) ---------------------------------------------
create or replace function public._local_thread_booking(p_thread uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.booking_id
    from public.message_threads t
    join public.local_booking_state s on s.booking_id::text = t.context_id::text
   where t.id = p_thread and t.context_type = 'booking'
$$;

-- 2. Who is the caller on this thread? ---------------------------------------------------------------------------
-- 'coordinator'        the ACTIVE coordinator who manages the booking now.
-- 'former_coordinator' an ACTIVE coordinator who managed it before (original or earlier assignment) and no longer does. Read only.
-- null                 anyone else (the customer's own access is the existing policy, not this function).
-- Used inside the two policies below, so it is SECURITY DEFINER and reads only auth.uid().
create or replace function public.local_thread_access(p_thread uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_booking uuid; s public.local_booking_state;
begin
  if v_me is null or p_thread is null then return null; end if;
  v_booking := public._local_thread_booking(p_thread);
  if v_booking is null then return null; end if;
  if not public.is_active_coordinator(v_me) then return null; end if;
  select * into s from public.local_booking_state where booking_id = v_booking;
  if not found then return null; end if;
  if s.coordinator_id is not distinct from v_me then return 'coordinator'; end if;
  if s.original_coordinator_id is not distinct from v_me
     or exists (select 1 from public.local_booking_events e
                 where e.booking_id = v_booking and (e.coordinator_id = v_me or e.previous_coordinator_id = v_me)) then
    return 'former_coordinator';
  end if;
  return null;
end $$;
revoke all on function public._local_thread_booking(uuid) from public, anon, authenticated;
grant execute on function public._local_thread_booking(uuid) to service_role;
revoke all on function public.local_thread_access(uuid) from public, anon;
grant execute on function public.local_thread_access(uuid) to authenticated, service_role;

-- 3. Additive read policies (permissive: they only ADD rows to what the existing policies already allow) -----------
drop policy if exists lt_thread_coord_select on public.message_threads;
create policy lt_thread_coord_select on public.message_threads for select to authenticated
  using (public.local_thread_access(id) is not null);
drop policy if exists lt_msg_coord_select on public.messages;
create policy lt_msg_coord_select on public.messages for select to authenticated
  using (public.local_thread_access(thread_id) is not null);

-- 4. Open (or create) the thread of a Local Tasker booking ---------------------------------------------------------
-- Callable by: the booking's customer, the current active coordinator (both may create it), a former coordinator (existing thread only).
-- Everyone else, and a booking that is not a Local Tasker booking, gets the same answer: not_found.
create or replace function public.open_local_thread(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; v_role text; v_thread uuid; v_created boolean := false;
begin
  if v_me is null or p_booking is null then
    raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  if b.customer_id = v_me then
    v_role := 'customer';
  elsif public.is_active_coordinator(v_me) and s.coordinator_id is not distinct from v_me then
    v_role := 'coordinator';
  elsif public.is_active_coordinator(v_me)
        and (s.original_coordinator_id is not distinct from v_me
             or exists (select 1 from public.local_booking_events e where e.booking_id = p_booking and (e.coordinator_id = v_me or e.previous_coordinator_id = v_me))) then
    v_role := 'former_coordinator';
  else
    raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found';
  end if;

  select t.id into v_thread from public.message_threads t
   where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = b.customer_id and t.tasker_id = s.tasker_user_id
   order by t.last_message_at desc nulls last limit 1;

  if v_thread is null then
    if v_role = 'former_coordinator' then
      raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found';
    end if;
    begin
      v_thread := public._local_booking_thread(p_booking, b.customer_id, s.tasker_user_id);
      v_created := true;
    exception when unique_violation then
      -- two people opened it at the same moment: use the one that won
      select t.id into v_thread from public.message_threads t
       where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = b.customer_id and t.tasker_id = s.tasker_user_id
       order by t.last_message_at desc nulls last limit 1;
    end;
    if v_thread is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
    if v_created then
      perform public._local_booking_log(p_booking, 'thread_opened', null, null, s.coordinator_id, null, v_me, v_role, null);
    end if;
  end if;

  return jsonb_build_object('thread_id', v_thread, 'role', v_role, 'read_only', v_role = 'former_coordinator', 'created', v_created);
end $$;
revoke all on function public.open_local_thread(uuid) from public, anon;
grant execute on function public.open_local_thread(uuid) to authenticated, service_role;

-- 5. Customer side: who is my contact on this thread? ---------------------------------------------------------------
-- For each of the CALLER'S OWN threads that belong to a Local Tasker booking: the coordinator's display name (or null while the booking
-- waits for a new coordinator). Other threads are simply absent from the answer. No ids are returned. At most 100 threads.
create or replace function public.local_thread_labels(p_threads uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_out jsonb;
begin
  if v_me is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'thread_id', t.id,
           'coordinator_assigned', s.coordinator_id is not null and c.status = 'active',
           'coordinator_name', case when c.status = 'active' then nullif(btrim(coalesce(to_jsonb(c) ->> 'display_name', '')), '') end
         )), '[]'::jsonb)
    into v_out
    from (select distinct x as id from unnest(coalesce(p_threads, '{}'::uuid[])) as x limit 100) q
    join public.message_threads t on t.id = q.id and t.customer_id = v_me and t.context_type = 'booking'
    join public.local_booking_state s on s.booking_id::text = t.context_id::text
    left join public.coordinators c on c.user_id = s.coordinator_id;
  return v_out;
end $$;
revoke all on function public.local_thread_labels(uuid[]) from public, anon;
grant execute on function public.local_thread_labels(uuid[]) to authenticated, service_role;

-- 6. Admin: the only way in, audited -----------------------------------------------------------------------------------
-- A written reason (10 to 300 characters) is required and the audit row is written BEFORE anything is returned (if the audit insert
-- fails, nothing is returned). Returns the newest p_limit messages (1 to 200), no attachments' paths, only id, sender, type, body, time.
create or replace function public.local_thread_admin_read(p_thread uuid, p_reason text, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); v_booking uuid; v_reason text := btrim(coalesce(p_reason, '')); v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_msgs jsonb; v_n integer;
begin
  if v_me is null or not public.is_local_tasker_admin() then
    raise exception 'Not available.' using errcode = 'P0001', hint = 'not_found';
  end if;
  v_booking := public._local_thread_booking(p_thread);
  if v_booking is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 300 then
    raise exception 'Write the reason for reading this conversation (10 to 300 characters).' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select count(*) into v_n from public.messages where thread_id = p_thread;
  perform public.local_tasker_audit('thread_admin_read', 'message_thread', p_thread::text, null,
            jsonb_build_object('booking_id', v_booking, 'reason', v_reason, 'limit', v_lim, 'messages_in_thread', v_n), v_me);
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'type', m.type, 'body', m.body, 'created_at', m.created_at)
                            order by m.created_at desc, m.id), '[]'::jsonb)
    into v_msgs
    from (select * from public.messages where thread_id = p_thread order by created_at desc, id limit v_lim) m;
  return jsonb_build_object('thread_id', p_thread, 'booking_id', v_booking, 'total', v_n, 'messages', v_msgs);
end $$;
revoke all on function public.local_thread_admin_read(uuid, text, integer) from public, anon;
grant execute on function public.local_thread_admin_read(uuid, text, integer) to authenticated, service_role;

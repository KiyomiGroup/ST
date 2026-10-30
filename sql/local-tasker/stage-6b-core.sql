-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6B core (coordinator chat and internal notes)
-- Additive and re-runnable. Rollback: stage-6b-rollback.sql. Needs stage-5d1-core.sql and stage-6a-core.sql first.
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- THE DESIGN (decisions D7 and D108 to D113 of Stage 6A stay: ONE chat system, the existing Job Room thread, existing helpers untouched)
--   1. coordinator_internal_notes   NEW table, one row per internal note. NOT the messages table. RLS on. Only the coordinators of that
--                                   booking (current: read and write through a function; former: read only) can read it. The customer, the
--                                   placeholder Local Tasker identity, other coordinators and administrators (directly) read nothing.
--                                   Immutable: a note is never edited or deleted.
--   2. coordinator_message_authors  NEW table: which coordinator wrote each message that was sent for the Local Tasker (the message row
--                                   itself carries the Local Tasker's identity as sender). Also makes a retried send harmless.
--   3. coordinator_thread_reads     NEW table: when each coordinator last read each thread (so "unread" is per coordinator). No browser access.
--   4. coordinator_chat_list        the coordinator's inbox: their bookings (current and read-only former) with the thread preview and unread count.
--   5. coordinator_chat_thread      one booking's conversation: the customer-visible messages AND the internal notes, kept apart in the answer.
--   6. coordinator_send_message     the ONLY way a coordinator speaks to the customer. Sends as the Local Tasker's identity (a real
--                                   public.users row, so no foreign key problem), records the coordinator as the author, refuses contact
--                                   details, refuses a former coordinator.
--   7. coordinator_add_note         the ONLY way to write an internal note (current coordinator only).
--   8. coordinator_chat_mark_read   marks the thread read for the calling coordinator.
--   9. coordinator_chat_admin_read  the ONLY admin way into messages (with authors) and notes: reason required, audit row written FIRST.
-- NEVER touches: bookings, lt_status, money tables, payment_requests, escrow, wallets, message_threads policies, any existing function.
-- The existing 6A policies (lt_thread_coord_select, lt_msg_coord_select) are kept as they are.
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.message_threads') is null or to_regclass('public.messages') is null
     or to_regclass('public.local_booking_state') is null or to_regclass('public.local_booking_events') is null
     or to_regclass('public.bookings') is null or to_regclass('public.coordinators') is null or to_regclass('public.users') is null then
    raise exception 'A required table is missing (message_threads, messages, local_booking_state, local_booking_events, bookings, coordinators, users). Nothing was changed.';
  end if;
  if to_regprocedure('public.is_active_coordinator(uuid)') is null
     or to_regprocedure('public.is_local_tasker_admin()') is null
     or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null
     or to_regprocedure('public._local_booking_is_open(text)') is null
     or to_regprocedure('public.job_booking_frozen(uuid)') is null then
    raise exception 'A helper function is missing (run the stages before this one). Nothing was changed.';
  end if;
  if to_regprocedure('public.local_thread_access(uuid)') is null or to_regprocedure('public.open_local_thread(uuid)') is null then
    raise exception 'Run stage-6a-core.sql first (local_thread_access / open_local_thread are missing). Nothing was changed.';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.messages'::regclass) then
    raise exception 'Row level security is OFF on messages. Stop: tell the project owner before going on. Nothing was changed.';
  end if;
end $$;

-- 1. Who is the caller on this booking's conversation? (by BOOKING, so notes work before any thread exists) -----------
-- 'coordinator'        the ACTIVE coordinator who manages the booking now.
-- 'former_coordinator' an ACTIVE coordinator who managed it before. READ ONLY.
-- null                 anyone else.
create or replace function public.local_chat_access(p_booking uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state;
begin
  if v_me is null or p_booking is null then return null; end if;
  if not public.is_active_coordinator(v_me) then return null; end if;
  select * into s from public.local_booking_state where booking_id = p_booking;
  if not found then return null; end if;
  if s.coordinator_id is not distinct from v_me then return 'coordinator'; end if;
  if s.original_coordinator_id is not distinct from v_me
     or exists (select 1 from public.local_booking_events e
                 where e.booking_id = p_booking and (e.coordinator_id = v_me or e.previous_coordinator_id = v_me)) then
    return 'former_coordinator';
  end if;
  return null;
end $$;
revoke all on function public.local_chat_access(uuid) from public, anon;
grant execute on function public.local_chat_access(uuid) to authenticated, service_role;

-- 2. Contact details are not allowed in a message to the customer (same rule as the Job Room; internal notes are exempt) ----
create or replace function public._lt_contains_contact(p_text text) returns boolean
language sql immutable as $$
  select coalesce(
       p_text ~* '(^|[^0-9])(\+?234|0)[789][0-9]{9}([^0-9]|$)'
    or p_text ~  '(^|[^0-9])[0-9]{4}[ -]?[0-9]{3}[ -]?[0-9]{4}([^0-9]|$)'
    or p_text ~* '(whatsapp\.com/|wa\.me/|telegram\.me/|t\.me/|instagram\.com/)'
    or p_text ~* '\yyou\s*can\s*(call|reach|find|contact)\s*me\y'
    or p_text ~* '\ymy\s*(number|contact|phone|whatsapp)\s*(is|:)'
    or p_text ~* '\ytext\s*me\s*(on|at|via)\y'
    or p_text ~* '\ymeet\s*(me\s*)?(outside|off\s*platform|off-platform)\y'
    or p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', false)
$$;
revoke all on function public._lt_contains_contact(text) from public, anon, authenticated;
grant execute on function public._lt_contains_contact(text) to service_role;

-- 3. Tables ----------------------------------------------------------------------------------------------------------
create table if not exists public.coordinator_internal_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  author_id uuid not null,                       -- the coordinator's user id (auth.uid() at the time)
  request_id uuid not null unique,               -- makes a retried tap harmless
  body text not null,
  created_at timestamptz not null default now(),
  constraint cin_body_check check (char_length(btrim(body)) between 1 and 2000)
);
create index if not exists cin_booking_idx on public.coordinator_internal_notes (booking_id, created_at);

create table if not exists public.coordinator_message_authors (
  message_id text primary key,                   -- messages.id as text (the real column type is not assumed)
  booking_id uuid not null references public.bookings(id) on delete cascade,
  coordinator_id uuid not null,
  request_id uuid not null unique,               -- makes a retried send harmless
  created_at timestamptz not null default now()
);
create index if not exists cma_booking_idx on public.coordinator_message_authors (booking_id);

create table if not exists public.coordinator_thread_reads (
  coordinator_id uuid not null,
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (coordinator_id, thread_id)
);

alter table public.coordinator_internal_notes enable row level security;
alter table public.coordinator_message_authors enable row level security;
alter table public.coordinator_thread_reads enable row level security;

-- Read policies: only coordinators of THIS booking (current or former). No insert/update/delete policy for anyone.
-- There is deliberately NO administrator policy: administrators go through coordinator_chat_admin_read (audited, reason required).
drop policy if exists lt_notes_coord_select on public.coordinator_internal_notes;
create policy lt_notes_coord_select on public.coordinator_internal_notes for select to authenticated
  using (public.local_chat_access(booking_id) is not null);
drop policy if exists lt_authors_coord_select on public.coordinator_message_authors;
create policy lt_authors_coord_select on public.coordinator_message_authors for select to authenticated
  using (public.local_chat_access(booking_id) is not null);

revoke all on public.coordinator_internal_notes, public.coordinator_message_authors, public.coordinator_thread_reads from public, anon, authenticated;
grant select on public.coordinator_internal_notes, public.coordinator_message_authors to authenticated;       -- RLS decides which rows
grant select, insert, update, delete on public.coordinator_internal_notes, public.coordinator_message_authors, public.coordinator_thread_reads to service_role;

-- Notes and authorship are history: never edited, never deleted (only the booking itself being removed cascades them).
create or replace function public._lt_6b_immutable() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 then return OLD; end if;     -- only the booking cascade
    raise exception 'This record is history and cannot be deleted.' using errcode = 'P0001', hint = 'immutable';
  end if;
  raise exception 'This record is history and cannot be edited.' using errcode = 'P0001', hint = 'immutable';
end $$;
drop trigger if exists cin_immutable on public.coordinator_internal_notes;
create trigger cin_immutable before update or delete on public.coordinator_internal_notes for each row execute function public._lt_6b_immutable();
drop trigger if exists cma_immutable on public.coordinator_message_authors;
create trigger cma_immutable before update or delete on public.coordinator_message_authors for each row execute function public._lt_6b_immutable();

-- 4. The inbox ------------------------------------------------------------------------------------------------------
-- One row per booking the caller coordinates now ('coordinator') or coordinated before ('former_coordinator', read only), newest activity
-- first. thread_id is null while the customer and coordinator have not written yet. unread = customer messages after the caller's last read
-- (capped at 99; only for the current coordinator). The preview is the thread's last message: internal notes never reach it.
create or replace function public.coordinator_chat_list(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_out jsonb;
begin
  if v_me is null or not public.is_active_coordinator(v_me) then
    raise exception 'Not available.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select coalesce(jsonb_agg(x.row order by x.sort_at desc nulls last, x.id), '[]'::jsonb) into v_out
  from (
    select b.id, coalesce(th.last_message_at, b.created_at) as sort_at, jsonb_build_object(
      'booking_id', b.id,
      'access', case when s.coordinator_id is not distinct from v_me then 'coordinator' else 'former_coordinator' end,
      'customer_name', u.name,
      'tasker_name', p.full_name,
      'title', coalesce(
         nullif(btrim(coalesce((select to_jsonb(t) ->> 'title' from public.tasks t where t.id = b.task_id), '')), ''),
         nullif(btrim(coalesce((select to_jsonb(sv) ->> 'service_name' from public.services sv where sv.id = b.service_id), '')), ''),
         nullif(left(btrim(coalesce(b.notes, '')), 60), ''), 'Booking'),
      'lt_status', s.lt_status,
      'booking_status', b.status,
      'payment_status', b.payment_status,
      'amount', b.amount,
      'scheduled_time', b.scheduled_time,
      'created_at', b.created_at,
      'frozen', public.job_booking_frozen(b.id),
      'open', public._local_booking_is_open(b.status) and b.status <> 'disputed',
      'thread_id', th.id,
      'last_message', th.last_message,
      'last_message_at', th.last_message_at,
      'unread', case when th.id is not null and s.coordinator_id is not distinct from v_me then
                  (select count(*) from (select 1 from public.messages m
                                          where m.thread_id = th.id and m.sender_id = b.customer_id
                                            and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz) limit 99) q)
                else 0 end
    ) as row
    from public.local_booking_state s
    join public.bookings b on b.id = s.booking_id
    left join public.users u on u.id = b.customer_id
    left join public.local_tasker_profiles p on p.tasker_user_id = s.tasker_user_id
    left join lateral (select t.* from public.message_threads t
                        where t.context_type = 'booking' and t.context_id::text = b.id::text
                          and t.customer_id = b.customer_id and t.tasker_id = s.tasker_user_id
                        order by t.last_message_at desc nulls last limit 1) th on true
    left join public.coordinator_thread_reads r on r.thread_id = th.id and r.coordinator_id = v_me
    where s.coordinator_id = v_me or s.original_coordinator_id = v_me
       or exists (select 1 from public.local_booking_events e
                   where e.booking_id = s.booking_id and (e.coordinator_id = v_me or e.previous_coordinator_id = v_me))
    order by coalesce(th.last_message_at, b.created_at) desc nulls last, b.id
    limit v_lim
  ) x;
  return v_out;
end $$;
revoke all on function public.coordinator_chat_list(integer) from public, anon;
grant execute on function public.coordinator_chat_list(integer) to authenticated, service_role;

-- 5. One conversation: customer-visible messages and internal notes, in two separate lists --------------------------------
-- messages[].kind: 'customer' | 'coordinator' (sent through coordinator_send_message) | 'local_tasker' (system lines and cards posted on the
-- Local Tasker's side) | 'other'. No user ids are returned. At most p_limit (1..200) newest messages and 200 newest notes.
create or replace function public.coordinator_chat_thread(p_booking uuid, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); v_access text; v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  s public.local_booking_state; b public.bookings; v_thread uuid; v_msgs jsonb := '[]'::jsonb; v_notes jsonb; v_total integer := 0; v_read timestamptz;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  select t.id into v_thread from public.message_threads t
   where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = b.customer_id and t.tasker_id = s.tasker_user_id
   order by t.last_message_at desc nulls last limit 1;

  if v_thread is not null then
    select count(*) into v_total from public.messages where thread_id = v_thread;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', q.id::text,
             'kind', case when q.sender_id = b.customer_id then 'customer'
                          when q.author_id is not null then 'coordinator'
                          when q.sender_id = s.tasker_user_id then 'local_tasker' else 'other' end,
             'type', q.type, 'body', q.body, 'created_at', q.created_at,
             'author_name', case when q.author_id is not null then coalesce(nullif(btrim(coalesce(q.author_name, '')), ''), 'Coordinator') end,
             'author_is_me', q.author_id is not distinct from v_me
           ) order by q.created_at, q.id), '[]'::jsonb)
      into v_msgs
      from (select m.id, m.sender_id, m.type, m.body, m.created_at, a.coordinator_id as author_id, to_jsonb(c) ->> 'display_name' as author_name
              from public.messages m
              left join public.coordinator_message_authors a on a.message_id = m.id::text
              left join public.coordinators c on c.user_id = a.coordinator_id
             where m.thread_id = v_thread
             order by m.created_at desc, m.id desc limit v_lim) q;
    select r.last_read_at into v_read from public.coordinator_thread_reads r where r.thread_id = v_thread and r.coordinator_id = v_me;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'body', q.body, 'created_at', q.created_at,
           'author_name', coalesce(nullif(btrim(coalesce(q.author_name, '')), ''), 'Coordinator'),
           'author_is_me', q.author_id = v_me
         ) order by q.created_at, q.id), '[]'::jsonb)
    into v_notes
    from (select n.id, n.body, n.created_at, n.author_id, to_jsonb(c) ->> 'display_name' as author_name
            from public.coordinator_internal_notes n
            left join public.coordinators c on c.user_id = n.author_id
           where n.booking_id = p_booking
           order by n.created_at desc, n.id desc limit 200) q;

  return jsonb_build_object('booking_id', p_booking, 'access', v_access, 'read_only', v_access <> 'coordinator',
                            'thread_id', v_thread, 'total_messages', v_total, 'last_read_at', v_read,
                            'messages', v_msgs, 'notes', v_notes);
end $$;
revoke all on function public.coordinator_chat_thread(uuid, integer) from public, anon;
grant execute on function public.coordinator_chat_thread(uuid, integer) to authenticated, service_role;

-- 6. Send a message to the customer ---------------------------------------------------------------------------------------
-- Only the CURRENT, ACTIVE coordinator. The message is stored with the Local Tasker's identity as sender and the customer as receiver (both
-- real public.users rows, exactly like the Job Room cards of Stage 5D-1); the coordinator who wrote it is recorded in
-- coordinator_message_authors. Same request id again = the same message back (duplicate: true), nothing is sent twice.
-- Refusals (hint): not_found, read_only, bad_input, contact_info.
create or replace function public.coordinator_send_message(p_booking uuid, p_request_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); v_access text; v_body text := btrim(coalesce(p_body, '')); s public.local_booking_state; b public.bookings;
  v_open jsonb; v_thread uuid; v_msg_id text; v_msg_at timestamptz; a public.coordinator_message_authors; v_cu0 integer; v_cu1 integer;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null or p_request_id is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if v_access <> 'coordinator' then raise exception 'This conversation is read only for you.' using errcode = 'P0001', hint = 'read_only'; end if;

  select * into a from public.coordinator_message_authors where request_id = p_request_id;
  if found then
    if a.coordinator_id is distinct from v_me or a.booking_id is distinct from p_booking then
      raise exception 'Something went wrong. Please try again.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    select m.created_at into v_msg_at from public.messages m where m.id::text = a.message_id;
    return jsonb_build_object('message_id', a.message_id, 'created_at', coalesce(v_msg_at, a.created_at), 'duplicate', true);
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Write a message of 1 to 2000 characters.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if public._lt_contains_contact(v_body) then
    raise exception 'This message appears to contain contact details, which are not allowed on StreetTasker.' using errcode = 'P0001', hint = 'contact_info';
  end if;

  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  v_open := public.open_local_thread(p_booking);                 -- the existing thread, or creates it (once)
  v_thread := (v_open ->> 'thread_id')::uuid;
  if v_thread is null or v_open ->> 'role' <> 'coordinator' then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  select coalesce(customer_unread, 0) into v_cu0 from public.message_threads where id = v_thread;
  begin
    insert into public.messages (thread_id, sender_id, receiver_id, body, type, flagged, created_at)
    values (v_thread, s.tasker_user_id, b.customer_id, v_body, 'text', false, clock_timestamp())
    returning id::text, created_at into v_msg_id, v_msg_at;
    insert into public.coordinator_message_authors (message_id, booking_id, coordinator_id, request_id) values (v_msg_id, p_booking, v_me, p_request_id);
  exception when unique_violation then
    -- two taps at the same moment: the first one wins, answer with it
    select * into a from public.coordinator_message_authors where request_id = p_request_id;
    if not found then raise; end if;
    return jsonb_build_object('message_id', a.message_id, 'created_at', a.created_at, 'duplicate', true);
  end;

  -- The real project may already have a trigger on messages that updates the preview and the customer's unread count; a scratch
  -- database does not. Raise the count by exactly one either way (never twice).
  select coalesce(customer_unread, 0) into v_cu1 from public.message_threads where id = v_thread;
  update public.message_threads
     set last_message = left(v_body, 80), last_message_at = clock_timestamp(),
         customer_unread = case when v_cu1 > v_cu0 then v_cu1 else v_cu0 + 1 end
   where id = v_thread;
  insert into public.coordinator_thread_reads (coordinator_id, thread_id, last_read_at) values (v_me, v_thread, clock_timestamp())
    on conflict (coordinator_id, thread_id) do update set last_read_at = excluded.last_read_at;

  return jsonb_build_object('message_id', v_msg_id, 'thread_id', v_thread, 'created_at', v_msg_at, 'duplicate', false);
end $$;
revoke all on function public.coordinator_send_message(uuid, uuid, text) from public, anon;
grant execute on function public.coordinator_send_message(uuid, uuid, text) to authenticated, service_role;

-- 7. Write an internal note -------------------------------------------------------------------------------------------------
-- Only the CURRENT, ACTIVE coordinator. Never creates a thread, never touches messages or the thread row, never notifies anyone.
-- The audit row carries the note id and its length, not its text.
create or replace function public.coordinator_add_note(p_booking uuid, p_request_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_access text; v_body text := btrim(coalesce(p_body, '')); n public.coordinator_internal_notes;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null or p_request_id is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if v_access <> 'coordinator' then raise exception 'This conversation is read only for you.' using errcode = 'P0001', hint = 'read_only'; end if;

  select * into n from public.coordinator_internal_notes where request_id = p_request_id;
  if found then
    if n.author_id is distinct from v_me or n.booking_id is distinct from p_booking then
      raise exception 'Something went wrong. Please try again.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('note_id', n.id, 'created_at', n.created_at, 'duplicate', true);
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Write a note of 1 to 2000 characters.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  begin
    insert into public.coordinator_internal_notes (booking_id, author_id, request_id, body) values (p_booking, v_me, p_request_id, v_body) returning * into n;
  exception when unique_violation then
    select * into n from public.coordinator_internal_notes where request_id = p_request_id;
    if not found then raise; end if;
    return jsonb_build_object('note_id', n.id, 'created_at', n.created_at, 'duplicate', true);
  end;
  perform public.local_tasker_audit('internal_note_added', 'local_booking', p_booking::text, null,
            jsonb_build_object('note_id', n.id, 'length', char_length(v_body)), v_me);
  return jsonb_build_object('note_id', n.id, 'created_at', n.created_at, 'duplicate', false);
end $$;
revoke all on function public.coordinator_add_note(uuid, uuid, text) from public, anon;
grant execute on function public.coordinator_add_note(uuid, uuid, text) to authenticated, service_role;

-- 8. Mark the conversation read (current coordinator only; a booking with no thread yet is a no-op) --------------------------
create or replace function public.coordinator_chat_mark_read(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_access text; v_thread uuid; s public.local_booking_state; b public.bookings;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if v_access <> 'coordinator' then return jsonb_build_object('marked', false); end if;
  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  select t.id into v_thread from public.message_threads t
   where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = b.customer_id and t.tasker_id = s.tasker_user_id
   order by t.last_message_at desc nulls last limit 1;
  if v_thread is null then return jsonb_build_object('marked', false); end if;
  insert into public.coordinator_thread_reads (coordinator_id, thread_id, last_read_at) values (v_me, v_thread, clock_timestamp())
    on conflict (coordinator_id, thread_id) do update set last_read_at = excluded.last_read_at;
  return jsonb_build_object('marked', true);
end $$;
revoke all on function public.coordinator_chat_mark_read(uuid) from public, anon;
grant execute on function public.coordinator_chat_mark_read(uuid) to authenticated, service_role;

-- 9. Admin: the only way in, audited ----------------------------------------------------------------------------------------
-- A written reason (10 to 300 characters) is required and the audit row is written BEFORE anything is returned. Returns the newest
-- p_limit messages (1..200) with the coordinator who wrote each, and the notes (newest 200). No table policy exists for administrators.
create or replace function public.coordinator_chat_admin_read(p_booking uuid, p_reason text, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, '')); v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  s public.local_booking_state; b public.bookings; v_thread uuid; v_msgs jsonb := '[]'::jsonb; v_notes jsonb; v_nm integer := 0; v_nn integer;
begin
  if v_me is null or not public.is_local_tasker_admin() then raise exception 'Not available.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into s from public.local_booking_state where booking_id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  if char_length(v_reason) < 10 or char_length(v_reason) > 300 then
    raise exception 'Write the reason for reading this conversation (10 to 300 characters).' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select t.id into v_thread from public.message_threads t
   where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = b.customer_id and t.tasker_id = s.tasker_user_id
   order by t.last_message_at desc nulls last limit 1;
  if v_thread is not null then select count(*) into v_nm from public.messages where thread_id = v_thread; end if;
  select count(*) into v_nn from public.coordinator_internal_notes where booking_id = p_booking;

  perform public.local_tasker_audit('chat_admin_read', 'local_booking', p_booking::text, null,
            jsonb_build_object('reason', v_reason, 'limit', v_lim, 'messages_in_thread', v_nm, 'notes', v_nn), v_me);

  if v_thread is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', q.id::text, 'kind', case when q.sender_id = b.customer_id then 'customer'
                                                                                 when q.author_id is not null then 'coordinator'
                                                                                 else 'local_tasker' end,
                                                 'type', q.type, 'body', q.body, 'created_at', q.created_at,
                                                 'author_name', q.author_name) order by q.created_at, q.id), '[]'::jsonb)
      into v_msgs
      from (select m.id, m.sender_id, m.type, m.body, m.created_at, a.coordinator_id as author_id, to_jsonb(c) ->> 'display_name' as author_name
              from public.messages m
              left join public.coordinator_message_authors a on a.message_id = m.id::text
              left join public.coordinators c on c.user_id = a.coordinator_id
             where m.thread_id = v_thread order by m.created_at desc, m.id desc limit v_lim) q;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'body', q.body, 'created_at', q.created_at, 'author_name', q.author_name) order by q.created_at, q.id), '[]'::jsonb)
    into v_notes
    from (select n.id, n.body, n.created_at, to_jsonb(c) ->> 'display_name' as author_name
            from public.coordinator_internal_notes n left join public.coordinators c on c.user_id = n.author_id
           where n.booking_id = p_booking order by n.created_at desc, n.id desc limit 200) q;
  return jsonb_build_object('booking_id', p_booking, 'thread_id', v_thread, 'total_messages', v_nm, 'messages', v_msgs, 'notes', v_notes);
end $$;
revoke all on function public.coordinator_chat_admin_read(uuid, text, integer) from public, anon;
grant execute on function public.coordinator_chat_admin_read(uuid, text, integer) to authenticated, service_role;

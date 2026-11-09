-- Stage B2d: the quote appears as a card in the chat (coordinator chat page: read). RUN ONCE in the Supabase SQL editor (one transaction).
-- Built from the exact function text pasted from b2d-introspect.sql (Block 1). Only lines marked "B2d" are new.
-- Undo: b2d-rollback.sql.
--
-- What it does
--  1. Trigger on local_booking_quotes (AFTER INSERT): when a quote is sent, ONE line is written in the Job Room chat of that booking
--     (type 'system', the same type the job event lines use, so it needs no new message type and passes the room gate and the guard).
--     The line says "Quote sent: <amount>" in plain words (older screens show just that) and carries payload {card:'quote', quote_id, version}.
--     It also moves the thread preview and raises the customer's unread count by one, like _job_event does.
--     Any failure inside is swallowed with a warning: a chat line must never block a quote.
--  2. coordinator_chat_cards: also returns "quotes" (every quote of the booking with lines, status, the customer's answer).
--  3. coordinator_chat_thread: passes the small quote payload of those system lines to the coordinator page.
-- Not changed: local_booking_send_quote, the quote tables, the state machine, payments, notifications, the messages table and its triggers.
-- Quotes sent BEFORE this runs get no chat line (nothing is back-filled).

begin;

create or replace function public._local_booking_quote_chat_line()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  b public.bookings; s public.local_booking_state; v_thread uuid; v_body text;
begin
  begin
    select * into b from public.bookings where id = NEW.booking_id;
    select * into s from public.local_booking_state where booking_id = NEW.booking_id;
    if b.id is null or s.booking_id is null or s.tasker_user_id is null then return NEW; end if;
    v_thread := public._local_booking_thread(NEW.booking_id, b.customer_id, s.tasker_user_id);   -- the existing thread, or creates it once
    if v_thread is null then return NEW; end if;

    -- chr(8358) is the naira sign, written this way so the SQL editor cannot change it
    v_body := case when coalesce(NEW.version, 1) > 1 then 'New quote sent: ' else 'Quote sent: ' end
              || chr(8358) || to_char(round(NEW.total), 'FM999,999,999,999');

    insert into public.messages (thread_id, sender_id, receiver_id, body, type, flagged, payload)
    values (v_thread, s.tasker_user_id, b.customer_id, v_body, 'system', false,
            jsonb_build_object('card', 'quote', 'quote_id', NEW.id, 'version', NEW.version));

    update public.message_threads
       set last_message = left(v_body, 80), last_message_at = now(),
           customer_unread = coalesce(customer_unread, 0) + 1
     where id = v_thread;
  exception when others then
    raise warning '_local_booking_quote_chat_line failed: %', sqlerrm;
  end;
  return NEW;
end
$fn$;

drop trigger if exists lbq_chat_line on public.local_booking_quotes;
create trigger lbq_chat_line
  after insert on public.local_booking_quotes
  for each row execute function public._local_booking_quote_chat_line();

-- ---- coordinator_chat_cards (B2d: adds "quotes") ----
CREATE OR REPLACE FUNCTION public.coordinator_chat_cards(p_booking uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_access text; s public.local_booking_state; b public.bookings; v_thread uuid;
  v_req jsonb := '[]'::jsonb; v_pay jsonb := '[]'::jsonb; v_rec jsonb := '[]'::jsonb; v_quo jsonb := '[]'::jsonb;   -- B2d: v_quo
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
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'kind', r.kind, 'status', r.status, 'note', r.note, 'payload', r.payload,
             'by', case when r.requested_by = b.customer_id then 'customer' else 'local_tasker' end,
             'created_at', r.created_at, 'responded_at', r.responded_at) order by r.created_at, r.id), '[]'::jsonb)
      into v_req from public.job_requests r where r.thread_id = v_thread;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'kind', p.kind, 'status', p.status, 'amount', p.amount, 'title', p.title, 'reason', p.reason,
             'breakdown', p.breakdown, 'invoice_number', p.invoice_number, 'due_date', p.due_date, 'revises_id', p.revises_id,
             'settlement', p.settlement, 'created_at', p.created_at, 'paid_at', p.paid_at) order by p.created_at, p.id), '[]'::jsonb)
      into v_pay from public.payment_requests p where p.thread_id = v_thread;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'receipt_number', c.receipt_number, 'payment_request_id', c.payment_request_id, 'kind', c.kind,
             'title', c.title, 'invoice_number', c.invoice_number, 'amount', c.amount, 'lines', c.lines, 'paid_at', c.paid_at)
             order by c.paid_at, c.id), '[]'::jsonb)
      into v_rec from public.payment_receipts c where c.thread_id = v_thread;
  end if;

  -- B2d: every quote of the booking, newest last, with the customer's answer (if any). status: sent / approved / declined / replaced
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'version', q.version, 'total', q.total, 'note', q.note, 'created_at', q.created_at,
           'lines', public._local_booking_quote_lines(q),
           'status', case when q.superseded_at is not null then 'replaced'
                          when d.id is not null and d.decision = 'declined' then 'declined'
                          when d.id is not null then 'approved' else 'sent' end,
           'reason', d.reason, 'counter_amount', d.counter_amount, 'decided_at', d.created_at) order by q.version, q.created_at), '[]'::jsonb)
    into v_quo
    from public.local_booking_quotes q
    left join public.local_booking_quote_decisions d on d.quote_id = q.id
   where q.booking_id = p_booking;

  return jsonb_build_object('booking_id', p_booking, 'thread_id', v_thread, 'read_only', v_access <> 'coordinator',
                            'requests', v_req, 'payments', v_pay, 'receipts', v_rec, 'quotes', v_quo);
end $function$;

-- ---- coordinator_chat_thread (B2d: passes the quote payload) ----
CREATE OR REPLACE FUNCTION public.coordinator_chat_thread(p_booking uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
             'author_is_me', q.author_id is not distinct from v_me,
             'payload', case when q.type in ('image', 'video', 'file', 'location') and jsonb_typeof(q.payload) = 'object'
                             then (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(q.payload) e
                                    where e.key in ('attachment_id', 'path', 'name', 'size', 'mime', 'caption', 'lat', 'lng', 'label'))
                             -- B2d: the quote card line carries only the card name, the quote id and its version
                             when q.type = 'system' and jsonb_typeof(q.payload) = 'object' and q.payload ->> 'card' = 'quote'
                             then jsonb_build_object('card', 'quote', 'quote_id', q.payload ->> 'quote_id', 'version', q.payload -> 'version') end
           ) order by q.created_at, q.id), '[]'::jsonb)
      into v_msgs
      from (select m.id, m.sender_id, m.type, m.body, m.payload, m.created_at, a.coordinator_id as author_id, to_jsonb(c) ->> 'display_name' as author_name
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
end $function$;

commit;

-- Check 1 (expect one row, both true): the trigger exists and the two functions carry the B2d changes
select (select count(*) = 1 from pg_trigger where tgname = 'lbq_chat_line' and not tgisinternal) as trigger_ok,
       (select pg_get_functiondef(p.oid) like '%v_quo%' from pg_proc p where p.proname = 'coordinator_chat_cards' and p.pronamespace = 'public'::regnamespace) as cards_ok,
       (select pg_get_functiondef(p.oid) like '%B2d: the quote card line%' from pg_proc p where p.proname = 'coordinator_chat_thread' and p.pronamespace = 'public'::regnamespace) as thread_ok;

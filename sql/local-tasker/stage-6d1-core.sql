-- ============================================================================
-- StreetTasker Local Tasker: STAGE 6D-1 core (coordinator chat: payment and request cards, payment history, activity)
-- Additive and re-runnable. Rollback: stage-6d1-rollback.sql. Needs stage-6b-core.sql first (local_chat_access).
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- WHAT THIS ADDS (READ ONLY, two functions, no table, no policy, no trigger, no grant on any table)
--   coordinator_chat_cards(booking)     the payment requests, job requests and payment receipts of the booking's conversation.
--                                       Feeds the cards inside the thread and the Payment history in the right-hand column.
--   coordinator_chat_activity(booking)  the activity timeline (job_events) of the booking, newest first, max 100.
-- WHO: the current coordinator and a former coordinator of the booking (read only), exactly like coordinator_chat_thread
--      (local_chat_access). Nobody else: not the customer, not another coordinator, not an administrator directly.
-- WHY FUNCTIONS AND NOT NEW POLICIES: the project already has coordinator read policies on payment_requests and job_events, but none on
--      job_requests or payment_receipts, and none for a FORMER coordinator. One audited, column-limited function covers all of it
--      without widening any table. No user ids are returned: who asked is 'customer' or 'local_tasker'.
-- NEVER touches: payment_requests, job_requests, payment_receipts, job_events, escrow, wallets, bookings, any existing function or policy.
-- Real source read from the owner's export of 2026-11-04 (query 68): payment_requests, job_requests, payment_receipts, job_events columns.
-- ============================================================================

-- 0. Pre-flight --------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.local_chat_access(uuid)') is null then
    raise exception 'Run stage-6b-core.sql first (local_chat_access is missing). Nothing was changed.';
  end if;
  if to_regclass('public.payment_requests') is null or to_regclass('public.job_requests') is null
     or to_regclass('public.payment_receipts') is null or to_regclass('public.job_events') is null
     or to_regclass('public.message_threads') is null or to_regclass('public.local_booking_state') is null
     or to_regclass('public.bookings') is null then
    raise exception 'A required table is missing (payment_requests, job_requests, payment_receipts, job_events, message_threads, local_booking_state, bookings). Nothing was changed.';
  end if;
end $$;

-- 1. The cards ------------------------------------------------------------------------------------------------------
create or replace function public.coordinator_chat_cards(p_booking uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_access text; s public.local_booking_state; b public.bookings; v_thread uuid;
  v_req jsonb := '[]'::jsonb; v_pay jsonb := '[]'::jsonb; v_rec jsonb := '[]'::jsonb;
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

  return jsonb_build_object('booking_id', p_booking, 'thread_id', v_thread, 'read_only', v_access <> 'coordinator',
                            'requests', v_req, 'payments', v_pay, 'receipts', v_rec);
end $$;
revoke all on function public.coordinator_chat_cards(uuid) from public, anon;
grant execute on function public.coordinator_chat_cards(uuid) to authenticated, service_role;

-- 2. The activity timeline ---------------------------------------------------------------------------------------------
create or replace function public.coordinator_chat_activity(p_booking uuid, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_access text; s public.local_booking_state; b public.bookings; v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 100); v_rows jsonb;
begin
  v_access := public.local_chat_access(p_booking);
  if v_access is null then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Conversation not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'kind', q.kind, 'text', q.text, 'note', q.note, 'created_at', q.created_at,
           'by', case when q.actor_id is null then 'system'
                      when q.actor_id = b.customer_id then 'customer'
                      when q.actor_id = s.tasker_user_id then 'local_tasker'
                      else 'staff' end
         ) order by q.created_at desc, q.id desc), '[]'::jsonb)
    into v_rows
    from (select e.id, e.kind, e.text, e.note, e.created_at, e.actor_id
            from public.job_events e where e.booking_id = p_booking
           order by e.created_at desc, e.id desc limit v_lim) q;

  return jsonb_build_object('booking_id', p_booking, 'read_only', v_access <> 'coordinator', 'events', v_rows);
end $$;
revoke all on function public.coordinator_chat_activity(uuid, integer) from public, anon;
grant execute on function public.coordinator_chat_activity(uuid, integer) to authenticated, service_role;

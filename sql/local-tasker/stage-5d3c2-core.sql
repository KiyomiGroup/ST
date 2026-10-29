-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3c-2 core (exceptions, part 3b: a price going DOWN)
-- Additive and re-runnable. Rollback: stage-5d3c2-rollback.sql. Needs stage-5d3b-core.sql (and so 5D-3a, 5D-2, 5D-1, 5C-2, 5C-1, 5A) first.
-- Needs stage-5d3c1-core.sql only for the shared closeout guard (which 5D-3b already installs). Run in the Supabase SQL editor
-- (select all, Run). Safe to run twice.
--
-- OWNER RULE (every stage): a coordinator never runs, records or triggers a refund. Refunds are decided and recorded by SUPPORT
-- (support_resolve_dispute with refund_full / refund_partial / split, after the refund was made by hand in Paystack).
--
-- The design (owner said "use your proposal", 2026-10-29):
--   (a) BEFORE any payment: nothing new is built here. The existing "send back to the Local Tasker" path already gives a new answer and a
--       new quote, and the 5D-1 trigger cancels the unpaid requests of the replaced quote. This stage only tells the coordinator that,
--       and refuses to open a reduction report when nothing has been paid (hint not_paid).
--   (b) AFTER a payment (the main payment, or the extras only): the coordinator records the reduction the Local Tasker agreed to and this
--       opens a REAL problem report, category wrong_amount, through local_booking_open_problem (5D-3b, unchanged). The amount, the amount
--       paid so far and how the Local Tasker confirmed it go into the report's reason, in a fixed wording, so support sees them.
--       The database trigger freezes the booking as for any problem report. Support decides and records the refund.
--
-- What it adds:
--   1. local_booking_reductions: one immutable row per reduction request (amount, paid so far, why, how confirmed, the report it opened).
--   2. _local_booking_reduction_paid(booking): what the customer has PAID on the booking (payment_requests status paid, kind not refund),
--        minus the reductions already asked for on it and not withdrawn. This is the most a reduction may ask for (D104, a GUESS).
--   3. _local_booking_reduction_block(booking): why a reduction cannot be requested now (null = it can).
--   4. local_booking_request_reduction (coordinator rpc): checks, then calls local_booking_open_problem and records the row.
--   5. local_booking_reduction (coordinator read): can_request, blocked, paid, room, the list with the report's status and outcome.
-- Withdrawing uses the existing local_booking_withdraw_problem (only while the report is still 'open').
-- NEVER writes: bookings, lt_status, payment_status, agreed_price, payment_requests, payment_intents, escrow_payments, wallets,
-- wallet_transactions, job_refunds, release code. It writes only through local_booking_open_problem (job_disputes, dispute_events,
-- local_booking_problem_reports, a customer notification) and its own record table.
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.local_booking_open_problem(uuid,uuid,text,text)') is null
     or to_regprocedure('public.local_booking_withdraw_problem(uuid,uuid)') is null
     or to_regprocedure('public._local_booking_report_block(uuid)') is null
     or to_regprocedure('public._local_booking_cancel_block(uuid)') is null
     or to_regclass('public.local_booking_problem_reports') is null then
    raise exception 'Run stage-5d3b-core.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.local_booking_closeout_guard()') is null
     or to_regprocedure('public._local_booking_log(uuid,text,text,text,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null
     or to_regprocedure('public.job_booking_frozen(uuid)') is null then
    raise exception 'A Stage 5D-3b helper is missing. Nothing was changed.';
  end if;
  if to_regclass('public.payment_requests') is null or to_regclass('public.job_disputes') is null or to_regclass('public.message_threads') is null then
    raise exception 'A Job Room table is missing. Nothing was changed.';
  end if;
end $$;

-- 1. the record -------------------------------------------------------------------------------------------------
create table if not exists public.local_booking_reductions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  request_id uuid not null unique,                         -- makes a retried tap harmless (also the report's request id)
  dispute_id uuid not null unique,                         -- the job_disputes row this opened
  amount numeric not null,                                 -- the reduction the Local Tasker agreed to, in naira
  paid_total numeric not null,                             -- what the customer had paid when it was asked
  why text not null,
  confirmed_how text not null,
  coordinator_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint lbrd_amount_check check (amount >= 100 and amount <= 10000000 and amount = round(amount)),
  constraint lbrd_why_check check (char_length(why) between 5 and 300),
  constraint lbrd_how_check check (confirmed_how in ('phone_call', 'in_person', 'message'))
);
create index if not exists lbrd_booking_idx on public.local_booking_reductions (booking_id, created_at);
alter table public.local_booking_reductions enable row level security;
drop policy if exists lt_reductions_admin_read on public.local_booking_reductions;
create policy lt_reductions_admin_read on public.local_booking_reductions for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_reductions from public, anon, authenticated;
grant select on public.local_booking_reductions to authenticated;            -- RLS: administrators only
grant select, insert on public.local_booking_reductions to service_role;

drop trigger if exists lbrd_guard on public.local_booking_reductions;
create trigger lbrd_guard before update or delete on public.local_booking_reductions
  for each row execute function public.local_booking_closeout_guard();       -- immutable (the 5D-3b guard; only the booking cascade may delete)

create or replace function public.local_booking_reductions_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._local_booking_log(NEW.booking_id, 'reduction_requested', null, 'wrong_amount', NEW.coordinator_id, null, NEW.coordinator_id, 'coordinator',
                                    'NGN ' || NEW.amount::bigint || ' - reported to support');
  perform public.local_tasker_audit('local_booking_reduction_requested', 'booking', NEW.booking_id::text, null,
    jsonb_build_object('reduction_id', NEW.id, 'dispute_id', NEW.dispute_id, 'amount', NEW.amount, 'paid_total', NEW.paid_total, 'confirmed_how', NEW.confirmed_how),
    NEW.coordinator_id);
  return NEW;
end $$;
drop trigger if exists lbrd_audit on public.local_booking_reductions;
create trigger lbrd_audit after insert on public.local_booking_reductions
  for each row execute function public.local_booking_reductions_audit();
revoke all on function public.local_booking_reductions_audit() from public, anon, authenticated;

-- 2. helpers (internal, no browser access) -------------------------------------------------------------------------
-- The most a reduction may still ask for: what the customer PAID (payment_requests with status paid; kind refund never counts), minus
-- the reductions already asked for on this booking whose report was not withdrawn. D104 (a GUESS the owner must confirm).
create or replace function public._local_booking_reduction_paid(p_booking uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0,
    coalesce((select sum(r.amount) from public.payment_requests r
               where r.status = 'paid' and coalesce(r.kind, '') <> 'refund'
                 and r.thread_id in (select t.id from public.message_threads t where t.context_type = 'booking' and t.context_id::text = p_booking::text)), 0)
    - coalesce((select sum(x.amount) from public.local_booking_reductions x join public.job_disputes d on d.id = x.dispute_id
                 where x.booking_id = p_booking and d.status <> 'withdrawn'), 0))
$$;
revoke all on function public._local_booking_reduction_paid(uuid) from public, anon, authenticated;
grant execute on function public._local_booking_reduction_paid(uuid) to service_role;

-- Why can a reduction NOT be requested right now? null = it can.
create or replace function public._local_booking_reduction_block(p_booking uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.local_booking_state; v_rb text; v_cb text; v_paid numeric;
begin
  select * into s from public.local_booking_state where booking_id = p_booking;
  if s.booking_id is null then return 'not_found'; end if;
  v_rb := public._local_booking_report_block(p_booking);        -- not_found, booking_closed, dispute_open, too_many
  if v_rb is not null then return v_rb; end if;
  if s.lt_status <> 'quote_approved' then return 'not_approved'; end if;
  v_cb := public._local_booking_cancel_block(p_booking);
  if v_cb = 'payment_started' then return 'payment_started'; end if;
  if coalesce((select sum(r.amount) from public.payment_requests r
                where r.status = 'paid' and coalesce(r.kind, '') <> 'refund'
                  and r.thread_id in (select t.id from public.message_threads t where t.context_type = 'booking' and t.context_id::text = p_booking::text)), 0) <= 0 then
    return 'not_paid';
  end if;
  if public._local_booking_reduction_paid(p_booking) < 100 then return 'nothing_left'; end if;
  return null;
end $$;
revoke all on function public._local_booking_reduction_block(uuid) from public, anon, authenticated;
grant execute on function public._local_booking_reduction_block(uuid) to service_role;

-- 3. coordinator: report that the Local Tasker agreed to a lower price -------------------------------------------------
create or replace function public.local_booking_request_reduction(p_booking uuid, p_request_id uuid, p_amount numeric, p_why text, p_how text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; x public.local_booking_reductions;
  v_why text := btrim(coalesce(p_why, '')); v_block text; v_paid numeric; v_room numeric; v_reason text; v_res jsonb; v_dispute uuid; v_how text;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null then raise exception 'That could not be saved.' using errcode = 'P0001', hint = 'bad_input'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 10000000 or p_amount <> round(p_amount) then
    raise exception 'The amount must be a whole amount between 100 and 10,000,000.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if char_length(v_why) < 5 or char_length(v_why) > 300 then
    raise exception 'Say why the price goes down (5 to 300 characters).' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_how is null or p_how not in ('phone_call', 'in_person', 'message') then
    raise exception 'Say how the Local Tasker confirmed the lower price.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select * into x from public.local_booking_reductions where request_id = p_request_id;
  if found then                                              -- a retry: same answer, nothing new
    if x.booking_id <> p_booking or x.coordinator_id <> v_me or x.amount <> p_amount then
      raise exception 'That request was already used for something else.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('requested', true, 'changed', false, 'duplicate', true, 'dispute_id', x.dispute_id);
  end if;

  perform 1 from public.bookings where id = p_booking for update;
  v_block := public._local_booking_reduction_block(p_booking);
  if v_block = 'booking_closed' then raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed'; end if;
  if v_block = 'dispute_open' then raise exception 'A problem report is already open on this booking.' using errcode = 'P0001', hint = 'dispute_open'; end if;
  if v_block = 'too_many' then raise exception 'Too many reports today. Please wait before opening another.' using errcode = 'P0001', hint = 'too_many'; end if;
  if v_block = 'not_approved' then raise exception 'The customer has not approved the quote yet. Change the quote instead.' using errcode = 'P0001', hint = 'not_approved'; end if;
  if v_block = 'payment_started' then raise exception 'A payment has just started. Please wait a moment and try again.' using errcode = 'P0001', hint = 'payment_started'; end if;
  if v_block = 'not_paid' then
    raise exception 'Nothing has been paid yet. Send the booking back to the Local Tasker for a new answer and a new quote instead.' using errcode = 'P0001', hint = 'not_paid';
  end if;
  if v_block = 'nothing_left' then
    raise exception 'Everything that was paid is already covered by earlier reduction requests.' using errcode = 'P0001', hint = 'over_limit';
  end if;
  if v_block is not null then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;

  v_room := public._local_booking_reduction_paid(p_booking);
  if p_amount > v_room then
    raise exception 'A reduction cannot be more than what was paid (NGN % can still be asked for).', to_char(v_room, 'FM999,999,999')
      using errcode = 'P0001', hint = 'over_limit';
  end if;
  select coalesce(sum(r.amount), 0) into v_paid from public.payment_requests r
   where r.status = 'paid' and coalesce(r.kind, '') <> 'refund'
     and r.thread_id in (select t.id from public.message_threads t where t.context_type = 'booking' and t.context_id::text = p_booking::text);

  v_how := case p_how when 'phone_call' then 'on a phone call' when 'in_person' then 'in person' else 'by message' end;
  -- the fixed wording support reads (the report reason is 10 to 1000 characters; this is at most about 450)
  v_reason := 'PRICE REDUCTION asked for by the coordinator for the Local Tasker. Reduce the price by NGN ' || to_char(p_amount, 'FM999,999,999')
              || '. Paid so far: NGN ' || to_char(v_paid, 'FM999,999,999') || '. The Local Tasker agreed to this ' || v_how || '. Why: ' || v_why;

  v_res := public.local_booking_open_problem(p_booking, p_request_id, 'wrong_amount', v_reason);   -- the real 5D-3b function: freezes the booking, tells the customer
  v_dispute := (v_res ->> 'dispute_id')::uuid;
  insert into public.local_booking_reductions (booking_id, request_id, dispute_id, amount, paid_total, why, confirmed_how, coordinator_id)
  values (p_booking, p_request_id, v_dispute, p_amount, v_paid, v_why, p_how, v_me);
  return jsonb_build_object('requested', true, 'changed', true, 'duplicate', false, 'dispute_id', v_dispute);
end $$;
revoke all on function public.local_booking_request_reduction(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.local_booking_request_reduction(uuid, uuid, numeric, text, text) to authenticated, service_role;

-- 4. coordinator read -----------------------------------------------------------------------------------------------------
create or replace function public.local_booking_reduction(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_block text; v_list jsonb; v_paid numeric;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me)
     or not exists (select 1 from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  v_block := public._local_booking_reduction_block(p_booking);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'dispute_id', x.dispute_id, 'amount', x.amount, 'why', x.why, 'status', d.status, 'outcome', d.outcome,
                                               'created_at', x.created_at, 'can_withdraw', d.status = 'open') order by x.created_at desc), '[]'::jsonb)
    into v_list
    from public.local_booking_reductions x join public.job_disputes d on d.id = x.dispute_id where x.booking_id = p_booking;
  v_paid := public._local_booking_reduction_paid(p_booking);
  return jsonb_build_object('can_request', v_block is null, 'blocked', v_block, 'room', v_paid, 'items', v_list);
end $$;
revoke all on function public.local_booking_reduction(uuid) from public, anon;
grant execute on function public.local_booking_reduction(uuid) to authenticated, service_role;

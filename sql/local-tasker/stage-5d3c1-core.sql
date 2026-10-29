-- ============================================================================
-- StreetTasker Local Tasker: STAGE 5D-3c-1 core (exceptions, part 3a: EXTRA COSTS after the quote was approved)
-- Additive and re-runnable. Rollback: stage-5d3c1-rollback.sql. Needs stage-5d3b-core.sql (and so 5D-3a, 5D-2, 5D-1, 5C-2, 5C-1, 5A) first.
-- Run in the Supabase SQL editor (select all, Run). Safe to run twice.
--
-- WHY THIS IS NOT price_proposal (written against the REAL source in the owner's CSV, 2026-10-29):
--   price_propose refuses after the first main payment, price_respond sets message_threads.agreed_price and bookings.amount, and the
--   trigger price_proposal_retires_request cancels the pending MAIN payment requests (payment, full_payment). For a Local Tasker booking
--   the quote's service-fee request already exists, so a price proposal would cancel it and leave the customer with nothing to pay.
--   After a payment it is refused outright. So extra money after approval, payment or arrival uses the Job Room's ADD-ON payment
--   requests instead (kinds additional_cost / materials / transport): the customer pays or declines each one, and the agreed price is never
--   changed (same rule as Stage 8 invoices). This is a change from "reuse price_proposal"; the owner may overrule (handoff, section 9).
--
-- What it adds:
--   1. local_booking_extra_costs: one immutable row per extra-cost request (kind, amount, title, details, how the Local Tasker confirmed it).
--   2. local_booking_request_extra (coordinator rpc): records that the Local Tasker confirmed the extra cost, then creates ONE pending
--        payment_requests row of an add-on kind plus its chat card in the booking's Job Room, and tells the customer. The customer pays or
--        declines it in the Job Room, the existing way. Nothing is paid or released here.
--   3. local_booking_cancel_extra (coordinator rpc): withdraws an extra-cost request the customer has not paid (status pending only).
--   4. local_booking_extras (coordinator read): can a request be made now (and why not), what is left of the limit, the list with status.
-- NEVER writes: bookings, lt_status, payment_status, agreed_price, payment_intents, escrow_payments, wallets, wallet_transactions, release code.
-- The only payment table written is payment_requests: INSERT (pending) and pending -> cancelled on rows made by this path.
-- ============================================================================

-- 0. Pre-flight ----------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.local_booking_cancel(uuid,uuid,text,text)') is null or to_regclass('public.local_booking_cancellations') is null then
    raise exception 'Run stage-5d3b-core.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public._local_booking_thread(uuid,uuid,uuid)') is null or to_regprocedure('public._local_booking_is_open(text)') is null
     or to_regprocedure('public.job_booking_frozen(uuid)') is null or to_regprocedure('public._notify(uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public._local_booking_log(uuid,text,text,text,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.local_tasker_audit(text,text,text,jsonb,jsonb,uuid)') is null
     or to_regprocedure('public.local_booking_closeout_guard()') is null then
    raise exception 'A Stage 5D-1 / 5D-3b helper is missing. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.payment_requests'::regclass and contype = 'c'
                 and pg_get_constraintdef(oid) ~ '''additional_cost''' and pg_get_constraintdef(oid) ~ '''materials''' and pg_get_constraintdef(oid) ~ '''transport''') then
    raise exception 'payment_requests does not accept the kinds additional_cost, materials and transport. Nothing was changed.';
  end if;
end $$;

-- 1. the record -------------------------------------------------------------------------------------------------
create table if not exists public.local_booking_extra_costs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  request_id uuid not null unique,                         -- makes a retried tap harmless
  kind text not null,
  amount numeric not null,
  title text not null,
  details text not null,
  confirmed_how text not null,                             -- how the coordinator got the Local Tasker's confirmation
  coordinator_id uuid not null,
  payment_request_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  constraint lbec_kind_check check (kind in ('additional_cost', 'materials', 'transport')),
  constraint lbec_amount_check check (amount >= 100 and amount <= 10000000 and amount = round(amount)),
  constraint lbec_title_check check (char_length(title) between 3 and 60),
  constraint lbec_details_check check (char_length(details) between 5 and 300),
  constraint lbec_how_check check (confirmed_how in ('phone_call', 'in_person', 'message'))
);
create index if not exists lbec_booking_idx on public.local_booking_extra_costs (booking_id, created_at);
alter table public.local_booking_extra_costs enable row level security;
drop policy if exists lt_extra_costs_admin_read on public.local_booking_extra_costs;
create policy lt_extra_costs_admin_read on public.local_booking_extra_costs for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_extra_costs from public, anon, authenticated;
grant select on public.local_booking_extra_costs to authenticated;            -- RLS: administrators only
grant select, insert on public.local_booking_extra_costs to service_role;

drop trigger if exists lbec_guard on public.local_booking_extra_costs;
create trigger lbec_guard before update or delete on public.local_booking_extra_costs
  for each row execute function public.local_booking_closeout_guard();       -- immutable (the 5D-3b guard; only the booking cascade may delete)

create or replace function public.local_booking_extra_costs_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._local_booking_log(NEW.booking_id, 'extra_requested', null, NEW.kind, NEW.coordinator_id, null, NEW.coordinator_id, 'coordinator',
                                    'NGN ' || NEW.amount::bigint || ' - ' || NEW.title);
  perform public.local_tasker_audit('local_booking_extra_requested', 'booking', NEW.booking_id::text, null,
    jsonb_build_object('extra_id', NEW.id, 'kind', NEW.kind, 'amount', NEW.amount, 'payment_request_id', NEW.payment_request_id, 'confirmed_how', NEW.confirmed_how),
    NEW.coordinator_id);
  return NEW;
end $$;
drop trigger if exists lbec_audit on public.local_booking_extra_costs;
create trigger lbec_audit after insert on public.local_booking_extra_costs
  for each row execute function public.local_booking_extra_costs_audit();
revoke all on function public.local_booking_extra_costs_audit() from public, anon, authenticated;

-- 2. helper: why can an extra cost NOT be requested right now? null = it can. ---------------------------------------
-- The limit (D100, a GUESS the owner must confirm): the extra costs asked for on a booking (waiting or paid, not declined or cancelled)
-- may not add up to more than the total of the CURRENT quote.
create or replace function public._local_booking_extra_block(p_booking uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.local_booking_state; b public.bookings;
begin
  select * into s from public.local_booking_state where booking_id = p_booking;
  select * into b from public.bookings where id = p_booking;
  if s.booking_id is null or b.id is null then return 'not_found'; end if;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then return 'booking_closed'; end if;
  if public.job_booking_frozen(p_booking) then return 'dispute_open'; end if;
  if s.lt_status <> 'quote_approved' then return 'not_approved'; end if;
  if exists (select 1 from public.local_booking_extra_costs x join public.payment_requests r on r.id = x.payment_request_id
              where x.booking_id = p_booking and r.status in ('pending', 'processing')) then return 'one_waiting'; end if;
  return null;
end $$;
revoke all on function public._local_booking_extra_block(uuid) from public, anon, authenticated;
grant execute on function public._local_booking_extra_block(uuid) to service_role;

-- What is still allowed in total on this booking (the current quote total minus the extras asked for and not declined/cancelled).
create or replace function public._local_booking_extra_room(p_booking uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0,
    coalesce((select q.total from public.local_booking_quotes q where q.booking_id = p_booking and q.superseded_at is null
               order by q.version desc limit 1), 0)
    - coalesce((select sum(x.amount) from public.local_booking_extra_costs x join public.payment_requests r on r.id = x.payment_request_id
                 where x.booking_id = p_booking and r.status in ('pending', 'processing', 'paid', 'refunded')), 0))
$$;
revoke all on function public._local_booking_extra_room(uuid) from public, anon, authenticated;
grant execute on function public._local_booking_extra_room(uuid) to service_role;

-- 3. coordinator: ask the customer to pay an extra cost ---------------------------------------------------------------
create or replace function public.local_booking_request_extra(
  p_booking uuid, p_request_id uuid, p_kind text, p_amount numeric, p_title text, p_details text, p_how text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; x public.local_booking_extra_costs;
  v_title text := btrim(coalesce(p_title, '')); v_details text := btrim(coalesce(p_details, ''));
  v_block text; v_thread uuid; v_pr uuid; v_label text;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null or p_kind is null or p_kind not in ('additional_cost', 'materials', 'transport') then
    raise exception 'Choose what the extra cost is for.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_amount is null or p_amount < 100 or p_amount > 10000000 or p_amount <> round(p_amount) then
    raise exception 'The amount must be a whole amount between 100 and 10,000,000.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 60 then
    raise exception 'Give the cost a short title (3 to 60 characters).' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if char_length(v_details) < 5 or char_length(v_details) > 300 then
    raise exception 'Add some details (5 to 300 characters).' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_how is null or p_how not in ('phone_call', 'in_person', 'message') then
    raise exception 'Say how the Local Tasker confirmed this cost.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  select * into x from public.local_booking_extra_costs where request_id = p_request_id;
  if found then                                              -- a retry: same answer, nothing new
    if x.booking_id <> p_booking or x.coordinator_id <> v_me or x.kind <> p_kind or x.amount <> p_amount then
      raise exception 'That request was already used for something else.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    return jsonb_build_object('requested', true, 'changed', false, 'duplicate', true, 'payment_request_id', x.payment_request_id);
  end if;

  select * into b from public.bookings where id = p_booking for update;
  v_block := public._local_booking_extra_block(p_booking);
  if v_block = 'booking_closed' then raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed'; end if;
  if v_block = 'dispute_open' then raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open'; end if;
  if v_block = 'not_approved' then raise exception 'The customer has not approved the quote yet. Change the quote instead.' using errcode = 'P0001', hint = 'not_approved'; end if;
  if v_block = 'one_waiting' then raise exception 'An earlier extra cost is still waiting for the customer.' using errcode = 'P0001', hint = 'one_waiting'; end if;
  if v_block is not null then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_amount > public._local_booking_extra_room(p_booking) then
    raise exception 'The extra costs on this booking cannot add up to more than the quote total (NGN % still allowed).', to_char(public._local_booking_extra_room(p_booking), 'FM999,999,999')
      using errcode = 'P0001', hint = 'over_limit';
  end if;

  v_thread := public._local_booking_thread(p_booking, b.customer_id, s.tasker_user_id);
  v_label := case p_kind when 'materials' then 'Materials' when 'transport' then 'Transport' else 'Additional cost' end;
  insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, title, reason, status)
  values (v_thread, s.tasker_user_id, b.customer_id, p_amount, p_kind, v_title, left(v_title || ': ' || v_details, 300), 'pending')
  returning id into v_pr;
  -- the card in the Job Room (same shape as the quote requests). Required: a request with no card cannot be paid.
  insert into public.messages (thread_id, sender_id, receiver_id, body, type, payment_request_id, flagged)
  values (v_thread, s.tasker_user_id, b.customer_id, 'PAYMENT_REQUEST:' || v_pr || ':' || p_amount::bigint, 'payment_request', v_pr, false);
  update public.message_threads
     set last_message = v_label || ' requested: ₦' || to_char(p_amount, 'FM999,999,999'), last_message_at = now(),
         customer_unread = coalesce(customer_unread, 0) + 1
   where id = v_thread;
  perform public._notify(b.customer_id, 'job_update', v_label || ' requested: ₦' || to_char(p_amount, 'FM999,999,999'), left(v_title, 120),
                         jsonb_build_object('thread_id', v_thread, 'request_id', v_pr));

  insert into public.local_booking_extra_costs (booking_id, request_id, kind, amount, title, details, confirmed_how, coordinator_id, payment_request_id)
  values (p_booking, p_request_id, p_kind, p_amount, v_title, v_details, p_how, v_me, v_pr);
  return jsonb_build_object('requested', true, 'changed', true, 'duplicate', false, 'payment_request_id', v_pr);
end $$;
revoke all on function public.local_booking_request_extra(uuid, uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.local_booking_request_extra(uuid, uuid, text, numeric, text, text, text) to authenticated, service_role;

-- 4. coordinator: withdraw an extra-cost request the customer has not paid -----------------------------------------------
create or replace function public.local_booking_cancel_extra(p_booking uuid, p_extra uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state; x public.local_booking_extra_costs; r public.payment_requests;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into x from public.local_booking_extra_costs where id = p_extra and booking_id = p_booking;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into r from public.payment_requests where id = x.payment_request_id for update;
  if r.status = 'cancelled' then return jsonb_build_object('cancelled', true, 'changed', false); end if;   -- harmless twice
  if r.status <> 'pending' then
    raise exception 'The customer has already paid or started paying this, so it can''t be withdrawn.' using errcode = 'P0001', hint = 'not_pending';
  end if;
  update public.payment_requests set status = 'cancelled', updated_at = now() where id = r.id and status = 'pending';
  perform public._local_booking_log(p_booking, 'extra_withdrawn', null, x.kind, v_me, null, v_me, 'coordinator', x.title);
  perform public.local_tasker_audit('local_booking_extra_withdrawn', 'booking', p_booking::text, null,
    jsonb_build_object('extra_id', x.id, 'payment_request_id', r.id), v_me);
  return jsonb_build_object('cancelled', true, 'changed', true);
end $$;
revoke all on function public.local_booking_cancel_extra(uuid, uuid) from public, anon;
grant execute on function public.local_booking_cancel_extra(uuid, uuid) to authenticated, service_role;

-- 5. coordinator read -----------------------------------------------------------------------------------------------------
create or replace function public.local_booking_extras(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_block text; v_list jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me)
     or not exists (select 1 from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  v_block := public._local_booking_extra_block(p_booking);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'amount', x.amount, 'title', x.title, 'status', r.status,
                                               'created_at', x.created_at, 'can_cancel', r.status = 'pending') order by x.created_at desc), '[]'::jsonb)
    into v_list
    from public.local_booking_extra_costs x join public.payment_requests r on r.id = x.payment_request_id where x.booking_id = p_booking;
  return jsonb_build_object('can_request', v_block is null, 'blocked', v_block, 'room', public._local_booking_extra_room(p_booking), 'items', v_list);
end $$;
revoke all on function public.local_booking_extras(uuid) from public, anon;
grant execute on function public.local_booking_extras(uuid) to authenticated, service_role;

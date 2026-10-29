-- Stage 5D-1: the customer sees the quote, approves or declines it, and the payment requests are created.
-- Additive and re-runnable. Rollback: stage-5d1-rollback.sql.
-- Needs stage-5a1, 5a2, 5b, 5c1, 5c2 AND the Job Room money SQL (messaging-step6.sql, messaging-step7.sql) first.
-- Run in the Supabase SQL editor (select all, Run). Run it twice; the second run must show no error.
--
-- What it does
--   0. Pre-flight: stops with "nothing was changed" if a piece it depends on is missing.
--   1. local_booking_quote_decisions  one immutable row per answered quote: approved or declined, who, when, the reason.
--   2. local_booking_quote_requests   which payment_requests rows were made from which quote line (so they can be
--        shown, and cancelled if the quote is replaced before anything was paid). No browser grants.
--   3. local_booking_customer_quotes(p_booking default null)   customer rpc, read only: the customer's OWN Local Tasker
--        bookings that have a quote, with the lines, the total, the decision and how far the payments are.
--        Never returns coordinator, confirmation, call, second-check or request ids.
--   4. local_booking_decide_quote(p_booking, p_version, p_request_id, p_decision, p_reason)   customer rpc, the ONLY way to
--        approve or decline. The customer must be the booking's customer, the quote must be the CURRENT one and the
--        version they saw. Approve = the booking goes to quote_approved AND one payment request per quote line is created in
--        the booking's Job Room (service fee 'full_payment', transport 'transport', materials 'materials' when the
--        payment_requests table allows it, otherwise 'additional_cost', other 'additional_cost'). All in ONE transaction:
--        if the chat cards cannot be posted, nothing is approved. Decline = the booking goes to quote_declined, no money
--        object is created. The customer pays through the existing Job Room payment path, never here.
--   5. A quote that is replaced (a new quote, or the booking goes back to the Local Tasker) cancels its UNPAID requests.
--   6. _local_booking_transition (5C-2) gets one more refusal: a booking cannot go back to the Local Tasker for a new
--        confirmation while a payment for the current quote has started or is held (money must never be stranded).
--   7. local_booking_quote (coordinator read, 5C-2) now also returns the customer's decision and reason for the current
--        quote, so the coordinator can revise it.
-- Writes NO column of bookings, no escrow, wallet, release-code or payment_intents object. payment_requests rows are only
-- INSERTED (status pending) and, for a replaced quote, set to cancelled. Regular bookings are not involved.

-- 0. Pre-flight --------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.local_booking_quotes') is null or to_regprocedure('public.local_booking_send_quote(uuid,uuid,numeric,numeric,numeric,text,text,text)') is null then
    raise exception 'Run stage-5c2-core.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.payment_requests') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'kind') then
    raise exception 'Run messaging-step6.sql first (payment_requests.kind is missing). Nothing was changed.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.payment_requests'::regclass and contype = 'c'
                 and pg_get_constraintdef(oid) ~ 'processing') then
    raise exception 'Run messaging-step7.sql first (payment_requests has no "processing" status). Nothing was changed.';
  end if;
  if to_regclass('public.message_threads') is null or to_regclass('public.messages') is null then
    raise exception 'The Job Room tables (message_threads, messages) were not found. Nothing was changed.';
  end if;
  if not ('quote_approved' = any (public._local_booking_allowed_next('quote_sent', 'customer')))
     or not ('quote_declined' = any (public._local_booking_allowed_next('quote_sent', 'customer'))) then
    raise exception 'The Stage 5A state machine does not let the customer approve or decline from quote_sent. Send the text of _local_booking_allowed_next. Nothing was changed.';
  end if;
end $$;

-- 1. decisions ---------------------------------------------------------------------------------------
create table if not exists public.local_booking_quote_decisions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  quote_id uuid not null unique references public.local_booking_quotes(id) on delete cascade,   -- a quote is answered once
  customer_id uuid not null,
  request_id uuid not null unique,                                                                -- makes a retried tap harmless
  decision text not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint lbqd_decision_check check (decision in ('approved', 'declined')),
  constraint lbqd_reason_check check (char_length(coalesce(reason, '')) <= 300)
);
alter table public.local_booking_quote_decisions enable row level security;
drop policy if exists lt_quote_decisions_admin_read on public.local_booking_quote_decisions;
create policy lt_quote_decisions_admin_read on public.local_booking_quote_decisions for select to authenticated using (public.is_local_tasker_admin());
revoke all on public.local_booking_quote_decisions from public, anon, authenticated;
grant select on public.local_booking_quote_decisions to authenticated;          -- RLS: administrators only
grant select, insert, update on public.local_booking_quote_decisions to service_role;

create or replace function public.local_booking_quote_decisions_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 then return OLD; end if;     -- only the booking / quote cascade
    raise exception 'A recorded decision cannot be deleted.' using errcode = 'P0001';
  end if;
  raise exception 'A recorded decision cannot be edited.' using errcode = 'P0001', hint = 'immutable';
end $$;
drop trigger if exists lbqd_guard on public.local_booking_quote_decisions;
create trigger lbqd_guard before update or delete on public.local_booking_quote_decisions
  for each row execute function public.local_booking_quote_decisions_guard();
revoke all on function public.local_booking_quote_decisions_guard() from public, anon, authenticated;

-- 2. which payment request came from which quote line -----------------------------------------------------
create table if not exists public.local_booking_quote_requests (
  quote_id uuid not null references public.local_booking_quotes(id) on delete cascade,
  line_key text not null,
  payment_request_id uuid not null unique references public.payment_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (quote_id, line_key),
  constraint lbqr_key_check check (line_key in ('service_fee', 'transport', 'materials', 'other'))
);
alter table public.local_booking_quote_requests enable row level security;
revoke all on public.local_booking_quote_requests from public, anon, authenticated;
grant select, insert, update, delete on public.local_booking_quote_requests to service_role;

-- 3. helpers (no browser access) ----------------------------------------------------------------------------
-- The Job Room kind for a quote line. 'materials' only if payment_requests accepts it (it is not in messaging-step6.sql).
create or replace function public._local_booking_request_kind(p_line text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_line
    when 'service_fee' then 'full_payment'
    when 'transport' then 'transport'
    when 'materials' then case when exists (select 1 from pg_constraint where conrelid = 'public.payment_requests'::regclass and contype = 'c'
                                              and pg_get_constraintdef(oid) ~ '''materials''') then 'materials' else 'additional_cost' end
    else 'additional_cost' end
$$;

-- The Job Room for this booking and customer: the existing one, or a new one.
create or replace function public._local_booking_thread(p_booking uuid, p_customer uuid, p_tasker uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select t.id into v_id from public.message_threads t
   where t.context_type = 'booking' and t.context_id::text = p_booking::text and t.customer_id = p_customer and t.tasker_id = p_tasker
   order by t.last_message_at desc nulls last limit 1;
  if v_id is not null then return v_id; end if;
  -- %L keeps the booking id an untyped literal, so this works whether context_id is uuid or text
  execute format('insert into public.message_threads (customer_id, tasker_id, context_type, context_id, last_message_at, customer_unread, tasker_unread) '
                 'values (%L, %L, %L, %L, now(), 0, 0) returning id', p_customer, p_tasker, 'booking', p_booking) into v_id;
  return v_id;
end $$;

-- One pending payment_request per quote line, with its chat card. Returns the number created.
create or replace function public._local_booking_create_requests(q public.local_booking_quotes, p_customer uuid, p_tasker uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_thread uuid; l jsonb; v_id uuid; v_kind text; v_reason text; n int := 0; v_pay text;
begin
  select payment_status into v_pay from public.bookings where id = q.booking_id;
  if v_pay is not null and v_pay <> 'unpaid' and v_pay <> 'pending' then
    raise exception 'This booking already has a payment on record. Please contact support.' using errcode = 'P0001', hint = 'already_paid';
  end if;
  v_thread := public._local_booking_thread(q.booking_id, p_customer, p_tasker);
  if exists (select 1 from public.payment_requests r where r.thread_id = v_thread and coalesce(r.kind, 'payment') in ('payment', 'full_payment')
                and r.status in ('pending', 'processing', 'paid', 'approved', 'accepted')) then
    raise exception 'This booking already has a main payment request. Please contact support.' using errcode = 'P0001', hint = 'already_paid';
  end if;

  for l in select value from jsonb_array_elements(public._local_booking_quote_lines(q)) loop
    if (l ->> 'amount')::numeric < 100 or (l ->> 'amount')::numeric > 10000000 then
      raise exception 'An amount in this quote cannot be paid online.' using errcode = 'P0001', hint = 'bad_input';
    end if;
    v_kind := public._local_booking_request_kind(l ->> 'key');
    v_reason := left(case l ->> 'key'
      when 'service_fee' then 'Service fee for your Local Tasker booking (quote version ' || q.version || ')'
      when 'transport' then 'Transport (quote version ' || q.version || ')'
      when 'materials' then 'Materials (quote version ' || q.version || ')'
      else coalesce(nullif(btrim(q.other_label), ''), 'Other agreed cost') || ' (quote version ' || q.version || ')' end, 300);
    insert into public.payment_requests (thread_id, tasker_id, customer_id, amount, kind, reason, status)
    values (v_thread, p_tasker, p_customer, (l ->> 'amount')::numeric, v_kind, v_reason, 'pending')
    returning id into v_id;
    insert into public.local_booking_quote_requests (quote_id, line_key, payment_request_id) values (q.id, l ->> 'key', v_id);
    -- the card in the Job Room (same shape the tasker's own request posts). Required: a request with no card cannot be paid.
    insert into public.messages (thread_id, sender_id, receiver_id, body, type, payment_request_id, flagged)
    values (v_thread, p_tasker, p_customer, 'PAYMENT_REQUEST:' || v_id || ':' || (l ->> 'amount')::numeric::bigint, 'payment_request', v_id, false);
    n := n + 1;
  end loop;

  update public.message_threads
     set last_message = 'Quote approved: ₦' || to_char(q.total, 'FM999,999,999'), last_message_at = now(),
         customer_unread = coalesce(customer_unread, 0) + n
   where id = v_thread;
  return n;
end $$;
revoke all on function public._local_booking_request_kind(text), public._local_booking_thread(uuid, uuid, uuid),
  public._local_booking_create_requests(public.local_booking_quotes, uuid, uuid) from public, anon, authenticated;
grant execute on function public._local_booking_request_kind(text), public._local_booking_thread(uuid, uuid, uuid),
  public._local_booking_create_requests(public.local_booking_quotes, uuid, uuid) to service_role;

-- 4. the customer's read -----------------------------------------------------------------------------------
create or replace function public.local_booking_customer_quotes(p_booking uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); r record; q public.local_booking_quotes; d public.local_booking_quote_decisions;
  v_out jsonb := '[]'::jsonb; v_item jsonb; v_pay jsonb; v_name text;
begin
  if v_me is null then raise exception 'Please log in.' using errcode = 'P0001', hint = 'not_found'; end if;
  for r in
    select s.booking_id, s.lt_status, s.tasker_user_id from public.local_booking_state s
      join public.bookings b on b.id = s.booking_id
     where b.customer_id = v_me and s.lt_status in ('quote_sent', 'quote_approved', 'quote_declined')
       and (p_booking is null or s.booking_id = p_booking)
     order by s.updated_at desc limit 50
  loop
    select * into q from public.local_booking_quotes where booking_id = r.booking_id and superseded_at is null;
    if not found then continue; end if;
    select * into d from public.local_booking_quote_decisions where quote_id = q.id;
    select u.name into v_name from public.users u where u.id = r.tasker_user_id;
    select coalesce(jsonb_agg(jsonb_build_object('key', l.line_key, 'amount', pr.amount,
             'status', case pr.status when 'approved' then 'pending' when 'accepted' then 'processing' else pr.status end)
             order by case l.line_key when 'service_fee' then 1 when 'transport' then 2 when 'materials' then 3 else 4 end), '[]'::jsonb)
      into v_pay
      from public.local_booking_quote_requests l join public.payment_requests pr on pr.id = l.payment_request_id
     where l.quote_id = q.id;
    v_item := jsonb_build_object(
      'booking_id', r.booking_id, 'lt_status', r.lt_status, 'tasker_name', coalesce(v_name, 'Your Local Tasker'),
      'quote', jsonb_build_object('version', q.version, 'total', q.total, 'note', q.note, 'created_at', q.created_at,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('key', x ->> 'key', 'label', x ->> 'label', 'amount', (x ->> 'amount')::numeric,
                                                              'held_in_escrow', (x ->> 'held_in_escrow')::boolean)), '[]'::jsonb)
                    from jsonb_array_elements(public._local_booking_quote_lines(q)) x)),
      'decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'reason', d.reason, 'at', d.created_at) end,
      'payments', v_pay);
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  return v_out;
end $$;
revoke all on function public.local_booking_customer_quotes(uuid) from public, anon;
grant execute on function public.local_booking_customer_quotes(uuid) to authenticated, service_role;

-- 5. approve or decline (the customer's rpc) ---------------------------------------------------------------------
create or replace function public.local_booking_decide_quote(p_booking uuid, p_version integer, p_request_id uuid, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; q public.local_booking_quotes; old public.local_booking_quote_decisions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_n int := 0; v_id uuid;
begin
  if v_me is null or p_booking is null then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into s from public.local_booking_state where booking_id = p_booking for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into b from public.bookings where id = p_booking;
  if b.customer_id is distinct from v_me then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null or p_version is null or p_decision is null or p_decision not in ('approved', 'declined') then
    raise exception 'That answer is not valid.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'Keep the reason to 300 characters.' using errcode = 'P0001', hint = 'bad_input'; end if;

  select * into old from public.local_booking_quote_decisions where request_id = p_request_id;
  if found then
    if old.booking_id <> p_booking or old.customer_id <> v_me then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
    return jsonb_build_object('decision', old.decision, 'lt_status', s.lt_status, 'changed', false, 'duplicate', true);
  end if;

  if s.lt_status <> 'quote_sent' then
    raise exception 'This quote has already been answered or has been replaced. Reload to see the latest.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  select * into q from public.local_booking_quotes where booking_id = p_booking and superseded_at is null;
  if not found then raise exception 'There is no quote to answer.' using errcode = 'P0001', hint = 'invalid_transition'; end if;
  if q.version <> p_version then
    raise exception 'The quote was updated. Please read the new one before you answer.' using errcode = 'P0001', hint = 'quote_changed';
  end if;

  insert into public.local_booking_quote_decisions (booking_id, quote_id, customer_id, request_id, decision, reason)
  values (p_booking, q.id, v_me, p_request_id, p_decision, v_reason) returning id into v_id;

  if p_decision = 'approved' then
    perform public._local_booking_transition(p_booking, 'quote_approved', v_me, 'customer', null);
    v_n := public._local_booking_create_requests(q, v_me, s.tasker_user_id);
  else
    perform public._local_booking_transition(p_booking, 'quote_declined', v_me, 'customer', v_reason);
  end if;

  perform public._local_booking_log(p_booking, 'quote_decision', null, null, s.coordinator_id, null, v_me, 'customer',
    'Quote version ' || q.version || ' ' || p_decision);
  perform public.local_tasker_audit('local_booking_quote_decision', 'booking', p_booking::text, null,
    jsonb_build_object('decision_id', v_id, 'quote_id', q.id, 'version', q.version, 'decision', p_decision, 'total', q.total, 'requests_created', v_n), v_me);

  return jsonb_build_object('decision', p_decision, 'lt_status', case when p_decision = 'approved' then 'quote_approved' else 'quote_declined' end,
    'version', q.version, 'total', q.total, 'requests_created', v_n, 'changed', true, 'duplicate', false);
end $$;
revoke all on function public.local_booking_decide_quote(uuid, integer, uuid, text, text) from public, anon;
grant execute on function public.local_booking_decide_quote(uuid, integer, uuid, text, text) to authenticated, service_role;

-- 6. a replaced quote cancels its unpaid requests -----------------------------------------------------------------
create or replace function public.local_booking_quotes_cancel_requests() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.superseded_at is not null and OLD.superseded_at is null then
    update public.payment_requests set status = 'cancelled'
     where id in (select payment_request_id from public.local_booking_quote_requests where quote_id = NEW.id)
       and status in ('pending', 'failed', 'approved');
  end if;
  return NEW;
end $$;
drop trigger if exists lbq_cancel_requests on public.local_booking_quotes;
create trigger lbq_cancel_requests after update of superseded_at on public.local_booking_quotes
  for each row execute function public.local_booking_quotes_cancel_requests();
revoke all on function public.local_booking_quotes_cancel_requests() from public, anon, authenticated;

-- 7. the state machine (replaces the 5C-2 function, same signature) ------------------------------------------------
-- Only change: going back to the Local Tasker is refused while a payment for the current quote has started or is held.
create or replace function public._local_booking_transition(p_booking uuid, p_to text, p_actor uuid, p_role text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.local_booking_state; b public.bookings; v_note text := nullif(btrim(coalesce(p_note, '')), '');
        c public.local_booking_confirmations;
begin
  select * into s from public.local_booking_state where booking_id = p_booking for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'The note is too long.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if p_to is null or p_to not in ('assigned', 'awaiting_tasker_confirmation', 'tasker_confirmed', 'tasker_declined',
                                  'quote_sent', 'quote_approved', 'quote_declined') then
    raise exception 'Unknown status.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select * into b from public.bookings where id = p_booking;
  if not public._local_booking_is_open(b.status) or b.status = 'disputed' then
    raise exception 'This booking is closed.' using errcode = 'P0001', hint = 'booking_closed';
  end if;
  if public.job_booking_frozen(p_booking) then
    raise exception 'A problem report is open on this booking.' using errcode = 'P0001', hint = 'dispute_open';
  end if;
  if s.lt_status = p_to then return jsonb_build_object('lt_status', s.lt_status, 'changed', false); end if;
  if not (p_to = any (public._local_booking_allowed_next(s.lt_status, p_role))) then
    raise exception 'That step is not allowed from "%".', s.lt_status using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if p_to in ('tasker_confirmed', 'tasker_declined') and coalesce(current_setting('st.lt_capture', true), '') <> '1' then
    raise exception 'The Local Tasker''s answer must be recorded from a call.' using errcode = 'P0001', hint = 'use_confirmation';
  end if;
  if p_to = 'quote_sent' then
    select * into c from public.local_booking_confirmations
     where booking_id = p_booking and outcome = 'confirmed' and superseded_at is null and tasker_user_id = s.tasker_user_id
     order by created_at desc limit 1;
    if not found then
      raise exception 'The Local Tasker''s confirmation must be recorded before a quote is sent.' using errcode = 'P0001', hint = 'confirmation_required';
    end if;
    if c.second_check_status not in ('off', 'passed') then
      raise exception 'An administrator call-back to the Local Tasker is still needed before a quote is sent.' using errcode = 'P0001', hint = 'second_check_pending';
    end if;
    if not exists (select 1 from public.local_booking_quotes q where q.booking_id = p_booking and q.superseded_at is null and q.confirmation_id = c.id)
       or coalesce(current_setting('st.lt_quote', true), '') <> '1' then
      raise exception 'Build the quote from the Local Tasker''s confirmed price.' using errcode = 'P0001', hint = 'use_quote';
    end if;
  end if;
  if p_to = 'awaiting_tasker_confirmation' then
    -- 5D-1: never strand money. Once a payment for the current quote has started or is held, the booking cannot be re-quoted here.
    if exists (select 1 from public.local_booking_quotes q
                 join public.local_booking_quote_requests l on l.quote_id = q.id
                 join public.payment_requests r on r.id = l.payment_request_id
                where q.booking_id = p_booking and q.superseded_at is null and r.status in ('processing', 'paid', 'accepted')) then
      raise exception 'The customer has already started paying this quote, so it cannot be sent back for a new price. Contact an administrator.'
        using errcode = 'P0001', hint = 'payment_started';
    end if;
    update public.local_booking_confirmations set superseded_at = now()
     where booking_id = p_booking and superseded_at is null and outcome in ('confirmed', 'declined');
    update public.local_booking_quotes set superseded_at = now() where booking_id = p_booking and superseded_at is null;
  end if;
  update public.local_booking_state set lt_status = p_to, updated_at = now() where booking_id = p_booking;
  perform public._local_booking_log(p_booking, 'status_changed', s.lt_status, p_to, s.coordinator_id, null, p_actor, p_role, v_note);
  return jsonb_build_object('lt_status', p_to, 'changed', true);
end $$;
revoke all on function public._local_booking_transition(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public._local_booking_transition(uuid, text, uuid, text, text) to service_role;

-- 8. the coordinator's read (replaces the 5C-2 function, same signature): adds the customer's decision --------------------
create or replace function public.local_booking_quote(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state; c public.local_booking_confirmations; q public.local_booking_quotes; d public.local_booking_quote_decisions;
        v_cur jsonb; v_conf jsonb; v_hist jsonb;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into c from public.local_booking_confirmations
   where booking_id = p_booking and outcome = 'confirmed' and superseded_at is null and tasker_user_id = s.tasker_user_id order by created_at desc limit 1;
  if found then
    v_conf := jsonb_build_object('service_fee', c.proposed_price, 'transport_amount', c.transport_amount, 'materials_amount', c.materials_amount,
                                 'materials_notes', c.materials_notes, 'second_check_status', c.second_check_status);
  end if;
  select * into q from public.local_booking_quotes where booking_id = p_booking and superseded_at is null;
  if found then
    select * into d from public.local_booking_quote_decisions where quote_id = q.id;
    v_cur := jsonb_build_object('version', q.version, 'service_fee', q.service_fee, 'transport_amount', q.transport_amount, 'materials_amount', q.materials_amount,
                                'other_amount', q.other_amount, 'other_label', q.other_label, 'other_note', q.other_note, 'total', q.total, 'note', q.note,
                                'created_at', q.created_at, 'lines', public._local_booking_quote_lines(q),
                                'decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'reason', d.reason, 'at', d.created_at) end);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('version', h.version, 'total', h.total, 'superseded', h.superseded_at is not null, 'created_at', h.created_at) order by h.version desc), '[]'::jsonb)
    into v_hist from public.local_booking_quotes h where h.booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'confirmed', v_conf, 'current', v_cur, 'history', v_hist);
end $$;
revoke all on function public.local_booking_quote(uuid) from public, anon;
grant execute on function public.local_booking_quote(uuid) to authenticated, service_role;

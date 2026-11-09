-- Stage B2a (quote loop, part 1): when the customer declines a quote they can propose a lower service price. (2026-11-08)
-- Runs in ONE transaction. Undo: b2a-rollback.sql. Built from the exact function text pasted from b2-introspect.sql (only B2a lines added).
-- What it does:
--  1. local_booking_quote_decisions gets one new nullable column counter_amount (with a check). The decisions table stays immutable (its guard only blocks UPDATE/DELETE).
--  2. local_booking_decide_quote takes an optional 6th argument p_counter (whole naira, 100 to 10,000,000, lower than the quote's service fee, only when declining).
--     The OLD 5-argument version is dropped first (two versions with defaults would make the call ambiguous). Same name, same 5 arguments still work.
--  3. A decline tells the coordinator (bell, and phone/email if their settings allow) what to do now, with the proposed price in the text.
--  4. local_booking_customer_quotes and local_booking_quote return counter_amount inside "decision".
-- Not changed: the state machine (_local_booking_allowed_next), payments, escrow, the quote itself, who can answer.
begin;

alter table public.local_booking_quote_decisions add column if not exists counter_amount numeric;
alter table public.local_booking_quote_decisions drop constraint if exists lbqd_counter_check;
alter table public.local_booking_quote_decisions add constraint lbqd_counter_check
  check (counter_amount is null or (decision = 'declined' and counter_amount >= 100 and counter_amount <= 10000000 and counter_amount = round(counter_amount)));

drop function if exists public.local_booking_decide_quote(uuid, integer, uuid, text, text);

CREATE OR REPLACE FUNCTION public.local_booking_decide_quote(p_booking uuid, p_version integer, p_request_id uuid, p_decision text, p_reason text, p_counter numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; q public.local_booking_quotes; old public.local_booking_quote_decisions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_n int := 0; v_id uuid;
  v_counter numeric := p_counter;   -- B2a: the service price the customer proposes when declining (optional)
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
  -- B2a: a proposed price only goes with a decline, and must be a whole naira amount
  if v_counter is not null then
    if p_decision <> 'declined' then raise exception 'A price can only be proposed when you decline the quote.' using errcode = 'P0001', hint = 'bad_input'; end if;
    if v_counter < 100 or v_counter > 10000000 or v_counter <> round(v_counter) then
      raise exception 'Enter a whole amount in naira, at least ₦100.' using errcode = 'P0001', hint = 'bad_input';
    end if;
  end if;

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
  -- B2a: the proposed price is for the service fee (the Local Tasker's price), and has to be lower than it
  if v_counter is not null and v_counter >= q.service_fee then
    raise exception 'The price you propose must be lower than the current service fee of ₦%.', to_char(q.service_fee, 'FM999,999,999') using errcode = 'P0001', hint = 'bad_input';
  end if;

  insert into public.local_booking_quote_decisions (booking_id, quote_id, customer_id, request_id, decision, reason, counter_amount)
  values (p_booking, q.id, v_me, p_request_id, p_decision, v_reason, v_counter) returning id into v_id;

  if p_decision = 'approved' then
    perform public._local_booking_transition(p_booking, 'quote_approved', v_me, 'customer', null);
    v_n := public._local_booking_create_requests(q, v_me, s.tasker_user_id);
  else
    perform public._local_booking_transition(p_booking, 'quote_declined', v_me, 'customer', v_reason);
    -- B2a: tell the coordinator what to do now (a failure here never blocks the customer's answer; _notify swallows errors)
    if s.coordinator_id is not null then
      perform public._notify(s.coordinator_id, 'coordinator_quote_declined', 'Customer declined the quote',
        case when v_counter is not null
             then 'The customer asks for a service price of ₦' || to_char(v_counter, 'FM999,999,999') || ' (the quote had ₦' || to_char(q.service_fee, 'FM999,999,999') || '). Phone the Local Tasker, tell them this price, record their answer, then send a new quote.'
             else 'The customer declined without proposing a price. Ask them what would work, tell the Local Tasker, record the answer, then send a new quote. If the customer will not accept, you can close the booking.' end
          || coalesce(' Their reason: ' || left(v_reason, 120), ''),
        jsonb_build_object('booking_id', p_booking, 'url', '/coordinator-booking.html?id=' || p_booking::text, 'counter_amount', v_counter));
    end if;
  end if;

  perform public._local_booking_log(p_booking, 'quote_decision', null, null, s.coordinator_id, null, v_me, 'customer',
    'Quote version ' || q.version || ' ' || p_decision || coalesce(' (customer proposes ₦' || to_char(v_counter, 'FM999,999,999') || ')', ''));
  perform public.local_tasker_audit('local_booking_quote_decision', 'booking', p_booking::text, null,
    jsonb_build_object('decision_id', v_id, 'quote_id', q.id, 'version', q.version, 'decision', p_decision, 'total', q.total, 'requests_created', v_n, 'counter_amount', v_counter), v_me);

  return jsonb_build_object('decision', p_decision, 'lt_status', case when p_decision = 'approved' then 'quote_approved' else 'quote_declined' end,
    'version', q.version, 'total', q.total, 'requests_created', v_n, 'counter_amount', v_counter, 'changed', true, 'duplicate', false);
end $function$;

revoke all on function public.local_booking_decide_quote(uuid, integer, uuid, text, text, numeric) from public, anon;
grant execute on function public.local_booking_decide_quote(uuid, integer, uuid, text, text, numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.local_booking_customer_quotes(p_booking uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      'decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'reason', d.reason, 'counter_amount', d.counter_amount, 'at', d.created_at) end,
      'payments', v_pay);
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.local_booking_quote(p_booking uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                'decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'reason', d.reason, 'counter_amount', d.counter_amount, 'at', d.created_at) end);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('version', h.version, 'total', h.total, 'superseded', h.superseded_at is not null, 'created_at', h.created_at) order by h.version desc), '[]'::jsonb)
    into v_hist from public.local_booking_quotes h where h.booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'confirmed', v_conf, 'current', v_cur, 'history', v_hist);
end $function$;

notify pgrst, 'reload schema';
commit;

-- Check after running (read only): the 3 functions and the new column
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'local_booking_decide_quote';   -- expect ONE row with p_counter
-- select column_name from information_schema.columns where table_name = 'local_booking_quote_decisions' and column_name = 'counter_amount';

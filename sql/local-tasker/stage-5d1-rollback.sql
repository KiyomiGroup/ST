-- Stage 5D-1 ROLLBACK. Run in the Supabase SQL editor. Safe to run twice.
-- Puts back the 5C-2 versions of _local_booking_transition and local_booking_quote, removes the 5D-1 functions and the
-- trigger that cancels unpaid requests.
-- It does NOT touch payment_requests or chat messages already created from an approved quote: those are money objects
-- and stay. The two record tables (decisions, quote-to-request links) are dropped ONLY if they are empty; otherwise they
-- are kept (rolling back 5C-2 later needs them gone, because they point at local_booking_quotes).

drop trigger if exists lbq_cancel_requests on public.local_booking_quotes;
drop function if exists public.local_booking_quotes_cancel_requests();
drop function if exists public.local_booking_decide_quote(uuid, integer, uuid, text, text);
drop function if exists public.local_booking_customer_quotes(uuid);
drop function if exists public._local_booking_create_requests(public.local_booking_quotes, uuid, uuid);
drop function if exists public._local_booking_thread(uuid, uuid, uuid);
drop function if exists public._local_booking_request_kind(text);

-- 5C-2 version of the state machine
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
    -- 5C-2: a quote built from THIS confirmation, and only through the quote function
    if not exists (select 1 from public.local_booking_quotes q where q.booking_id = p_booking and q.superseded_at is null and q.confirmation_id = c.id)
       or coalesce(current_setting('st.lt_quote', true), '') <> '1' then
      raise exception 'Build the quote from the Local Tasker''s confirmed price.' using errcode = 'P0001', hint = 'use_quote';
    end if;
  end if;
  if p_to = 'awaiting_tasker_confirmation' then
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

-- 5C-2 version of the coordinator read
create or replace function public.local_booking_quote(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); s public.local_booking_state; c public.local_booking_confirmations; q public.local_booking_quotes; v_cur jsonb; v_conf jsonb; v_hist jsonb;
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
    v_cur := jsonb_build_object('version', q.version, 'service_fee', q.service_fee, 'transport_amount', q.transport_amount, 'materials_amount', q.materials_amount,
                                'other_amount', q.other_amount, 'other_label', q.other_label, 'other_note', q.other_note, 'total', q.total, 'note', q.note,
                                'created_at', q.created_at, 'lines', public._local_booking_quote_lines(q));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('version', h.version, 'total', h.total, 'superseded', h.superseded_at is not null, 'created_at', h.created_at) order by h.version desc), '[]'::jsonb)
    into v_hist from public.local_booking_quotes h where h.booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'lt_status', s.lt_status, 'confirmed', v_conf, 'current', v_cur, 'history', v_hist);
end $$;
revoke all on function public.local_booking_quote(uuid) from public, anon;
grant execute on function public.local_booking_quote(uuid) to authenticated, service_role;

do $$
declare n bigint;
begin
  if to_regclass('public.local_booking_quote_requests') is not null then
    execute 'select count(*) from public.local_booking_quote_requests' into n;
    if n = 0 then drop table public.local_booking_quote_requests;
    else raise notice 'local_booking_quote_requests kept (it holds links to payment requests).'; end if;
  end if;
  if to_regclass('public.local_booking_quote_decisions') is not null then
    execute 'select count(*) from public.local_booking_quote_decisions' into n;
    if n = 0 then
      drop table public.local_booking_quote_decisions;
      drop function if exists public.local_booking_quote_decisions_guard();
    else raise notice 'local_booking_quote_decisions kept (it holds customer decisions).'; end if;
  end if;
end $$;

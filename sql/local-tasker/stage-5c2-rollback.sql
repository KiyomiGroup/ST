-- Stage 5C-2 ROLLBACK. Safe to run twice. Restores the two functions exactly as stage-5c1-core.sql defines them,
-- then removes everything 5C-2 added. DELETES every recorded quote (the table is dropped).
-- Run this BEFORE stage-5c1-rollback.sql if you are rolling back both.
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
  -- 5C-1: acceptance and refusal exist only as the result of a recorded call
  if p_to in ('tasker_confirmed', 'tasker_declined') and coalesce(current_setting('st.lt_capture', true), '') <> '1' then
    raise exception 'The Local Tasker''s answer must be recorded from a call.' using errcode = 'P0001', hint = 'use_confirmation';
  end if;
  -- 5C-1: a quote needs a current, valid, confirmed record (and a passed second check if one was asked for)
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
  end if;
  -- 5C-1: sending the booking back for a new answer retires the old record (a changed price needs a new call)
  if p_to = 'awaiting_tasker_confirmation' then
    update public.local_booking_confirmations set superseded_at = now()
     where booking_id = p_booking and superseded_at is null and outcome in ('confirmed', 'declined');
  end if;
  update public.local_booking_state set lt_status = p_to, updated_at = now() where booking_id = p_booking;
  perform public._local_booking_log(p_booking, 'status_changed', s.lt_status, p_to, s.coordinator_id, null, p_actor, p_role, v_note);
  return jsonb_build_object('lt_status', p_to, 'changed', true);
end $$;
revoke all on function public._local_booking_transition(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public._local_booking_transition(uuid, text, uuid, text, text) to service_role;

create or replace function public.local_booking_step(p_booking uuid, p_to text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me)
     or not exists (select 1 from public.local_booking_state s where s.booking_id = p_booking and s.coordinator_id = v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if p_to in ('tasker_confirmed', 'tasker_declined') then
    raise exception 'The Local Tasker''s answer must be recorded from a call.' using errcode = 'P0001', hint = 'use_confirmation';
  end if;
  return public._local_booking_transition(p_booking, p_to, v_me, 'coordinator', p_note);
end $$;
revoke all on function public.local_booking_step(uuid, text, text) from public, anon;
grant execute on function public.local_booking_step(uuid, text, text) to authenticated, service_role;

drop trigger if exists lbq_audit on public.local_booking_quotes;
drop trigger if exists lbq_guard on public.local_booking_quotes;
drop function if exists public.local_booking_quote(uuid);
drop function if exists public.local_booking_send_quote(uuid, uuid, numeric, numeric, numeric, text, text, text);
drop function if exists public._local_booking_quote_lines(public.local_booking_quotes);
drop function if exists public.local_booking_quotes_audit();
drop function if exists public.local_booking_quotes_guard();
drop table if exists public.local_booking_quotes;
-- Audit history written by 5C-2 (local_booking_events kinds quote_*) is append-only and is kept.

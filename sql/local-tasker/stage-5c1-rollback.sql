-- Stage 5C-1 ROLLBACK. Safe to run twice. Restores the two 5A functions exactly as stage-5a2-core.sql defines them,
-- then removes everything 5C-1 added. DELETES every recorded Local Tasker confirmation (the table is dropped).
-- Run this BEFORE stage-5a-rollback.sql if you are rolling back both.
-- (First the 5A function bodies, so nothing refers to the objects dropped below.)
create or replace function public._local_booking_transition(p_booking uuid, p_to text, p_actor uuid, p_role text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.local_booking_state; b public.bookings; v_note text := nullif(btrim(coalesce(p_note, '')), '');
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
  return public._local_booking_transition(p_booking, p_to, v_me, 'coordinator', p_note);
end $$;
revoke all on function public.local_booking_step(uuid, text, text) from public, anon;
grant execute on function public.local_booking_step(uuid, text, text) to authenticated, service_role;

drop trigger if exists lbc_audit on public.local_booking_confirmations;
drop trigger if exists lbc_guard on public.local_booking_confirmations;
drop function if exists public.local_booking_confirmations(uuid);
drop function if exists public.local_booking_second_check(uuid, boolean, text);
drop function if exists public.local_booking_record_confirmation(uuid, uuid, text, text, text, timestamptz, boolean, boolean, numeric, text, numeric, numeric, text, text, text, boolean, boolean);
drop function if exists public.local_booking_confirmations_audit();
drop function if exists public.local_booking_confirmations_guard();
drop table if exists public.local_booking_confirmations;
-- Audit history written by 5C-1 (local_booking_events kinds confirmation_*, second_check_*) is append-only and is kept.

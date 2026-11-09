-- Stage B2c (quote loop, part 3): the customer will not accept, so the coordinator closes the booking. (2026-11-09)
-- Runs in ONE transaction. Undo: b2c-rollback.sql. Built from the exact function text pasted from b2c-introspect.sql (nothing existing is changed).
-- What it does: ONE new function, local_booking_close_declined(booking, request id, note). It REUSES local_booking_cancel (so the cancellation record,
-- the audit row, the timeline line, the Job Room line, the refusal when money is held, and retry safety all stay exactly as they are) and adds two things
-- the plain cancel does not do:
--  1. The task stays closed. Today a cancelled booking makes the trigger _offer_cancel_on_booking put the task back to "open". Here, right after the cancel,
--     the booking's task is set to "cancelled" (only if it is open or in progress). Other cancels (the customer's, the plain coordinator cancel) are NOT changed.
--  2. The customer is told (bell item, type job_update, same type the price answer uses) that the booking was closed and nothing was charged.
-- The Job Room chat closes by itself (trigger chat_close_on_booking on a cancelled booking).
-- Only at "quote declined" or "Local Tasker declined". The reason stored is 'other' with the note "Customer will not accept the price" (the reason list has no
-- better key and is not changed). Same rules as the plain cancel: only your own booking, refused when money is held or paid, when a problem report is open, or when closed.
begin;

create or replace function public.local_booking_close_declined(p_booking uuid, p_request_id uuid, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid(); s public.local_booking_state; b public.bookings; v_res jsonb; v_thread uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_task boolean := false;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me for update;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_request_id is null then raise exception 'Something went wrong. Reload the page and try again.' using errcode = 'P0001', hint = 'bad_input'; end if;
  if v_note is not null and char_length(v_note) > 250 then
    raise exception 'Keep the note to 250 characters.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  if s.lt_status not in ('quote_declined', 'tasker_declined') then
    raise exception 'This booking can only be closed this way after the customer declined the quote or the Local Tasker declined.' using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  -- the plain coordinator cancel does all the checks and the cancelling (and raises its own hints: booking_closed, dispute_open, money_held, ...)
  v_res := public.local_booking_cancel(p_booking, p_request_id, 'other', left('Customer will not accept the price' || coalesce(': ' || v_note, ''), 300));
  if coalesce((v_res ->> 'changed')::boolean, false) is not true then
    return v_res || jsonb_build_object('task_closed', false);          -- a retry of the same request: nothing more to do
  end if;

  select * into b from public.bookings where id = p_booking;
  select id into v_thread from public.message_threads where context_type = 'booking' and context_id::text = p_booking::text
   order by last_message_at desc nulls last limit 1;

  -- the task stays closed (the trigger _offer_cancel_on_booking has just put it back to open)
  if b.task_id is not null then
    begin
      update public.tasks set status = 'cancelled' where id::text = b.task_id::text and status in ('open', 'in_progress');
      v_task := found;
    exception when others then
      raise warning 'B2c: could not close task % (%)', b.task_id, sqlerrm;      -- never block the close itself
    end;
  end if;

  -- tell the customer (a failure here never blocks the close; _notify swallows errors)
  if b.customer_id is not null then
    perform public._notify(b.customer_id, 'job_update', 'Your booking was closed',
      'We could not agree a price with the Local Tasker, so your booking was closed. Nothing was charged.'
        || case when v_task then ' Your task is closed too. Post it again if you still need help.' else '' end,
      jsonb_build_object('booking_id', p_booking, 'thread_id', v_thread));
  end if;

  return v_res || jsonb_build_object('task_closed', v_task);
end $function$;

revoke all on function public.local_booking_close_declined(uuid, uuid, text) from public, anon;
grant execute on function public.local_booking_close_declined(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Check after running (read only): expect ONE row
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'local_booking_close_declined';

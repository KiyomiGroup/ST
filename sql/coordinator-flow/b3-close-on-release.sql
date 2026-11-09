-- Stage B3: the Job Room chat closes when the payment is released (Local Tasker bookings). RUN ONCE in the Supabase SQL editor (one transaction).
-- Built from the introspect results of 2026-11-09 (b3-introspect.sql). ADDITIVE: one function and one trigger; nothing existing is changed.
-- Undo: b3-rollback.sql.
--
-- Why: the chat already closes when bookings.status becomes 'completed' or 'cancelled' (trigger chat_close_on_booking). Whether
-- _release_escrow (called by local_booking_submit_code) also sets status = 'completed' was NOT in the pasted results, so this does not
-- rely on it: when payment_status becomes 'released' on a Local Tasker booking, it writes ONE closing line (type 'system', like the other
-- job lines) and sets message_threads.closed_at (only if still empty). If the room was already closed, only the line is skipped.
-- Any error inside is swallowed with a warning: it can never undo or block a release.

begin;

create or replace function public._lt_close_chat_on_release()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  s public.local_booking_state; v_thread uuid; v_closed timestamptz; v_body text;
begin
  if NEW.payment_status::text = 'released' and OLD.payment_status::text is distinct from 'released' then
    begin
      select * into s from public.local_booking_state where booking_id = NEW.id;
      if s.booking_id is null or s.tasker_user_id is null then return null; end if;            -- not a Local Tasker booking
      select t.id, t.closed_at into v_thread, v_closed from public.message_threads t
       where t.context_type = 'booking' and t.context_id::text = NEW.id::text and t.customer_id = NEW.customer_id and t.tasker_id = s.tasker_user_id
       order by t.last_message_at desc nulls last limit 1;
      if v_thread is null then return null; end if;
      if v_closed is null then
        v_body := 'Payment released. Thank you for using StreetTasker. This chat is now closed.';
        insert into public.messages (thread_id, sender_id, receiver_id, body, type, flagged)
        values (v_thread, s.tasker_user_id, NEW.customer_id, v_body, 'system', false);
        update public.message_threads
           set last_message = left(v_body, 80), last_message_at = now(), customer_unread = coalesce(customer_unread, 0) + 1,
               closed_at = coalesce(closed_at, now())
         where id = v_thread;
      end if;
    exception when others then
      raise warning '_lt_close_chat_on_release failed: %', sqlerrm;
    end;
  end if;
  return null;
end
$fn$;

drop trigger if exists lt_close_chat_on_release on public.bookings;
create trigger lt_close_chat_on_release
  after update of payment_status on public.bookings
  for each row execute function public._lt_close_chat_on_release();

commit;

-- Check (expect one row, true):
select count(*) = 1 as trigger_ok from pg_trigger where tgname = 'lt_close_chat_on_release' and not tgisinternal;

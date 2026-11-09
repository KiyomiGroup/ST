-- Stage N1: notifications for coordinators and the customer chat. ADDITIVE. Run once in the Supabase SQL editor.
-- Written from the introspect results of 2026-11-08. NOT run on any Postgres: no database was available when it was written.
-- Undo: n1-rollback.sql.
--
-- What it does
--  1. A new booking (or a booking moved to you) creates a "New booking" notification for the coordinator in charge,
--     with the steps to follow. Source: local_booking_state (coordinator_id set for the first time or changed).
--  2. A message from the customer in a Local Tasker booking chat notifies the coordinator in charge. Today the customer's
--     notification goes to the Local Tasker's user id (nobody logs in as them), so the coordinator never heard about it.
--  3. A message the coordinator sends (coordinator_send_message) notifies the customer. Today nothing does.
-- Phone push and email: these rows go into public.notifications, the same table the site already uses. Whether a row is also
-- pushed and emailed depends on the existing webhook / Edge Functions (not in the zip): see n1b-introspect.sql.
-- Message text is never copied into a notification (it may be emailed, and chat can hold private details).

begin;

-- Insert helper. Like _notify, but a failure is logged as a WARNING instead of vanishing.
create or replace function public._co_notify(p_user uuid, p_type text, p_title text, p_msg text, p_data jsonb)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, type, title, message, data, is_read)
  values (p_user, p_type, p_title, p_msg, p_data, false);
exception when others then
  raise warning '_co_notify failed (%): %', p_type, sqlerrm;
end $f$;
revoke all on function public._co_notify(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- 1. New booking for the coordinator
create or replace function public.local_booking_notify_coordinator()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  b public.bookings; v_title text; v_first text; v_moved boolean;
begin
  begin
    if NEW.coordinator_id is null then return NEW; end if;
    if TG_OP = 'UPDATE' and OLD.coordinator_id is not distinct from NEW.coordinator_id then return NEW; end if;
    v_moved := (TG_OP = 'UPDATE' and OLD.coordinator_id is not null);

    -- the same coordinator for the same booking is told once
    if exists (select 1 from public.notifications n
                where n.user_id = NEW.coordinator_id and n.type = 'coordinator_new_booking'
                  and n.data ->> 'booking_id' = NEW.booking_id::text and n.created_at > now() - interval '10 minutes') then
      return NEW;
    end if;

    select * into b from public.bookings where id = NEW.booking_id;
    if not found then return NEW; end if;
    select coalesce(
             nullif(btrim(coalesce((select to_jsonb(t) ->> 'title' from public.tasks t where t.id = b.task_id), '')), ''),
             nullif(btrim(coalesce((select to_jsonb(sv) ->> 'service_name' from public.services sv where sv.id = b.service_id), '')), ''),
             'a Local Tasker booking') into v_title;
    select nullif(split_part(btrim(coalesce(u.name, '')), ' ', 1), '') into v_first from public.users u where u.id = b.customer_id;

    perform public._co_notify(
      NEW.coordinator_id, 'coordinator_new_booking',
      case when v_moved then 'A booking was moved to you' else 'New booking: accept it now' end,
      coalesce(v_first, 'A customer') || ' booked ' || v_title || '. Open it and do this in order: '
        || '1) Accept the application. '
        || '2) Chat with the customer first: confirm the date, price, place and every detail. '
        || '3) While you chat, phone the Local Tasker to confirm. '
        || '4) Record the Local Tasker''s answer, then send the quote.',
      jsonb_build_object('booking_id', NEW.booking_id, 'url', '/coordinator-booking.html?id=' || NEW.booking_id::text));
    return NEW;
  exception when others then
    raise warning 'local_booking_notify_coordinator failed: %', sqlerrm;
  end;
  return NEW;
end $f$;

drop trigger if exists lbs_notify_coordinator on public.local_booking_state;
create trigger lbs_notify_coordinator after insert or update of coordinator_id on public.local_booking_state
  for each row execute function public.local_booking_notify_coordinator();

-- 2. Customer writes in a Local Tasker booking chat -> tell the coordinator in charge
create or replace function public.local_chat_notify_coordinator()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  th public.message_threads; s public.local_booking_state; b public.bookings; v_first text;
begin
  begin
    if NEW.type is not null and NEW.type not in ('text', 'image', 'video', 'file', 'location') then return NEW; end if;
    select * into th from public.message_threads where id = NEW.thread_id;
    if not found or th.context_type is distinct from 'booking' then return NEW; end if;
    select * into b from public.bookings where id::text = th.context_id::text;
    if not found or b.customer_id is distinct from NEW.sender_id then return NEW; end if;     -- only the customer's own messages
    select * into s from public.local_booking_state where booking_id = b.id;
    if not found or s.coordinator_id is null then return NEW; end if;                          -- not a Local Tasker booking
    if th.tasker_id is distinct from s.tasker_user_id then return NEW; end if;

    -- one unread alert per booking: a busy chat does not flood the phone
    if exists (select 1 from public.notifications n
                where n.user_id = s.coordinator_id and n.type = 'coordinator_chat_message' and n.is_read = false
                  and n.data ->> 'booking_id' = b.id::text) then
      return NEW;
    end if;
    select nullif(split_part(btrim(coalesce(u.name, '')), ' ', 1), '') into v_first from public.users u where u.id = b.customer_id;
    perform public._co_notify(
      s.coordinator_id, 'coordinator_chat_message',
      'New message from ' || coalesce(v_first, 'the customer'),
      'Open the chat to read and reply.',
      jsonb_build_object('booking_id', b.id, 'thread_id', th.id, 'url', '/coordinator-chat.html?booking=' || b.id::text));
    return NEW;
  exception when others then
    raise warning 'local_chat_notify_coordinator failed: %', sqlerrm;
  end;
  return NEW;
end $f$;

drop trigger if exists messages_notify_coordinator on public.messages;
create trigger messages_notify_coordinator after insert on public.messages
  for each row execute function public.local_chat_notify_coordinator();

-- 3. Coordinator writes to the customer -> tell the customer (same type the site already uses: new_message)
create or replace function public.local_chat_notify_customer()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  m record; v_name text;
begin
  begin
    select mm.thread_id, mm.receiver_id into m from public.messages mm where mm.id::text = NEW.message_id;
    if not found or m.receiver_id is null then return NEW; end if;
    if exists (select 1 from public.notifications n
                where n.user_id = m.receiver_id and n.type = 'new_message' and n.is_read = false
                  and n.data ->> 'thread_id' = m.thread_id::text) then
      return NEW;
    end if;
    select coalesce(nullif(btrim(coalesce(to_jsonb(c) ->> 'display_name', '')), ''), 'Your coordinator') into v_name
      from public.coordinators c where c.user_id = NEW.coordinator_id;
    perform public._co_notify(
      m.receiver_id, 'new_message',
      'New message from ' || coalesce(v_name, 'your coordinator'),
      'Open the conversation to read and reply.',
      jsonb_build_object('thread_id', m.thread_id, 'sender_id', NEW.coordinator_id));
    return NEW;
  exception when others then
    raise warning 'local_chat_notify_customer failed: %', sqlerrm;
  end;
  return NEW;
end $f$;

drop trigger if exists cma_notify_customer on public.coordinator_message_authors;
create trigger cma_notify_customer after insert on public.coordinator_message_authors
  for each row execute function public.local_chat_notify_customer();

commit;

-- Check after running (read-only): both lists should show the three triggers.
-- select tgname, tgrelid::regclass from pg_trigger where tgname in ('lbs_notify_coordinator','messages_notify_coordinator','cma_notify_customer');
-- Then book a Local Tasker test service as a customer and look at: select type,title,created_at from notifications order by created_at desc limit 5;

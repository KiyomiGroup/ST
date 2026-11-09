-- Undo n1-notify-coordinator.sql. Notifications already created stay (they are only messages).
begin;
drop trigger if exists lbs_notify_coordinator on public.local_booking_state;
drop trigger if exists messages_notify_coordinator on public.messages;
drop trigger if exists cma_notify_customer on public.coordinator_message_authors;
drop function if exists public.local_booking_notify_coordinator();
drop function if exists public.local_chat_notify_coordinator();
drop function if exists public.local_chat_notify_customer();
drop function if exists public._co_notify(uuid, text, text, text, jsonb);
commit;

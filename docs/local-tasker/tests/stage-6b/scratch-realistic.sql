-- SCRATCH ONLY. Imitates two behaviours seen in the owner's REAL project test run (2026-10-29), so the 6B tests are proven to pass with them:
--  1. a trigger on messages that already updates the thread preview and the receiver's unread count;
--  2. a payment-request card posted into a thread when it is created.
create or replace function public._scratch_msg_trigger() returns trigger language plpgsql as $$
begin
  update public.message_threads set last_message = left(new.body, 80), last_message_at = now(),
         customer_unread = case when new.receiver_id = customer_id then coalesce(customer_unread, 0) + 1 else customer_unread end
   where id = new.thread_id;
  return new;
end $$;
drop trigger if exists scratch_msg_after on public.messages;
create trigger scratch_msg_after after insert on public.messages for each row execute function public._scratch_msg_trigger();

create or replace function public._scratch_thread_card() returns trigger language plpgsql as $$
begin
  insert into public.messages (thread_id, sender_id, receiver_id, body, type)
  values (new.id, new.tasker_id, new.customer_id, 'PAYMENT_REQUEST:' || gen_random_uuid()::text || ':15000', 'payment_request');
  return new;
end $$;
drop trigger if exists scratch_thread_card on public.message_threads;
create trigger scratch_thread_card after insert on public.message_threads for each row execute function public._scratch_thread_card();

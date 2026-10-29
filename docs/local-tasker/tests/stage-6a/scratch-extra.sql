-- SCRATCH ONLY (stage 6A). Load AFTER docs/local-tasker/tests/stage-5d3b/scratch-scaffold.sql and BEFORE stage-6a-core.sql.
-- The scaffold's message_threads / messages are STAND-INS without row level security. The REAL tables have RLS and party policies
-- (messaging-step6/7, NOT in this session's upload). This file imitates only what 6A needs to be meaningful: RLS on, a party SELECT/INSERT
-- policy (customer or tasker of the thread), grants to authenticated. The real policy names, bodies, guard triggers (messages_guard) are UNVERIFIED here.
grant select, insert, update, delete on public.message_threads, public.messages, public.users, public.coordinators, public.local_booking_state to authenticated;
grant select on public.local_booking_events, public.bookings to authenticated;
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
create policy stand_thread_party on public.message_threads for select to authenticated using (auth.uid() in (customer_id, tasker_id));
create policy stand_msg_party_sel on public.messages for select to authenticated
  using (exists (select 1 from public.message_threads t where t.id = thread_id and auth.uid() in (t.customer_id, t.tasker_id)));
create policy stand_msg_party_ins on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and exists (select 1 from public.message_threads t where t.id = thread_id and auth.uid() in (t.customer_id, t.tasker_id)));
create policy stand_msg_party_upd on public.messages for update to authenticated
  using (exists (select 1 from public.message_threads t where t.id = thread_id and auth.uid() = t.customer_id));

-- Stage 6A rollback. Re-runnable. Removes the two read policies and the functions. Nothing is deleted from message_threads or messages
-- (history is never deleted). The audit rows written by local_thread_admin_read stay (they are history too).
drop policy if exists lt_msg_coord_select on public.messages;
drop policy if exists lt_thread_coord_select on public.message_threads;
drop function if exists public.local_thread_admin_read(uuid, text, integer);
drop function if exists public.local_thread_labels(uuid[]);
drop function if exists public.open_local_thread(uuid);
drop function if exists public.local_thread_access(uuid);
drop function if exists public._local_thread_booking(uuid);

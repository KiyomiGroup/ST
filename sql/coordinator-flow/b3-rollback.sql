-- Stage B3 rollback: removes the close-on-release trigger. Chat lines already written stay (plain system lines).
begin;
drop trigger if exists lt_close_chat_on_release on public.bookings;
drop function if exists public._lt_close_chat_on_release();
commit;

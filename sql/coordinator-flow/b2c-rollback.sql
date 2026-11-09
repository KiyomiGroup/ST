-- Undo of Stage B2c: removes the one new function. Nothing else was changed by B2c, so nothing else needs restoring.
-- Bookings already closed with it stay closed (their cancellation record and timeline stay); tasks it closed stay closed.
begin;
drop function if exists public.local_booking_close_declined(uuid, uuid, text);
notify pgrst, 'reload schema';
commit;

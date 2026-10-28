-- Stage 5B rollback: removes the two read-only functions. Nothing else was created, so nothing else is touched.
-- Safe to run twice. The 5A objects stay.
drop function if exists public.local_booking_list(integer);
drop function if exists public.local_booking_detail(uuid);

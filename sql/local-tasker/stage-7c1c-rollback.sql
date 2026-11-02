-- Rollback of stage-7c1c-core.sql. Removes the one read function. Nothing else was changed by 7C-1c, so nothing else needs undoing.
drop function if exists public.local_booking_code_state(uuid);

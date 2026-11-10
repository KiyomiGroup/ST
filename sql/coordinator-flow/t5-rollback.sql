-- Undo Stage T5: removes the read-only earnings function. Nothing else was changed by t5-tasker-earnings.sql.
drop function if exists public.local_tasker_earnings(uuid, integer);

-- Undoes m19u-core.sql. The table urgent_payments is KEPT (it is a record of real payments).
drop trigger if exists zz_m19_urgent_guard on public.tasks;
drop function if exists public._m19_urgent_guard();
drop function if exists public._m19_urgent_claim(text, text);

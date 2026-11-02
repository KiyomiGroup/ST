-- Stage 7I rollback: removes the one read function. Nothing else was created.
drop function if exists public.my_coordinator_upgrades();

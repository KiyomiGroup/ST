-- VR4 rollback: puts the old verify-first gates back exactly as they were (from the copies in vr4_backup).
-- Rows that were already published STAY published, and coordinators that were switched on stay on. Run once, whole file.
-- WARNING: once this runs, unverified taskers cannot publish and unverified customers cannot book again.
do $$
declare r record;
begin
  if to_regclass('public.vr4_backup') is null or (select count(*) from public.vr4_backup) = 0 then
    raise exception 'NOTHING TO ROLL BACK: vr4_backup is missing or empty (VR4 was not run).';
  end if;
  for r in select * from public.vr4_backup where kind = 'function' order by (name = 'guard_booking_customer_verified') desc loop
    execute r.def;
  end loop;
  for r in select * from public.vr4_backup where kind = 'trigger' loop
    execute 'drop trigger if exists trg_guard_booking_customer_verified on public.bookings';
    execute r.def;
  end loop;
  update public.idv_gate_config set gate_customers = coalesce((select def::boolean from public.vr4_backup where name = 'gate_customers'), true);
end $$;

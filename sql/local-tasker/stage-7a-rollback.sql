-- Stage 7A rollback. Re-runnable. Removes the three functions only. Nothing else was changed by stage-7a-core.sql.
drop function if exists public.booking_fee_rates(uuid[]);
drop function if exists public.platform_fee_rate_for_tasker(uuid);
drop function if exists public.is_local_tasker_user(uuid);

-- Stage 5D-2 ROLLBACK. Run in the Supabase SQL editor. Safe to run twice.
-- Removes the milestone functions. The milestone table is dropped ONLY if it is empty; otherwise it is kept (it is a
-- record of what happened on a real job). Nothing here touches bookings, payments, escrow or wallets.
drop function if exists public.local_booking_customer_milestones(uuid);
drop function if exists public.local_booking_milestones(uuid);
drop function if exists public.local_booking_record_milestone(uuid, uuid, text, timestamptz, text);
drop function if exists public._local_booking_milestone_block(uuid, text);
drop function if exists public._local_booking_milestone_order();
do $$
begin
  if to_regclass('public.local_booking_milestones') is not null then
    if exists (select 1 from public.local_booking_milestones) then
      raise notice 'local_booking_milestones has rows and was KEPT (a record of real jobs).';
    else
      drop trigger if exists lbm_audit on public.local_booking_milestones;
      drop trigger if exists lbm_guard on public.local_booking_milestones;
      drop table public.local_booking_milestones;
      drop function if exists public.local_booking_milestones_audit();
      drop function if exists public.local_booking_milestones_guard();
    end if;
  end if;
end $$;

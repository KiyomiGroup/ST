-- Stage T5: one read-only function for the Earnings tab of the Local Tasker page (coordinator-tasker.html).
-- local_tasker_earnings(p_tasker, p_limit) returns this Local Tasker's payouts and YOUR commission on them, only for bookings
-- that belong to the calling coordinator. Nothing is written. One transaction. Undo: t5-rollback.sql.
-- Built from the columns used in b4-payout-countdown.sql and b4b-commission-hold.sql (local_payouts, local_booking_state,
-- local_booking_commission_holds). NOT RUN yet when this file was written.
begin;

create or replace function public.local_tasker_earnings(p_tasker uuid, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare v_me uuid := auth.uid(); v_rows jsonb; v_tot jsonb; v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if v_me is null or p_tasker is null or not public.is_active_coordinator(v_me) then
    raise exception 'Local Tasker not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not exists (select 1 from public.coordinator_assignments a where a.coordinator_id = v_me and a.tasker_user_id = p_tasker) then
    raise exception 'Local Tasker not found.' using errcode = 'P0001', hint = 'not_found';
  end if;

  with x as (
    select lp.booking_id, lp.created_at, lp.paid_at, lp.release_after, lp.status_reason,
           lp.base_amount, lp.fee_total, lp.amount as net_amount,
           case when lp.status = 'queued' and lp.release_after is not null and lp.release_after > now() then 'waiting'
                when lp.status = 'queued' then 'due'
                else lp.status end as phase,
           h.coordinator_share as comm_amount,
           case when h.booking_id is null then null when h.credited_at is null then 'pending' else 'credited' end as comm_phase
      from public.local_payouts lp
      join public.local_booking_state s on s.booking_id = lp.booking_id and s.coordinator_id = v_me
      left join public.local_booking_commission_holds h on h.booking_id = lp.booking_id and h.coordinator_id = v_me
     where lp.tasker_user_id = p_tasker and lp.release_key = 'final'
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (select * from x order by created_at desc limit v_lim) r), '[]'::jsonb),
    jsonb_build_object(
      'count', (select count(*) from x),
      'paid',            coalesce((select sum(net_amount) from x where phase = 'paid'), 0),
      'on_the_way',      coalesce((select sum(net_amount) from x where phase in ('waiting', 'due', 'processing')), 0),
      'needs_attention', coalesce((select sum(net_amount) from x where phase in ('review', 'failed')), 0),
      'comm_credited',   coalesce((select sum(comm_amount) from x where comm_phase = 'credited'), 0),
      'comm_pending',    coalesce((select sum(comm_amount) from x where comm_phase = 'pending'), 0))
    into v_rows, v_tot;

  return jsonb_build_object('rows', v_rows, 'totals', v_tot);
end $f$;

revoke all on function public.local_tasker_earnings(uuid, integer) from public, anon;
grant execute on function public.local_tasker_earnings(uuid, integer) to authenticated;

commit;

-- CHECK (run after the commit): one row, two true
select
  exists (select 1 from pg_proc p where p.proname = 'local_tasker_earnings' and p.pronamespace = 'public'::regnamespace) as function_ok,
  has_function_privilege('authenticated', 'public.local_tasker_earnings(uuid, integer)', 'execute') as granted_ok;

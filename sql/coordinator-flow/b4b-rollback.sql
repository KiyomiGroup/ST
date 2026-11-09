-- Undo of Stage B4b. Restores _release_escrow to the exact text the owner pasted and the B4 version of local_booking_payout_state.
-- SAFETY: refuses to run while any commission is still held (it would be lost). Wait for the 24 hours, or credit them first.
begin;
do $c$
begin
  if exists (select 1 from public.local_booking_commission_holds where credited_at is null) then
    raise exception 'Some commissions are still held. Let them be credited (or settle them by hand) before undoing B4b.';
  end if;
end $c$;
do $c$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lt-commission-credit';
  end if;
end $c$;

CREATE OR REPLACE FUNCTION public._release_escrow(p_booking uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare b public.bookings; v_tasker uuid; v_sum numeric;
        v_base numeric; v_coord uuid; v_share numeric; v_tx uuid; v_cerr text;   -- Stage 7E
        v_local boolean; v_acct uuid;   -- Stage 7C-1
        v_svc numeric := 0; v_svcfee numeric := 0;   -- Stage 7C-fee: the service-charge part of what was held, and the fee taken on it
begin
  select * into b from public.bookings where id = p_booking for update;
  perform public._assert_booking_not_frozen(p_booking);   -- Stage 12: nothing is released while a report is open
  v_tasker := public._booking_tasker_user(b);
  v_local := public.is_local_tasker_user(v_tasker);   -- Stage 7C-1
  if v_local and b.payment_status = 'released' then return 0; end if;   -- Stage 7C-1: the ONE idempotency guard: a second release of a Local Tasker booking does nothing

  select coalesce(sum(coalesce(tasker_amount, amount - coalesce(platform_fee, round(amount * public.platform_fee_rate_for_tasker(v_tasker))))), 0)   -- Stage 7A
    into v_sum from public.escrow_payments where booking_id = p_booking and status = 'held';
  select coalesce(sum(amount), 0) into v_base from public.escrow_payments where booking_id = p_booking and status = 'held';   -- Stage 7E: what was held
  if v_local then   -- Stage 7C-fee: the coordinator's 5% is worked out on the SERVICE CHARGE only (not transport or materials, which carry the 2% fee)
    select coalesce(sum(e.amount) filter (where coalesce(r.kind, 'payment') not in ('transport', 'materials')), 0),
           coalesce(sum(e.platform_fee) filter (where coalesce(r.kind, 'payment') not in ('transport', 'materials')), 0)
      into v_svc, v_svcfee
      from public.escrow_payments e
      left join public.payment_intents i on i.id = e.payment_id
      left join public.payment_requests r on r.id = i.request_id
     where e.booking_id = p_booking and e.status = 'held';
  end if;
  if v_sum = 0 then   -- paid some other way (e.g. gift cards): pay out the booking amount less the fee
    v_base := coalesce(b.amount, 0);   -- Stage 7E
    v_sum := coalesce(b.amount, 0) - round(coalesce(b.amount, 0) * public.platform_fee_rate_for_tasker(v_tasker));   -- Stage 7A
    v_svc := v_base; v_svcfee := greatest(v_base - v_sum, 0);   -- Stage 7C-fee: gift-card payments are main service payments
  end if;

  if v_local then   -- Stage 7C-1: NO wallet credit. Clear any legacy pending balance, then queue the direct payout (unique per booking + release_key).
    update public.wallets set pending_balance = greatest(0, pending_balance - v_sum), updated_at = now() where user_id = v_tasker;
    select a.id into v_acct from public.local_payout_accounts a where a.tasker_user_id = v_tasker and a.status = 'active';
    if v_sum > 0 then
      insert into public.local_payouts (booking_id, release_key, tasker_user_id, payout_account_id, amount, base_amount, fee_total, status, status_reason, reference)
      values (p_booking, 'final', v_tasker, v_acct, v_sum, v_base, greatest(v_base - v_sum, 0),
              case when v_acct is null then 'review' else 'queued' end,
              case when v_acct is null then 'no_verified_account' else null end,
              'ST-LP-' || p_booking::text || '-final')
      on conflict (booking_id, release_key) do nothing;
      begin
        perform public.local_tasker_audit(case when v_acct is null then 'payout_needs_review' else 'payout_queued' end, 'local_payout', p_booking::text, null,
          jsonb_build_object('booking_id', p_booking, 'amount', v_sum, 'release_key', 'final'), null);
      exception when others then null;   -- the audit row is best effort; the payout row above is not
      end;
    end if;
  else
    perform public._ensure_wallet(v_tasker);
    update public.wallets
       set balance = balance + v_sum, pending_balance = greatest(0, pending_balance - v_sum), updated_at = now()
     where user_id = v_tasker;
    insert into public.wallet_transactions (user_id, type, amount, booking_id, status, note)
    values (v_tasker, 'escrow_release', v_sum, p_booking, 'completed',
            '₦' || to_char(v_sum, 'FM999,999,999') || ' released after job completion' ||
            case when public.platform_fee_rate_for_tasker(v_tasker) > 0
                 then ' (' || round(public.platform_fee_rate_for_tasker(v_tasker) * 100)::int || '% fee deducted)' else ' (no fee)' end);   -- Stage 7A: regular text unchanged
  end if;
  update public.escrow_payments set status = 'released', released_at = now()
   where booking_id = p_booking and status = 'held';
  update public.bookings set status = 'completed', payment_status = 'released', completed_at = now() where id = p_booking;

  -- Stage 7E: the coordinator's share of the fee, Local Taskers only. Own sub-transaction: all or nothing, and never blocks the release above.
  if public.is_local_tasker_user(v_tasker) then
    begin
      select s.coordinator_id into v_coord from public.local_booking_state s where s.booking_id = p_booking;
      if v_coord is null then
        select a.coordinator_id into v_coord from public.coordinator_assignments a
         where a.tasker_user_id = v_tasker and a.ended_at is null order by a.assigned_at desc limit 1;
      end if;
      select f.coordinator_share into v_share from public.platform_fee_split(v_svc, v_tasker) f;   -- Stage 7C-fee: service charge only
      v_share := least(coalesce(v_share, 0), greatest(v_svcfee, 0));   -- never more than the service-charge fee really taken
      if v_coord is not null and v_share > 0
         and not exists (select 1 from public.local_booking_commissions c where c.booking_id = p_booking) then
        perform public._ensure_wallet(v_coord);
        update public.wallets set balance = balance + v_share, updated_at = now() where user_id = v_coord;
        insert into public.wallet_transactions (user_id, type, amount, reference, booking_id, status, note)
        values (v_coord, 'coordinator_commission', v_share, 'lt-comm-' || p_booking::text, p_booking, 'completed',
                '₦' || to_char(v_share, 'FM999,999,999.00') || ' commission on a Local Tasker booking')
        returning id into v_tx;
        insert into public.local_booking_commissions
          (booking_id, coordinator_id, tasker_user_id, base_amount, fee_total, coordinator_share, platform_share, wallet_transaction_id)
        values (p_booking, v_coord, v_tasker, v_svc, v_svcfee, v_share, v_svcfee - v_share, v_tx);
        perform public.local_tasker_audit('commission_credited', 'local_booking_commission', p_booking::text, null,
          jsonb_build_object('booking_id', p_booking, 'coordinator_id', v_coord, 'amount', v_share), v_coord);
      elsif v_coord is null then
        perform public.local_tasker_audit('commission_no_coordinator', 'local_booking_commission', p_booking::text, null,
          jsonb_build_object('booking_id', p_booking, 'fee_total', v_svcfee), null);
      end if;
    exception when others then
      v_cerr := left(sqlerrm, 200);
    end;
    if v_cerr is not null then
      begin
        perform public.local_tasker_audit('commission_failed', 'local_booking_commission', p_booking::text, null,
          jsonb_build_object('booking_id', p_booking, 'error', v_cerr), null);
      exception when others then null;
      end;
    end if;
  end if;

  perform public._notify(b.customer_id, 'job_completed', '✅ Job Completed!',
    'Great news! The job is complete. Please leave a review.', jsonb_build_object('booking_id', p_booking));
  return v_sum;
end $function$
;

create or replace function public.local_booking_payout_state(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare v_me uuid := auth.uid(); s public.local_booking_state; r public.local_payouts; v_phase text;
begin
  if v_me is null or p_booking is null or not public.is_active_coordinator(v_me) then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select * into s from public.local_booking_state where booking_id = p_booking and coordinator_id = v_me;
  if not found then raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found'; end if;
  select * into r from public.local_payouts where booking_id = p_booking and release_key = 'final';
  if not found then return jsonb_build_object('has_payout', false); end if;
  v_phase := case
    when r.status = 'queued' and r.release_after is not null and r.release_after > now() then 'waiting'
    when r.status = 'queued' then 'due'
    else r.status end;
  return jsonb_build_object('has_payout', true, 'phase', v_phase, 'amount', r.amount,
    'release_after', r.release_after, 'seconds_left', case when v_phase = 'waiting' then greatest(0, ceil(extract(epoch from (r.release_after - now()))))::bigint end,
    'paid_at', r.paid_at, 'reason', r.status_reason);
end $f$;
revoke all on function public.local_booking_payout_state(uuid) from public, anon;
grant execute on function public.local_booking_payout_state(uuid) to authenticated;

drop function if exists public._lt_credit_due_commissions();
drop table if exists public.local_booking_commission_holds;
commit;

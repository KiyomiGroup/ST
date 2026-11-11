-- a15b-fix-encoding.sql
-- WHY: the payout email showed odd letters (an "a" with a hat, then punctuation) in place of the naira sign and the bullets.
-- Those are UTF-8 characters that got converted to other characters when the SQL was pasted into the
-- Supabase editor. The text stored INSIDE the functions was already garbled (your _release_escrow dump shows the
-- same thing). withdrawal_create already avoids this by writing the naira sign as chr(8358): this patch does the same.
-- Every symbol below is written as a character CODE, so this file is plain ASCII and cannot be garbled again.
--
-- Run all of it in the SQL editor. It only replaces three functions (create or replace keeps their permissions).
-- It changes no table and no stored row. Emails and wallet notes already written stay as they are.

-- 1. the money formatter used by the Accountant report and its email
create or replace function public._acct_naira(p_kobo bigint)
returns text language sql immutable as $$
  select chr(8358) || to_char(coalesce(p_kobo, 0) / 100.0, 'FM999,999,990.00') $$;

-- 2. the 9 pm report email (bullet and ellipsis as codes)
create or replace function public.accountant_close_day()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_end timestamptz; r public.accountant_daily_reports; v_sync jsonb; v_title text; v_body text; v_sent integer := 0;
  u record; v_list text := ''; j jsonb; v_i integer := 0;
begin
  v_end := (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') + interval '20 hours';
  if v_end > now() then v_end := v_end - interval '1 day'; end if;

  v_sync := public._acct_sync_ledger();
  r := public._acct_build_report(v_end);

  if r.status = 'sent' then
    return jsonb_build_object('ok', true, 'skipped', 'already marked sent', 'report_date', r.report_date);
  end if;

  if r.jobs_released = 0 then
    v_title := 'No revenue to pay out today';
    v_body  := 'No release code was entered between 9:00 pm yesterday and 9:00 pm today (' || to_char(r.report_date, 'DD Mon YYYY')
               || ', Nigeria time). Nothing needs to be sent to Paystack for this day.';
  else
    for j in select value from jsonb_array_elements(r.lines) loop
      v_i := v_i + 1;
      exit when v_i > 20;
      v_list := v_list || E'\n' || chr(8226) || ' Job ' || (j->>'job') || ' (' || (j->>'kind') || '): '
                || public._acct_naira((j->>'tasker_kobo')::bigint);
    end loop;
    if r.jobs_released > 20 then v_list := v_list || E'\n' || chr(8230) || ' and ' || (r.jobs_released - 20) || ' more in the report.'; end if;
    v_title := 'Pay out ' || public._acct_naira(r.tasker_kobo) || ' to Paystack today';
    v_body  := r.jobs_released || ' job(s) were released by release code for ' || to_char(r.report_date, 'DD Mon YYYY')
               || '. Amount to put in Paystack for taskers within 24 hours: ' || public._acct_naira(r.tasker_kobo)
               || ' (regular ' || public._acct_naira(r.regular_kobo) || ', Local Taskers ' || public._acct_naira(r.local_kobo) || ').'
               || case when r.coordinator_kobo is null then ' Coordinator commission: not available.'
                       else ' Coordinator commission on these jobs: ' || public._acct_naira(r.coordinator_kobo) || ' (shown apart).' end
               || ' Platform commission earned: ' || public._acct_naira(r.platform_kobo) || ' (not sent to anyone).'
               || v_list || E'\n' || 'Top up Paystack, then record it on the Accountant page.';
  end if;

  for u in
    select distinct au.user_id
      from public.admin_users au
      join public.admin_user_roles ur on ur.user_id = au.user_id
     where au.status = 'active' and au.removed_at is null
       and (ur.role_key = 'super_admin'
            or exists (select 1 from public.admin_role_permissions rp
                        where rp.role_key = ur.role_key and rp.permission_key = 'accounting.view'))
  loop
    begin
      perform public._notify(u.user_id, 'accountant_daily', v_title, v_body,
                             jsonb_build_object('report_date', r.report_date, 'to_send_kobo', r.tasker_kobo, 'jobs', r.jobs_released));
      v_sent := v_sent + 1;
    exception when others then null;   -- one failed notification never blocks the others
    end;
  end loop;

  update public.accountant_daily_reports set emailed_at = now() where report_date = r.report_date;
  return jsonb_build_object('ok', true, 'report_date', r.report_date, 'jobs', r.jobs_released,
                            'to_send_kobo', r.tasker_kobo, 'notified', v_sent, 'sync', v_sync);
end $$;

-- 3. _release_escrow: ONLY the two text literals changed (wallet note naira sign, "Job Completed" tick).
--    Everything else is the function exactly as you dumped it.
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
            chr(8358) || to_char(v_sum, 'FM999,999,999') || ' released after job completion' ||
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
        -- Stage B4b: the commission is HELD for 24 hours (same wait as the payout), then credited by _lt_credit_due_commissions().
        -- The amounts are worked out here, at release, exactly as before; only the wallet credit moves.
        insert into public.local_booking_commission_holds
          (booking_id, coordinator_id, tasker_user_id, base_amount, fee_total, coordinator_share, platform_share, credit_after)
        values (p_booking, v_coord, v_tasker, v_svc, v_svcfee, v_share, v_svcfee - v_share, now() + interval '24 hours')
        on conflict (booking_id) do nothing;
        begin
          perform public.local_tasker_audit('commission_held', 'local_booking_commission', p_booking::text, null,
            jsonb_build_object('booking_id', p_booking, 'coordinator_id', v_coord, 'amount', v_share), v_coord);
        exception when others then null;   -- the audit row is best effort; the hold above is not
        end;
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

  perform public._notify(b.customer_id, 'job_completed', chr(9989) || ' Job Completed!',
    'Great news! The job is complete. Please leave a review.', jsonb_build_object('booking_id', p_booking));
  return v_sum;
end $function$;

-- 4. CHECK (read-only). Lists any other function in public that still holds garbled text.
--    Send me the result: each one needs the same treatment.
select p.proname
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (p.prosrc like '%' || chr(226) || chr(8364) || '%'
     or p.prosrc like '%' || chr(226) || chr(8218) || '%'
     or p.prosrc like '%' || chr(226) || chr(339) || '%'
     or p.prosrc like '%' || chr(195) || chr(8250) || '%')
 order by 1;

-- 5. CHECK (read-only). Must return first_char_code = 8358 (the naira sign) and sample = naira sign + 1,320.00
select ascii(public._acct_naira(132000::bigint)) as first_char_code, public._acct_naira(132000::bigint) as sample;

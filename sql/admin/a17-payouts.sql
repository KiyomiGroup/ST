-- StreetTasker Admin Control Centre, stage A17: Earnings and payouts watch (READ ONLY).
-- Run the WHOLE file once in the Supabase SQL editor. Safe to run twice. Rollback: a17-rollback.sql. The last line says DONE or NOT DONE.
-- Written from the owner's a17-introspect result of 2026-11-11 (real columns, statuses and checks of withdrawals and local_payouts).
--
-- Adds three functions (SECURITY DEFINER, execute for authenticated only, each checks payouts.view itself):
--   admin_payouts_overview()                 counts, money in flight, wallet totals, stuck and overdue items, anomalies
--   admin_withdrawal_list(filter, offset)    Regular Taskers' withdrawals, 25 per page
--   admin_local_payout_list(filter, offset)  Local Taskers' payout records, 25 per page
--
-- Writes nothing. No table, policy or existing function is changed. No money moves, Paystack is never called.
-- Never returned: the full account number, the recipient code, phone numbers, the street address.
-- Amounts are NAIRA as stored in these tables (not kobo). Statuses are the real check values:
--   withdrawals: pending, processing, success, failed, reversed. local_payouts: queued, processing, paid, failed, review, reversed.
-- Definitions: "stuck" = a withdrawal still pending or processing after 15 minutes (the same rule as withdrawal_stuck_list).
--              "overdue" = a Local payout still queued 30 minutes after its release_after time (the sender runs every few minutes).
--              "anomaly" = a withdrawal whose failure_reason carries the ANOMALY tag written by withdrawal_fail or withdrawal_succeed.
-- test_archive_* tables are never read.

do $pre$
begin
  if to_regprocedure('public.admin_has(text)') is null then
    raise exception 'NOT DONE: the admin core (stage A1) is not installed. Nothing was changed.';
  end if;
end
$pre$;

create or replace function public.admin_payouts_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.admin_has('payouts.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'generated_at', now(),
    'regular', jsonb_build_object(
      'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select status as s, count(*) n from public.withdrawals group by status) x),
      'total', (select count(*) from public.withdrawals),
      'in_flight_amount', (select coalesce(sum(amount), 0) from public.withdrawals where status in ('pending', 'processing')),
      'in_flight_count', (select count(*) from public.withdrawals where status in ('pending', 'processing')),
      'stuck', (select count(*) from public.withdrawals where status in ('pending', 'processing') and created_at <= now() - interval '15 minutes'),
      'anomalies', (select count(*) from public.withdrawals where coalesce(failure_reason, '') like '%ANOMALY:%'),
      'paid_amount', (select coalesce(sum(net_amount), 0) from public.withdrawals where status = 'success'),
      'fees_amount', (select coalesce(sum(fee), 0) from public.withdrawals where status = 'success'),
      'wallet_balance_total', (select coalesce(sum(balance), 0) from public.wallets),
      'wallet_pending_total', (select coalesce(sum(pending_balance), 0) from public.wallets),
      'wallets_with_balance', (select count(*) from public.wallets where balance > 0)),
    'local', jsonb_build_object(
      'counts', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select status as s, count(*) n from public.local_payouts group by status) x),
      'total', (select count(*) from public.local_payouts),
      'in_flight_amount', (select coalesce(sum(amount), 0) from public.local_payouts where status in ('queued', 'processing')),
      'in_flight_count', (select count(*) from public.local_payouts where status in ('queued', 'processing')),
      'overdue', (select count(*) from public.local_payouts where status = 'queued' and release_after is not null and release_after <= now() - interval '30 minutes'),
      'needs_review', (select count(*) from public.local_payouts where status in ('review', 'failed')),
      'paid_amount', (select coalesce(sum(coalesce(send_amount, amount)), 0) from public.local_payouts where status = 'paid'))
  ) into v;
  return jsonb_build_object('ok', true) || v;
end $$;

create or replace function public.admin_withdrawal_list(p_filter text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('payouts.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'pending', 'processing', 'success', 'failed', 'reversed', 'stuck', 'anomaly') then v_f := 'all'; end if;
  with f as (
    select w.* from public.withdrawals w
     where v_f = 'all' or w.status = v_f
        or (v_f = 'stuck' and w.status in ('pending', 'processing') and w.created_at <= now() - interval '15 minutes')
        or (v_f = 'anomaly' and coalesce(w.failure_reason, '') like '%ANOMALY:%')
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'reference', t.reference, 'user_id', t.user_id, 'name', (select nullif(btrim(u.name), '') from public.users u where u.id = t.user_id),
        'status', t.status, 'amount', t.amount, 'fee', t.fee, 'net_amount', t.net_amount, 'bank_name', t.bank_name, 'account_last4', t.account_last4,
        'transfer_code', t.paystack_transfer_code, 'failure_reason', left(t.failure_reason, 300), 'created_at', t.created_at, 'settled_at', t.settled_at,
        'age_minutes', floor(extract(epoch from (now() - t.created_at)) / 60)::integer,
        'stuck', t.status in ('pending', 'processing') and t.created_at <= now() - interval '15 minutes',
        'anomaly', coalesce(t.failure_reason, '') like '%ANOMALY:%') order by t.created_at desc, t.id), '[]'::jsonb)
      from (select * from f order by created_at desc, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

create or replace function public.admin_local_payout_list(p_filter text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f text := lower(coalesce(p_filter, 'all')); v_off integer := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  if not public.admin_has('payouts.view') then raise exception 'You do not have permission to do this.' using errcode = '42501'; end if;
  if v_f not in ('all', 'queued', 'processing', 'paid', 'failed', 'review', 'reversed', 'overdue') then v_f := 'all'; end if;
  with f as (
    select p.* from public.local_payouts p
     where v_f = 'all' or p.status = v_f
        or (v_f = 'overdue' and p.status = 'queued' and p.release_after is not null and p.release_after <= now() - interval '30 minutes')
  )
  select jsonb_build_object('ok', true, 'filter', v_f, 'offset', v_off, 'page_size', 25, 'total', (select count(*) from f),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'booking_id', t.booking_id, 'release_key', t.release_key, 'tasker_user_id', t.tasker_user_id,
        'name', coalesce((select nullif(btrim(lp.full_name), '') from public.local_tasker_profiles lp where lp.tasker_user_id = t.tasker_user_id),
                         (select nullif(btrim(u.name), '') from public.users u where u.id = t.tasker_user_id)),
        'status', t.status, 'status_reason', left(t.status_reason, 300), 'amount', t.amount, 'base_amount', t.base_amount, 'fee_total', t.fee_total,
        'transfer_fee', t.transfer_fee, 'send_amount', t.send_amount, 'provider_status', t.provider_status, 'attempts', t.attempts,
        'last_error', left(t.last_error, 300), 'reference', t.reference, 'created_at', t.created_at, 'release_after', t.release_after,
        'claimed_at', t.claimed_at, 'sent_at', t.sent_at, 'paid_at', t.paid_at,
        'bank_name', (select a.bank_name from public.local_payout_accounts a where a.id = t.payout_account_id),
        'account_last4', (select a.account_last4 from public.local_payout_accounts a where a.id = t.payout_account_id),
        'account_status', (select a.status from public.local_payout_accounts a where a.id = t.payout_account_id),
        'overdue', t.status = 'queued' and t.release_after is not null and t.release_after <= now() - interval '30 minutes') order by t.created_at desc, t.id), '[]'::jsonb)
      from (select * from f order by created_at desc, id offset v_off limit 25) t)) into v_out;
  return v_out;
end $$;

revoke all on function public.admin_payouts_overview(), public.admin_withdrawal_list(text, integer), public.admin_local_payout_list(text, integer) from public, anon, authenticated;
grant execute on function public.admin_payouts_overview(), public.admin_withdrawal_list(text, integer), public.admin_local_payout_list(text, integer) to authenticated;

select case
  when to_regprocedure('public.admin_payouts_overview()') is not null
   and to_regprocedure('public.admin_withdrawal_list(text,integer)') is not null
   and to_regprocedure('public.admin_local_payout_list(text,integer)') is not null
  then 'DONE: A17 installed.'
  else 'NOT DONE: see the messages above.'
end as a17_result;

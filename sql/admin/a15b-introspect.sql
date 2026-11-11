-- READ ONLY. Run in the SQL editor and send the result back. Changes nothing.
-- Purpose: (1) prove the release code sets escrow_payments.released_at (the whole daily report depends on it),
-- (2) see whether a 4-week "no clearing" exemption still exists in the database, (3) see the columns of the money
-- tables not yet in the labelled ledger (gift cards, subscriptions, refunds, referrals, local payouts).
select 'escrow released rows' as section,
       'released=' || count(*) filter (where status = 'released')
       || ', released with no released_at=' || count(*) filter (where status = 'released' and released_at is null)
       || ', released_at range=' || coalesce(min(released_at)::text, '-') || ' to ' || coalesce(max(released_at)::text, '-') as detail
  from public.escrow_payments
union all
select 'SOURCE ' || p.proname, pg_get_functiondef(p.oid)
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('job_submit_code', '_release_escrow', 'withdrawal_clearing_mine', 'withdrawal_create', 'withdrawal_fee', '_notify', 'is_local_tasker_user')
union all
select 'COLUMNS ' || c.table_name, string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in ('withdrawals', 'gift_card_orders', 'gift_card_holds', 'gift_cards', 'subscription_receipts',
                        'job_refunds', 'referral_rewards', 'local_payouts', 'local_booking_commissions',
                        'local_booking_commission_holds', 'notifications')
 group by c.table_name
order by 1;

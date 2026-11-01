-- =====================================================================
-- W2c-2: EMERGENCY RUNBOOK for withdrawals. Keep this file. Nothing here runs by itself.
-- Where: Supabase dashboard > SQL Editor > New query. Paste ONE numbered query at a time (not the whole file), Run.
-- Queries 1, 2, 3 and 6 only READ. Queries 4 and 5 CHANGE money records: they are commented out on purpose
-- (every line starts with two dashes). To use one: copy it, delete the two dashes at the start of the lines,
-- replace the reference, Run. Each can only be applied once per withdrawal; running it twice is harmless.
-- Needs w2a-tables.sql, w2b-create.sql and w2c-settle.sql. Paystack stays on TEST keys.
-- Full account numbers are never shown here (only the last 4 digits).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. LIST STUCK WITHDRAWALS (pending or processing for more than 15 minutes; change 15 if you like)
--    Empty result = nothing is stuck. Oldest first, at most 100 rows.
-- ---------------------------------------------------------------------
select * from public.withdrawal_stuck_list(15);

-- ---------------------------------------------------------------------
-- 2. LIST ANOMALIES (the system refused a contradictory Paystack event and left a note; a human must check Paystack)
--    Empty result = none. Nothing was changed for these rows except the note.
-- ---------------------------------------------------------------------
select reference, user_id, status, amount, net_amount, bank_name, account_last4,
       paystack_transfer_code, created_at, settled_at, failure_reason
  from public.withdrawals
 where failure_reason like '%ANOMALY%'
 order by updated_at desc
 limit 100;

-- ---------------------------------------------------------------------
-- 3. SHOW ONE WITHDRAWAL IN FULL (replace the reference in the first line). One row per record, so you can see all of it.
--    Look at the transfer in the Paystack dashboard (Transfers > search the reference) BEFORE you use query 4 or 5.
-- ---------------------------------------------------------------------
with ref as (select 'wd-PASTE-THE-REFERENCE-HERE'::text as r)
select 'withdrawal' as record, w.status as status, w.amount as amount,
       concat('fee ', w.fee, ', net ', w.net_amount, ', ', w.bank_name, ' ••••', w.account_last4,
              ', transfer ', coalesce(w.paystack_transfer_code, '-'), ', created ', w.created_at,
              ', settled ', coalesce(w.settled_at::text, '-'), ', reason ', coalesce(w.failure_reason, '-')) as detail
  from public.withdrawals w, ref where w.reference = ref.r
union all
select 'ledger ' || t.type, t.status, t.amount, coalesce(t.note, '')
  from public.wallet_transactions t, ref
 where t.reference = ref.r or t.reference = ref.r || '-refund'
union all
select 'notification', n.type, null, n.title || ' | ' || n.message
  from public.notifications n, ref
 where n.type = 'withdrawal_update' and n.data ->> 'reference' = ref.r
union all
select 'wallet balance now', null, wl.balance, ''
  from public.wallets wl join public.withdrawals w on w.user_id = wl.user_id, ref
 where w.reference = ref.r;

-- ---------------------------------------------------------------------
-- 4. MARK ONE WITHDRAWAL FAILED AND GIVE THE MONEY BACK (refund happens exactly once, whatever you do)
--    Use ONLY when Paystack shows the transfer did NOT go through (or does not exist) and it is stuck.
--    Works from pending, processing (and from success with 'reversed' only if the bank sent the money back).
--    Success looks like: "applied": true, "refunded": true. "applied": false means it was already settled: nothing changed.
-- ---------------------------------------------------------------------
-- select public.withdrawal_fail('wd-PASTE-THE-REFERENCE-HERE', 'failed', 'Marked failed by owner (runbook)');

-- ---------------------------------------------------------------------
-- 5. MARK ONE WITHDRAWAL AS PAID (success; no money moves, the record and the tasker's ledger row are completed)
--    Use ONLY when Paystack shows the transfer succeeded but our record is still pending / processing.
--    A withdrawal already failed or reversed is REFUSED ("refused": true): the money was already returned; check Paystack by hand.
--    Success looks like: "applied": true, "status": "success".
-- ---------------------------------------------------------------------
-- select public.withdrawal_succeed('wd-PASTE-THE-REFERENCE-HERE', null);

-- ---------------------------------------------------------------------
-- 6. HEALTH CHECK (read only): every withdrawal's records agree with each other
--    Expected: ONE row saying "OK: no problems". Anything else is a list of references to look at with query 3.
-- ---------------------------------------------------------------------
with w as (
  select x.reference, x.status,
         (select count(*) from public.wallet_transactions t where t.type = 'withdrawal_refund' and t.reference = x.reference || '-refund') as n_refund,
         (select count(*) from public.wallet_transactions t where t.type = 'withdrawal' and t.reference = x.reference) as n_debit,
         (select t.status from public.wallet_transactions t where t.type = 'withdrawal' and t.reference = x.reference limit 1) as ledger_status
    from public.withdrawals x
), problems as (
  select reference, 'money returned ' || n_refund || ' times (should be exactly 1 for failed / reversed)' as problem
    from w where status in ('failed', 'reversed') and n_refund <> 1
  union all
  select reference, 'money returned although the status is ' || status
    from w where status in ('pending', 'processing', 'success') and n_refund <> 0
  union all
  select reference, 'ledger debit row missing or duplicated (' || n_debit || ')'
    from w where n_debit <> 1
  union all
  select reference, 'ledger status "' || coalesce(ledger_status, 'none') || '" does not match withdrawal status "' || status || '"'
    from w where n_debit = 1 and ledger_status is distinct from
      case status when 'pending' then 'pending' when 'processing' then 'processing'
                  when 'success' then 'completed' else 'failed' end
)
select reference, problem from problems
union all
select 'OK', 'no problems' where not exists (select 1 from problems)
order by 1
limit 100;

-- =====================================================================
-- Rollback for w2c-settle.sql.
-- Drops the four functions withdrawal_mark_processing, withdrawal_succeed, withdrawal_fail, withdrawal_stuck_list
-- and the two internal helpers _withdrawal_lock and _withdrawal_clean_reason. Nothing else.
-- SAFETY: it NEVER touches a row. Withdrawals, refunds and ledger rows already written stay exactly as they are.
-- Safe to run twice. Nothing in the live site calls these functions until W3b / W4b / W5 are deployed in W7b.
-- After this file runs, nothing can settle or refund a withdrawal any more, so only run it if there is NO
-- pending or processing withdrawal (run: select * from public.withdrawals where status in ('pending','processing');).
-- Run it BEFORE w2b-rollback.sql and w2a-rollback.sql if you ever undo all three.
-- =====================================================================
begin;
drop function if exists public.withdrawal_stuck_list(integer);
drop function if exists public.withdrawal_fail(text, text, text);
drop function if exists public.withdrawal_succeed(text, text);
drop function if exists public.withdrawal_mark_processing(text, text, text);
drop function if exists public._withdrawal_lock(text);
drop function if exists public._withdrawal_clean_reason(text);
commit;

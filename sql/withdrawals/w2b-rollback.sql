-- =====================================================================
-- Rollback for w2b-create.sql.
-- Drops the function public.withdrawal_create(uuid, numeric, uuid) and nothing else.
-- SAFETY: it NEVER touches a row. Withdrawals and ledger rows created by the function stay exactly as they are,
-- and any money that was debited is NOT returned by this file (use the W2c runbook for that once it exists).
-- Safe to run twice. Nothing in the live site calls this function until W3b is deployed in W7b.
-- Run it BEFORE w2a-rollback.sql if you ever undo both.
-- =====================================================================
begin;
drop function if exists public.withdrawal_create(uuid, numeric, uuid);
commit;

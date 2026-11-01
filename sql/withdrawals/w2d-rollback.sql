-- =====================================================================
-- Rollback for w2d-accounts.sql.
-- Drops the four functions bank_account_add, bank_account_set_default, bank_account_remove and
-- bank_account_set_recipient, and nothing else.
-- SAFETY: it NEVER touches a row. Saved accounts (and notifications) created by the functions stay exactly as they are.
-- Safe to run twice. Nothing in the live site calls these functions until W3c is deployed in W7b.
-- Run it BEFORE w2a-rollback.sql if you ever undo everything.
-- =====================================================================
begin;
drop function if exists public.bank_account_add(uuid, text, text, text, text);
drop function if exists public.bank_account_set_default(uuid, uuid);
drop function if exists public.bank_account_remove(uuid, uuid);
drop function if exists public.bank_account_set_recipient(uuid, uuid, text);
commit;

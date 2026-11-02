-- Stage 7B rollback. Drops ONLY what stage-7b-core.sql created. The 'payout' consent rows and audit rows already
-- written are append-only and are NOT removed. Payout destinations saved so far are LOST with the table:
-- export them first if any real ones exist (list below). Run once.
-- select tasker_user_id, bank_name, account_last4, status, verified_at from public.local_payout_accounts;
drop function if exists public.local_payout_account(uuid);
drop function if exists public.local_payout_save(uuid, uuid, text, text, text, text, text, text, text, text);
drop function if exists public.local_payout_check_name(uuid, text);
drop function if exists public.local_payout_begin(uuid, uuid, text);
drop function if exists public.local_payout_names_match(text, text);
drop trigger if exists local_payout_guard_row on public.local_payout_accounts;
drop trigger if exists local_payout_guard_trunc on public.local_payout_accounts;
drop table if exists public.local_payout_attempts;
drop table if exists public.local_payout_accounts;
drop function if exists public._local_payout_guard();

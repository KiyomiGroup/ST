-- Rollback for stage A8. Drops the five functions and four helpers. admin_account_flags is KEPT (it belongs to A7 and is the record of who was suspended).
-- A rollback does NOT lift a ban in Supabase Auth: restore suspended Taskers on the page first.
drop function if exists public.admin_tasker_account_record(uuid, text, text);
drop function if exists public.admin_tasker_account_check(uuid, text, text);
drop function if exists public.admin_tasker_reveal(uuid, text, text);
drop function if exists public.admin_tasker_get(uuid);
drop function if exists public.admin_tasker_list(text, text, int);
drop function if exists public._a8_membership_label(uuid);
drop function if exists public._a8_mask_phone(text);
drop function if exists public._a8_mask_email(text);
drop function if exists public._a8_is_tasker(uuid);

-- Rollback for stage A7. Drops the five functions and three helpers. The table admin_account_flags is KEPT on purpose (it is the record of
-- who was suspended and why); drop it by hand only if you are sure: drop table public.admin_account_flags;
-- A rollback does NOT lift a ban in Supabase Auth: restore suspended customers on the page first.
drop function if exists public.admin_customer_account_record(uuid, text, text);
drop function if exists public.admin_customer_account_check(uuid, text, text);
drop function if exists public.admin_customer_reveal(uuid, text, text);
drop function if exists public.admin_customer_get(uuid);
drop function if exists public.admin_customer_list(text, text, int);
drop function if exists public._a7_mask_phone(text);
drop function if exists public._a7_mask_email(text);
drop function if exists public._a7_is_customer(uuid);

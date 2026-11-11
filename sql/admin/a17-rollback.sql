-- StreetTasker Admin, stage A17 rollback: removes the three read functions. No data is touched.
drop function if exists public.admin_payouts_overview();
drop function if exists public.admin_withdrawal_list(text, integer);
drop function if exists public.admin_local_payout_list(text, integer);
select 'DONE: A17 removed.' as a17_rollback;

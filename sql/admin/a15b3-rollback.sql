-- StreetTasker Admin, stage A15b-3 rollback. Removes the settlement, cash and capital-guard additions and puts the original sync back.
-- Cash snapshots are DELETED with their table (export them first if they matter). Ledger lines labelled coordinator_plan_income are kept
-- (the ledger is append only) but profit goes back to ignoring them only if you re-run a15b-accountant.sql afterwards.
drop trigger if exists accountant_capital_guard on public.accountant_ledger;
drop function if exists public._acct_capital_guard();
do $$ begin
  if to_regprocedure('public._acct_sync_ledger_core()') is not null then
    drop function if exists public._acct_sync_ledger();
    alter function public._acct_sync_ledger_core() rename to _acct_sync_ledger;
  end if;
end $$;
drop function if exists public._acct_sync_extras();
drop function if exists public.admin_accountant_settlements(integer);
drop function if exists public.admin_accountant_cash_record(text, bigint, date, text);
drop function if exists public.admin_accountant_cash();
drop table if exists public.accountant_cash_snapshots;
drop function if exists public._acct_cash_guard();
select 'DONE: A15b-3 removed. Re-run a15b-accountant.sql to restore the original profit function.' as a15b3_rollback;

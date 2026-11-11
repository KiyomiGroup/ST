-- Undo of a15b-accountant.sql. Drops the schedule, the functions and the three new tables.
-- WARNING: the ledger and daily reports are deleted with it. Export them first if they matter.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'st-accountant-daily';
  end if;
end $$;
drop function if exists public.admin_accountant_reverse(bigint, text);
drop function if exists public.admin_accountant_record(text, bigint, date, text, text);
drop function if exists public.admin_accountant_ledger(timestamptz, timestamptz, text, integer, integer);
drop function if exists public.admin_accountant_mark_sent(date, bigint, text);
drop function if exists public.admin_accountant_report(date);
drop function if exists public.admin_accountant_reports(integer);
drop function if exists public.accountant_close_day();
drop function if exists public._acct_build_report(timestamptz);
drop function if exists public._acct_sync_ledger();
drop function if exists public._acct_naira(bigint);
drop function if exists public._acct_kobo(numeric);
drop table if exists public.accountant_daily_reports;
drop table if exists public.accountant_ledger;
drop function if exists public._acct_ledger_guard();
drop table if exists public.accountant_labels;
delete from public.admin_role_permissions where permission_key in ('accounting.view', 'accounting.record', 'accounting.capital');
delete from public.admin_user_roles where role_key = 'accountant';
delete from public.admin_role_permissions where role_key = 'accountant';
delete from public.admin_permissions where key in ('accounting.view', 'accounting.record', 'accounting.capital');
delete from public.admin_roles where key = 'accountant';

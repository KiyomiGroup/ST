-- Rollback for stage A4: removes the dashboard summary function only. Changes no data.
drop function if exists public.admin_dashboard_summary();

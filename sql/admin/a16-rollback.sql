-- StreetTasker Admin, stage A16 rollback: removes the two read functions and two helpers. No data is touched.
drop function if exists public.admin_revenue_list(text, date, date, integer);
drop function if exists public.admin_revenue_report(text, date, date);
drop function if exists public._a16_events();
drop function if exists public._a16_kobo(numeric);
select 'DONE: A16 removed.' as a16_rollback;

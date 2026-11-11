-- StreetTasker Admin, stage A11 rollback: removes the three read functions. No data is touched.
drop function if exists public.admin_verification_overview();
drop function if exists public.admin_verification_list(text, integer, text);
drop function if exists public.admin_verification_detail(uuid);
select 'DONE: A11 removed.' as a11_rollback;

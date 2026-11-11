-- StreetTasker Admin, stage A14a rollback: removes the four read functions. No data is touched.
drop function if exists public.admin_community_list(text, integer);
drop function if exists public.admin_flagged_user_list(text, integer);
drop function if exists public.admin_review_list(text, integer);
drop function if exists public.admin_service_list(text, text, integer);
select 'DONE: A14a removed.' as a14a_rollback;

-- StreetTasker admin, stage A10 check: READ ONLY. Changes nothing. Run once in the Supabase SQL editor and send me the whole result.
-- Row 1 is the real text of the coordinator's "unpublish" function (so I can check the admin unpublish does the same things).
-- The other rows count the values bookings.status really holds (needed before the bookings stage). No keys, secrets or personal data.
select 'unpublish_local_tasker' as what,
       coalesce((select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'unpublish_local_tasker' limit 1), '(function not found)') as value,
       1::bigint as n
union all
select 'bookings.status', coalesce(status, '(null)'), count(*) from public.bookings group by 2
order by 1, 2;

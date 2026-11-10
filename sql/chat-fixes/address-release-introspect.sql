-- READ ONLY. Changes nothing. Run in the Supabase SQL editor and send me the result of each query.
-- Purpose: show how the street address (booking_private.address) is released to the tasker today, so the next
-- change (release it the moment the customer pays in chat) is written against the real rules, not a guess.

-- 1. The row-level-security policies on booking_private
select policyname, cmd, roles, qual as using_expression, with_check
from pg_policies
where schemaname = 'public' and tablename = 'booking_private'
order by policyname;

-- 2. Any function that touches booking_private
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and pg_get_functiondef(p.oid) ilike '%booking_private%';

-- 3. The values payment_status and status take on real bookings (so "paid" is matched correctly)
select status, payment_status, count(*) from public.bookings group by 1, 2 order by 3 desc;

-- 4. How many bookings have a saved street address
select count(*) as bookings_with_address from public.booking_private where coalesce(address, '') <> '';

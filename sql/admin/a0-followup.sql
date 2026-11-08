-- StreetTasker Admin Control Centre, stage A0 follow-up: READ-ONLY.
-- Changes NOTHING. Safe to run any number of times. No placeholders: paste each block as it is.
-- NOT needed for A1. Needed before A9 (F1, F3), A12 (F2), A16 (F3), A26 (F3, F6).
-- Run each block separately in the Supabase SQL editor and send the result (or the error text).
-- None of these blocks reads a cron command, a trigger definition or a key.

-- ============================================================
-- F1: who is allowed to call the staff-style functions that already exist (function text only)
-- ============================================================
select p.proname, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_approve_coordinator_application', 'admin_create_coordinator_code',
                    'admin_reject_coordinator_application', 'gift_admin_refund_order',
                    'gift_admin_resend_gift', 'gift_admin_resend_receipt', 'gift_admin_void_card',
                    'coordinator_chat_admin_read', 'local_thread_admin_read',
                    'idv_takedown_user', 'idv_restore_user')
order by p.proname;

-- ============================================================
-- F2: the values that bookings and threads really hold today (counts only)
-- ============================================================
select 'bookings.status' as what, coalesce(status, '(null)') as value, count(*) as n from public.bookings group by 2
union all
select 'bookings.payment_status', coalesce(payment_status, '(null)'), count(*) from public.bookings group by 2
union all
select 'bookings.work_stage', coalesce(work_stage, '(null)'), count(*) from public.bookings group by 2
union all
select 'message_threads.context_type', coalesce(context_type, '(null)'), count(*) from public.message_threads group by 2
union all
select 'local_booking_state.lt_status', coalesce(lt_status, '(null)'), count(*) from public.local_booking_state group by 2
order by 1, 2;

-- ============================================================
-- F3: fee, tier and limit settings (source of the functions, then their answers)
-- ============================================================
select p.proname, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('platform_fee_rate', 'coordinator_tier_terms', 'coordinator_capacity',
                    'local_tasker_max_active', 'withdrawal_fee', 'withdrawal_limits')
order by p.proname;

select 'coordinator tier ' || g as what, t.capacity, t.price_kobo
from generate_series(1, 6) g, lateral public.coordinator_tier_terms(g) t
order by g;

select key, value from public.local_tasker_settings order by key;
select key, int_value from public.subscription_settings order by key;
select key, value_int from public.homepage_settings order by key;

-- ============================================================
-- F4: storage buckets, and enum types (the two items blocks 10 and 15 left open)
-- ============================================================
select id as bucket, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as values
from pg_type t join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname order by t.typname;

-- ============================================================
-- F5: does the admin login already exist, and has it enrolled two-step verification?
-- (reads the account row and the number of factors only, no password or token)
-- ============================================================
select u.id, u.email, u.email_confirmed_at is not null as email_confirmed,
       u.last_sign_in_at,
       (select count(*) from auth.mfa_factors f where f.user_id = u.id) as mfa_factors
from auth.users u
where lower(u.email) = 'admin@streettasker.com';

-- ============================================================
-- F6: exact row counts for the tables that showed -1 and matter to admin
-- ============================================================
select 'coordinator_applications' as tbl, count(*) as n from public.coordinator_applications
union all select 'coordinator_codes', count(*) from public.coordinator_codes
union all select 'subscriptions', count(*) from public.subscriptions
union all select 'subscription_receipts', count(*) from public.subscription_receipts
union all select 'subscription_card_authorizations', count(*) from public.subscription_card_authorizations
union all select 'job_disputes', count(*) from public.job_disputes
union all select 'identity_verifications', count(*) from public.identity_verifications
union all select 'gift_cards', count(*) from public.gift_cards
union all select 'gift_card_orders', count(*) from public.gift_card_orders
union all select 'payments', count(*) from public.payments
union all select 'reviews', count(*) from public.reviews
union all select 'local_booking_quotes', count(*) from public.local_booking_quotes
union all select 'referral_profiles', count(*) from public.referral_profiles
order by 1;

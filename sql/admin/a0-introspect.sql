-- StreetTasker Admin Control Centre, stage A0: READ-ONLY look at the real database.
-- Changes NOTHING. Safe to run any number of times. No placeholders: paste each block as it is.
-- Run each block separately in the Supabase SQL editor and paste the result back to the AI.
-- If a block errors with "relation does not exist", paste the error: that is useful information too.
-- No row contents are read from private tables, only structure, counts and function text.

-- ============================================================
-- Block 1: every table in public, whether row level security is ON, and the rough row count
-- ============================================================
select c.relname as table_name,
       c.relkind as kind,                      -- r = table, v = view, m = materialized view
       c.relrowsecurity as rls_on,
       c.relforcerowsecurity as rls_forced,
       c.reltuples::bigint as approx_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','v','m','p')
order by c.relkind, c.relname;

-- ============================================================
-- Block 2: columns of the tables the admin screens will read
-- ============================================================
select table_name, ordinal_position as pos, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'users','taskers','tasker_profiles','profiles','services','tasks','task_applications',
    'bookings','booking_private','job_requests','job_events','job_disputes','dispute_events','job_refunds',
    'job_attachments','evidence_removals','escrow_payments','payment_requests','payments','payment_receipts',
    'payment_intents','subscriptions','subscription_receipts','subscription_events','subscription_plans',
    'wallets','wallet_transactions','withdrawal_bank_accounts','withdrawals',
    'gift_cards','gift_card_orders','gift_card_holds','gift_card_transactions',
    'referral_profiles','referral_rewards','reviews','feed_posts','posts','comments','notifications',
    'message_threads','messages','coordinators','coordinator_assignments','coordinator_applications',
    'coordinator_codes','local_tasker_profiles','local_tasker_consents','local_tasker_photos',
    'verifications','identity_verifications','support_staff')
order by table_name, ordinal_position;

-- ============================================================
-- Block 3: other tables whose names suggest they matter (subscriptions, coordinators, local bookings,
-- verification, audit, settings, withdrawals). Columns only.
-- ============================================================
select table_name, ordinal_position as pos, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (table_name ilike '%subscription%' or table_name ilike '%coordinator%' or table_name ilike '%local_booking%'
       or table_name ilike '%idv%' or table_name ilike '%identity%' or table_name ilike '%audit%'
       or table_name ilike '%setting%' or table_name ilike '%config%' or table_name ilike '%withdraw%'
       or table_name ilike '%tier%' or table_name ilike '%listing%' or table_name ilike '%credit%'
       or table_name ilike '%offer%' or table_name ilike '%notice%' or table_name ilike '%report%'
       or table_name ilike '%flag%' or table_name ilike '%moderation%')
  and table_name not in (
    'users','taskers','tasker_profiles','profiles','services','tasks','task_applications',
    'bookings','booking_private','job_requests','job_events','job_disputes','dispute_events','job_refunds',
    'job_attachments','evidence_removals','escrow_payments','payment_requests','payments','payment_receipts',
    'payment_intents','subscriptions','subscription_receipts','subscription_events','subscription_plans',
    'wallets','wallet_transactions','withdrawal_bank_accounts','withdrawals',
    'coordinators','coordinator_assignments','coordinator_applications','coordinator_codes',
    'local_tasker_profiles','local_tasker_consents','local_tasker_photos','identity_verifications','support_staff')
order by table_name, ordinal_position;

-- ============================================================
-- Block 4: support_staff and any existing admin table: columns and the NUMBER of rows (no names)
-- ============================================================
select 'support_staff' as what, count(*)::text as value from public.support_staff
union all
select 'users by role: ' || coalesce(role::text,'(null)'), count(*)::text from public.users group by role;

-- ============================================================
-- Block 5: functions the admin project will call or must not break (name, arguments, security definer?)
-- ============================================================
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, pg_get_function_result(p.oid) as returns
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'admin\_%' escape '\' or p.proname like 'support\_%' escape '\' or p.proname = '_is_support'
       or p.proname like 'idv\_%' escape '\' or p.proname like 'withdrawal\_%' escape '\'
       or p.proname like 'local\_%' escape '\' or p.proname like 'coordinator\_%' escape '\'
       or p.proname like 'subscription\_%' escape '\' or p.proname like 'referral\_%' escape '\'
       or p.proname like 'gift\_%' escape '\'
       or p.proname in ('payment_finalize','platform_fee_rate_for_booking','get_my_entitlements','get_public_plans',
                        'get_subscription_quote','apply_due_subscription_changes','is_coordinator','is_active_coordinator',
                        'my_coordinator_plan','my_coordinator_upgrades','report_contact_violation','add_my_role',
                        'switch_my_role','pay_with_wallet','featured_taskers','membership_for_users'))
order by p.proname;

-- ============================================================
-- Block 6: full source of the functions that decide permission today (needed to build admin_has safely)
-- ============================================================
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('_is_support','is_coordinator','is_active_coordinator','is_local_tasker_admin',
                    'support_list_disputes','support_resolve_dispute','platform_fee_rate_for_booking');

-- ============================================================
-- Block 7: row level security policies on the tables that hold money, identity and private data
-- ============================================================
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('users','taskers','bookings','escrow_payments','payment_requests','payments','wallets',
                    'wallet_transactions','withdrawal_bank_accounts','job_disputes','dispute_events','job_refunds',
                    'job_attachments','notifications','coordinators','coordinator_assignments',
                    'local_tasker_profiles','identity_verifications','support_staff','subscriptions',
                    'subscription_receipts','gift_cards','gift_card_orders')
order by tablename, policyname;

-- ============================================================
-- Block 8: what the browser roles (anon, authenticated) may do directly on tables
-- ============================================================
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
group by table_name, grantee
order by table_name, grantee;

-- ============================================================
-- Block 9: status values allowed by check constraints (bookings, disputes, payments, subscriptions...)
-- ============================================================
select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
  and (pg_get_constraintdef(oid) ilike '%status%' or pg_get_constraintdef(oid) ilike '%role%'
       or pg_get_constraintdef(oid) ilike '%purpose%' or pg_get_constraintdef(oid) ilike '%kind%')
order by 1, 2;

-- ============================================================
-- Block 10: enum types and their values
-- ============================================================
select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as values
from pg_type t join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname order by t.typname;

-- ============================================================
-- Block 11: triggers on public tables (so the admin project never fights an existing trigger)
-- ============================================================
select event_object_table as table_name, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- ============================================================
-- Block 12: is the "10 Local Taskers per coordinator" limit already enforced? Look for it in function and trigger text.
-- ============================================================
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (pg_get_functiondef(p.oid) ilike '%coordinator_assignments%')
  and (pg_get_functiondef(p.oid) ilike '%>= 10%' or pg_get_functiondef(p.oid) ilike '%> 10%'
       or pg_get_functiondef(p.oid) ilike '%max_local%' or pg_get_functiondef(p.oid) ilike '%capacity%');

-- ============================================================
-- Block 13: scheduled jobs (pg_cron). If this errors with "schema cron does not exist", paste the error.
-- ============================================================
select jobid, jobname, schedule, active, left(command, 300) as command_start
from cron.job order by jobname;

-- ============================================================
-- Block 14: payment records: which purposes and statuses exist, and how many (counts only)
-- ============================================================
select purpose, status, count(*) as n
from public.payment_intents
group by purpose, status order by purpose, status;

-- ============================================================
-- Block 15: storage buckets and who may touch them
-- ============================================================
select id, name, public, file_size_limit from storage.buckets order by name;

select policyname, cmd, roles, qual
from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname;

-- ============================================================
-- Block 16: views (the audit reader and dashboards may build on these)
-- ============================================================
select table_name as view_name, left(view_definition, 400) as definition_start
from information_schema.views where table_schema = 'public' order by table_name;

-- ============================================================
-- Block 17: where the platform fee is stored and what rate the code uses (source of "revenue")
-- ============================================================
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (column_name ilike '%platform_fee%' or column_name ilike '%commission%' or column_name ilike '%fee_rate%'
       or column_name ilike '%service_fee%')
order by table_name, column_name;

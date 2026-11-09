-- Stage N1b: READ-ONLY. Run each block, paste ALL results. Needed to confirm phone push + email really fire, and for the job-day reminders.

-- Block 1: every trigger on notifications (a database webhook for push/email shows up here as supabase_functions.http_request)
select tgname, pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid = 'public.notifications'::regclass and not tgisinternal;

-- Block 2: constraints on notifications (a CHECK on "type" would silently drop my new types)
select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.notifications'::regclass;
select pg_get_functiondef(p.oid) as source from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_notify';

-- Block 3: columns of notifications, notification_preferences, push_subscriptions
select table_name, column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name in ('notifications', 'notification_preferences', 'push_subscriptions') order by table_name, ordinal_position;

-- Block 4: the job day and time (for reminders)
select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name ilike any (array['%time%','%date%','%schedul%']);
select id, scheduled_time, status, created_at from public.bookings order by created_at desc limit 8;

-- Block 5: the function that assigns a coordinator when a booking is made
select pg_get_functiondef(p.oid) as source from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('local_booking_assign_on_insert', '_local_booking_current_coordinator', 'open_local_thread');

-- Block 6: coordinators table columns (does it have display_name, phone, email?)
select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'coordinators' order by ordinal_position;

-- Stage N1 (notifications): READ-ONLY. Changes nothing. Run each block in the Supabase SQL editor and paste ALL results to the next AI.
-- Needed to make a new booking notify the coordinator on the phone and by email, and to make coordinator/customer chat messages notify.

-- Block 1: the notifications table, its triggers, and its policies
select column_name, data_type, column_default from information_schema.columns where table_schema='public' and table_name='notifications' order by ordinal_position;
select tgname, pg_get_triggerdef(t.oid) as definition from pg_trigger t where tgrelid='public.notifications'::regclass and not tgisinternal;
select policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename='notifications';

-- Block 2: push and email preference tables
select table_name, column_name, data_type from information_schema.columns
where table_schema='public' and table_name in ('push_subscriptions','notification_preferences') order by table_name, ordinal_position;
select proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('push_save_subscription','notify_user','create_notification','_notify','send_notification');

-- Block 3: every trigger on the booking and chat tables (who creates notifications today)
select c.relname as table_name, tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not tgisinternal
  and (c.relname ilike '%booking%' or c.relname ilike '%message%' or c.relname ilike '%thread%' or c.relname ilike '%chat%' or c.relname ilike '%assignment%');

-- Block 4: every function that inserts into notifications (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%insert into%notifications%';

-- Block 5: coordinator chat functions (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('coordinator_chat_list','coordinator_chat_thread','coordinator_send_message','coordinator_add_note','coordinator_chat_mark_read','_local_booking_follow_assignment','local_booking_on_assignment_change');

-- Block 6: database webhooks / pg_net calls that send push or email (so we know what already fires)
select tgname, tgrelid::regclass as table_name, pg_get_triggerdef(oid) as definition
from pg_trigger where not tgisinternal and (pg_get_triggerdef(oid) ilike '%supabase_functions%' or pg_get_triggerdef(oid) ilike '%http_request%');
select jobid, schedule, command from cron.job;   -- ignore the error if pg_cron is not on

-- Block 7: last 15 notifications of the owner's coordinator account (shows which types the coordinator really receives)
select type, title, left(message,80) as message, data, is_read, created_at from public.notifications
where user_id='6d9390b4-5106-451e-a464-d5e4ac4a2c77' order by created_at desc limit 15;

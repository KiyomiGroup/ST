-- Stage B1-B4 (booking flow): READ-ONLY. Changes nothing. Run each block and paste ALL results to the next AI.

-- Block 1: booking state machine functions (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('_local_booking_transition','local_booking_step','local_booking_send_quote','local_booking_record_confirmation','local_booking_submit_code','local_booking_code_state','local_booking_detail','local_booking_list','local_booking_record_milestone','local_booking_closeout','coordinator_chat_cards','coordinator_chat_activity');

-- Block 2: tables and columns for bookings, quotes, payments, escrow/release, chat threads
select table_name, column_name, data_type from information_schema.columns
where table_schema='public' and (table_name ilike 'local_booking%' or table_name in ('bookings','payments','payment_requests','message_threads','messages','tasks','wallet_transactions','escrow'))
order by table_name, ordinal_position;

-- Block 3: payment decline handling and the payout wait (the countdown)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (pg_get_functiondef(p.oid) ilike '%payout_due%' or pg_get_functiondef(p.oid) ilike '%release_at%' or pg_get_functiondef(p.oid) ilike '%declin%payment%' or pg_get_functiondef(p.oid) ilike '%payment_failed%' or pg_get_functiondef(p.oid) ilike '%room_closed%');

-- Block 4: when a task leaves the site today (tasks.status values and who sets them)
select status, count(*) from public.tasks group by 1;
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%update public.tasks%set status%';

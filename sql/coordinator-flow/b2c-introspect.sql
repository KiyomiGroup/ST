-- Stage B2c: READ-ONLY. Changes nothing. Run ONE block at a time: copy ONLY the single "select" line under a block's comment (each block is one line, no line breaks), paste it, press Run, and paste the full result back.
-- Block 7 (cancel notifications) already returned no rows, so it is dropped. Blocks 1, 3 and 5 are unchanged in meaning.

-- Block 1: cancel-related functions (full source)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as source from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('local_booking_cancel','local_booking_closeout','_local_booking_cancel_block','job_cancel','_local_booking_create_requests','price_respond','_local_booking_is_open','job_booking_frozen');

-- Block 2: other functions that touch a cancelled booking, task or chat room (names only)
select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (case when p.prokind = 'f' then pg_get_functiondef(p.oid) end) ~* '(room_closed|local_booking_cancellations|status *= *''cancelled'')' order by 1;

-- Block 3: triggers on the tables this touches
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition, p.proname as function_name from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid where n.nspname = 'public' and not t.tgisinternal and c.relname in ('tasks','bookings','message_threads','messages','local_booking_cancellations','job_requests','payment_requests') order by 1, 2;

-- Block 4: source of the trigger functions on tasks, bookings, message_threads and local_booking_cancellations
select distinct p.proname, pg_get_functiondef(p.oid) as source from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid where n.nspname = 'public' and not t.tgisinternal and c.relname in ('tasks','bookings','message_threads','local_booking_cancellations');

-- Block 5a: columns of the cancellation table and of message_threads
select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name in ('local_booking_cancellations','message_threads') order by table_name, ordinal_position;

-- Block 5b: check constraints (the allowed cancel reasons and statuses)
select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.local_booking_cancellations'::regclass, 'public.message_threads'::regclass, 'public.tasks'::regclass) and contype = 'c';

-- Block 6: statuses in use today for tasks and bookings (message_threads has no "status" column, so it is left out)
select 'tasks' as t, status::text as status, count(*) from public.tasks group by 2 union all select 'bookings', status::text, count(*) from public.bookings group by 2;

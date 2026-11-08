-- Rollback for stage A6: removes the three reader functions only. Changes no data and no log.
drop function if exists public.admin_activity_detail(bigint);
drop function if exists public.admin_activity_feed(text, text, text, timestamptz, timestamptz, boolean, int, int);
drop function if exists public.admin_feed_expr(jsonb);

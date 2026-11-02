-- ============================================================
-- StreetTasker notifications: turn on Realtime for the notifications table
-- File:    sql/notifications-realtime.sql
-- Run in:  Supabase dashboard > SQL Editor.  Safe to run more than once.
--
-- Why: js/notifications-panel.js listens for new rows in `notifications` so the red dot and the sound
-- happen the moment a message, booking or payment notification is created. Supabase only sends those live
-- events for tables that are in the `supabase_realtime` publication, and no earlier SQL file added this one.
-- Without it the site falls back to a check every 15 seconds (still works, just not instant).
--
-- Not changed: who can read notifications (the existing row-level security still decides; a person only
-- receives live events for rows they are allowed to read, and the page also filters on user_id).
-- ============================================================

do $$
begin
  if to_regclass('public.notifications') is null then
    raise exception 'public.notifications does not exist. Nothing was changed.';
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Quick check: this should return one row, 'notifications'
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications';

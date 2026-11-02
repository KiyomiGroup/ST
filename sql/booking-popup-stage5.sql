-- ============================================================
-- StreetTasker booking pop-up, Stage 5: REAL COLUMNS + PRIVATE STREET ADDRESS
-- File:    sql/booking-popup-stage5.sql
-- Run in:  Supabase dashboard > SQL Editor (staging first).  Safe to run more than once.
-- Order:   after sql/messaging-step6a.sql (it uses the bookings table and its guard trigger).
-- Deploy:  run this SQL first, then upload the front-end files from ST-booking-stage5.zip.
--
-- What it does
--   1. bookings gets job_title, job_description, job_area, job_urgency, job_photos.
--      Customers can write them when they send a request (the bookings guard trigger leaves them alone).
--   2. booking_private holds the optional street address / landmark.
--      - the customer who made the booking can add and read it
--      - the tasker can read it ONLY once the booking is past "pending" (confirmed and later)
--      - nobody can edit or delete it from the browser
-- Not changed: bookings.amount (still set only by the payment system).
-- ============================================================

-- 1. Job details on bookings ------------------------------------------------
alter table public.bookings add column if not exists job_title       text;
alter table public.bookings add column if not exists job_description text;
alter table public.bookings add column if not exists job_area        text;
alter table public.bookings add column if not exists job_urgency     text;
alter table public.bookings add column if not exists job_photos      text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_job_urgency_check') then
    alter table public.bookings
      add constraint bookings_job_urgency_check check (job_urgency is null or job_urgency in ('flexible', 'urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_job_photos_max') then
    alter table public.bookings
      add constraint bookings_job_photos_max check (coalesce(array_length(job_photos, 1), 0) <= 5);
  end if;
end $$;

-- 2. Private street address ---------------------------------------------------
create table if not exists public.booking_private (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  address    text not null check (char_length(address) between 1 and 160),
  created_at timestamptz not null default now()
);

alter table public.booking_private enable row level security;

revoke all on public.booking_private from anon, authenticated;
grant select, insert on public.booking_private to authenticated;   -- no update, no delete

drop policy if exists booking_private_customer_insert on public.booking_private;
create policy booking_private_customer_insert on public.booking_private
  for insert to authenticated
  with check (exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()));

drop policy if exists booking_private_customer_select on public.booking_private;
create policy booking_private_customer_select on public.booking_private
  for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()));

-- The tasker sees the address only after the booking has moved past "pending"
-- (same status names the Bookings pages use). A cancelled booking never shows it.
drop policy if exists booking_private_tasker_select on public.booking_private;
create policy booking_private_tasker_select on public.booking_private
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_id
      and b.tasker_id = auth.uid()
      and b.status in ('confirmed', 'in_progress', 'awaiting_confirmation', 'awaiting_code', 'provider_done', 'completed', 'disputed')
  ));

-- 3. Quick check (run after the above; both should return rows/zero errors)
--   select column_name from information_schema.columns where table_name = 'bookings' and column_name like 'job\_%';
--   select policyname from pg_policies where tablename = 'booking_private';

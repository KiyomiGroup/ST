-- ============================================================
-- Sprint 3.5 — Fix bookings FK constraints
-- Run this in Supabase SQL Editor if you get FK errors on booking
-- ============================================================

-- Ensure bookings table customer_id and tasker_id reference auth.users
-- (not public.users), so OAuth users can book without a public profile row first.

-- Step 1: Drop the old FK constraints
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_customer_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_tasker_id_fkey;

-- Step 2: Re-add them pointing to auth.users
ALTER TABLE bookings
  ADD CONSTRAINT bookings_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_tasker_id_fkey
  FOREIGN KEY (tasker_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Done!
SELECT 'Bookings FK fix complete ✓' AS status;

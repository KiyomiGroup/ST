-- ================================================================
-- Migration: Add rate_unit column to services table
-- Run this once in your Supabase SQL editor (or psql).
-- ================================================================

-- 1. Add rate_unit column (text, optional, defaults to '/hour')
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS rate_unit TEXT NOT NULL DEFAULT '/hour';

-- 2. Back-fill existing rows from pricing_type if rate_unit is still default
UPDATE services
SET rate_unit = CASE pricing_type
  WHEN 'per_hour'    THEN '/hour'
  WHEN 'per_day'     THEN '/day'
  WHEN 'per_job'     THEN '/job'
  WHEN 'per_service' THEN '/service'
  WHEN 'per_week'    THEN '/week'
  WHEN 'per_month'   THEN '/month'
  ELSE '/job'
END
WHERE rate_unit = '/hour' AND pricing_type IS NOT NULL;

-- 3. (Optional) Add a check constraint so only known units are stored
-- Remove the constraint line below if you want to allow free-text units.
-- ALTER TABLE services
--   ADD CONSTRAINT chk_rate_unit
--   CHECK (rate_unit IN ('/hour','/day','/job','/service','/visit','/session','/week','/month'));

-- Done. The services table now has:
--   price     NUMERIC  — clean number, e.g. 30000
--   rate_unit TEXT     — unit string, e.g. '/hour'

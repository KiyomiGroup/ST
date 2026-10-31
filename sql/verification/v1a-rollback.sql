-- Rollback for v1a-tables.sql. DELETES every row in the two tables (sandbox and live).
-- Only run before any real verification exists, or after exporting what you need.
-- Touches nothing outside the objects v1a-tables.sql created.

begin;
drop table if exists public.identity_verification_events;
drop table if exists public.identity_verifications;   -- also drops its trigger and indexes
drop function if exists public.idv_touch_updated_at();
commit;

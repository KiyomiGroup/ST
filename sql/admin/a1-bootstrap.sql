-- StreetTasker Admin Control Centre, stage A1: create the first Super Admin.
-- Run a1-admin-core.sql FIRST. Run this statement alone in the Supabase SQL editor.
-- It is safe to run twice. The answer is a sentence: read it.
-- The third value (true) is the owner's decision (2026-11-08) to use admin@streettasker.com for BOTH
-- the coordinator account and the admin area.
select public.admin_bootstrap_super_admin('admin@streettasker.com', 'StreetTasker Super Admin', true);

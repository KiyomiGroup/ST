-- ================================================================
-- Migration: Sprint 3 Bug Fixes
-- Run this in your Supabase SQL editor BEFORE deploying.
-- ================================================================

-- 1. Add photo_urls column to tasks table (stores uploaded image URLs)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT NULL;

-- 2. Ensure customer_id column exists (for task ownership queries)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Back-fill customer_id from user_id where missing
UPDATE tasks SET customer_id = user_id
WHERE customer_id IS NULL AND user_id IS NOT NULL;

-- 4. Create index for fast user task queries
CREATE INDEX IF NOT EXISTS idx_tasks_customer_id ON tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id     ON tasks(user_id);

-- ================================================================
-- Supabase Storage: Create 'task-images' bucket
-- Run this in Supabase Dashboard → Storage → New Bucket:
--   Name:        task-images
--   Public:      true
--   File limit:  5 MB
-- Or run the SQL below if you have storage schema access:
-- ================================================================

-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('task-images', 'task-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
-- ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policy (run in SQL editor):
-- CREATE POLICY "Authenticated users can upload task images"
-- ON storage.objects FOR INSERT TO authenticated
-- WITH CHECK (bucket_id = 'task-images');

-- CREATE POLICY "Task images are publicly readable"
-- ON storage.objects FOR SELECT TO public
-- USING (bucket_id = 'task-images');

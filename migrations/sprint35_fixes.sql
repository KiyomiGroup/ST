-- ============================================================
-- Sprint 3.5 Fixes Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Ensure task_applications table exists with correct columns
CREATE TABLE IF NOT EXISTS task_applications (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id     uuid REFERENCES tasks(id) ON DELETE CASCADE,
  tasker_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  message     text,
  status      text DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at  timestamptz DEFAULT now()
);

-- 2. Ensure notifications table exists
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text,
  message     text,
  data        jsonb DEFAULT '{}',
  read        boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

-- 3. Ensure users table has bio, avatar_url columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio       text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

-- 4. Ensure tasks table has lat/lon
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS latitude  numeric;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS longitude numeric;

-- 5. Ensure posts table has image_url
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url text;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_task_applications_task_id   ON task_applications(task_id);
CREATE INDEX IF NOT EXISTS idx_task_applications_tasker_id ON task_applications(tasker_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id       ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread        ON notifications(user_id, read) WHERE read = false;

-- 7. RLS on task_applications
ALTER TABLE task_applications ENABLE ROW LEVEL SECURITY;

-- Taskers can insert applications
DROP POLICY IF EXISTS "taskers can apply"           ON task_applications;
CREATE POLICY "taskers can apply" ON task_applications
  FOR INSERT TO authenticated
  WITH CHECK (tasker_id = auth.uid());

-- Taskers see their own applications
DROP POLICY IF EXISTS "tasker sees own apps"        ON task_applications;
CREATE POLICY "tasker sees own apps" ON task_applications
  FOR SELECT TO authenticated
  USING (tasker_id = auth.uid());

-- Task owners see applications to their tasks
DROP POLICY IF EXISTS "task owner sees apps"        ON task_applications;
CREATE POLICY "task owner sees apps" ON task_applications
  FOR SELECT TO authenticated
  USING (
    task_id IN (
      SELECT id FROM tasks
      WHERE customer_id = auth.uid() OR user_id = auth.uid()
    )
  );

-- Task owners can update application status (accept/reject)
DROP POLICY IF EXISTS "task owner updates apps"     ON task_applications;
CREATE POLICY "task owner updates apps" ON task_applications
  FOR UPDATE TO authenticated
  USING (
    task_id IN (
      SELECT id FROM tasks
      WHERE customer_id = auth.uid() OR user_id = auth.uid()
    )
  );

-- 8. RLS on notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user sees own notifs"        ON notifications;
CREATE POLICY "user sees own notifs" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user updates own notifs"     ON notifications;
CREATE POLICY "user updates own notifs" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Allow authenticated users to insert notifications (needed for applyToTask)
DROP POLICY IF EXISTS "authenticated insert notifs" ON notifications;
CREATE POLICY "authenticated insert notifs" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 9. RLS on users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read all"          ON users;
CREATE POLICY "users can read all" ON users
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "users can update own"        ON users;
CREATE POLICY "users can update own" ON users
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- 10. RLS on posts  
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone reads posts"          ON posts;
CREATE POLICY "anyone reads posts" ON posts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated can post"      ON posts;
CREATE POLICY "authenticated can post" ON posts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 11. Storage buckets (run once, safe to re-run)
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-images', 'post-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-images', 'profile-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "post images public read"    ON storage.objects;
CREATE POLICY "post images public read" ON storage.objects
  FOR SELECT USING (bucket_id IN ('post-images', 'profile-images'));

DROP POLICY IF EXISTS "authenticated upload images" ON storage.objects;
CREATE POLICY "authenticated upload images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('post-images', 'profile-images', 'task-images'));

DROP POLICY IF EXISTS "authenticated update images" ON storage.objects;
CREATE POLICY "authenticated update images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('post-images', 'profile-images', 'task-images'));

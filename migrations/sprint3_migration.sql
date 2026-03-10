-- ============================================================
-- Street Taskers — Sprint 3.4 Migration
-- Run this in Supabase SQL Editor before deploying files
-- ============================================================

-- 1. Add rate_unit column to services (safe to run multiple times)
ALTER TABLE services ADD COLUMN IF NOT EXISTS rate_unit TEXT DEFAULT '/hour';

-- 2. Add customer_id column to tasks (safe to run multiple times)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Add photo_urls column to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT NULL;

-- 4. Backfill customer_id from user_id
UPDATE tasks SET customer_id = user_id WHERE customer_id IS NULL AND user_id IS NOT NULL;

-- 5. Create task_applications table
CREATE TABLE IF NOT EXISTS task_applications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tasker_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(task_id, tasker_id)
);

-- 6. Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT,
  data        JSONB DEFAULT '{}',
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_customer_id ON tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_task_applications_task_id ON task_applications(task_id);
CREATE INDEX IF NOT EXISTS idx_task_applications_tasker_id ON task_applications(tasker_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

-- 8. RLS policies for task_applications
ALTER TABLE task_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "taskers can apply" ON task_applications;
CREATE POLICY "taskers can apply" ON task_applications
  FOR INSERT WITH CHECK (auth.uid() = tasker_id);

DROP POLICY IF EXISTS "tasker sees own apps" ON task_applications;
CREATE POLICY "tasker sees own apps" ON task_applications
  FOR SELECT USING (auth.uid() = tasker_id);

DROP POLICY IF EXISTS "task owner sees apps" ON task_applications;
CREATE POLICY "task owner sees apps" ON task_applications
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM tasks WHERE id = task_id
      UNION
      SELECT customer_id FROM tasks WHERE id = task_id
    )
  );

DROP POLICY IF EXISTS "task owner updates apps" ON task_applications;
CREATE POLICY "task owner updates apps" ON task_applications
  FOR UPDATE USING (
    auth.uid() IN (
      SELECT user_id FROM tasks WHERE id = task_id
      UNION
      SELECT customer_id FROM tasks WHERE id = task_id
    )
  );

-- 9. RLS policies for notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user sees own notifs" ON notifications;
CREATE POLICY "user sees own notifs" ON notifications
  FOR ALL USING (auth.uid() = user_id);

-- 10. Allow service role to insert notifications (for background notifs)
-- (The anon key can still insert because db.js runs as the logged-in user)

-- Done!
SELECT 'Migration complete ✓' AS status;

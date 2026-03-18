-- ============================================================
-- StreetTasker — Security & Data Integrity Fixes
-- Run this entire file in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to run multiple times — all statements use IF NOT EXISTS / OR REPLACE / DROP IF EXISTS
-- ============================================================

-- ============================================================
-- PART 1: ROW LEVEL SECURITY ON UNPROTECTED TABLES
-- ============================================================

-- ── 1a. TASKS ────────────────────────────────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Any logged-in user can read open tasks (browse the marketplace)
DROP POLICY IF EXISTS "tasks: authenticated read open" ON tasks;
CREATE POLICY "tasks: authenticated read open" ON tasks
  FOR SELECT
  TO authenticated
  USING (status = 'open' OR customer_id = auth.uid() OR user_id = auth.uid());

-- Only the task owner can insert
DROP POLICY IF EXISTS "tasks: owner insert" ON tasks;
CREATE POLICY "tasks: owner insert" ON tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid() OR user_id = auth.uid());

-- Only the task owner can update their own task
DROP POLICY IF EXISTS "tasks: owner update" ON tasks;
CREATE POLICY "tasks: owner update" ON tasks
  FOR UPDATE
  TO authenticated
  USING (customer_id = auth.uid() OR user_id = auth.uid());

-- Only the task owner can delete their own task
DROP POLICY IF EXISTS "tasks: owner delete" ON tasks;
CREATE POLICY "tasks: owner delete" ON tasks
  FOR DELETE
  TO authenticated
  USING (customer_id = auth.uid() OR user_id = auth.uid());


-- ── 1b. SERVICES ─────────────────────────────────────────────
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- Any logged-in user can read active services
DROP POLICY IF EXISTS "services: authenticated read active" ON services;
CREATE POLICY "services: authenticated read active" ON services
  FOR SELECT
  TO authenticated
  USING (status = 'active' OR user_id = auth.uid());

-- Only taskers can insert services (role check via users table)
DROP POLICY IF EXISTS "services: tasker insert" ON services;
CREATE POLICY "services: tasker insert" ON services
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'tasker'
    )
  );

-- Only the service owner can update
DROP POLICY IF EXISTS "services: owner update" ON services;
CREATE POLICY "services: owner update" ON services
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Only the service owner can delete
DROP POLICY IF EXISTS "services: owner delete" ON services;
CREATE POLICY "services: owner delete" ON services
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── 1c. BOOKINGS ─────────────────────────────────────────────
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Only the two parties involved can see a booking
DROP POLICY IF EXISTS "bookings: parties read" ON bookings;
CREATE POLICY "bookings: parties read" ON bookings
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid() OR tasker_id = auth.uid());

-- Only a customer can create a booking (they must be the customer_id)
DROP POLICY IF EXISTS "bookings: customer insert" ON bookings;
CREATE POLICY "bookings: customer insert" ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

-- Either party can update the booking status (confirm, complete, cancel)
DROP POLICY IF EXISTS "bookings: parties update" ON bookings;
CREATE POLICY "bookings: parties update" ON bookings
  FOR UPDATE
  TO authenticated
  USING (customer_id = auth.uid() OR tasker_id = auth.uid());


-- ── 1d. FEED_POSTS ───────────────────────────────────────────
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read feed posts
DROP POLICY IF EXISTS "feed_posts: authenticated read" ON feed_posts;
CREATE POLICY "feed_posts: authenticated read" ON feed_posts
  FOR SELECT
  TO authenticated
  USING (true);

-- Only the author can insert their own post
DROP POLICY IF EXISTS "feed_posts: author insert" ON feed_posts;
CREATE POLICY "feed_posts: author insert" ON feed_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Only the author can update their own post (e.g. edit caption)
DROP POLICY IF EXISTS "feed_posts: author update" ON feed_posts;
CREATE POLICY "feed_posts: author update" ON feed_posts
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Only the author can delete their own post
DROP POLICY IF EXISTS "feed_posts: author delete" ON feed_posts;
CREATE POLICY "feed_posts: author delete" ON feed_posts
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ── 1e. TASKERS ──────────────────────────────────────────────
ALTER TABLE taskers ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read tasker profiles (browse marketplace)
DROP POLICY IF EXISTS "taskers: authenticated read" ON taskers;
CREATE POLICY "taskers: authenticated read" ON taskers
  FOR SELECT
  TO authenticated
  USING (true);

-- Only the tasker can update their own profile
DROP POLICY IF EXISTS "taskers: owner update" ON taskers;
CREATE POLICY "taskers: owner update" ON taskers
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR id::text = auth.uid()::text);

-- Only the tasker themselves can insert (via signup flow)
DROP POLICY IF EXISTS "taskers: owner insert" ON taskers;
CREATE POLICY "taskers: owner insert" ON taskers
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR id::text = auth.uid()::text);


-- ── 1f. COMMENTS ─────────────────────────────────────────────
-- Add RLS to comments table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'comments') THEN
    EXECUTE 'ALTER TABLE comments ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "comments: authenticated read" ON comments';
    EXECUTE 'CREATE POLICY "comments: authenticated read" ON comments
      FOR SELECT TO authenticated USING (true)';

    EXECUTE 'DROP POLICY IF EXISTS "comments: author insert" ON comments';
    EXECUTE 'CREATE POLICY "comments: author insert" ON comments
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())';

    EXECUTE 'DROP POLICY IF EXISTS "comments: author delete" ON comments';
    EXECUTE 'CREATE POLICY "comments: author delete" ON comments
      FOR DELETE TO authenticated USING (user_id = auth.uid())';
  END IF;
END $$;


-- ============================================================
-- PART 2: ATOMIC LIKE FUNCTIONS (replaces client integer write)
-- ============================================================

-- Increment likes atomically — cannot be gamed from client
CREATE OR REPLACE FUNCTION increment_post_likes(post_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE feed_posts
  SET likes = GREATEST(0, COALESCE(likes, 0) + 1)
  WHERE id = post_id;
$$;

-- Decrement likes atomically — floor at 0
CREATE OR REPLACE FUNCTION decrement_post_likes(post_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE feed_posts
  SET likes = GREATEST(0, COALESCE(likes, 0) - 1)
  WHERE id = post_id;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION increment_post_likes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_post_likes(uuid) TO authenticated;


-- ============================================================
-- PART 3: CAPTION LENGTH CONSTRAINT ON FEED_POSTS
-- ============================================================

-- Enforce max 2000 chars on feed post content at DB level
ALTER TABLE feed_posts
  DROP CONSTRAINT IF EXISTS feed_posts_content_length;

ALTER TABLE feed_posts
  ADD CONSTRAINT feed_posts_content_length
  CHECK (
    (content IS NULL OR char_length(content) <= 2000)
    AND
    (caption IS NULL OR char_length(caption) <= 2000)
  );


-- ============================================================
-- PART 4: UPDATED_AT COLUMNS ON ALL MUTABLE TABLES
-- ============================================================

-- Add updated_at to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add updated_at to services
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add updated_at to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add updated_at to feed_posts
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add updated_at to taskers
ALTER TABLE taskers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create the moddatetime trigger function
-- (moddatetime extension must be enabled — run: CREATE EXTENSION IF NOT EXISTS moddatetime;)
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- Attach triggers to update updated_at automatically on every row update
DROP TRIGGER IF EXISTS set_updated_at_tasks     ON tasks;
DROP TRIGGER IF EXISTS set_updated_at_services  ON services;
DROP TRIGGER IF EXISTS set_updated_at_bookings  ON bookings;
DROP TRIGGER IF EXISTS set_updated_at_feed_posts ON feed_posts;
DROP TRIGGER IF EXISTS set_updated_at_taskers   ON taskers;

CREATE TRIGGER set_updated_at_tasks
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER set_updated_at_services
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER set_updated_at_bookings
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER set_updated_at_feed_posts
  BEFORE UPDATE ON feed_posts
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER set_updated_at_taskers
  BEFORE UPDATE ON taskers
  FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');


-- ============================================================
-- PART 5: STORAGE BUCKET POLICIES
-- ============================================================

-- Create dedicated post-images bucket (separate from service-images)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-images',
  'post-images',
  true,
  5242880,   -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Update service-images bucket to enforce MIME types and size
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'service-images',
  'service-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Update profile-images bucket to enforce MIME types and size
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-images',
  'profile-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Update task-images bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-images',
  'task-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS policies for post-images bucket
DROP POLICY IF EXISTS "post-images: public read"        ON storage.objects;
DROP POLICY IF EXISTS "post-images: authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "post-images: owner delete"       ON storage.objects;

CREATE POLICY "post-images: public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-images');

CREATE POLICY "post-images: authenticated upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = 'feed'
  );

CREATE POLICY "post-images: owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'post-images'
    AND owner = auth.uid()
  );


-- ============================================================
-- PART 6: FIX RLS ON posts TABLE (align with feed_posts)
-- ============================================================

-- The sprint35 migration applied RLS to 'posts' but the app uses 'feed_posts'.
-- Apply the same policies to 'posts' in case it's ever used, and note the discrepancy.
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'posts') THEN
    EXECUTE 'ALTER TABLE posts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "posts: authenticated read" ON posts';
    EXECUTE 'CREATE POLICY "posts: authenticated read" ON posts FOR SELECT TO authenticated USING (true)';
    EXECUTE 'DROP POLICY IF EXISTS "posts: author insert" ON posts';
    EXECUTE 'CREATE POLICY "posts: author insert" ON posts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())';
  END IF;
END $$;


-- ============================================================
-- PART 7: PERFORMANCE INDEXES
-- ============================================================

-- Index for booking lookups by both parties
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tasker_id   ON bookings(tasker_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status      ON bookings(status);

-- Index for service lookups
CREATE INDEX IF NOT EXISTS idx_services_user_id     ON services(user_id);
CREATE INDEX IF NOT EXISTS idx_services_category    ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_status      ON services(status);

-- Index for feed posts
CREATE INDEX IF NOT EXISTS idx_feed_posts_user_id   ON feed_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_created   ON feed_posts(created_at DESC);

-- Index for comments
CREATE INDEX IF NOT EXISTS idx_comments_post_id     ON comments(post_id);


-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('tasks','services','bookings','feed_posts','taskers','users','task_applications','notifications','comments')
ORDER BY tablename;

/* ============================================================
   STREET TASKER — db.js
   Sprint 3: Database access layer — all Supabase queries
   ============================================================
   All database reads/writes go through this module.
   No page file should call window.supabase directly —
   always import a function from here to keep queries central.

   Future Sprint: Add pagination, real-time subscriptions,
   PostGIS location filtering, full-text search.
   ============================================================ */

'use strict';

/* ── Tasks ───────────────────────────────────────────────────── */

/**
 * Inserts a new task into the `tasks` table.
 * Requires an authenticated session (customer_id = current user).
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {number} opts.budget
 * @param {string} opts.location
 * @param {string} opts.deadline    ISO date string
 * @param {string} [opts.category]
 * @returns {Promise<Object>} Inserted task row
 */
async function postTask({ title, description, budget, location, deadline, category = '' }) {
  const { data: { user }, error: userErr } = await window.supabase.auth.getUser();
  if (userErr || !user) throw new Error('You must be logged in to post a task.');

  const { data, error } = await window.supabase
    .from('tasks')
    .insert({
      customer_id: user.id,
      title:       title.trim(),
      description: description.trim(),
      budget:      parseFloat(budget),
      location:    location.trim(),
      deadline:    new Date(deadline).toISOString(),
      category:    category || null,
      status:      'open',
    })
    .select()
    .single();

  if (error) throw error;
  console.log('[DB] Task posted:', data.id);
  return data;
}

/**
 * Fetches open tasks, optionally filtered by location keyword.
 *
 * Future Sprint: Add PostGIS radius filter and full-text search.
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit=20]
 * @returns {Promise<Array>}
 */
async function fetchTasks({ limit = 20 } = {}) {
  const { data, error } = await window.supabase
    .from('tasks')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/* ── Taskers ─────────────────────────────────────────────────── */

/**
 * Fetches tasker profiles from the `taskers` table.
 * Falls back to empty array if table is empty (placeholders used instead).
 *
 * Future Sprint: Join with reviews table for aggregated ratings,
 * add PostGIS distance filter using user's coordinates.
 *
 * @param {Object} [opts]
 * @param {string} [opts.category]   Filter by service category
 * @param {number} [opts.limit=50]
 * @returns {Promise<Array>}
 */
async function fetchTaskers({ category = '', limit = 50 } = {}) {
  let query = window.supabase
    .from('taskers')
    .select('*')
    .order('rating', { ascending: false })
    .limit(limit);

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/* ── Bookings ────────────────────────────────────────────────── */

/**
 * Creates a booking record in the `bookings` table.
 * Requires an authenticated session.
 *
 * Before inserting, checks if the tasker has exceeded 5 free tasks
 * and has no active subscription — enforces the paywall gate.
 *
 * @param {Object} opts
 * @param {string} opts.taskerId
 * @param {string} [opts.taskId]
 * @param {string} [opts.scheduledTime]  ISO datetime string
 * @returns {Promise<Object>} Inserted booking row
 */
async function createBooking({ taskerId, taskId = null, scheduledTime = null }) {
  const { data: { user }, error: userErr } = await window.supabase.auth.getUser();
  if (userErr || !user) throw new Error('You must be logged in to book a tasker.');

  /* ── Subscription gate check ── */
  const allowed = await checkTaskerCanAcceptBooking(taskerId);
  if (!allowed) {
    throw new Error('SUBSCRIPTION_REQUIRED');
  }

  const { data, error } = await window.supabase
    .from('bookings')
    .insert({
      customer_id:    user.id,
      tasker_id:      taskerId,
      task_id:        taskId,
      status:         'pending',
      scheduled_time: scheduledTime || null,
    })
    .select()
    .single();

  if (error) throw error;
  console.log('[DB] Booking created:', data.id);
  return data;
}

/**
 * Fetches all bookings for the current authenticated user.
 *
 * Future Sprint: Paginate, filter by status, join tasker info.
 */
async function fetchMyBookings() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await window.supabase
    .from('bookings')
    .select('*, taskers(*)')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/* ── Subscriptions / Paywall Gate ────────────────────────────── */

/**
 * Checks whether a tasker is allowed to accept new bookings.
 * Rule: free up to 5 completed bookings; after that needs active subscription.
 *
 * @param {string} taskerId
 * @returns {Promise<boolean>}
 */
async function checkTaskerCanAcceptBooking(taskerId) {
  /* 1. Check if tasker has an active subscription */
  const { data: sub } = await window.supabase
    .from('subscriptions')
    .select('id, status, end_date')
    .eq('tasker_id', taskerId)
    .eq('status', 'active')
    .gt('end_date', new Date().toISOString())
    .maybeSingle();

  if (sub) return true; /* Active subscription — allowed */

  /* 2. Count completed/pending bookings for this tasker */
  const { count, error } = await window.supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('tasker_id', taskerId)
    .in('status', ['pending', 'confirmed', 'completed']);

  if (error) {
    console.warn('[DB] Could not check tasker booking count:', error.message);
    return true; /* Fail open — don't block if we can't verify */
  }

  const FREE_TASK_LIMIT = 5;
  return (count || 0) < FREE_TASK_LIMIT;
}

/**
 * Creates or updates a subscription record.
 * NOTE: Payment processing is NOT implemented in Sprint 3.
 * This only stores the subscription intent.
 *
 * Future Sprint: Trigger after successful Paystack webhook.
 *
 * @param {Object} opts
 * @param {string} opts.taskerId
 * @param {'starter'|'pro'} opts.tier
 * @returns {Promise<Object>}
 */
async function createSubscription({ taskerId, tier }) {
  const startDate = new Date();
  const endDate   = new Date(startDate);
  endDate.setDate(endDate.getDate() + 30); /* 30-day sub */

  const { data, error } = await window.supabase
    .from('subscriptions')
    .upsert({
      tasker_id:  taskerId,
      tier,
      status:     'pending_payment', /* Upgraded to 'active' post-payment */
      start_date: startDate.toISOString(),
      end_date:   endDate.toISOString(),
    }, { onConflict: 'tasker_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* ── Social Feed ─────────────────────────────────────────────── */

/**
 * Fetches feed posts from the `feed_posts` table.
 * Ordered by newest first.
 *
 * Future Sprint: Join with users/taskers for author data,
 * join with likes for like counts, add Realtime subscription.
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit=20]
 * @returns {Promise<Array>}
 */
async function fetchFeedPosts({ limit = 20 } = {}) {
  const { data, error } = await window.supabase
    .from('feed_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Inserts a comment on a feed post.
 * Requires an authenticated session.
 *
 * @param {Object} opts
 * @param {string} opts.postId
 * @param {string} opts.body
 * @returns {Promise<Object>}
 */
async function postComment({ postId, body }) {
  const { data: { user }, error: userErr } = await window.supabase.auth.getUser();
  if (userErr || !user) throw new Error('You must be logged in to comment.');

  const { data, error } = await window.supabase
    .from('comments')
    .insert({
      post_id:    postId,
      user_id:    user.id,
      body:       body.trim(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Toggles a like on a feed post.
 * If the user has already liked, it removes the like (unlike).
 *
 * Future Sprint: Move to `likes` table if separate table is used.
 * For now, updates likes count directly on feed_posts row.
 *
 * @param {string} postId
 * @param {number} currentLikes
 * @param {boolean} isLiked  Current liked state from UI
 * @returns {Promise<number>} Updated like count
 */
async function togglePostLike(postId, currentLikes, isLiked) {
  const newCount = isLiked ? Math.max(0, currentLikes - 1) : currentLikes + 1;

  const { error } = await window.supabase
    .from('feed_posts')
    .update({ likes: newCount })
    .eq('id', postId);

  if (error) throw error;
  return newCount;
}

/* ── Expose globally ─────────────────────────────────────────── */
window.ST = window.ST || {};
window.ST.db = {
  postTask,
  fetchTasks,
  fetchTaskers,
  createBooking,
  fetchMyBookings,
  checkTaskerCanAcceptBooking,
  createSubscription,
  fetchFeedPosts,
  postComment,
  togglePostLike,
};

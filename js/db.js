/* ============================================================
   STREET TASKER — db.js  (Sprint 3.2 Final)
   Single source for all Supabase data access.
   No placeholders. All queries fully wired.
   ============================================================ */
'use strict';

/* ─────────────────────────── TASKS ─────────────────────────── */

async function postTask({ title, description, category, budget, location }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post a task.');

  const { data, error } = await window.supabase.from('tasks').insert({
    user_id:     user.id,
    customer_id: user.id,
    title:       title.trim(),
    description: description.trim(),
    category:    category || null,
    budget:      parseFloat(budget) || 0,
    location:    location.trim(),
    status:      'open',
  }).select().single();
  if (error) throw error;
  return data;
}

async function fetchTasks({ limit = 50, category = '' } = {}) {
  let q = window.supabase.from('tasks').select('*')
    .eq('status', 'open').order('created_at', { ascending: false }).limit(limit);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fetchMyTasks() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  /* Try both customer_id and user_id columns */
  const { data, error } = await window.supabase.from('tasks').select('*')
    .or(`customer_id.eq.${user.id},user_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (error) {
    const { data: fallback } = await window.supabase.from('tasks')
      .select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    return fallback || [];
  }
  return data || [];
}

/* ────────────────────────── SERVICES ───────────────────────── */

async function postService({ serviceName, category, price, location, description, photoUrl = null }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post a service.');

  /* Upsert into services table */
  const payload = {
    user_id:      user.id,
    service_name: serviceName.trim(),
    category:     category || 'other',
    price:        parseFloat(price) || 0,
    location:     location.trim(),
    description:  description.trim(),
    photo:        photoUrl || null,
    status:       'active',
  };

  const { data: svc, error: svcErr } = await window.supabase
    .from('services').upsert(payload, { onConflict: 'user_id' }).select().single();

  if (svcErr) {
    /* services table may not exist or may differ — fallback to taskers */
    console.warn('[DB] services upsert:', svcErr.message, '— falling back to taskers');
  }

  /* Always sync taskers table so find-taskers.html shows the listing */
  await window.supabase.from('taskers').upsert({
    id:         user.id,
    user_id:    user.id,
    service:    serviceName.trim(),
    category:   category || 'other',
    rate_value: parseFloat(price) || 0,
    rate:       `₦${Number(price || 0).toLocaleString()}/session`,
    location:   location.trim(),
    bio:        description.trim(),
    photo_url:  photoUrl || null,
    available:  true,
  }, { onConflict: 'id' });

  return svc || payload;
}

async function fetchServices({ category = '', limit = 60 } = {}) {
  /* Try services table first */
  let q = window.supabase.from('services').select(`
    id, service_name, category, price, location, description, photo, user_id, status,
    users ( id, name )
  `).eq('status', 'active').order('created_at', { ascending: false }).limit(limit);
  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (!error && data && data.length > 0) {
    return data.map(s => ({
      id:           String(s.id),
      service_name: s.service_name,
      category:     s.category,
      price:        s.price,
      location:     s.location,
      description:  s.description,
      photo:        s.photo,
      user_id:      s.user_id,
      provider_name: s.users?.name || 'Provider',
    }));
  }

  /* Fallback: taskers table */
  let tq = window.supabase.from('taskers').select('*')
    .order('rating', { ascending: false }).limit(limit);
  if (category) tq = tq.eq('category', category);
  const { data: td, error: te } = await tq;
  if (te) { console.warn('[DB] fetchServices fallback failed:', te.message); return []; }
  return (td || []).filter(t => t.service).map(t => ({
    id:           String(t.id),
    service_name: t.service,
    category:     t.category,
    price:        t.rate_value,
    location:     t.location,
    description:  t.bio,
    photo:        t.photo_url,
    user_id:      t.user_id || t.id,
    provider_name: t.name || 'Provider',
    rating:       t.rating,
    rate:         t.rate,
  }));
}

async function fetchMyServices() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data } = await window.supabase.from('taskers').select('*').eq('user_id', user.id);
  return data || [];
}

async function fetchMyTaskerProfile() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return null;
  const { data } = await window.supabase.from('taskers').select('*').eq('user_id', user.id).maybeSingle();
  return data;
}

/* ─────────────────────────── BOOKINGS ──────────────────────── */

async function createBooking({ taskerId, serviceId = null, taskId = null, scheduledTime = null }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to book a service.');

  const allowed = await checkTaskerCanAcceptBooking(taskerId);
  if (!allowed) throw new Error('SUBSCRIPTION_REQUIRED');

  const { data, error } = await window.supabase.from('bookings').insert({
    customer_id:    user.id,
    tasker_id:      taskerId,
    service_id:     serviceId || null,
    task_id:        taskId || null,
    scheduled_time: scheduledTime || null,
    status:         'pending',
  }).select().single();
  if (error) throw error;
  return data;
}

async function fetchMyBookings() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await window.supabase.from('bookings')
    .select('*, taskers(*)')
    .eq('customer_id', user.id).order('created_at', { ascending: false });
  if (error) {
    const { data: s } = await window.supabase.from('bookings')
      .select('*').eq('customer_id', user.id).order('created_at', { ascending: false });
    return s || [];
  }
  return data || [];
}

async function fetchTaskerBookings() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await window.supabase.from('bookings')
    .select('*, tasks(*)')
    .eq('tasker_id', user.id).order('created_at', { ascending: false });
  if (error) {
    const { data: s } = await window.supabase.from('bookings')
      .select('*').eq('tasker_id', user.id).order('created_at', { ascending: false });
    return s || [];
  }
  return data || [];
}

async function updateBookingStatus(bookingId, status) {
  const { data, error } = await window.supabase.from('bookings')
    .update({ status }).eq('id', bookingId).select().single();
  if (error) throw error;
  return data;
}

/* ───────────────────────── SUBSCRIPTIONS ───────────────────── */

async function checkTaskerCanAcceptBooking(taskerId) {
  const { data: sub } = await window.supabase.from('subscriptions')
    .select('id').eq('tasker_id', taskerId).eq('status', 'active')
    .gt('end_date', new Date().toISOString()).maybeSingle();
  if (sub) return true;

  const { count } = await window.supabase.from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('tasker_id', taskerId).in('status', ['pending', 'confirmed', 'completed']);
  return (count || 0) < 5;
}

async function fetchMySubscription() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return null;
  const { data } = await window.supabase.from('subscriptions')
    .select('*').eq('tasker_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

/* ──────────────────────────── FEED ─────────────────────────── */

async function fetchFeedPosts({ limit = 30 } = {}) {
  const { data, error } = await window.supabase.from('feed_posts')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

async function postFeedUpdate(caption) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post.');
  const name = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
  const { data, error } = await window.supabase.from('feed_posts').insert({
    tasker_id:   user.id,
    author_name: name,
    caption:     caption.trim(),
    likes:       0,
    service:     '',
    location:    '',
  }).select().single();
  if (error) throw error;
  return data;
}

async function postComment({ postId, body }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to comment.');
  const { data, error } = await window.supabase.from('comments').insert({
    post_id: postId, user_id: user.id, body: body.trim(),
  }).select().single();
  if (error) throw error;
  return data;
}

async function fetchComments(postId) {
  const { data, error } = await window.supabase.from('comments')
    .select('*, users(name)').eq('post_id', postId).order('created_at');
  if (error) {
    const { data: s } = await window.supabase.from('comments')
      .select('*').eq('post_id', postId).order('created_at');
    return s || [];
  }
  return data || [];
}

async function togglePostLike(postId, currentLikes, isLiked) {
  const newCount = isLiked ? Math.max(0, currentLikes - 1) : currentLikes + 1;
  await window.supabase.from('feed_posts').update({ likes: newCount }).eq('id', postId);
  return newCount;
}

/* ─────────────────── EXPOSE GLOBALLY ───────────────────────── */
window.ST     = window.ST || {};
window.ST.db  = {
  postTask, fetchTasks, fetchMyTasks,
  postService, fetchServices, fetchMyServices, fetchMyTaskerProfile,
  createBooking, fetchMyBookings, fetchTaskerBookings, updateBookingStatus,
  checkTaskerCanAcceptBooking, fetchMySubscription,
  fetchFeedPosts, postFeedUpdate, postComment, fetchComments, togglePostLike,
};

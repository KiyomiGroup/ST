/* ============================================================
   STREET TASKER — db.js  (Sprint 3.3)
   ============================================================ */
'use strict';

/* ─────────────────────────── TASKS ─────────────────────────── */

async function postTask({ title, description, category, budget, location, deadline, urgent = false }) {
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
    deadline:    deadline || null,
    urgent:      urgent,
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
  const { data, error } = await window.supabase.from('tasks').select('*')
    .or(`customer_id.eq.${user.id},user_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (error) {
    const { data: fb } = await window.supabase.from('tasks')
      .select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    return fb || [];
  }
  return data || [];
}

async function countMyTasks() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await window.supabase.from('tasks')
    .select('id', { count: 'exact', head: true })
    .or(`customer_id.eq.${user.id},user_id.eq.${user.id}`);
  return count || 0;
}

/* ────────────────────────── SERVICES ───────────────────────── */

async function postService({ serviceName, category, pricingType = 'per_job', price, rateUnit = '/hour', location, description, photoUrl = null }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post a service.');

  /* Always coerce price to a plain number — never a string with symbols */
  const numericPrice = parseFloat(String(price).replace(/[^0-9.]/g, '')) || 0;

  const payload = {
    user_id:      user.id,
    service_name: serviceName.trim(),
    category:     category || 'other',
    pricing_type: pricingType,
    price:        numericPrice,           // clean numeric value only
    rate_unit:    rateUnit || '/hour',    // e.g. "/hour", "/job", "/day"
    location:     location.trim(),
    description:  description.trim(),
    photo:        photoUrl || null,
    status:       'active',
    available:    true,
  };

  /* Try insert first, then upsert on conflict */
  let { data: svc, error: svcErr } = await window.supabase
    .from('services').insert(payload).select().single();

  if (svcErr && svcErr.code === '23505') {
    /* Duplicate — update existing */
    const res = await window.supabase
      .from('services').update(payload).eq('user_id', user.id).select().single();
    svc = res.data;
    svcErr = res.error;
  }

  if (svcErr) {
    console.warn('[DB] services insert:', svcErr.message, '— trying taskers fallback');
    /* Fallback to taskers table */
    const { error: tErr } = await window.supabase.from('taskers').upsert({
      id: user.id, user_id: user.id,
      service: serviceName.trim(), category: category || 'other',
      rate_value: numericPrice,
      rate: `₦${numericPrice.toLocaleString()}${rateUnit || '/job'}`,
      location: location.trim(), bio: description.trim(), photo_url: photoUrl || null, available: true,
    }, { onConflict: 'id' });
    if (tErr) throw new Error(tErr.message);
    return payload;
  }

  /* Always sync taskers for backwards compat */
  await window.supabase.from('taskers').upsert({
    id: user.id, user_id: user.id,
    service: serviceName.trim(), category: category || 'other',
    rate_value: numericPrice,
    rate: `₦${numericPrice.toLocaleString()}${rateUnit || '/job'}`,
    location: location.trim(), bio: description.trim(), photo_url: photoUrl || null, available: true,
  }, { onConflict: 'id' });

  return svc || payload;
}

async function updateService(serviceId, updates) {
  const { data, error } = await window.supabase
    .from('services').update(updates).eq('id', serviceId).select().single();
  if (error) throw error;
  return data;
}

async function deleteService(serviceId) {
  const { error } = await window.supabase.from('services').delete().eq('id', serviceId);
  if (error) throw error;
}

async function fetchServices({ category = '', limit = 60 } = {}) {
  let q = window.supabase.from('services').select(`
    id, service_name, category, pricing_type, price, location, description, photo, user_id, status, available,
    users ( id, name )
  `).eq('status', 'active').order('created_at', { ascending: false }).limit(limit);
  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (!error && data && data.length > 0) {
    return data.map(s => ({
      id:           String(s.id),
      service_name: s.service_name,
      category:     s.category,
      pricing_type: s.pricing_type || 'per_job',
      price:        s.price,
      location:     s.location,
      description:  s.description,
      photo:        s.photo,
      user_id:      s.user_id,
      available:    s.available !== false,
      provider_name: s.users?.name || 'Provider',
    }));
  }

  /* Fallback: taskers table */
  let tq = window.supabase.from('taskers').select('*').order('rating', { ascending: false }).limit(limit);
  if (category) tq = tq.eq('category', category);
  const { data: td, error: te } = await tq;
  if (te) return [];
  return (td || []).filter(t => t.service).map(t => ({
    id:           String(t.id),
    service_name: t.service,
    category:     t.category,
    pricing_type: 'per_job',
    price:        t.rate_value,
    location:     t.location,
    description:  t.bio,
    photo:        t.photo_url,
    user_id:      t.user_id || t.id,
    available:    t.available !== false,
    provider_name: t.name || 'Provider',
    rating:       t.rating,
  }));
}

async function fetchMyServices() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];

  /* Try services table first */
  const { data: svcData, error: svcErr } = await window.supabase
    .from('services').select('*, users(name)').eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (!svcErr && svcData && svcData.length > 0) {
    return svcData.map(s => ({
      id:           String(s.id),
      service_name: s.service_name,
      category:     s.category,
      pricing_type: s.pricing_type || 'per_job',
      price:        s.price,
      location:     s.location,
      description:  s.description,
      photo:        s.photo,
      user_id:      s.user_id,
      available:    s.available,
      provider_name: s.users?.name || 'Provider',
      fromServices:  true,
    }));
  }

  /* Fallback: taskers */
  const { data: td } = await window.supabase.from('taskers').select('*').eq('user_id', user.id);
  return (td || []).map(t => ({
    id:           String(t.id),
    service_name: t.service,
    category:     t.category,
    pricing_type: 'per_job',
    price:        t.rate_value,
    location:     t.location,
    description:  t.bio,
    photo:        t.photo_url,
    user_id:      t.user_id,
    available:    t.available,
    provider_name: t.name || 'Provider',
    fromServices:  false,
  }));
}

async function fetchMyTaskerProfile() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return null;
  const { data } = await window.supabase.from('taskers').select('*').eq('user_id', user.id).maybeSingle();
  return data;
}

/* ── Instant match ───────────────────────────────────────────── */
async function fetchMatchingServices({ category, location, limit = 5 }) {
  /* Try exact category match first */
  let { data, error } = await window.supabase.from('services').select(`
    id, service_name, category, pricing_type, price, location, description, photo, user_id, available,
    users ( id, name )
  `).eq('status', 'active').eq('available', true).eq('category', category)
    .order('created_at', { ascending: false }).limit(limit * 2);

  if (error || !data || data.length === 0) {
    /* Fallback: taskers table */
    const { data: td } = await window.supabase.from('taskers').select('*')
      .eq('category', category).order('rating', { ascending: false }).limit(limit);
    return (td || []).slice(0, limit).map(t => ({
      id: String(t.id), service_name: t.service, category: t.category,
      pricing_type: 'per_job', price: t.rate_value, location: t.location,
      description: t.bio, photo: t.photo_url, user_id: t.user_id || t.id,
      provider_name: t.name || 'Provider', available: t.available !== false,
    }));
  }

  /* Score by location similarity */
  const loc = (location || '').toLowerCase();
  const scored = data.map(s => {
    const sloc = (s.location || '').toLowerCase();
    let score = 0;
    if (loc && sloc) {
      const locParts = loc.split(/[,\s]+/).filter(Boolean);
      locParts.forEach(part => { if (sloc.includes(part)) score++; });
    }
    return { ...s, score };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => ({
    id:           String(s.id),
    service_name: s.service_name,
    category:     s.category,
    pricing_type: s.pricing_type || 'per_job',
    price:        s.price,
    location:     s.location,
    description:  s.description,
    photo:        s.photo,
    user_id:      s.user_id,
    available:    s.available !== false,
    provider_name: s.users?.name || 'Provider',
  }));
}

/* ── Image upload ────────────────────────────────────────────── */
async function uploadServiceImage(file) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to upload images.');
  if (!file) throw new Error('No file selected.');

  const ext  = file.name.split('.').pop().toLowerCase();
  const name = `services/${user.id}-${Date.now()}.${ext}`;

  const { data, error } = await window.supabase.storage
    .from('service-images')
    .upload(name, file, { cacheControl: '3600', upsert: true });

  if (error) throw new Error(error.message);

  const { data: urlData } = window.supabase.storage
    .from('service-images').getPublicUrl(name);

  return urlData.publicUrl;
}

/* ─────────────────────────── BOOKINGS ──────────────────────── */

async function createBooking({ taskerId, serviceId = null, taskId = null, scheduledTime = null, notes = '' }) {
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
    notes:          notes || null,
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
    .eq('tasker_id', taskerId).in('status', ['pending','confirmed','completed']);
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

async function postFeedUpdate(caption, imageUrl = null) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post.');
  const name = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
  const { data, error } = await window.supabase.from('feed_posts').insert({
    tasker_id:   user.id,
    author_name: name,
    caption:     caption.trim(),
    image_url:   imageUrl || null,
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

async function togglePostLike(postId, newCount) {
  await window.supabase.from('feed_posts').update({ likes: newCount }).eq('id', postId);
}

/* ─────────────────── EXPOSE GLOBALLY ───────────────────────── */
window.ST    = window.ST || {};
window.ST.db = {
  postTask, fetchTasks, fetchMyTasks, countMyTasks,
  postService, updateService, deleteService, fetchServices, fetchMyServices, fetchMyTaskerProfile,
  fetchMatchingServices, uploadServiceImage,
  createBooking, fetchMyBookings, fetchTaskerBookings, updateBookingStatus,
  checkTaskerCanAcceptBooking, fetchMySubscription,
  fetchFeedPosts, postFeedUpdate, postComment, fetchComments, togglePostLike,
};

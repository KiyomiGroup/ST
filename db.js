/* ============================================================
   STREET TASKER — db.js  (Sprint 3.4 — fully fixed)
   ============================================================ */
'use strict';

/* ─── Rate parser (also used server-side in this file) ─────── */
function _parseRate(raw) {
  if (raw === null || raw === undefined) return { numericPrice: 0, rateUnit: '/hour' };
  if (typeof raw === 'number' && !isNaN(raw)) return { numericPrice: raw, rateUnit: '/hour' };
  const s   = String(raw).replace(/[₦#N$€£,\s]/g, '');
  const match = s.match(/([\d]+(?:\.\d+)?)/);
  const num  = match ? parseFloat(match[1]) : 0;
  const rest = s.replace(/[\d.,]+/, '').toLowerCase().replace(/^[/\s]*(per\s*)?/, '').trim();
  const unitMap = {
    hour:'/hour', hr:'/hour', hourly:'/hour',
    day:'/day',   daily:'/day',
    job:'/job',   service:'/service',
    visit:'/visit', session:'/session',
    week:'/week', month:'/month',
  };
  return { numericPrice: isNaN(num) ? 0 : num, rateUnit: unitMap[rest] || (rest ? '/'+rest : '/hour') };
}

/* ─────────────────────────── TASKS ─────────────────────────── */

async function postTask({ title, description, category, budget, location, deadline, urgent = false, photoUrls = [] }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post a task.');

  const payload = {
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
  };
  if (photoUrls && photoUrls.length) payload.photo_urls = photoUrls;

  const { data, error } = await window.supabase.from('tasks').insert(payload).select().single();
  if (error) throw error;

  /* Notify nearby taskers (non-blocking) */
  try { await _notifyTaskersOfNewTask(data); } catch(e) { /* silent */ }

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

  /* customer_id is uuid, user_id is uuid — OR filter should work now */
  const { data, error } = await window.supabase.from('tasks').select('*')
    .or(`customer_id.eq.${user.id},user_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (!error && data) return data;

  /* Fallback: user_id only */
  const { data: fb } = await window.supabase.from('tasks')
    .select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  return fb || [];
}

async function countMyTasks() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await window.supabase.from('tasks')
    .select('id', { count: 'exact', head: true })
    .or(`customer_id.eq.${user.id},user_id.eq.${user.id}`);
  return count || 0;
}

/* ── Task Applications ──────────────────────────────────────── */

async function applyToTask({ taskId, message = '' }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to apply for tasks.');

  const { data: existing } = await window.supabase.from('task_applications')
    .select('id').eq('task_id', taskId).eq('tasker_id', user.id).maybeSingle();
  if (existing) throw new Error('You have already applied for this task.');

  const { data: taskerRow } = await window.supabase.from('taskers')
    .select('name, service').eq('user_id', String(user.id)).maybeSingle();
  const taskerName = taskerRow?.name || user.user_metadata?.name || user.email?.split('@')[0] || 'A tasker';

  const { data: app, error } = await window.supabase.from('task_applications').insert({
    task_id:   taskId,
    tasker_id: user.id,
    message:   message.trim() || null,
    status:    'pending',
  }).select().single();
  if (error) throw error;

  /* Notify task owner */
  try {
    const { data: task } = await window.supabase.from('tasks')
      .select('user_id, customer_id, title').eq('id', taskId).single();
    const ownerId = task?.customer_id || task?.user_id;
    if (ownerId) {
      await _insertNotification({
        userId:  ownerId,
        type:    'task_application',
        title:   'New Application',
        message: `${taskerName} applied for your task "${task.title}"`,
        data:    { task_id: taskId, application_id: app.id, tasker_id: user.id },
      });
    }
  } catch(e) { /* silent */ }

  return app;
}

async function fetchTaskApplications(taskId) {
  const { data, error } = await window.supabase.from('task_applications')
    .select('*, taskers:tasker_id(name, service, location, rating, photo_url)')
    .eq('task_id', taskId).order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

async function fetchMyApplications() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await window.supabase.from('task_applications')
    .select('*, tasks(*)').eq('tasker_id', user.id).order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

async function updateApplicationStatus(applicationId, status) {
  const { data, error } = await window.supabase.from('task_applications')
    .update({ status }).eq('id', applicationId).select().single();
  if (error) throw error;
  try {
    const { data: app } = await window.supabase.from('task_applications')
      .select('tasker_id, task_id').eq('id', applicationId).single();
    if (app) {
      const { data: task } = await window.supabase.from('tasks')
        .select('title').eq('id', app.task_id).single();
      const msg = status === 'accepted'
        ? `Your application for "${task?.title}" was accepted! The customer will contact you.`
        : `Your application for "${task?.title}" was not accepted this time.`;
      await _insertNotification({
        userId: app.tasker_id,
        type:   status === 'accepted' ? 'application_accepted' : 'application_rejected',
        title:  status === 'accepted' ? '🎉 Application Accepted' : 'Application Update',
        message: msg,
        data:   { task_id: app.task_id, application_id: applicationId },
      });
    }
  } catch(e) { /* silent */ }
  return data;
}

/* ── Notifications ──────────────────────────────────────────── */

async function _insertNotification({ userId, type, title, message, data = {} }) {
  const { error } = await window.supabase.from('notifications').insert({
    user_id: userId, type, title, message,
    data: JSON.stringify(data), read: false,
  });
  if (error) console.warn('[Notify]', error.message);
}

async function _notifyTaskersOfNewTask(task) {
  if (!task?.category) return;
  const { data: taskers } = await window.supabase.from('taskers')
    .select('user_id').eq('category', task.category).eq('available', true).limit(50);
  if (!taskers?.length) return;
  const rows = taskers
    .filter(t => t.user_id !== task.user_id)
    .map(t => ({
      user_id: t.user_id, type: 'new_task',
      title: 'New task in your category',
      message: `"${task.title}" posted in ${task.location || 'your area'}`,
      data: JSON.stringify({ task_id: task.id }), read: false,
    }));
  if (rows.length) await window.supabase.from('notifications').insert(rows);
}

async function fetchMyNotifications({ limit = 30 } = {}) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data } = await window.supabase.from('notifications')
    .select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

async function markNotificationRead(id) {
  await window.supabase.from('notifications').update({ read: true }).eq('id', id);
}

async function markAllNotificationsRead() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return;
  await window.supabase.from('notifications').update({ read: true })
    .eq('user_id', user.id).eq('read', false);
}

async function fetchUnreadNotificationCount() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await window.supabase.from('notifications')
    .select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false);
  return count || 0;
}

/* ────────────────────────── SERVICES ───────────────────────── */

async function postService({ serviceName, category, pricingType = 'per_job', price, rateUnit = '/hour', location, description, photoUrl = null }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post a service.');

  /* Strip ALL non-numeric chars — handles ₦2,000/hour, #5000/job, etc. */
  const { numericPrice, rateUnit: parsedUnit } = _parseRate(price);
  const finalUnit = rateUnit || parsedUnit || '/hour';

  const basePayload = {
    user_id:      user.id,
    service_name: serviceName.trim(),
    category:     category || 'other',
    pricing_type: pricingType,
    price:        numericPrice,           /* always a plain JS Number */
    location:     location.trim(),
    description:  description.trim(),
    photo:        photoUrl || null,
    status:       'active',
    available:    true,
  };

  /* Try with rate_unit column */
  let payload = { ...basePayload, rate_unit: finalUnit };
  let { data: svc, error: svcErr } = await window.supabase
    .from('services').insert(payload).select().single();

  /* Column doesn't exist yet → retry without it */
  if (svcErr && (svcErr.code === '42703' || svcErr.message?.includes('rate_unit'))) {
    payload = basePayload;
    const r2 = await window.supabase.from('services').insert(payload).select().single();
    svc = r2.data; svcErr = r2.error;
  }

  /* Duplicate key → update */
  if (svcErr && svcErr.code === '23505') {
    const r3 = await window.supabase.from('services').update(payload)
      .eq('user_id', user.id).select().single();
    svc = r3.data; svcErr = r3.error;
  }

  const rateStr = `₦${numericPrice.toLocaleString()}${finalUnit}`;

  if (svcErr) {
    /* Final fallback: taskers table only */
    const { error: tErr } = await window.supabase.from('taskers').upsert({
      id: String(user.id), user_id: String(user.id),
      service: serviceName.trim(), category: category || 'other',
      rate_value: numericPrice, rate: rateStr,
      location: location.trim(), bio: description.trim(),
      photo_url: photoUrl || null, available: true,
    }, { onConflict: 'id' });
    if (tErr) throw new Error(tErr.message);
    return basePayload;
  }

  /* Keep taskers in sync */
  await window.supabase.from('taskers').upsert({
    id: String(user.id), user_id: String(user.id),
    service: serviceName.trim(), category: category || 'other',
    rate_value: numericPrice, rate: rateStr,
    location: location.trim(), bio: description.trim(),
    photo_url: photoUrl || null, available: true,
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
    id, service_name, category, pricing_type, price, rate_unit, location, description, photo, user_id, status, available,
    users ( id, name )
  `).eq('status', 'active').order('created_at', { ascending: false }).limit(limit);
  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (!error && data && data.length > 0) {
    return data.map(s => ({
      id: String(s.id), service_name: s.service_name, category: s.category,
      pricing_type: s.pricing_type || 'per_job', price: s.price,
      rate_unit: s.rate_unit || '/hour', location: s.location,
      description: s.description, photo: s.photo, user_id: s.user_id,
      available: s.available !== false, provider_name: s.users?.name || 'Provider',
    }));
  }

  let tq = window.supabase.from('taskers').select('*').order('rating', { ascending: false }).limit(limit);
  if (category) tq = tq.eq('category', category);
  const { data: td } = await tq;
  return (td || []).filter(t => t.service).map(t => ({
    id: String(t.id), service_name: t.service, category: t.category,
    pricing_type: 'per_job', price: t.rate_value, rate_unit: '/hour',
    location: t.location, description: t.bio, photo: t.photo_url,
    user_id: t.user_id || t.id, available: t.available !== false,
    provider_name: t.name || 'Provider', rating: t.rating,
  }));
}

async function fetchMyServices() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data: svcData, error: svcErr } = await window.supabase
    .from('services').select('*, users(name)').eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (!svcErr && svcData?.length > 0) {
    return svcData.map(s => ({
      id: String(s.id), service_name: s.service_name, category: s.category,
      pricing_type: s.pricing_type || 'per_job', price: s.price,
      rate_unit: s.rate_unit || '/hour', location: s.location,
      description: s.description, photo: s.photo, user_id: s.user_id,
      available: s.available, provider_name: s.users?.name || 'Provider', fromServices: true,
    }));
  }
  const { data: td } = await window.supabase.from('taskers').select('*').eq('user_id', String(user.id));
  return (td || []).map(t => ({
    id: String(t.id), service_name: t.service, category: t.category,
    pricing_type: 'per_job', price: t.rate_value, rate_unit: '/hour',
    location: t.location, description: t.bio, photo: t.photo_url,
    user_id: t.user_id, available: t.available,
    provider_name: t.name || 'Provider', fromServices: false,
  }));
}

async function fetchMyTaskerProfile() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return null;
  const { data } = await window.supabase.from('taskers').select('*').eq('user_id', String(user.id)).maybeSingle();
  return data;
}

async function fetchMatchingServices({ category, location, limit = 5 }) {
  let { data, error } = await window.supabase.from('services').select(`
    id, service_name, category, pricing_type, price, location, description, photo, user_id, available,
    users ( id, name )
  `).eq('status', 'active').eq('available', true).eq('category', category)
    .order('created_at', { ascending: false }).limit(limit * 2);
  if (error || !data?.length) {
    const { data: td } = await window.supabase.from('taskers').select('*')
      .eq('category', category).order('rating', { ascending: false }).limit(limit);
    return (td || []).slice(0, limit).map(t => ({
      id: String(t.id), service_name: t.service, category: t.category,
      pricing_type: 'per_job', price: t.rate_value, location: t.location,
      description: t.bio, photo: t.photo_url, user_id: t.user_id || t.id,
      provider_name: t.name || 'Provider', available: t.available !== false,
    }));
  }
  const loc = (location || '').toLowerCase();
  return data.map(s => {
    const sloc = (s.location || '').toLowerCase();
    let score = 0;
    if (loc) loc.split(/[,\s]+/).filter(Boolean).forEach(p => { if (sloc.includes(p)) score++; });
    return { ...s, score };
  }).sort((a, b) => b.score - a.score).slice(0, limit).map(s => ({
    id: String(s.id), service_name: s.service_name, category: s.category,
    pricing_type: s.pricing_type || 'per_job', price: s.price,
    location: s.location, description: s.description, photo: s.photo,
    user_id: s.user_id, available: s.available !== false,
    provider_name: s.users?.name || 'Provider',
  }));
}

async function uploadServiceImage(file) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to upload images.');
  if (!file)  throw new Error('No file selected.');
  const ext  = file.name.split('.').pop().toLowerCase();
  const name = `services/${user.id}-${Date.now()}.${ext}`;
  const { error } = await window.supabase.storage
    .from('service-images').upload(name, file, { cacheControl: '3600', upsert: true });
  if (error) throw new Error(error.message);
  const { data: urlData } = window.supabase.storage.from('service-images').getPublicUrl(name);
  return urlData.publicUrl;
}

/* ─────────────────────────── BOOKINGS ──────────────────────── */

async function createBooking({ taskerId, serviceId = null, taskId = null, scheduledTime = null, notes = '' }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to book a service.');
  const allowed = await checkTaskerCanAcceptBooking(taskerId);
  if (!allowed) throw new Error('SUBSCRIPTION_REQUIRED');
  const { data, error } = await window.supabase.from('bookings').insert({
    customer_id: user.id, tasker_id: taskerId,
    service_id: serviceId || null, task_id: taskId || null,
    scheduled_time: scheduledTime || null, notes: notes || null, status: 'pending',
  }).select().single();
  if (error) throw error;
  try {
    const customerName = user.user_metadata?.name || user.email?.split('@')[0] || 'A customer';
    await _insertNotification({
      userId: taskerId, type: 'new_booking', title: 'New Booking Request',
      message: `${customerName} sent a booking request`,
      data: { booking_id: data.id, customer_id: user.id },
    });
  } catch(e) { /* silent */ }
  return data;
}

async function fetchMyBookings() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await window.supabase.from('bookings')
    .select('*, taskers(*)').eq('customer_id', user.id).order('created_at', { ascending: false });
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
    .select('*, tasks(*)').eq('tasker_id', user.id).order('created_at', { ascending: false });
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

async function checkTaskerCanAcceptBooking(taskerId) {
  try {
    const { data: sub } = await window.supabase.from('subscriptions')
      .select('id, status, end_date').eq('user_id', taskerId).maybeSingle();
    if (sub) {
      const notExpired = !sub.end_date || new Date(sub.end_date) > new Date();
      const isActive   = !sub.status  || sub.status === 'active';
      if (notExpired && isActive) return true;
    }
  } catch(e) { /* subscriptions table may differ */ }
  const { count } = await window.supabase.from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('tasker_id', taskerId).in('status', ['pending','confirmed','completed']);
  return (count || 0) < 5;
}

async function fetchMySubscription() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return null;
  const { data } = await window.supabase.from('subscriptions')
    .select('*').eq('user_id', user.id)
    .order('start_date', { ascending: false }).limit(1).maybeSingle();
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
    user_id: user.id, author_name: name, caption: caption.trim(), content: caption.trim(),
    image_url: imageUrl || null, image: imageUrl || null, likes: 0, service: '', location: '',
  }).select().single();
  if (error) throw error;
  return data;
}

async function postComment({ postId, body }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to comment.');
  const { data, error } = await window.supabase.from('comments').insert({
    post_id: postId, user_id: user.id, body: body.trim(), comment: body.trim(),
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
  postService, updateService, deleteService,
  fetchServices, fetchMyServices, fetchMyTaskerProfile, fetchMatchingServices, uploadServiceImage,
  applyToTask, fetchTaskApplications, fetchMyApplications, updateApplicationStatus,
  createBooking, fetchMyBookings, fetchTaskerBookings, updateBookingStatus,
  checkTaskerCanAcceptBooking, fetchMySubscription,
  fetchMyNotifications, markNotificationRead, markAllNotificationsRead, fetchUnreadNotificationCount,
  fetchFeedPosts, postFeedUpdate, postComment, fetchComments, togglePostLike,
};

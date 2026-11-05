/* ============================================================
   STREET TASKER — db.js  (Sprint 3.4 — fully fixed)
   ============================================================ */
'use strict';

/* ── Ensure public.users row exists (needed for FK constraints) ── */
async function ensureUserProfile(user) {
  if (!user) return;
  try {
    const { data: existing } = await window.supabase
      .from('users').select('id').eq('id', user.id).maybeSingle();
    if (!existing) {
      const name = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
      const role = user.user_metadata?.role || 'customer';
      await window.supabase.from('users').upsert(
        { id: user.id, name, email: user.email, role },
        { onConflict: 'id' }
      );
    }
  } catch(e) { /* silent — don't block the main action */ }
}


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

async function postTask({ title, description, category, budget, location, deadline, urgent = false, photoUrls = [], taskType = 'one_off', urgency = null, frequency = 'one_off', workMode = 'in_person', timeOfDay = null, urgentPaid = false, urgentFee = 0, urgentPaymentRef = null, photoLabels = [] }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post a task.');

  /* V6b: the SERVER decides whether this task may go live (idv_can_publish). If the answer is
     missing or the read fails, the task is saved as a draft: nothing goes live by accident. */
  let canGoLive = false;
  try {
    const g = window.ST && window.ST.verify && window.ST.verify.canPublish ? await window.ST.verify.canPublish() : null;
    canGoLive = !!(g && g.can_publish === true);
  } catch (e) { canGoLive = false; }

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
    task_type:   taskType || 'one_off',
    urgency:     urgency || (urgent ? 'immediate' : 'flexible'),
    status:      canGoLive ? 'open' : 'draft',
  };
  if (photoUrls && photoUrls.length) payload.photo_urls = photoUrls;

  /* Columns added by sql/post-task-redesign.sql */
  const extended = Object.assign({}, payload, {
    frequency:          frequency || 'one_off',
    work_mode:          workMode || 'in_person',
    time_of_day:        timeOfDay || null,
    urgent_paid:        !!urgentPaid,
    urgent_fee:         urgentPaid ? (parseFloat(urgentFee) || 0) : 0,
    urgent_payment_ref: urgentPaid ? (urgentPaymentRef || null) : null,
    photo_labels:       photoLabels && photoLabels.length ? photoLabels : [],
  });

  let { data, error } = await window.supabase.from('tasks').insert(extended).select().single();

  /* If the migration has not been run yet (unknown column), post with the
     original columns so posting never breaks. */
  if (error && /column|schema cache/i.test(error.message || '')) {
    console.warn('[postTask] new columns missing, run sql/post-task-redesign.sql:', error.message);
    ({ data, error } = await window.supabase.from('tasks').insert(payload).select().single());
  }
  if (error) throw error;

  /* Notify nearby taskers (non-blocking), only for a task that is actually live */
  if (canGoLive) { try { await _notifyTaskersOfNewTask(data); } catch(e) { /* silent */ } }

  /* V6c: a draft saved because the person is not verified yet is registered with the server, which
     publishes it by itself when they become VERIFIED (idv_hold_publish). If they got verified in the
     meantime the server publishes it right now. A failure here never blocks posting: the draft stays a draft. */
  let publishedNow = false;
  if (!canGoLive && data && data.id != null) {
    data._held = false;
    try {
      const h = await window.supabase.rpc('idv_hold_publish', { p_entity: 'task', p_id: String(data.id) });
      if (h && h.data && h.data.published === true) publishedNow = true;
      data._held = !!(h && h.data && h.data.held === true);
      if (h && h.error) console.warn('[postTask] could not register the draft for auto-publish:', h.error.message);
    } catch (e) { console.warn('[postTask] could not register the draft for auto-publish:', e && e.message); }
  }

  /* Tells the page which message to show (tasks.js). Not columns. */
  if (data) data._needs_verification = !canGoLive && !publishedNow;
  return data;
}

async function fetchTasks({ limit = 50, category = '' } = {}) {
  /* NOTE: we deliberately do NOT use Supabase's embedded-relationship
     syntax (e.g. .select('*, users:user_id(...)')) here. PostgREST needs
     a real foreign-key constraint in the schema cache to resolve that,
     and this project's `tasks` table doesn't have one set up from either
     `user_id` or `customer_id` to `users.id` — trying it throws
     "Could not find a relationship between 'tasks' and 'user_id'".
     Fetching the poster's name as a separate query sidesteps that
     entirely and works regardless of the FK setup. If you'd rather fix
     this at the database level: in Supabase → Table Editor → tasks →
     add a foreign key on customer_id (or user_id) referencing users.id,
     then this function can go back to the single embedded query. */
  let q = window.supabase.from('tasks').select('*')
    .eq('status', 'open').order('created_at', { ascending: false }).limit(limit);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw error;
  const tasks = data || [];
  if (!tasks.length) return tasks;

  const posterIds = [...new Set(tasks.map(t => t.customer_id || t.user_id).filter(Boolean))];
  if (posterIds.length) {
    const { data: users } = await window.supabase.from('users')
      .select('id, name, business_name').in('id', posterIds);
    const byId = Object.fromEntries((users || []).map(u => [String(u.id), u]));
    tasks.forEach(t => { t.users = byId[String(t.customer_id || t.user_id)] || null; });
  }
  return tasks;
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

/* Offer errors. The three offer functions (submit_offer, edit_offer, withdraw_offer) raise a stable code as the
   exception MESSAGE and a plain-text sentence as DETAILS. The Error thrown here has .offerCode (the code) and a
   readable .message, so a page can branch on the code and show the message. Anything else (network, unknown) is
   rethrown untouched and has no .offerCode, which means "outcome unknown, a retry is safe with the same request id". */
const OFFER_ERROR_TEXT = {
  not_signed_in:       'Your session has ended. Please log in again.',
  bad_request_id:      'We could not send your offer. Please try again.',
  task_not_found:      'This task could not be found.',
  message_too_long:    'Your offer text is too long.',
  bad_contact:         'That phone or WhatsApp number is too long.',
  request_id_reused:   'We could not send your offer. Please reload the page and try again.',
  local_tasker:        'Local Taskers cannot send offers. Their coordinator handles bookings.',
  not_a_tasker:        'Only taskers can send offers.',
  own_task:            'You cannot send an offer on your own task.',
  already_offered:     'You have already sent an offer for this task.',
  task_closed:         'This task is no longer taking offers.',
  offer_limit_reached: 'You have used all your offers for this period.',
  fair_use_daily:      'You have reached the daily fair-use limit for offers. Please try again tomorrow.',
  fair_use_monthly:    'You have reached the monthly fair-use limit for offers.',
  application_not_found: 'This offer could not be found.',
  offer_not_pending:   'Only an offer that is still waiting for an answer can be changed.',
};
function _offerRpcError(error) {
  const code = String((error && error.message) || '');
  if (!Object.prototype.hasOwnProperty.call(OFFER_ERROR_TEXT, code)) return error;
  const e = new Error((error.details && String(error.details)) || OFFER_ERROR_TEXT[code]);
  e.offerCode = code;
  return e;
}
function _newOfferRequestId() {
  try { if (window.crypto && window.crypto.randomUUID) return 'offer-' + window.crypto.randomUUID(); } catch (e) {}
  return 'offer-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/* Send an offer. All checks, the offer allowance and the owner notification happen in the database (submit_offer).
   requestId: pass the same value when retrying after a failure with an unknown outcome (no .offerCode), so the offer
   is never counted twice; leave it out for a new offer. Returns { id, status, resubmitted, replayed, source, entitlements }. */
async function applyToTask({ taskId, message = '', phone = null, whatsapp = null, requestId = null }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to apply for tasks.');
  await ensureUserProfile(user);

  const { data, error } = await window.supabase.rpc('submit_offer', {
    p_task:              taskId,
    p_message:           message,
    p_phone:             phone,
    p_whatsapp:          whatsapp,
    p_client_request_id: requestId || _newOfferRequestId(),
  });
  if (error) throw _offerRpcError(error);
  return {
    id: data.application_id, status: 'pending',
    resubmitted: !!data.resubmitted, replayed: !!data.replayed,
    source: data.source, entitlements: data.entitlements,
  };
}

async function fetchTaskApplications(taskId) {
  const { data, error } = await window.supabase.from('task_applications')
    .select('*, taskers:tasker_id(name, service, location, rating, photo_url, user_id, business_name)')
    .eq('task_id', taskId).neq('status', 'withdrawn').order('created_at', { ascending: false });
  if (error) return [];
  const rows = data || [];
  /* For accepted applications fetch tasker contact details */
  await Promise.all(rows.map(async a => {
    const userId = a.taskers?.user_id;
    if (userId && (a.status === 'accepted' || a.status === 'completed')) {
      try {
        const { data: v } = await window.supabase
          .from('verifications').select('phone').eq('user_id', userId).maybeSingle();
        a._taskerContact = {
          name:  a.taskers?.business_name || a.taskers?.name || 'Tasker',
          phone: v?.phone || null,
          email: null,
        };
      } catch(e) {}
    }
  }));
  return rows;
}

async function fetchMyApplications() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await window.supabase.from('task_applications')
    .select('*, tasks(*)').eq('tasker_id', user.id).neq('status', 'withdrawn').order('created_at', { ascending: false });
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
        ? `Your application for "${task?.title}" was accepted! Booking accepted! Check your dashboard for the customer's contact details.`
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

/* Tasker edits a still-pending proposal (pitch text, proposed rate and, optionally, arrival).
   Stored in the same "<pitch> | Proposed rate: ₦N | Arrival: <date>, <window>" format the customer views parse.
   arrival: undefined keeps the arrival already saved, a string replaces it, null or '' removes it.
   proofs (proof-photo links, saved as " | Proof: url url" after the arrival): same rule, with an array (empty array removes). */
async function updateMyApplication(applicationId, { message, rate, arrival, proofs }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to edit your offer.');
  const amount = Math.round(Number(rate));
  if (!amount || amount <= 0) throw new Error('Enter a valid offer amount.');
  /* The pitch ends where "Proposed rate" (or a stray "Arrival") starts; "|" is the separator, so none is kept inside it */
  const pitch = String(message || '').replace(/\|\s*(?:Proposed rate|Arrival|Proof):.*$/i, '').replace(/\|/g, '/').trim();
  /* Arrival and proof are kept from the saved message unless the caller sends new ones */
  let when = '', links = [];
  if (arrival === undefined || proofs === undefined) {
    const { data: current } = await window.supabase.from('task_applications')
      .select('message').eq('id', applicationId).eq('tasker_id', user.id).maybeSingle();
    const old = String(current?.message || '');
    const a = old.match(/\|\s*Arrival:\s*([^|]+)/i), p = old.match(/\|\s*Proof:\s*([^|]+)/i);
    if (arrival === undefined) when = a ? a[1].trim() : '';
    if (proofs === undefined) links = p ? p[1].trim().split(/\s+/) : [];
  }
  if (arrival !== undefined) when = String(arrival || '').replace(/\|/g, '/').trim();
  if (proofs !== undefined) links = Array.isArray(proofs) ? proofs : [];
  links = links.map(u => String(u || '').trim()).filter(u => /^https:\/\/[^\s\/]+\/storage\/v1\/object\/public\/\S+$/.test(u) && u.indexOf('|') === -1).slice(0, 5);
  const stored = (pitch ? pitch + ' ' : '') + '| Proposed rate: \u20A6' + amount.toLocaleString('en-NG') +
    (when ? ' | Arrival: ' + when : '') + (links.length ? ' | Proof: ' + links.join(' ') : '');
  /* The database checks that the offer is yours and still pending, saves it, and tells the task owner */
  const { data, error } = await window.supabase.rpc('edit_offer', {
    p_application: applicationId, p_message: stored, p_phone: null, p_whatsapp: null,
  });
  if (error) throw _offerRpcError(error);
  return { id: data.application_id, status: data.status, message: stored };
}

/* Tasker withdraws a still-pending proposal. The offer is kept with status 'withdrawn' (it used to be deleted);
   the database tells the task owner and gives no offer back. */
async function withdrawMyApplication(applicationId) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to withdraw your application.');
  const { error } = await window.supabase.rpc('withdraw_offer', { p_application: applicationId });
  if (error) throw _offerRpcError(error);
  return true;
}

/* ── Notifications ──────────────────────────────────────────── */

async function _insertNotification({ userId, type, title, message, data = {} }) {
  const { error } = await window.supabase.from('notifications').insert({
    user_id: userId, type, title, message,
    data: data,      /* raw object — Supabase serialises to JSONB */
    is_read: false,  /* confirmed column name from schema */
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
      data: { task_id: task.id }, /* raw object, not JSON.stringify */
      is_read: false,
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
  await window.supabase.from('notifications').update({ is_read: true }).eq('id', id);
}

async function markAllNotificationsRead() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return;
  await window.supabase.from('notifications').update({ is_read: true })
    .eq('user_id', user.id).eq('is_read', false);
}

async function fetchUnreadNotificationCount() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await window.supabase.from('notifications')
    .select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false);
  return count || 0;
}

/* ────────────────────────── SERVICES ───────────────────────── */

async function postService({ serviceName, category, pricingType = 'per_job', price, rateUnit = '/hour', location, description, photoUrl = null, specialties = [], availabilityStatus = 'available_this_week' }) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post a service.');

  /* Strip ALL non-numeric chars — handles ₦2,000/hour, #5000/job, etc. */
  const { numericPrice, rateUnit: parsedUnit } = _parseRate(price);
  const finalUnit = rateUnit || parsedUnit || '/hour';

  const basePayload = {
    user_id:      user.id,
    service_name: serviceName.trim(),
    category:     category || 'other',
    price:        numericPrice,           /* always a plain JS Number */
    location:     location.trim(),
    description:  description.trim(),
    photo:        photoUrl || null,
    available:    true,                   /* services uses 'available', not 'status' */
    specialties:  specialties && specialties.length ? specialties : [],
    availability_status: availabilityStatus || 'available_this_week',
  };

  /* Try with rate_unit column */
  let payload = { ...basePayload, rate_unit: finalUnit };
  let { data: svc, error: svcErr } = await window.supabase
    .from('services').insert(payload).select().single();

  /* Column doesn't exist yet (rate_unit, specialties, or availability_status
     — i.e. the migration in supabase/migration_search_filters.sql hasn't
     been run yet) → retry with just the base columns that predate it */
  if (svcErr && (svcErr.code === '42703')) {
    const { specialties: _s, availability_status: _a, ...legacyPayload } = basePayload;
    payload = legacyPayload;
    const r2 = await window.supabase.from('services').insert(payload).select().single();
    svc = r2.data; svcErr = r2.error;
  }

  /* Duplicate key → update */
  if (svcErr && svcErr.code === '23505') {
    const r3 = await window.supabase.from('services').update(payload)
      .eq('user_id', user.id).select().single();
    svc = r3.data; svcErr = r3.error;
  }

  /* Over the plan's listing limit: say so plainly instead of falling back to the old table-only save */
  if (svcErr && isListingError(svcErr)) throw new Error(listingErrorMessage(svcErr));

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

/* ── Listing gate (S3d). The server decides how many active listings a plan allows (S3c); these only call it. ── */
const LISTING_MESSAGES = {
  listing_limit_reached: 'You have reached the number of active listings your plan allows. Pause or delete one, or upgrade your plan.',
  listing_paused:        'This listing is paused. Reactivate it first.',
  listing_status_locked: 'Use the pause and reactivate buttons to change a listing.',
  too_many_selected:     'You chose more listings than your plan allows.',
  no_services_selected:  'Choose at least one listing to keep active.',
  service_not_found:     'This listing could not be found. Refresh the page and try again.',
  local_tasker:          'Your coordinator manages your listings.',
  not_signed_in:         'Please sign in.',
  bad_request:           'That request was not valid.'
};
/* The server's own sentence (it names the plan and the numbers) is used when there is one; otherwise the fixed text above. */
function listingErrorMessage(err) {
  const code = err && err.message;
  if (code && LISTING_MESSAGES[code]) return (err.details || err.detail || LISTING_MESSAGES[code]);
  return (err && err.message) || 'Something went wrong. Please try again.';
}
function isListingError(err) { return !!(err && err.message && LISTING_MESSAGES[err.message]); }
async function _listingRpc(fn, args) {
  const { data, error } = await window.supabase.rpc(fn, args);
  if (error) {
    const e = new Error(listingErrorMessage(error));
    e.code = error.message; e.detail = error.details || '';
    throw e;
  }
  return data;
}
function publishService(serviceId)    { return _listingRpc('publish_service',    { p_service: serviceId }); }
function pauseService(serviceId)      { return _listingRpc('pause_service',      { p_service: serviceId }); }
function reactivateService(serviceId) { return _listingRpc('reactivate_service', { p_service: serviceId }); }
function chooseActiveListings(ids)    { return _listingRpc('choose_active_listings', { p_ids: ids }); }
/* { limit, active, remaining } for the signed-in tasker, from the server (null if it cannot be read) */
async function fetchMyListingSlots() {
  try {
    const { data, error } = await window.supabase.rpc('get_my_entitlements');
    if (error || !data || !data.listings) return null;
    return data.listings;
  } catch (e) { return null; }
}

async function deleteService(serviceId) {
  const { error } = await window.supabase.from('services').delete().eq('id', serviceId);
  if (error) throw error;
}

async function fetchServices({ category = '', limit = 60 } = {}) {
  /* Step 1: fetch services without the users join (avoids RLS issues for anon visitors) */
  let q = window.supabase.from('services').select(
    'id, service_name, category, price, rate_unit, location, description, photo, user_id, available, created_at'
  ).eq('available', true).order('created_at', { ascending: false }).limit(limit);
  if (category) q = q.eq('category', category);

  const { data: svcData, error: svcErr } = await q;

  if (!svcErr && svcData && svcData.length > 0) {
    /* Step 2: batch-fetch provider names separately — single query, no join */
    const userIds = [...new Set(svcData.map(s => s.user_id).filter(Boolean))];
    let nameMap = {};
    if (userIds.length > 0) {
      try {
        const { data: uRows } = await window.supabase
          .from('users').select('id, name, business_name').in('id', userIds);
        (uRows || []).forEach(u => { nameMap[u.id] = u.business_name || u.name || null; });
      } catch(e) { /* name lookup failed — use fallback */ }
    }
    return svcData.map(s => ({
      id: String(s.id), service_name: s.service_name, category: s.category,
      pricing_type: 'per_job', price: s.price,
      rate_unit: s.rate_unit || '/hour', location: s.location,
      description: s.description, photo: s.photo, user_id: s.user_id,
      available: s.available !== false,
      provider_name: nameMap[s.user_id] || 'Provider',
    }));
  }

  /* Fallback: pull from taskers table (rating column is TEXT — can't sort numerically).
     Public read: name the columns. phone and whatsapp are private (logged-out visitors
     cannot read them), so select('*') would fail for them. */
  const TASKER_PUBLIC_COLS = 'id, user_id, services, rating, location, created_at, available, service_name, category, price, description, photo, bio, photo_url, rate, rate_value, service, rate_unit, business_name, is_verified, verified_at, business_lat, business_lon, business_address, banner_color, banner_img, name, specialties, availability_status, verified, profile_details';
  let tq = window.supabase.from('taskers').select(TASKER_PUBLIC_COLS)
    .eq('available', true).order('created_at', { ascending: false }).limit(limit);
  if (category) tq = tq.eq('category', category);
  const { data: td } = await tq;
  /* Filter: service must be a non-empty string (could be '' or null) */
  return (td || []).filter(t => t.service && t.service.trim()).map(t => ({
    id: String(t.id), service_name: t.service, category: t.category,
    pricing_type: 'per_job', price: t.rate_value, rate_unit: t.rate_unit || '/hour',
    location: t.location, description: t.bio, photo: t.photo_url,
    user_id: t.user_id || t.id, available: t.available !== false,
    provider_name: t.business_name || t.name || 'Provider', rating: t.rating,
  }));
}

async function fetchMyServices() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  const { data: svcData, error: svcErr } = await window.supabase
    .from('services').select('*, users(name, business_name)').eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (!svcErr && svcData?.length > 0) {
    return svcData.map(s => ({
      id: String(s.id), service_name: s.service_name, category: s.category,
      pricing_type: s.pricing_type || 'per_job', price: s.price,
      rate_unit: s.rate_unit || '/hour', location: s.location,
      description: s.description, photo: s.photo, user_id: s.user_id,
      available: s.available,
      provider_name: s.users?.business_name || s.users?.name || 'Provider',
      fromServices: true,
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
    id, service_name, category, price, rate_unit, location, description, photo, user_id, available,
    users ( id, name )
  `).eq('available', true).eq('category', category)
    .order('created_at', { ascending: false }).limit(limit * 2);
  if (error || !data?.length) {
    const { data: td } = await window.supabase.from('taskers').select('*')
      .eq('category', category).eq('available', true).order('rating', { ascending: false }).limit(limit);
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
    pricing_type: 'per_job', price: s.price,
    location: s.location, description: s.description, photo: s.photo,
    user_id: s.user_id, available: s.available !== false,
    provider_name: s.users?.name || 'Provider',
  }));
}

async function uploadServiceImage(file) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to upload images.');

  /* ── Validate before touching the network ── */
  const validation = window.validateUpload(file, {
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 5 * 1024 * 1024,
  });
  if (!validation.ok) throw new Error(validation.error);

  /* Use a safe UUID-based filename — never trust file.name */
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext  = extMap[file.type] || 'jpg';
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
  /* Only customer accounts can book (the database refuses it too) */
  if (window.ST && window.ST.auth && window.ST.auth.checkCustomerOnly) {
    const who = await window.ST.auth.checkCustomerOnly(user);
    if (!who.ok) throw new Error('Only customer accounts can book a service. Switch to your customer account first.');
  }

  /* Ensure the customer has a public.users row (required for FK) */
  await ensureUserProfile(user);

  /* Resolve to taskers.id — try user_id lookup first, fallback to direct id */
  let resolvedTaskerId = taskerId;
  try {
    const { data: tr } = await window.supabase.from('taskers')
      .select('id').eq('user_id', taskerId).maybeSingle();
    if (tr?.id) resolvedTaskerId = tr.id;
  } catch(e) { /* use original taskerId */ }

  const allowed = await checkTaskerCanAcceptBooking(resolvedTaskerId);
  if (!allowed) throw new Error('SUBSCRIPTION_REQUIRED');
  const { data, error } = await window.supabase.from('bookings').insert({
    customer_id: user.id, tasker_id: resolvedTaskerId,
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
  /* Join tasker info so we can show contact details on confirmed bookings */
  const { data, error } = await window.supabase.from('bookings')
    .select('*, taskers(name, service, location, photo_url, rate, user_id)')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false });
  if (error) {
    const { data: s } = await window.supabase.from('bookings')
      .select('*').eq('customer_id', user.id).order('created_at', { ascending: false });
    return s || [];
  }
  /* For confirmed/completed bookings, fetch tasker phone number */
  const rows = data || [];
  await Promise.all(rows.map(async b => {
    if ((b.status === 'confirmed' || b.status === 'completed') && b.taskers?.user_id) {
      try {
        /* public.users has no phone/email — get phone from verifications */
        const { data: vt } = await window.supabase
          .from('verifications').select('phone').eq('user_id', b.taskers.user_id).maybeSingle();
        const { data: ut } = await window.supabase
          .from('users').select('name, business_name').eq('id', b.taskers.user_id).maybeSingle();
        b._taskerContact = { name: ut?.business_name || ut?.name || b.taskers?.name || 'Tasker', phone: vt?.phone || null, email: null };
      } catch(e) {}
    }
  }));
  return rows;
}

async function fetchTaskerBookings() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) return [];
  /* Join tasks and customer user info for contact reveal on confirmed bookings */
  const { data, error } = await window.supabase.from('bookings')
    .select('*, tasks(title, description, budget, location)')
    .eq('tasker_id', user.id)
    .order('created_at', { ascending: false });
  if (error) {
    const { data: s } = await window.supabase.from('bookings')
      .select('*').eq('tasker_id', user.id).order('created_at', { ascending: false });
    return s || [];
  }
  /* For confirmed/completed bookings, fetch customer phone number */
  const rows = data || [];
  await Promise.all(rows.map(async b => {
    if ((b.status === 'confirmed' || b.status === 'completed') && b.customer_id) {
      try {
        /* public.users has no phone/email — get phone from verifications */
        const { data: vc } = await window.supabase
          .from('verifications').select('phone').eq('user_id', b.customer_id).maybeSingle();
        const { data: uc } = await window.supabase
          .from('users').select('name').eq('id', b.customer_id).maybeSingle();
        b._customerContact = { name: uc?.name || 'Customer', phone: vc?.phone || null, email: null };
      } catch(e) {}
    }
  }));
  return rows;
}

async function updateBookingStatus(bookingId, status) {
  const { data, error } = await window.supabase.from('bookings')
    .update({ status }).eq('id', bookingId).select().single();
  if (error) throw error;
  return data;
}

async function checkTaskerCanAcceptBooking(taskerId) {
  /* Check for an active paid subscription first */
  try {
    const { data: sub } = await window.supabase.from('subscriptions')
      .select('id, status, end_date').eq('user_id', taskerId).maybeSingle();
    if (sub) {
      const notExpired = !sub.end_date || new Date(sub.end_date) > new Date();
      const isActive   = sub.status === 'active';
      if (notExpired && isActive) return true;
    }
  } catch(e) { /* subscriptions table may differ */ }

  /* Free tier: max 3 ACTIVE (pending or confirmed) bookings at once.
     Completed/cancelled bookings don't count — slots reopen after job is done.
     This means a busy tasker can always work, they just confirm one at a time. */
  const { count } = await window.supabase.from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('tasker_id', taskerId)
    .in('status', ['pending', 'confirmed']);   /* NOT completed, NOT cancelled */
  return (count || 0) < 3;
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
  return (data || []).map(p => ({
    ...p,
    /* Normalise columns — DB has both old+new names */
    resolved_caption:     p.content || p.caption || '',
    resolved_image:       p.image   || p.image_url || null,
    resolved_author_name: p.author_name || 'Tasker',
  }));
}

async function postFeedUpdate(caption, imageUrl = null) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Log in to post.');
  await ensureUserProfile(user);

  /* Use business name if set, fall back to personal name */
  let authorName = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
  try {
    const { data: userRow } = await window.supabase
      .from('users').select('name, business_name').eq('id', user.id).maybeSingle();
    if (userRow?.business_name) authorName = userRow.business_name;
    else if (userRow?.name)     authorName = userRow.name;
  } catch(e) { /* use fallback */ }

  const { data, error } = await window.supabase.from('feed_posts').insert({
    user_id: user.id, author_name: authorName, caption: caption.trim(), content: caption.trim(),
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

async function togglePostLike(postId, liked) {
  /* Uses a server-side atomic function to prevent race conditions.
     The RPC increments or decrements the counter in a single DB operation.
     See: migrations/rls_and_functions.sql for the function definition. */
  try {
    await window.supabase.rpc(liked ? 'increment_post_likes' : 'decrement_post_likes', { post_id: postId });
  } catch(e) {
    console.warn('[Like]', e.message);
  }
}

/* ─────────────────── EXPOSE GLOBALLY ───────────────────────── */
window.ST    = window.ST || {};
window.ST.db = {
  postTask, fetchTasks, fetchMyTasks, countMyTasks,
  postService, updateService, deleteService,
  publishService, pauseService, reactivateService, chooseActiveListings, fetchMyListingSlots, listingErrorMessage, isListingError,
  fetchServices, fetchMyServices, fetchMyTaskerProfile, fetchMatchingServices, uploadServiceImage,
  applyToTask, fetchTaskApplications, fetchMyApplications, updateApplicationStatus,
  createBooking, fetchMyBookings, fetchTaskerBookings, updateBookingStatus,
  checkTaskerCanAcceptBooking, fetchMySubscription,
  fetchMyNotifications, markNotificationRead, markAllNotificationsRead, fetchUnreadNotificationCount,
  fetchFeedPosts, postFeedUpdate, postComment, fetchComments, togglePostLike,
};

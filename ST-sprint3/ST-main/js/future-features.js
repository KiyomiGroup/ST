/* ============================================================
   STREET TASKER — future-features.js
   Sprint 1: Documented stubs and hooks for future sprints.
   This file exists purely as a roadmap reference and
   developer guide — nothing here runs in production yet.
   ============================================================

   HOW TO USE THIS FILE:
   Each function stub below corresponds to a planned feature.
   When the relevant sprint begins, move the stub into the
   appropriate module file and implement it.
   ============================================================ */

'use strict';

/* ── Sprint 2: Authentication (Supabase) ─────────────────────── */

/**
 * Future Sprint 2: Supabase email/password sign-up.
 * Creates a new user in Supabase Auth and a matching row
 * in the 'profiles' table with the selected role.
 */
async function signUpUser({ name, email, password, role }) {
  /*
  const { data, error } = await window.supabase.auth.signUp({
    email,
    password,
    options: { data: { name, role } }
  });

  if (error) throw error;

  // Also create a row in the 'profiles' table
  await window.supabase.from('profiles').insert({
    id: data.user.id,
    name,
    role,            // 'customer' | 'tasker'
    created_at: new Date().toISOString(),
  });

  return data.user;
  */
  console.log('[Future Sprint 2] signUpUser stub called', { name, email, role });
}

/**
 * Future Sprint 2: Supabase email/password login.
 * Sets the session cookie and redirects to dashboard.
 */
async function loginUser({ email, password }) {
  /*
  const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  window.location.href = 'dashboard.html';
  */
  console.log('[Future Sprint 2] loginUser stub called', { email });
}

/**
 * Future Sprint 2: Sign out current user.
 */
async function logoutUser() {
  /*
  await window.supabase.auth.signOut();
  window.location.href = 'index.html';
  */
  console.log('[Future Sprint 2] logoutUser stub called');
}

/* ── Sprint 2: Task Posting (Supabase) ───────────────────────── */

/**
 * Future Sprint 2: Saves a new task to the 'tasks' Supabase table.
 * Requires the user to be authenticated (customer role).
 */
async function postTask({ title, description, budget, location, deadline }) {
  /*
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await window.supabase.from('tasks').insert({
    customer_id:  user.id,
    title,
    description,
    budget:       parseFloat(budget),
    location,
    deadline:     new Date(deadline).toISOString(),
    status:       'open',
    created_at:   new Date().toISOString(),
  }).select().single();

  if (error) throw error;
  return data;
  */
  console.log('[Future Sprint 2] postTask stub called', { title, budget });
}

/**
 * Future Sprint 2: Fetches open tasks for the tasker's feed.
 */
async function fetchOpenTasks({ page = 0, limit = 20 } = {}) {
  /*
  const { data, error } = await window.supabase
    .from('tasks')
    .select('*, profiles(name, avatar_url)')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (error) throw error;
  return data;
  */
  console.log('[Future Sprint 2] fetchOpenTasks stub called');
  return [];
}

/* ── Sprint 2: Tasker Profiles ───────────────────────────────── */

/**
 * Future Sprint 2: Fetch all active taskers with optional filters.
 * Will power the Find Taskers page with real data.
 */
async function fetchTaskers({ service, location, minRating, maxPrice, sortBy } = {}) {
  /*
  let query = window.supabase
    .from('tasker_profiles')
    .select('*, profiles(name, avatar_url), reviews(rating)')
    .eq('status', 'active');

  if (service)   query = query.ilike('service_type', `%${service}%`);
  if (minRating) query = query.gte('avg_rating', minRating);
  if (maxPrice)  query = query.lte('hourly_rate', maxPrice);

  const { data, error } = await query;
  if (error) throw error;
  return data;
  */
  console.log('[Future Sprint 2] fetchTaskers stub called', { service, location });
  return [];
}

/* ── Sprint 3: Booking Engine ────────────────────────────────── */

/**
 * Future Sprint 3: Creates a booking between a customer and tasker.
 * Will trigger a notification to the tasker and create a
 * payment intent via Paystack or Stripe.
 */
async function createBooking({ taskerId, customerId, taskId, scheduledDate, notes }) {
  /*
  const { data, error } = await window.supabase.from('bookings').insert({
    tasker_id:      taskerId,
    customer_id:    customerId,
    task_id:        taskId,
    scheduled_date: scheduledDate,
    notes,
    status:         'pending',
    created_at:     new Date().toISOString(),
  }).select().single();

  if (error) throw error;

  // Future: Trigger Supabase Edge Function to send booking notification
  // await supabase.functions.invoke('send-booking-notification', { body: data });

  // Future: Create payment intent
  // const paymentIntent = await createPaymentIntent(data.id);

  return data;
  */
  console.log('[Future Sprint 3] createBooking stub called', { taskerId, scheduledDate });
}

/* ── Sprint 3: Map Discovery ─────────────────────────────────── */

/**
 * Future Sprint 3: Initializes a Mapbox or Google Maps instance
 * and plots nearby taskers as map markers.
 * Will use PostGIS spatial queries in Supabase for geo-filtering.
 */
async function initMapDiscovery(containerId) {
  /*
  // Option A: Mapbox GL JS
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const map = new mapboxgl.Map({
    container: containerId,
    style: 'mapbox://styles/mapbox/light-v11',
    center: [3.3792, 6.5244], // Lagos, Nigeria
    zoom: 12
  });

  // Fetch nearby taskers using PostGIS (Supabase rpc)
  const { lat, lng } = await getUserLocation();
  const { data: nearbyTaskers } = await window.supabase.rpc('get_taskers_within_radius', {
    lat, lng, radius_km: 10
  });

  nearbyTaskers.forEach(tasker => {
    new mapboxgl.Marker({ color: '#4A2C9A' })
      .setLngLat([tasker.lng, tasker.lat])
      .setPopup(new mapboxgl.Popup().setHTML(`<b>${tasker.name}</b>`))
      .addTo(map);
  });
  */
  console.log('[Future Sprint 3] initMapDiscovery stub called', { containerId });
}

/* ── Sprint 3: Social Feed ───────────────────────────────────── */

/**
 * Future Sprint 3: Fetches social posts from taskers showing
 * completed work (Instagram-style feed).
 */
async function fetchSocialFeed({ page = 0, limit = 12 } = {}) {
  /*
  const { data, error } = await window.supabase
    .from('posts')
    .select('*, profiles(name, avatar_url, service_type), likes(count)')
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (error) throw error;
  return data;
  */
  console.log('[Future Sprint 3] fetchSocialFeed stub called');
  return [];
}

/* ── Sprint 4: Subscription System ──────────────────────────────*/

/**
 * Future Sprint 4: Checks if a tasker has exceeded 5 free customer
 * connections and needs to upgrade to a paid subscription.
 * Paystack will be used for subscription billing.
 */
async function checkTaskerSubscription(taskerId) {
  /*
  const { count } = await window.supabase
    .from('bookings')
    .select('*', { count: 'exact' })
    .eq('tasker_id', taskerId)
    .eq('status', 'completed');

  return {
    isFree:       count < 5,
    usedFreeSlots: Math.min(count, 5),
    totalJobs:     count,
    needsUpgrade:  count >= 5,
  };
  */
  console.log('[Future Sprint 4] checkTaskerSubscription stub called', { taskerId });
  return { isFree: true, usedFreeSlots: 0, needsUpgrade: false };
}

/* ── Sprint 4: AI Task Assistant ─────────────────────────────── */

/**
 * Future Sprint 4: AI assistant that helps customers write
 * better task descriptions using Claude API or OpenAI.
 */
async function aiImproveTaskDescription(rawDescription) {
  /*
  const response = await fetch('/api/ai-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: `Improve this task description for a local services marketplace. 
               Make it clear, specific, and helpful for taskers to understand scope.
               Original: "${rawDescription}"`
    })
  });
  const { improved } = await response.json();
  return improved;
  */
  console.log('[Future Sprint 4] aiImproveTaskDescription stub called');
  return rawDescription;
}

/* ── Sprint 2: Trust & Ratings ───────────────────────────────── */

/**
 * Future Sprint 2: Submits a rating for a completed booking.
 */
async function submitRating({ bookingId, rating, comment, revieweeId }) {
  /*
  const { data, error } = await window.supabase.from('reviews').insert({
    booking_id:  bookingId,
    reviewee_id: revieweeId,
    rating,
    comment,
    created_at:  new Date().toISOString(),
  });

  if (error) throw error;

  // Future: Update avg_rating on the tasker_profiles table via trigger
  return data;
  */
  console.log('[Future Sprint 2] submitRating stub called', { bookingId, rating });
}

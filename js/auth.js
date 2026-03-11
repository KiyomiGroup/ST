/* ============================================================
   STREET TASKER — auth.js  (Sprint 3.2 Final)
   Authentication + role-based navbar sync
   ============================================================ */
'use strict';

async function getSession() {
  const { data: { session } } = await window.supabase.auth.getSession();
  return session;
}
async function getCurrentUser() {
  const s = await getSession();
  return s ? s.user : null;
}
async function getUserRole(user) {
  if (!user) return null;
  if (user.user_metadata?.role) return user.user_metadata.role;
  const { data } = await window.supabase.from('users').select('role').eq('id', user.id).maybeSingle();
  return data?.role || null;
}
function getDashboardUrl(role) {
  return role === 'tasker' ? 'dashboard-tasker.html' : 'dashboard-customer.html';
}

/* ── Navbar sync ─────────────────────────────────────────────── */
async function syncNavbarAuthState() {
  const user = await getCurrentUser();
  const $ = (s) => document.querySelectorAll(s);
  const show = (s) => $(s).forEach(el => (el.style.display = ''));
  const hide = (s) => $(s).forEach(el => (el.style.display = 'none'));

  if (user) {
    hide('.nav-loggedout');
    /* Ensure public.users row exists — covers Google OAuth sign-ins */
    try {
      const { data: existing } = await window.supabase.from('users').select('id').eq('id', user.id).maybeSingle();
      if (!existing) {
        const name = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
        const role_ = user.user_metadata?.role || 'customer';
        await window.supabase.from('users').upsert(
          { id: user.id, name, email: user.email, role: role_ },
          { onConflict: 'id' }
        );
      }
    } catch(e) { /* silent */ }
    const role = await getUserRole(user);
    if (role === 'tasker') { show('.nav-tasker'); hide('.nav-customer'); }
    else                   { show('.nav-customer'); hide('.nav-tasker'); }

    const name = user.user_metadata?.name || user.email?.split('@')[0] || 'Me';
    const chip = document.getElementById('navUserName');
    if (chip) { chip.textContent = name; chip.style.display = 'inline-flex'; }

    const lo = document.getElementById('navLogout');
    const ml = document.getElementById('navMobileLogout');
    if (lo) lo.style.display = 'inline-flex';
    if (ml) ml.style.display = 'flex';
  } else {
    show('.nav-loggedout');
    hide('.nav-customer');
    hide('.nav-tasker');
    ['navUserName','navDashboardLink','navMobileDashboard','navLogout','navMobileLogout'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
}

/* ── Auth operations ─────────────────────────────────────────── */
async function signUpUser({ name, email, password, role, phone = '' }) {
  const { data, error } = await window.supabase.auth.signUp({
    email, password, options: { data: { name, role } },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-up failed — try again.');

  await window.supabase.from('users').upsert(
    { id: data.user.id, name, email, role, phone: phone || null },
    { onConflict: 'id' }
  );

  if (role === 'tasker') {
    await window.supabase.from('taskers').upsert(
      { id: data.user.id, user_id: data.user.id, name, email, service: '', location: '', rating: 0, task_count: 0 },
      { onConflict: 'id' }
    );
  }
  return { user: data.user };
}

async function loginUser(email, password) {
  const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

async function logoutUser() {
  await window.supabase.auth.signOut();
  window.location.replace('index.html');
}

async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return null;
  }
  return user;
}

window.ST      = window.ST || {};
window.ST.auth = {
  getSession, getCurrentUser, getUserRole, getDashboardUrl,
  signUpUser, loginUser, logoutUser, requireAuth, syncNavbarAuthState,
};

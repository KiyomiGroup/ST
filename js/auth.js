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
/* ── Instant navbar init from localStorage (runs before network) ── */
function initNavbarInstant() {
  /* Read cached role from localStorage — set at login/signup */
  const cachedRole = localStorage.getItem('st_role') || 'customer';
  const cachedName = localStorage.getItem('st_name') || '';
  const isLoggedIn = !!localStorage.getItem('st_session');
  _applyNavState(isLoggedIn, cachedRole, cachedName);
}

function _applyNavState(loggedIn, role, name) {
  const id = (i) => document.getElementById(i);

  /* The 4 nav links are always visible — just update their href and label */
  if (loggedIn) {
    /* Logged in — update action link and show user info */
    const actionLink  = id('nav-action');
    const actionLabel = id('nav-action-label');
    const dashLink    = id('nav-dashboard');
    const mAction     = id('nav-mobile-action');
    const mDash       = id('nav-mobile-dashboard');

    if (role === 'tasker') {
      if (actionLink)  actionLink.href  = 'post-service.html';
      if (actionLabel) actionLabel.textContent = 'Post Service';
      if (dashLink)    dashLink.href    = 'dashboard-tasker.html';
      if (mAction)     mAction.href     = 'post-service.html';
      if (mAction)     mAction.textContent = 'Post Service';
      if (mDash)       mDash.href       = 'dashboard-tasker.html';
    } else {
      if (actionLink)  actionLink.href  = 'post-task.html';
      if (actionLabel) actionLabel.textContent = 'Post a Task';
      if (dashLink)    dashLink.href    = 'dashboard-customer.html';
      if (mAction)     mAction.href     = 'post-task.html';
      if (mAction)     mAction.textContent = 'Post a Task';
      if (mDash)       mDash.href       = 'dashboard-customer.html';
    }

    /* Show name chip + logout, hide login/signup */
    const chip = id('navUserName');
    if (chip && name) { chip.textContent = name; chip.style.display = 'inline-flex'; }
    const lo = id('navLogout'); if (lo) lo.style.display = 'inline-flex';
    const ml = id('navMobileLogout'); if (ml) ml.style.display = 'flex';
    const li = id('nav-login');    if (li) li.style.display = 'none';
    const si = id('nav-signup');   if (si) si.style.display = 'none';
    const mli = id('nav-mobile-login');  if (mli) mli.style.display = 'none';
    const msi = id('nav-mobile-signup'); if (msi) msi.style.display = 'none';
  } else {
    /* Logged out — show login/signup, hide user info */
    const li = id('nav-login');    if (li) li.style.display = '';
    const si = id('nav-signup');   if (si) si.style.display = '';
    const mli = id('nav-mobile-login');  if (mli) mli.style.display = '';
    const msi = id('nav-mobile-signup'); if (msi) msi.style.display = '';
    const lo = id('navLogout');    if (lo) lo.style.display = 'none';
    const ml = id('navMobileLogout'); if (ml) ml.style.display = 'none';
    const chip = id('navUserName'); if (chip) chip.style.display = 'none';
    /* Reset action links to default */
    const actionLabel = id('nav-action-label');
    if (actionLabel) actionLabel.textContent = 'Post a Task';
  }
}

async function syncNavbarAuthState() {
  const user = await getCurrentUser();

  if (user) {
    const role = await getUserRole(user);
    const name = user.user_metadata?.name || user.email?.split('@')[0] || 'Me';

    /* Cache in localStorage for instant next-page render */
    try {
      localStorage.setItem('st_role',    role);
      localStorage.setItem('st_name',    name);
      localStorage.setItem('st_session', '1');
    } catch(e) {}

    /* Ensure public.users row exists (covers Google OAuth) */
    try {
      const { data: existing } = await window.supabase
        .from('users').select('id').eq('id', user.id).maybeSingle();
      if (!existing) {
        await window.supabase.from('users').upsert(
          { id: user.id, name, role },
          { onConflict: 'id' }
        );
      }
    } catch(e) {}

    _applyNavState(true, role, name);
  } else {
    /* Clear cache */
    try {
      localStorage.removeItem('st_role');
      localStorage.removeItem('st_name');
      localStorage.removeItem('st_session');
    } catch(e) {}
    _applyNavState(false, 'customer', '');
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
  /* Cache for instant navbar render on next page load */
  try {
    const role = data.user?.user_metadata?.role || 'customer';
    const name = data.user?.user_metadata?.name || email.split('@')[0];
    localStorage.setItem('st_role',    role);
    localStorage.setItem('st_name',    name);
    localStorage.setItem('st_session', '1');
  } catch(e) {}
  return { user: data.user, session: data.session };
}

async function logoutUser() {
  /* Clear cached auth state so navbar shows logged-out instantly on next page */
  try {
    localStorage.removeItem('st_role');
    localStorage.removeItem('st_name');
    localStorage.removeItem('st_session');
  } catch(e) {}
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

/**
 * Requires the current user to have a specific role.
 * Redirects to the appropriate dashboard if the role doesn't match.
 * @param {'tasker'|'customer'} role
 * @returns {object|null} user if role matches, null otherwise
 */
async function requireRole(role) {
  const user = await requireAuth();
  if (!user) return null;
  const userRole = await getUserRole(user);
  if (userRole !== role) {
    const redirect = role === 'tasker' ? 'dashboard-customer.html' : 'dashboard-tasker.html';
    window.location.href = redirect;
    return null;
  }
  return user;
}

window.ST      = window.ST || {};
window.ST.auth = {
  getSession, getCurrentUser, getUserRole, getDashboardUrl,
  signUpUser, loginUser, logoutUser, requireAuth, requireRole, syncNavbarAuthState, initNavbarInstant,
};

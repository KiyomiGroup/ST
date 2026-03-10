/* ============================================================
   STREET TASKER — auth.js
   Sprint 3.1: Auth module — sign up, log in, log out,
               role-based redirects, navbar sync
   ============================================================
   All auth flows route through this module.
   window.ST.auth exposes all methods globally.

   Future Sprint: Google OAuth via supabase.auth.signInWithOAuth
   Future Sprint: Email confirmation gate before post-task
   Future Sprint: Password reset via supabase.auth.resetPasswordForEmail
   ============================================================ */

'use strict';

/* ── Session helpers ─────────────────────────────────────────── */

async function getSession() {
  const { data: { session } } = await window.supabase.auth.getSession();
  return session;
}

async function getCurrentUser() {
  const session = await getSession();
  return session ? session.user : null;
}

/**
 * Returns the role ('customer' | 'tasker') for the current user.
 * Reads from user_metadata first, then falls back to users table.
 */
async function getUserRole(user) {
  if (!user) return null;

  /* Fast path: role stored in auth metadata at signup */
  if (user.user_metadata?.role) return user.user_metadata.role;

  /* Fallback: query users table */
  const { data } = await window.supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return data?.role || null;
}

/**
 * Returns the correct dashboard URL for a given role.
 */
function getDashboardUrl(role) {
  return role === 'tasker' ? 'dashboard-tasker.html' : 'dashboard-customer.html';
}

/* ── Navbar sync ─────────────────────────────────────────────── */

/**
 * Updates the navbar to reflect logged-in vs logged-out state.
 * Hides/shows the appropriate elements and sets the dashboard link.
 * Called by app.js after components are injected.
 */
async function syncNavbarAuthState() {
  const user = await getCurrentUser();

  /* Elements that must exist in navbar.html */
  const loggedOutEls  = document.querySelectorAll('.nav-auth-loggedout');
  const loggedInEls   = document.querySelectorAll('.nav-auth-loggedin');
  const navLogout     = document.getElementById('navLogout');
  const navMobileLogout = document.getElementById('navMobileLogout');
  const navUserChip   = document.getElementById('navUserName');
  const navDashLink   = document.getElementById('navDashboardLink');
  const navMobileDash = document.getElementById('navMobileDashboard');

  if (user) {
    /* Show logged-in elements, hide logged-out */
    loggedOutEls.forEach(el => { el.style.display = 'none'; });
    loggedInEls.forEach(el  => { el.style.display = 'inline-flex'; });

    /* User chip (name / email prefix) */
    if (navUserChip) {
      const displayName = user.user_metadata?.name || user.email?.split('@')[0] || 'Account';
      navUserChip.textContent = displayName;
      navUserChip.style.display = 'inline-flex';
    }

    /* Role-based dashboard link */
    const role = await getUserRole(user);
    const dashUrl = getDashboardUrl(role);

    if (navDashLink)   { navDashLink.href   = dashUrl; navDashLink.style.display   = 'inline-flex'; }
    if (navMobileDash) { navMobileDash.href = dashUrl; navMobileDash.style.display = 'block'; }
    if (navLogout)       navLogout.style.display       = 'inline-flex';
    if (navMobileLogout) navMobileLogout.style.display = 'flex';

  } else {
    /* Logged out — show default nav */
    loggedOutEls.forEach(el => { el.style.display = ''; });
    loggedInEls.forEach(el  => { el.style.display = 'none'; });
    if (navUserChip)     navUserChip.style.display     = 'none';
    if (navDashLink)     navDashLink.style.display     = 'none';
    if (navMobileDash)   navMobileDash.style.display   = 'none';
    if (navLogout)       navLogout.style.display       = 'none';
    if (navMobileLogout) navMobileLogout.style.display = 'none';
  }
}

/* ── Sign Up ─────────────────────────────────────────────────── */

/**
 * Creates a Supabase Auth account and inserts profile rows.
 * Role is stored in auth metadata AND in the users table.
 */
async function signUpUser({ name, email, password, role, phone = '' }) {
  const { data, error: authError } = await window.supabase.auth.signUp({
    email,
    password,
    options: { data: { name, role } },
  });

  if (authError) throw authError;
  if (!data.user) throw new Error('Sign-up failed — please try again.');

  /* Insert into users table (upsert guards against DB triggers) */
  const { error: dbError } = await window.supabase.from('users').upsert({
    id:         data.user.id,
    name,
    email,
    role,
    phone:      phone || null,
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (dbError) console.warn('[Auth] users insert (non-fatal):', dbError.message);

  /* If tasker: also seed the taskers table with a minimal row */
  if (role === 'tasker') {
    const { error: taskerErr } = await window.supabase.from('taskers').upsert({
      id:         data.user.id,
      user_id:    data.user.id,
      name,
      email,
      service:    '',
      location:   '',
      rating:     0,
      task_count: 0,
      created_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (taskerErr) console.warn('[Auth] taskers insert (non-fatal):', taskerErr.message);
  }

  console.log('[Auth] Sign up OK —', email, '—', role);
  return { user: data.user };
}

/* ── Log In ──────────────────────────────────────────────────── */

/**
 * Signs in with email + password.
 * Returns user + session. Caller is responsible for redirect.
 */
async function loginUser(email, password) {
  const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  console.log('[Auth] Login OK —', email);
  return { user: data.user, session: data.session };
}

/* ── Log Out ─────────────────────────────────────────────────── */

/**
 * Signs out and redirects to login page.
 */
async function logoutUser() {
  await window.supabase.auth.signOut();
  window.location.href = 'login.html';
}

/* ── Auth guard ──────────────────────────────────────────────── */

/**
 * Redirects to login if the user is not authenticated.
 * Returns the user object if authenticated, null otherwise.
 */
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return null;
  }
  return user;
}

/**
 * Redirects to login if not authenticated, and also checks
 * the user has the expected role. Redirects to index if wrong role.
 */
async function requireRole(expectedRole) {
  const user = await requireAuth();
  if (!user) return null;

  const role = await getUserRole(user);
  if (role !== expectedRole) {
    window.location.href = getDashboardUrl(role);
    return null;
  }
  return user;
}

/* ── Expose globally ─────────────────────────────────────────── */
window.ST = window.ST || {};
window.ST.auth = {
  getSession,
  getCurrentUser,
  getUserRole,
  getDashboardUrl,
  signUpUser,
  loginUser,
  logoutUser,
  requireAuth,
  requireRole,
  syncNavbarAuthState,
};

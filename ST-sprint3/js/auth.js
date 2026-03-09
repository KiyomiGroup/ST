/* ============================================================
   STREET TASKER — auth.js
   Sprint 3: Supabase authentication — sign up, log in, log out
   ============================================================
   Handles all auth flows and syncs UI state based on session.

   Future Sprint: Add Google OAuth via supabase.auth.signInWithOAuth
   Future Sprint: Add password reset flow
   Future Sprint: Add email confirmation check before allowing post-task
   ============================================================ */

'use strict';

/* ── Session helpers ─────────────────────────────────────────── */

/**
 * Returns the current Supabase session, or null if not logged in.
 */
async function getSession() {
  const { data: { session } } = await window.supabase.auth.getSession();
  return session;
}

/**
 * Returns the current user object, or null.
 */
async function getCurrentUser() {
  const session = await getSession();
  return session ? session.user : null;
}

/**
 * Updates navbar to show user state (logged in vs logged out).
 * Called on every page load after component injection.
 */
async function syncNavbarAuthState() {
  const user = await getCurrentUser();
  const loginLink  = document.querySelector('a[href="login.html"]');
  const signupLink = document.querySelector('a[href="signup.html"]');
  const logoutBtn  = document.getElementById('navLogout');

  if (user) {
    /* Hide login/signup links, show logout button */
    if (loginLink)  loginLink.closest('li, .nav-item, a')?.style && (loginLink.style.display = 'none');
    if (signupLink) signupLink.closest('li, .nav-item, a')?.style && (signupLink.style.display = 'none');
    if (logoutBtn)  logoutBtn.style.display = 'inline-flex';

    /* Show user email/name in nav if element exists */
    const navUserEl = document.getElementById('navUserName');
    if (navUserEl) {
      navUserEl.textContent = user.user_metadata?.name || user.email?.split('@')[0] || 'Account';
      navUserEl.style.display = 'inline';
    }
  } else {
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

/* ── Sign Up ─────────────────────────────────────────────────── */

/**
 * Creates a new Supabase Auth user and inserts a row in the
 * `users` table with role and profile data.
 *
 * @param {Object} opts
 * @param {string} opts.name
 * @param {string} opts.email
 * @param {string} opts.password
 * @param {string} opts.role  'customer' | 'tasker'
 * @param {string} [opts.phone]
 * @returns {Promise<{user: object}>}
 */
async function signUpUser({ name, email, password, role, phone = '' }) {
  /* 1. Create auth account */
  const { data, error: authError } = await window.supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, role },
    },
  });

  if (authError) throw authError;
  if (!data.user) throw new Error('Sign-up failed — please try again.');

  /* 2. Insert profile row into users table
        Uses upsert in case trigger already created the row. */
  const { error: dbError } = await window.supabase.from('users').upsert({
    id:         data.user.id,
    name,
    email,
    role,
    phone:      phone || null,
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (dbError) {
    console.warn('[Auth] users table insert failed (non-fatal):', dbError.message);
    /* Non-fatal: auth account was created; profile row can be patched later */
  }

  /* 3. If tasker, also create a row in taskers table */
  if (role === 'tasker') {
    const { error: taskerErr } = await window.supabase.from('taskers').upsert({
      id:         data.user.id,
      user_id:    data.user.id,
      name,
      email,
      service:    '',   /* tasker fills in profile later */
      location:   '',
      rating:     0,
      task_count: 0,
      created_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (taskerErr) {
      console.warn('[Auth] taskers table insert failed (non-fatal):', taskerErr.message);
    }
  }

  console.log('[Auth] Sign up successful for', email);
  return { user: data.user };
}

/* ── Log In ──────────────────────────────────────────────────── */

/**
 * Signs the user in with email + password.
 * On success, session is persisted in localStorage automatically.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object, session: object}>}
 */
async function loginUser(email, password) {
  const { data, error } = await window.supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;

  console.log('[Auth] Login successful for', email);
  return { user: data.user, session: data.session };
}

/* ── Log Out ─────────────────────────────────────────────────── */

/**
 * Signs the user out and redirects to home page.
 */
async function logoutUser() {
  await window.supabase.auth.signOut();
  window.location.href = 'index.html';
}

/* ── Auth guard ──────────────────────────────────────────────── */

/**
 * Redirects unauthenticated users to login.html.
 * Call this at the top of any protected page's initPage().
 */
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return null;
  }
  return user;
}

/* ── Expose globally ─────────────────────────────────────────── */
window.ST = window.ST || {};
window.ST.auth = { getSession, getCurrentUser, signUpUser, loginUser, logoutUser, requireAuth, syncNavbarAuthState };

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
  document.body.classList.toggle('st-logged-in', !!loggedIn);

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
    /* Dashboard link only appears in the nav once a user is logged in */
    if (dashLink) dashLink.style.display = '';
    if (mDash)    mDash.style.display    = '';
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
    /* Dashboard link is only for logged-in users */
    const dl = id('nav-dashboard');        if (dl) dl.style.display = 'none';
    const mdl = id('nav-mobile-dashboard'); if (mdl) mdl.style.display = 'none';
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
  /* Supabase silently resends confirmation for duplicate emails instead of erroring.
     Detect this by checking identities array on the returned user object. */
  const { data, error } = await window.supabase.auth.signUp({
    email, password, options: { data: { name, role } },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-up failed — try again.');
  /* Empty identities = email already registered */
  if (!data.user.identities || data.user.identities.length === 0) {
    throw new Error('An account with this email already exists. Please log in instead.');
  }

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
  /* Clear ALL cached auth state */
  try {
    localStorage.removeItem('st_role');
    localStorage.removeItem('st_name');
    localStorage.removeItem('st_session');
    /* Also clear any Supabase persisted session keys */
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('sb-') || k.startsWith('supabase')) localStorage.removeItem(k);
    });
  } catch(e) {}
  try { await window.supabase.auth.signOut(); } catch(e) {}
  /* Force a clean reload of homepage with no cache */
  window.location.href = 'index.html?_=' + Date.now();
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

/* ── Search page as logged-in "home" — welcome heading + avatar ──
   Runs on find-tasks.html / find-taskers.html only (no-ops elsewhere,
   since the target elements won't exist on other pages). Paints
   instantly from cached localStorage, then refreshes from the DB in
   case the avatar changed since the last cache. */
async function initDashboardWelcome() {
  const headline = document.getElementById('spgHeroHeadline');
  if (!headline) return;

  const cachedName   = localStorage.getItem('st_name')   || '';
  const cachedAvatar = localStorage.getItem('st_avatar') || '';
  const isLoggedIn   = !!localStorage.getItem('st_session');
  if (!isLoggedIn) return;

  const sub            = document.getElementById('spgHeroSub');
  const eyebrowText     = document.getElementById('spgHeroEyebrowText');
  const heroAvatar      = document.getElementById('spgHeroAvatar');
  const heroAvatarImg   = document.getElementById('spgHeroAvatarImg');
  const heroAvatarInit  = document.getElementById('spgHeroAvatarInitial');
  const navAvatarImg    = document.getElementById('navMobileAvatarImg');
  const navAvatarInit   = document.getElementById('navMobileAvatarInitial');

  function applyAvatar(name, avatarUrl) {
    const initial = (name || 'U').trim().charAt(0).toUpperCase() || 'U';
    [[heroAvatarImg, heroAvatarInit], [navAvatarImg, navAvatarInit]].forEach(([img, initEl]) => {
      if (!img || !initEl) return;
      if (avatarUrl) {
        img.src = avatarUrl; img.style.display = 'block'; initEl.style.display = 'none';
      } else {
        img.style.display = 'none'; initEl.style.display = 'block'; initEl.textContent = initial;
      }
    });
  }

  const firstName = (cachedName || 'there').split(' ')[0];
  headline.textContent = `Welcome back, ${firstName}!`;
  if (eyebrowText) eyebrowText.textContent = 'Your Dashboard';
  if (sub) sub.textContent = "Here's what's happening in your neighborhood today.";
  if (heroAvatar) heroAvatar.style.display = 'flex';
  applyAvatar(cachedName, cachedAvatar);

  const bnProfile = document.getElementById('spgBnProfile');
  if (bnProfile) bnProfile.href = getDashboardUrl(localStorage.getItem('st_role') || 'customer');

  try {
    const user = await getCurrentUser();
    if (!user) return;
    const { data } = await window.supabase.from('users').select('name, avatar_url').eq('id', user.id).maybeSingle();
    if (data) {
      if (data.avatar_url) localStorage.setItem('st_avatar', data.avatar_url);
      applyAvatar(data.name || cachedName, data.avatar_url || cachedAvatar);
    }
  } catch (e) { /* cached version above already applied — fail silently */ }
}

window.ST      = window.ST || {};
window.ST.auth = {
  getSession, getCurrentUser, getUserRole, getDashboardUrl,
  signUpUser, loginUser, logoutUser, requireAuth, requireRole, syncNavbarAuthState, initNavbarInstant,
  initDashboardWelcome,
};

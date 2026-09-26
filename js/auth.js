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
  const $ = (i) => document.getElementById(i);
  const body = document.body;

  /* Body classes drive CSS show/hide rules */
  body.classList.toggle('st-logged-in',   !!loggedIn);
  body.classList.toggle('role-tasker',    !!loggedIn && role === 'tasker');
  body.classList.toggle('role-customer',  !!loggedIn && role !== 'tasker');

  if (loggedIn) {
    const isTasker = role === 'tasker';
    const dashUrl  = isTasker ? 'dashboard-tasker.html' : 'dashboard-customer.html';

    /* Show the correct pill nav */
    const pillT = $('navPillTasker');
    const pillC = $('navPillCustomer');
    if (pillT) pillT.style.display = isTasker  ? 'flex' : 'none';
    if (pillC) pillC.style.display = !isTasker ? 'flex' : 'none';

    /* Role badge */
    const badgeT = $('navRoleBadge');
    const badgeC = $('navRoleBadgeCustomer');
    if (badgeT) badgeT.style.display = isTasker  ? 'flex' : 'none';
    if (badgeC) badgeC.style.display = !isTasker ? 'flex' : 'none';

    /* Icon bar */
    const iconBar = $('navIconBar');
    if (iconBar) iconBar.style.display = 'flex';

    /* Update icon bar links for role */
    const iconBookings = $('navIconBookings');
    const iconMessages = $('navIconMessages');
    const iconSettings = $('navIconSettings');
    if (iconBookings) iconBookings.href = dashUrl + '?panel=bookings';
    if (iconMessages) iconMessages.href = dashUrl + '?panel=messages';
    if (iconSettings) iconSettings.href = dashUrl + '?panel=profile';

    /* Avatar initials */
    const initials = name
      ? name.trim().replace(/[^a-zA-Z ]/g,'').split(' ').filter(Boolean)
             .map(w => w[0]).join('').slice(0,2).toUpperCase()
      : (isTasker ? 'T' : 'U');
    const av = $('navAvatar');
    const avInit = $('navAvatarInitial');
    if (avInit) avInit.textContent = initials;
    if (av)     av.href = dashUrl;

    /* Mobile: hide + / show account icons */
    const mPlus = $('nav-mobile-plus-btn');
    const mAcct = $('navMobileAccount');
    if (mPlus) mPlus.style.display = 'none';
    if (mAcct) mAcct.style.display = 'flex';
    const mAvInit = $('navMobileAvatarInitial');
    if (mAvInit) mAvInit.textContent = initials;
    const mDash = $('nav-mobile-dashboard');
    if (mDash) { mDash.href = dashUrl; mDash.style.display = ''; }

    /* Hide logged-out elements */
    [$('nav-login'),$('nav-signup'),$('nav-mobile-login'),$('nav-mobile-signup')]
      .forEach(el => el && (el.style.display = 'none'));
    const mlo = $('navMobileLogout'); if (mlo) mlo.style.display = 'flex';

    /* Highlight active pill item based on current page */
    _highlightActivePillItem();

  } else {
    /* Logged out */
    const pillT = $('navPillTasker');
    const pillC = $('navPillCustomer');
    if (pillT) pillT.style.display = 'none';
    if (pillC) pillC.style.display = 'none';
    const iconBar = $('navIconBar');
    if (iconBar) iconBar.style.display = 'none';
    [$('navRoleBadge'),$('navRoleBadgeCustomer')]
      .forEach(el => el && (el.style.display = 'none'));
    [$('nav-login'),$('nav-signup'),$('nav-mobile-login'),$('nav-mobile-signup')]
      .forEach(el => el && (el.style.display = ''));
    const mlo = $('navMobileLogout'); if (mlo) mlo.style.display = 'none';
    const mPlus = $('nav-mobile-plus-btn');
    const mAcct = $('navMobileAccount');
    if (mPlus) mPlus.style.display = '';
    if (mAcct) mAcct.style.display = 'none';
  }
}

function _highlightActivePillItem() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const search = window.location.search;
  const panel  = new URLSearchParams(search).get('panel') || '';
  /* Remove all active states */
  document.querySelectorAll('.nav-pill-item').forEach(el => el.classList.remove('active'));
  /* Match by page + panel */
  const map = {
    'dashboard-tasker.html':   { '': 'np-overview',      'applications': 'np-applications', 'bookings': 'np-bookings', 'messages': 'np-messages', 'wallet': 'np-wallet' },
    'dashboard-customer.html': { '': 'npc-overview',     'my-tasks': 'npc-tasks', 'applications': 'npc-applications', 'bookings': 'npc-bookings', 'messages': 'npc-messages', 'wallet': 'npc-wallet' },
    'find-tasks.html':         { '': 'np-find-tasks' },
    'find-taskers.html':       { '': 'npc-find-taskers' },
  };
  const pageMap = map[page];
  if (pageMap) {
    const targetId = pageMap[panel] || pageMap[''];
    if (targetId) {
      const el = document.getElementById(targetId);
      if (el) el.classList.add('active');
    }
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
    /* Try to load profile photo */
    try {
      const photoUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
      const uRes = !photoUrl && await window.supabase.from('users').select('avatar_url').eq('id', user.id).maybeSingle();
      const finalPhoto = photoUrl || (uRes?.data?.avatar_url);
      if (finalPhoto) {
        const avImg = document.getElementById('navAvatarImg');
        const avInit = document.getElementById('navAvatarInitial');
        if (avImg) {
          avImg.src = finalPhoto;
          avImg.style.display = 'block';
          if (avInit) avInit.style.display = 'none';
          avImg.onerror = () => { avImg.style.display = 'none'; if (avInit) avInit.style.display = ''; };
        }
      }
    } catch(_e) {}
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

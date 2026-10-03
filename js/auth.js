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

    /* Role badge — taskers on the Pro plan read "TASKER PRO" (plan cached
       in localStorage by syncNavbarAuthState, so it renders instantly) */
    const badgeT = $('navRoleBadge');
    const badgeC = $('navRoleBadgeCustomer');
    const isPro  = isTasker && _getCachedPlan() === 'pro';
    if (badgeT) {
      badgeT.textContent = isPro ? 'TASKER PRO' : 'TASKER';
      badgeT.classList.toggle('is-pro', isPro);
      badgeT.style.display = isTasker ? 'flex' : 'none';
    }
    if (badgeC) badgeC.style.display = !isTasker ? 'flex' : 'none';

    /* Icon bar */
    const iconBar = $('navIconBar');
    if (iconBar) iconBar.style.display = 'flex';

    /* Icon bar links, per role:
       Pending Tasks -> customer: My Tasks, tasker: Bookings
       Messages / Notifications -> that panel on the user's dashboard
       Settings icon -> dropdown (Settings + Log out)
       Avatar -> profile edit */
    const panelUrl = (panel) => dashUrl + '?panel=' + panel;
    const setHref  = (id, url) => { const el = $(id); if (el) el.href = url; };
    setHref('navIconPending',  panelUrl(isTasker ? 'bookings' : 'my-tasks'));
    setHref('navIconMessages', panelUrl('messages'));
    setHref('navBellBtn',      panelUrl('notifications'));
    setHref('navMenuSettings', panelUrl('profile'));
    document.querySelectorAll('.nav-menu-item[data-nav-role]').forEach(el => {
      el.hidden = el.dataset.navRole !== (isTasker ? 'tasker' : 'customer');
    });

    /* Avatar initials */
    const initials = name
      ? name.trim().replace(/[^a-zA-Z ]/g,'').split(' ').filter(Boolean)
             .map(w => w[0]).join('').slice(0,2).toUpperCase()
      : (isTasker ? 'T' : 'U');
    const av = $('navAvatar');
    const avInit = $('navAvatarInitial');
    if (avInit) avInit.textContent = initials;
    if (av)     av.href = panelUrl('profile');

    /* Mobile: hide + / show account icons */
    const mPlus = $('nav-mobile-plus-btn');
    const mAcct = $('navMobileAccount');
    if (mPlus) mPlus.style.display = 'none';
    if (mAcct) mAcct.style.display = ''; /* shown on mobile by CSS (body.st-logged-in) */
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
    if (mAcct) mAcct.style.display = '';
  }
}

function _highlightActivePillItem() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const search = window.location.search;
  let panel  = new URLSearchParams(search).get('panel') || '';
  if (panel === 'overview') panel = '';
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
    /* A panel with no pill (notifications, profile) leaves every pill off */
    const targetId = pageMap[panel];
    if (targetId) {
      const el = document.getElementById(targetId);
      if (el) el.classList.add('active');
    }
  }
}

/* ── Logged-in nav: plan, counts and indicator dots ───────────── */
function _getCachedPlan() {
  try { return localStorage.getItem('st_plan') || 'free'; } catch(e) { return 'free'; }
}

function _setNavDot(id, on) {
  const el = document.getElementById(id);
  if (el) el.hidden = !on;
}

function _setNavCount(id, n) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = n > 0 ? String(n > 9 ? '9+' : n) : '';
  el.hidden = !(n > 0);
}

/* Reads the Pro plan, the pending-applications count and the unread
   dots for the nav. Every query is optional: a failure just leaves that
   indicator off. */
async function _loadNavIndicators(user, role) {
  const sb = window.supabase;
  if (!sb || !user) return;
  const isTasker = role === 'tasker';

  if (isTasker) {
    try {
      const { data: sub } = await sb.from('subscriptions')
        .select('tier, status, end_date').eq('tasker_id', user.id).eq('status', 'active').maybeSingle();
      const live = !!sub && (!sub.end_date || new Date(sub.end_date) > new Date());
      const plan = live ? (sub.tier || 'starter') : 'free';
      try { localStorage.setItem('st_plan', plan); } catch(e) {}
      const badge = document.getElementById('navRoleBadge');
      if (badge) {
        badge.textContent = plan === 'pro' ? 'TASKER PRO' : 'TASKER';
        badge.classList.toggle('is-pro', plan === 'pro');
      }
    } catch(e) {}
  }

  /* Pending Tasks dot */
  try {
    if (isTasker) {
      const { count } = await sb.from('bookings').select('id', { count: 'exact', head: true })
        .eq('tasker_id', user.id).eq('status', 'pending');
      _setNavDot('navPendingDot', (count || 0) > 0);
    } else {
      const { count } = await sb.from('tasks').select('id', { count: 'exact', head: true })
        .or('customer_id.eq.' + user.id + ',user_id.eq.' + user.id).in('status', ['open', 'pending']);
      _setNavDot('navPendingDot', (count || 0) > 0);
    }
  } catch(e) {}

  /* Messages dot (unread threads for this user's side of the chat) */
  try {
    const col = isTasker ? 'tasker_unread' : 'customer_unread';
    const { data } = await sb.from('message_threads').select(col)
      .or('customer_id.eq.' + user.id + ',tasker_id.eq.' + user.id);
    _setNavDot('navMsgDot', (data || []).some(t => (t[col] || 0) > 0));
  } catch(e) {}

  /* Notifications dot */
  try {
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_read', false);
    _setNavDot('navNotifDot', (count || 0) > 0);
  } catch(e) {}

  /* Applications (n) in the pill: pending applications */
  try {
    let n = 0;
    if (isTasker) {
      const { count } = await sb.from('task_applications').select('id', { count: 'exact', head: true })
        .eq('tasker_id', user.id).eq('status', 'pending');
      n = count || 0;
      _setNavCount('npAppCount', n);
    } else {
      const { data: myTasks } = await sb.from('tasks').select('id')
        .or('customer_id.eq.' + user.id + ',user_id.eq.' + user.id);
      const ids = (myTasks || []).map(t => t.id);
      if (ids.length) {
        const { count } = await sb.from('task_applications').select('id', { count: 'exact', head: true })
          .in('task_id', ids).eq('status', 'pending');
        n = count || 0;
      }
      _setNavCount('npcAppCount', n);
    }
  } catch(e) {}
}

/* ── Nav dropdown + logout (one delegated listener for every nav) ── */
function _closeNavMenus(except) {
  document.querySelectorAll('.nav-menu').forEach(menu => {
    if (menu === except || menu.hidden) return;
    menu.hidden = true;
    const t = menu.parentElement && menu.parentElement.querySelector('[data-nav-menu-toggle]');
    if (t) t.setAttribute('aria-expanded', 'false');
  });
}

function _initNavMenus() {
  if (window.__stNavMenusReady) return;
  window.__stNavMenusReady = true;

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-nav-menu-toggle]');
    const menu   = toggle && toggle.parentElement.querySelector('.nav-menu');
    _closeNavMenus(menu);
    if (toggle && menu) {
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    if (e.target.closest('[data-nav-logout]')) { logoutUser(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.nav-menu:not([hidden])');
    if (!open) return;
    const t = open.parentElement.querySelector('[data-nav-menu-toggle]');
    _closeNavMenus();
    if (t) t.focus();
  });
}
_initNavMenus();

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
    _loadNavIndicators(user, role); /* plan badge, counts, dots — non-blocking */
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
      localStorage.removeItem('st_plan');
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
    localStorage.removeItem('st_plan');
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

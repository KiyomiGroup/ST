/* ============================================================
   StreetTasker — coordinator.js (Stage 3A)
   Route guard + shell wiring for coordinator-*.html pages.

   The guard is a convenience, not the security: the database decides what a
   coordinator can read (RLS + is_active_coordinator()). This script keeps people
   who are not active coordinators out of the page and fails CLOSED: the page
   content stays hidden until the server has said "yes".

   Checks, in order:
     1. a Supabase session exists        -> else coordinator-login.html?redirect=...
     2. rpc is_active_coordinator() true -> else coordinator-login.html?denied=...
     3. own row in public.coordinators   -> name for the header (read-own-row policy)
   If a check cannot finish (network, server error) the page shows a retry
   button and does NOT redirect, so a flaky connection never logs anyone out.
   ============================================================ */
'use strict';

(function () {
  var LOGIN_PAGE = 'coordinator-login.html';
  var SESSION_ONLY_KEY = 'st_co_session_only';   /* localStorage: user unticked "Remember me" */
  var TAB_ALIVE_KEY    = 'st_co_tab_alive';      /* sessionStorage: this browser session signed in */

  var state = { running: false, navLoaded: false, redirecting: false };

  function $(id) { return document.getElementById(id); }

  function currentPage() {
    return window.location.pathname.split('/').pop() || 'coordinator-dashboard.html';
  }

  function goToLogin(params) {
    if (state.redirecting) return;
    state.redirecting = true;
    var q = new URLSearchParams(params || {});
    window.location.replace(LOGIN_PAGE + (q.toString() ? '?' + q.toString() : ''));
  }

  function showGateError() {
    var text = $('coGateText'); if (text) text.hidden = true;
    var err = $('coGateError'); if (err) err.hidden = false;
  }
  function showGateChecking() {
    var text = $('coGateText'); if (text) text.hidden = false;
    var err = $('coGateError'); if (err) err.hidden = true;
  }

  /* "Remember me" unticked: end the session when the browser session ends.
     localStorage keeps the Supabase session, sessionStorage does not survive
     closing the browser, so a missing tab marker means a new browser session. */
  function sessionOnlyExpired() {
    try {
      return localStorage.getItem(SESSION_ONLY_KEY) === '1' && !sessionStorage.getItem(TAB_ALIVE_KEY);
    } catch (e) { return false; }
  }

  function clearCachedAuth() {
    try {
      localStorage.removeItem(SESSION_ONLY_KEY);
      ['st_role', 'st_name', 'st_session', 'st_plan', 'st_email', 'st_avatar'].forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* storage blocked: nothing cached to clear */ }
    try { sessionStorage.removeItem(TAB_ALIVE_KEY); } catch (e) {}
  }

  async function signOut() {
    try { await window.supabase.auth.signOut(); } catch (e) { /* leave anyway */ }
    clearCachedAuth();
    goToLogin({ signedout: '1' });
  }

  function initialsOf(name) {
    var parts = String(name || '').replace(/[^a-zA-Z ]/g, ' ').split(' ').filter(Boolean);
    if (!parts.length) return 'CO';
    return parts.slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function firstNameOf(name) {
    var first = String(name || '').trim().split(/\s+/)[0];
    return first || 'Coordinator';
  }

  /* ── Navigation component ─────────────────────────────────── */
  async function loadNav() {
    var root = $('coNavRoot');
    if (!root || state.navLoaded) return;
    var res = await fetch('components/coordinator-nav.html');
    if (!res.ok) throw new Error('nav ' + res.status);
    root.innerHTML = await res.text();
    state.navLoaded = true;

    var page = currentPage();
    root.querySelectorAll('[data-co-page]').forEach(function (el) {
      if (el.getAttribute('data-co-page') === page) el.setAttribute('aria-current', 'page');
    });

    var so = $('coSignOut'); if (so) so.addEventListener('click', signOut);
    var dso = $('coDrawerSignOut'); if (dso) dso.addEventListener('click', signOut);
    wireMenus();
  }

  function wireMenus() {
    var avatarBtn = $('coAvatarBtn'), menu = $('coMenu');
    var menuBtn = $('coMenuBtn'), drawer = $('coDrawer'), backdrop = $('coDrawerBackdrop');

    function setMenu(open) {
      if (!menu || !avatarBtn) return;
      menu.hidden = !open;
      avatarBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function setDrawer(open) {
      if (!drawer || !menuBtn) return;
      drawer.hidden = !open;
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('co-drawer-open', open);
    }

    if (avatarBtn) avatarBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenu(menu.hidden);
    });
    if (menuBtn) menuBtn.addEventListener('click', function () { setDrawer(drawer.hidden); });
    if (backdrop) backdrop.addEventListener('click', function () { setDrawer(false); });
    document.addEventListener('click', function (e) {
      if (menu && !menu.hidden && !menu.contains(e.target)) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      setMenu(false);
      setDrawer(false);
    });
  }

  function paintIdentity(name) {
    var display = name || 'Coordinator';
    var set = function (id, text) { var el = $(id); if (el) el.textContent = text; };
    set('coAvatarInitials', initialsOf(display));
    set('coMenuName', display);
    set('coDrawerName', display);
    set('coWelcomeName', firstNameOf(display));
  }

  /* ── The guard ────────────────────────────────────────────── */
  async function runGuard() {
    if (state.running) return;
    state.running = true;
    showGateChecking();
    document.body.classList.add('co-guarding');

    try {
      var sb = window.supabase;
      if (!sb || !sb.auth) throw new Error('Supabase client missing');

      var sessionRes = await sb.auth.getSession();
      if (sessionRes.error) throw sessionRes.error;
      var session = sessionRes.data && sessionRes.data.session;

      if (!session) {
        var here = currentPage() + window.location.search;
        goToLogin({ redirect: here });
        return;
      }

      if (sessionOnlyExpired()) {
        await signOut();
        return;
      }

      var active = await sb.rpc('is_active_coordinator');
      if (active.error) throw active.error;
      if (active.data !== true) {
        /* Tell "has a coordinator record but not active" from "not a coordinator". */
        var isCo = await sb.rpc('is_coordinator');
        goToLogin({ denied: (!isCo.error && isCo.data === true) ? 'inactive' : 'no' });
        return;
      }

      /* Name for the header. A missing row or error here is not fatal: the guard
         already passed, so fall back to the email. */
      var name = '';
      try {
        var row = await sb.from('coordinators').select('display_name, status').eq('user_id', session.user.id).maybeSingle();
        if (!row.error && row.data) name = row.data.display_name || '';
      } catch (e) { /* use fallback */ }
      if (!name) name = (session.user.email || '').split('@')[0];

      await loadNav();
      paintIdentity(name);

      var gate = $('coGate'); if (gate) gate.hidden = true;
      document.body.classList.remove('co-guarding');
      document.dispatchEvent(new CustomEvent('coordinator:ready', {
        detail: { userId: session.user.id, displayName: name }
      }));
    } catch (e) {
      console.error('[coordinator guard]', e);
      showGateError();
    } finally {
      state.running = false;
    }
  }

  function init() {
    var retry = $('coGateRetry');
    if (retry) retry.addEventListener('click', runGuard);

    /* Signed out in another tab, or the session expired: back to sign-in. */
    if (window.supabase && window.supabase.auth) {
      window.supabase.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT') goToLogin({ signedout: '1' });
      });
    }

    /* Back button after signing out can restore the page from the browser cache. */
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) {
        document.body.classList.add('co-guarding');
        var gate = $('coGate'); if (gate) gate.hidden = false;
        runGuard();
      }
    });

    runGuard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.STCoordinator = { signOut: signOut, SESSION_ONLY_KEY: SESSION_ONLY_KEY, TAB_ALIVE_KEY: TAB_ALIVE_KEY };
})();

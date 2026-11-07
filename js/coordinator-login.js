/* ============================================================
   StreetTasker — coordinator-login.js (Stage 3A)
   Sign-in for coordinator-login.html.

   Signs in with email + password, then asks the database whether the account is an
   ACTIVE coordinator (rpc is_active_coordinator). Anyone else is signed straight
   back out with a plain message. It does not use ST.auth.loginUser, so it does not
   write the customer/tasker navbar cache (st_role etc.).
   ============================================================ */
'use strict';

(function () {
  var SESSION_ONLY_KEY = 'st_co_session_only';
  var TAB_ALIVE_KEY    = 'st_co_tab_alive';
  var HOME = 'coordinator-dashboard.html';
  var IDENTITY_PAGE = 'coordinator-identity.html';   /* a pending coordinator (identity check not passed yet) goes here */
  var lastFinishError = '';   /* why coordinator_finish_signup said no, for the message */

  function $(id) { return document.getElementById(id); }

  /* links: optional [{ text, href }] appended after the message (static links only). */
  function showMsg(text, kind, links) {
    var el = $('coLoginMsg');
    if (!el) return;
    el.textContent = text;
    (links || []).forEach(function (l) {
      el.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = l.href;
      a.textContent = l.text;
      el.appendChild(a);
    });
    el.classList.toggle('co-banner--info', kind === 'info');
    el.hidden = false;
  }
  /* Coordinator accounts are separate from customer and tasker accounts, so this page never points to the customer or tasker sign-in. */
  function showNotCoordinator() {
    if (lastFinishError === 'invalid_code') showMsg('Your coordinator code has already been used or has expired, so your coordinator account could not be finished. Take the coordinator test again or contact StreetTasker Coordinator Support.');
    else showMsg(DENIED_TEXT.no, null, [{ text: 'Passed the test? Create your coordinator account.', href: 'coordinator-signup.html' }]);
  }
  function hideMsg() { var el = $('coLoginMsg'); if (el) el.hidden = true; }

  /* Only coordinator pages on this site are accepted as a destination. */
  function safeRedirect(raw) {
    if (!raw) return null;
    try {
      var u = new URL(raw, window.location.origin + '/');
      if (u.origin !== window.location.origin) return null;
      var page = u.pathname.split('/').pop();
      if (!/^coordinator-[a-z0-9-]+\.html$/.test(page) || page === 'coordinator-login.html') return null;
      return page + u.search + u.hash;
    } catch (e) { return null; }
  }
  function destination() {
    return safeRedirect(new URLSearchParams(window.location.search).get('redirect')) || HOME;
  }

  function friendlyError(err) {
    var msg = (err && err.message) || '';
    if (/invalid login|invalid_credentials/i.test(msg)) return 'Incorrect email or password.';
    if (/too many|rate limit/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
    if (/banned|user is banned/i.test(msg)) return 'This account cannot sign in.';
    if (/failed to fetch|network/i.test(msg)) return "Couldn't reach the server. Check your connection and try again.";
    return 'Sign in failed. Please try again.';
  }

  var DENIED_TEXT = {
    no: "This account is not a coordinator account. Coordinator access is by approval only.",
    inactive: "Your coordinator account isn't active. Please contact StreetTasker Coordinator Support."
  };

  function rememberChoice(remember) {
    try {
      if (remember) localStorage.removeItem(SESSION_ONLY_KEY);
      else localStorage.setItem(SESSION_ONLY_KEY, '1');
      sessionStorage.setItem(TAB_ALIVE_KEY, '1');
    } catch (e) { /* storage blocked: session behaves as "remember me" */ }
  }

  /* Returns 'active' | 'pending' | 'inactive' | 'no'. Throws if the server cannot answer.
     'pending' = a coordinator who has not passed the identity check yet (Stage E-1): they stay signed in and are sent to coordinator-identity.html.
     A brand-new coordinator who has just confirmed their email is not a coordinator yet: the database finishes the sign-up
     (coordinator_finish_signup, Stage D-1) the first time they get here, using the code saved at sign-up. It refuses any customer or tasker account. */
  async function pendingOrInactive() {
    var sb = window.supabase;
    var u = await sb.auth.getUser();
    var id = u && u.data && u.data.user && u.data.user.id;
    if (!id) return 'inactive';
    var row = await sb.from('coordinators').select('status').eq('user_id', id).maybeSingle();
    if (row.error) throw row.error;
    return (row.data && row.data.status === 'pending') ? 'pending' : 'inactive';
  }
  async function coordinatorStatus() {
    var sb = window.supabase;
    var active = await sb.rpc('is_active_coordinator');
    if (active.error) throw active.error;
    if (active.data === true) return 'active';
    var isCo = await sb.rpc('is_coordinator');
    if (!isCo.error && isCo.data === true) return pendingOrInactive();
    lastFinishError = '';
    var fin = await sb.rpc('coordinator_finish_signup');
    if (!fin.error && fin.data && fin.data.ok === true) {
      var again = await sb.rpc('is_active_coordinator');
      if (!again.error && again.data === true) return 'active';
      return pendingOrInactive();
    }
    if (fin.data && fin.data.error) lastFinishError = fin.data.error;
    return 'no';
  }

  function initNotices() {
    var qs = new URLSearchParams(window.location.search);
    var denied = qs.get('denied');
    if (denied === 'no') showNotCoordinator();
    else if (denied && DENIED_TEXT[denied]) showMsg(DENIED_TEXT[denied]);
    else if (qs.get('signedout') === '1') showMsg('You have been signed out.', 'info');
  }

  /* Already signed in as an active coordinator: skip the form. */
  async function skipIfSignedIn() {
    try {
      var res = await window.supabase.auth.getSession();
      if (!res.data || !res.data.session) return;
      var st = await coordinatorStatus();
      if (st === 'active') window.location.replace(destination());
      else if (st === 'pending') window.location.replace(IDENTITY_PAGE);
    } catch (e) { /* stay on the form */ }
  }

  function wirePasswordToggle() {
    var toggle = $('coPwdToggle'), input = $('coPassword'), icon = $('coEyeIcon');
    if (!toggle || !input || !icon) return;
    toggle.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      icon.innerHTML = show
        ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
        : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    });
  }

  function wireForgot() {
    var btn = $('coForgot');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var email = ($('coEmail').value || '').trim();
      if (!email) { showMsg('Enter your email address first, then choose Forgot password.', 'info'); return; }
      try {
        /* Same reset page as the main login. */
        var res = await window.supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password.html' });
        if (res.error) throw res.error;
        showMsg('If that email has an account, a password reset link is on its way.', 'info');
      } catch (e) {
        showMsg(friendlyError(e));
      }
    });
  }

  function wireForm() {
    var form = $('coLoginForm'), btn = $('coLoginBtn');
    if (!form || !btn) return;
    var submitting = false;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (submitting) return;
      hideMsg();

      var email = form.email.value.trim();
      var pwd = form.password.value;
      if (!email || !pwd) { showMsg('Please enter your email and password.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMsg('Please enter a valid email address.'); return; }

      submitting = true;
      var original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>Signing in…</span>';

      try {
        var res = await window.supabase.auth.signInWithPassword({ email: email, password: pwd });
        if (res.error) throw res.error;

        var status;
        try {
          status = await coordinatorStatus();
        } catch (checkErr) {
          /* Cannot tell: do not leave a half-checked session behind. */
          try { await window.supabase.auth.signOut(); } catch (x) {}
          throw checkErr;
        }

        if (status === 'pending') {
          /* Not signed out: the identity check page needs this session. */
          rememberChoice($('coRemember').checked);
          window.location.replace(IDENTITY_PAGE);
          return;
        }
        if (status !== 'active') {
          try { await window.supabase.auth.signOut(); } catch (x) {}
          if (status === 'no') showNotCoordinator(); else showMsg(DENIED_TEXT[status]);
          form.password.value = '';
          return;
        }

        rememberChoice($('coRemember').checked);
        window.location.replace(destination());
      } catch (err) {
        /* A new coordinator who has not opened the confirmation email yet. */
        if (err && /email not confirmed/i.test(err.message || '')) showMsg('Please confirm your email first: open the link we sent you, then sign in here.', 'info');
        else showMsg(friendlyError(err));
      } finally {
        submitting = false;
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
  }

  function init() {
    initNotices();
    wirePasswordToggle();
    wireForgot();
    wireForm();
    skipIfSignedIn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

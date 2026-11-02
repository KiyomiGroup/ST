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
  var NOT_COORDINATOR_LINKS = [
    { text: 'Log in', href: 'login.html' },
    { text: 'or sign up', href: 'signup.html' }
  ];
  function showNotCoordinator() { showMsg(DENIED_TEXT.no, null, NOT_COORDINATOR_LINKS); }
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
    no: "This account is not a coordinator account. Coordinator access is by approval only. Customer or tasker?",
    inactive: "Your coordinator account isn't active. Please contact StreetTasker Coordinator Support."
  };

  function rememberChoice(remember) {
    try {
      if (remember) localStorage.removeItem(SESSION_ONLY_KEY);
      else localStorage.setItem(SESSION_ONLY_KEY, '1');
      sessionStorage.setItem(TAB_ALIVE_KEY, '1');
    } catch (e) { /* storage blocked: session behaves as "remember me" */ }
  }

  /* Returns 'active' | 'inactive' | 'no'. Throws if the server cannot answer. */
  async function coordinatorStatus() {
    var sb = window.supabase;
    var active = await sb.rpc('is_active_coordinator');
    if (active.error) throw active.error;
    if (active.data === true) return 'active';
    var isCo = await sb.rpc('is_coordinator');
    return (!isCo.error && isCo.data === true) ? 'inactive' : 'no';
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
      if ((await coordinatorStatus()) === 'active') window.location.replace(destination());
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

        if (status !== 'active') {
          try { await window.supabase.auth.signOut(); } catch (x) {}
          if (status === 'no') showNotCoordinator(); else showMsg(DENIED_TEXT[status]);
          form.password.value = '';
          return;
        }

        rememberChoice($('coRemember').checked);
        window.location.replace(destination());
      } catch (err) {
        /* An account whose email was never confirmed cannot be a coordinator (coordinator
           accounts are approved and verified), so say that instead of the raw Auth wording. */
        if (err && /email not confirmed/i.test(err.message || '')) showNotCoordinator();
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

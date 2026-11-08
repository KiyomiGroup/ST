/* StreetTasker Admin: sign-in (stage A3a; two-step code added in A3c).
   Signs in with email and password, then asks the database (rpc admin_my_access) whether the login is an
   ACTIVE admin. Anyone else is signed straight back out. A wrong password and "not an admin" show the SAME
   message, so this page never tells a stranger which emails have a valid password.
   A3c: when two-step is required (admin_settings.require_mfa = on) and the sign-in is not yet verified, a code box replaces the
   password form. The code is checked by Supabase Auth; the page then asks the database again. Set-up is never offered here. */
'use strict';
(function () {
  var GENERIC = 'These details did not work, or this account does not have admin access.';
  function $(id) { return document.getElementById(id); }
  function showMsg(text, info) {
    var m = $('adLoginMsg');
    m.textContent = text;
    m.classList.toggle('ad-banner--info', !!info);
    m.hidden = false;
  }
  function hideMsg() { $('adLoginMsg').hidden = true; }

  /* Only another admin page is accepted as a destination (a plain file name in /admin/). */
  function destination() {
    var raw = new URLSearchParams(window.location.search).get('redirect') || '';
    return (/^[a-z0-9-]+\.html$/.test(raw) && raw !== 'login.html') ? raw : 'index.html';
  }
  function friendly(err) {
    var m = (err && err.message) || '';
    if (/too many|rate limit/i.test(m)) return 'Too many attempts. Please wait a moment and try again.';
    if (/failed to fetch|network/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
    return GENERIC;
  }
  async function access() {
    var r = await window.supabase.rpc('admin_my_access');
    if (r.error) throw r.error;
    return r.data || {};
  }

  /* Already signed in as an active admin: skip the form (or ask for the code). Any trouble: stay on the form. */
  async function skipIfSignedIn() {
    try {
      var s = await window.supabase.auth.getSession();
      if (!s.data || !s.data.session) return;
      var a = await access();
      if (!a.active) return;
      if (!a.mfa_required || a.mfa_ok) { window.location.replace(destination()); return; }
      await showCodeStep();
    } catch (e) { /* stay on the form */ }
  }

  var factorId = null;

  /* Two-step is required and this sign-in is not verified yet. Returns true when the code box is showing. */
  async function showCodeStep() {
    var list = await AdminMfa.verifiedFactors();
    if (!list.length) {
      try { await window.supabase.auth.signOut(); } catch (x) {}
      showMsg('Two-step verification is required, but no authenticator app is set up on this account. Ask a Super Admin for help.');
      return false;
    }
    factorId = list[0].id;
    $('adLoginForm').hidden = true;
    $('adCodeForm').hidden = false;
    hideMsg();
    $('adCode').value = '';
    $('adCode').focus();
    return true;
  }

  async function submitCode(e) {
    e.preventDefault();
    hideMsg();
    if (!factorId) return;
    var btn = $('adCodeBtn');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      var r = await AdminMfa.verify(factorId, $('adCode').value);
      if (!r.ok) { showMsg(r.message); $('adCode').select(); return; }
      var a = await access();                            /* the database answers again with the new, verified sign-in */
      if (a.active && (!a.mfa_required || a.mfa_ok)) { window.location.replace(destination()); return; }
      try { await window.supabase.auth.signOut(); } catch (x) {}
      showMsg(GENERIC);
      $('adCodeForm').hidden = true; $('adLoginForm').hidden = false; factorId = null;
    } catch (err) {
      showMsg(friendly(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Verify and sign in';
    }
  }

  async function cancelCode() {
    try { await window.supabase.auth.signOut(); } catch (x) {}
    factorId = null;
    $('adCodeForm').hidden = true; $('adLoginForm').hidden = false;
    hideMsg();
    $('adPassword').value = '';
    $('adEmail').focus();
  }

  function wireToggle() {
    var t = $('adPwdToggle'), i = $('adPassword');
    t.addEventListener('click', function () {
      var show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      t.setAttribute('aria-pressed', show ? 'true' : 'false');
      t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  }

  async function submit(e) {
    e.preventDefault();
    hideMsg();
    var email = ($('adEmail').value || '').trim();
    var pw = $('adPassword').value || '';
    if (!email || !pw) { showMsg('Enter your email address and password.'); return; }
    var btn = $('adLoginBtn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      var res = await window.supabase.auth.signInWithPassword({ email: email, password: pw });
      if (res.error) { showMsg(friendly(res.error)); return; }
      var a = await access();
      if (!a.active) {                                   /* a valid login that is not an admin: sign back out, same message */
        try { await window.supabase.auth.signOut(); } catch (x) {}
        showMsg(GENERIC);
        return;
      }
      if (a.mfa_required && !a.mfa_ok) { await showCodeStep(); return; }
      window.location.replace(destination());
    } catch (err) {
      try { await window.supabase.auth.signOut(); } catch (x) {}
      showMsg(friendly(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (new URLSearchParams(window.location.search).get('signedout') === '1') showMsg('You have been signed out.', true);
    wireToggle();
    $('adLoginForm').addEventListener('submit', submit);
    $('adCodeForm').addEventListener('submit', submitCode);
    $('adCodeCancel').addEventListener('click', cancelCode);
    skipIfSignedIn();
  });
})();

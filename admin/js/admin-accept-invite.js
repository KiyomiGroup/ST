/* StreetTasker Admin: accept an invitation (stage A5e).
   The invite email link opens this page with a short-lived sign-in in the address (Supabase Auth reads it).
   The person chooses a password (same 12-character rule as My profile); then the page asks the database (rpc admin_my_access)
   whether this login really is an ACTIVE admin. Anyone else is signed straight back out. No admin right comes from this page:
   the invite itself was approved by two Super Admins and the admin row was made on the server. All text via textContent.
   Two-step set-up (added 2026-11-11): when two-step is required and this login has no authenticator app, the page asks for it here,
   right after the password, so a new admin never needs two-step switched off. */
'use strict';
(function () {
  function $(id) { return document.getElementById(id); }
  function showMsg(text, info) { var m = $('aiMsg'); m.textContent = text; m.classList.toggle('ad-banner--info', !!info); m.hidden = false; }
  function hideMsg() { $('aiMsg').hidden = true; }
  var sb = window.supabase;

  /* The link's sign-in is read asynchronously: look for the session for a few seconds before giving up. */
  async function waitForSession() {
    for (var i = 0; i < 10; i++) {
      try { var s = await sb.auth.getSession(); if (s.data && s.data.session) return s.data.session; } catch (e) { /* try again */ }
      await new Promise(function (r) { setTimeout(r, 300); });
    }
    return null;
  }

  async function submit(e) {
    e.preventDefault(); hideMsg();
    var a = $('aiPw1').value || '', b = $('aiPw2').value || '';
    if (a.length < 12) { showMsg('The password must be at least 12 characters.'); return; }
    if (a !== b) { showMsg('The two passwords do not match.'); return; }
    var btn = $('aiBtn'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var res = await sb.auth.updateUser({ password: a });
      // "same password" means this page was reloaded after the password was saved: carry on to the next step.
      if (res.error && !/same|different/i.test(res.error.message || '')) { showMsg('The password could not be saved. The link may have expired: ask a Super Admin to invite you again.'); return; }
      var acc = await sb.rpc('admin_my_access');
      if (acc.error || !acc.data || !acc.data.active) {
        try { await sb.auth.signOut(); } catch (x) { /* ignore */ }
        showMsg('This account does not have admin access. Ask a Super Admin for help.');
        return;
      }
      // Two-step is required and this login has no authenticator app yet: set it up here, on the one-time invitation link,
      // before any admin page opens. (It is never offered on the normal sign-in page.)
      var have = [];
      if (acc.data.mfa_required) {
        try { have = await AdminMfa.verifiedFactors(); }
        catch (x) { showMsg("Couldn't check your two-step settings. Reload this page and try again."); return; }
      }
      if (acc.data.mfa_required && !have.length && !acc.data.mfa_ok) { await startEnrolStep(); return; }
      window.location.replace('/admin/index.html');
    } catch (err) {
      showMsg("Couldn't reach the server. Check your connection and try again.");
    } finally { btn.disabled = false; btn.textContent = 'Save password and continue'; }
  }

  var pendingFactor = null;
  async function startEnrolStep() {
    try {
      var e = await AdminMfa.startEnrol();
      pendingFactor = e.factorId;
      if (e.qr) $('aiQr').src = e.qr; else $('aiQr').removeAttribute('src');
      $('aiQr').hidden = !e.qr;
      $('aiSecret').textContent = e.secret;
      $('aiForm').hidden = true; $('aiEnrol').hidden = false;
      $('aiIntro').textContent = 'Your password is saved. One more step: two-step verification.';
      $('aiCode').focus();
    } catch (err) { showMsg(AdminMfa.friendly(err)); }
  }
  async function verifyStep(e) {
    e.preventDefault(); hideMsg();
    if (!pendingFactor) return;
    var btn = $('aiEnrolBtn'); btn.disabled = true;
    var r = await AdminMfa.verify(pendingFactor, $('aiCode').value);
    btn.disabled = false;
    if (!r.ok) { showMsg(r.message); return; }
    window.location.replace('/admin/index.html');
  }

  document.addEventListener('DOMContentLoaded', async function () {
    var s = await waitForSession();
    if (!s) {
      $('aiIntro').textContent = 'This invitation link has expired, was already used, or is not valid.';
      showMsg('Ask a Super Admin to send you a new invitation. If you already chose a password, sign in instead.', true);
      return;
    }
    $('aiIntro').textContent = 'Choose a password for your admin account. You will use it to sign in.';
    $('aiEnrolForm').addEventListener('submit', verifyStep);
    $('aiForm').hidden = false; $('aiForm').addEventListener('submit', submit); $('aiPw1').focus();
  });
})();

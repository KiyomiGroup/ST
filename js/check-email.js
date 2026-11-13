/* ============================================================
   STREET TASKER — check-email.js
   Last onboarding step for "Service provider" (check-email.html).

   - Shows the email the verification link was sent to (?email=...).
   - "Go to log in" opens login.html with that email filled in and any
     ?redirect= carried over.
   - "Resend email" sends the verification mail again, once a minute
     (Supabase limits how often it will send mail).
   - Opened without an email: goes straight to log in.
   ============================================================ */
(function () {
  'use strict';

  var COOLDOWN = 60;
  var qs = new URLSearchParams(window.location.search);
  var email = String(qs.get('email') || '').trim();
  var emailEl = document.getElementById('ceEmail');
  var loginEl = document.getElementById('ceLogin');
  var resendBtn = document.getElementById('ceResend');
  var msgEl = document.getElementById('ceMsg');
  if (!emailEl || !loginEl || !resendBtn) return;

  if (!email) { window.location.replace('login.html'); return; }

  var redirect = (window.ST && window.ST.auth && window.ST.auth.redirectQuery) ? window.ST.auth.redirectQuery('&') : '';
  emailEl.textContent = email;
  loginEl.setAttribute('href', 'login.html?email=' + encodeURIComponent(email) + redirect);

  function say(text, isError) {
    msgEl.textContent = text;
    msgEl.className = 'ps-hint' + (isError ? ' ps-hint--error' : ' ps-hint--ok');
    msgEl.hidden = false;
  }

  function cooldown(seconds) {
    var left = seconds;
    resendBtn.disabled = true;
    (function tick() {
      if (left <= 0) { resendBtn.disabled = false; resendBtn.textContent = 'Resend email'; return; }
      resendBtn.textContent = 'Resend email (' + left + 's)';
      left -= 1;
      setTimeout(tick, 1000);
    })();
  }

  /* just sent by the sign-up step, so the first resend has to wait too */
  cooldown(COOLDOWN);

  resendBtn.addEventListener('click', function () {
    if (!window.supabase || !window.supabase.auth) { say('Could not resend right now. Please refresh and try again.', true); return; }
    cooldown(COOLDOWN);
    window.supabase.auth.resend({
      type: 'signup', email: email,
      options: { emailRedirectTo: window.location.origin + '/login.html' }
    }).then(function (res) {
      if (res && res.error) say('Could not resend: ' + res.error.message, true);
      else say('Verification email sent to ' + email + '.', false);
    });
  });
})();

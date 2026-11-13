/* ============================================================
   STREET TASKER — provider-email.js
   Second onboarding step for "Service provider": email (compulsory).

   - Reads/writes the same sessionStorage object as provider-start.js
     (key st_provider_start), adding { email }.
   - Continue goes to the password page: provider-password.html
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'st_provider_start';
  var NEXT_URL = 'provider-password.html';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var form = document.getElementById('providerEmailForm');
  var emailEl = document.getElementById('peEmail');
  var errEl = document.getElementById('peError');
  if (!form || !emailEl) return;

  function read() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try {
      var data = read();
      data.email = emailEl.value.trim();
      sessionStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* private mode: the flow still works, it just cannot remember */ }
  }
  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    errEl.style.display = 'block';   /* .form-error is display:none until a page shows it */
  }
  function clearError() {
    errEl.hidden = true;
    errEl.style.display = '';
  }

  function go() {
    var v = emailEl.value.trim();
    if (!v) { showError('Enter your email address to continue.'); emailEl.focus(); return; }
    if (!EMAIL_RE.test(v)) { showError('That email address does not look right. Check it and try again.'); emailEl.focus(); return; }
    emailEl.value = v;
    save();
    window.location.href = NEXT_URL;
  }

  var saved = read();
  if (saved.email) emailEl.value = saved.email;

  emailEl.addEventListener('input', function () { save(); clearError(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); go(); });
})();

/* ============================================================
   STREET TASKER — provider-start.js
   First onboarding step for "Service provider": name + business name.

   - Both fields are optional here. Whatever the person leaves empty is
     asked for again once they are inside the site.
   - The Continue button pops in as soon as a field is tapped, not once
     it is filled in.
   - What is typed is kept in sessionStorage (key st_provider_start) so Back
     and refresh do not lose it, and so the next steps can read it:
       { name: "...", businessName: "...", email: "..." }
   - Continue goes to the email page: provider-email.html (email is compulsory there).
   - "Sign up with Google" drops these steps and starts the normal Google
     sign-up (same hand-off as signup.html: login.html?oauth=1&role=tasker).
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'st_provider_start';
  var NEXT_URL = 'provider-email.html';

  var form = document.getElementById('providerStartForm');
  var nameEl = document.getElementById('psName');
  var bizEl = document.getElementById('psBusiness');
  var nextBtn = document.getElementById('psNext');
  var googleBtn = document.getElementById('psGoogle');
  var errEl = document.getElementById('psError');
  if (!form || !nameEl || !bizEl || !nextBtn) return;

  function read() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try {
      var data = read();   /* keep anything a later step stored (email) */
      data.name = nameEl.value.trim();
      data.businessName = bizEl.value.trim();
      sessionStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* private mode: the flow still works, it just cannot remember */ }
  }
  function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    errEl.style.display = 'block';   /* .form-error is display:none until a page shows it (same as the sign-up forms) */
  }
  function clearError() {
    errEl.hidden = true;
    errEl.style.display = '';
  }

  /* Continue appears the moment a field is tapped, and stays */
  function reveal() {
    nextBtn.classList.add('is-ready');
    nextBtn.removeAttribute('tabindex');
  }

  function go() {
    nameEl.value = clean(nameEl.value);
    bizEl.value = clean(bizEl.value);
    save();
    window.location.href = NEXT_URL;
  }

  /* restore what was typed before (Back from the next step, or a refresh) */
  var saved = read();
  if (saved.name) nameEl.value = saved.name;
  if (saved.businessName) bizEl.value = saved.businessName;
  if (saved.name || saved.businessName) reveal();

  [nameEl, bizEl].forEach(function (el) {
    el.addEventListener('focus', reveal);
    el.addEventListener('input', function () { reveal(); save(); });
  });

  /* Enter: name -> business name, business name -> continue */
  nameEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); bizEl.focus(); }
  });
  bizEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); go(); });

  /* Google: cancel these steps and use the normal Google sign-up as a service provider */
  if (googleBtn) {
    googleBtn.addEventListener('click', function () {
      clearError();
      if (!window.supabase || !window.supabase.auth) {
        showError('Sign-up is unavailable right now. Please refresh and try again.');
        return;
      }
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      try { localStorage.setItem('st_pending_role', 'tasker'); } catch (e) {}
      googleBtn.disabled = true;
      window.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/login.html?oauth=1&role=tasker' }
      }).then(function (res) {
        if (res && res.error) {
          googleBtn.disabled = false;
          showError('Google sign-up failed: ' + res.error.message);
        }
      });
    });
  }
})();

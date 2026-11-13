/* ============================================================
   STREET TASKER — provider-start.js
   First onboarding step for "Service provider": name + business name.

   - The round arrow pops in once both fields have text.
   - What is typed is kept in sessionStorage (key st_provider_start) so Back
     and refresh do not lose it, and so the next step can read it:
       { name: "...", businessName: "..." }
   - Continue goes to the account form: signup.html?step=tasker
     (signup.html fills the Full Name field from the saved name).
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'st_provider_start';
  var NEXT_URL = 'signup.html?step=tasker';
  var MIN = 2;   /* shortest name we accept, in characters */

  var form = document.getElementById('providerStartForm');
  var nameEl = document.getElementById('psName');
  var bizEl = document.getElementById('psBusiness');
  var nextBtn = document.getElementById('psNext');
  var errEl = document.getElementById('psError');
  if (!form || !nameEl || !bizEl || !nextBtn) return;

  function read() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ name: nameEl.value.trim(), businessName: bizEl.value.trim() }));
    } catch (e) { /* private mode: the flow still works, it just cannot remember */ }
  }
  function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
  function valid() { return clean(nameEl.value).length >= MIN && clean(bizEl.value).length >= MIN; }

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    errEl.style.display = 'block';   /* .form-error is display:none until a page shows it (same as the sign-up forms) */
  }
  function clearError() {
    errEl.hidden = true;
    errEl.style.display = '';
  }

  function refresh() {
    var ready = valid();
    nextBtn.classList.toggle('is-ready', ready);
    nextBtn.disabled = !ready;
    if (ready) clearError();
  }

  function go() {
    if (!valid()) {
      if (clean(nameEl.value).length < MIN) { showError('Enter your full name to continue.'); nameEl.focus(); }
      else { showError('Enter your business name to continue.'); bizEl.focus(); }
      return;
    }
    nameEl.value = clean(nameEl.value);
    bizEl.value = clean(bizEl.value);
    save();
    window.location.href = NEXT_URL;
  }

  /* restore what was typed before (Back from the next step, or a refresh) */
  var saved = read();
  if (saved.name) nameEl.value = saved.name;
  if (saved.businessName) bizEl.value = saved.businessName;
  refresh();

  [nameEl, bizEl].forEach(function (el) {
    el.addEventListener('input', function () { save(); refresh(); });
  });

  /* Enter: name -> business name, business name -> continue */
  nameEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); bizEl.focus(); }
  });
  bizEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); go(); });

  /* phones: first field is ready to type in straight away */
  if (!saved.name) nameEl.focus();
})();

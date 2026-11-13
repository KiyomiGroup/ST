/* ============================================================
   STREET TASKER — provider-password.js
   Third onboarding step for "Service provider": password + terms.

   - Help under the field shows ONE thing at a time: the first rule the
     password still fails, in red, in plain words. Green when all are met.
   - Rules come from ST.auth.PASSWORD_RULES (js/auth.js), so this page,
     the old sign-up form and reset-password never disagree.
   - Continue creates the account (ST.auth.signUpUser, role tasker) from
     what earlier steps saved in sessionStorage key st_provider_start
     { name, businessName, email }, then sends the person to Log In with
     the same "check your email" notice as the old form.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'st_provider_start';
  var form = document.getElementById('providerPasswordForm');
  var pwdEl = document.getElementById('ppPassword');
  var fieldEl = document.getElementById('ppField');
  var eyeBtn = document.getElementById('ppEye');
  var meterEl = document.getElementById('ppMeter');
  var hintEl = document.getElementById('ppHint');
  var termsEl = document.getElementById('ppTerms');
  var termsRow = document.getElementById('ppTermsRow');
  var termsErr = document.getElementById('ppTermsError');
  var errEl = document.getElementById('ppError');
  var nextBtn = document.getElementById('ppNext');
  var emailEl = document.getElementById('ppEmail');
  if (!form || !pwdEl || !window.ST || !window.ST.auth) return;

  var NEUTRAL = 'Use 8 or more characters with a capital letter, a small letter, a number and a symbol.';
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  var WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  /* what we tell the person for each rule: short, specific, one fix */
  var MESSAGES = {
    length: function (p) { var n = 8 - p.length; return 'Too short. Add ' + n + ' more character' + (n === 1 ? '' : 's') + ' (8 or more).'; },
    upper:  function () { return 'Add a capital letter (A-Z).'; },
    lower:  function () { return 'Add a small letter (a-z).'; },
    number: function () { return 'Add a number (0-9).'; },
    symbol: function () { return 'Add a symbol, like ! @ # $ %.'; }
  };

  function read() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  var saved = read();
  var email = String(saved.email || '').trim();
  /* arrived without an email (link opened directly): go back and ask for it */
  if (!email) { window.location.replace('provider-email.html'); return; }
  emailEl.textContent = email;

  function setHint(kind, text) {
    hintEl.className = 'ps-hint' + (kind === 'error' ? ' ps-hint--error' : kind === 'ok' ? ' ps-hint--ok' : '');
    hintEl.innerHTML = '';
    if (kind === 'error') hintEl.insertAdjacentHTML('beforeend', WARN);
    if (kind === 'ok') hintEl.insertAdjacentHTML('beforeend', CHECK);
    var span = document.createElement('span');
    span.textContent = text;
    hintEl.appendChild(span);
  }
  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    errEl.style.display = 'block';   /* .form-error is display:none until a page shows it */
  }
  function clearError() { errEl.hidden = true; errEl.style.display = ''; }
  function clearTermsError() { termsErr.hidden = true; termsRow.classList.remove('is-error'); }

  /* Update the hint, the bars and the field colour. `strict` = the person pressed Create (show red even if empty). */
  function refresh(strict) {
    var value = pwdEl.value;
    var res = window.ST.auth.checkPassword(value);
    var met = res.results.filter(function (r) { return r.ok; }).length;
    Array.prototype.forEach.call(meterEl.children, function (bar, i) { bar.classList.toggle('is-on', i < met); });

    if (!value.length && !strict) {
      meterEl.classList.remove('is-bad');
      fieldEl.classList.remove('is-error');
      setHint('', NEUTRAL);
      return res;
    }
    if (res.ok) {
      meterEl.classList.remove('is-bad');
      fieldEl.classList.remove('is-error');
      setHint('ok', 'Great, that is a strong password.');
      return res;
    }
    var first = res.failed[0];
    meterEl.classList.add('is-bad');
    fieldEl.classList.add('is-error');
    setHint('error', !value.length ? 'Enter a password to continue.' : (MESSAGES[first.id] ? MESSAGES[first.id](value) : 'Your password needs: ' + first.label.toLowerCase() + '.'));
    return res;
  }

  pwdEl.addEventListener('input', function () { clearError(); refresh(false); });

  /* show / hide password */
  eyeBtn.addEventListener('click', function () {
    var hidden = pwdEl.type === 'password';
    pwdEl.type = hidden ? 'text' : 'password';
    eyeBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    eyeBtn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    pwdEl.focus();
  });

  termsEl.addEventListener('change', function () { if (termsEl.checked) clearTermsError(); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var res = refresh(true);
    if (!res.ok) { pwdEl.focus(); return; }
    if (!termsEl.checked) {
      termsErr.innerHTML = '';
      termsErr.insertAdjacentHTML('beforeend', WARN);
      var t = document.createElement('span');
      t.textContent = 'Tick the box to accept the terms and create your account.';
      termsErr.appendChild(t);
      termsErr.hidden = false;
      termsRow.classList.add('is-error');
      termsEl.focus();
      return;
    }

    nextBtn.disabled = true;
    var original = nextBtn.innerHTML;
    nextBtn.innerHTML = '<span>Creating account…</span>';

    /* Name is asked for again inside the site, so a skipped name falls back to the start of the email */
    var name = String(saved.name || '').trim() || email.split('@')[0];

    try {
      var out = await window.ST.auth.signUpUser({ name: name, email: email, password: pwdEl.value, role: 'tasker', refCode: '' });
      try { sessionStorage.removeItem(KEY); } catch (x) {}
      /* This email already had a login: the tasker account was added to it and they are signed in */
      if (out.roleAdded) {
        window.location.href = window.ST.auth.requestedRedirect() || window.ST.auth.firstLoginUrl('tasker');
        return;
      }
      window.ST.auth.rememberSignupTarget(email);
      window.location.href = 'login.html?' + (out.needsVerification ? 'verify=1' : 'created=1') + '&email=' + encodeURIComponent(email) + window.ST.auth.redirectQuery('&');
    } catch (err) {
      showError((err && err.message) || 'Something went wrong. Please try again.');
      nextBtn.disabled = false;
      nextBtn.innerHTML = original;
    }
  });
})();

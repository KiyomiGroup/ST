/* Coordinator-only sign-up (Stage D-1). Page: coordinator-signup.html.
   This page creates a coordinator account and nothing else. It does NOT use js/auth.js (which creates customer and
   tasker accounts) and it never signs an existing customer or tasker account in.
   Flow:
     1. rpc coordinator_code_check(p_code)  -> true/false: the code is real, unused and not expired (nothing is spent yet).
     2. auth.signUp with the details AND the code in the sign-up data (role 'coordinator').
     3a. Email confirmation on (normal): "Check your email". The account is finished by rpc coordinator_finish_signup() the first time
         the coordinator signs in on coordinator-login.html (js/coordinator-login.js).
     3b. A session came back (confirmation off): finish right away with rpc coordinator_finish_signup().
   coordinator_finish_signup() decides everything on the server: it refuses any account that already is a customer or tasker, and it spends
   the single-use code. Nothing in this file grants access. All text from the server is written with textContent. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var RULES = [
    { label: 'At least 8 characters',       test: function (p) { return p.length >= 8; } },
    { label: 'One uppercase letter (A-Z)',  test: function (p) { return /[A-Z]/.test(p); } },
    { label: 'One lowercase letter (a-z)',  test: function (p) { return /[a-z]/.test(p); } },
    { label: 'One number (0-9)',            test: function (p) { return /[0-9]/.test(p); } },
    { label: 'One symbol (like ! @ # $ %)', test: function (p) { return /[^A-Za-z0-9\s]/.test(p); } }
  ];
  var panels = ['cosFormPanel', 'cosCheck', 'cosDone'];
  var busy = false;

  function show(id) {
    panels.forEach(function (p) { $(p).hidden = (p !== id); });
    $('cosLinks').hidden = (id === 'cosDone');
    var h = id === 'cosCheck' ? $('cosCheckTitle') : id === 'cosDone' ? $('cosDoneTitle') : null;
    if (h) h.focus();
    window.scrollTo(0, 0);
  }
  function showError(msg, link) {
    var b = $('cosError');
    b.textContent = msg;
    if (link) {
      b.appendChild(document.createTextNode(' '));
      var a = document.createElement('a'); a.href = link.href; a.textContent = link.text; b.appendChild(a);
    }
    b.classList.add('is-visible');
  }
  function clearError() { var b = $('cosError'); b.textContent = ''; b.classList.remove('is-visible'); }

  /* The code can arrive as ?code= from the test page. Read it once, then take it out of the address bar. */
  function codeFromLink() {
    var c = '';
    try {
      c = (new URLSearchParams(window.location.search).get('code') || '').trim().toUpperCase();
      if (window.location.search && window.history && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
    } catch (e) { c = ''; }
    return /^[A-Z0-9-]{6,20}$/.test(c) ? c : '';
  }

  function drawRules() {
    var ul = $('cosRules'), pwd = $('cosPassword').value;
    if (!ul.children.length) {
      RULES.forEach(function (r) {
        var li = document.createElement('li'); li.className = 'pwd-rule';
        var dot = document.createElement('span'); dot.className = 'pwd-rule-icon'; dot.setAttribute('aria-hidden', 'true');
        var txt = document.createElement('span'); txt.textContent = r.label;
        li.appendChild(dot); li.appendChild(txt); ul.appendChild(li);
      });
    }
    RULES.forEach(function (r, i) { ul.children[i].classList.toggle('is-met', r.test(pwd)); });
  }
  function passwordProblem(pwd) {
    var failed = RULES.filter(function (r) { return !r.test(pwd); });
    if (!failed.length) return '';
    return 'Your password needs: ' + failed.map(function (r) { return r.label.charAt(0).toLowerCase() + r.label.slice(1); }).join(', ') + '.';
  }

  function authMessage(err) {
    var m = (err && err.message) || '';
    if (/already registered|already been registered|already exists/i.test(m)) return 'EXISTS';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a few minutes and try again.';
    if (/password/i.test(m)) return 'That password was not accepted. Try a longer one.';
    if (/failed to fetch|network/i.test(m)) return 'We could not reach the server. Check your internet and try again.';
    return 'We could not create the account. Please try again.';
  }
  var EXISTS_TEXT = 'This email already has a StreetTasker account. A coordinator account needs an email address that is not used for anything else. Use a different email address, or if this is already your coordinator account,';
  var FINISH_TEXT = {
    invalid_code: 'That coordinator code has already been used or has expired. Take the coordinator test again or ask the StreetTasker team for help.',
    not_a_coordinator_account: 'This email already belongs to another kind of StreetTasker account, so it cannot be a coordinator account. Use a different email address.'
  };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    clearError();
    var f = $('cosForm');
    var code = f.coordinator_code.value.trim().toUpperCase();
    var name = f.name.value.trim().replace(/\s+/g, ' ');
    var email = f.email.value.trim().toLowerCase();
    var phone = f.phone.value.trim();
    var pwd = f.password.value;
    if (!/^[A-Z0-9-]{6,20}$/.test(code)) return showError('Enter your coordinator code. You get it when you pass the coordinator test.');
    if (name.length < 2) return showError('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Enter a valid email address.');
    if (phone.replace(/\D/g, '').length < 7) return showError('Enter a valid phone number.');
    var pp = passwordProblem(pwd);
    if (pp) return showError(pp);
    if (!$('cosTerms').checked) return showError('Please agree to the Terms of Service and Privacy Policy to continue.');

    busy = true;
    var btn = $('cosSubmit'), original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Creating your account…';
    var sb = window.supabase;
    try {
      /* 1. Is the code usable? (Nothing is spent here.) */
      var chk = await sb.rpc('coordinator_code_check', { p_code: code });
      if (chk.error) throw chk.error;
      if (chk.data !== true) return showError('This coordinator code is not valid. It may have been used already or it has expired. If you passed the coordinator test, check you typed it exactly as shown.');

      /* 2. Create the login. The code rides along in the sign-up data; the database spends it when the account is finished. */
      var res = await sb.auth.signUp({
        email: email, password: pwd,
        options: {
          data: { name: name, phone: phone, role: 'coordinator', coordinator_code: code },
          emailRedirectTo: window.location.origin + '/coordinator-login.html'
        }
      });
      if (res.error) throw res.error;
      var user = res.data && res.data.user;
      if (!user) throw new Error('no user');
      /* An email that already has a login comes back with an empty identities list. We never sign that account in from here. */
      if (!user.identities || user.identities.length === 0) {
        if (res.data.session) { try { await sb.auth.signOut(); } catch (x) {} }
        return showError(EXISTS_TEXT, { href: 'coordinator-login.html', text: 'sign in.' });
      }

      /* 3b. No email confirmation needed: finish now. */
      if (res.data.session) {
        var fin = await sb.rpc('coordinator_finish_signup');
        if (fin.error || !fin.data) { try { await sb.auth.signOut(); } catch (x) {} throw new Error('finish failed'); }
        if (fin.data.ok === true) { f.reset(); show('cosDone'); return; }
        try { await sb.auth.signOut(); } catch (x) {}
        return showError(FINISH_TEXT[fin.data.error] || 'We could not finish your coordinator account. Please try again.');
      }
      /* 3a. Confirmation email sent. */
      $('cosCheckText').textContent = 'We sent a link to ' + email + '. Open it to confirm your email, then sign in on the coordinator sign-in page. Your coordinator account is finished when you sign in.';
      f.reset(); drawRules();
      show('cosCheck');
    } catch (err) {
      var msg = authMessage(err);
      if (msg === 'EXISTS') showError(EXISTS_TEXT, { href: 'coordinator-login.html', text: 'sign in.' });
      else showError(msg);
    } finally {
      busy = false; btn.disabled = false; btn.textContent = original;
    }
  }

  function init() {
    drawRules();
    var c = codeFromLink();
    if (c) $('cosCode').value = c;
    $('cosPassword').addEventListener('input', drawRules);
    $('cosShow').addEventListener('change', function () { $('cosPassword').type = this.checked ? 'text' : 'password'; });
    $('cosCode').addEventListener('input', function () { var p = this.selectionStart; this.value = this.value.toUpperCase(); try { this.setSelectionRange(p, p); } catch (e) {} });
    $('cosForm').addEventListener('submit', submit);
    if (c) $('cosName').focus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

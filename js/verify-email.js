/* Verify-email page: the person types the code from the email and lands on their first page already logged in.
   Works from any browser or phone: the code is checked by Supabase, and the session starts on the device that checks it. */
(function () {
  'use strict';

  var auth = window.ST && window.ST.auth;
  var sb = window.supabase;
  if (!auth || !sb) { return; }

  var form = document.getElementById('veForm');
  var codeEl = document.getElementById('veCode');
  var emailEl = document.getElementById('veEmail');
  var emailGroup = document.getElementById('veEmailGroup');
  var btn = document.getElementById('veBtn');
  var resendBtn = document.getElementById('veResend');
  var lead = document.getElementById('veLead');
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* The email link carries ?email=. A "+" in an address arrives as a space, so put it back. */
  var email = String(new URLSearchParams(window.location.search).get('email') || '').trim().replace(/ /g, '+').toLowerCase();
  if (!EMAIL_RE.test(email)) email = '';

  if (email) {
    lead.textContent = 'We sent a code to ' + email + '. Type it below to finish creating your account.';
  } else {
    emailGroup.hidden = false;
    emailEl.focus();
  }

  /* ── Notice box (all text goes in with textContent) ── */
  var ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    info:    '<path d="M12 11v6"/><path d="M12 7h.01"/>',
    warning: '<path d="M12 7v6"/><path d="M12 17h.01"/>',
    danger:  '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  };
  function showNotice(tone, title, body) {
    var box = document.getElementById('veNotice');
    box.className = 'st-notice st-notice--' + tone;
    box.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    box.textContent = '';
    var icon = document.createElement('span');
    icon.className = 'st-notice-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[tone] + '</svg>';
    var main = document.createElement('div');
    main.className = 'st-notice-main';
    var t = document.createElement('div');
    t.className = 'st-notice-title';
    t.textContent = title;
    main.appendChild(t);
    if (body) {
      var b = document.createElement('div');
      b.className = 'st-notice-body';
      b.textContent = body;
      main.appendChild(b);
    }
    box.append(icon, main);
    box.hidden = false;
  }

  function currentEmail() {
    if (email) return email;
    var typed = String(emailEl.value || '').trim().toLowerCase();
    return EMAIL_RE.test(typed) ? typed : '';
  }

  /* Button that can only be pressed once a minute (Supabase limits how often it sends mail) */
  function cooldown(button, label, seconds) {
    var left = seconds;
    button.disabled = true;
    (function tick() {
      if (left <= 0) { button.disabled = false; button.textContent = label; return; }
      button.textContent = label + ' (' + left + 's)';
      left -= 1;
      setTimeout(tick, 1000);
    })();
  }

  /* Only digits, so pasted spaces or dashes do no harm */
  codeEl.addEventListener('input', function () {
    var clean = codeEl.value.replace(/\D/g, '');
    if (clean !== codeEl.value) codeEl.value = clean;
  });

  /* Already logged in on this browser: nothing to verify */
  auth.getSession().then(function (session) {
    if (session) window.location.replace(auth.requestedRedirect() || auth.getHomeUrl());
  });
  if (email) codeEl.focus();

  function friendly(err) {
    var msg = String((err && err.message) || '');
    if (err && (err.status === 429 || /rate limit|too many/i.test(msg))) return 'Too many attempts. Please wait a minute and try again.';
    if (/expired|invalid/i.test(msg)) return 'That code is not right or has expired. Check the newest email we sent, or ask for a new code.';
    return msg || 'Something went wrong. Please try again.';
  }

  /* The code is right: make sure the profile rows exist, remember the person on this device, and send them in. */
  async function finish(user) {
    var role = (user.user_metadata && user.user_metadata.role) || 'customer';
    var name = (user.user_metadata && user.user_metadata.name) || String(user.email || '').split('@')[0];
    try {
      await sb.from('users').upsert({ id: user.id, name: name, email: user.email, role: role }, { onConflict: 'id' });
      if (role === 'tasker') {
        await sb.from('taskers').upsert(
          { id: user.id, user_id: user.id, name: name, email: user.email, service: '', location: '', rating: 0, task_count: 0 },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      }
    } catch (e) { /* the rows are checked again on the next page load */ }

    try {
      localStorage.setItem('st_role', role);
      localStorage.setItem('st_name', name);
      localStorage.setItem('st_session', '1');
      localStorage.setItem('st_uid', user.id);
    } catch (e) {}

    var first = auth.isFirstLogin(user);
    if (first) await auth.markWelcomed();
    var dest = auth.requestedRedirect() || auth.takeSignupTarget(user.email) || auth.firstLoginUrl(role);
    showNotice('success', 'Email verified', 'Welcome to StreetTasker. Taking you in…');
    setTimeout(function () { window.location.replace(dest); }, 600);
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var addr = currentEmail();
    var token = codeEl.value.replace(/\D/g, '');
    if (!addr) { showNotice('danger', 'Enter your email', 'Type the email address you signed up with.'); emailEl.focus(); return; }
    if (token.length < 6) { showNotice('danger', 'Enter the full code', 'The code in your email has at least 6 digits.'); codeEl.focus(); return; }

    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    try {
      var r = await sb.auth.verifyOtp({ email: addr, token: token, type: 'signup' });
      if (r.error) throw r.error;
      if (!r.data || !r.data.session || !r.data.session.user) throw new Error('We could not sign you in. Please log in with your email and password.');
      await finish(r.data.session.user);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      showNotice('danger', 'Could not verify', friendly(err));
      codeEl.focus();
      codeEl.select();
    }
  });

  resendBtn.addEventListener('click', async function () {
    var addr = currentEmail();
    if (!addr) { showNotice('danger', 'Enter your email', 'Type the email address you signed up with, then ask for a new code.'); emailEl.focus(); return; }
    cooldown(resendBtn, 'Send a new code', 60);
    try {
      var r = await sb.auth.resend({ type: 'signup', email: addr, options: { emailRedirectTo: window.location.origin + '/verify-email.html' } });
      if (r.error) throw r.error;
      showNotice('success', 'New code sent', 'We sent a new code to ' + addr + '. Use the newest one; older codes stop working.');
    } catch (err) {
      showNotice('danger', 'Could not send a new code', friendly(err));
    }
  });
})();

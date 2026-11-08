/* StreetTasker Admin: My profile (stage A3b; two-step set-up added in A3c). Own data only.
   Reads: the session user (name comes from the server's admin answer), the access answer, own notification_preferences row
   (own-row read policy). Writes: password (Supabase Auth updateUser), sign-out, and the authenticator app (Supabase Auth MFA
   through admin-mfa.js: set up, list, remove). No database function is added. */
'use strict';
AdminShell.init({ page: 'profile', title: 'My profile', permission: null }).then(async function (ctx) {
  function $(id) { return document.getElementById(id); }
  var sb = window.supabase;
  var NA = 'Not available';
  function label(k) { return String(k || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function when(iso) {
    if (!iso) return NA;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? NA : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  function msg(text, info) {
    var m = $('pfPwMsg'); m.textContent = text; m.classList.toggle('ad-banner--info', !!info); m.hidden = false;
  }

  var user = null;
  try { var g = await sb.auth.getUser(); user = g && g.data && g.data.user; } catch (e) { /* shown as Not available */ }
  var a = ctx.access;
  $('pfName').textContent = a.display_name || NA;
  $('pfEmail').textContent = (user && user.email) || NA;
  $('pfRoles').textContent = (a.roles || []).map(label).join(', ') || 'No role';
  $('pfPerms').textContent = String((a.permissions || []).length);
  $('pfLast').textContent = when(user && user.last_sign_in_at);
  var required = !!a.mfa_required;
  function setMfaLine(count) {
    var state = count > 0 ? 'Authenticator app set up' : 'No authenticator app set up';
    $('pfMfa').textContent = state + (required ? '. Required for admin sign-in.' : '. Not required yet.');
  }
  setMfaLine(0);

  /* Own preferences, read only. No row means the site default (both on). */
  try {
    var r = await sb.from('notification_preferences').select('push_enabled,email_enabled').eq('user_id', user.id).maybeSingle();
    if (r.error) throw r.error;
    var p = r.data || { push_enabled: true, email_enabled: true };
    $('pfPush').textContent = p.push_enabled ? 'On' : 'Off';
    $('pfEmailPref').textContent = p.email_enabled ? 'On' : 'Off';
  } catch (e) {
    $('pfPush').textContent = NA; $('pfEmailPref').textContent = NA;
  }


  /* ── Two-step: list, set up, remove ── */
  function mfaMsg(text, info) { var m = $('pfMfaMsg'); m.textContent = text; m.classList.toggle('ad-banner--info', !!info); m.hidden = false; }
  var pendingFactor = null;

  async function drawFactors() {
    var list = $('pfFactors');
    while (list.firstChild) list.removeChild(list.firstChild);
    var factors = [];
    try { factors = await AdminMfa.verifiedFactors(); }
    catch (e) { mfaMsg('Could not read your two-step settings. Try again later.'); $('pfMfaStart').disabled = true; return; }
    setMfaLine(factors.length);
    factors.forEach(function (f) {
      var li = document.createElement('li'); li.className = 'ad-factor';
      var name = document.createElement('span'); name.className = 'ad-factor-name'; name.textContent = f.friendly_name || 'Authenticator app';
      var added = document.createElement('span'); added.className = 'ad-hint'; added.textContent = 'Added ' + when(f.created_at);
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'ad-btn-quiet'; rm.textContent = 'Remove';
      /* the last authenticator cannot be removed while two-step is required: that would lock this login out */
      if (required && factors.length === 1) { rm.disabled = true; rm.title = 'Two-step is required, so the last authenticator cannot be removed.'; }
      var armed = false;
      rm.addEventListener('click', async function () {
        if (!armed) { armed = true; rm.textContent = 'Tap again to remove'; return; }
        rm.disabled = true;
        try { await AdminMfa.remove(f.id); ctx.toast('Authenticator removed'); $('pfMfaMsg').hidden = true; }
        catch (e) { mfaMsg(AdminMfa.friendly(e)); }
        await drawFactors();
      });
      li.appendChild(name); li.appendChild(added); li.appendChild(rm);
      list.appendChild(li);
    });
    $('pfMfaStart').textContent = factors.length ? 'Add another authenticator app' : 'Set up an authenticator app';
  }

  function closeEnrol() {
    pendingFactor = null;
    $('pfEnrol').hidden = true; $('pfMfaActions').hidden = false;
    $('pfQr').removeAttribute('src'); $('pfSecret').textContent = ''; $('pfCode').value = '';
  }

  $('pfMfaStart').addEventListener('click', async function () {
    $('pfMfaMsg').hidden = true;
    var btn = $('pfMfaStart'); btn.disabled = true;
    try {
      var e = await AdminMfa.startEnrol();
      pendingFactor = e.factorId;
      if (e.qr) $('pfQr').src = e.qr; else $('pfQr').removeAttribute('src');
      $('pfQr').hidden = !e.qr;
      $('pfSecret').textContent = e.secret;
      $('pfEnrol').hidden = false; $('pfMfaActions').hidden = true;
      $('pfCode').focus();
    } catch (err) { mfaMsg(AdminMfa.friendly(err)); }
    finally { btn.disabled = false; }
  });
  $('pfEnrolCancel').addEventListener('click', closeEnrol);
  $('pfEnrolForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    $('pfMfaMsg').hidden = true;
    if (!pendingFactor) return;
    var btn = $('pfEnrolBtn'); btn.disabled = true;
    var r = await AdminMfa.verify(pendingFactor, $('pfCode').value);
    btn.disabled = false;
    if (!r.ok) { mfaMsg(r.message); return; }
    closeEnrol();
    ctx.toast('Two-step verification is set up');
    await drawFactors();
  });
  await drawFactors();

  $('pfPwForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    $('pfPwMsg').hidden = true;
    var a1 = $('pfNew').value, a2 = $('pfNew2').value;
    if (a1.length < 12) { msg('The new password must be at least 12 characters.'); return; }
    if (a1 !== a2) { msg('The two passwords do not match.'); return; }
    var btn = $('pfPwBtn'); btn.disabled = true;
    try {
      var res = await sb.auth.updateUser({ password: a1 });
      if (res.error) { msg(/same|different/i.test(res.error.message || '') ? 'Choose a password you have not used before.' : 'The password could not be changed. Sign in again and retry.'); return; }
      $('pfNew').value = ''; $('pfNew2').value = '';
      ctx.toast('Password changed');
    } catch (e) { msg("Couldn't reach the server. Nothing was changed."); }
    finally { btn.disabled = false; }
  });

  $('pfOutHere').addEventListener('click', function () { ctx.signOut(); });
  $('pfOutAll').addEventListener('click', async function () {
    try { await sb.auth.signOut({ scope: 'global' }); } catch (e) { ctx.toast('Could not sign out of all devices. Try again.', 'error'); return; }
    window.location.replace('login.html?signedout=1');
  });

  $('adProfile').hidden = false;
});

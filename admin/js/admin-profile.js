/* StreetTasker Admin: My profile (stage A3b). Own data only.
   Reads: the session user (name comes from the server's admin answer), the access answer, own notification_preferences row
   (own-row read policy). Writes: password (Supabase Auth updateUser) and sign-out. No database function is added. */
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
  $('pfMfa').textContent = a.mfa_required ? (a.mfa_ok ? 'Required, and done for this sign-in' : 'Required, not done') : 'Not required yet (set-up arrives in stage A3c)';

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

/* ============================================================
   STREETTASKER — edit-profile-customer.js
   Customer "Edit Profile" page (edit-profile-customer.html).
   Same data the dashboard's old Profile panel used:
     users -> name, bio, location, avatar_url
   Email comes from the sign-in session and the phone number from the
   verifications table (public.users has neither), so both are read-only here.
   ============================================================ */
(function () {
  'use strict';

  var $ = EP.$;
  var BIO_MAX = 300;
  var S = { user: null, verified: false };

  async function safe(p) { try { var r = await p; return (r && r.data) || null; } catch (e) { return null; } }

  function strength() {
    EP.renderStrength([
      { label: 'Account created',    pct: 10, done: true },
      { label: 'Profile photo',      pct: 15, done: EP.hasPhoto() },
      { label: 'Personal details',   pct: 15, done: !!EP.val('epName') },
      { label: 'Location',           pct: 20, done: !!EP.val('epLocation') },
      { label: 'About you',          pct: 15, done: !!EP.val('epBio') },
      { label: 'Identity (NIN / BVN)', pct: 25, done: S.verified }
    ]);
  }

  async function load() {
    var user = await EP.guard('customer', 'edit-profile-customer.html', 'edit-profile-tasker.html');
    if (!user) return;
    S.user = user;

    var res = await Promise.all([
      safe(window.supabase.from('users').select('name, bio, location, avatar_url').eq('id', user.id).maybeSingle()),
      safe(window.supabase.from('verifications').select('phone').eq('user_id', user.id).maybeSingle()),
      EP.verification()
    ]);
    var ud = res[0] || {}, vr = res[1] || {}, ver = res[2];

    $('epName').value     = ud.name || (user.user_metadata && user.user_metadata.name) || '';
    $('epEmail').value    = user.email || '';
    $('epPhone').value    = vr.phone || '';
    $('epLocation').value = ud.location || '';
    $('epBio').value      = ud.bio || '';
    EP.photo.url = ud.avatar_url || '';

    S.verified = ver.verified;
    $('epPhoneTag').hidden = !(ver.verified && vr.phone);
    $('epVerifiedPill').hidden = !ver.verified;
    $('epVerifyCta').hidden = ver.verified;

    EP.repaintPhoto();
    paintBio();
    strength();
  }

  async function save(e) {
    e.preventDefault();
    EP.say('');
    var name = EP.val('epName');
    if (!name) { EP.say('Enter your full name.', 'error'); $('epName').focus(); return; }

    EP.busy(true);
    try {
      var uid = S.user.id;
      var avatarUrl = EP.photo.removed ? null : EP.photo.url;
      if (EP.photo.file) avatarUrl = await EP.upload(EP.photo.file, 'avatars', uid);

      var r = await window.supabase.from('users').update({
        name:       name,
        bio:        EP.val('epBio') || null,
        location:   EP.val('epLocation') || null,
        avatar_url: avatarUrl
      }).eq('id', uid);
      if (r.error) throw r.error;

      if (EP.photo.objectUrl) URL.revokeObjectURL(EP.photo.objectUrl);
      EP.photo.url = avatarUrl || ''; EP.photo.file = null; EP.photo.objectUrl = ''; EP.photo.removed = false;
      EP.clean();
      EP.repaintPhoto();

      EP.refreshNav(name, avatarUrl);
      EP.say('Profile saved.', 'ok');
      EP.toast('Profile updated!');
    } catch (err) {
      console.error('[edit-profile-customer] save failed:', err);
      EP.say('Save failed: ' + (err && err.message ? err.message : 'please try again.'), 'error');
    } finally {
      EP.busy(false);
    }
  }

  var paintBio = function () {};

  function boot() {
    paintBio = EP.bindCounter('epBio', 'epBioCount', BIO_MAX);
    EP.initPhoto({ getName: function () { return EP.val('epName'); }, onChange: strength });

    $('epForm').addEventListener('submit', save);
    $('epForm').addEventListener('input', function (ev) {
      if (ev.target.type === 'file') return;
      EP.dirty(); strength();
      if (!EP.photo.url && !EP.photo.objectUrl) EP.repaintPhoto(); /* initials follow the name */
    });

    if (typeof window.initLocationInput === 'function') {
      window.initLocationInput({ inputId: 'epLocation', dropdownId: 'epLocationSuggestions', gps: true, mode: 'area' });
    }
    load().catch(function (e) {
      console.error('[edit-profile-customer] load failed:', e);
      EP.say('Could not load your profile. Refresh to try again.', 'error');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

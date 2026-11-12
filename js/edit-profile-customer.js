/* ============================================================
   STREETTASKER — edit-profile-customer.js
   Customer "Edit Profile" page (edit-profile-customer.html).
   Same data the dashboard's old Profile panel used:
     users -> name, bio, location, avatar_url
   plus users.profile_details (jsonb, see docs/profile-details-migration.sql):
     usual hiring categories. (Tagline and working preferences were removed 2026-11-05; any old values stay in the database untouched.)
   Email comes from the sign-in session (public.users has no email), so it is read-only here.
   ============================================================ */
(function () {
  'use strict';

  var $ = EP.$;
  var BIO_MAX = 600;
  var S = { user: null, verified: false, details: {} };
  var cats;
  /* Same categories as Post a Task */
  var CAT_PRESETS = ['Home & Office Cleaning', 'Electrician', 'Plumber', 'Mechanic / Auto', 'Carpentry', 'Barber / Hair', 'Make-up / Beauty', 'Delivery', 'Moving', 'Painting'];

  async function safe(p) { try { var r = await p; return (r && r.data) || null; } catch (e) { return null; } }

  /* Hero preview follows the form */
  function paintHero() {
    EP.paintHero({
      name: EP.val('epName'),
      tag: S.verified ? 'Verified Customer' : '',
      tick: S.verified,
      location: EP.val('epLocation'),
      chips: [
        S.verified ? 'ID Verified' : '',
        'Escrow protected'
      ]
    });
  }

  async function loadStats(user) {
    var since = user.created_at ? new Date(user.created_at) : null;
    $('epSince').textContent = since && !isNaN(since) ? since.toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }) : '\u2014';
    try { $('epTasks').textContent = await window.ST.db.countMyTasks(); } catch (e) { /* leave 0 */ }
    try {
      var r = await window.supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('customer_id', user.id);
      $('epHired').textContent = r.count || 0;
    } catch (e) { /* leave 0 */ }
  }

  function strength() {
    if ($('epHeroName')) paintHero();
    EP.renderStrength([
      { label: 'Account created',      pct: 10, done: true },
      { label: 'Profile photo',        pct: 15, done: EP.hasPhoto() },
      { label: 'Name',                 pct: 10, done: !!EP.val('epName') },
      { label: 'Location',             pct: 15, done: !!EP.val('epLocation') },
      { label: 'About you',            pct: 20, done: !!EP.val('epBio') },
      { label: 'Services you hire for', pct: 5, done: !!(cats && cats.get().length) },
      { label: 'Identity (NIN / BVN)', pct: 25, done: S.verified }
    ]);
  }

  async function load() {
    var user = await EP.guard('customer', 'edit-profile-customer.html', 'edit-profile-tasker.html');
    if (!user) return;
    S.user = user;
    var vp = $('epViewPublic'); if (vp) vp.href = 'client-profile.html?id=' + encodeURIComponent(user.id);

    var res = await Promise.all([
      safe(window.supabase.from('users').select('*').eq('id', user.id).maybeSingle()),
      EP.verification()
    ]);
    var ud = res[0] || {}, ver = res[1];

    $('epName').value     = ud.name || (user.user_metadata && user.user_metadata.name) || '';
    $('epLocation').value = ud.location || '';
    $('epBio').value      = ud.bio || '';
    var d = (ud.profile_details && typeof ud.profile_details === 'object') ? ud.profile_details : {};
    S.details = d;
    cats.set(d.categories);
    EP.photo.url = ud.avatar_url || '';

    S.verified = ver.verified;
    $('epIdStat').textContent = ver.verified ? 'Verified' : 'Not yet';
    $('epIdNote').textContent = ver.verified ? 'NIN / BVN confirmed' : 'Asked only for payments over \u20A610,000';
    $('epVerifyCta').hidden = ver.verified;

    EP.repaintPhoto();
    paintBio();
    strength();
    loadStats(user);
  }

  async function save(e) {
    e.preventDefault();
    EP.say('');
    var name = EP.val('epName');
    if (!name) { EP.say('Enter your full name.', 'error'); $('epName').focus(); return; }

    EP.flushChips([cats]);
    EP.busy(true);
    var extraFailed = false;
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

      /* Extra details go in one jsonb column; if the database has not been updated yet the core profile is still saved. */
      var details = Object.assign({}, S.details, { categories: cats.get() });
      var x = await window.supabase.from('users').update({ profile_details: details }).eq('id', uid);
      if (x.error) { extraFailed = true; console.error('[edit-profile-customer] profile_details not saved:', x.error); }
      else S.details = details;

      if (EP.photo.objectUrl) URL.revokeObjectURL(EP.photo.objectUrl);
      EP.photo.url = avatarUrl || ''; EP.photo.file = null; EP.photo.objectUrl = ''; EP.photo.removed = false;
      if (!extraFailed) EP.clean();
      EP.repaintPhoto();

      EP.refreshNav(name, avatarUrl);
      if (extraFailed) {
        EP.say('Core details saved, but the extra profile details could not be stored yet. The database needs the profile_details update (docs/profile-details-migration.sql).', 'error');
      } else {
        EP.say('Profile saved.', 'ok');
        EP.toast('Profile updated!');
      }
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
    cats  = EP.chips({ host: $('epCats'),  max: 6, presets: CAT_PRESETS,  placeholder: 'Add another service', onChange: strength });
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

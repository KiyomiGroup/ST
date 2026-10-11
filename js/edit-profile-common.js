/* ============================================================
   STREETTASKER — edit-profile-common.js
   Helpers shared by edit-profile-tasker.js and edit-profile-customer.js:
   role guard, profile-strength ring + checklist, character counters,
   photo picker, image upload, verification state, nav refresh after save.
   Exposes window.EP. Needs: supabaseClient.js, sanitize.js, auth.js, ui.js.
   ============================================================ */
(function () {
  'use strict';

  var EP = window.EP = window.EP || {};
  var $ = EP.$ = function (id) { return document.getElementById(id); };
  var MB = 1024 * 1024;

  EP.MAX_PHOTO  = 2 * MB;
  EP.MAX_BANNER = 5 * MB;
  EP.TYPES      = ['image/jpeg', 'image/png', 'image/webp'];
  EP.RING_R     = 52;

  var ICON_CHECK = '<svg class="ap-i" aria-hidden="true"><use href="#i-check"/></svg>';

  /* ── small utils ─────────────────────────────────────────── */
  EP.initials = function (name, fallback) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || fallback || 'U';
  };
  EP.val = function (id) { var el = $(id); return el ? String(el.value || '').trim() : ''; };
  EP.toast = function (msg) { if (typeof window.showToast === 'function') window.showToast(msg); };

  /* ── session + role guard ────────────────────────────────── */
  EP.session = async function () {
    var s = await window.supabase.auth.getSession();
    return s.data.session && s.data.session.user;
  };

  /* Returns the signed-in user, or null after redirecting (logged out, or on the other role's page). */
  EP.guard = async function (role, page, otherUrl) {
    var user = await EP.session();
    if (!user) { window.location.replace('login.html?next=' + encodeURIComponent(page)); return null; }
    var r = null;
    try { r = await window.ST.auth.getUserRole(user); } catch (e) { /* use the cached role */ }
    r = r || localStorage.getItem('st_role');
    if (r && (r === 'tasker') !== (role === 'tasker')) { window.location.replace(otherUrl); return null; }
    return user;
  };

  /* ── avatar painting (DOM calls only, no inline style attributes) ── */
  EP.paintAvatar = function (el, url, text) {
    if (!el) return;
    el.textContent = '';
    if (url) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = url;
      el.appendChild(img);
    } else {
      var s = document.createElement('span');
      s.textContent = text || 'U';
      el.appendChild(s);
    }
  };

  /* ── character counter ───────────────────────────────────── */
  EP.bindCounter = function (fieldId, counterId, max) {
    var f = $(fieldId), c = $(counterId);
    if (!f || !c) return;
    f.maxLength = max;
    var paint = function () {
      var n = f.value.length;
      c.textContent = n + ' / ' + max + ' characters';
      c.classList.toggle('is-over', n >= max);
    };
    f.addEventListener('input', paint);
    paint();
    return paint;
  };

  /* ── profile strength: ring + checklist ──────────────────── */
  /* items: [{ label, pct, done }]. The first unfinished item with the most weight is highlighted. */
  EP.renderStrength = function (items) {
    var total = 0;
    items.forEach(function (i) { if (i.done) total += i.pct; });
    total = Math.min(100, total);

    var fill = $('epRingFill');
    if (fill) {
      var c = 2 * Math.PI * EP.RING_R;
      fill.setAttribute('stroke-dasharray', c.toFixed(1));
      fill.setAttribute('stroke-dashoffset', (c * (1 - total / 100)).toFixed(1));
    }
    var pct = $('epPct');
    if (pct) pct.textContent = total + '%';
    var ring = $('epRing');
    if (ring) ring.setAttribute('aria-label', 'Profile strength ' + total + ' percent');

    var next = null;
    items.forEach(function (i) { if (!i.done && (!next || i.pct > next.pct)) next = i; });

    var ul = $('epChecks');
    if (!ul) return total;
    ul.textContent = '';
    items.forEach(function (i) {
      var li = document.createElement('li');
      li.className = 'ep-check' + (i.done ? ' is-done' : '') + (i === next ? ' is-next' : '');
      var dot = document.createElement('span');
      dot.className = 'ep-check-dot';
      dot.innerHTML = ICON_CHECK;
      var label = document.createElement('span');
      label.className = 'ep-check-label';
      label.textContent = i.label;
      var p = document.createElement('span');
      p.className = 'ep-check-pct';
      p.textContent = (i.done ? '' : '+') + i.pct + '%';
      li.appendChild(dot); li.appendChild(label); li.appendChild(p);
      ul.appendChild(li);
    });
    return total;
  };

  /* ── photo picker (shared by both pages) ─────────────────── */
  /* state: { file, removed, url }. opts.onChange runs after any change. */
  EP.photo = { file: null, removed: false, url: '', objectUrl: '' };

  EP.hasPhoto = function () { return !EP.photo.removed && !!(EP.photo.file || EP.photo.url); };

  EP.initPhoto = function (opts) {
    opts = opts || {};
    var input = $('epPhotoFile');
    var openPicker = function () { if (input) input.click(); };
    var b1 = $('epPhotoBtn'), b2 = $('epPhotoCam'), rm = $('epPhotoRemove');
    if (b1) b1.addEventListener('click', openPicker);
    if (b2) b2.addEventListener('click', openPicker);

    var paint = function () {
      var shown = EP.photo.removed ? '' : (EP.photo.objectUrl || EP.photo.url);
      EP.paintAvatar($('epAvatar'), shown, EP.initials(opts.getName ? opts.getName() : '', 'U'));
      if (rm) rm.hidden = !EP.hasPhoto();
      if (opts.onChange) opts.onChange();
    };
    EP.repaintPhoto = paint;

    if (input) input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var check = typeof window.validateUpload === 'function'
        ? window.validateUpload(f, { allowedTypes: EP.TYPES, maxBytes: EP.MAX_PHOTO }) : { ok: true };
      if (!check.ok) { EP.toast(check.error); input.value = ''; return; }
      if (EP.photo.objectUrl) URL.revokeObjectURL(EP.photo.objectUrl);
      EP.photo.file = f; EP.photo.removed = false; EP.photo.objectUrl = URL.createObjectURL(f);
      EP.dirty();
      paint();
    });

    if (rm) rm.addEventListener('click', function () {
      if (EP.photo.objectUrl) URL.revokeObjectURL(EP.photo.objectUrl);
      EP.photo.file = null; EP.photo.objectUrl = ''; EP.photo.removed = true;
      if (input) input.value = '';
      EP.dirty();
      paint();
    });
    paint();
  };

  /* ── upload to the shared profile-images bucket ──────────── */
  EP.upload = async function (file, folder, uid) {
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type] || 'jpg';
    var path = folder + '/' + uid + '-' + Date.now() + '.' + ext;
    var up = await window.supabase.storage.from('profile-images')
      .upload(path, file, { cacheControl: '3600', upsert: true });
    if (up.error) throw new Error('Could not upload your image (' + up.error.message + ').');
    return window.supabase.storage.from('profile-images').getPublicUrl(path).data.publicUrl;
  };

  /* ── verification state (same source as the dashboards) ──── */
  EP.verification = async function () {
    var out = { verified: false, status: null, reason: '' };
    try {
      if (window.ST && window.ST.verify) {
        out.verified = !!(await window.ST.verify.isUserVerified());
        if (!out.verified) {
          var s = await window.ST.verify.getVerificationStatus();
          if (s) { out.status = s.status || null; out.reason = s.rejection_reason || ''; }
        }
      }
    } catch (e) { /* treat as not verified */ }
    return out;
  };

  /* ── status message + save button ────────────────────────── */
  EP.say = function (text, kind) {
    var m = $('epMsg');
    if (!m) return;
    if (!text) { m.hidden = true; m.textContent = ''; return; }
    m.textContent = text;
    m.className = 'ep-msg ' + (kind === 'error' ? 'is-error' : 'is-ok');
    m.hidden = false;
  };
  EP.busy = function (on) {
    var b = $('epSave');
    if (!b) return;
    b.disabled = !!on;
    b.textContent = on ? 'Saving...' : 'Save Changes';
  };

  /* ── unsaved-changes guard ───────────────────────────────── */
  var isDirty = false;
  EP.dirty = function () { isDirty = true; };
  EP.clean = function () { isDirty = false; };
  window.addEventListener('beforeunload', function (e) {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* ── refresh the nav avatar and cached name after a save ─── */
  EP.refreshNav = function (name, avatarUrl) {
    try {
      if (name) localStorage.setItem('st_name', name);
      if (avatarUrl) localStorage.setItem('st_avatar', avatarUrl); else localStorage.removeItem('st_avatar');
    } catch (e) { /* storage unavailable */ }
    var initials = EP.initials(name, 'U');
    [['navAvatarImg', 'navAvatarInitial'], ['navMobileAvatarImg', 'navMobileAvatarInitial']].forEach(function (pair) {
      var img = $(pair[0]), init = $(pair[1]);
      if (init) init.textContent = initials;
      if (!img) return;
      if (avatarUrl) { img.src = avatarUrl; img.style.display = 'block'; if (init) init.style.display = 'none'; }
      else { img.removeAttribute('src'); img.style.display = 'none'; if (init) init.style.display = ''; }
    });
    var dInit = $('navDrawerAvatarInitial');
    if (dInit) dInit.textContent = initials;
    var dName = $('navDrawerName');
    if (dName && name) dName.textContent = name;
    if (typeof window._setDrawerAvatar === 'function') window._setDrawerAvatar(avatarUrl || '');
  };

  /* ── dialogs: close buttons ──────────────────────────────── */
  EP.wireDialog = function (dlg) {
    if (!dlg) return;
    dlg.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { dlg.close(); });
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  };

  /* ── colour from a design token, as #rrggbb (so no colour value lives in this file) ── */
  EP.tokenHex = function (token) {
    var probe = document.createElement('span');
    probe.className = 'ap-sprite';
    probe.style.backgroundColor = 'var(' + token + ')';
    document.body.appendChild(probe);
    var parts = (getComputedStyle(probe).backgroundColor.match(/\d+/g) || []).slice(0, 3);
    probe.remove();
    if (parts.length < 3) return '';
    return '#' + parts.map(function (n) { return ('0' + Number(n).toString(16)).slice(-2); }).join('');
  };
})();

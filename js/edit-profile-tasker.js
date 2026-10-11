/* ============================================================
   STREETTASKER — edit-profile-tasker.js
   Tasker "Edit Profile" page (edit-profile-tasker.html).
   Loads and saves the same data the dashboard's old Edit Page panel did:
     users   -> name, bio, business_name, avatar_url
     taskers -> name, business_name, location, service, service_name, category,
                rate_value, rate_unit, bio, banner_color, banner_img, photo_url
   plus: live profile-strength ring, track record (rating, jobs, earnings),
   work portfolio (feed_posts) and verification status.
   ============================================================ */
(function () {
  'use strict';

  var $ = EP.$;
  var FEE_RATE = 0.12; /* same platform fee the Overview uses (js/tasker-overview.js) */
  var BIO_MAX = 600;

  var S = {
    user: null,
    banner: { color: '', image: '', file: null, objectUrl: '' },
    existing: {},     /* the taskers row as loaded: used so a save never wipes fields this page does not edit */
    rating: null, reviews: null,
    verified: false,
    portfolioCount: 0,
    swatches: []
  };

  /* ── helpers ─────────────────────────────────────────────── */
  function naira(n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); }
  function nairaShort(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return '\u20A6' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return '\u20A6' + Math.round(n / 1e3) + 'k';
    return naira(n);
  }
  async function safe(p) { try { var r = await p; return (r && r.data) || null; } catch (e) { return null; } }

  /* ── banner ──────────────────────────────────────────────── */
  function paintBanner() {
    var el = $('epBanner');
    var img = S.banner.objectUrl || S.banner.image;
    if (img) {
      el.style.backgroundImage = 'url("' + img + '")';
      el.style.backgroundColor = '';
    } else {
      el.style.backgroundImage = '';
      el.style.backgroundColor = S.banner.color || '';
    }
    $('epBannerReposition').hidden = !img;
    $('epBannerRemove').hidden = !img;

    var line = [EP.val('epService'), EP.val('epLocation')].filter(Boolean).join(' \u00B7 ');
    $('epBannerLine').textContent = line || 'Add your service to see it here';

    document.querySelectorAll('#epSwatches .ep-swatch[data-color]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(!img && b.dataset.color.toLowerCase() === (S.banner.color || '').toLowerCase()));
    });
  }

  function addSwatch(color, label) {
    var host = $('epSwatches');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-swatch';
    b.dataset.color = color;
    b.title = label;
    b.setAttribute('aria-label', label + ' banner');
    b.setAttribute('aria-pressed', 'false');
    b.style.backgroundColor = color;
    b.addEventListener('click', function () { pickColor(color); });
    host.insertBefore(b, host.querySelector('.ep-swatch-custom'));
  }

  function buildSwatches(savedColor) {
    var host = $('epSwatches');
    host.textContent = '';
    /* Palette = design tokens, read at runtime so no colour is written in this file */
    [['--color-text', 'Charcoal'], ['--color-forest-900', 'Deep forest'], ['--color-forest-800', 'Forest'],
     ['--color-forest-700', 'Green'], ['--pt-escrow-icon', 'Emerald'], ['--color-primary', 'Primary'],
     ['--color-warning', 'Amber'], ['--color-text-secondary', 'Slate']].forEach(function (t) {
      var hex = EP.tokenHex(t[0]);
      if (hex && S.swatches.indexOf(hex.toLowerCase()) === -1) { S.swatches.push(hex.toLowerCase()); }
    });

    var custom = document.createElement('label');
    custom.className = 'ep-swatch ep-swatch-custom';
    custom.title = 'Pick any colour';
    custom.innerHTML = '<svg class="ap-i" aria-hidden="true"><use href="#i-plus"/></svg>' +
      '<input type="color" id="epBannerCustom" aria-label="Custom banner colour" />';
    host.appendChild(custom);
    custom.querySelector('input').addEventListener('input', function (e) { pickColor(e.target.value, true); });

    var names = ['Charcoal', 'Deep forest', 'Forest', 'Green', 'Emerald', 'Primary', 'Amber', 'Slate'];
    S.swatches.forEach(function (hex, i) { addSwatch(hex, names[i] || 'Colour'); });
    /* A colour saved earlier that is not in the palette stays selectable */
    if (savedColor && S.swatches.indexOf(savedColor.toLowerCase()) === -1) addSwatch(savedColor, 'Saved colour');
  }

  function pickColor(color) {
    S.banner.color = color;
    clearBannerImage(false);
    var c = $('epBannerCustom'); if (c && /^#[0-9a-f]{6}$/i.test(color)) c.value = color;
    EP.dirty();
    paintBanner();
  }

  function clearBannerImage(repaint) {
    if (S.banner.objectUrl) URL.revokeObjectURL(S.banner.objectUrl);
    S.banner.objectUrl = ''; S.banner.file = null; S.banner.image = '';
    var f = $('epBannerFile'); if (f) f.value = '';
    if (repaint !== false) paintBanner();
  }

  /* ── banner crop (drag up / down, then cut a 3:1 strip) ───── */
  var crop = { top: 0, startY: null, dataUrl: '' };

  function openCrop(src) {
    var img = $('epCropImg');
    crop.top = 0; crop.startY = null;
    img.style.transform = 'translateY(0px)';
    $('epCropHint').classList.remove('is-hidden');
    img.crossOrigin = 'anonymous';
    img.onerror = function () { EP.toast('Could not open that image. Upload it again to reposition.'); $('epCropDlg').close(); };
    img.src = src;
    $('epCropDlg').showModal();
  }

  function cropMove(clientY) {
    if (crop.startY === null) return;
    var vp = $('epCrop'), img = $('epCropImg');
    var imgH = img.naturalHeight * (vp.offsetWidth / img.naturalWidth);
    var minTop = Math.min(0, vp.offsetHeight - imgH);
    crop.top = Math.min(0, Math.max(minTop, crop.top + (clientY - crop.startY)));
    img.style.transform = 'translateY(' + crop.top + 'px)';
    crop.startY = clientY;
  }

  function wireCrop() {
    var vp = $('epCrop');
    vp.addEventListener('pointerdown', function (e) {
      crop.startY = e.clientY;
      vp.setPointerCapture(e.pointerId);
      vp.classList.add('is-dragging');
      $('epCropHint').classList.add('is-hidden');
    });
    vp.addEventListener('pointermove', function (e) { cropMove(e.clientY); });
    var end = function () { crop.startY = null; vp.classList.remove('is-dragging'); };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);

    $('epCropOk').addEventListener('click', function () {
      var img = $('epCropImg'), vp2 = $('epCrop');
      var scale = img.naturalWidth / vp2.offsetWidth;
      var srcY = Math.max(0, -crop.top * scale);
      var srcH = Math.min(img.naturalHeight - srcY, vp2.offsetHeight * scale);
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = Math.round(srcH);
      try {
        canvas.getContext('2d').drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) { EP.toast('Could not crop that image.'); return; }
          if (S.banner.objectUrl) URL.revokeObjectURL(S.banner.objectUrl);
          S.banner.file = new File([blob], 'banner.jpg', { type: 'image/jpeg' });
          S.banner.objectUrl = URL.createObjectURL(blob);
          EP.dirty(); paintBanner();
          $('epCropDlg').close();
        }, 'image/jpeg', 0.92);
      } catch (err) {
        EP.toast('This image cannot be repositioned. Upload it again instead.');
        $('epCropDlg').close();
      }
    });
  }

  function wireBanner() {
    var file = $('epBannerFile');
    $('epBannerUpload').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var check = window.validateUpload ? window.validateUpload(f, { allowedTypes: EP.TYPES, maxBytes: EP.MAX_BANNER }) : { ok: true };
      if (!check.ok) { EP.toast(check.error); file.value = ''; return; }
      var r = new FileReader();
      r.onload = function (e) { crop.dataUrl = e.target.result; openCrop(crop.dataUrl); };
      r.readAsDataURL(f);
    });
    $('epBannerReposition').addEventListener('click', function () {
      openCrop(S.banner.objectUrl || S.banner.image);
    });
    $('epBannerRemove').addEventListener('click', function () { clearBannerImage(true); EP.dirty(); });
    wireCrop();
  }

  /* ── profile strength ────────────────────────────────────── */
  function strength() {
    var rate = parseFloat(EP.val('epRate'));
    EP.renderStrength([
      { label: 'Profile photo',          pct: 10, done: EP.hasPhoto() },
      { label: 'Banner image',           pct: 10, done: !!(S.banner.objectUrl || S.banner.image) },
      { label: 'Name & business name',   pct: 15, done: !!(EP.val('epName') && EP.val('epBusiness')) },
      { label: 'Service & rate',         pct: 15, done: !!(EP.val('epService') && rate > 0) },
      { label: 'Location',               pct: 10, done: !!EP.val('epLocation') },
      { label: 'About you',              pct: 10, done: !!EP.val('epBio') },
      { label: 'Verified identity',      pct: 20, done: S.verified },
      { label: 'Work portfolio added',   pct: 10, done: S.portfolioCount > 0 }
    ]);
  }

  /* ── verification strip ──────────────────────────────────── */
  function paintVerify(v) {
    S.verified = v.verified;
    var box = $('epVerify'), title = $('epVerifyTitle'), text = $('epVerifyText'), btn = $('epVerifyBtn');
    box.className = 'ep-verify';
    if (v.verified) {
      title.innerHTML = 'You\u2019re Verified \u2713 <span class="badge badge-green">Trust badge on</span>';
      text.textContent = 'Your profile shows the verified badge. Customers can trust your listing.';
      btn.hidden = true;
    } else if (v.status === 'pending') {
      box.classList.add('is-pending');
      title.textContent = 'Verification Pending Review';
      text.textContent = 'We\u2019ve received your submission and are reviewing it. This usually takes 1\u20132 business days.';
      btn.hidden = true;
    } else {
      box.classList.add('is-todo');
      title.textContent = v.status === 'rejected' ? 'Verification rejected' : 'Get Verified';
      text.textContent = v.status === 'rejected'
        ? (v.reason || 'Please check your details and resubmit.')
        : 'Verified taskers appear higher in search results and display a trust badge on their profile.';
      btn.hidden = false;
      btn.textContent = v.status === 'rejected' ? 'Resubmit' : 'Start Verification';
    }
  }

  /* ── track record ────────────────────────────────────────── */
  async function loadTrack(uid) {
    var rows = (await safe(window.supabase.from('bookings')
      .select('id,amount,task_id,status').eq('tasker_id', uid).eq('status', 'completed'))) || [];
    $('epJobs').textContent = rows.length;

    var missing = rows.filter(function (b) { return !Number(b.amount) && b.task_id; }).map(function (b) { return b.task_id; });
    var budgets = {};
    if (missing.length) {
      (await safe(window.supabase.from('tasks').select('id,budget').in('id', missing)) || [])
        .forEach(function (t) { budgets[t.id] = Number(t.budget) || 0; });
    }
    var earned = rows.reduce(function (sum, b) {
      var gross = Number(b.amount) || budgets[b.task_id] || 0;
      return sum + gross - Math.round(gross * FEE_RATE);
    }, 0);
    var el = $('epEarned');
    el.textContent = nairaShort(earned);
    el.title = naira(earned) + ' after the 12% platform fee';

    var r = $('epRating');
    if (S.rating) {
      r.innerHTML = S.rating.toFixed(1) + ' <svg class="ap-i" aria-hidden="true"><use href="#i-star"/></svg>';
    } else { r.textContent = '\u2014'; }
  }

  /* ── portfolio ───────────────────────────────────────────── */
  async function loadPortfolio(uid) {
    var host = $('epPortfolio');
    var posts = (await safe(window.supabase.from('feed_posts')
      .select('id,image_url,image,caption,content,created_at').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(11))) || [];
    posts = posts.filter(function (p) { return p.image_url || p.image; });
    S.portfolioCount = posts.length;

    host.textContent = '';
    posts.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'ep-work';
      var wrap = document.createElement('div');
      wrap.className = 'ep-work-img';
      var img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.src = p.image_url || p.image;
      wrap.appendChild(img);
      card.appendChild(wrap);
      var cap = document.createElement('div');
      cap.className = 'ep-work-cap';
      cap.textContent = p.caption || p.content || 'Completed job';
      card.appendChild(cap);
      host.appendChild(card);
    });

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'ep-work-add';
    add.innerHTML = '<span class="ep-work-plus"><svg class="ap-i" aria-hidden="true"><use href="#i-plus"/></svg></span><span>Upload Media</span>';
    add.addEventListener('click', openWorkDialog);
    host.appendChild(add);
    strength();
  }

  function openWorkDialog() {
    $('epWorkFile').value = ''; $('epWorkCaption').value = '';
    $('epWorkErr').hidden = true;
    $('epWorkDlg').showModal();
  }

  function wirePortfolio() {
    $('epWorkAddTop').addEventListener('click', openWorkDialog);
    EP.wireDialog($('epWorkDlg'));
    $('epWorkOk').addEventListener('click', async function () {
      var err = $('epWorkErr'), btn = $('epWorkOk');
      var f = $('epWorkFile').files && $('epWorkFile').files[0];
      err.hidden = true;
      if (!f) { err.textContent = 'Choose a photo first.'; err.hidden = false; return; }
      var check = window.validateUpload ? window.validateUpload(f, { allowedTypes: EP.TYPES, maxBytes: EP.MAX_BANNER }) : { ok: true };
      if (!check.ok) { err.textContent = check.error; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Uploading...';
      try {
        var url = await EP.upload(f, 'portfolio', S.user.id);
        await window.ST.db.postFeedUpdate(EP.val('epWorkCaption'), url);
        $('epWorkDlg').close();
        EP.toast('Job photo added');
        await loadPortfolio(S.user.id);
      } catch (e) {
        err.textContent = e.message || 'Could not add that photo.'; err.hidden = false;
      } finally { btn.disabled = false; btn.textContent = 'Add Photo'; }
    });
  }

  /* ── load ────────────────────────────────────────────────── */
  async function load() {
    var user = await EP.guard('tasker', 'edit-profile-tasker.html', 'edit-profile-customer.html');
    if (!user) return;
    S.user = user;

    var res = await Promise.all([
      safe(window.supabase.from('users').select('name, bio, location, avatar_url, business_name').eq('id', user.id).maybeSingle()),
      safe(window.supabase.from('taskers').select('*').eq('user_id', String(user.id)).maybeSingle()),
      EP.verification()
    ]);
    var ud = res[0] || {}, td = res[1] || {};
    S.existing = td;

    $('epName').value     = ud.name || (user.user_metadata && user.user_metadata.name) || '';
    $('epBusiness').value = ud.business_name || td.business_name || '';
    $('epService').value  = td.service || td.service_name || '';
    $('epRate').value     = td.rate_value || '';
    if (td.rate_unit) $('epRateUnit').value = td.rate_unit;
    $('epLocation').value = td.location || ud.location || '';
    $('epBio').value      = ud.bio || td.bio || '';

    EP.photo.url = ud.avatar_url || td.photo_url || '';
    S.banner.color = td.banner_color || '';
    S.banner.image = td.banner_img || '';
    var r = parseFloat(td.rating);
    S.rating = isFinite(r) && r > 0 ? r : null;

    buildSwatches(S.banner.color);
    if (!S.banner.color && S.swatches.length) S.banner.color = S.swatches[2] || S.swatches[0];
    paintBanner();
    EP.repaintPhoto();
    paintVerify(res[2]);
    $('epViewPublic').href = 'tasker-profile.html?id=' + encodeURIComponent(user.id);
    if (new URLSearchParams(location.search).get('from') === 'onboarding') $('epWelcome').hidden = false;

    paintBio();
    strength();
    loadTrack(user.id);
    loadPortfolio(user.id);
  }

  /* ── save ────────────────────────────────────────────────── */
  async function save(e) {
    e.preventDefault();
    EP.say('');
    var name = EP.val('epName');
    if (!name) { EP.say('Enter your full name.', 'error'); $('epName').focus(); return; }
    var rateStr = EP.val('epRate');
    var rate = rateStr ? parseFloat(rateStr) : null;
    if (rate !== null && (!isFinite(rate) || rate < 0)) { EP.say('Enter a valid rate.', 'error'); $('epRate').focus(); return; }

    EP.busy(true);
    try {
      var uid = S.user.id;
      var ex = S.existing || {};

      /* Photo */
      var avatarUrl = EP.photo.removed ? null : EP.photo.url;
      if (EP.photo.file) avatarUrl = await EP.upload(EP.photo.file, 'avatars', uid);

      /* Banner */
      var bannerImg = S.banner.image || null;
      if (S.banner.file) bannerImg = await EP.upload(S.banner.file, 'banners', uid);

      var biz = EP.val('epBusiness') || null;
      var bio = EP.val('epBio') || null;
      var service = EP.val('epService') || null;
      var location = EP.val('epLocation') || null;

      var u = await window.supabase.from('users').update({
        name: name, bio: bio, business_name: biz, avatar_url: avatarUrl
      }).eq('id', uid);
      if (u.error) throw u.error;

      /* Upsert (not update) so a brand-new tasker gets a row. Columns not listed here keep their saved values. */
      var t = await window.supabase.from('taskers').upsert({
        user_id:       String(uid),
        name:          name,
        business_name: biz,
        location:      location,
        service:       service,
        service_name:  service,
        category:      service ? service.toLowerCase().replace(/[^a-z]/g, '') : null,
        rate_value:    rate,
        rate_unit:     EP.val('epRateUnit') || '/hour',
        bio:           bio,
        banner_color:  S.banner.color || ex.banner_color || null,
        banner_img:    bannerImg,
        photo_url:     avatarUrl,
        available:     ex.available === false ? false : true
      }, { onConflict: 'user_id' });
      if (t.error) throw t.error;

      /* Saved: the new files are now the stored ones */
      if (EP.photo.objectUrl) URL.revokeObjectURL(EP.photo.objectUrl);
      EP.photo.url = avatarUrl || ''; EP.photo.file = null; EP.photo.objectUrl = ''; EP.photo.removed = false;
      if (S.banner.objectUrl) URL.revokeObjectURL(S.banner.objectUrl);
      S.banner.image = bannerImg || ''; S.banner.file = null; S.banner.objectUrl = '';
      S.existing = Object.assign({}, ex, { banner_color: S.banner.color, banner_img: bannerImg, photo_url: avatarUrl });
      EP.clean();
      EP.repaintPhoto(); paintBanner();

      EP.refreshNav(name, avatarUrl);
      EP.say('Profile updated successfully.', 'ok');
      EP.toast('Your profile has been saved!');
    } catch (err) {
      console.error('[edit-profile-tasker] save failed:', err);
      EP.say('Save failed: ' + (err && err.message ? err.message : 'please try again.'), 'error');
    } finally {
      EP.busy(false);
    }
  }

  /* ── boot ────────────────────────────────────────────────── */
  var paintBio = function () {};

  function boot() {
    paintBio = EP.bindCounter('epBio', 'epBioCount', BIO_MAX);
    EP.initPhoto({ getName: function () { return EP.val('epName'); }, onChange: strength });
    wireBanner();
    wirePortfolio();
    EP.wireDialog($('epCropDlg'));

    $('epForm').addEventListener('submit', save);
    $('epForm').addEventListener('input', function (ev) {
      if (ev.target.type === 'file') return;
      EP.dirty(); strength(); paintBanner();
      if (!EP.photo.url && !EP.photo.objectUrl) EP.repaintPhoto(); /* initials follow the name */
    });

    if (typeof window.initLocationInput === 'function') {
      window.initLocationInput({ inputId: 'epLocation', dropdownId: 'epLocationSuggestions', gps: true, mode: 'precise' });
    }
    load().catch(function (e) {
      console.error('[edit-profile-tasker] load failed:', e);
      EP.say('Could not load your profile. Refresh to try again.', 'error');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

/* ============================================================
   STREETTASKER — edit-profile-tasker.js
   Tasker "Edit Profile" page (edit-profile-tasker.html).
   Loads and saves the same data the dashboard's old Edit Page panel did:
     users   -> name, bio, business_name, avatar_url
     taskers -> name, business_name, location, service, service_name, category,
                rate_value, rate_unit, bio, photo_url, available
                (banner_color / banner_img are no longer edited here; saved values are left untouched)
   plus everything the public profile shows that a tasker has to provide, stored in
   taskers.profile_details (jsonb, see docs/profile-details-migration.sql):
   headline, experience, pricing style, next opening, coverage, offers, services,
   portfolio, certifications, emergency callouts.
   Live profile-strength ring, track record (rating, jobs, earnings), verification status.
   ============================================================ */
(function () {
  'use strict';

  var $ = EP.$;
  var FEE_RATE = 0.12; /* same platform fee the Overview uses (js/tasker-overview.js) */
  var BIO_MAX = 1000;
  var PORTFOLIO_MAX = 12;
  var offers, services, certs, areas;

  var S = {
    user: null,
    existing: {},     /* the taskers row as loaded: used so a save never wipes fields this page does not edit */
    rating: null, reviews: null,
    verified: false,
    details: {},
    portfolio: []
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

  /* ── hero preview and Experience stat ────────────────────── */
  function paintHero() {
    var y = parseInt(EP.val('epYears'), 10);
    var exp = $('epExpStat'), note = $('epExpStatNote');
    if (exp) exp.textContent = isFinite(y) ? y + (y > 0 ? '+ Years' : ' Years') : '\u2014';
    if (note) note.textContent = EP.val('epExpNote') || 'Add it below';
    var certN = certs ? certs.count() : 0;
    EP.paintHero({
      name: EP.val('epBusiness') || EP.val('epName'),
      tag: S.verified ? 'Verified Tasker' : '',
      tick: S.verified,
      location: EP.val('epLocation'),
      chips: [
        EP.val('epHeadline'),
        S.verified ? 'ID Verified' : 'ID not verified yet',
        certN ? certN + (certN === 1 ? ' credential' : ' credentials') : '',
        $('epAvailable').checked ? 'Available for bookings' : 'Not taking bookings'
      ]
    });
  }

  /* ── profile strength ────────────────────────────────────── */
  function strength() {
    var rate = parseFloat(EP.val('epRate'));
    if (typeof paintHero === 'function' && $('epAvailable')) paintHero();
    EP.renderStrength([
      { label: 'Profile photo',            pct: 10, done: EP.hasPhoto() },
      { label: 'Name & business name',     pct: 8,  done: !!(EP.val('epName') && EP.val('epBusiness')) },
      { label: 'Headline & experience',    pct: 10, done: !!(EP.val('epHeadline') && EP.val('epYears')) },
      { label: 'Service & rate',           pct: 10, done: !!(EP.val('epService') && rate > 0) },
      { label: 'Location & coverage',      pct: 12, done: !!(EP.val('epLocation') && areas && areas.get().length) },
      { label: 'About you',                pct: 10, done: !!EP.val('epBio') },
      { label: 'Services & estimates',     pct: 14, done: !!(services && services.count()) },
      { label: 'Work portfolio',           pct: 10, done: S.portfolio.length > 0 },
      { label: 'Certifications',           pct: 6,  done: !!(certs && certs.count()) },
      { label: 'Verified identity',        pct: 10, done: S.verified }
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
    var rn = $('epRatingNote');
    if (rn) rn.textContent = S.reviews ? S.reviews + (S.reviews === 1 ? ' review' : ' reviews') : 'No reviews yet';
  }

  /* ── portfolio (saved in profile_details.portfolio) ─────── */
  function renderPortfolio() {
    var host = $('epPortfolio');
    host.textContent = '';
    S.portfolio.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'ep-work';
      var wrap = document.createElement('div');
      wrap.className = 'ep-work-img';
      var img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.src = p.image_url;
      wrap.appendChild(img);
      card.appendChild(wrap);
      var cap = document.createElement('div');
      cap.className = 'ep-work-cap';
      cap.textContent = p.title || 'Completed job';
      card.appendChild(cap);
      if (p.location) {
        var meta = document.createElement('div');
        meta.className = 'ep-work-meta';
        meta.textContent = p.location;
        card.appendChild(meta);
      }
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn btn-text btn-sm ep-danger ep-work-rm';
      rm.textContent = 'Remove';
      rm.addEventListener('click', function () { S.portfolio.splice(i, 1); EP.dirty(); renderPortfolio(); });
      card.appendChild(rm);
      host.appendChild(card);
    });
    if (S.portfolio.length < PORTFOLIO_MAX) {
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'ep-work-add';
      add.innerHTML = '<span class="ep-work-plus"><svg class="ap-i" aria-hidden="true"><use href="#i-plus"/></svg></span><span>Upload Media</span>';
      add.addEventListener('click', openWorkDialog);
      host.appendChild(add);
    }
    $('epWorkAddTop').hidden = S.portfolio.length >= PORTFOLIO_MAX;
    strength();
  }

  function openWorkDialog() {
    ['epWorkFile', 'epWorkCaption', 'epWorkPlace', 'epWorkDesc'].forEach(function (id) { $(id).value = ''; });
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
        S.portfolio.push({ image_url: url, title: EP.val('epWorkCaption'), location: EP.val('epWorkPlace'), description: EP.val('epWorkDesc') });
        EP.dirty();
        $('epWorkDlg').close();
        renderPortfolio();
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
      safe(window.supabase.from('users').select('*').eq('id', user.id).maybeSingle()),
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

    var d = (td.profile_details && typeof td.profile_details === 'object') ? td.profile_details : {};
    S.details = d;
    $('epHeadline').value    = d.headline || '';
    $('epYears').value       = d.years_experience == null ? '' : d.years_experience;
    $('epExpNote').value     = d.experience_note || '';
    $('epPriceNote').value   = d.price_note || '';
    $('epNextOpening').value = d.next_opening || '';
    $('epAvailable').checked = td.available !== false;
    $('epRadius').value      = String((d.coverage && d.coverage.radius_km) || 15);
    areas.set(d.coverage && d.coverage.areas);
    offers.set(d.offers);
    services.set(d.services);
    certs.set(d.certifications);
    $('epEmergency').checked = !!(d.emergency && d.emergency.enabled);
    $('epEmergencyText').value = (d.emergency && d.emergency.text) || '';
    syncEmergency();
    if (Array.isArray(d.portfolio)) {
      S.portfolio = d.portfolio.filter(function (x) { return x && x.image_url; });
    } else {
      /* first time on this page: bring over work photos already posted */
      var posts = (await safe(window.supabase.from('feed_posts').select('image_url,image,caption,content')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(PORTFOLIO_MAX))) || [];
      S.portfolio = posts.filter(function (x) { return x.image_url || x.image; }).map(function (x) {
        return { image_url: x.image_url || x.image, title: x.caption || x.content || '', location: '', description: '' };
      });
    }
    EP.photo.url = ud.avatar_url || td.photo_url || '';
    var r = parseFloat(td.rating);
    S.rating = isFinite(r) && r > 0 ? r : null;
    var rc = parseInt(td.review_count, 10);
    S.reviews = isFinite(rc) && rc > 0 ? rc : null;

    EP.repaintPhoto();
    paintVerify(res[2]);
    $('epViewPublic').href = 'tasker-profile.html?id=' + encodeURIComponent(user.id);
    if (new URLSearchParams(location.search).get('from') === 'onboarding') $('epWelcome').hidden = false;

    paintBio();
    strength();
    renderPortfolio();
    loadTrack(user.id);
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

    EP.flushChips([areas]);
    EP.busy(true);
    var extraFailed = false;
    try {
      var uid = S.user.id;
      var ex = S.existing || {};

      /* Photo */
      var avatarUrl = EP.photo.removed ? null : EP.photo.url;
      if (EP.photo.file) avatarUrl = await EP.upload(EP.photo.file, 'avatars', uid);

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
        photo_url:     avatarUrl,
        available:     $('epAvailable').checked
      }, { onConflict: 'user_id' });
      if (t.error) throw t.error;

      /* Extra profile details live in one jsonb column. If the database has not been updated yet,
         the core profile above is still saved and we say so. */
      var years = parseInt(EP.val('epYears'), 10);
      var details = Object.assign({}, S.details, {
        headline:        EP.val('epHeadline'),
        years_experience: isFinite(years) ? years : null,
        experience_note: EP.val('epExpNote'),
        price_note:      EP.val('epPriceNote'),
        next_opening:    EP.val('epNextOpening'),
        coverage:        { radius_km: parseInt(EP.val('epRadius'), 10) || 15, areas: areas.get() },
        offers:          offers.get(),
        services:        services.get(),
        portfolio:       S.portfolio,
        certifications:  certs.get(),
        emergency:       { enabled: $('epEmergency').checked, text: EP.val('epEmergencyText') }
      });
      var x = await window.supabase.from('taskers').update({ profile_details: details }).eq('user_id', String(uid));
      if (x.error) { extraFailed = true; console.error('[edit-profile-tasker] profile_details not saved:', x.error); }
      else S.details = details;

      /* Saved: the new files are now the stored ones */
      if (EP.photo.objectUrl) URL.revokeObjectURL(EP.photo.objectUrl);
      EP.photo.url = avatarUrl || ''; EP.photo.file = null; EP.photo.objectUrl = ''; EP.photo.removed = false;
      S.existing = Object.assign({}, ex, { photo_url: avatarUrl, available: $('epAvailable').checked });
      if (!extraFailed) EP.clean();
      EP.repaintPhoto();

      EP.refreshNav(name, avatarUrl);
      if (extraFailed) {
        EP.say('Core details saved, but the extra profile details could not be stored yet. The database needs the profile_details update (docs/profile-details-migration.sql).', 'error');
      } else {
        EP.say('Profile updated successfully.', 'ok');
        EP.toast('Your profile has been saved!');
      }
    } catch (err) {
      console.error('[edit-profile-tasker] save failed:', err);
      EP.say('Save failed: ' + (err && err.message ? err.message : 'please try again.'), 'error');
    } finally {
      EP.busy(false);
    }
  }

  /* ── boot ────────────────────────────────────────────────── */
  function syncEmergency() { $('epEmergencyWrap').hidden = !$('epEmergency').checked; }

  var paintBio = function () {};

  function boot() {
    paintBio = EP.bindCounter('epBio', 'epBioCount', BIO_MAX);
    EP.initPhoto({ getName: function () { return EP.val('epName'); }, onChange: strength });
    var onList = function () { strength(); };
    areas = EP.chips({ host: $('epAreas'), max: 12, placeholder: 'Add an area, e.g. Ikoyi', onChange: onList });
    offers = EP.repeater({ host: $('epOffers'), addBtn: $('epOfferAdd'), max: 4, noun: 'Highlight', onChange: onList, fields: [
      { key: 'title', label: 'Title', placeholder: 'e.g. Itemized Digital Invoices', maxlength: 40 },
      { key: 'description', label: 'Short description', placeholder: 'e.g. Direct transparency on materials', maxlength: 80 } ] });
    services = EP.repeater({ host: $('epServices'), addBtn: $('epServiceAdd'), max: 8, noun: 'Service', onChange: onList, fields: [
      { key: 'title', label: 'Service name', placeholder: 'e.g. Inverter & Solar Backup Installation', maxlength: 60 },
      { key: 'description', label: 'Description', type: 'textarea', placeholder: 'What is included?', maxlength: 160 },
      { key: 'price', label: 'Starting price (\u20A6)', type: 'number', prefix: '\u20A6', placeholder: '45,000', half: true },
      { key: 'price_note', label: 'Price note', placeholder: 'e.g. Labour estimate, Per unit, Flat fee', maxlength: 30, half: true } ] });
    certs = EP.repeater({ host: $('epCerts'), addBtn: $('epCertAdd'), max: 6, noun: 'Credential', onChange: onList, fields: [
      { key: 'title', label: 'Credential', placeholder: 'e.g. COREN Registered & NATE Certified', maxlength: 70 },
      { key: 'detail', label: 'Issuer and year', placeholder: 'e.g. Council for the Regulation of Engineering in Nigeria', maxlength: 100 } ] });
    $('epEmergency').addEventListener('change', syncEmergency);
    wirePortfolio();

    $('epForm').addEventListener('submit', save);
    $('epForm').addEventListener('input', function (ev) {
      if (ev.target.type === 'file') return;
      EP.dirty(); strength(); paintHero();
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

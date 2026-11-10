/* ============================================================
   STREETTASKER — edit-profile-tasker.js
   Tasker "Edit Profile" page (edit-profile-tasker.html).
   Loads and saves the TASKER profile only. A person with both a tasker and a customer account keeps two
   separate profiles: this page never reads or writes the customer's users.bio / avatar_url / location /
   business_name, so nothing carries over from one account to the other.
     taskers -> name, business_name, location, service, service_name, category,
                rate_value, rate_unit, bio, photo_url, available
                (banner_color / banner_img are no longer edited here; saved values are left untouched)
   plus everything the public profile shows that a tasker has to provide, stored in
   taskers.profile_details (jsonb, see docs/profile-details-migration.sql):
   headline, experience, pricing style, next opening, coverage, offers (max 4),
   portfolio, certifications, emergency callouts.
   Live profile-strength ring, track record (rating, jobs, earnings), verification status.
   ============================================================ */
(function () {
  'use strict';

  var $ = EP.$;
  var FEE_RATE = 0.12; /* same platform fee the Overview uses (js/tasker-overview.js) */
  var BIO_MAX = 1000;
  var PORTFOLIO_FEED_MAX = 12; /* only for the one-time import of old feed posts below; NOT the plan limit */
  var portfolioMax = 12;       /* until the server answers; the real limit is the plan's (get_my_entitlements features.portfolio_max) and the database enforces it */
  var offers, certs, areas;
  var HIGHLIGHT_MAX = 4;       /* "What You Offer" highlights: never more than 4 */

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
      { label: 'Headline & experience',    pct: 12, done: !!(EP.val('epHeadline') && EP.val('epYears')) },
      { label: 'Service & rate',           pct: 12, done: !!(EP.val('epService') && rate > 0) },
      { label: 'Location & coverage',      pct: 12, done: !!(EP.val('epLocation') && areas && areas.get().length) },
      { label: 'About you',                pct: 12, done: !!EP.val('epBio') },
      { label: 'Work portfolio',           pct: 14, done: S.portfolio.length > 0 },
      { label: 'Certifications',           pct: 10, done: !!(certs && certs.count()) },
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
    if (canAddPhoto()) {
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'ep-work-add';
      add.innerHTML = '<span class="ep-work-plus"><svg class="ap-i" aria-hidden="true"><use href="#i-plus"/></svg></span><span>Upload Media</span>';
      add.addEventListener('click', openWorkDialog);
      host.appendChild(add);
    }
    $('epWorkAddTop').hidden = !canAddPhoto();
    paintLimit();
    strength();
  }

  /* S4k: the plan's photo limit. The number comes from the server; nothing here knows a plan or a figure. */
  function canAddPhoto() { return S.portfolio.length < portfolioMax; }
  function paintLimit() {
    var p = $('epWorkLimit');
    if (!p) return;
    p.textContent = '';
    var n = S.portfolio.length;
    if (n > portfolioMax) p.appendChild(document.createTextNode('You have ' + n + ' photos, more than your current plan allows (' + portfolioMax + '). They all stay on your profile. To add another, remove some or choose a bigger plan. '));
    else p.appendChild(document.createTextNode(n + ' of ' + portfolioMax + ' photos used. ' + (n >= portfolioMax ? 'You have reached your plan\u2019s limit. ' : '')));
    if (n >= portfolioMax) { var a = document.createElement('a'); a.href = 'subscription.html'; a.textContent = 'See plans'; p.appendChild(a); }
    p.hidden = false;
  }
  async function loadLimit() {
    try {
      var r = await window.supabase.rpc('get_my_entitlements');
      var v = r && !r.error && r.data && r.data.features ? Number(r.data.features.portfolio_max) : NaN;
      if (isFinite(v) && v >= 0) portfolioMax = Math.floor(v);
    } catch (e) { /* keep the fallback; the database still enforces the real limit on save */ }
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
      if (!canAddPhoto()) { err.textContent = 'You have reached your plan\u2019s photo limit.'; err.hidden = false; return; }
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

    /* Tasker details come from the taskers row only. The sign-up name is the one thing offered as a starting point. */
    $('epName').value     = td.name || ud.name || (user.user_metadata && user.user_metadata.name) || '';
    $('epBusiness').value = td.business_name || '';
    $('epService').value  = td.service || td.service_name || '';
    $('epRate').value     = td.rate_value || '';
    if (td.rate_unit) $('epRateUnit').value = td.rate_unit;
    $('epLocation').value = td.location || '';
    $('epBio').value      = td.bio || '';

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
    offers.set((Array.isArray(d.offers) ? d.offers : []).slice(0, HIGHLIGHT_MAX));
    certs.set(d.certifications);
    $('epEmergency').checked = !!(d.emergency && d.emergency.enabled);
    $('epEmergencyText').value = (d.emergency && d.emergency.text) || '';
    syncEmergency();
    if (Array.isArray(d.portfolio)) {
      S.portfolio = d.portfolio.filter(function (x) { return x && x.image_url; });
    } else {
      /* first time on this page: bring over work photos already posted */
      var posts = (await safe(window.supabase.from('feed_posts').select('image_url,image,caption,content')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(PORTFOLIO_FEED_MAX))) || [];
      S.portfolio = posts.filter(function (x) { return x.image_url || x.image; }).map(function (x) {
        return { image_url: x.image_url || x.image, title: x.caption || x.content || '', location: '', description: '' };
      });
    }
    EP.photo.url = td.photo_url || '';
    var r = parseFloat(td.rating);
    S.rating = isFinite(r) && r > 0 ? r : null;
    var rc = parseInt(td.review_count, 10);
    S.reviews = isFinite(rc) && rc > 0 ? rc : null;

    EP.repaintPhoto();
    paintVerify(res[2]);
    $('epViewPublic').href = 'tasker-profile.html?id=' + encodeURIComponent(user.id);
    /* Download Flyer: opens your public page in a new tab with the flyer window already open (the form here stays as it is) */
    $('epHeroFlyer').href = 'tasker-profile.html?id=' + encodeURIComponent(user.id) + '&flyer=1';
    if (new URLSearchParams(location.search).get('from') === 'onboarding') $('epWelcome').hidden = false;

    paintBio();
    strength();
    await loadLimit();
    if (S.portfolio.length > portfolioMax && !Array.isArray(d.portfolio)) S.portfolio = S.portfolio.slice(0, portfolioMax); /* imported feed photos only fill free slots */
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
    var extraFailed = false, limitMsg = '', extraErr = null;
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

      /* The tasker profile lives in the taskers row only. The customer profile (users.bio, avatar_url, location,
         business_name) is a different profile and is not touched here. */

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
        offers:          offers.get().slice(0, HIGHLIGHT_MAX),
        portfolio:       S.portfolio,
        certifications:  certs.get().map(function (c) {
          /* a verification link must be a web address; anything else is dropped */
          var u = c.cred_url ? (/^https?:\/\//i.test(c.cred_url) ? c.cred_url : 'https://' + c.cred_url) : '';
          c.cred_url = /^https?:\/\/[^\s]+\.[^\s]+$/i.test(u) ? u : '';
          return c;
        }),
        emergency:       { enabled: $('epEmergency').checked, text: EP.val('epEmergencyText') }
      });
      delete details.services;   /* the old "Core services & estimates" list was removed: listings are promoted from My Services */
      var x = await window.supabase.from('taskers').update({ profile_details: details }).eq('user_id', String(uid));
      var limitHit = x.error && /portfolio_limit:(\d+)/.exec(String(x.error.message || ''));
      if (limitHit) { portfolioMax = parseInt(limitHit[1], 10); limitMsg = 'Core details saved, but your plan allows ' + portfolioMax + ' portfolio photos, so the extra details were not saved. Remove some photos, or choose a bigger plan, then save again.'; renderPortfolio(); }
      else if (x.error) {
        extraFailed = true; extraErr = x.error;
        console.error('[edit-profile-tasker] profile_details not saved:', x.error);
      }
      else S.details = details;

      /* Saved: the new files are now the stored ones */
      if (EP.photo.objectUrl) URL.revokeObjectURL(EP.photo.objectUrl);
      EP.photo.url = avatarUrl || ''; EP.photo.file = null; EP.photo.objectUrl = ''; EP.photo.removed = false;
      S.existing = Object.assign({}, ex, { photo_url: avatarUrl, available: $('epAvailable').checked });
      if (!extraFailed && !limitMsg) EP.clean();
      EP.repaintPhoto();

      EP.refreshNav(name, avatarUrl);
      if (limitMsg) {
        EP.say(limitMsg, 'error');
      } else if (extraFailed) {
        /* Say what really went wrong. Only a missing column means the database update is needed. */
        var missingCol = extraErr && (extraErr.code === '42703' || extraErr.code === 'PGRST204' || /profile_details/i.test(String(extraErr.message || '')) && /column|schema cache/i.test(String(extraErr.message || '')));
        EP.say(missingCol
          ? 'Your main details are saved, but the extra profile details (headline, highlights, credentials, coverage) could not be stored because the database is missing the profile_details column. Please report this error so we can fix it.'
          : 'Your main details are saved, but the extra profile details (headline, highlights, credentials, coverage) could not be saved this time. Please try again, and if it keeps happening, report this error so we can fix it.',
          'error', EP.errText(extraErr));
      } else {
        EP.say('Profile updated successfully.', 'ok');
        EP.toast('Your profile has been saved!');
      }
    } catch (err) {
      console.error('[edit-profile-tasker] save failed:', err);
      EP.say('Save failed: ' + (err && err.message ? err.message : 'please try again.'), 'error', EP.errText(err));
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
    offers = EP.repeater({ host: $('epOffers'), addBtn: $('epOfferAdd'), max: HIGHLIGHT_MAX, noun: 'Highlight', onChange: onList, fields: [
      { key: 'title', label: 'Title', placeholder: 'e.g. Itemized Digital Invoices', maxlength: 40 },
      { key: 'description', label: 'Short description', placeholder: 'e.g. Direct transparency on materials', maxlength: 80 } ] });
    certs = EP.repeater({ host: $('epCerts'), addBtn: $('epCertAdd'), max: 6, noun: 'Credential', onChange: onList, fields: [
      { key: 'title', label: 'Credential', placeholder: 'e.g. COREN Registered Engineer', maxlength: 70 },
      { key: 'detail', label: 'Issuer and year', placeholder: 'e.g. Council for the Regulation of Engineering in Nigeria, 2021', maxlength: 100 },
      { key: 'cred_id', label: 'Credential ID / licence number', placeholder: 'The number or ID customers can check, e.g. R.12345', maxlength: 40, half: true },
      { key: 'cred_url', label: 'Where to check it online (optional)', placeholder: 'e.g. https://registry.example.org/verify', maxlength: 200, half: true } ] });
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

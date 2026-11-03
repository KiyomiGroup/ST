/* ============================================================
   STREETTASKER — tasker-profile.js
   Public Tasker Profile (tasker-profile.html?id=<auth user id>, or ?demo=<id> for sample providers).

   Reads:  taskers.*  (incl. profile_details jsonb written by edit-profile-tasker.js),
           users(name, bio, business_name, avatar_url, location), verifications, feed_posts,
           bookings (completed count + repeat clients), reviews (only if the table exists).
   Keeps:  booking request, request quote / message, application decision bar (?task=&app=),
           owner view (Edit My Page), demo providers.
   Every section hides itself when its data is empty. All user text is escaped.
   Needs:  supabaseClient.js, sanitize.js (escapeHtml), auth.js, ui.js (showToast), tasker-profile-demo.js.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return escapeHtml(s); };
  var NAIRA = '\u20a6';

  var state = { id: null, tasker: null, model: null, user: null, isOwner: false, demo: null, portfolio: [] };

  /* ── small helpers ───────────────────────────────────────── */
  function icon(name) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function money(n) { var v = Number(n); return isFinite(v) && v > 0 ? NAIRA + v.toLocaleString('en-NG') : ''; }
  function parseDetails(raw) {
    if (!raw) return {};
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return {}; } }
    return (raw && typeof raw === 'object') ? raw : {};
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'T';
  }
  function timeAgo(iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' });
  }
  function show(id) { var el = $(id); if (el) el.hidden = false; }
  function hide(id) { var el = $(id); if (el) el.hidden = true; }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function paras(s) { return text(s).split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean); }

  /* ── model: one shape for real and demo providers ────────── */
  function buildModel(src) {
    var m = {
      name: src.name, first: src.first, service: src.service, headline: src.headline, location: src.location, photo: src.photo,
      verified: !!src.verified, pending: !!src.pending,
      rating: Number(src.rating) || 0, reviewCount: Number(src.reviewCount) || 0,
      completed: src.completed == null ? null : Number(src.completed), repeatPct: src.repeatPct == null ? null : src.repeatPct,
      years: Number(src.years) > 0 ? Math.round(Number(src.years)) : 0, expNote: text(src.expNote),
      rateValue: Number(src.rateValue) || 0, rateUnit: text(src.rateUnit) || '/hour', priceNote: text(src.priceNote),
      available: src.available !== false, nextOpening: text(src.nextOpening),
      bio: text(src.bio), offers: [], services: [], portfolio: [], certs: [],
      radius: Number(src.radius) || 0, areas: [], emergency: { enabled: false, text: '' }, isDemo: !!src.isDemo, isLocal: !!src.isLocal
    };
    m.offers = list(src.offers).filter(function (o) { return o && text(o.title); });
    m.services = list(src.services).filter(function (o) { return o && text(o.title); });
    m.portfolio = list(src.portfolio).filter(function (o) { return o && text(o.image_url); });
    m.certs = list(src.certs).filter(function (o) { return o && text(o.title); });
    m.areas = list(src.areas).map(text).filter(Boolean);
    if (src.emergency && src.emergency.enabled) m.emergency = { enabled: true, text: text(src.emergency.text) };
    return m;
  }

  /* ── rendering ───────────────────────────────────────────── */
  function paintAvatar(m) {
    var el = $('tpAvatar'); el.textContent = '';
    if (m.photo) {
      var img = document.createElement('img');
      img.alt = ''; img.src = m.photo;
      img.addEventListener('error', function () { el.textContent = initials(m.name); });
      el.appendChild(img);
    } else { el.textContent = initials(m.name); }
  }

  function renderHero(m) {
    document.title = m.name + ' \u2014 StreetTasker';
    paintAvatar(m);
    setText('tpName', m.name);
    $('tpTick').hidden = !m.verified;

    var tag = $('tpTag');
    var tagText = m.verified ? 'Verified Tasker Pro' : (m.pending ? 'Verification Pending' : '');
    tag.textContent = tagText; tag.hidden = !tagText;

    setText('tpLoc', m.location); $('tpLocWrap').hidden = !m.location;

    var hl = $('tpHeadline'), headline = m.headline || m.service;
    hl.textContent = headline; hl.hidden = !headline;

    var bits = [];
    if (m.rating > 0) {
      bits.push('<span class="tp-rl-item tp-rl-star">' + icon('star') + '<strong>' + esc(m.rating.toFixed(1)) + '</strong>' +
        (m.reviewCount ? ' (' + esc(m.reviewCount) + ' review' + (m.reviewCount === 1 ? '' : 's') + ')' : '') + '</span>');
    } else {
      bits.push('<span class="tp-rl-item">New on StreetTasker</span>');
    }
    if (m.completed > 0) bits.push('<span class="tp-rl-item">' + icon('check') + esc(m.completed) + ' completed task' + (m.completed === 1 ? '' : 's') + '</span>');
    $('tpRatingLine').innerHTML = bits.join('<span class="tp-rl-dot" aria-hidden="true"></span>');

    /* Trust chips: only what the data supports. Background Checked / Shield Backed are not shown (no data yet). */
    var chips = [];
    /* Local Tasker labels (stage 4C-2): shown only when the database says this person is a published Local Tasker. */
    if (m.isLocal) { chips.push(['user', (window.STLocal && STLocal.LABEL) || 'Local Tasker']); chips.push(['chat', (window.STLocal && STLocal.LABEL_PHONE) || 'Phone Assisted']); }
    if (m.verified) chips.push(['id', 'Govt ID Verified']);
    if (m.certs.length) chips.push(['award', 'Credentials Listed']);
    chips.push(['shield', 'Escrow Protected']);
    $('tpTrust').innerHTML = chips.map(function (c) { return '<span class="pp-hero-chip tp-chip">' + icon(c[0]) + esc(c[1]) + '</span>'; }).join('');
  }

  function renderStats(m) {
    var s = [];
    if (m.rating > 0) s.push(['Rating', esc(m.rating.toFixed(1)) + ' ' + icon('star'), m.reviewCount ? m.reviewCount + ' review' + (m.reviewCount === 1 ? '' : 's') : 'Client rating']);
    else s.push(['Rating', 'New', 'No reviews yet']);
    if (m.completed != null) s.push(['Completed tasks', esc(m.completed), 'On StreetTasker']);
    if (m.repeatPct != null) s.push(['Repeat clients', esc(m.repeatPct) + '%', 'Clients who booked again']);
    if (m.years) s.push(['Experience', esc(m.years) + '+ Years', m.expNote || 'In the trade']);
    $('tpStats').innerHTML = s.map(function (x) {
      return '<div class="pp-stat"><span class="pp-stat-label">' + esc(x[0]) + '</span><span class="pp-stat-value">' + x[1] +
        '</span><span class="pp-stat-note">' + esc(x[2]) + '</span></div>';
    }).join('');
  }

  function renderAbout(m) {
    var ps = paras(m.bio);
    $('tpBio').innerHTML = ps.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    $('tpOffers').innerHTML = m.offers.map(function (o) {
      return '<div class="tp-offer"><span class="tp-offer-icon">' + icon('check') + '</span><div><strong>' + esc(o.title) + '</strong>' +
        (text(o.description) ? '<span>' + esc(o.description) + '</span>' : '') + '</div></div>';
    }).join('');
    setText('tpFirst', m.first);
    $('secAbout').hidden = !(ps.length || m.offers.length);
  }

  function renderServices(m) {
    $('tpServices').innerHTML = m.services.map(function (x) {
      var price = money(x.price);
      return '<div class="tp-service"><span class="tp-service-icon">' + icon('briefcase') + '</span>' +
        '<div class="tp-service-body"><strong>' + esc(x.title) + '</strong>' + (text(x.description) ? '<p>' + esc(x.description) + '</p>' : '') + '</div>' +
        (price ? '<div class="tp-service-price"><span><small>from</small> ' + esc(price) + '</span>' + (text(x.price_note) ? '<em>' + esc(x.price_note) + '</em>' : '') + '</div>' : '') +
        '</div>';
    }).join('');
    $('secServices').hidden = !m.services.length;
  }

  function renderPortfolio(items) {
    state.portfolio = items;
    $('tpPortfolio').innerHTML = items.map(function (p, i) {
      return '<button type="button" class="tp-work" data-i="' + i + '">' +
        '<span class="tp-work-img"><img src="' + esc(p.image_url) + '" alt="' + esc(p.title || 'Completed project') + '" loading="lazy" />' +
        (text(p.location) ? '<span class="tp-work-loc">' + esc(p.location) + '</span>' : '') + '</span>' +
        '<span class="tp-work-body">' + (text(p.title) ? '<strong>' + esc(p.title) + '</strong>' : '') +
        (text(p.description) ? '<span>' + esc(p.description) + '</span>' : '') + '</span></button>';
    }).join('');
    setText('tpPortfolioCount', items.length + ' photo' + (items.length === 1 ? '' : 's'));
    $('secPortfolio').hidden = !items.length;
  }

  function renderCerts(m) {
    $('tpCerts').innerHTML = m.certs.map(function (c) {
      return '<div class="tp-cert"><span class="tp-cert-icon">' + icon('award') + '</span><div><strong>' + esc(c.title) + '</strong>' +
        (text(c.detail) ? '<span>' + esc(c.detail) + '</span>' : '') + '</div></div>';
    }).join('');
    $('secCerts').hidden = !m.certs.length;
  }

  function stars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<span class="tp-star' + (i <= Math.round(n) ? ' is-on' : '') + '">' + icon('star') + '</span>';
    return '<span class="tp-stars" role="img" aria-label="' + esc(n) + ' out of 5">' + out + '</span>';
  }

  function renderReviews(m, reviews) {
    if (!reviews.length) { $('secReviews').hidden = true; return; }
    setText('tpReviewsSub', 'Based on ' + (m.reviewCount || reviews.length) + ' confirmed escrow assignment' + ((m.reviewCount || reviews.length) === 1 ? '' : 's'));
    $('tpScore').innerHTML = m.rating > 0 ? '<span class="tp-score-n">' + esc(m.rating.toFixed(1)) + '</span>' + stars(m.rating) : '';
    $('tpReviews').innerHTML = reviews.map(function (r) {
      return '<article class="tp-review"><div class="tp-review-top"><span class="tp-review-av">' + esc(initials(r.name)) + '</span>' +
        '<div class="tp-review-who"><strong>' + esc(r.name || 'StreetTasker client') + '</strong>' + (r.rating ? stars(r.rating) : '') + '</div>' +
        '<span class="tp-review-when">' + esc(timeAgo(r.date)) + '</span></div>' +
        '<p class="tp-review-text">' + esc(r.text) + '</p><span class="tp-verified">' + icon('check') + 'Verified Task Booking</span></article>';
    }).join('');
    $('secReviews').hidden = false;
    buildTabs(); syncEmpty();
  }

  function renderSide(m) {
    var rate = money(m.rateValue);
    var unit = m.rateUnit.replace(/^\//, '');
    $('tpRate').innerHTML = rate ? esc(rate) + ' <small>/ ' + esc(unit) + '</small>' : 'Contact for price';
    var pn = $('tpPriceNote'); pn.textContent = m.priceNote; pn.hidden = !m.priceNote;

    $('tpAvail').classList.toggle('is-off', !m.available);
    setText('tpAvailTitle', m.available ? 'Available for bookings' : 'Currently unavailable');
    var an = $('tpAvailNote'); an.textContent = m.nextOpening ? 'Next opening: ' + m.nextOpening : ''; an.hidden = !m.nextOpening;

    var hasCover = m.radius || m.areas.length;
    setText('tpRadius', m.radius ? m.radius + 'km radius' : '');
    $('tpRadius').hidden = !m.radius;
    var base = $('tpBase'); setText('tpBaseText', m.location ? 'Operating base: ' + m.location : ''); base.hidden = !m.location;
    $('tpAreas').innerHTML = m.areas.map(function (a) { return '<span class="tp-area">' + esc(a) + '</span>'; }).join('');
    $('secCoverage').hidden = !(hasCover);

    var call = m.emergency.enabled && !state.isOwner;
    $('secCallout').hidden = !call;
    if (call) {
      setText('tpCalloutEyebrow', 'Have an urgent ' + (m.service ? m.service.toLowerCase() : 'service') + ' need?');
      setText('tpCalloutText', m.emergency.text || 'Direct dispatch for urgent jobs. Send a callout request and ' + m.first + ' will respond as soon as possible.');
    }
  }

  function renderActions(m) {
    var label, rateShort = money(m.rateValue) ? ' (' + money(m.rateValue) + m.rateUnit.replace(/^\/hour$/, '/hr') + ')' : '';
    if (state.isOwner) {
      label = 'Edit My Page';
      $('tpQuote').hidden = true;
      setText('tpEscrowText', 'This is how customers see your page. Payments are held in escrow until the customer approves the completed task.');
    } else {
      label = 'Book ' + m.first;
    }
    setText('tpBookLabel', label);
    $('tpBarBook').textContent = state.isOwner ? 'Edit My Page' : label + rateShort;
    $('tpBarMsg').hidden = state.isOwner;
    $('tpActionbar').hidden = false;
  }

  /* A profile with nothing filled in yet still gets a sensible body instead of an empty column */
  function syncEmpty() {
    var any = ['secAbout', 'secServices', 'secPortfolio', 'secCerts', 'secReviews'].some(function (id) { return !$(id).hidden; });
    var m = state.model;
    $('secEmpty').hidden = any;
    if (any || !m) return;
    setText('tpEmptyTitle', state.isOwner ? 'Your page is almost empty' : m.first + ' is still setting up');
    setText('tpEmptyText', state.isOwner
      ? 'Add your bio, services, portfolio and credentials so customers can trust and book you.'
      : 'This tasker has not added profile details yet. You can still send a booking request or ask for a quote.');
    $('tpEmptyCta').hidden = !state.isOwner;
  }

  function buildTabs() {
    var defs = [['secAbout', 'About'], ['secServices', 'Services & Rates'], ['secPortfolio', 'Portfolio'], ['secCerts', 'Credentials'], ['secReviews', 'Reviews']];
    var items = defs.filter(function (d) { return $(d[0]) && !$(d[0]).hidden; });
    var nav = $('tpTabs');
    $('tpTabsWrap').hidden = items.length < 2;
    nav.innerHTML = items.map(function (d, i) {
      return '<a href="#' + d[0] + '" class="tp-tab"' + (i === 0 ? ' aria-current="true"' : '') + '>' + esc(d[1]) + '</a>';
    }).join('');
  }

  function renderAll(m) {
    state.model = m;
    renderHero(m); renderStats(m); renderAbout(m); renderServices(m); renderPortfolio(m.portfolio);
    renderCerts(m); renderSide(m); renderActions(m);
    renderLocalNote(m);
    $('secReviews').hidden = true;
    buildTabs(); syncEmpty();
    $('tpLoading').hidden = true;
    $('tpContent').hidden = false;
  }

  /* Inclusive-economy note for a Local Tasker (text only: no fee, donation or percentage is stated). */
  function renderLocalNote(m) {
    var sec = $('secLocal');
    if (!sec) return;
    sec.hidden = !m.isLocal;
    if (m.isLocal) setText('tpLocalNote', (window.STLocal && STLocal.NOTE) || '');
  }

  function fail() { $('tpLoading').hidden = true; $('tpError').hidden = false; }

  /* ── data: real providers ────────────────────────────────── */
  async function loadReal(id) {
    var sb = window.supabase;
    /* Public page: name the columns. phone and whatsapp are private, so select('*') would fail when logged out. */
    var PUBLIC_COLS = 'id, user_id, services, rating, location, subscription_status, created_at, available, service_name, category, price, description, photo, bio, photo_url, rate, free_limit, subscription_plan, rate_value, service, rate_unit, business_name, is_verified, verified_at, business_lat, business_lon, business_address, banner_color, banner_img, name, specialties, availability_status, verified, profile_details';
    var t1 = await sb.from('taskers').select(PUBLIC_COLS).eq('user_id', String(id)).maybeSingle();
    var tasker = t1.data;
    if (!tasker) { var t2 = await sb.from('taskers').select(PUBLIC_COLS).eq('id', String(id)).maybeSingle(); tasker = t2.data; }

    var u = await sb.from('users').select('name, bio, business_name, avatar_url, location').eq('id', id).maybeSingle();
    var userRow = u.data;

    if (!tasker && userRow) {
      tasker = { user_id: id, name: userRow.name || userRow.business_name || 'Service Provider', bio: userRow.bio || '', location: userRow.location || '', available: true };
    }
    if (!tasker) return fail();
    state.tasker = tasker;

    /* Local Tasker (stage 4C-2): asked of the database, never read from a column. Failure = normal profile. */
    var isLocal = false, localPhotos = [], localCover = null;
    try {
      if (window.STLocal) {
        await STLocal.load([String(id)]);
        isLocal = STLocal.isLocal(id);
        if (isLocal) { localPhotos = await STLocal.photos(id); localCover = STLocal.coverUrl(id); }
      }
    } catch (_l) { isLocal = false; }

    var results = await Promise.all([
      sb.from('verifications').select('status, business_name, business_address').eq('user_id', id).maybeSingle(),
      sb.from('feed_posts').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(24),
      sb.from('bookings').select('customer_id, status').eq('tasker_id', id).limit(1000)
    ]);
    var verification = results[0].data, posts = results[1].data, bookings = results[2].data;
    var d = parseDetails(tasker.profile_details);

    var name = (verification && verification.business_name) || tasker.business_name || (userRow && userRow.business_name) || (userRow && userRow.name) || tasker.name || 'Service Provider';
    var person = (userRow && userRow.name) || tasker.name || name;
    var verified = !!(tasker.is_verified || (verification && verification.status === 'approved'));

    var completed = null, repeatPct = null;
    if (bookings) {
      var done = bookings.filter(function (b) { return b.status === 'completed'; });
      completed = done.length;
      var per = {};
      done.forEach(function (b) { if (b.customer_id) per[b.customer_id] = (per[b.customer_id] || 0) + 1; });
      var clients = Object.keys(per);
      if (clients.length >= 3) repeatPct = Math.round(clients.filter(function (k) { return per[k] > 1; }).length / clients.length * 100);
    }

    /* Portfolio: the saved list wins (even when empty). Only a profile that never saved one falls back to feed posts. */
    var portfolio = list(d.portfolio);
    if (!Array.isArray(d.portfolio) && posts && posts.length) {
      portfolio = posts.map(function (p) {
        var cap = text(p.content || p.caption);
        return { image_url: p.image_url || p.image, title: cap.slice(0, 80), description: cap.length > 80 ? cap : '', location: '' };
      });
    }

    if (isLocal) {
      /* The portfolio of a Local Tasker is the coordinator's photo set, shown through signed links. Feed posts are not used. */
      portfolio = localPhotos.map(function (p) { return { image_url: p.url, title: p.caption, description: '', location: '' }; });
    }

    var cov = (d.coverage && typeof d.coverage === 'object') ? d.coverage : {};
    var model = buildModel({
      name: name, first: String(person).trim().split(/\s+/)[0] || name,
      service: tasker.service || tasker.service_name || '', headline: d.headline,
      location: tasker.business_address || tasker.location || (userRow && userRow.location) || '',
      photo: isLocal ? localCover : (tasker.photo_url || tasker.photo || (userRow && userRow.avatar_url) || null), isLocal: isLocal,
      verified: verified, pending: !verified && !!(verification && verification.status === 'pending'),
      rating: tasker.rating, reviewCount: tasker.review_count, completed: completed, repeatPct: repeatPct,
      years: d.years_experience, expNote: d.experience_note,
      rateValue: tasker.rate_value, rateUnit: tasker.rate_unit, priceNote: d.price_note,
      available: tasker.available, nextOpening: d.next_opening,
      bio: (userRow && userRow.bio) || tasker.bio || '',
      offers: d.offers, services: d.services, portfolio: portfolio, certs: d.certifications,
      radius: cov.radius_km, areas: cov.areas, emergency: d.emergency
    });

    renderAll(model);
    loadReviews(id, model);
    loadDecisionBar();
  }

  /* Reviews: shown only when a reviews table exists and has rows for this tasker. Nothing is invented. */
  async function loadReviews(id, model) {
    try {
      var r = await window.supabase.from('reviews').select('*').eq('reviewee_id', id).order('created_at', { ascending: false }).limit(20);
      if (r.error || !r.data || !r.data.length) return;
      var ids = r.data.map(function (x) { return x.reviewer_id; }).filter(Boolean);
      var names = {};
      if (ids.length) {
        var us = await window.supabase.from('users').select('id, name').in('id', ids);
        (us.data || []).forEach(function (x) { names[x.id] = x.name; });
      }
      var rows = r.data.map(function (x) {
        return { name: x.reviewer_name || names[x.reviewer_id] || '', rating: Number(x.rating) || 0, text: text(x.comment || x.review || x.text), date: x.created_at };
      }).filter(function (x) { return x.text; });
      renderReviews(model, rows);
    } catch (e) { /* no reviews table yet: section stays hidden */ }
  }

  /* ── data: demo providers (?demo=d1) ─────────────────────── */
  function loadDemo(demoId) {
    var svc = (window.TP_DEMO || []).filter(function (s) { return s.id === demoId; })[0];
    if (!svc) return fail();
    state.demo = svc;
    renderAll(buildModel({
      name: svc.provider_name, first: svc.provider_name.split(' ')[0], service: svc.service_name, headline: svc.service_name,
      location: svc.location, verified: true, rating: svc.rating, reviewCount: svc.reviews,
      rateValue: svc.price, rateUnit: svc.rate_unit || '/job', available: true, bio: svc.description, isDemo: true
    }));
  }

  /* ── dialogs ─────────────────────────────────────────────── */
  function openDialog(dlg) { if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', ''); }
  function closeDialog(dlg) { if (dlg.open) dlg.close(); }

  function openLightbox(i) {
    var p = state.portfolio[i]; if (!p) return;
    var img = $('tpLightboxImg');
    img.src = p.image_url; img.alt = p.title || 'Completed project'; img.hidden = false;
    setText('tpLightboxTitle', p.title || '');
    setText('tpLightboxText', p.description || '');
    setText('tpLightboxMeta', [p.location, p.time].filter(Boolean).join(' \u00b7 '));
    openDialog($('tpLightbox'));
  }

  async function currentUser() {
    if (state.user) return state.user;
    var s = await window.supabase.auth.getSession();
    state.user = s.data.session && s.data.session.user;
    return state.user;
  }
  function toLogin() { window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.href); }

  /* Booking pop-up limits (Stage 1) */
  var JOB_MIN = 5, JOB_MAX = 80, DESC_MIN = 10, DESC_MAX = 600, AREA_MIN = 3, AREA_MAX = 120, STREET_MAX = 160;
  /* Job photos (Stage 4): same rules and bucket as Post a Task and Make an Offer */
  var MAX_PHOTOS = 5, MAX_PHOTO_BYTES = 5 * 1024 * 1024, PHOTO_BUCKET = 'task-images';
  var PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  /* Until bookings has its own columns (Stage 5), the job details travel in notes:
     line 1 = title, then the description, then "Area: ...", "Address: ..." (only if given), "Urgency: ..." and
     "Photos: <url> <url>" (only if given).
     Plain text, so older pages still show it. */
  function buildNotes(tag, job, desc, area, street, urgency, photos) {
    return (tag + job + '\n' + desc + '\nArea: ' + area + (street ? '\nAddress: ' + street : '') + '\nUrgency: ' + urgency +
      (photos && photos.length ? '\nPhotos: ' + photos.join(' ') : '')).trim();
  }

  /* ── Job photos (Stage 4) ── */
  function bkPhotoError(msg) { var e = $('bkPhotoErr'); if (!e) return; e.textContent = msg; e.hidden = !msg; }
  function resetBkPhotos() {
    (state.bkPhotos || []).forEach(function (p) { if (p.objectUrl) URL.revokeObjectURL(p.objectUrl); });
    state.bkPhotos = [];
  }
  function renderBkPhotos() {
    var box = $('bkPhotos'); if (!box) return;
    box.textContent = '';
    state.bkPhotos.forEach(function (p, i) {
      var item = document.createElement('div'); item.className = 'tp-bk-thumb';
      var img = document.createElement('img'); img.src = p.objectUrl; img.alt = 'Job photo ' + (i + 1); item.appendChild(img);
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'tp-bk-thumb-remove';
      rm.setAttribute('aria-label', 'Remove photo ' + (i + 1)); rm.setAttribute('data-photo-remove', String(i)); rm.innerHTML = icon('close');
      item.appendChild(rm); box.appendChild(item);
    });
    if (state.bkPhotos.length < MAX_PHOTOS) {
      var add = document.createElement('button'); add.type = 'button'; add.className = 'tp-bk-add-photo'; add.setAttribute('data-photo-add', '1');
      add.innerHTML = icon('camera-plus') + '<span>Add Photo</span>';
      box.appendChild(add);
    }
    var c = $('bkPhotoCount'); if (c) c.textContent = state.bkPhotos.length ? state.bkPhotos.length + ' of ' + MAX_PHOTOS : 'Up to ' + MAX_PHOTOS;
  }
  function addBkFiles(files) {
    if (!files.length) return;
    var ok = files.filter(function (f) { return PHOTO_EXT[f.type]; }), msg = '';
    if (!ok.length) return bkPhotoError('Please choose image files (JPG, PNG or WebP only).');
    if (ok.length < files.length) msg = 'Only JPG, PNG and WebP photos can be added.';
    var small = ok.filter(function (f) { return f.size <= MAX_PHOTO_BYTES; });
    if (small.length < ok.length) msg = (ok.length - small.length) + ' photo(s) over 5 MB were skipped.';
    var room = MAX_PHOTOS - state.bkPhotos.length;
    if (small.length > room) msg = 'You can add up to ' + MAX_PHOTOS + ' photos.';
    small.slice(0, room).forEach(function (f) { state.bkPhotos.push({ file: f, objectUrl: URL.createObjectURL(f), url: null }); });
    bkPhotoError(msg); renderBkPhotos();
  }
  function removeBkPhoto(i) {
    var gone = state.bkPhotos.splice(i, 1)[0];
    if (gone && gone.objectUrl) URL.revokeObjectURL(gone.objectUrl);
    bkPhotoError(''); renderBkPhotos();
  }
  /* Uploads the photos not uploaded yet. Resolves true when every photo has a URL. */
  async function uploadBkPhotos() {
    var pending = state.bkPhotos.filter(function (p) { return p.file && !p.url; });
    if (!pending.length) return true;
    var failed = 0;
    try {
      var user = await currentUser(), sb = window.supabase;
      await Promise.all(pending.map(async function (p, i) {
        try {
          var name = 'tasks/' + user.id + '-booking-' + Date.now() + '-' + i + '.' + PHOTO_EXT[p.file.type];
          var up = await sb.storage.from(PHOTO_BUCKET).upload(name, p.file, { cacheControl: '3600', upsert: true });
          if (up.error) throw up.error;
          p.url = sb.storage.from(PHOTO_BUCKET).getPublicUrl(name).data.publicUrl;
        } catch (e) { failed++; console.warn('[booking] photo upload failed:', e && e.message); }
      }));
    } catch (e) { failed = pending.length; }
    if (failed) { bkPhotoError(failed === 1 ? 'One photo could not be uploaded. Remove it or try again.' : failed + ' photos could not be uploaded. Remove them or try again.'); return false; }
    bkPhotoError('');
    return true;
  }

  /* Price summary for the customer (Stage 3). Shows the tasker's rate and what to expect, never the platform fee.
     Only a per-job rate gives a total; hourly or daily rates depend on the time the job takes, so no total is guessed. */
  function priceSummary(mode, m) {
    var rate = money(m.rateValue), unit = String(m.rateUnit || '').replace(/^\//, '').toLowerCase();
    var rows, note;
    if (mode === 'quote' || !rate) {
      rows = '<div class="tp-bk-price-row"><span>Price</span><strong>' + (mode === 'quote' ? 'Quote after review' : 'To be agreed') + '</strong></div>';
      note = 'The tasker will price the job once they have seen your request. You only pay after you agree.';
    } else if (unit === 'job') {
      rows = '<div class="tp-bk-price-row tp-bk-price-total"><span>Estimated total</span><strong>' + esc(rate) + '</strong></div>';
      note = 'The final price is agreed in chat before you pay. You are not charged for sending a request.';
    } else {
      rows = '<div class="tp-bk-price-row"><span>Rate</span><strong>' + esc(rate + ' /' + unit) + '</strong></div>' +
             '<div class="tp-bk-price-row"><span>Total</span><strong>Depends on the time needed</strong></div>';
      note = 'The final price is agreed in chat before you pay. You are not charged for sending a request.';
    }
    return '<div class="tp-bk-price" aria-label="Price summary">' + rows +
      '<p class="tp-bk-price-note">' + icon('shield') + '<span>' + esc(note) + ' Your payment is held in escrow until you sign off the work.</span></p></div>';
  }

  /* The customer's saved location (users.location) pre-fills the Area field. Read once, kept on state. */
  async function savedLocation(user) {
    if (state.bkSavedLoc != null) return state.bkSavedLoc;
    var v = '';
    try {
      var r = await window.supabase.from('users').select('location').eq('id', user.id).maybeSingle();
      v = text(r && r.data && r.data.location);
    } catch (e) { /* optional: the field simply starts empty */ }
    state.bkSavedLoc = v;
    return v;
  }

  /* Only customer accounts can book. A tasker is offered a switch (or one-tap create) instead of the form. */
  async function blockIfTasker(user) {
    var A = window.ST && window.ST.auth;
    if (!A || !A.checkCustomerOnly) return false;
    var c = await A.checkCustomerOnly(user);
    if (c.ok) return false;
    $('tpBookBody').innerHTML =
      '<button type="button" class="tp-dialog-x" data-close aria-label="Close">' + icon('close') + '</button>' +
      '<div class="tp-dialog-done"><h2 class="tp-dialog-title" id="tpBookTitle">Customer account needed</h2>' +
      '<p class="tp-dialog-lead">Only customer accounts can book a service. ' + (c.hasCustomer ? 'You already have one, so just switch to it.' : 'You can create a customer account with the same email in one tap.') + '</p>' +
      '<p class="ap-error" id="bkSwitchErr" role="alert" hidden></p>' +
      '<button type="button" class="btn btn-primary tp-dialog-submit" data-role-switch="' + (c.hasCustomer ? 'switch' : 'create') + '">' + (c.hasCustomer ? 'Switch to customer account' : 'Create customer account') + '</button>' +
      '<button type="button" class="btn btn-ghost tp-dialog-submit" data-close>Not now</button></div>';
    openDialog($('tpBookDialog'));
    return true;
  }

  async function switchToCustomer(btn) {
    var A = window.ST.auth, err = $('bkSwitchErr');
    btn.disabled = true; err.hidden = true;
    try {
      if (btn.getAttribute('data-role-switch') === 'switch') await A.switchRole('customer'); else await A.addRole('customer');
      window.location.reload();
    } catch (e) {
      btn.disabled = false; err.textContent = (e && e.message) || 'Could not switch account. Please try again.'; err.hidden = false;
    }
  }

  /* mode: 'book' | 'quote' | 'callout' */
  async function openBooking(mode) {
    mode = mode || 'book';
    var user = await currentUser();
    if (!user) return toLogin();
    if (await blockIfTasker(user)) return;
    var m = state.model; if (!m) return;
    if (state.demo) return openDemoBooking();
    if (!state.id) return;

    var today = new Date().toISOString().split('T')[0];
    var svc = m.service || 'this service';
    var rate = money(m.rateValue);
    var title = mode === 'quote' ? 'Request a quote' : (mode === 'callout' ? 'Emergency callout' : 'Book ' + svc);
    var lead = mode === 'quote' ? 'Describe the job and ' + m.first + ' will reply with a quote.' : (mode === 'callout' ? 'Tell ' + m.first + ' what is wrong. Choose today if it is urgent.' : 'Fill in the details below and send your request.');
    var urgent = mode === 'callout';
    var savedLoc = await savedLocation(user);
    var jobLabel = mode === 'quote' ? 'What do you need a quote for? *' : 'What do you need done? *';
    var body = $('tpBookBody');
    state.bkUrgency = urgent ? 'urgent' : 'flexible';
    resetBkPhotos();
    body.innerHTML =
      '<button type="button" class="tp-dialog-x" data-close aria-label="Close">' + icon('close') + '</button>' +
      '<h2 class="tp-dialog-title" id="tpBookTitle">' + esc(title) + '</h2>' +
      '<p class="tp-dialog-lead">' + esc(lead) + '</p>' +
      '<div class="tp-dialog-sum"><span>' + esc(svc) + '</span><strong>' + esc(rate ? rate + ' ' + m.rateUnit : 'Price to be agreed') + '</strong></div>' +
      '<div class="form-group"><label class="form-label" for="bkJob">' + jobLabel + '</label>' +
        '<input type="text" id="bkJob" class="form-input" maxlength="' + JOB_MAX + '" autocomplete="off" placeholder="e.g. Fix a leaking kitchen tap" /></div>' +
      '<div class="form-group"><div class="tp-bk-row"><label class="form-label" for="bkNotes">Describe the job *</label><span class="tp-bk-count" id="bkCount" aria-live="polite">0 / ' + DESC_MAX + '</span></div>' +
        '<textarea id="bkNotes" class="form-textarea" rows="4" maxlength="' + DESC_MAX + '" placeholder="What needs doing, how big the job is, and anything the tasker should bring or know\u2026"></textarea></div>' +
      '<div class="form-group"><div class="tp-bk-row"><span class="form-label" id="bkPhotoLabel">Photos of the job <span class="tp-bk-tag">(optional)</span></span><span class="tp-bk-count" id="bkPhotoCount" aria-live="polite">Up to ' + MAX_PHOTOS + '</span></div>' +
        '<input type="file" id="bkPhotoFiles" class="tp-bk-file" accept="image/jpeg,image/png,image/webp" multiple aria-labelledby="bkPhotoLabel" />' +
        '<div class="tp-bk-photos" id="bkPhotos"></div>' +
        '<p class="tp-bk-help">JPG, PNG or WebP, up to 5 MB each. Photos help the tasker price the job.</p>' +
        '<p class="ap-error" id="bkPhotoErr" role="alert" hidden></p></div>' +
      '<div class="form-group"><label class="form-label" for="bkArea">Area / neighbourhood *</label>' +
        '<div class="tp-bk-loc"><input type="text" id="bkArea" class="form-input" maxlength="' + AREA_MAX + '" autocomplete="off" value="' + esc(savedLoc) + '" placeholder="e.g. Lekki Phase 1, Lagos" /><div id="bkAreaSuggestions" class="location-suggestions"></div></div></div>' +
      '<div class="form-group"><label class="form-label" for="bkStreet">Street address or landmark <span class="tp-bk-tag">(optional)</span></label>' +
        '<input type="text" id="bkStreet" class="form-input" maxlength="' + STREET_MAX + '" autocomplete="off" placeholder="e.g. 14 Allen Avenue, near the bus stop" />' +
        '<p class="tp-bk-help">Only the tasker you book can see this, and only after they accept.</p></div>' +
      '<div class="form-group"><span class="form-label" id="bkUrgLabel">How soon do you need it?</span>' +
        '<div class="tp-bk-opts" id="bkUrgency" role="radiogroup" aria-labelledby="bkUrgLabel">' +
          '<button type="button" class="tp-bk-opt" role="radio" aria-checked="' + (urgent ? 'false' : 'true') + '" data-urgency="flexible">' + icon('calendar') + '<strong>Flexible</strong><span>Any day that suits</span></button>' +
          '<button type="button" class="tp-bk-opt" role="radio" aria-checked="' + (urgent ? 'true' : 'false') + '" data-urgency="urgent">' + icon('bolt') + '<strong>Urgent</strong><span>As soon as possible</span></button>' +
        '</div></div>' +
      '<div class="form-group"><label class="form-label" for="bkDate">Preferred date *</label><input type="date" id="bkDate" class="form-input" min="' + today + '" value="' + (urgent ? today : '') + '" /></div>' +
      '<div class="form-group"><label class="form-label" for="bkTime">Preferred time</label><select id="bkTime" class="form-select">' +
        '<option value="">Choose a time\u2026</option><option>Morning (7am \u2013 12pm)</option><option>Afternoon (12pm \u2013 5pm)</option><option>Evening (5pm \u2013 9pm)</option><option' + (urgent ? ' selected' : '') + '>Flexible</option></select></div>' +
      priceSummary(mode, m) +
      '<p class="ap-error" id="bkErr" role="alert" hidden></p>' +
      '<button type="button" class="btn btn-primary tp-dialog-submit" id="bkSubmitBtn" data-mode="' + esc(mode) + '">' + (mode === 'quote' ? 'Send Quote Request' : (mode === 'callout' ? 'Send Callout Request' : 'Send Booking Request')) + '</button>' +
      '<p class="tp-dialog-foot">All communication stays on StreetTasker. No phone numbers shared.</p>';
    openDialog($('tpBookDialog'));
    renderBkPhotos();
    if (typeof window.initLocationInput === 'function') window.initLocationInput({ inputId: 'bkArea', dropdownId: 'bkAreaSuggestions', gps: true, mode: 'area' });
  }

  async function submitBooking(mode) {
    var user = await currentUser(); if (!user) return;
    var jobVal = text($('bkJob').value), areaVal = text($('bkArea').value), streetVal = text($('bkStreet').value), dateVal = text($('bkDate').value), timeVal = $('bkTime').value, descVal = text($('bkNotes').value);
    var urgencyVal = state.bkUrgency === 'urgent' ? 'Urgent' : 'Flexible';
    var err = $('bkErr'), btn = $('bkSubmitBtn'), body = $('tpBookBody');
    function fail(msg, el) { err.textContent = msg; err.hidden = false; if (el) el.focus(); }
    if (jobVal.length < JOB_MIN) return fail('Please say what you need done (at least ' + JOB_MIN + ' characters).', $('bkJob'));
    if (descVal.length < DESC_MIN) return fail('Please describe the job (at least ' + DESC_MIN + ' characters) so the tasker knows what to expect.', $('bkNotes'));
    if (areaVal.length < AREA_MIN) return fail('Please tell us the area where the job is (for example Lekki Phase 1).', $('bkArea'));
    if (!dateVal) return fail('Please select a preferred date.', $('bkDate'));
    err.hidden = true; btn.disabled = true;
    var btnLabel = btn.textContent;
    btn.textContent = state.bkPhotos.length ? 'Uploading photos\u2026' : 'Sending\u2026';
    if (!(await uploadBkPhotos())) { err.textContent = 'A photo could not be uploaded, so the request was not sent. Remove the photo or try again.'; err.hidden = false; btn.disabled = false; btn.textContent = btnLabel; return; }
    var photoUrls = state.bkPhotos.map(function (p) { return p.url; }).filter(Boolean);
    btn.textContent = 'Sending\u2026';
    var tag = mode === 'quote' ? '[Quote request] ' : (mode === 'callout' ? '[Emergency callout] ' : '');

    try {
      /* Every request is its own booking (Stage 5). The job details go in their own columns; if the Stage 5 SQL has
         not been run yet the insert is retried in the older form, with everything as lines in notes. */
      var scheduled = dateVal + (timeVal ? ' \u2014 ' + timeVal : '');
      var row = { customer_id: user.id, tasker_id: state.id, status: 'pending', scheduled_time: scheduled };
      var ins = await window.supabase.from('bookings').insert(Object.assign({}, row, {
        notes: (tag + jobVal + '\n' + descVal).trim(),
        job_title: jobVal, job_description: descVal, job_area: areaVal, job_urgency: urgencyVal.toLowerCase(), job_photos: photoUrls
      })).select('id').single();
      var columnsMissing = false;
      if (ins.error && /job_(title|description|area|urgency|photos)|PGRST204|42703/.test((ins.error.code || '') + ' ' + (ins.error.message || ''))) {
        columnsMissing = true;
        ins = await window.supabase.from('bookings').insert(Object.assign({}, row, {
          notes: buildNotes(tag, jobVal, descVal, areaVal, '', urgencyVal, photoUrls)   /* no street address in the open notes */
        })).select('id').single();
      }
      if (ins.error) throw ins.error;
      var bookingId = ins.data.id;

      /* The street address goes in the private table (readable by the tasker only once they confirm) */
      var addressSaved = true;
      if (streetVal) {
        try {
          var pr = await window.supabase.from('booking_private').insert({ booking_id: bookingId, address: streetVal });
          if (pr.error) throw pr.error;
        } catch (e) { addressSaved = false; console.warn('[booking] street address not saved:', e && e.message); }
      }
      if (columnsMissing) console.warn('[booking] Stage 5 SQL not run: saved the older way (details in notes).');

      var who = (user.user_metadata && user.user_metadata.name) || (user.email && user.email.split('@')[0]) || 'A customer';
      var svcName = (state.tasker && (state.tasker.service_name || state.tasker.service)) || 'your service';
      try {
        await window.supabase.from('notifications').insert({
          user_id: state.id, type: 'new_booking',
          title: mode === 'callout' ? 'Emergency Callout Request' : (mode === 'quote' ? 'New Quote Request' : 'New Booking Request'),
          message: who + (mode === 'quote' ? ' asked for a quote for ' : ' wants to book ') + svcName + ' in ' + areaVal + ' on ' + dateVal + (timeVal ? ' (' + timeVal + ')' : '') + '. Job: ' + jobVal.slice(0, 80) + (urgencyVal === 'Urgent' ? ' (urgent)' : ''),
          data: { booking_id: bookingId, from: user.id }, is_read: false
        });
      } catch (e) { /* the notification is a courtesy: the request itself is saved */ }

      sessionStorage.setItem('st_chat_context', JSON.stringify({ contextType: 'booking', contextId: bookingId, taskerId: state.id, customerId: user.id }));

      body.innerHTML =
        '<div class="tp-dialog-done"><span class="tp-dialog-done-icon">' + icon('check') + '</span>' +
        '<h2 class="tp-dialog-title">Request sent</h2>' +
        '<p class="tp-dialog-lead">Your request for <strong>' + esc(jobVal) + '</strong> in <strong>' + esc(areaVal) + '</strong> has been sent for <strong>' + esc(dateVal + (timeVal ? ' (' + timeVal + ')' : '')) + '</strong>' + (urgencyVal === 'Urgent' ? ' and marked urgent' : '') + (photoUrls.length ? ', with ' + photoUrls.length + (photoUrls.length === 1 ? ' photo' : ' photos') : '') + '. The tasker will respond shortly.</p>' +
        (addressSaved ? '' : '<p class="ap-error">We could not save your street address. Please send it to the tasker in chat once they reply.</p>') +
        '<a href="messages.html" class="btn btn-primary tp-dialog-submit">' + icon('chat') + 'Message Provider</a>' +
        '<button type="button" class="btn btn-ghost tp-dialog-submit" data-close>Close</button></div>';
    } catch (e) {
      body.innerHTML =
        '<div class="tp-dialog-done"><h2 class="tp-dialog-title">Something went wrong</h2>' +
        '<p class="ap-error">' + esc((e && e.message) || 'Booking failed. Please try again.') + '</p>' +
        '<button type="button" class="btn btn-primary tp-dialog-submit" data-retry="' + esc(mode) + '">Try Again</button></div>';
    }
  }

  /* Request Quote / Message: messages hang off a booking, so reuse an open one or start a request. */
  async function openQuote() {
    var user = await currentUser();
    if (!user) return toLogin();
    if (await blockIfTasker(user)) return;
    if (state.demo) return openDemoBooking();
    try {
      var ex = await window.supabase.from('bookings').select('id').eq('customer_id', user.id).eq('tasker_id', state.id).in('status', ['pending', 'confirmed']).maybeSingle();
      if (ex.data && ex.data.id) {
        sessionStorage.setItem('st_chat_context', JSON.stringify({ contextType: 'booking', contextId: ex.data.id, taskerId: state.id, customerId: user.id }));
        window.location.href = 'messages.html';
        return;
      }
    } catch (e) { /* fall through to the request form */ }
    openBooking('quote');
  }

  async function openDemoBooking() {
    var user = await currentUser();
    if (!user) return toLogin();
    var svc = state.demo, body = $('tpBookBody');
    body.innerHTML = '<div class="tp-dialog-done"><h2 class="tp-dialog-title" id="tpBookTitle">Sending request\u2026</h2><p class="tp-dialog-lead">Contacting ' + esc(svc.provider_name) + '</p></div>';
    openDialog($('tpBookDialog'));
    setTimeout(async function () {
      try {
        await window.supabase.from('notifications').insert({
          user_id: user.id, type: 'booking_declined', title: 'Booking Unavailable',
          message: svc.provider_name + ' is not currently taking new bookings through Street Taskers. Try another provider or post a task instead.', is_read: false
        });
      } catch (e) { /* notification is a courtesy */ }
      body.innerHTML =
        '<div class="tp-dialog-done"><h2 class="tp-dialog-title">Provider unavailable</h2>' +
        '<p class="tp-dialog-lead">' + esc(svc.provider_name) + ' is not currently taking new bookings. You have been notified in your dashboard.</p>' +
        '<a href="find-taskers.html?category=' + encodeURIComponent(svc.category) + '" class="btn btn-primary tp-dialog-submit">Find other ' + esc(svc.service_name) + 's</a>' +
        '<button type="button" class="btn btn-ghost tp-dialog-submit" data-close>Close</button></div>';
    }, 2000);
  }

  /* ── Applications decision bar (?task=&app=) ─────────────── */
  function chatContext(appId, custId) {
    sessionStorage.setItem('st_chat_context', JSON.stringify({ contextType: 'task_application', contextId: String(appId), taskerId: String(state.id), customerId: String(custId) }));
  }
  function decisionDone(label, appId, custId) {
    var body = $('tpDecisionBody');
    body.innerHTML = '<span class="tp-decision-ok">' + icon('check') + esc(label) + '</span>' +
      '<button type="button" class="btn btn-primary btn-sm" id="tpMsgAfter">' + icon('chat') + 'Message Tasker</button>' +
      '<a href="dashboard-customer.html?panel=applications" class="btn btn-ghost btn-sm">Back to Dashboard</a>';
    $('tpMsgAfter').onclick = function () { if (custId) chatContext(appId, custId); window.location.href = 'messages.html'; };
  }

  async function loadDecisionBar() {
    var params = new URLSearchParams(window.location.search);
    var taskId = params.get('task'), appId = params.get('app');
    if (!taskId || !appId) return;
    var sb = window.supabase;
    var row = await sb.from('task_applications').select('status, message').eq('id', appId).maybeSingle();
    var status = row.data && row.data.status;
    var bar = $('tpDecision'), body = $('tpDecisionBody');
    var user = await currentUser(), custId = user && user.id;

    if (status === 'pending') {
      body.innerHTML = '<span class="tp-decision-q">Hire this tasker for your task?</span>' +
        '<button type="button" class="btn btn-primary btn-sm tp-decision-yes" id="tpAccept">Accept Application</button>' +
        '<button type="button" class="btn btn-ghost btn-sm tp-decision-no" id="tpReject">Decline</button>';
      bar.hidden = false;
      $('tpAccept').onclick = async function () {
        this.disabled = true; this.textContent = 'Accepting\u2026';
        try {
          await sb.from('task_applications').update({ status: 'accepted' }).eq('id', appId);
          await sb.from('task_applications').update({ status: 'closed' }).eq('task_id', taskId).eq('status', 'pending').neq('id', appId);
          await sb.from('tasks').update({ status: 'in_progress' }).eq('id', taskId);
          try {
            await sb.from('notifications').insert({ user_id: String(state.id), type: 'application_accepted', title: 'Application Accepted!',
              message: 'Your application was accepted. The customer will contact you.', data: { task_id: taskId }, is_read: false });
          } catch (e2) { /* courtesy notification */ }
          decisionDone('Application accepted', appId, custId);
        } catch (err) {
          this.disabled = false; this.textContent = 'Accept Application';
          if (window.showToast) window.showToast('Error: ' + err.message);
        }
      };
      $('tpReject').onclick = async function () {
        if (!window.confirm('Decline this application?')) return;
        this.disabled = true;
        try {
          await sb.from('task_applications').update({ status: 'rejected' }).eq('id', appId);
          window.location.href = 'dashboard-customer.html?panel=applications';
        } catch (err) {
          this.disabled = false;
          if (window.showToast) window.showToast('Error: ' + err.message);
        }
      };
    } else if (status === 'accepted') {
      decisionDone('Already accepted', appId, custId);
      bar.hidden = false;
    }
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function bookAction() {
    if (state.isOwner) { window.location.href = 'edit-profile-tasker.html'; return; }
    openBooking('book');
  }

  function wire() {
    $('tpBook').addEventListener('click', bookAction);
    $('tpBarBook').addEventListener('click', bookAction);
    $('tpQuote').addEventListener('click', openQuote);
    $('tpBarMsg').addEventListener('click', openQuote);
    $('tpCallout').addEventListener('click', function () { openBooking('callout'); });

    /* Back: previous page when it was ours, otherwise Find Taskers */
    $('tpBack').addEventListener('click', function (e) {
      if (window.history.length > 1 && document.referrer && document.referrer.indexOf(window.location.origin) === 0) { e.preventDefault(); window.history.back(); }
    });

    /* Portfolio: open photo; broken images fall back to a blank tile */
    $('tpPortfolio').addEventListener('click', function (e) { var b = e.target.closest('.tp-work'); if (b) openLightbox(Number(b.getAttribute('data-i'))); });
    $('tpPortfolio').addEventListener('error', function (e) { if (e.target && e.target.tagName === 'IMG') e.target.hidden = true; }, true);
    $('tpLightboxClose').addEventListener('click', function () { closeDialog($('tpLightbox')); });

    /* Dialogs: backdrop click, close buttons, submit, retry */
    ['tpBookDialog', 'tpLightbox'].forEach(function (id) {
      var dlg = $(id);
      dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(dlg); });
    });
    $('tpBookDialog').addEventListener('input', function (e) {
      if (e.target.id !== 'bkNotes') return;
      var c = $('bkCount'); if (c) c.textContent = e.target.value.length + ' / ' + DESC_MAX;
    });
    $('tpBookDialog').addEventListener('change', function (e) {
      if (e.target.id !== 'bkPhotoFiles') return;
      addBkFiles(Array.prototype.slice.call(e.target.files || [])); e.target.value = '';
    });
    $('tpBookDialog').addEventListener('close', resetBkPhotos);
    $('tpBookDialog').addEventListener('click', function (e) {
      var padd = e.target.closest('[data-photo-add]'); if (padd) { $('bkPhotoFiles').click(); return; }
      var prem = e.target.closest('[data-photo-remove]'); if (prem) { removeBkPhoto(Number(prem.getAttribute('data-photo-remove'))); return; }
      var urg = e.target.closest('[data-urgency]');
      if (urg) {
        state.bkUrgency = urg.getAttribute('data-urgency');
        Array.prototype.forEach.call($('bkUrgency').children, function (b) { b.setAttribute('aria-checked', b === urg ? 'true' : 'false'); });
        if (state.bkUrgency === 'urgent') { var d = $('bkDate'); if (d && !d.value) d.value = d.min; }
        return;
      }
      if (e.target.closest('[data-close]')) return closeDialog($('tpBookDialog'));
      var rs = e.target.closest('[data-role-switch]'); if (rs) return switchToCustomer(rs);
      var sub = e.target.closest('#bkSubmitBtn'); if (sub) return submitBooking(sub.getAttribute('data-mode'));
      var retry = e.target.closest('[data-retry]'); if (retry) openBooking(retry.getAttribute('data-retry'));
    });

    /* Tab strip on phones: the site sets overflow-x: hidden on html and body, which switches position: sticky off,
       so the strip is pinned under the nav by hand once its placeholder scrolls up to the nav. */
    var wrap = $('tpTabsWrap'), tabs = $('tpTabs'), nav = document.getElementById('navbar');
    var phone = window.matchMedia('(max-width: 768px)');
    var pin = function () {
      var navH = nav ? nav.getBoundingClientRect().height : 0;
      tabs.classList.toggle('is-stuck', phone.matches && !wrap.hidden && wrap.getBoundingClientRect().top <= navH);
      /* Highlight the section being read */
      var current = null, line = navH + wrap.offsetHeight + 24;
      Array.prototype.forEach.call(tabs.children, function (a) {
        var sec = $(a.getAttribute('href').slice(1));
        if (sec && sec.getBoundingClientRect().top <= line) current = a;
      });
      if (current && !current.hasAttribute('aria-current')) {
        Array.prototype.forEach.call(tabs.children, function (t) { t.removeAttribute('aria-current'); });
        current.setAttribute('aria-current', 'true');
      }
    };
    window.addEventListener('scroll', pin, { passive: true });
    window.addEventListener('resize', pin);

    /* Tabs: smooth scroll and highlight the current one */
    $('tpTabs').addEventListener('click', function (e) {
      var a = e.target.closest('.tp-tab'); if (!a) return;
      e.preventDefault();
      var target = $(a.getAttribute('href').slice(1));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      Array.prototype.forEach.call($('tpTabs').children, function (t) { t.removeAttribute('aria-current'); });
      a.setAttribute('aria-current', 'true');
    });
  }

  async function init() {
    wire();
    var params = new URLSearchParams(window.location.search);
    var demoId = params.get('demo');
    state.id = params.get('id');

    if (demoId) return loadDemo(demoId);
    if (!state.id) return fail();

    try {
      var user = await currentUser();
      state.isOwner = !!(user && user.id === state.id);
      await loadReal(state.id);
    } catch (err) {
      console.error('[tasker-profile]', err);
      fail();
    }
  }

  init();
})();

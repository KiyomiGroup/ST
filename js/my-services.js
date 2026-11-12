/* ============================================================
   STREETTASKER — my-services.js
   Tasker "My Services" page (my-services.html).
   Loads the tasker's services (and booking counts), then filters,
   searches, sorts and renders service cards.
   Actions: Edit (post-service.html?id=),
   Delete (with confirmation).

   Data: services (fallback: legacy taskers table), bookings.service_id.
   A service is "live" when available !== false, otherwise a draft that
   publishes after verification (same rule as post-service.html).
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var AVAIL = { available_now: 'Available now', available_today: 'Available today', available_this_week: 'Available this week' };
  var state = { user: null, services: [], filter: 'all', query: '', category: '', sort: 'recent', shown: PAGE_SIZE, bookingsTotal: null, slots: null };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var icon = function (id) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var naira = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); };
  var safeUrl = function (u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; };

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min' : ' mins') + ' ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + ' ago';
    var d = Math.floor(h / 24); return d + (d === 1 ? ' day' : ' days') + ' ago';
  }
  function initials(name) {
    return String(name).replace(/[^a-zA-Z ]/g, '').trim().split(' ').filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || '??';
  }
  function pretty(s) { return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function unitLabel(u) { return String(u || '/job').replace(/^\//, ''); }

  /* ── Data ─────────────────────────────────────────────── */
  async function load() {
    var sess = await window.supabase.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.replace('login.html?next=my-services.html'); return; }
    state.user = user;

    var role = null;
    try { role = await window.ST.auth.getUserRole(user); } catch (e) { /* use cache */ }
    role = role || localStorage.getItem('st_role');
    if (role === 'customer') { window.location.replace('my-tasks.html'); return; }

    var rows = [];
    var sr = await window.supabase.from('services').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (sr.error) { renderError(sr.error.message); return; }
    if (sr.data && sr.data.length) {
      rows = sr.data.map(function (s) {
        return { id: String(s.id), name: s.service_name, category: s.category, price: s.price, priceMax: s.price_max, unit: s.rate_unit, priceType: s.price_type, priceUnitLabel: s.price_unit_label,
          location: s.location, description: s.description, photo: s.photo, available: s.available,
          availability: s.availability_status, created: s.created_at, fromServices: true, status: s.listing_status };
      });
    } else {
      /* Older accounts: the listing lives in the taskers table */
      try {
        var tr = await window.supabase.from('taskers').select('*').eq('user_id', String(user.id));
        rows = (tr.data || []).map(function (t) {
          return { id: String(t.id), name: t.service, category: t.category, price: t.rate_value, unit: t.rate_unit,
            location: t.location, description: t.bio, photo: t.photo_url, available: t.available,
            availability: t.availability_status, created: t.created_at, fromServices: false };
        });
      } catch (e) { /* no legacy rows */ }
    }

    /* Booking counts are optional: a failure here must not hide the services */
    var counts = {}, total = null;
    try {
      var br = await window.supabase.from('bookings').select('id, service_id').eq('tasker_id', user.id);
      if (!br.error) {
        total = 0;
        (br.data || []).forEach(function (b) {
          total++;
          if (b.service_id != null) counts[String(b.service_id)] = (counts[String(b.service_id)] || 0) + 1;
        });
      }
    } catch (e) { /* no booking info */ }
    state.bookingsTotal = total;

    state.services = rows.map(function (s) {
      return {
        id: s.id, name: s.name || 'Untitled service', category: s.category || '', location: s.location || '',
        description: s.description || '', price: Number(s.price) || 0, priceMax: Number(s.priceMax) || 0, unit: unitLabel(s.unit), priceType: s.priceType || '', priceUnitLabel: s.priceUnitLabel || '',
        photo: safeUrl(s.photo || ''), availability: s.availability || '', created: s.created,
        group: s.status === 'paused' ? 'paused' : (s.available === false ? 'draft' : 'live'), fromServices: s.fromServices,
        bookings: counts[s.id] || 0
      };
    });
    state.slots = await window.ST.db.fetchMyListingSlots();
    buildCategoryOptions();
    render();
  }

  /* ── Render ───────────────────────────────────────────── */
  function buildCategoryOptions() {
    var sel = $('svCategory'), seen = {};
    state.services.forEach(function (s) {
      if (!s.category || seen[s.category]) return; seen[s.category] = 1;
      var o = document.createElement('option'); o.value = s.category; o.textContent = pretty(s.category); sel.appendChild(o);
    });
  }

  function visible() {
    var q = state.query.toLowerCase();
    var list = state.services.filter(function (s) {
      if (state.filter !== 'all' && s.group !== state.filter) return false;
      if (state.category && s.category !== state.category) return false;
      if (q && [s.name, s.category, s.location].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (x, y) {
      if (state.sort === 'oldest') return new Date(x.created) - new Date(y.created);
      if (state.sort === 'price-high') return y.price - x.price;
      if (state.sort === 'price-low') return x.price - y.price;
      return new Date(y.created) - new Date(x.created);
    });
    return list;
  }

  function badge(s) {
    if (s.group === 'paused') return '<span class="ap-badge ap-badge-completed">Paused</span>';
    return s.group === 'live'
      ? '<span class="ap-badge ap-badge-accepted"><span class="ap-badge-dot"></span>Live</span>'
      : '<span class="ap-badge ap-badge-pending">Draft</span>';
  }

  /* Rate figure: same wording customers read (js/pricing-methods.js); the old layout when that file is not loaded */
  function rateFigure(s) {
    if (window.STPricing && s.fromServices) {
      var d = STPricing.describe({ price: s.price, price_max: s.priceMax, rate_unit: '/' + s.unit, price_type: s.priceType, price_unit_label: s.priceUnitLabel });
      return '<div><div class="ap-fig-label">' + esc(d.label) + '</div><div class="ap-fig-value">' + esc(d.amount) + (d.unit ? ' <span class="sv-unit">' + esc(d.unit) + '</span>' : '') + '</div></div>';
    }
    return '<div><div class="ap-fig-label">Rate</div><div class="ap-fig-value">' + (s.price ? naira(s.price) + (s.priceMax > s.price ? ' \u2013 ' + naira(s.priceMax) : '') : '\u2014') +
      (s.price ? ' <span class="sv-unit">/ ' + esc(s.unit) + '</span>' : '') + '</div></div>';
  }

  function figures(s) {
    var avail = s.group === 'paused' ? 'Paused' : s.group === 'draft' ? 'Not live yet' : (AVAIL[s.availability] || '\u2014');
    return '<div class="ap-figures">' +
      rateFigure(s) +
      '<div><div class="ap-fig-label">Availability</div><div class="sv-fig-text">' + esc(avail) + '</div></div>' +
      '<div><div class="ap-fig-label">Bookings</div><div class="ap-fig-value' + (s.bookings ? ' is-offer' : '') + '">' +
        (state.bookingsTotal == null ? '\u2014' : s.bookings) + '</div></div></div>';
  }

  function actions(s) {
    var id = esc(s.id), a = '';
    if (s.fromServices && s.group === 'paused') a += '<button type="button" class="ap-btn ap-btn-primary" data-act="reactivate" data-id="' + id + '">Reactivate</button>';
    a += '<a class="ap-btn ap-btn-primary" href="post-service.html?id=' + encodeURIComponent(s.id) + '">Edit</a>';
    if (s.fromServices && s.group !== 'paused') a += '<button type="button" class="ap-btn" data-act="pause" data-id="' + id + '">Pause</button>';
    if (s.fromServices) a += '<button type="button" class="ap-btn ap-btn-quiet sv-delete" data-act="delete" data-id="' + id + '">Delete</button>';
    return '<div class="ap-actions">' + a + '</div>';
  }

  function card(s) {
    var sub = [];
    if (s.category) sub.push('<span>' + esc(pretty(s.category)) + '</span>');
    if (s.location) sub.push('<span>' + icon('pin') + esc(s.location) + '</span>');
    var thumb = '<span class="sv-thumb">' + (s.photo ? '<img src="' + esc(s.photo) + '" alt="" loading="lazy" />' : esc(initials(s.name))) + '</span>';
    return '<article class="ap-card" data-id="' + esc(s.id) + '"><div class="ap-card-top">' + badge(s) +
      (s.created ? '<span class="ap-meta">' + icon('clock') + 'Added ' + esc(ago(s.created)) + '</span>' : '') + '</div>' +
      '<div class="sv-head">' + thumb + '<div class="sv-head-body"><h2 class="ap-card-title">' + esc(s.name) + '</h2>' +
      '<div class="ap-card-sub">' + sub.join('') + '</div></div></div>' +
      (s.description ? '<p class="sv-desc">' + esc(s.description) + '</p>' : '') +
      figures(s) + actions(s) + '</article>';
  }

  function renderSummary() {
    var all = state.services, live = all.filter(function (s) { return s.group === 'live'; }).length,
        draft = all.filter(function (s) { return s.group === 'draft'; }).length;
    $('sTotal').textContent = all.length; $('sLive').textContent = live; $('sDraft').textContent = draft;
    $('sBookings').textContent = state.bookingsTotal == null ? '\u2014' : state.bookingsTotal;
    var bar = $('sBar').children;
    bar[0].style.width = all.length ? (draft / all.length * 100) + '%' : '0'; /* runtime width, allowed inline */
    bar[1].style.width = all.length ? (live / all.length * 100) + '%' : '0';
    $('sBarText').textContent = all.length ? live + ' of ' + all.length + ' live' : 'No services yet';
    renderSlots();
  }

  /* Slots come from the server (get_my_entitlements). Nothing here knows the plan's numbers. */
  function renderSlots() {
    var el = $('sSlots'), sl = state.slots;
    if (!sl) { el.textContent = ''; return; }
    el.textContent = sl.active + ' of ' + sl.limit + ' active listing' + (sl.limit === 1 ? '' : 's') + ' used' +
      (sl.remaining === 0 ? '. Pause or delete one to add another, or upgrade your plan.' : '.');
  }

  function render() {
    $('svList').setAttribute('aria-busy', 'false');
    var all = state.services, list = visible(), host = $('svList');
    var counts = { all: all.length, live: 0, draft: 0, paused: 0 };
    all.forEach(function (s) { counts[s.group]++; });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var n = counts[el.getAttribute('data-count')]; el.textContent = n > 0 ? n : '';
    });
    renderSummary();

    if (!all.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">No services yet</h2><p class="ap-state-text">Set up your service so customers can find and book you.</p>' +
        '<a class="ap-btn ap-btn-primary" href="post-service.html">Post a Service</a></div>';
      $('svMore').hidden = true; return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Nothing matches</h2><p class="ap-state-text">Try a different tab, search or category.</p></div>';
      $('svMore').hidden = true; return;
    }
    host.innerHTML = list.slice(0, state.shown).map(card).join('');
    $('svMore').hidden = list.length <= state.shown;
  }

  function renderError(msg) {
    $('svList').setAttribute('aria-busy', 'false');
    $('svList').innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Could not load your services</h2><p class="ap-state-text">' + esc(msg) + '</p>' +
      '<button type="button" class="ap-btn" data-act="retry">Try Again</button></div>';
  }

  /* ── Events ───────────────────────────────────────────── */
  function reset() { state.shown = PAGE_SIZE; render(); }
  $('svTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.ap-tab'); if (!b) return;
    state.filter = b.getAttribute('data-filter');
    document.querySelectorAll('#svTabs .ap-tab').forEach(function (t) { t.setAttribute('aria-pressed', t === b ? 'true' : 'false'); });
    reset();
  });
  $('svSearch').addEventListener('input', function (e) { state.query = e.target.value.trim(); reset(); });
  $('svSearchBtn').addEventListener('click', function () { var box = $('svSearch'); state.query = box.value.trim(); reset(); box.focus(); });
  $('svCategory').addEventListener('change', function (e) { state.category = e.target.value; reset(); });
  $('svSort').addEventListener('change', function (e) { state.sort = e.target.value; reset(); });
  $('svMore').addEventListener('click', function () { state.shown += PAGE_SIZE; render(); });

  /* ── Delete ───────────────────────────────────────────── */
  var current = null;
  function toast(m) { if (window.showToast) window.showToast(m); }
  var dlg = $('svDeleteDlg');
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close(); });

  $('svList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'retry') { $('svList').setAttribute('aria-busy', 'true'); load().catch(function (x) { renderError(x && x.message ? x.message : 'Something went wrong.'); }); return; }
    current = state.services.filter(function (s) { return s.id === b.getAttribute('data-id'); })[0];
    if (!current) return;
    if (act === 'pause' || act === 'reactivate') { changeListing(act, b); return; }
    if (act === 'delete') {
      $('svDelText').textContent = '\u201C' + current.name + '\u201D will no longer appear to customers. This can\u2019t be undone.';
      $('svDelError').hidden = true; dlg.showModal();
    }
  });

  async function changeListing(act, btn) {
    var s = current; btn.disabled = true;
    try {
      var r = act === 'pause' ? await window.ST.db.pauseService(s.id) : await window.ST.db.reactivateService(s.id);
      s.group = r.listing_status === 'paused' ? 'paused' : (r.available ? 'live' : 'draft');
      if (r.entitlements && r.entitlements.listings) state.slots = r.entitlements.listings;
      render();
      toast(act === 'pause' ? 'Listing paused. It is hidden from customers.' :
            (r.available ? 'Listing is live again.' : 'Listing reactivated. It goes live once you are verified.'));
    } catch (x) { toast(x.message || 'Something went wrong.'); btn.disabled = false; }
  }

  $('svDelConfirm').addEventListener('click', async function () {
    var btn = this, s = current, err = $('svDelError'); btn.disabled = true; err.hidden = true;
    try {
      var r = await window.supabase.from('services').delete().eq('id', s.id).eq('user_id', state.user.id).select('id');
      if (r.error) throw new Error(r.error.message);
      if (!r.data || !r.data.length) throw new Error('We could not delete this service. Please refresh and try again.');
      state.services = state.services.filter(function (x) { return x.id !== s.id; });
      dlg.close(); render(); toast('Service deleted.');
      window.ST.db.fetchMyListingSlots().then(function (sl) { if (sl) { state.slots = sl; renderSlots(); } });
    } catch (x) { err.textContent = x.message || 'Could not delete this service.'; err.hidden = false; }
    btn.disabled = false;
  });

  load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
})();

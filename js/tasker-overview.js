/* ============================================================
   STREETTASKER — Tasker dashboard: Overview (upper section)
   Fills the markup in dashboard-tasker.html (#tov): stat cards,
   filters and the Active Assignments panel.

   Data: bookings (+ tasks / services / users), wallet and escrow.
   Anything with no data source is hidden or shows a plain
   fallback instead of made-up numbers.

   Reuses these page globals at click time:
   openTaskerWithdrawModal, openTaskerChat, openCodeEntry,
   doMarkJobDone, doBooking, showToast.
   ============================================================ */
(function () {
  'use strict';

  var FEE_RATE = 0.12; /* mirrors PLATFORM_COMMISSION in js/payments.js */
  var DAY = 24 * 60 * 60 * 1000;

  var ACTIVE_STATES = ['confirmed', 'in_progress', 'provider_done', 'awaiting_code', 'awaiting_confirmation'];
  var DEAD_STATES   = ['cancelled', 'canceled', 'declined', 'rejected', 'disputed'];

  var state = {
    uid: null,
    bookings: [],
    wallet: null,
    rating: null,
    reviews: null,
    tab: 'progress',
    selectedId: null,
    defaults: { from: '', to: '' },
    loaded: false,
    channel: null
  };

  /* ── tiny helpers ─────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function naira(n) { return '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG'); }
  function nairaCents(n) {
    return '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function toast(msg) { if (typeof window.showToast === 'function') window.showToast(msg); }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'ST';
  }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function fee(amount) { return Math.round((Number(amount) || 0) * FEE_RATE); }
  function net(amount) { return (Number(amount) || 0) - fee(amount); }
  function shortId(id) { return '#TSK-' + String(id || '').replace(/-/g, '').slice(0, 4).toUpperCase(); }

  /* ── classify a booking ───────────────────────────────────── */
  function group(b) {
    var s = b.status || 'pending';
    if (s === 'completed') return 'completed';
    if (s === 'pending') return 'pending';
    if (ACTIVE_STATES.indexOf(s) !== -1) return 'progress';
    return 'dead';
  }
  function statusLabel(b) {
    switch (b.status) {
      case 'pending':       return 'Pending';
      case 'confirmed':     return 'Scheduled';
      case 'in_progress':   return 'In Progress';
      case 'provider_done':
      case 'awaiting_code':
      case 'awaiting_confirmation': return 'Review';
      case 'completed':     return 'Completed';
      default:              return 'Pending';
    }
  }
  function statusTone(b) {
    var l = statusLabel(b);
    if (l === 'In Progress') return 'progress';
    if (l === 'Completed')   return 'done';
    if (l === 'Review' || l === 'Pending') return 'warn';
    return 'muted';
  }
  function payState(b) {
    var p = b.payment_status || 'unpaid';
    if (p === 'released' || b.status === 'completed') return 'released';
    if (p === 'paid') return 'held';
    return 'unpaid';
  }
  function bookingDate(b) { return new Date(b.scheduled_time || b.created_at || Date.now()); }

  function dueText(b) {
    if (b.status === 'completed') return 'Completed';
    if (!b.scheduled_time) {
      var ago = Math.max(0, Math.round((startOfDay(new Date()) - startOfDay(new Date(b.created_at))) / DAY));
      return ago === 0 ? 'Requested today' : 'Requested ' + ago + (ago === 1 ? ' day ago' : ' days ago');
    }
    var diff = Math.round((startOfDay(new Date(b.scheduled_time)) - startOfDay(new Date())) / DAY);
    if (diff === 0) return 'Due today';
    if (diff > 0)  return 'Due in ' + diff + (diff === 1 ? ' day' : ' days');
    return 'Overdue ' + Math.abs(diff) + (diff === -1 ? ' day' : ' days');
  }
  function scheduleText(b) {
    if (!b.scheduled_time) return 'No date set yet';
    var d = new Date(b.scheduled_time);
    var diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
    var day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
      : d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
    return 'Scheduled for ' + day + ', ' + time;
  }

  /* ── data ─────────────────────────────────────────────────── */
  async function fetchAll() {
    var sb = window.supabase;
    var sess = await sb.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) return false;
    state.uid = user.id;

    var bkRes = await sb.from('bookings').select('*').eq('tasker_id', user.id)
      .order('created_at', { ascending: false });
    var rows = (bkRes && bkRes.data) || [];

    var taskIds = [], svcIds = [], custIds = [];
    rows.forEach(function (b) {
      if (b.task_id && taskIds.indexOf(b.task_id) === -1) taskIds.push(b.task_id);
      if (b.service_id && svcIds.indexOf(b.service_id) === -1) svcIds.push(b.service_id);
      if (b.customer_id && custIds.indexOf(b.customer_id) === -1) custIds.push(b.customer_id);
    });

    async function safe(p) { try { var r = await p; return (r && r.data) || null; } catch (e) { return null; } }

    var results = await Promise.all([
      taskIds.length ? safe(sb.from('tasks').select('*').in('id', taskIds)) : null,
      svcIds.length  ? safe(sb.from('services').select('*').in('id', svcIds)) : null,
      custIds.length ? safe(sb.from('users').select('id,name,first_name,last_name,location').in('id', custIds)) : null,
      (window.ST && window.ST.payments && window.ST.payments.getWallet)
        ? window.ST.payments.getWallet(user.id).catch(function () { return null; }) : null,
      safe(sb.from('taskers').select('*').eq('user_id', String(user.id)).maybeSingle())
    ]);

    var tasks = {}, svcs = {}, custs = {};
    (results[0] || []).forEach(function (t) { tasks[t.id] = t; });
    (results[1] || []).forEach(function (s) { svcs[s.id] = s; });
    (results[2] || []).forEach(function (u) { custs[u.id] = u; });
    state.wallet = results[3];
    var tasker = results[4];
    if (tasker) {
      var r = parseFloat(tasker.rating);
      state.rating = isFinite(r) && r > 0 ? r : null;
      var rc = tasker.review_count != null ? tasker.review_count
        : tasker.reviews_count != null ? tasker.reviews_count : null;
      state.reviews = rc != null && isFinite(Number(rc)) ? Number(rc) : null;
    }

    rows.forEach(function (b) {
      var t = tasks[b.task_id] || null, s = svcs[b.service_id] || null, u = custs[b.customer_id] || null;
      b._title = (t && t.title) || (s && (s.service_name || s.service)) ||
        (b.notes ? String(b.notes).slice(0, 48) : 'Booking request');
      b._category = (t && t.category) || (s && s.category) || '';
      b._location = (t && t.location) || (s && s.location) || (u && u.location) || '';
      var amt = Number(b.amount) || Number(t && t.budget) || 0;
      b._amount = amt;
      b._client = u
        ? ((u.first_name && u.last_name) ? u.first_name + ' ' + u.last_name : u.name || 'Customer')
        : 'Customer';
      b._addons = Array.isArray(b.add_ons) ? b.add_ons : [];
    });

    state.bookings = rows.filter(function (b) { return group(b) !== 'dead'; });
    return true;
  }

  /* ── stat cards ───────────────────────────────────────────── */
  function renderStats() {
    var all = state.bookings;
    var completed = all.filter(function (b) { return b.status === 'completed'; });
    var now = new Date();
    var thisKey = monthKey(now);
    var lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    /* earnings: net of fee, from completed jobs */
    var total = 0, thisM = 0, lastM = 0;
    completed.forEach(function (b) {
      var n = net(b._amount);
      total += n;
      var k = monthKey(new Date(b.completed_at || b.created_at));
      if (k === thisKey) thisM += n;
      if (k === lastKey) lastM += n;
    });
    $('tovEarnTotal').textContent = naira(total);
    var trend = $('tovEarnTrend');
    if (lastM > 0) {
      var pct = ((thisM - lastM) / lastM) * 100;
      var up = pct >= 0;
      trend.innerHTML = '<span class="tov-trend-' + (up ? 'up' : 'down') + '">' + trendIcon(up) +
        (up ? '+' : '') + pct.toFixed(1) + '%</span> <span class="tov-muted">from last month</span>';
    } else if (thisM > 0) {
      trend.innerHTML = '<span class="tov-trend-up">' + trendIcon(true) + naira(thisM) + '</span> <span class="tov-muted">earned this month</span>';
    } else {
      trend.innerHTML = '<span class="tov-muted">After the 12% platform fee</span>';
    }
    var w = state.wallet || {};
    $('tovEarnAvail').textContent = naira(w.balance || 0);

    /* active tasks + 6-month activity bars */
    var inProg = all.filter(function (b) { return group(b) === 'progress'; });
    $('tovActiveValue').innerHTML = inProg.length + ' <span class="tov-value-unit">In Progress</span>';
    var tomorrow = startOfDay(new Date(Date.now() + DAY)).getTime();
    var sched = all.filter(function (b) {
      return group(b) !== 'completed' && b.scheduled_time && startOfDay(new Date(b.scheduled_time)).getTime() === tomorrow;
    }).length;
    var pending = all.filter(function (b) { return group(b) === 'pending'; }).length;
    $('tovActiveSub').innerHTML = sched > 0
      ? '<span class="tov-trend-up">' + trendIcon(true) + '+' + sched + ' scheduled</span> <span class="tov-muted">for tomorrow</span>'
      : pending > 0
        ? '<span class="tov-trend-up">' + trendIcon(true) + pending + ' awaiting</span> <span class="tov-muted">your confirmation</span>'
        : '<span class="tov-muted">Nothing scheduled for tomorrow</span>';

    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleDateString('en-US', { month: 'short' }), n: 0 });
    }
    all.forEach(function (b) {
      var k = monthKey(new Date(b.created_at));
      months.forEach(function (m) { if (m.key === k) m.n++; });
    });
    var max = Math.max.apply(null, months.map(function (m) { return m.n; }).concat([1]));
    $('tovBars').innerHTML = months.map(function (m, idx) {
      var h = m.n ? Math.max(14, Math.round((m.n / max) * 100)) : 10;
      return '<span class="tov-bar-col"><span class="tov-bar tov-bar-' + (idx + 1) + '" data-h="' + h + '" title="' +
        esc(m.label) + ': ' + m.n + (m.n === 1 ? ' job' : ' jobs') + '"></span><span class="tov-bar-label">' + esc(m.label) + '</span></span>';
    }).join('');
    /* heights are runtime values, set on the element rather than inline in the markup */
    $('tovBars').querySelectorAll('.tov-bar').forEach(function (bar) { bar.style.height = bar.dataset.h + '%'; });

    /* success rate: completed / (completed + dropped), from every booking */
    var rawAll = state.bookings.length;
    var dropped = 0;
    /* dropped jobs were filtered out of state.bookings; count them from the raw fetch */
    dropped = state.droppedCount || 0;
    var closed = completed.length + dropped;
    var sv = $('tovSuccessValue');
    if (closed > 0) {
      var rate = (completed.length / closed) * 100;
      sv.innerHTML = rate.toFixed(1).replace(/\.0$/, '') + '% <span class="tov-value-unit">Score</span>';
    } else {
      sv.innerHTML = '&mdash; <span class="tov-value-unit">Score</span>';
    }
    var sub = $('tovSuccessSub');
    if (state.rating) {
      sub.innerHTML = '<span class="tov-trend-up"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ' +
        state.rating.toFixed(2).replace(/0$/, '') + ' rating</span>' +
        (state.reviews != null ? ' <span class="tov-muted">(' + state.reviews + ' reviews)</span>' : '');
    } else {
      sub.innerHTML = closed > 0
        ? '<span class="tov-muted">' + completed.length + ' of ' + closed + ' jobs completed</span>'
        : '<span class="tov-muted">Complete a job to build your score</span>';
    }
    renderSpark(months, all);

    /* escrow */
    var heldNet = 0, heldGross = 0;
    all.forEach(function (b) {
      if (b.status !== 'completed' && payState(b) === 'held') { heldNet += net(b._amount); heldGross += b._amount; }
    });
    var pendingBal = w.pending_balance != null && Number(w.pending_balance) > 0 ? Number(w.pending_balance) : heldNet;
    $('tovEscrowValue').textContent = naira(pendingBal);
    $('tovEscrowGross').textContent = naira(heldGross);
  }

  function trendIcon(up) {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (up ? '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
          : '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>') + '</svg> ';
  }

  /* running success rate by month for the sparkline (needs 2+ months of closed jobs) */
  function renderSpark(months, all) {
    var svg = $('tovSpark');
    var pts = [];
    var done = 0;
    months.forEach(function (m) {
      done += all.filter(function (b) {
        return b.status === 'completed' && monthKey(new Date(b.completed_at || b.created_at)) === m.key;
      }).length;
      pts.push(done);
    });
    var distinct = pts.filter(function (v, i) { return i === 0 || v !== pts[i - 1]; }).length;
    if (distinct < 2) { svg.innerHTML = ''; svg.classList.add('is-empty'); return; }
    svg.classList.remove('is-empty');
    var max = Math.max.apply(null, pts), min = Math.min.apply(null, pts);
    var span = Math.max(1, max - min);
    var coords = pts.map(function (v, i) {
      return [10 + i * ((230 - 20) / (pts.length - 1)), 46 - ((v - min) / span) * 34];
    });
    var d = coords.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' ');
    svg.innerHTML = '<path class="tov-spark-line" d="' + d + '" />' +
      coords.map(function (c, i) {
        return '<circle class="tov-spark-dot' + (i === coords.length - 1 ? ' is-last' : '') + '" cx="' + c[0].toFixed(1) +
          '" cy="' + c[1].toFixed(1) + '" r="' + (i === coords.length - 1 ? 4 : 2.5) + '" />';
      }).join('');
  }

  /* ── filters ──────────────────────────────────────────────── */
  function populateFilters() {
    var cats = [];
    state.bookings.forEach(function (b) { if (b._category && cats.indexOf(b._category) === -1) cats.push(b._category); });
    cats.sort();
    var sel = $('tovCategory'), keep = sel.value;
    sel.innerHTML = '<option value="">All trade categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(String(c).replace(/_/g, ' ')) + '</option>';
    }).join('');
    sel.value = cats.indexOf(keep) !== -1 ? keep : '';

    var now = new Date();
    var keys = state.bookings.map(function (b) { return bookingDate(b); }).concat([now]);
    var min = new Date(Math.min.apply(null, keys)), max = new Date(Math.max.apply(null, keys));
    state.defaults.from = monthKey(min);
    state.defaults.to = monthKey(max);
    var f = $('tovFrom'), t = $('tovTo');
    if (!state.loaded || !f.value) f.value = state.defaults.from;
    if (!state.loaded || !t.value) t.value = state.defaults.to;
    f.min = t.min = state.defaults.from;
    f.max = t.max = state.defaults.to;
  }

  function activeFilterCount() {
    var n = 0;
    if ($('tovCategory').value) n++;
    if ($('tovPayment').value) n++;
    if ($('tovFrom').value !== state.defaults.from || $('tovTo').value !== state.defaults.to) n++;
    if ($('tovSearch').value.trim()) n++;
    return n;
  }

  function applyFilters(list) {
    var cat = $('tovCategory').value, pay = $('tovPayment').value;
    var q = $('tovSearch').value.trim().toLowerCase().replace(/^#/, '');
    var from = $('tovFrom').value, to = $('tovTo').value;
    return list.filter(function (b) {
      if (cat && b._category !== cat) return false;
      if (pay && payState(b) !== pay) return false;
      var k = monthKey(bookingDate(b));
      if (from && k < from) return false;
      if (to && k > to) return false;
      if (q) {
        var hay = (b._title + ' ' + b._client + ' ' + shortId(b.id) + ' ' + b.id).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function byTab(list, tab) {
    return list.filter(function (b) {
      var g = group(b);
      return tab === 'all' ? true : g === tab;
    });
  }

  /* ── assignments list + detail ────────────────────────────── */
  function renderAssignments() {
    var filtered = applyFilters(state.bookings);

    $('tovCountPending').textContent   = byTab(filtered, 'pending').length;
    $('tovCountProgress').textContent  = byTab(filtered, 'progress').length;
    $('tovCountCompleted').textContent = byTab(filtered, 'completed').length;

    var n = activeFilterCount();
    var badge = $('tovFilterCount');
    badge.textContent = n;
    badge.hidden = n === 0;

    var rows = byTab(filtered, state.tab);
    var list = $('tovList');
    if (!rows.length) {
      list.innerHTML = '<p class="tov-empty">' + (state.bookings.length
        ? (n ? 'No assignments match these filters.' : 'Nothing in this tab yet.')
        : 'No assignments yet. Browse open tasks to find your next job.') + '</p>';
      state.selectedId = null;
      renderDetail(null);
      return;
    }
    if (!rows.some(function (b) { return b.id === state.selectedId; })) state.selectedId = rows[0].id;

    list.innerHTML = rows.map(function (b) {
      var sel = b.id === state.selectedId;
      return '<button type="button" role="listitem" class="tov-item' + (sel ? ' is-selected' : '') + '" data-id="' + esc(b.id) + '" aria-current="' + sel + '">' +
        '<span class="tov-item-top">' +
          '<span class="tov-avatar">' + esc(initials(b._client)) + '</span>' +
          '<span class="tov-item-main">' +
            '<span class="tov-item-meta"><span class="tov-item-id">' + esc(shortId(b.id)) + '</span>' +
              (b._category ? '<span class="tov-tag">' + esc(String(b._category).replace(/_/g, ' ')) + '</span>' : '') + '</span>' +
            '<span class="tov-item-title">' + esc(b._title) + '</span>' +
          '</span>' +
          '<span class="tov-status tov-status-' + statusTone(b) + '">' + esc(statusLabel(b)) + '</span>' +
        '</span>' +
        '<span class="tov-item-foot"><span class="tov-due">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          esc(dueText(b)) + '</span><span class="tov-item-amount">' + esc(naira(b._amount)) + '</span></span>' +
      '</button>';
    }).join('');

    renderDetail(rows.filter(function (b) { return b.id === state.selectedId; })[0]);
  }

  function actionFor(b) {
    var paid = payState(b) === 'held';
    switch (b.status) {
      case 'pending':
        return { label: 'Confirm Booking', act: 'confirm' };
      case 'confirmed':
      case 'in_progress':
        return paid ? { label: 'Mark Complete', act: 'done' } : { label: 'Awaiting Payment', disabled: true };
      case 'provider_done':
        return { label: 'Awaiting Client', disabled: true };
      case 'awaiting_code':
      case 'awaiting_confirmation':
        return { label: 'Enter Code', act: 'code' };
      case 'completed':
        return { label: 'Completed', disabled: true };
      default:
        return { label: 'Unavailable', disabled: true };
    }
  }

  function renderDetail(b) {
    var el = $('tovDetail');
    if (!b) { el.innerHTML = '<p class="tov-empty tov-empty-detail">Select an assignment to see its details.</p>'; return; }

    var act = actionFor(b);
    var ps = payState(b);
    var feeAmt = fee(b._amount), netAmt = net(b._amount);
    var chatOk = b.status !== 'pending' && !!b.customer_id;
    var tone = statusTone(b);

    var addons = b._addons.map(function (a) {
      var label = a && (a.name || a.label || a.title) || 'Add-on';
      var price = a && (a.price != null ? a.price : a.amount);
      return '<div class="tov-addon"><strong>' + esc(nairaCents(price)) + '</strong><span>' + esc(label) + '</span></div>';
    }).join('');

    var notice = ps === 'held'
      ? '<strong>StreetTasker Escrow Protected:</strong> Funds are held safely in escrow and released to your wallet once the client confirms the job is complete.'
      : ps === 'released'
        ? '<strong>Payment released:</strong> Your earnings for this job have been added to your wallet.'
        : '<strong>Awaiting client payment:</strong> Once the client pays, the funds are held in escrow and you’ll be notified.';

    el.innerHTML =
      '<div class="tov-detail-grid">' +
        '<div class="tov-dcol">' +
          '<span class="tov-dlabel">Task details</span>' +
          '<div class="tov-did"><span>' + esc(shortId(b.id)) + '</span><span class="tov-status tov-status-' + tone + '">' + esc(tone === 'progress' || b.status === 'confirmed' ? 'Active' : statusLabel(b)) + '</span></div>' +
          '<span class="tov-dtitle">' + esc(b._title) + '</span>' +
        '</div>' +
        '<div class="tov-dcol">' +
          '<span class="tov-dlabel">Client</span>' +
          '<div class="tov-person"><span class="tov-avatar tov-avatar-lg">' + esc(initials(b._client)) + '</span>' +
            '<span class="tov-person-name">' + esc(b._client) + '</span></div>' +
        '</div>' +
        '<div class="tov-dcol">' +
          '<span class="tov-dlabel">Location &amp; booking</span>' +
          '<div class="tov-loc">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
            '<span><strong>' + esc(b._location || 'Location not set') + '</strong><span class="tov-loc-sub">' + esc(scheduleText(b)) + '</span></span></div>' +
        '</div>' +
      '</div>' +
      (addons ? '<div class="tov-addons">' + addons + '</div>' : '') +
      '<div class="tov-escrow-note"><span class="tov-note-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><p>' + notice + '</p></div>' +
      '<div class="tov-detail-foot">' +
        '<dl class="tov-totals">' +
          '<div><dt>Subtotal</dt><dd>' + esc(nairaCents(b._amount)) + '</dd></div>' +
          '<div><dt>Platform fee</dt><dd class="tov-fee">' + esc(nairaCents(feeAmt)) + ' <small>(12%)</small></dd></div>' +
          '<div><dt>Your share</dt><dd>' + esc(nairaCents(netAmt)) + '</dd></div>' +
          '<div><dt>Escrow balance</dt><dd>' + esc(nairaCents(ps === 'held' ? netAmt : 0)) + '</dd></div>' +
        '</dl>' +
        '<div class="tov-actions">' +
          '<button type="button" class="tov-round" data-act="copy" aria-label="Copy reference" title="Copy reference">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>' +
          '<button type="button" class="tov-round" data-act="ics" aria-label="Add to calendar" title="Add to calendar"' + (b.scheduled_time ? '' : ' disabled') + '>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>' +
          '<button type="button" class="tov-btn-light" data-act="chat"' + (chatOk ? '' : ' disabled title="Confirm the booking to start messaging"') + '>' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '<span>Message<br>Client</span></button>' +
          '<button type="button" class="tov-btn-main" data-act="' + (act.act || '') + '"' + (act.disabled ? ' disabled' : '') + '>' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' +
            '<span>' + esc(act.label).replace(' ', '<br>') + '</span></button>' +
        '</div>' +
      '</div>';
  }

  function icsFor(b) {
    var start = new Date(b.scheduled_time), end = new Date(start.getTime() + 60 * 60 * 1000);
    var f = function (d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    var text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StreetTasker//Overview//EN', 'BEGIN:VEVENT',
      'UID:' + b.id + '@streettasker.com', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(start), 'DTEND:' + f(end),
      'SUMMARY:' + String(b._title).replace(/[,;\n]/g, ' '),
      'LOCATION:' + String(b._location || '').replace(/[,;\n]/g, ' '),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var blob = new Blob([text], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = shortId(b.id).replace('#', '') + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  /* ── events ───────────────────────────────────────────────── */
  function selected() {
    return state.bookings.filter(function (b) { return b.id === state.selectedId; })[0];
  }

  function bind() {
    $('tovBack').addEventListener('click', function () {
      if (window.history.length > 1) window.history.back(); else window.location.href = 'index.html';
    });

    var ft = $('tovFilterToggle');
    ft.addEventListener('click', function () {
      var f = $('tovFilters');
      var open = f.classList.toggle('is-collapsed') === false;
      ft.setAttribute('aria-expanded', String(open));
    });

    $('tovWithdraw').addEventListener('click', function () {
      if (typeof window.openTaskerWithdrawModal === 'function') window.openTaskerWithdrawModal();
    });
    $('tovPayout').addEventListener('click', function () {
      if (typeof window.openTaskerWithdrawModal === 'function') window.openTaskerWithdrawModal();
    });

    ['tovCategory', 'tovPayment', 'tovFrom', 'tovTo'].forEach(function (id) { $(id).addEventListener('change', renderAssignments); });
    $('tovSearch').addEventListener('input', renderAssignments);
    $('tovActiveFilters').addEventListener('click', function () {
      $('tovCategory').value = ''; $('tovPayment').value = '';
      $('tovFrom').value = state.defaults.from; $('tovTo').value = state.defaults.to;
      $('tovSearch').value = '';
      renderAssignments();
    });

    document.querySelectorAll('.tov-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.tab = tab.dataset.tab;
        document.querySelectorAll('.tov-tab').forEach(function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
        renderAssignments();
      });
    });

    $('tovList').addEventListener('click', function (e) {
      var item = e.target.closest('.tov-item');
      if (!item) return;
      state.selectedId = item.dataset.id;
      renderAssignments();
    });

    $('tovExpand').addEventListener('click', function () {
      var on = $('tovAssign').classList.toggle('is-expanded');
      this.setAttribute('aria-pressed', String(on));
      this.setAttribute('aria-label', on ? 'Collapse list' : 'Expand list');
    });

    var more = $('tovMore'), menu = $('tovMoreMenu');
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function () { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); });
    $('tovRefresh').addEventListener('click', function () { reload(true); });

    $('tovDetail').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      var b = selected();
      if (!b) return;
      switch (btn.dataset.act) {
        case 'copy':
          var ref = shortId(b.id);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ref).then(function () { toast('Reference ' + ref + ' copied'); }, function () { toast(ref); });
          } else { toast(ref); }
          break;
        case 'ics':   icsFor(b); break;
        case 'chat':  if (typeof window.openTaskerChat === 'function') window.openTaskerChat('booking', b.id, b.customer_id || ''); break;
        case 'confirm': if (typeof window.doBooking === 'function') window.doBooking(b.id, 'confirmed'); break;
        case 'done':  if (typeof window.doMarkJobDone === 'function') window.doMarkJobDone(b.id); break;
        case 'code':  if (typeof window.openCodeEntry === 'function') window.openCodeEntry(b.id); break;
      }
    });
  }

  /* ── load + realtime ──────────────────────────────────────── */
  var reloadTimer = null;
  async function reload(manual) {
    try {
      var rawBefore = await countDropped();
      state.droppedCount = rawBefore;
      var ok = await fetchAll();
      if (!ok) return;
      populateFilters();
      if (!state.loaded) {
        /* land on a tab that has something in it */
        var counts = { progress: 0, pending: 0, completed: 0 };
        state.bookings.forEach(function (b) { var g = group(b); if (counts[g] != null) counts[g]++; });
        if (!counts.progress) state.tab = counts.pending ? 'pending' : counts.completed ? 'completed' : 'all';
        document.querySelectorAll('.tov-tab').forEach(function (t) {
          var on = t.dataset.tab === state.tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
      }
      state.loaded = true;
      renderStats();
      renderAssignments();
      if (manual) toast('Assignments refreshed');
    } catch (e) {
      console.warn('[Overview] load failed:', e && e.message);
      $('tovList').innerHTML = '<p class="tov-empty">Could not load your assignments. <button type="button" class="tov-link-btn" id="tovRetry">Try again</button></p>';
      var r = $('tovRetry'); if (r) r.addEventListener('click', function () { reload(true); });
    }
  }

  /* bookings the tasker lost (cancelled / declined / disputed) feed the success rate */
  async function countDropped() {
    try {
      var sess = await window.supabase.auth.getSession();
      var u = sess.data.session && sess.data.session.user;
      if (!u) return 0;
      var res = await window.supabase.from('bookings').select('id', { count: 'exact', head: true })
        .eq('tasker_id', u.id).in('status', DEAD_STATES);
      return (res && res.count) || 0;
    } catch (e) { return 0; }
  }

  function subscribe() {
    var live = $('tovLive');
    try {
      if (!window.supabase.channel || !state.uid) { live.hidden = true; return; }
      state.channel = window.supabase.channel('tov-bookings-' + state.uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'tasker_id=eq.' + state.uid }, function () {
          clearTimeout(reloadTimer);
          reloadTimer = setTimeout(function () { reload(false); }, 600);
        })
        .subscribe(function (status) {
          live.classList.toggle('is-off', status !== 'SUBSCRIBED');
        });
    } catch (e) { live.hidden = true; }
  }

  async function init() {
    if (!$('tov') || !window.supabase) return;
    bind();
    await reload(false);
    subscribe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

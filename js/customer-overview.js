/* ============================================================
   STREETTASKER — Customer dashboard: Overview
   Fills the markup in dashboard-customer.html (#cov). It reuses the
   tasker overview classes (.tov-*) so both dashboards match.

   STAGE 1: the four stat cards (posted, active, completed, wallet).

   Data: tasks the customer posted, bookings made, pending offers
   (task_applications) and the wallet. Anything with no data source
   shows a plain fallback instead of made-up numbers.

   A "request" is one row of customer work:
     - a booking (joined to its task when it has one), or
     - a task that has no booking yet (still collecting offers).
   ============================================================ */
(function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;

  var ACTIVE_BOOKING = ['confirmed', 'in_progress', 'provider_done', 'awaiting_code', 'awaiting_confirmation'];
  var DEAD_BOOKING   = ['cancelled', 'canceled', 'declined', 'rejected'];
  var DEAD_TASK      = ['cancelled', 'canceled'];

  var state = {
    uid: null,
    tasks: [],
    requests: [],
    offersPending: 0,
    wallet: null,
    loaded: false
  };

  /* ── tiny helpers ─────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function naira(n) { return '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG'); }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── classify a request ───────────────────────────────────── */
  /* draft | progress | completed | dead */
  function group(r) {
    if (r.booking) {
      var s = r.booking.status || 'pending';
      if (s === 'completed') return 'completed';
      if (DEAD_BOOKING.indexOf(s) !== -1) return 'dead';
      return 'progress';
    }
    var ts = (r.task && r.task.status) || 'open';
    if (ts === 'draft') return 'draft';
    if (ts === 'completed') return 'completed';
    if (DEAD_TASK.indexOf(ts) !== -1) return 'dead';
    return 'progress';
  }
  function payState(r) {
    var b = r.booking;
    if (!b) return 'unpaid';
    var p = b.payment_status || 'unpaid';
    if (p === 'released' || b.status === 'completed') return 'released';
    if (p === 'paid') return 'held';
    return p === 'disputed' ? 'disputed' : 'unpaid';
  }
  function requestDate(r) {
    var b = r.booking, t = r.task;
    return new Date((b && (b.scheduled_time || b.created_at)) || (t && t.created_at) || Date.now());
  }
  function createdDate(r) {
    var b = r.booking, t = r.task;
    return new Date((b && b.created_at) || (t && t.created_at) || Date.now());
  }
  function doneDate(r) {
    var b = r.booking, t = r.task;
    return new Date((b && (b.completed_at || b.created_at)) || (t && t.created_at) || Date.now());
  }

  /* ── data ─────────────────────────────────────────────────── */
  async function safe(p) { try { var r = await p; return (r && r.data) || null; } catch (e) { return null; } }

  async function fetchAll() {
    var sb = window.supabase;
    var sess = await sb.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) return false;
    state.uid = user.id;

    var results = await Promise.all([
      safe(sb.from('tasks').select('*').or('customer_id.eq.' + user.id + ',user_id.eq.' + user.id)
        .order('created_at', { ascending: false })),
      safe(sb.from('bookings').select('*').eq('customer_id', user.id).order('created_at', { ascending: false })),
      (window.ST && window.ST.payments && window.ST.payments.getWallet)
        ? window.ST.payments.getWallet(user.id).catch(function () { return null; }) : null
    ]);

    var tasks = results[0] || [];
    var bookings = results[1] || [];
    state.wallet = results[2];
    state.tasks = tasks;

    /* one batched lookup for pending offers on the customer's open tasks */
    var openIds = tasks.filter(function (t) { return !t.status || t.status === 'open'; })
      .map(function (t) { return t.id; });
    var apps = openIds.length
      ? await safe(sb.from('task_applications').select('id,task_id,status').in('task_id', openIds)) : null;
    apps = apps || [];
    var offersByTask = {};
    apps.forEach(function (a) {
      if (a.status === 'pending') offersByTask[a.task_id] = (offersByTask[a.task_id] || 0) + 1;
    });
    state.offersPending = apps.filter(function (a) { return a.status === 'pending'; }).length;

    var taskById = {};
    tasks.forEach(function (t) { taskById[t.id] = t; });
    var booked = {};
    var requests = [];

    bookings.forEach(function (b) {
      var t = b.task_id ? taskById[b.task_id] || null : null;
      if (b.task_id) booked[b.task_id] = true;
      requests.push({
        id: b.id,
        booking: b,
        task: t,
        amount: Number(b.amount) || Number(t && t.budget) || 0,
        offers: 0
      });
    });
    tasks.forEach(function (t) {
      if (booked[t.id]) return;
      requests.push({
        id: t.id,
        booking: null,
        task: t,
        amount: Number(t.budget) || 0,
        offers: offersByTask[t.id] || 0
      });
    });

    state.requests = requests;
    return true;
  }

  /* ── stat cards ───────────────────────────────────────────── */
  function trendIcon(up) {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (up ? '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
          : '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>') + '</svg> ';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function renderStats() {
    var now = new Date();
    var today = startOfDay(now).getTime();
    var weekAgo = today - 6 * DAY;
    var all = state.requests;
    var live = all.filter(function (r) { return group(r) === 'progress'; });
    var completed = all.filter(function (r) { return group(r) === 'completed'; });
    var dropped = all.filter(function (r) { return group(r) === 'dead'; });

    /* posted tasks */
    var tasks = state.tasks;
    $('covPostedValue').innerHTML = tasks.length + ' <span class="tov-value-unit">' + (tasks.length === 1 ? 'Task' : 'Tasks') + '</span>';
    var newToday = tasks.filter(function (t) { return startOfDay(new Date(t.created_at)).getTime() === today; }).length;
    var newWeek = tasks.filter(function (t) { return new Date(t.created_at).getTime() >= weekAgo; }).length;
    $('covPostedSub').innerHTML = newToday > 0
      ? '<span class="tov-trend-up">' + trendIcon(true) + '+' + newToday + ' new today</span> <span class="tov-muted">' + newWeek + ' this week</span>'
      : newWeek > 0
        ? '<span class="tov-trend-up">' + trendIcon(true) + '+' + newWeek + ' this week</span> <span class="tov-muted">new tasks</span>'
        : '<span class="tov-muted">' + (tasks.length ? 'No new tasks this week' : 'No tasks posted yet') + '</span>';
    $('covOffersText').textContent = plural(state.offersPending, 'Offer', 'Offers') + ' Pending Review';

    /* active tasks + 6-month activity bars */
    $('covActiveValue').innerHTML = live.length + ' <span class="tov-value-unit">In Progress</span>';
    var weekAhead = today + 7 * DAY;
    var sched = live.filter(function (r) {
      var t = r.booking && r.booking.scheduled_time ? startOfDay(new Date(r.booking.scheduled_time)).getTime() : null;
      return t != null && t >= today && t < weekAhead;
    }).length;
    $('covActiveSub').innerHTML = sched > 0
      ? '<span class="tov-trend-up">' + trendIcon(true) + '+' + sched + ' scheduled</span> <span class="tov-muted">this week</span>'
      : state.offersPending > 0
        ? '<span class="tov-trend-up">' + trendIcon(true) + state.offersPending + ' offers</span> <span class="tov-muted">waiting for you</span>'
        : '<span class="tov-muted">Nothing scheduled this week</span>';

    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleDateString('en-US', { month: 'short' }), n: 0 });
    }
    all.forEach(function (r) {
      var k = monthKey(createdDate(r));
      months.forEach(function (m) { if (m.key === k) m.n++; });
    });
    var max = Math.max.apply(null, months.map(function (m) { return m.n; }).concat([1]));
    $('covBars').innerHTML = months.map(function (m, idx) {
      var h = m.n ? Math.max(14, Math.round((m.n / max) * 100)) : 10;
      return '<span class="tov-bar-col"><span class="tov-bar tov-bar-' + (idx + 1) + '" data-h="' + h + '" title="' +
        esc(m.label) + ': ' + m.n + (m.n === 1 ? ' task' : ' tasks') + '"></span><span class="tov-bar-label">' + esc(m.label) + '</span></span>';
    }).join('');
    /* heights are runtime values, set on the element rather than inline in the markup */
    $('covBars').querySelectorAll('.tov-bar').forEach(function (bar) { bar.style.height = bar.dataset.h + '%'; });

    /* completed tasks + completion rate */
    $('covDoneValue').innerHTML = completed.length + ' <span class="tov-value-unit">' + (completed.length === 1 ? 'Task' : 'Tasks') + '</span>';
    var closed = completed.length + dropped.length;
    $('covDoneSub').innerHTML = closed > 0
      ? '<span class="tov-trend-up">' + trendIcon(true) + (completed.length / closed * 100).toFixed(1).replace(/\.0$/, '') + '% completion rate</span>'
      : '<span class="tov-muted">Complete a task to build your record</span>';
    renderSpark(months, completed, $('covSpark'));

    /* wallet + escrow */
    var w = state.wallet || {};
    $('covWalletValue').textContent = naira(w.balance || 0);
    var held = 0;
    all.forEach(function (r) { if (r.booking && r.booking.status !== 'completed' && payState(r) === 'held') held += r.amount; });
    $('covEscrowValue').textContent = naira(held);
  }

  /* running total of completed tasks by month for the sparkline (needs 2+ distinct points) */
  function renderSpark(months, completed, svg) {
    var pts = [], done = 0;
    months.forEach(function (m) {
      done += completed.filter(function (r) { return monthKey(doneDate(r)) === m.key; }).length;
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

  /* ── load ─────────────────────────────────────────────────── */
  async function reload() {
    try {
      var ok = await fetchAll();
      if (!ok) return;
      state.loaded = true;
      renderStats();
    } catch (e) {
      console.warn('[Customer overview] load failed:', e && e.message);
    }
  }

  function init() {
    if (!$('cov') || !window.supabase) return;
    reload();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

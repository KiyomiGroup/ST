/* ============================================================
   STREETTASKER — Customer dashboard: Overview
   Fills the markup in dashboard-customer.html (#cov). It reuses the
   tasker overview classes (.tov-*) so both dashboards match.

   Fills the four stat cards, the filters and the Active Requests
   panel (list, detail, Message Tasker, Pay Now / Release Funds).

   The desktop layout is #cov (.tov-*); the phone layout is #com (.tom-*).
   Only one of them is shown at a time (css/styles.css).

   Reuses these page globals at click time:
   openTaskerChat, openPaymentModal, confirmComplete, showToast.

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

  var mstate = { tab: 'progress', cat: '', q: '', selectedId: null };
  var state = {
    uid: null,
    tasks: [],
    requests: [],
    offersPending: 0,
    wallet: null,
    loaded: false,
    tab: 'progress',
    selectedId: null,
    name: '',
    defaults: { from: '', to: '' },
    channel: null
  };

  /* ── tiny helpers ─────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function naira(n) { return '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG'); }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function nairaCents(n) {
    return '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function toast(msg) { if (typeof window.showToast === 'function') window.showToast(msg); }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'ST';
  }
  function shortId(r) { return '#TSK-' + String((r.task ? r.task.id : r.id) || '').replace(/-/g, '').slice(0, 4).toUpperCase(); }
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
        ? window.ST.payments.getWallet(user.id).catch(function () { return null; }) : null,
      safe(sb.from('users').select('name,first_name').eq('id', user.id).maybeSingle())
    ]);
    var me = results[3] || {};
    state.name = me.first_name || (me.name ? String(me.name).split(' ')[0] : '') ||
      ((user.user_metadata && user.user_metadata.name) ? String(user.user_metadata.name).split(' ')[0] : '');

    var tasks = results[0] || [];
    var bookings = results[1] || [];
    state.wallet = results[2];
    state.tasks = tasks;

    /* one batched lookup for pending offers on the customer's open tasks */
    var openIds = tasks.filter(function (t) { return !t.status || t.status === 'open'; })
      .map(function (t) { return t.id; });
    var apps = openIds.length
      ? await safe(sb.from('task_applications').select('id,task_id,status').in('task_id', openIds).neq('status', 'withdrawn')) : null;
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

    /* tasker profiles and service names, one batched lookup each */
    var taskerIds = [], svcIds = [];
    bookings.forEach(function (b) {
      if (b.tasker_id && taskerIds.indexOf(b.tasker_id) === -1) taskerIds.push(b.tasker_id);
      if (b.service_id && svcIds.indexOf(b.service_id) === -1) svcIds.push(b.service_id);
    });
    var look = await Promise.all([
      taskerIds.length ? safe(sb.from('taskers').select('*').in('user_id', taskerIds)) : null,
      taskerIds.length ? safe(sb.from('users').select('id,name,first_name,last_name').in('id', taskerIds)) : null,
      svcIds.length ? safe(sb.from('services').select('*').in('id', svcIds)) : null
    ]);
    var profiles = {}, users = {}, svcs = {};
    (look[0] || []).forEach(function (t) { profiles[t.user_id] = t; });
    (look[1] || []).forEach(function (u) { users[u.id] = u; });
    (look[2] || []).forEach(function (v) { svcs[v.id] = v; });

    /* M10c: each tasker's rating from rating_summary (STRating), never taskers.rating (users can write it) */
    var ratingMap = {};
    try {
      if (window.STRating) ratingMap = await STRating.load(requests.map(function (r) { return r.booking && r.booking.tasker_id; }).filter(Boolean), 'tasker');
    } catch (e) { /* no rating shown */ }

    requests.forEach(function (r) {
      var b = r.booking, t = r.task;
      var sv = (b && b.service_id && svcs[b.service_id]) || null;
      var p = (b && b.tasker_id && profiles[b.tasker_id]) || null;
      var u = (b && b.tasker_id && users[b.tasker_id]) || null;
      r.title = (t && t.title) || (sv && (sv.service_name || sv.service)) ||
        (b && b.notes ? String(b.notes).slice(0, 48) : 'Service booking');
      r.category = (t && t.category) || (sv && sv.category) || (p && (p.service || p.service_name)) || '';
      r.location = (t && t.location) || (sv && sv.location) || (p && p.location) || '';
      r.tasker = b ? ((p && (p.business_name || p.name)) || (u && ((u.first_name && u.last_name) ? u.first_name + ' ' + u.last_name : u.name)) || 'Tasker') : '';
      var rm = (b && b.tasker_id && ratingMap[String(b.tasker_id).toLowerCase()]) || null;
      r.rating = rm ? rm.avg : null;
      r.reviews = rm ? rm.count : null;
      r.addons = b && Array.isArray(b.add_ons) ? b.add_ons : [];
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

    renderMobileStats({
      posted: tasks.length, newToday: newToday, newWeek: newWeek, live: live, completed: completed,
      sched: sched, closed: closed, held: held, balance: w.balance || 0, months: months, all: all
    });
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

  /* ── labels ───────────────────────────────────────────────── */
  function statusLabel(r) {
    if (payState(r) === 'disputed') return 'Disputed';
    if (r.booking) {
      switch (r.booking.status) {
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
    if (group(r) === 'completed') return 'Completed';
    return r.offers > 0 ? plural(r.offers, 'Offer', 'Offers') : 'Open';
  }
  /* key used by the status filter */
  function statusKey(r) {
    if (!r.booking) return group(r) === 'completed' ? 'completed' : 'open';
    var l = statusLabel(r);
    return l === 'In Progress' ? 'progress' : l.toLowerCase();
  }
  function statusTone(r) {
    var l = statusLabel(r);
    if (l === 'In Progress') return 'progress';
    if (l === 'Completed') return 'done';
    if (l === 'Review' || l === 'Pending' || l === 'Disputed') return 'warn';
    return 'muted';
  }
  function dueText(r) {
    if (group(r) === 'completed') return 'Completed';
    var b = r.booking, t = r.task;
    var when = (b && b.scheduled_time) || (t && t.deadline) || null;
    if (!when) {
      var ago = Math.max(0, Math.round((startOfDay(new Date()) - startOfDay(createdDate(r))) / DAY));
      return ago === 0 ? 'Posted today' : 'Posted ' + ago + (ago === 1 ? ' day ago' : ' days ago');
    }
    var diff = Math.round((startOfDay(new Date(when)) - startOfDay(new Date())) / DAY);
    if (diff === 0) return 'Due today';
    if (diff > 0) return 'Due in ' + diff + (diff === 1 ? ' day' : ' days');
    return 'Overdue ' + Math.abs(diff) + (diff === -1 ? ' day' : ' days');
  }
  function scheduleText(r) {
    var b = r.booking, t = r.task;
    var when = (b && b.scheduled_time) || null;
    if (!when) return t && t.deadline ? 'Deadline ' + new Date(t.deadline).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : 'No date set yet';
    var d = new Date(when);
    var diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
    var day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
      : d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
    return 'Scheduled for ' + day + ', ' + time;
  }

  /* what the main button does for this request */
  function actionFor(r) {
    var b = r.booking;
    if (!b) {
      if (group(r) === 'completed') return { label: 'Completed', disabled: true };
      return r.offers > 0 ? { label: 'Review Offers', act: 'offers' } : { label: 'No Offers Yet', disabled: true };
    }
    var ps = payState(r);
    if (ps === 'disputed') return { label: 'Dispute Open', disabled: true };
    switch (b.status) {
      case 'pending':
        return { label: 'Awaiting Tasker', disabled: true };
      case 'confirmed':
      case 'in_progress':
        return ps === 'held' ? { label: 'Release Funds', act: 'release' } : { label: 'Pay Now', act: 'pay' };
      case 'provider_done':
        return ps === 'held' ? { label: 'Release Funds', act: 'release' } : { label: 'Pay Now', act: 'pay' };
      case 'awaiting_code':
      case 'awaiting_confirmation':
        return { label: 'Awaiting Tasker', disabled: true };
      case 'completed':
        return { label: 'Completed', disabled: true };
      default:
        return { label: 'Unavailable', disabled: true };
    }
  }

  /* ── filters ──────────────────────────────────────────────── */
  function visible() { return state.requests.filter(function (r) { return group(r) !== 'dead'; }); }

  function populateFilters() {
    var list = visible();
    var cats = [];
    list.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
    cats.sort();
    var sel = $('covCategory'), keep = sel.value;
    sel.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(String(c).replace(/_/g, ' ')) + '</option>';
    }).join('');
    sel.value = cats.indexOf(keep) !== -1 ? keep : '';

    var keys = list.map(requestDate).concat([new Date()]);
    var min = new Date(Math.min.apply(null, keys)), max = new Date(Math.max.apply(null, keys));
    state.defaults.from = monthKey(min);
    state.defaults.to = monthKey(max);
    var f = $('covFrom'), t = $('covTo');
    if (!state.loaded || !f.value) f.value = state.defaults.from;
    if (!state.loaded || !t.value) t.value = state.defaults.to;
    f.min = t.min = state.defaults.from;
    f.max = t.max = state.defaults.to;
  }

  function activeFilterCount() {
    var n = 0;
    if ($('covCategory').value) n++;
    if ($('covStatus').value) n++;
    if ($('covFrom').value !== state.defaults.from || $('covTo').value !== state.defaults.to) n++;
    if ($('covSearch').value.trim()) n++;
    return n;
  }

  function applyFilters(list) {
    var cat = $('covCategory').value, st = $('covStatus').value;
    var q = $('covSearch').value.trim().toLowerCase().replace(/^#/, '');
    var from = $('covFrom').value, to = $('covTo').value;
    return list.filter(function (r) {
      if (cat && r.category !== cat) return false;
      if (st && statusKey(r) !== st) return false;
      var k = monthKey(requestDate(r));
      if (from && k < from) return false;
      if (to && k > to) return false;
      if (q) {
        var hay = (r.title + ' ' + r.tasker + ' ' + shortId(r) + ' ' + r.id).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function byTab(list, tab) {
    return list.filter(function (r) { return tab === 'all' ? true : group(r) === tab; });
  }

  /* ── requests list + detail ───────────────────────────────── */
  function renderRequests() {
    var filtered = applyFilters(visible());
    $('covCountProgress').textContent = byTab(filtered, 'progress').length;
    $('covCountCompleted').textContent = byTab(filtered, 'completed').length;

    var n = activeFilterCount();
    var badge = $('covFilterCount');
    badge.textContent = n;
    badge.hidden = n === 0;

    var rows = byTab(filtered, state.tab);
    var list = $('covList');
    if (!rows.length) {
      list.innerHTML = '<p class="tov-empty">' + (visible().length
        ? (n ? 'No requests match these filters.' : 'Nothing in this tab yet.')
        : 'No requests yet. Post a task to get offers from taskers near you.') + '</p>';
      state.selectedId = null;
      renderDetail(null);
      return;
    }
    if (!rows.some(function (r) { return r.id === state.selectedId; })) state.selectedId = rows[0].id;

    list.innerHTML = rows.map(function (r) {
      var sel = r.id === state.selectedId;
      return '<button type="button" role="listitem" class="tov-item' + (sel ? ' is-selected' : '') + '" data-id="' + esc(r.id) + '" aria-current="' + sel + '">' +
        '<span class="tov-item-top">' +
          '<span class="tov-avatar">' + esc(initials(r.booking ? r.tasker : r.title)) + '</span>' +
          '<span class="tov-item-main">' +
            '<span class="tov-item-meta"><span class="tov-item-id">' + esc(shortId(r)) + '</span>' +
              (r.category ? '<span class="tov-tag">' + esc(String(r.category).replace(/_/g, ' ')) + '</span>' : '') + '</span>' +
            '<span class="tov-item-title">' + esc(r.title) + '</span>' +
          '</span>' +
          '<span class="tov-status tov-status-' + statusTone(r) + '">' + esc(statusLabel(r)) + '</span>' +
        '</span>' +
        '<span class="tov-item-foot"><span class="tov-due">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          esc(dueText(r)) + '</span><span class="tov-item-amount">' + esc(naira(r.amount)) + '</span></span>' +
      '</button>';
    }).join('');

    renderDetail(rows.filter(function (r) { return r.id === state.selectedId; })[0]);
  }

  function renderDetail(r) {
    var el = $('covDetail');
    if (!r) { el.innerHTML = '<p class="tov-empty tov-empty-detail">Select a request to see its details.</p>'; return; }

    var act = actionFor(r), ps = payState(r), tone = statusTone(r);
    var chatOk = !!(r.booking && r.booking.tasker_id);

    var addons = r.addons.map(function (a) {
      var label = a && (a.name || a.label || a.title) || 'Add-on';
      var price = a && (a.price != null ? a.price : a.amount);
      return '<div class="tov-addon"><strong>' + esc(nairaCents(price)) + '</strong><span>' + esc(label) + '</span></div>';
    }).join('');

    var notice;
    if (ps === 'disputed') notice = '<strong>Dispute open:</strong> Payment is frozen while our team reviews the issue.';
    else if (ps === 'held') notice = '<strong>StreetTasker Escrow Protected:</strong> Funds are held safely and only released when you confirm satisfactory job completion.';
    else if (ps === 'released') notice = '<strong>Payment released:</strong> The tasker has been paid for this job.';
    else if (!r.booking) notice = '<strong>Escrow protected:</strong> Review the offers and pick a tasker. Your payment stays in escrow until you confirm the job is done.';
    else if (r.booking.status === 'pending') notice = '<strong>Waiting for the tasker:</strong> You can pay once they confirm your booking.';
    else notice = '<strong>Payment required:</strong> Pay now to lock in this booking. Funds stay in escrow until you confirm the job is done.';

    var who;
    if (r.booking) {
      who = '<div class="tov-person"><span class="tov-avatar tov-avatar-lg">' + esc(initials(r.tasker)) + '</span>' +
        '<span class="tov-person-name">' + esc(r.tasker) +
        (r.rating ? '<br /><span class="tov-loc-sub">★ ' + esc(r.rating.toFixed(1)) + (r.reviews != null ? ' (' + esc(r.reviews) + ')' : '') + '</span>' : '') +
        '</span></div>';
    } else {
      who = '<div class="tov-person"><span class="tov-avatar tov-avatar-lg">' + esc(initials(r.title)) + '</span>' +
        '<span class="tov-person-name">No tasker yet<br /><span class="tov-loc-sub">' + esc(plural(r.offers, 'offer', 'offers') + ' received') + '</span></span></div>';
    }

    el.innerHTML =
      '<div class="tov-detail-grid">' +
        '<div class="tov-dcol">' +
          '<span class="tov-dlabel">Task details</span>' +
          '<div class="tov-did"><span>' + esc(shortId(r)) + '</span><span class="tov-status tov-status-' + tone + '">' + esc(tone === 'progress' || (r.booking && r.booking.status === 'confirmed') ? 'Active' : statusLabel(r)) + '</span></div>' +
          '<span class="tov-dtitle">' + esc(r.title) + '</span>' +
        '</div>' +
        '<div class="tov-dcol"><span class="tov-dlabel">Assigned tasker</span>' + who + '</div>' +
        '<div class="tov-dcol">' +
          '<span class="tov-dlabel">Location &amp; booking</span>' +
          '<div class="tov-loc">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
            '<span><strong>' + esc(r.location || 'Location not set') + '</strong><span class="tov-loc-sub">' + esc(scheduleText(r)) + '</span></span></div>' +
        '</div>' +
      '</div>' +
      (addons ? '<div class="tov-addons">' + addons + '</div>' : '') +
      '<div class="tov-escrow-note"><span class="tov-note-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><p>' + notice + '</p></div>' +
      '<div class="tov-detail-foot">' +
        '<dl class="tov-totals">' +
          '<div><dt>Subtotal</dt><dd>' + esc(nairaCents(r.amount)) + '</dd></div>' +
          '<div><dt>Platform fee</dt><dd class="tov-fee">' + esc(nairaCents(0)) + ' <small>(Free)</small></dd></div>' +
          '<div><dt>Escrow balance</dt><dd>' + esc(nairaCents(ps === 'held' ? r.amount : 0)) + '</dd></div>' +
        '</dl>' +
        '<div class="tov-actions">' +
          '<button type="button" class="tov-round" data-act="copy" aria-label="Copy reference" title="Copy reference">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>' +
          '<button type="button" class="tov-round" data-act="ics" aria-label="Add to calendar" title="Add to calendar"' + (icsDate(r) ? '' : ' disabled') + '>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>' +
          '<button type="button" class="tov-btn-light" data-act="chat"' + (chatOk ? '' : ' disabled title="Book a tasker to start messaging"') + '>' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '<span>Message<br>Tasker</span></button>' +
          '<button type="button" class="tov-btn-main" data-act="' + (act.act || '') + '"' + (act.disabled ? ' disabled' : '') + '>' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' +
            '<span>' + esc(act.label).replace(' ', '<br>') + '</span></button>' +
        '</div>' +
      '</div>';
  }

  function icsDate(r) {
    var w = (r.booking && r.booking.scheduled_time) || (r.task && r.task.deadline) || null;
    return w ? new Date(w) : null;
  }
  function icsFor(r) {
    var start = icsDate(r); if (!start) return;
    var end = new Date(start.getTime() + 60 * 60 * 1000);
    var f = function (d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    var text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StreetTasker//Overview//EN', 'BEGIN:VEVENT',
      'UID:' + r.id + '@streettasker.com', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(start), 'DTEND:' + f(end),
      'SUMMARY:' + String(r.title).replace(/[,;\n]/g, ' '),
      'LOCATION:' + String(r.location || '').replace(/[,;\n]/g, ' '),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var blob = new Blob([text], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = shortId(r).replace('#', '') + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  /* ── events ───────────────────────────────────────────────── */
  function selected() {
    return state.requests.filter(function (r) { return r.id === state.selectedId; })[0];
  }

  function runAction(kind, r) {
    if (!r) return;
    switch (kind) {
      case 'copy':
        var ref = shortId(r);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ref).then(function () { toast('Reference ' + ref + ' copied'); }, function () { toast(ref); });
        } else { toast(ref); }
        break;
      case 'ics':    icsFor(r); break;
      case 'chat':   if (typeof window.openTaskerChat === 'function') window.openTaskerChat('booking', r.booking.id, r.booking.tasker_id || ''); break;
      case 'offers': window.location.href = 'customer-applications.html'; break;
      case 'pay':    if (typeof window.openPaymentModal === 'function') window.openPaymentModal(r.booking.id, r.title); break;
      /* Same flow as the Bookings panel: confirm, then the 6-digit code is shown for the tasker */
      case 'release': if (typeof window.confirmComplete === 'function') window.confirmComplete(r.booking.id); break;
    }
  }

  function bind() {
    var ft = $('covFilterToggle');
    ft.addEventListener('click', function () {
      var f = $('covFilters');
      var open = f.classList.toggle('is-collapsed') === false;
      ft.setAttribute('aria-expanded', String(open));
    });

    ['covCategory', 'covStatus', 'covFrom', 'covTo'].forEach(function (id) { $(id).addEventListener('change', renderRequests); });
    $('covSearch').addEventListener('input', renderRequests);
    $('covActiveFilters').addEventListener('click', function () {
      $('covCategory').value = ''; $('covStatus').value = '';
      $('covFrom').value = state.defaults.from; $('covTo').value = state.defaults.to;
      $('covSearch').value = '';
      renderRequests();
    });

    var tabs = $('cov').querySelectorAll('.tov-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.tab = tab.dataset.tab;
        tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
        renderRequests();
      });
    });

    $('covList').addEventListener('click', function (e) {
      var item = e.target.closest('.tov-item');
      if (!item) return;
      state.selectedId = item.dataset.id;
      renderRequests();
    });

    $('covExpand').addEventListener('click', function () {
      var on = $('covAssign').classList.toggle('is-expanded');
      this.setAttribute('aria-pressed', String(on));
      this.setAttribute('aria-label', on ? 'Collapse list' : 'Expand list');
    });

    var more = $('covMore'), menu = $('covMoreMenu');
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function () { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); });
    $('covRefresh').addEventListener('click', function () { reload(true); });

    $('covDetail').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      runAction(btn.dataset.act, selected());
    });
  }

  /* ══════════════ Mobile layout (#com) ══════════════ */
  function compact(n) {
    n = Math.round(Number(n) || 0);
    if (n >= 1000000) return '₦' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return '₦' + (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return '₦' + n;
  }

  function renderMobileStats(c) {
    if (!$('com')) return;
    $('comTitle').textContent = 'Hello' + (state.name ? ', ' + state.name : '') + '!';

    $('comPosted').textContent = c.posted;
    $('comPostedTrend').innerHTML = c.newToday > 0
      ? '<span class="tom-up">' + trendIcon(true) + '+' + c.newToday + ' new</span>'
      : c.newWeek > 0 ? '<span class="tom-up">' + trendIcon(true) + '+' + c.newWeek + ' this week</span>'
      : '<span class="tom-muted">' + (c.posted ? 'No new tasks this week' : 'Nothing posted yet') + '</span>';
    $('comOffers').textContent = plural(state.offersPending, 'offer', 'offers') + ' pending';

    $('comActive').textContent = c.live.length;
    $('comActiveSub').textContent = c.sched > 0 ? '+' + c.sched + ' scheduled' : 'Nothing scheduled';

    /* requests per weekday, Monday to Friday of this week */
    var now = new Date(), dow = (now.getDay() + 6) % 7;
    var monday = startOfDay(new Date(now.getTime() - dow * DAY));
    var counts = [0, 0, 0, 0, 0];
    c.all.forEach(function (r) {
      var i = Math.round((startOfDay(requestDate(r)) - monday) / DAY);
      if (i >= 0 && i < 5) counts[i]++;
    });
    var max = Math.max.apply(null, counts.concat([1])), letters = ['M', 'T', 'W', 'T', 'F'];
    $('comDays').innerHTML = counts.map(function (n, i) {
      return '<span class="tom-day"><span class="tom-day-bar' + (i === dow ? ' is-today' : '') + '" data-h="' +
        (n ? Math.max(16, Math.round((n / max) * 100)) : 8) + '" title="' + n + (n === 1 ? ' task' : ' tasks') + '"></span><span class="tom-day-label">' + letters[i] + '</span></span>';
    }).join('');
    $('comDays').querySelectorAll('.tom-day-bar').forEach(function (b) { b.style.height = b.dataset.h + '%'; });

    $('comDone').textContent = c.completed.length;
    $('comDoneSub').innerHTML = c.closed > 0
      ? '<span class="tom-up">' + trendIcon(true) + (c.completed.length / c.closed * 100).toFixed(0) + '% rate</span>'
      : '<span class="tom-muted">No tasks closed yet</span>';
    renderSpark(c.months, c.completed, $('comSpark'));

    $('comWallet').textContent = naira(c.balance);
    $('comEscrowSub').textContent = compact(c.held) + ' held in escrow';

    /* review prompt: only once a booked job has finished */
    var done = c.completed.filter(function (r) { return r.booking && r.booking.tasker_id; })
      .sort(function (a, b) { return doneDate(b) - doneDate(a); })[0];
    $('comPromo').hidden = !done;
    if (done) $('comPromoBtn').href = 'tasker-profile.html?id=' + encodeURIComponent(done.booking.tasker_id);
  }

  function mList() {
    var q = mstate.q.trim().toLowerCase().replace(/^#/, '');
    return visible().filter(function (r) {
      if (mstate.cat && r.category !== mstate.cat) return false;
      if (q) {
        var hay = (r.title + ' ' + r.tasker + ' ' + shortId(r) + ' ' + (r.location || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderMobile() {
    if (!$('com')) return;
    var base = mList();

    /* category chips: counts over live work */
    var live = visible().filter(function (r) { return group(r) === 'progress'; });
    var cats = {};
    live.forEach(function (r) { if (r.category) cats[r.category] = (cats[r.category] || 0) + 1; });
    var chips = '<button type="button" class="tom-cat' + (mstate.cat ? '' : ' is-active') + '" data-cat="">All (' + live.length + ')</button>';
    Object.keys(cats).sort().forEach(function (c) {
      chips += '<button type="button" class="tom-cat' + (mstate.cat === c ? ' is-active' : '') + '" data-cat="' + esc(c) + '">' +
        esc(String(c).replace(/_/g, ' ')) + '</button>';
    });
    $('comCats').innerHTML = chips;

    $('comCountProgress').textContent = byTab(base, 'progress').length;
    $('comCountCompleted').textContent = byTab(base, 'completed').length;

    var rows = byTab(base, mstate.tab);
    var feat = $('comFeature'), qw = $('comQueueWrap');
    if (!rows.length) {
      feat.innerHTML = '<p class="tom-empty">' + (visible().length ? 'Nothing here right now.' : 'No requests yet. Tap Post Task to get started.') + '</p>';
      qw.hidden = true;
      mstate.selectedId = null;
      return;
    }
    if (!rows.some(function (r) { return r.id === mstate.selectedId; })) mstate.selectedId = rows[0].id;
    var r = rows.filter(function (x) { return x.id === mstate.selectedId; })[0];
    var act = actionFor(r), ps = payState(r), chatOk = !!(r.booking && r.booking.tasker_id);

    var addons = r.addons.map(function (a) {
      var label = a && (a.name || a.label || a.title) || 'Add-on', price = a && (a.price != null ? a.price : a.amount);
      return '<span class="tom-chip-sm">' + esc(label) + ' • ' + esc(naira(price)) + '</span>';
    }).join('');
    var note = ps === 'held' ? '<strong>StreetTasker Escrow Protected:</strong> Funds released only when satisfied.'
      : ps === 'released' ? '<strong>Payment released</strong> to the tasker.'
      : ps === 'disputed' ? '<strong>Dispute open.</strong> Payment is frozen while we review.'
      : !r.booking ? '<strong>Escrow protected.</strong> Pick an offer; you pay into escrow, not to the tasker.'
      : r.booking.status === 'pending' ? '<strong>Waiting for the tasker</strong> to confirm your booking.'
      : '<strong>Payment required.</strong> Pay now to lock in this booking.';

    var person = r.booking
      ? '<div class="tom-client"><span class="tom-client-av">' + esc(initials(r.tasker)) + '</span>' +
        '<span class="tom-client-text"><strong>' + esc(r.tasker) +
        (r.rating ? ' <span class="tom-star">★ ' + esc(r.rating.toFixed(1)) + '</span>' : '') + '</strong><small>' +
        esc([r.location, r.booking.scheduled_time ? scheduleText(r).replace('Scheduled for ', '') : ''].filter(Boolean).join(' • ') || 'Details to be confirmed') + '</small></span></div>'
      : '<div class="tom-client"><span class="tom-client-av">' + esc(initials(r.title)) + '</span>' +
        '<span class="tom-client-text"><strong>No tasker yet</strong><small>' + esc(plural(r.offers, 'offer', 'offers') + ' received' + (r.location ? ' • ' + r.location : '')) + '</small></span></div>';

    feat.innerHTML =
      '<div class="tom-feature-top">' +
        '<div class="tom-feature-ids"><span class="tom-id">' + esc(shortId(r)) + '</span><span class="tom-state">' + esc(statusLabel(r)) + '</span></div>' +
        '<div class="tom-escrow-amt"><small>' + (ps === 'held' ? 'In escrow' : 'Fixed quote') + '</small><strong>' + esc(naira(r.amount)) + '</strong></div>' +
      '</div>' +
      '<h3 class="tom-feature-title">' + esc(r.title) + '</h3>' +
      '<p class="tom-due"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + esc(dueText(r)) + '</p>' +
      person +
      (addons ? '<div class="tom-addons"><span class="tom-addons-label">Add-ons</span>' + addons + '</div>' : '') +
      '<div class="tom-note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><p>' + note + '</p></div>' +
      '<div class="tom-feature-actions">' +
        '<button type="button" class="tom-act-ghost" data-act="chat"' + (chatOk ? '' : ' disabled') + '>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Message</button>' +
        '<button type="button" class="tom-act-main" data-act="' + (act.act || '') + '"' + (act.disabled ? ' disabled' : '') + '>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' + esc(act.label) + '</button>' +
      '</div>';

    var others = rows.filter(function (x) { return x.id !== r.id; });
    qw.hidden = !others.length;
    $('comQueueTitle').textContent = mstate.tab === 'completed' ? 'Recently Completed' : 'Other Active Tasks';
    $('comQueue').innerHTML = others.map(function (x) {
      var offers = !x.booking && x.offers > 0;
      return '<div class="tom-qc" data-id="' + esc(x.id) + '">' +
        '<div class="tom-qc-top"><span class="tom-qc-id">' + esc(shortId(x)) + '</span><span class="tom-qc-pill">' + esc(statusLabel(x)) + '</span></div>' +
        '<div class="tom-qc-title">' + esc(x.title) + '</div>' +
        '<div class="tom-qc-amt">' + esc(naira(x.amount)) + '</div>' +
        '<button type="button" class="tom-qc-btn" data-qact="' + (offers ? 'offers' : 'view') + '">' + (offers ? 'Review Bids →' : 'View Details') + '</button>' +
      '</div>';
    }).join('');
  }

  function bindMobile() {
    if (!$('com')) return;
    $('comSearch').addEventListener('input', function () { mstate.q = this.value; renderMobile(); });
    $('comCats').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]'); if (!b) return;
      mstate.cat = b.dataset.cat; renderMobile();
    });
    var tabs = $('com').querySelectorAll('.tom-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        mstate.tab = tab.dataset.mtab;
        tabs.forEach(function (t) {
          var on = t === tab; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', String(on));
        });
        renderMobile();
      });
    });
    $('comQueue').addEventListener('click', function (e) {
      var card = e.target.closest('.tom-qc'); if (!card) return;
      var btn = e.target.closest('[data-qact]');
      if (btn && btn.dataset.qact === 'offers') { window.location.href = 'customer-applications.html'; return; }
      mstate.selectedId = card.dataset.id; renderMobile();
      $('comFeature').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('comFeature').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      runAction(btn.dataset.act, state.requests.filter(function (x) { return x.id === mstate.selectedId; })[0]);
    });
  }

  /* ── load + realtime ─────────────────────────────────────── */
  var reloadTimer = null;
  async function reload(manual) {
    try {
      var ok = await fetchAll();
      if (!ok) return;
      populateFilters();
      if (!state.loaded) {
        /* land on a tab that has something in it */
        var live = visible();
        var hasProgress = live.some(function (r) { return group(r) === 'progress'; });
        var hasDone = live.some(function (r) { return group(r) === 'completed'; });
        if (!hasProgress) state.tab = hasDone ? 'completed' : 'all';
        $('cov').querySelectorAll('.tov-tab').forEach(function (t) {
          var on = t.dataset.tab === state.tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
      }
      if (!state.loaded) {
        mstate.tab = state.tab === 'completed' ? 'completed' : 'progress';
        if ($('com')) $('com').querySelectorAll('.tom-tab').forEach(function (t) {
          var on = t.dataset.mtab === mstate.tab; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', String(on));
        });
      }
      state.loaded = true;
      renderStats();
      renderRequests();
      renderMobile();
      if (manual) toast('Requests refreshed');
    } catch (e) {
      console.warn('[Customer overview] load failed:', e && e.message);
      $('covList').innerHTML = '<p class="tov-empty">Could not load your requests. <button type="button" class="tov-link-btn" id="covRetry">Try again</button></p>';
      var r = $('covRetry'); if (r) r.addEventListener('click', function () { reload(true); });
    }
  }

  function subscribe() {
    var live = $('covLive'), mlive = $('comRealtime');
    function schedule() {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () { reload(false); }, 600);
    }
    try {
      if (!window.supabase.channel || !state.uid) { live.hidden = true; if (mlive) mlive.hidden = true; return; }
      state.channel = window.supabase.channel('cov-requests-' + state.uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'customer_id=eq.' + state.uid }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: 'customer_id=eq.' + state.uid }, schedule)
        .subscribe(function (status) {
          var off = status !== 'SUBSCRIBED';
          live.classList.toggle('is-off', off);
          if (mlive) mlive.classList.toggle('is-off', off);
        });
    } catch (e) { live.hidden = true; if (mlive) mlive.hidden = true; }
  }

  async function init() {
    if (!$('cov') || !window.supabase) return;
    bind();
    bindMobile();
    await reload(false);
    subscribe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

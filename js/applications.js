/* ============================================================
   STREETTASKER — applications.js
   Tasker "My Applications" page (applications.html).
   Stage 1: load the signed-in tasker's applications, filter, search, sort, render.
   Stage 2: sidebar metrics, escrow lookup, Edit Offer, Withdraw, Message Customer.
   Stage 3: aria-busy while loading (mobile layout lives in applications.css).
   Edit Offer opens make-offer.html?task=<id>&edit=1 (the full page); Withdraw stays a small dialog here.
   Data: task_applications joined to tasks. The proposed rate is stored inside
   the message text ("| Proposed rate: ...") so it is parsed out here.
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var state = { user: null, apps: [], escrowByTask: {}, wallet: null, filter: 'all', query: '', category: '', sort: 'recent', shown: PAGE_SIZE };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var icon = function (id) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var naira = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); };

  /* Map a database status onto the five tabs */
  function group(status) {
    if (status === 'accepted') return 'accepted';
    if (status === 'completed') return 'completed';
    if (status === 'rejected' || status === 'closed' || status === 'declined' || status === 'withdrawn' || status === 'cancelled') return 'declined';   /* cancelled = the customer cancelled the accepted offer (M3/M5): shown under Declined */
    return 'pending';
  }

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min' : ' mins') + ' ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + ' ago';
    var d = Math.floor(h / 24); return d + (d === 1 ? ' day' : ' days') + ' ago';
  }

  /* Split the stored message into the pitch text and the proposed rate */
  function parseMessage(msg) {
    var text = String(msg || '');
    var m = text.match(/\|\s*Proposed rate:\s*([^|]+)/i);
    var rate = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : NaN;
    return { pitch: text.replace(/\|\s*Proposed rate:.*$/i, '').trim(), rate: isNaN(rate) ? null : rate };
  }

  /* ── Data ─────────────────────────────────────────────── */
  async function load() {
    var sess = await window.supabase.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.replace('login.html?next=applications.html'); return; }
    state.user = user;

    var role = null;
    try { role = await window.ST.auth.getUserRole(user); } catch (e) { /* fall back to cache */ }
    role = role || localStorage.getItem('st_role');
    if (role === 'customer') { window.location.replace('dashboard-customer.html?panel=applications'); return; }

    var res = await window.supabase.from('task_applications')
      .select('*, tasks!task_id(id, title, budget, location, category, status, created_at, user_id, customer_id)')
      .eq('tasker_id', user.id).neq('status', 'withdrawn').order('created_at', { ascending: false });   /* a withdrawn offer is kept in the database but not listed */
    if (res.error) { renderError(res.error.message); return; }
    var rows = res.data || [];

    /* Optional extras: customer names and competing offers. Each may be blocked
       by row permissions, in which case the card simply hides that detail. */
    var ownerIds = {}, taskIds = {};
    rows.forEach(function (a) {
      var t = a.tasks || {}; var o = t.customer_id || t.user_id;
      if (o) ownerIds[o] = 1; if (t.id) taskIds[t.id] = 1;
    });
    var names = {}, rivals = {};
    try {
      var ids = Object.keys(ownerIds);
      if (ids.length) {
        var u = await window.supabase.from('users').select('id, name').in('id', ids);
        (u.data || []).forEach(function (r) { names[r.id] = r.name; });
      }
    } catch (e) { /* hide names */ }
    try {
      var tids = Object.keys(taskIds);
      if (tids.length) {
        var c = await window.supabase.from('task_applications').select('task_id, tasker_id').in('task_id', tids).neq('status', 'withdrawn');
        (c.data || []).forEach(function (r) { if (r.tasker_id !== user.id) rivals[r.task_id] = (rivals[r.task_id] || 0) + 1; });
      }
    } catch (e) { /* hide competition */ }

    /* The application row stays "accepted" after the job is finished, so completion is read from the job itself:
       the booking is completed or its payment was released, or the task is marked completed. */
    var doneTasks = {};
    try {
      var acc = rows.filter(function (a) { return a.status === 'accepted' && a.tasks && a.tasks.id; }).map(function (a) { return a.tasks.id; });
      if (acc.length) {
        var bk = await window.supabase.from('bookings').select('task_id, status, payment_status').eq('tasker_id', user.id).in('task_id', acc);
        (bk.data || []).forEach(function (b) {
          if (b.status === 'completed' || b.payment_status === 'released') doneTasks[b.task_id] = true;
        });
      }
    } catch (e) { /* fall back to the task status below */ }

    state.apps = rows.map(function (a) {
      var t = a.tasks || {}; var p = parseMessage(a.message);
      var grp = group(a.status);
      if (grp === 'accepted' && (doneTasks[t.id] || t.status === 'completed')) grp = 'completed';
      return {
        id: a.id, raw: a, task: t, status: a.status, group: grp, created: a.created_at,
        pitch: p.pitch, offer: p.rate != null ? p.rate : (t.budget || null),
        ownerId: t.customer_id || t.user_id || null, customer: names[t.customer_id || t.user_id] || '', rivals: rivals[t.id] || 0,
      };
    });
    await loadMoney(user.id);
    buildCategories(); render();
  }

  /* Escrow held per task (task -> booking -> escrow_payments) and wallet balance.
     Each lookup may be blocked by row permissions; the UI then shows a dash. */
  async function loadMoney(uid) {
    state.escrowTotal = null;
    try {
      var held = await window.supabase.from('escrow_payments').select('booking_id, tasker_amount, status')
        .eq('tasker_id', uid).eq('status', 'held');
      var rows = held.data || [];
      state.escrowTotal = rows.reduce(function (n, r) { return n + Number(r.tasker_amount || 0); }, 0);
      var tids = state.apps.filter(function (a) { return a.group === 'accepted'; }).map(function (a) { return a.task.id; });
      if (rows.length && tids.length) {
        var b = await window.supabase.from('bookings').select('id, task_id').eq('tasker_id', uid).in('task_id', tids);
        var bookingTask = {}; (b.data || []).forEach(function (x) { bookingTask[x.id] = x.task_id; });
        rows.forEach(function (r) { if (bookingTask[r.booking_id]) state.escrowByTask[bookingTask[r.booking_id]] = Number(r.tasker_amount || 0); });
      }
    } catch (e) { /* leave null */ }
    try {
      var w = await window.ST.payments.getWallet(uid);
      state.wallet = w && !w._stub ? Number(w.balance || 0) : null;
    } catch (e) { /* leave null */ }
  }

  function renderMetrics() {
    var a = state.apps, c = { pending: 0, accepted: 0, completed: 0 }, pendingValue = 0, week = 0;
    a.forEach(function (x) {
      if (c[x.group] != null) c[x.group]++;
      if (x.group === 'pending') pendingValue += Number(x.offer || 0);
      if (Date.now() - new Date(x.created).getTime() < 7 * 864e5) week++;
    });
    $('mTotal').textContent = a.length;
    $('mWeek').textContent = week ? '+' + week + ' this week' : '';
    $('mRate').textContent = a.length ? Math.round((c.accepted + c.completed) / a.length * 100) + '%' : '\u2014';
    $('mPending').textContent = naira(pendingValue);
    $('mEscrow').textContent = state.escrowTotal == null ? '\u2014' : naira(state.escrowTotal);
    $('mWallet').textContent = state.wallet == null ? '\u2014' : naira(state.wallet);
    var bar = $('mBar').children, n = a.length || 1;
    bar[0].style.width = (c.pending / n * 100) + '%'; bar[1].style.width = (c.accepted / n * 100) + '%'; bar[2].style.width = (c.completed / n * 100) + '%';
    $('mBarText').textContent = c.pending + ' pending \u2022 ' + c.accepted + ' active \u2022 ' + c.completed + ' done';
  }

  /* ── Render ───────────────────────────────────────────── */
  function buildCategories() {
    var seen = {}, sel = $('apCategory');
    state.apps.forEach(function (a) { if (a.task.category) seen[a.task.category] = 1; });
    Object.keys(seen).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });
  }

  function visible() {
    var q = state.query.toLowerCase();
    var list = state.apps.filter(function (a) {
      if (state.filter !== 'all' && a.group !== state.filter) return false;
      if (state.category && a.task.category !== state.category) return false;
      if (q && (String(a.task.title || '') + ' ' + a.customer).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (x, y) {
      if (state.sort === 'oldest') return new Date(x.created) - new Date(y.created);
      if (state.sort === 'offer') return (y.offer || 0) - (x.offer || 0);
      return new Date(y.created) - new Date(x.created);
    });
    return list;
  }

  function badge(a) {
    var map = {
      pending:   ['ap-badge-pending',   '<span class="ap-badge-dot"></span>Pending Review'],
      accepted:  ['ap-badge-accepted',  icon('circle-check') + 'Accepted \u2022 Ready to Start'],
      declined:  ['ap-badge-declined',  a.status === 'cancelled' ? 'Cancelled by Customer' : 'Declined'],
      completed: ['ap-badge-completed', icon('circle-check') + 'Completed'],
    }[a.group];
    return '<span class="ap-badge ' + map[0] + '">' + map[1] + '</span>';
  }

  function card(a) {
    var t = a.task, g = a.group;
    var loc = t.location ? '<span>' + icon('pin') + esc(t.location) + '</span>' : '';
    var who = a.customer ? '<strong>' + (a.ownerId ? '<a href="client-profile.html?id=' + encodeURIComponent(a.ownerId) + '">' + esc(a.customer) + '</a>' : esc(a.customer)) + '</strong>' : '';
    var posted = t.created_at ? '<span>Posted ' + esc(ago(t.created_at)) + '</span>' : '';
    var sub = '<div class="ap-card-sub">' + who + loc + posted + '</div>';
    var when = g === 'pending' || g === 'declined'
      ? '<span class="ap-meta">' + icon('clock') + 'Applied ' + esc(ago(a.created)) + '</span>'
      : '<span class="ap-meta">' + esc(ago(a.created)) + '</span>';
    var body = '';

    if (g === 'pending' || g === 'declined') {
      var rival = a.rivals > 0
        ? '<div class="ap-fig-text">' + icon('users') + a.rivals + ' other offer' + (a.rivals === 1 ? '' : 's') + ' submitted</div>' : '';
      body += '<div class="ap-figures">' +
        '<div><div class="ap-fig-label">Client Budget</div><div class="ap-fig-value">' + (t.budget ? naira(t.budget) : 'No budget') + '</div></div>' +
        '<div><div class="ap-fig-label">Your Offer</div><div class="ap-fig-value is-offer">' + (a.offer ? naira(a.offer) : '\u2014') + '</div></div>' +
        '<div>' + (rival ? '<div class="ap-fig-label">Competition</div>' + rival : '') + '</div></div>';
    } else {
      body += '<div class="ap-figures"><div><div class="ap-fig-label">' + (g === 'completed' ? 'Payout' : 'Agreed Contract Price') + '</div>' +
        '<div class="ap-fig-value is-offer">' + (a.offer ? naira(a.offer) : '\u2014') + '</div></div></div>';
    }
    if (a.status === 'cancelled') {
      body += '<div class="ap-fig-text">The customer cancelled your accepted offer. The chat is closed and you cannot send another offer on this task.</div>';
    }
    if (a.pitch) {
      body += '<div><div class="ap-proposal-head"><span class="ap-fig-label">Your Submitted Proposal</span></div>' +
        '<p class="ap-quote">\u201C' + esc(a.pitch) + '\u201D</p></div>';
    }
    var id = esc(a.id), taskHref = 'find-tasks.html?task=' + encodeURIComponent(t.id || '');
    var actions = '<div class="ap-actions"><a class="ap-btn" href="' + taskHref + '">View Task Details</a>';
    if (g === 'pending') {
      actions += '<a class="ap-btn ap-btn-text" href="make-offer.html?task=' + encodeURIComponent(t.id || '') + '&amp;edit=1">Edit Offer</a>' +
        '<button type="button" class="ap-btn ap-btn-quiet" data-act="withdraw" data-id="' + id + '">Withdraw Application</button>';
    } else if (g === 'accepted') {
      actions = '<div class="ap-actions">' + (a.ownerId ? '<button type="button" class="ap-btn ap-btn-primary" data-act="message" data-id="' + id + '">' + icon('chat') + 'Message Customer</button>' : '') +
        '<a class="ap-btn" href="dashboard-tasker.html?panel=bookings">View Booking Details</a><a class="ap-btn ap-btn-text" href="' + taskHref + '">View Task</a>';
      if (state.escrowByTask[t.id]) body += '<div class="ap-escrow-line">' + icon('lock') + 'Funds of ' + naira(state.escrowByTask[t.id]) + ' secured in Escrow</div>';
    }
    actions += '</div>';
    return '<article class="ap-card" data-id="' + esc(a.id) + '"><div class="ap-card-top">' + badge(a) + when + '</div>' +
      '<div><h2 class="ap-card-title">' + esc(t.title || 'Task') + '</h2>' + sub + '</div>' + body + actions + '</article>';
  }

  function render() {
    $('apList').setAttribute('aria-busy', 'false');
    var all = state.apps, list = visible(), host = $('apList');
    var counts = { all: all.length, pending: 0, accepted: 0, declined: 0, completed: 0 };
    all.forEach(function (a) { counts[a.group]++; });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var n = counts[el.getAttribute('data-count')]; el.textContent = n > 0 ? n : '';
    });
    renderMetrics();
    var total = $('apTotal'); total.hidden = !all.length; total.textContent = all.length + ' Total';

    if (!all.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">No applications yet</h2>' +
        '<p class="ap-state-text">Browse open tasks and send a proposal to get hired.</p>' +
        '<a class="ap-btn ap-btn-primary" href="find-tasks.html">Browse Open Tasks</a></div>';
      $('apMore').hidden = true; return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Nothing matches</h2>' +
        '<p class="ap-state-text">Try a different tab, search or category.</p></div>';
      $('apMore').hidden = true; return;
    }
    host.innerHTML = list.slice(0, state.shown).map(card).join('');
    $('apMore').hidden = list.length <= state.shown;
  }

  function renderError(msg) {
    $('apList').setAttribute('aria-busy', 'false');
    $('apList').innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Could not load applications</h2><p class="ap-state-text">' + esc(msg) + '</p></div>';
  }

  /* ── Events ───────────────────────────────────────────── */
  function reset() { state.shown = PAGE_SIZE; render(); }
  $('apTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.ap-tab'); if (!b) return;
    state.filter = b.getAttribute('data-filter');
    document.querySelectorAll('.ap-tab').forEach(function (t) { t.setAttribute('aria-pressed', t === b ? 'true' : 'false'); });
    reset();
  });
  $('apSearch').addEventListener('input', function (e) { state.query = e.target.value.trim(); reset(); });
  // Desktop Search button: the list already filters as you type, so this just applies the current text and returns focus
  var searchBtn = $('apSearchBtn');
  if (searchBtn) searchBtn.addEventListener('click', function () { var box = $('apSearch'); state.query = box.value.trim(); reset(); box.focus(); });
  $('apCategory').addEventListener('change', function (e) { state.category = e.target.value; reset(); });
  $('apSort').addEventListener('change', function (e) { state.sort = e.target.value; reset(); });
  $('apMore').addEventListener('click', function () { state.shown += PAGE_SIZE; render(); });

  /* ── Card actions ─────────────────────────────────────── */
  var current = null;
  function findApp(id) { return state.apps.filter(function (a) { return String(a.id) === String(id); })[0]; }
  function wire(dlg) { dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close(); }); }
  wire($('apWithdrawDlg'));

  $('apList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = findApp(b.getAttribute('data-id')); if (!a) return;
    current = a;
    var act = b.getAttribute('data-act');
    if (act === 'withdraw') {
      $('apWdText').textContent = 'Your offer for \u201C' + (a.task.title || 'this task') + '\u201D will be removed and the client will be told. You can apply again later if the task is still open, but this offer still counts towards your offers for the period.';
      $('apWithdrawDlg').showModal();
    } else if (act === 'message') {
      sessionStorage.setItem('st_chat_context', JSON.stringify({
        contextType: 'task_application', contextId: a.id, taskerId: state.user.id, customerId: a.ownerId, senderRole: 'tasker' }));
      window.location.href = 'messages.html';
    }
  });

  $('apWdConfirm').addEventListener('click', async function () {
    var btn = this; btn.disabled = true;
    try {
      await window.withdrawMyApplication(current.id);
      state.apps = state.apps.filter(function (a) { return a !== current; });
      $('apWithdrawDlg').close(); render();
      if (window.showToast) window.showToast('Application withdrawn');
    } catch (x) {
      $('apWithdrawDlg').close();
      if (window.showToast) window.showToast(x.message || 'Could not withdraw');
    }
    btn.disabled = false;
  });

  load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
})();

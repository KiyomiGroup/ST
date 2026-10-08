/* ============================================================
   STREETTASKER — bookings.js
   Tasker "Bookings" page (bookings.html).
   Stage 1: sign-in + role guard, load the tasker's bookings with customer, task and
            service details, map each booking onto a tab group and a label.
   Stage 2: tabs with counts, search, service / date / sort filters, load more,
            full booking cards.
   Stage 3: actions (Confirm, Decline, Message, Mark Done, Enter Code).
   Stage 4: sidebar.  Stage 5: mobile + accessibility.

   Data: bookings where tasker_id = the signed-in user. completion_code is
   deliberately NOT selected here: the code belongs to the customer, and
   ST.payments.submitCompletionCode (Stage 3) checks it.
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var FEE_RATE = 0.12; /* mirrors PLATFORM_COMMISSION in js/payments.js; used only if calculateAmounts is missing */
  var state = { user: null, rows: [], filter: 'all', query: '', category: '', range: 'all', sort: 'recent', shown: PAGE_SIZE };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var icon = function (id) { return '<svg class="bk-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var naira = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); };

  var SIGNOFF = ['provider_done', 'awaiting_code', 'awaiting_confirmation'];

  /* Which tab a booking belongs to:
     pending | progress | signoff | completed | cancelled */
  function group(b) {
    var s = b.status || 'pending';
    if (s === 'completed' || b.payment_status === 'released') return 'completed';
    if (s === 'cancelled') return 'cancelled';
    if (s === 'pending') return 'pending';
    if (SIGNOFF.indexOf(s) !== -1) return 'signoff';
    return 'progress'; /* confirmed, in_progress, disputed */
  }

  function isDisputed(b) { return b.status === 'disputed' || b.payment_status === 'disputed'; }

  /* Badge text and tone for a booking */
  function label(b) {
    var paid = b.payment_status === 'paid';
    if (isDisputed(b)) return { text: 'Under Review', tone: 'danger' };
    switch (group(b)) {
      case 'pending':   return { text: 'New Request', tone: 'warn' };
      case 'signoff':   return { text: 'Sign-Off Pending', tone: 'warn' };
      case 'completed': return { text: 'Completed', tone: 'done' };
      case 'cancelled': return { text: 'Cancelled', tone: 'done' };
      default:          return paid ? { text: 'In Progress', tone: 'progress' } : { text: 'Awaiting Payment', tone: 'warn' };
    }
  }

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min' : ' mins') + ' ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + ' ago';
    var d = Math.floor(h / 24); return d + (d === 1 ? ' day' : ' days') + ' ago';
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  /* "Today, 10:30 AM" / "Tomorrow, 11:00 AM" / "Mon 12 Oct, 2:00 PM" */
  function scheduleText(iso) {
    var d = new Date(iso);
    var diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
    var day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
      : d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
    return day + ', ' + time;
  }

  function customerName(u) {
    if (!u) return '';
    if (u.first_name && u.last_name) return u.first_name + ' ' + u.last_name;
    return u.name || '';
  }

  function initials(name) {
    var parts = String(name || '').replace(/[^a-zA-Z ]/g, '').split(' ').filter(Boolean);
    return (parts.map(function (w) { return w[0]; }).join('').slice(0, 2) || 'C').toUpperCase();
  }

  function refOf(id) { return 'BK-' + String(id || '').replace(/-/g, '').slice(0, 4).toUpperCase(); }

  function payout(amount) {
    try {
      var a = window.ST.payments.calculateAmounts(amount);
      return { fee: a.platformFee, net: a.taskerAmount };
    } catch (e) {
      var fee = Math.round(amount * FEE_RATE);
      return { fee: fee, net: amount - fee };
    }
  }

  /* ── Data ─────────────────────────────────────────────── */
  async function fetchBookings(uid) {
    var sb = window.supabase;
    var base = 'id,customer_id,tasker_id,task_id,service_id,status,payment_status,amount,notes,scheduled_time,created_at,code_attempts';
    var res = await sb.from('bookings').select(base + ',completed_at').eq('tasker_id', uid).order('created_at', { ascending: false });
    if (res.error) {
      /* completed_at may not exist on every deployment: retry without it */
      res = await sb.from('bookings').select(base).eq('tasker_id', uid).order('created_at', { ascending: false });
    }
    if (res.error) throw res.error;
    return res.data || [];
  }

  function unique(rows, key) {
    var seen = {};
    rows.forEach(function (r) { if (r[key]) seen[r[key]] = 1; });
    return Object.keys(seen);
  }

  /* Customer names, task details and service names are optional extras:
     if row permissions block one of them the card just hides that detail.
     colsList is tried in order, so a missing column falls back to a smaller set. */
  async function lookup(table, colsList, ids) {
    if (!ids.length) return {};
    for (var i = 0; i < colsList.length; i++) {
      try {
        var r = await window.supabase.from(table).select(colsList[i]).in('id', ids);
        if (r.error) continue;
        var map = {};
        (r.data || []).forEach(function (x) { map[x.id] = x; });
        return map;
      } catch (e) { /* try the next column set */ }
    }
    return {};
  }

  async function load() {
    var sess = await window.supabase.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.replace('login.html?next=bookings.html'); return; }
    state.user = user;

    var role = null;
    try { role = await window.ST.auth.getUserRole(user); } catch (e) { /* fall back to cache */ }
    role = role || localStorage.getItem('st_role');
    if (role === 'customer') { window.location.replace('dashboard-customer.html?panel=bookings'); return; }

    var rows = await fetchBookings(user.id);
    var people = await lookup('users', ['id,name,first_name,last_name,avatar_url', 'id,name,first_name,last_name'], unique(rows, 'customer_id'));
    var tasks = await lookup('tasks', ['id,title,description,budget,location,category'], unique(rows, 'task_id'));
    var services = await lookup('services', ['*'], unique(rows, 'service_id'));

    state.rows = rows.map(function (b) {
      var t = tasks[b.task_id] || {};
      var s = services[b.service_id] || {};
      var p = people[b.customer_id] || {};
      var title = t.title || s.service_name || s.service || s.title ||
        (b.notes ? String(b.notes).slice(0, 60) : 'Booking request');
      var when = b.scheduled_time || null;
      return {
        id: b.id,
        raw: b,
        ref: refOf(b.id),
        group: group(b),
        disputed: isDisputed(b),
        label: label(b),
        title: title,
        customer: customerName(p) || 'Customer',
        avatar: p.avatar_url || '',
        location: t.location || s.location || '',
        category: t.category || s.category || '',
        amount: Number(b.amount) || 0,
        budget: Number(t.budget) || 0,
        note: b.notes && String(b.notes).trim() !== title ? String(b.notes).trim() : '',
        taskId: t.id || '',
        created: b.created_at,
        scheduled: when,
        when: when ? scheduleText(when) : ''
      };
    });

    fillCategories();
    $('bkTotal').textContent = state.rows.length;
    $('bkTotal').hidden = !state.rows.length;
    render();
  }

  /* ── Filtering ────────────────────────────────────────── */
  function fillCategories() {
    var seen = {};
    state.rows.forEach(function (v) { if (v.category) seen[v.category] = 1; });
    var sel = $('bkCategory');
    Object.keys(seen).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c; sel.appendChild(o);
    });
  }

  /* Everything except the tab: used for both the list and the tab counts */
  function matchesOthers(v) {
    var q = state.query.trim().toLowerCase();
    if (state.category && v.category !== state.category) return false;
    if (state.range !== 'all') {
      var cutoff = Date.now() - Number(state.range) * 86400000;
      if (new Date(v.created).getTime() < cutoff) return false;
    }
    if (q && (v.title + ' ' + v.customer + ' ' + v.ref + ' ' + v.location).toLowerCase().indexOf(q) === -1) return false;
    return true;
  }

  function visible() {
    var list = state.rows.filter(function (v) {
      return matchesOthers(v) && (state.filter === 'all' || v.group === state.filter);
    });
    list.sort(function (x, y) {
      if (state.sort === 'oldest') return new Date(x.created) - new Date(y.created);
      if (state.sort === 'amount') return (y.amount || y.budget) - (x.amount || x.budget);
      if (state.sort === 'upcoming') {
        var a = x.scheduled ? new Date(x.scheduled).getTime() : Infinity;
        var b = y.scheduled ? new Date(y.scheduled).getTime() : Infinity;
        return a === b ? new Date(y.created) - new Date(x.created) : a - b;
      }
      return new Date(y.created) - new Date(x.created);
    });
    return list;
  }

  function updateTabs() {
    var counts = { all: 0, pending: 0, progress: 0, signoff: 0, completed: 0, cancelled: 0 };
    state.rows.forEach(function (v) { if (matchesOthers(v)) { counts.all++; counts[v.group]++; } });
    document.querySelectorAll('#bkTabs .bk-tab').forEach(function (btn) {
      var f = btn.dataset.filter;
      btn.setAttribute('aria-pressed', f === state.filter ? 'true' : 'false');
      var n = btn.querySelector('.bk-tab-n');
      if (n) n.textContent = counts[f] || '';
    });
  }

  /* ── Render ───────────────────────────────────────────── */
  function badge(v) {
    var dot = v.label.tone === 'done' ? icon('circle-check') : '<span class="bk-badge-dot"></span>';
    return '<span class="bk-badge bk-badge-' + v.label.tone + '">' + dot + esc(v.label.text) + '</span>';
  }

  /* Money tag under the amount */
  function moneyTag(v) {
    var p = v.raw.payment_status || 'unpaid';
    if (v.group === 'completed' || p === 'released') return '<span class="bk-tag">' + icon('wallet') + 'Paid to Wallet</span>';
    if (v.group === 'cancelled') return '';
    if (v.disputed) return '<span class="bk-tag bk-tag-muted">' + icon('lock') + 'Payment Frozen</span>';
    if (p === 'paid') return '<span class="bk-tag">' + icon('lock') + 'Held in Escrow</span>';
    if (v.group === 'pending') return '<span class="bk-tag bk-tag-muted">Client Budget</span>';
    return '<span class="bk-tag bk-tag-muted">Awaiting Payment</span>';
  }

  /* One plain-language line telling the tasker what happens next */
  function hint(v) {
    var paid = v.raw.payment_status === 'paid';
    if (v.disputed) return { tone: 'danger', text: 'A dispute is open. Payment stays frozen while our team reviews it.' };
    switch (v.group) {
      case 'pending':   return { tone: '', text: 'Confirm this request to start messaging the customer. They then pay into escrow before you start.' };
      case 'progress':  return paid
        ? { tone: '', text: 'Payment is secured in escrow. Complete the job, then mark it as done.' }
        : { tone: 'warn', text: 'Waiting for the customer to pay into escrow. Don\u2019t start work until payment is secured.' };
      case 'signoff':   return { tone: 'warn', text: 'Waiting for the customer to sign off. Once they confirm, enter their 6-digit code to receive your payment.' };
      case 'completed': return { tone: 'muted', text: 'Job complete. Your payout has been released to your wallet.' };
      default:          return { tone: 'muted', text: 'This booking was cancelled.' };
    }
  }

  function avatar(v) {
    return '<span class="bk-avatar">' + (v.avatar ? '<img src="' + esc(v.avatar) + '" alt="" loading="lazy" />' : esc(initials(v.customer))) + '</span>';
  }

  function figures(v) {
    var amt = v.amount;
    if (!amt || v.group === 'pending' || v.group === 'cancelled') return '';
    var p = payout(amt);
    var earned = v.group === 'completed';
    return '<div class="bk-figures">' +
      '<div><div class="bk-fig-label">Job Value</div><div class="bk-fig-value">' + naira(amt) + '</div></div>' +
      '<div><div class="bk-fig-label">Platform Fee (12%)</div><div class="bk-fig-value">' + naira(p.fee) + '</div></div>' +
      '<div><div class="bk-fig-label">' + (earned ? 'You Earned' : 'You Receive') + '</div><div class="bk-fig-value is-green">' + naira(p.net) + '</div></div></div>';
  }

  function card(v) {
    var shown = v.amount || v.budget;
    var when = v.when
      ? '<span class="bk-meta">' + icon('calendar') + esc(v.when) + '</span>'
      : '<span class="bk-meta">' + icon('clock') + 'Requested ' + esc(ago(v.created)) + '</span>';
    var h = hint(v);
    var links = '';
    if (v.taskId) links += '<a class="bk-btn bk-btn-text" href="find-tasks.html?task=' + encodeURIComponent(v.taskId) + '">View Task Details' + icon('arrow-right') + '</a>';
    if (v.group === 'completed') links += '<a class="bk-btn bk-btn-text" href="wallet.html">' + icon('wallet') + 'View in Wallet</a>';

    return '<article class="bk-card is-' + v.group + (v.disputed ? ' is-disputed' : '') + '" data-id="' + esc(v.id) + '">' +
      '<div class="bk-card-top"><div>' +
        '<div class="bk-card-id"><span class="bk-ref">#' + esc(v.ref) + '</span>' + badge(v) + when + '</div>' +
        '<h2 class="bk-card-title">' + esc(v.title) + '</h2></div>' +
        '<div class="bk-card-amount">' + (shown ? '<span class="bk-amount">' + naira(shown) + '</span>' : '') + moneyTag(v) + '</div></div>' +
      '<div class="bk-person">' + avatar(v) + '<div class="bk-person-body"><span class="bk-person-name">' + esc(v.customer) + '</span>' +
        '<div class="bk-person-sub">' + (v.location ? '<span>' + icon('pin') + esc(v.location) + '</span>' : '') +
        (v.category ? '<span>' + esc(v.category) + '</span>' : '') + '</div></div></div>' +
      figures(v) +
      (v.note ? '<div><div class="bk-quote-label">Customer Note</div><p class="bk-quote">\u201C' + esc(v.note) + '\u201D</p></div>' : '') +
      '<div class="bk-hint' + (h.tone ? ' is-' + h.tone : '') + '">' + icon('info') + '<span>' + esc(h.text) + '</span></div>' +
      (links ? '<div class="bk-actions">' + links + '</div>' : '') +
    '</article>';
  }

  function render() {
    var list = $('bkList');
    list.setAttribute('aria-busy', 'false');
    updateTabs();

    if (!state.rows.length) {
      $('bkMore').hidden = true;
      list.innerHTML = '<div class="bk-state"><h2 class="bk-state-title">No bookings yet</h2>' +
        '<p class="bk-state-text">When a customer books you, or accepts your offer on a task, it will show up here.</p>' +
        '<a class="bk-btn bk-btn-primary" href="find-tasks.html">Browse Open Tasks</a></div>';
      return;
    }

    var all = visible();
    if (!all.length) {
      $('bkMore').hidden = true;
      list.innerHTML = '<div class="bk-state"><h2 class="bk-state-title">No bookings match</h2>' +
        '<p class="bk-state-text">Try a different tab, search or filter.</p>' +
        '<button type="button" class="bk-btn" id="bkClear">Clear Filters</button></div>';
      return;
    }
    list.innerHTML = all.slice(0, state.shown).map(card).join('');
    $('bkMore').hidden = all.length <= state.shown;
  }

  function renderError(msg) {
    var list = $('bkList');
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = '<div class="bk-state"><h2 class="bk-state-title">We couldn\u2019t load your bookings</h2>' +
      '<p class="bk-state-text">' + esc(msg || 'Something went wrong.') + '</p>' +
      '<button type="button" class="bk-btn bk-btn-primary" id="bkRetry">Try Again</button></div>';
  }

  function start() {
    load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
  }

  function resetFilters() {
    state.filter = 'all'; state.query = ''; state.category = ''; state.range = 'all'; state.sort = 'recent'; state.shown = PAGE_SIZE;
    $('bkSearch').value = ''; $('bkCategory').value = ''; $('bkRange').value = 'all'; $('bkSort').value = 'recent';
    render();
  }

  /* ── Events ───────────────────────────────────────────── */
  $('bkTabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.bk-tab');
    if (!btn) return;
    state.filter = btn.dataset.filter; state.shown = PAGE_SIZE; render();
  });
  var searchTimer;
  $('bkSearch').addEventListener('input', function (e) {
    var val = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.query = val; state.shown = PAGE_SIZE; render(); }, 150);
  });
  $('bkCategory').addEventListener('change', function (e) { state.category = e.target.value; state.shown = PAGE_SIZE; render(); });
  $('bkRange').addEventListener('change', function (e) { state.range = e.target.value; state.shown = PAGE_SIZE; render(); });
  $('bkSort').addEventListener('change', function (e) { state.sort = e.target.value; state.shown = PAGE_SIZE; render(); });
  $('bkMore').addEventListener('click', function () { state.shown += PAGE_SIZE; render(); });
  $('bkList').addEventListener('click', function (e) {
    if (e.target.closest('#bkClear')) resetFilters();
    if (e.target.closest('#bkRetry')) {
      $('bkList').setAttribute('aria-busy', 'true');
      $('bkList').innerHTML = '<div class="bk-state"><p class="bk-state-text">Loading your bookings\u2026</p></div>';
      start();
    }
  });
  /* A customer photo that fails to load falls back to initials */
  $('bkList').addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var holder = img.parentNode, name = holder.parentNode.querySelector('.bk-person-name');
    holder.textContent = initials(name ? name.textContent : '');
  }, true);

  start();
})();

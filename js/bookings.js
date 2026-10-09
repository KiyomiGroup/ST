/* ============================================================
   STREETTASKER — bookings.js
   Tasker "Bookings" page (bookings.html).
   Stage 1: sign-in + role guard, load the tasker's bookings with customer, task and
            service details, map each booking onto a tab group and a label.
   Stage 2: tabs with counts, search, service / date / sort filters, load more,
            full booking cards.
   Stage 3: actions: Confirm, Decline, Message Customer, Mark Job Done, Enter Code.
            Mark Done now sets status provider_done (waiting on the customer);
            the customer's confirmation sets awaiting_confirmation (enter the code).
   Stage 4: sidebar snapshot (counts and money worked out from the loaded bookings).
   Stage 5: mobile filter toggle, screen-reader status, focus handling, card labelling.

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

  var MAX_CODE_TRIES = 3; /* mirrors the limit in ST.payments.submitCompletionCode */
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
        customerId: b.customer_id || '',
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
      case 'signoff':   return (v.raw.status !== 'provider_done' && (Number(v.raw.code_attempts) || 0) >= MAX_CODE_TRIES)
        ? { tone: 'danger', text: 'Too many incorrect code attempts. Please contact support to release this payment.' }
        : v.raw.status === 'provider_done'
        ? { tone: 'warn', text: 'You marked this job as done. Waiting for the customer to confirm it.' }
        : { tone: '', text: 'The customer confirmed the job. Ask them for their 6-digit code and enter it to receive your payment.' };
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

  /* Buttons for a booking, depending on where it is in the job */
  function actions(v) {
    var id = esc(v.id), st = v.raw.status || 'pending', paid = v.raw.payment_status === 'paid';
    var msg = '<button type="button" class="bk-btn" data-act="message" data-id="' + id + '">' + icon('chat') + 'Message Customer</button>';
    if (v.group === 'pending') {
      return '<button type="button" class="bk-btn bk-btn-primary" data-act="confirm" data-id="' + id + '">' + icon('check') + 'Confirm Booking</button>' +
        (paid ? '' : '<button type="button" class="bk-btn bk-btn-quiet" data-act="decline" data-id="' + id + '">Decline</button>');
    }
    if (v.disputed) return msg;
    if (v.group === 'progress') {
      return (paid ? '<button type="button" class="bk-btn bk-btn-primary" data-act="done" data-id="' + id + '">' + icon('check') + 'Mark Job as Done</button>' : '') + msg;
    }
    if (v.group === 'signoff') {
      if (st === 'provider_done') return '<button type="button" class="bk-btn bk-btn-primary" disabled>Awaiting Customer Sign-Off</button>' + msg;
      var left = Math.max(0, MAX_CODE_TRIES - (Number(v.raw.code_attempts) || 0));
      if (!left) return '<button type="button" class="bk-btn bk-btn-primary" disabled>Code Locked</button>' + msg;
      return '<button type="button" class="bk-btn bk-btn-primary" data-act="code" data-id="' + id + '">' + icon('lock') + 'Enter Completion Code</button>' + msg;
    }
    return '';
  }

  function card(v) {
    var shown = v.amount || v.budget;
    var when = v.when
      ? '<span class="bk-meta">' + icon('calendar') + esc(v.when) + '</span>'
      : '<span class="bk-meta">' + icon('clock') + 'Requested ' + esc(ago(v.created)) + '</span>';
    var h = hint(v);
    var links = actions(v);
    if (v.taskId) links += '<a class="bk-btn bk-btn-text" href="find-tasks.html?task=' + encodeURIComponent(v.taskId) + '">View Task Details' + icon('arrow-right') + '</a>';
    if (v.group === 'completed') links += '<a class="bk-btn bk-btn-text" href="wallet.html">' + icon('wallet') + 'View in Wallet</a>';

    return '<article class="bk-card is-' + v.group + (v.disputed ? ' is-disputed' : '') + '" data-id="' + esc(v.id) + '" tabindex="-1" aria-labelledby="bkt-' + esc(v.id) + '">' +
      '<div class="bk-card-top"><div>' +
        '<div class="bk-card-id"><span class="bk-ref">#' + esc(v.ref) + '</span>' + badge(v) + when + '</div>' +
        '<h2 class="bk-card-title" id="bkt-' + esc(v.id) + '">' + esc(v.title) + '</h2></div>' +
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

  /* Screen-reader status line (the list itself is not a live region, so a re-render doesn't re-read every card) */
  function announce(text) { var el = $('bkStatus'); if (el) el.textContent = text; }

  /* Dot on the phone filter button while any filter other than the defaults is on */
  function markFilters() {
    var on = !!(state.query.trim() || state.category || state.range !== 'all' || state.sort !== 'recent');
    $('bkFilterDot').hidden = !on;
  }

  /* After a card changes, keep keyboard and screen-reader focus on it (or on the tab it moved out of) */
  function focusCard(id) {
    var el = Array.prototype.filter.call($('bkList').children, function (c) { return c.dataset && String(c.dataset.id) === String(id); })[0];
    if (el) { el.focus(); return; }
    var tab = document.querySelector('#bkTabs .bk-tab[aria-pressed="true"]');
    if (tab) tab.focus();
  }

  /* Sidebar numbers come from every loaded booking, ignoring the filters */
  function renderSide() {
    var pending = 0, active = 0, done = 0, escrow = 0, ready = 0, paid = 0, waiting = 0;
    state.rows.forEach(function (v) {
      var net = v.amount ? payout(v.amount).net : 0;
      if (v.group === 'pending') pending++;
      else if (v.group === 'completed') { done++; paid += net; }
      else if (v.group === 'progress' || v.group === 'signoff') {
        active++;
        if (v.raw.payment_status === 'paid' && !v.disputed) {
          escrow += net;
          if (v.group === 'signoff' && v.raw.status !== 'provider_done' && (Number(v.raw.code_attempts) || 0) < MAX_CODE_TRIES) ready += net;
        }
        if (v.group === 'signoff' && v.raw.status === 'provider_done') waiting++;
      }
    });
    $('sPending').textContent = pending;
    $('sActive').textContent = active;
    $('sActiveSub').textContent = waiting ? waiting + ' awaiting sign-off' : 'in progress';
    $('sEscrow').textContent = naira(escrow);
    $('sReady').textContent = naira(ready);
    $('sPaid').textContent = naira(paid);
    var n = pending + active + done, bar = $('sBar').children, pct = function (x) { return (n ? x / n * 100 : 0) + '%'; };
    bar[0].style.width = pct(pending); bar[1].style.width = pct(active); bar[2].style.width = pct(done);
    $('sBarText').textContent = n ? pending + ' new \u2022 ' + active + ' active \u2022 ' + done + ' completed' : 'No bookings yet';
  }

  function render() {
    var list = $('bkList');
    list.setAttribute('aria-busy', 'false');
    updateTabs();
    renderSide();
    markFilters();

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
      announce('No bookings match your filters');
      list.innerHTML = '<div class="bk-state"><h2 class="bk-state-title">No bookings match</h2>' +
        '<p class="bk-state-text">Try a different tab, search or filter.</p>' +
        '<button type="button" class="bk-btn" id="bkClear">Clear Filters</button></div>';
      return;
    }
    list.innerHTML = all.slice(0, state.shown).map(card).join('');
    $('bkMore').hidden = all.length <= state.shown;
    announce(all.length + (all.length === 1 ? ' booking' : ' bookings') + ' shown');
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

  /* ── Actions ──────────────────────────────────────────── */
  var current = null; /* the booking an open dialog is about */
  var toast = function (m) { if (window.showToast) window.showToast(m); };
  var find = function (id) { return state.rows.filter(function (v) { return String(v.id) === String(id); })[0]; };

  /* Apply a change to a booking and redraw its tab, counts and card */
  function patch(v, changes) {
    Object.assign(v.raw, changes);
    v.group = group(v.raw); v.disputed = isDisputed(v.raw); v.label = label(v.raw);
    render();
    focusCard(v.id);
  }

  async function notify(userId, type, title, message, bookingId) {
    if (!userId) return;
    try {
      await window.supabase.from('notifications').insert({
        user_id: userId, type: type, title: title, message: message, data: { booking_id: bookingId }, is_read: false
      });
    } catch (e) { /* notifications are best effort */ }
  }

  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }

  async function setStatus(v, from, to) {
    var r = await window.supabase.from('bookings').update({ status: to }).eq('id', v.id).eq('status', from).select('id').maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new Error('This booking was just updated somewhere else. Refresh the page and try again.');
  }

  async function doConfirm(v, btn) {
    btn.disabled = true;
    try {
      await setStatus(v, 'pending', 'confirmed');
      await notify(v.customerId, 'booking_confirmed', 'Booking Confirmed \u2705', 'Your booking has been confirmed by the service provider.', v.id);
      patch(v, { status: 'confirmed' });
      toast('Booking confirmed. The customer has been notified.');
    } catch (e) { btn.disabled = false; toast(e.message || 'Could not confirm this booking.'); }
  }

  function openDialog(id, v, textId, text) {
    current = v;
    if (textId) $(textId).textContent = text;
    $(id).showModal();
  }

  async function doDecline() {
    var v = current, btn = $('bkDeclineGo'); if (!v) return;
    btn.disabled = true; showError($('bkDeclineError'), '');
    try {
      await setStatus(v, 'pending', 'cancelled');
      await notify(v.customerId, 'booking_declined', 'Booking Declined', 'The service provider can\u2019t take this booking. You have not been charged.', v.id);
      $('bkDeclineDlg').close();
      patch(v, { status: 'cancelled' });
      toast('Booking declined.');
    } catch (e) { showError($('bkDeclineError'), e.message || 'Could not decline this booking.'); }
    btn.disabled = false;
  }

  async function doDone() {
    var v = current, btn = $('bkDoneGo'); if (!v) return;
    btn.disabled = true; showError($('bkDoneError'), '');
    try {
      await window.ST.payments.markJobDone(v.id);
      $('bkDoneDlg').close();
      patch(v, { status: 'provider_done' });
      toast('Job marked as done. The customer has been asked to confirm.');
    } catch (e) { showError($('bkDoneError'), e.message || 'Could not mark this job as done.'); }
    btn.disabled = false;
  }

  function openCode(v) {
    current = v;
    var left = Math.max(0, MAX_CODE_TRIES - (Number(v.raw.code_attempts) || 0));
    $('bkCodeInput').value = ''; showError($('bkCodeError'), '');
    $('bkCodeText').textContent = 'The customer gives you a 6-digit code after confirming the job is done. Enter it to release your payment to your wallet. ' +
      left + (left === 1 ? ' attempt' : ' attempts') + ' left.';
    $('bkCodeDlg').showModal();
    $('bkCodeInput').focus();
  }

  async function doCode(e) {
    e.preventDefault();
    var v = current, btn = $('bkCodeGo'), input = $('bkCodeInput'); if (!v) return;
    var code = input.value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) { showError($('bkCodeError'), 'Enter the 6-digit code.'); return; }
    btn.disabled = true; btn.textContent = 'Verifying\u2026'; showError($('bkCodeError'), '');
    try {
      await window.ST.payments.submitCompletionCode(v.id, code);
      $('bkCodeDlg').close();
      patch(v, { status: 'completed', payment_status: 'released' });
      toast('Payment released to your wallet.');
    } catch (err) {
      var m = err && err.message ? err.message : 'Could not verify the code.';
      showError($('bkCodeError'), m);
      if (/^Incorrect code/.test(m)) { v.raw.code_attempts = (Number(v.raw.code_attempts) || 0) + 1; render(); }
    }
    btn.disabled = false; btn.textContent = 'Claim Payment';
  }

  /* Open the booking's chat on the Messages page */
  function openChat(v) {
    try {
      sessionStorage.setItem('st_chat_context', JSON.stringify({
        contextType: 'booking', contextId: v.id, taskerId: state.user.id, customerId: v.customerId, senderRole: 'tasker'
      }));
    } catch (e) { /* storage blocked: Messages still opens */ }
    window.location.href = 'messages.html';
  }

  function onAction(btn) {
    var v = find(btn.dataset.id); if (!v) return;
    switch (btn.dataset.act) {
      case 'confirm': doConfirm(v, btn); break;
      case 'decline': showError($('bkDeclineError'), ''); openDialog('bkDeclineDlg', v, 'bkDeclineText',
        'Decline \u201C' + v.title + '\u201D from ' + v.customer + '? They will be told you can\u2019t take it, and they have not been charged.'); break;
      case 'done':    showError($('bkDoneError'), ''); openDialog('bkDoneDlg', v, 'bkDoneText',
        'The customer will be asked to confirm the job is complete. Once they do, you enter their 6-digit code to receive ' + naira(payout(v.amount).net) + ' in your wallet.'); break;
      case 'code':    openCode(v); break;
      case 'message': openChat(v); break;
    }
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
    var act = e.target.closest('[data-act]');
    if (act) onAction(act);
    if (e.target.closest('#bkClear')) resetFilters();
    if (e.target.closest('#bkRetry')) {
      $('bkList').setAttribute('aria-busy', 'true');
      $('bkList').innerHTML = '<div class="bk-state"><p class="bk-state-text">Loading your bookings\u2026</p></div>';
      start();
    }
  });
  $('bkFilterBtn').addEventListener('click', function () {
    var open = $('bkToolbar').classList.toggle('is-open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.setAttribute('aria-label', open ? 'Hide filters' : 'Show filters');
    if (open) $('bkSearch').focus();
  });
  document.querySelectorAll('.bk-dialog').forEach(function (dlg) {
    dlg.addEventListener('click', function (e) { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  });
  $('bkDeclineGo').addEventListener('click', doDecline);
  $('bkDoneGo').addEventListener('click', doDone);
  $('bkCodeForm').addEventListener('submit', doCode);
  $('bkCodeInput').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
  /* A customer photo that fails to load falls back to initials */
  $('bkList').addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var holder = img.parentNode, name = holder.parentNode.querySelector('.bk-person-name');
    holder.textContent = initials(name ? name.textContent : '');
  }, true);

  start();
})();

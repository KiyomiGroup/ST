/* ============================================================
   STREETTASKER — bookings.js
   Tasker "Bookings" page (bookings.html).
   Stage 1: sign-in + role guard, load the tasker's bookings with customer, task and
            service details, map each booking onto a tab group and a label, render
            basic rows.
   Stage 2: tabs, search, filters, full booking cards.
   Stage 3: actions (Confirm, Decline, Message, Mark Done, Enter Code).
   Stage 4: sidebar.  Stage 5: mobile + accessibility.

   Data: bookings where tasker_id = the signed-in user. completion_code is
   deliberately NOT selected here: the code belongs to the customer, and
   ST.payments.submitCompletionCode (Stage 3) checks it.
   ============================================================ */
(function () {
  'use strict';

  var state = { user: null, rows: [] };

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

  /* Badge text and tone for a booking */
  function label(b) {
    var s = b.status || 'pending';
    var paid = b.payment_status === 'paid';
    if (s === 'disputed' || b.payment_status === 'disputed') return { text: 'Under Review', tone: 'danger' };
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
     if row permissions block one of them the card just hides that detail. */
  async function lookup(table, cols, ids) {
    if (!ids.length) return {};
    var map = {};
    try {
      var r = await window.supabase.from(table).select(cols).in('id', ids);
      (r.data || []).forEach(function (x) { map[x.id] = x; });
    } catch (e) { /* optional */ }
    return map;
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
    var people = await lookup('users', 'id,name,first_name,last_name', unique(rows, 'customer_id'));
    var tasks = await lookup('tasks', 'id,title,description,budget,location,category', unique(rows, 'task_id'));
    var services = await lookup('services', '*', unique(rows, 'service_id'));

    state.rows = rows.map(function (b) {
      var t = tasks[b.task_id] || {};
      var s = services[b.service_id] || {};
      var title = t.title || s.service_name || s.service || s.title ||
        (b.notes ? String(b.notes).slice(0, 60) : 'Booking request');
      return {
        id: b.id,
        raw: b,
        group: group(b),
        label: label(b),
        title: title,
        customer: customerName(people[b.customer_id]) || 'Customer',
        location: t.location || s.location || '',
        category: t.category || s.category || '',
        amount: Number(b.amount) || Number(t.budget) || 0,
        created: b.created_at,
        when: b.scheduled_time ? scheduleText(b.scheduled_time) : ''
      };
    });

    render();
  }

  /* ── Render (basic rows; full cards arrive in Stage 2) ── */
  function row(v) {
    var sub = '<span><strong>' + esc(v.customer) + '</strong></span>' +
      (v.location ? '<span>' + icon('pin') + esc(v.location) + '</span>' : '') +
      (v.when ? '<span>' + icon('calendar') + esc(v.when) + '</span>'
              : '<span>' + icon('clock') + 'Requested ' + esc(ago(v.created)) + '</span>');
    return '<article class="bk-row" data-id="' + esc(v.id) + '">' +
      '<div class="bk-row-main"><h2 class="bk-row-title">' + esc(v.title) + '</h2><div class="bk-row-sub">' + sub + '</div></div>' +
      '<div class="bk-row-side"><span class="bk-badge bk-badge-' + v.label.tone + '"><span class="bk-badge-dot"></span>' + esc(v.label.text) + '</span>' +
      (v.amount ? '<span class="bk-amount">' + naira(v.amount) + '</span>' : '') + '</div></article>';
  }

  function render() {
    var list = $('bkList');
    list.setAttribute('aria-busy', 'false');
    var total = $('bkTotal');
    if (state.rows.length) { total.textContent = state.rows.length; total.hidden = false; } else { total.hidden = true; }

    if (!state.rows.length) {
      list.innerHTML = '<div class="bk-state"><h2 class="bk-state-title">No bookings yet</h2>' +
        '<p class="bk-state-text">When a customer books you, or accepts your offer on a task, it will show up here.</p>' +
        '<a class="bk-btn bk-btn-primary" href="find-tasks.html">Browse Open Tasks</a></div>';
      return;
    }
    list.innerHTML = state.rows.map(row).join('');
  }

  function renderError(msg) {
    var list = $('bkList');
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = '<div class="bk-state"><h2 class="bk-state-title">We couldn\u2019t load your bookings</h2>' +
      '<p class="bk-state-text">' + esc(msg || 'Something went wrong.') + '</p>' +
      '<button type="button" class="bk-btn bk-btn-primary" id="bkRetry">Try Again</button></div>';
    var retry = $('bkRetry');
    if (retry) retry.addEventListener('click', function () {
      list.setAttribute('aria-busy', 'true');
      list.innerHTML = '<div class="bk-state"><p class="bk-state-text">Loading your bookings\u2026</p></div>';
      load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
    });
  }

  load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
})();

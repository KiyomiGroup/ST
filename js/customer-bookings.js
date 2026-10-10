/* ============================================================
   STREETTASKER — customer-bookings.js
   Customer "Bookings" page (customer-bookings.html). Customer counterpart of js/bookings.js.
   Replaces the old Bookings panel in dashboard-customer.html.

   - Sign-in + role guard, loads the customer's bookings with provider, task and service details.
   - Tabs with counts, search, service / date / sort filters, load more, compact cards.
   - Actions: Pay Now (wallet, gift cards, Paystack), Confirm Job Done (returns the 6-digit code),
     Show My Code, Report an Issue, Message Provider.
   - Sidebar snapshot worked out from all loaded bookings, ignoring the filters.

   Job flow (same as the provider page, seen from the customer's side):
   pending -> confirmed (provider accepts) -> paid (you pay into escrow) -> provider_done (provider says done)
   -> awaiting_confirmation (you confirm, get the code) -> completed (provider enters the code, payout released).

   completion_code is NOT selected with the list. It is only read when the customer asks to see it.
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var FEE_RATE = 0.12; /* mirrors PLATFORM_COMMISSION in js/payments.js; used only if calculateAmounts is missing */
  var MAX_CODE_TRIES = 3; /* mirrors the limit in ST.payments.submitCompletionCode */
  var SIGNOFF = ['provider_done', 'awaiting_code', 'awaiting_confirmation'];
  var state = { user: null, rows: [], filter: 'all', query: '', category: '', range: 'all', sort: 'recent', shown: PAGE_SIZE };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var icon = function (id) { return '<svg class="bk-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var naira = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); };
  var safeUrl = function (u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; };

  /* Which tab a booking belongs to: pending | progress | signoff | completed | cancelled */
  function group(b) {
    var s = b.status || 'pending';
    if (s === 'completed' || b.payment_status === 'released') return 'completed';
    if (s === 'cancelled') return 'cancelled';
    if (s === 'pending') return 'pending';
    if (SIGNOFF.indexOf(s) !== -1) return 'signoff';
    return 'progress'; /* confirmed, in_progress, disputed */
  }

  function isDisputed(b) { return b.status === 'disputed' || b.payment_status === 'disputed'; }
  function isPaid(b) { return b.payment_status === 'paid'; }
  function codeLocked(b) { return b.status !== 'provider_done' && (Number(b.code_attempts) || 0) >= MAX_CODE_TRIES; }

  /* Badge text and tone for a booking */
  function label(b) {
    if (isDisputed(b)) return { text: 'Under Review', tone: 'danger' };
    switch (group(b)) {
      case 'pending':   return { text: 'Awaiting Provider', tone: 'warn' };
      case 'signoff':   return b.status === 'provider_done' ? { text: 'Please Confirm', tone: 'warn' } : { text: 'Code Ready', tone: 'progress' };
      case 'completed': return { text: 'Completed', tone: 'done' };
      case 'cancelled': return { text: 'Cancelled', tone: 'done' };
      default:          return isPaid(b) ? { text: 'In Progress', tone: 'progress' } : { text: 'Payment Needed', tone: 'warn' };
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

  /* scheduled_time is saved in more than one format: a real timestamp, "2026-10-12T14:00",
     or free text like "2026-10-12 \u2014 14:00" from the tasker profile form.
     Returns { date, hasTime }, or null when nothing readable is in it. (Same as js/bookings.js.) */
  function parseWhen(raw) {
    if (!raw) return null;
    var s = String(raw).trim(), d, m;
    if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) { d = new Date(s); return isNaN(d) ? null : { date: d, hasTime: true }; }
    m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:\D+(\d{1,2}):(\d{2}))?/);
    if (m) {
      d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
      return isNaN(d) ? null : { date: d, hasTime: !!m[4] };
    }
    d = new Date(s);
    return isNaN(d) ? null : { date: d, hasTime: true };
  }

  /* "Today, 10:30 AM" / "Tomorrow" / "Mon, 12 Oct, 2:00 PM" */
  function scheduleText(p) {
    var d = p.date;
    var diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
    var day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
      : d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!p.hasTime) return day;
    return day + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
  }

  function initials(name) {
    var parts = String(name || '').replace(/[^a-zA-Z ]/g, '').split(' ').filter(Boolean);
    return (parts.map(function (w) { return w[0]; }).join('').slice(0, 2) || 'P').toUpperCase();
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
    var res = await sb.from('bookings').select(base + ',completed_at').eq('customer_id', uid).order('created_at', { ascending: false });
    if (res.error) {
      /* completed_at may not exist on every deployment: retry without it */
      res = await sb.from('bookings').select(base).eq('customer_id', uid).order('created_at', { ascending: false });
    }
    if (res.error) throw res.error;
    return res.data || [];
  }

  function unique(rows, key) {
    var seen = {};
    rows.forEach(function (r) { if (r[key]) seen[r[key]] = 1; });
    return Object.keys(seen);
  }

  /* Provider, task and service details are optional extras: if row permissions block one of them
     the card just hides that detail. colsList is tried in order, so a missing column falls back to a smaller set. */
  async function lookup(table, colsList, ids, key) {
    if (!ids.length) return {};
    for (var i = 0; i < colsList.length; i++) {
      try {
        var r = await window.supabase.from(table).select(colsList[i]).in(key || 'id', ids);
        if (r.error) continue;
        var map = {};
        (r.data || []).forEach(function (x) { map[x[key || 'id']] = x; });
        return map;
      } catch (e) { /* try the next column set */ }
    }
    return {};
  }

  async function fetchAll() {
    var rows = await fetchBookings(state.user.id);
    var providerIds = unique(rows, 'tasker_id');
    /* bookings.tasker_id is the provider's user id: taskers are matched on user_id, users on id */
    var profiles = await lookup('taskers', ['user_id,name,service,service_name,business_name,location,category,photo_url', '*'], providerIds, 'user_id');
    var people = await lookup('users', ['id,name,first_name,last_name,business_name,avatar_url', 'id,name,avatar_url', 'id,name'], providerIds, 'id');
    var tasks = await lookup('tasks', ['id,title,description,budget,location,category'], unique(rows, 'task_id'), 'id');
    var services = await lookup('services', ['*'], unique(rows, 'service_id'), 'id');

    return rows.map(function (b) {
      var t = tasks[b.task_id] || {};
      var s = services[b.service_id] || {};
      var tp = profiles[b.tasker_id] || {};
      var u = people[b.tasker_id] || {};
      var userName = u.first_name && u.last_name ? u.first_name + ' ' + u.last_name : u.name;
      var provider = tp.business_name || u.business_name || tp.name || userName || 'Service provider';
      var title = t.title || s.service_name || s.service || s.title || tp.service_name || tp.service ||
        (b.notes ? String(b.notes).slice(0, 60) : 'Service booking');
      var when = parseWhen(b.scheduled_time);
      return {
        id: b.id,
        raw: b,
        ref: refOf(b.id),
        group: group(b),
        disputed: isDisputed(b),
        label: label(b),
        title: title,
        provider: provider,
        avatar: safeUrl(tp.photo_url || u.avatar_url || ''),
        location: t.location || s.location || tp.location || '',
        category: t.category || s.category || tp.category || '',
        amount: Number(b.amount) || 0,
        budget: Number(t.budget) || 0,
        note: b.notes && String(b.notes).trim() !== title ? String(b.notes).trim() : '',
        taskerId: b.tasker_id || '',
        taskId: t.id || '',
        created: b.created_at,
        scheduled: when ? when.date.toISOString() : null,
        when: when ? scheduleText(when) : ''
      };
    });
  }

  async function load() {
    var sess = await window.supabase.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.replace('login.html?next=customer-bookings.html'); return; }
    state.user = user;

    var role = null;
    try { role = await window.ST.auth.getUserRole(user); } catch (e) { /* fall back to cache */ }
    role = role || localStorage.getItem('st_role');
    if (role === 'tasker') { window.location.replace('bookings.html'); return; }

    state.rows = await fetchAll();
    fillCategories();
    showTotal();
    render();
  }

  /* Re-read everything from the database (after a payment) and redraw, keeping the filters */
  async function refresh(focusId) {
    try {
      state.rows = await fetchAll();
      showTotal();
      render();
      if (focusId) focusCard(focusId);
    } catch (e) { toast('Could not refresh your bookings. Reload the page to see the latest.'); }
  }

  function showTotal() {
    $('bkTotal').textContent = state.rows.length;
    $('bkTotal').hidden = !state.rows.length;
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
    if (q && (v.title + ' ' + v.provider + ' ' + v.ref + ' ' + v.location).toLowerCase().indexOf(q) === -1) return false;
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
    if (v.group === 'completed' || p === 'released') return '<span class="bk-tag">' + icon('circle-check') + 'Paid</span>';
    if (v.group === 'cancelled') return '';
    if (v.disputed) return '<span class="bk-tag bk-tag-muted">' + icon('lock') + 'Payment Frozen</span>';
    if (p === 'paid') return '<span class="bk-tag">' + icon('lock') + 'Held in Escrow</span>';
    if (v.group === 'pending') return '<span class="bk-tag bk-tag-muted">Not Charged Yet</span>';
    return '<span class="bk-tag bk-tag-muted">Awaiting Payment</span>';
  }

  /* One plain-language line telling the customer what happens next */
  function hint(v) {
    var b = v.raw;
    if (v.disputed) return { tone: 'danger', text: 'A dispute is open. Payment stays frozen while our team reviews it.' };
    switch (v.group) {
      case 'pending':  return { tone: '', text: 'Waiting for the provider to confirm. You won\u2019t be charged until you pay.' };
      case 'progress': return isPaid(b)
        ? { tone: '', text: 'Your payment is safe in escrow. Once the work is finished, confirm it here.' }
        : { tone: 'warn', text: 'Confirmed by the provider. Pay into escrow to lock it in. They only get paid when you confirm the job is done.' };
      case 'signoff':  return b.status === 'provider_done'
        ? { tone: 'warn', text: 'Your provider says the job is done. Confirm it to get your 6-digit code, or report an issue.' }
        : codeLocked(b)
        ? { tone: 'danger', text: 'Too many incorrect code attempts. Please contact support to release this payment.' }
        : { tone: 'warn', text: 'You confirmed the job. Give your provider the 6-digit code so they can receive their payment.' };
      default: return null;
    }
  }

  function avatar(v) {
    return '<span class="bk-avatar">' + (v.avatar ? '<img src="' + esc(v.avatar) + '" alt="" loading="lazy" />' : esc(initials(v.provider))) + '</span>';
  }

  function figures(v) {
    var amt = v.amount;
    if (!amt || v.group === 'pending' || v.group === 'cancelled') return '';
    var p = payout(amt), pay = v.raw.payment_status;
    var status = v.group === 'completed' || pay === 'released' ? 'Released' : v.disputed ? 'Frozen' : pay === 'paid' ? 'In Escrow' : 'Not Paid';
    return '<div class="bk-figures">' +
      '<div><div class="bk-fig-label">Job Price</div><div class="bk-fig-value">' + naira(amt) + '</div></div>' +
      '<div><div class="bk-fig-label">Payment</div><div class="bk-fig-value">' + status + '</div></div>' +
      '<div><div class="bk-fig-label">Provider Receives</div><div class="bk-fig-value is-green">' + naira(p.net) + '</div></div></div>';
  }

  /* Buttons for a booking, depending on where it is in the job */
  function actions(v) {
    var id = esc(v.id), b = v.raw, paid = isPaid(b);
    var msg = '<button type="button" class="bk-btn" data-act="message" data-id="' + id + '">' + icon('chat') + 'Message Provider</button>';
    var issue = '<button type="button" class="bk-btn bk-btn-quiet is-danger" data-act="issue" data-id="' + id + '">Report Issue</button>';
    if (v.disputed) return msg;
    switch (v.group) {
      case 'pending': return '';
      case 'progress':
        return paid
          ? '<button type="button" class="bk-btn bk-btn-primary" data-act="confirm" data-id="' + id + '">' + icon('check') + 'Confirm Job Done</button>' + msg + issue
          : '<button type="button" class="bk-btn bk-btn-primary" data-act="pay" data-id="' + id + '">' + icon('lock') + 'Pay Now</button>' + msg;
      case 'signoff':
        if (b.status === 'provider_done') return '<button type="button" class="bk-btn bk-btn-primary" data-act="confirm" data-id="' + id + '">' + icon('check') + 'Yes, Confirm Done</button>' + msg + issue;
        return (codeLocked(b) ? '' : '<button type="button" class="bk-btn bk-btn-primary" data-act="code" data-id="' + id + '">' + icon('lock') + 'Show My Code</button>') + msg + issue;
      case 'completed': return msg;
      default: return '';
    }
  }

  function card(v) {
    var shown = v.amount || v.budget;
    var when = v.when
      ? '<span class="bk-meta">' + icon('calendar') + esc(v.when) + '</span>'
      : '<span class="bk-meta">' + icon('clock') + 'Booked ' + esc(ago(v.created)) + '</span>';
    var h = hint(v);
    var links = actions(v);
    if (v.taskerId) links += '<a class="bk-btn bk-btn-text" href="tasker-profile.html?id=' + encodeURIComponent(v.taskerId) + '">View Provider' + icon('arrow-right') + '</a>';
    if (v.group === 'completed') links += '<a class="bk-btn bk-btn-text" href="wallet.html">' + icon('wallet') + 'View in Wallet</a>';

    return '<article class="bk-card is-' + v.group + (v.disputed ? ' is-disputed' : '') + '" data-id="' + esc(v.id) + '" tabindex="-1" aria-labelledby="bkt-' + esc(v.id) + '">' +
      '<div class="bk-card-top"><div class="bk-card-head">' +
        '<div class="bk-card-id"><span class="bk-ref">#' + esc(v.ref) + '</span>' + badge(v) + when + '</div>' +
        '<h2 class="bk-card-title" id="bkt-' + esc(v.id) + '">' + esc(v.title) + '</h2>' +
        '<div class="bk-person">' + avatar(v) + '<div class="bk-person-body"><span class="bk-person-name">' + esc(v.provider) + '</span>' +
          '<div class="bk-person-sub">' + (v.location ? '<span>' + icon('pin') + esc(v.location) + '</span>' : '') +
          (v.category ? '<span>' + esc(v.category) + '</span>' : '') + '</div></div></div></div>' +
        '<div class="bk-card-amount">' + (shown ? '<span class="bk-amount">' + naira(shown) + '</span>' : '') + moneyTag(v) + '</div></div>' +
      figures(v) +
      (v.note ? '<p class="bk-quote"><strong>Your note:</strong> \u201C' + esc(v.note) + '\u201D</p>' : '') +
      (h ? '<div class="bk-hint' + (h.tone ? ' is-' + h.tone : '') + '">' + icon('info') + '<span>' + esc(h.text) + '</span></div>' : '') +
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
    var pending = 0, active = 0, done = 0, escrow = 0, toPay = 0, spent = 0, toPayN = 0, toFinishN = 0;
    state.rows.forEach(function (v) {
      var price = v.amount || v.budget;
      if (v.group === 'pending') pending++;
      else if (v.group === 'completed') { done++; spent += v.amount; }
      else if (v.group === 'progress' || v.group === 'signoff') {
        active++;
        if (v.disputed) return;
        if (isPaid(v.raw)) escrow += v.amount;
        /* Your move: pay a confirmed booking, confirm a finished job, or hand over your code */
        if (v.group === 'progress' && !isPaid(v.raw)) { toPay += price; toPayN++; }
        else if (v.group === 'signoff' && (v.raw.status === 'provider_done' || !codeLocked(v.raw))) toFinishN++;
      }
    });
    var action = toPayN + toFinishN;
    $('sAction').textContent = action;
    $('sActionSub').textContent = action ? (toPayN ? toPayN + ' to pay' : '') + (toPayN && toFinishN ? ' \u2022 ' : '') + (toFinishN ? toFinishN + ' to finish' : '') : 'all caught up';
    $('sActive').textContent = active;
    $('sActiveSub').textContent = pending ? pending + ' awaiting provider' : 'in progress';
    $('sEscrow').textContent = naira(escrow);
    $('sToPay').textContent = naira(toPay);
    $('sPaid').textContent = naira(spent);
    var n = pending + active + done, bar = $('sBar').children, pct = function (x) { return (n ? x / n * 100 : 0) + '%'; };
    bar[0].style.width = pct(pending); bar[1].style.width = pct(active); bar[2].style.width = pct(done);
    $('sBarText').textContent = n ? pending + ' pending \u2022 ' + active + ' active \u2022 ' + done + ' completed' : 'No bookings yet';
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
        '<p class="bk-state-text">Book a service from a provider\u2019s profile and it will show up here, with everything you need to pay and track it.</p>' +
        '<a class="bk-btn bk-btn-primary" href="find-taskers.html">Find Services</a></div>';
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
  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }
  var priceOf = function (v) { return v.amount || v.budget || 0; };

  /* Apply a change to a booking and redraw its tab, counts and card */
  function patch(v, changes) {
    Object.assign(v.raw, changes);
    v.group = group(v.raw); v.disputed = isDisputed(v.raw); v.label = label(v.raw);
    render();
    focusCard(v.id);
  }

  /* Open the booking's chat on the Messages page */
  function openChat(v) {
    try {
      sessionStorage.setItem('st_chat_context', JSON.stringify({
        contextType: 'booking', contextId: String(v.id), taskerId: String(v.taskerId), customerId: String(state.user.id)
      }));
    } catch (e) { /* storage blocked: Messages still opens */ }
    window.location.href = 'messages.html';
  }

  /* ── Pay ──
     The dialog closes before Paystack opens: a modal <dialog> sits above everything else on the page,
     which would hide the Paystack window. If the payment fails or is cancelled the dialog opens again. */
  function payRow(text, value, cls) { return '<div class="bk-pay-row' + (cls ? ' ' + cls : '') + '"><span>' + text + '</span><span>' + value + '</span></div>'; }

  async function openPay(v) {
    current = v;
    var price = priceOf(v);
    showError($('bkPayError'), '');
    if (!price) {
      $('bkPaySum').innerHTML = '<div class="bk-pay-row"><span>The provider hasn\u2019t set a price for this booking yet. Message them to agree one, then come back to pay.</span></div>';
      $('bkWalletOpt').hidden = true; $('bkPayNow').closest('.bk-pay-opt').hidden = true; $('bkGiftBox').innerHTML = '';
      $('bkPayDlg').showModal();
      return;
    }
    var p = payout(price);
    $('bkPaySum').innerHTML = payRow(esc(v.title), naira(price)) + payRow('Platform fee (12%, paid by the provider)', naira(p.fee)) +
      payRow('Total to pay', naira(price), 'is-total') + payRow('Provider receives', naira(p.net), 'is-net');
    $('bkPayNow').closest('.bk-pay-opt').hidden = false;
    $('bkPayNow').textContent = 'Pay ' + naira(price) + ' with Paystack';
    $('bkWalletOpt').hidden = false; $('bkWalletOpt').classList.add('is-off');
    $('bkWalletBal').textContent = 'Checking balance\u2026';
    $('bkPayWallet').hidden = true; $('bkGiftBox').innerHTML = '';
    $('bkPayDlg').showModal();

    /* Wallet balance and gift cards fill in after the dialog is open */
    try {
      var w = await window.ST.payments.getWallet(state.user.id);
      var bal = (w && w.balance) || 0, can = bal >= price;
      $('bkWalletBal').textContent = 'Balance: ' + naira(bal) + (can ? '' : ' (not enough)');
      $('bkWalletOpt').classList.toggle('is-off', !can);
      $('bkPayWallet').hidden = !can;
      $('bkPayWallet').textContent = 'Pay ' + naira(price) + ' from Wallet';
    } catch (e) { $('bkWalletBal').textContent = 'Balance unavailable'; }
    if (window.ST.payments.getGiftQuote) {
      var q = await window.ST.payments.getGiftQuote(v.id);
      if (q && q.giftAmount && current === v && $('bkPayDlg').open) {
        var rest = q.remainder, text = rest > 0 ? 'Use gift cards + pay ' + naira(rest) : 'Pay with gift cards';
        $('bkGiftBox').innerHTML = '<div class="bk-pay-opt"><div class="bk-pay-opt-head"><span class="bk-pay-opt-icon">' + icon('gift') + '</span>' +
          '<span><strong>Use gift cards</strong><span class="bk-stat-sub">' + naira(q.giftAmount) + ' of your gift cards can pay for this booking.' +
          (rest > 0 ? ' You pay the remaining ' + naira(rest) + ' with Paystack.' : '') + '</span></span></div>' +
          '<button type="button" class="bk-btn bk-btn-primary" id="bkPayGift">' + esc(text) + '</button></div>';
      }
    }
  }

  async function paid(v) {
    $('bkPayDlg').close();
    await refresh(v.id);
    $('bkPaidDlg').showModal();
  }

  async function doPay(kind, btn) {
    var v = current; if (!v) return;
    var price = priceOf(v), label0 = btn.textContent, reopen = false;
    btn.disabled = true; showError($('bkPayError'), '');
    var pay = window.ST.payments;
    try {
      if (kind === 'wallet') {
        btn.textContent = 'Processing\u2026';
        await pay.payFromWallet({ bookingId: v.id, amountNaira: price, taskerUserId: v.taskerId || null });
      } else {
        $('bkPayDlg').close(); reopen = true; /* Paystack's window must be able to show */
        if (kind === 'gift') await pay.payWithGiftCards({ bookingId: v.id, customerEmail: state.user.email });
        else await pay.initiatePayment({
          bookingId: v.id, amountNaira: price, customerEmail: state.user.email,
          customerName: localStorage.getItem('st_name') || '', taskerUserId: v.taskerId || null
        });
      }
      btn.disabled = false; btn.textContent = label0;
      await paid(v);
    } catch (e) {
      btn.disabled = false; btn.textContent = label0;
      var m = e && e.message ? e.message : 'Payment failed.';
      var quiet = m === 'Payment cancelled.' || m === 'Payment window closed. Click pay again to retry.';
      if (reopen && !$('bkPayDlg').open) $('bkPayDlg').showModal();
      showError($('bkPayError'), quiet ? '' : 'Payment error: ' + m);
    }
  }

  /* ── Confirm the job is done (returns the 6-digit code) ── */
  function openConfirm(v) {
    current = v; showError($('bkConfirmError'), '');
    $('bkConfirmText').textContent = (v.raw.status === 'provider_done' ? v.provider + ' says the job is done. ' : '') +
      'Only confirm once the work is finished to your satisfaction. You\u2019ll get a 6-digit code to give ' + v.provider +
      ', so they can receive ' + naira(payout(priceOf(v)).net) + ' from escrow.';
    $('bkConfirmDlg').showModal();
  }

  function showCodeDialog(code, intro) {
    $('bkCodeValue').textContent = code || '------';
    $('bkCodeText').textContent = intro;
    showError($('bkCodeError'), '');
    $('bkCodeDlg').showModal();
  }

  async function doConfirm() {
    var v = current, btn = $('bkConfirmGo'); if (!v) return;
    btn.disabled = true; showError($('bkConfirmError'), '');
    try {
      var r = await window.ST.payments.confirmJobComplete(v.id);
      $('bkConfirmDlg').close();
      patch(v, { status: 'awaiting_confirmation' });
      showCodeDialog(r && r.code, 'Give this code to ' + v.provider + '. They enter it to receive their payment.');
    } catch (e) { showError($('bkConfirmError'), e.message || 'Could not confirm this job.'); }
    btn.disabled = false;
  }

  /* Show the code again later: read it straight from the booking (no status change, no new notification) */
  async function showCode(v, btn) {
    btn.disabled = true;
    try {
      var r = await window.supabase.from('bookings').select('completion_code').eq('id', v.id).eq('customer_id', state.user.id).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data || !r.data.completion_code) throw new Error('Your code isn\u2019t available. Please contact support.');
      showCodeDialog(String(r.data.completion_code), 'Give this code to ' + v.provider + '. They enter it to receive their payment.');
    } catch (e) { toast(e.message || 'Could not load your code.'); }
    btn.disabled = false;
  }

  /* ── Report an issue ── */
  function openIssue(v) {
    current = v; $('bkIssueText').value = ''; showError($('bkIssueError'), '');
    $('bkIssueDlg').showModal();
    $('bkIssueText').focus();
  }

  async function doIssue(e) {
    e.preventDefault();
    var v = current, btn = $('bkIssueGo'); if (!v) return;
    var reason = $('bkIssueText').value.trim();
    if (!reason) { showError($('bkIssueError'), 'Please describe the issue.'); return; }
    btn.disabled = true; showError($('bkIssueError'), '');
    try {
      await window.ST.payments.raiseDispute(v.id, reason);
      $('bkIssueDlg').close();
      patch(v, { status: 'disputed' });
      toast('Issue reported. Payment is frozen and our team will review it within 24 hours.');
    } catch (err) { showError($('bkIssueError'), err.message || 'Could not report this issue.'); }
    btn.disabled = false;
  }

  function onAction(btn) {
    var v = find(btn.dataset.id); if (!v) return;
    switch (btn.dataset.act) {
      case 'pay':     openPay(v); break;
      case 'confirm': openConfirm(v); break;
      case 'code':    showCode(v, btn); break;
      case 'issue':   openIssue(v); break;
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
  /* Desktop Search button: applies the current text now instead of waiting for the typing delay */
  var searchBtn = $('bkSearchBtn');
  if (searchBtn) searchBtn.addEventListener('click', function () {
    var box = $('bkSearch');
    clearTimeout(searchTimer);
    state.query = box.value; state.shown = PAGE_SIZE; render(); box.focus();
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
  $('bkPayWallet').addEventListener('click', function () { doPay('wallet', this); });
  $('bkPayNow').addEventListener('click', function () { doPay('paystack', this); });
  $('bkGiftBox').addEventListener('click', function (e) { var b = e.target.closest('#bkPayGift'); if (b) doPay('gift', b); });
  $('bkConfirmGo').addEventListener('click', doConfirm);
  $('bkIssueForm').addEventListener('submit', doIssue);
  /* A provider photo that fails to load falls back to initials */
  $('bkList').addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var holder = img.parentNode, name = holder.parentNode.querySelector('.bk-person-name');
    holder.textContent = initials(name ? name.textContent : '');
  }, true);

  start();
})();

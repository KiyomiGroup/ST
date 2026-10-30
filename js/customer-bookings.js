/* ============================================================
   STREETTASKER — customer-bookings.js
   Customer "Bookings" page (customer-bookings.html). Customer counterpart of js/bookings.js.
   Replaces the old Bookings panel in dashboard-customer.html.

   - Sign-in + role guard, loads the customer's bookings with provider, task and service details.
   - Tabs with counts, search, service / date / sort filters, load more, compact cards.
   - ONE action per booking: "Open job room" (or "Pay in chat" when payment is due). Payment, work review, the
     release code and problem reports all happen in the chat, so this page never moves money or job status.
   - Sidebar snapshot worked out from all loaded bookings, ignoring the filters.

   Stage 5D-1: a booking made with a Local Tasker can have a QUOTE from the coordinator. js/customer-quote.js shows it inside
   the booking card (approve or decline). Approving creates the payment requests in the job room; paying stays in the chat.

   Job flow (one flow, in the chat): pending -> confirmed (tasker accepts; the server posts the payment request
   in the chat) -> paid (you pay in the chat, money held in escrow) -> awaiting_confirmation (tasker marked it
   done; you review and get your release code in the chat) -> completed (tasker enters the code, payout released).
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var FEE_RATE = 0.12; /* mirrors PLATFORM_COMMISSION in js/payments.js; used only if calculateAmounts is missing */
  var MAX_CODE_TRIES = 3; /* mirrors the limit in ST.payments.submitCompletionCode */
  var SIGNOFF = ['awaiting_confirmation', 'awaiting_code', 'provider_done']; /* provider_done: old rows only, the server no longer writes it */
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
      case 'pending':   return { text: 'Awaiting Tasker', tone: 'warn' };
      case 'signoff':   return { text: 'Review the Work', tone: 'warn' };
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

  /* Stage 7A: the fee rate for each provider comes from the server (0 for a Local Tasker, 12% for everyone else). Display only: nothing here
     moves money. If the lookup fails the card falls back to the normal rate, exactly as before. */
  async function loadFeeRates(ids) {
    var map = {};
    if (!ids.length) return map;
    try {
      var r = await window.supabase.rpc('booking_fee_rates', { p_tasker_ids: ids });
      if (!r.error) (r.data || []).forEach(function (x) {
        if (x && x.tasker_id && x.fee_rate !== null && x.fee_rate !== undefined && isFinite(Number(x.fee_rate))) map[x.tasker_id] = Number(x.fee_rate);
      });
    } catch (e) { /* the page still works with the normal rate */ }
    return map;
  }

  function payout(amount, rate) {
    if (typeof rate === 'number' && isFinite(rate) && rate >= 0 && rate < 1) {
      var f = Math.round(amount * rate);
      return { fee: f, net: amount - f };
    }
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
    if (window.STCustQuote) await window.STCustQuote.load();   /* never throws: a page without quotes still works */
    var feeRates = await loadFeeRates(providerIds);

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
        label: (!isDisputed(b) && window.STCustQuote && window.STCustQuote.label(b.id)) || label(b),
        title: title,
        provider: provider,
        avatar: safeUrl(tp.photo_url || u.avatar_url || ''),
        location: t.location || s.location || tp.location || '',
        category: t.category || s.category || tp.category || '',
        amount: Number(b.amount) || 0,
        budget: Number(t.budget) || 0,
        note: b.notes && String(b.notes).trim() !== title ? String(b.notes).trim() : '',
        taskerId: b.tasker_id || '',
        feeRate: feeRates[b.tasker_id],
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
    if (v.disputed) return { tone: 'danger', text: 'A problem report is open. Payment stays on hold while our team reviews it. Follow it in the job room.' };
    var qh = window.STCustQuote && window.STCustQuote.hint(v.id);
    if (qh) return qh;
    switch (v.group) {
      case 'pending':  return { tone: '', text: 'Waiting for the tasker to confirm. You won\u2019t be charged until you pay.' };
      case 'progress': return isPaid(b)
        ? { tone: '', text: 'Your payment is held safely. When the work is finished, review it in the job room.' }
        : { tone: 'warn', text: 'Confirmed by the tasker. Pay in the job room to lock it in. They only get paid when you release the money.' };
      case 'signoff':  return codeLocked(b)
        ? { tone: 'danger', text: 'Too many wrong code attempts. Please contact support to release this payment.' }
        : { tone: 'warn', text: 'The tasker says the work is done. Open the job room to check it and get your release code.' };
      default: return null;
    }
  }

  function avatar(v) {
    return '<span class="bk-avatar">' + (v.avatar ? '<img src="' + esc(v.avatar) + '" alt="" loading="lazy" />' : esc(initials(v.provider))) + '</span>';
  }

  function figures(v) {
    var amt = v.amount;
    if (!amt || v.group === 'pending' || v.group === 'cancelled') return '';
    var p = payout(amt, v.feeRate), pay = v.raw.payment_status;
    var status = v.group === 'completed' || pay === 'released' ? 'Released' : v.disputed ? 'Frozen' : pay === 'paid' ? 'In Escrow' : 'Not Paid';
    return '<div class="bk-figures">' +
      '<div><div class="bk-fig-label">Job Price</div><div class="bk-fig-value">' + naira(amt) + '</div></div>' +
      '<div><div class="bk-fig-label">Payment</div><div class="bk-fig-value">' + status + '</div></div>' +
      '<div><div class="bk-fig-label">Provider Receives</div><div class="bk-fig-value is-green">' + naira(p.net) + '</div></div></div>';
  }

  /* ONE button. Everything else (pay, review, release code, report a problem) lives in the job room. */
  function actions(v) {
    var id = esc(v.id), needsPay = (v.group === 'progress' && !isPaid(v.raw) && !v.disputed) || (!v.disputed && !!window.STCustQuote && window.STCustQuote.needsPay(v.id));
    var primary = needsPay || (v.group === 'signoff' && !v.disputed);
    return '<button type="button" class="bk-btn' + (primary ? ' bk-btn-primary' : '') + '" data-act="room" data-id="' + id + '">' + icon(needsPay ? 'lock' : 'chat') +
      (needsPay ? 'Pay in Chat' : v.group === 'signoff' && !v.disputed ? 'Review in Job Room' : 'Open Job Room') + '</button>';
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
      (window.STCustQuote ? window.STCustQuote.html(v.id) : '') +
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
    var pending = 0, active = 0, done = 0, escrow = 0, toPay = 0, spent = 0, toPayN = 0, toFinishN = 0, quoteN = 0;
    state.rows.forEach(function (v) {
      var price = v.amount || v.budget;
      if (window.STCustQuote && !v.disputed) {
        if (window.STCustQuote.due(v.id)) quoteN++;                                        /* a quote waits for your answer */
        else if (v.group === 'pending' && window.STCustQuote.needsPay(v.id)) toPayN++;     /* approved, payment requests waiting */
      }
      if (v.group === 'pending') pending++;
      else if (v.group === 'completed') { done++; spent += v.amount; }
      else if (v.group === 'progress' || v.group === 'signoff') {
        active++;
        if (v.disputed) return;
        if (isPaid(v.raw)) escrow += v.amount;
        /* Your move: pay a confirmed booking, confirm a finished job, or hand over your code */
        if (v.group === 'progress' && !isPaid(v.raw)) { toPay += price; toPayN++; }
        else if (v.group === 'signoff' && !codeLocked(v.raw)) toFinishN++;
      }
    });
    var action = toPayN + toFinishN + quoteN;
    $('sAction').textContent = action;
    $('sActionSub').textContent = action ? [toPayN ? toPayN + ' to pay' : '', quoteN ? quoteN + (quoteN === 1 ? ' quote' : ' quotes') + ' to answer' : '', toFinishN ? toFinishN + ' to review' : ''].filter(Boolean).join(' \u2022 ') : 'all caught up';
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
  var toast = function (m) { if (window.showToast) window.showToast(m); };
  var find = function (id) { return state.rows.filter(function (v) { return String(v.id) === String(id); })[0]; };

  /* Open the booking's chat on the Messages page */
  function openChat(v) {
    try {
      sessionStorage.setItem('st_chat_context', JSON.stringify({
        contextType: 'booking', contextId: String(v.id), taskerId: String(v.taskerId), customerId: String(state.user.id)
      }));
    } catch (e) { /* storage blocked: Messages still opens */ }
    window.location.href = 'messages.html';
  }

  function onAction(btn) {
    var v = find(btn.dataset.id); if (!v) return;
    openChat(v);
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
  if (window.STCustQuote) window.STCustQuote.bind($('bkList'), { refresh: refresh, openRoom: function (id) { var v = find(id); if (v) openChat(v); } });
  $('bkFilterBtn').addEventListener('click', function () {
    var open = $('bkToolbar').classList.toggle('is-open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.setAttribute('aria-label', open ? 'Hide filters' : 'Show filters');
    if (open) $('bkSearch').focus();
  });
  /* A provider photo that fails to load falls back to initials */
  $('bkList').addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var holder = img.parentNode, name = holder.parentNode.querySelector('.bk-person-name');
    holder.textContent = initials(name ? name.textContent : '');
  }, true);

  start();
})();

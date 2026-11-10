/* ============================================================
   StreetTasker — coordinator-tasker-bookings.js (Stage T3)
   The Bookings tab on coordinator-tasker.html: this Local Tasker's bookings as one queue, most urgent first.
     - search (customer, job, reference, status), a date-requested range, Export CSV, and filter pills with counts
       (All, New requests, Quoted, In progress, Completed, Issues)
     - tablet and up: a table (customer and job, schedule and next step, price and payment, status, button)
     - phones: one card per booking (customer, status, job, date, next step, payment and price, full-width button)
     - pages of six, "Showing 1-6 of 14 bookings"
   Read-only. Uses the list the page frame already read (window.STCoTasker.bookings()), so no extra call.
   Location is not in that list, so it is not shown. Loads the first time the tab is opened.
   Renders with textContent only (names are user-entered data). The CSV guards against spreadsheet formulas.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  var taskerId = new URLSearchParams(window.location.search).get('id');
  var PAGE = 6;
  var rows = [], pill = 'all', range = 'all', query = '', page = 1;
  var ready = false, opened = false, started = false, seq = 0;

  var PILLS = [
    { id: 'all', label: 'All' }, { id: 'new', label: 'New requests' }, { id: 'quote', label: 'Quoted' },
    { id: 'active', label: 'In progress' }, { id: 'completed', label: 'Completed' }, { id: 'issue', label: 'Issues' }
  ];
  var CHIP = { new: 'New request', quote: 'Quoted', active: 'In progress', completed: 'Completed', issue: 'Issue' };
  var URGENCY = { problem: 0, action: 1, waiting: 2, closed: 3 };
  var ICON_CAL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  var ICON_NEXT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

  function $(id) { return document.getElementById(id); }

  /* Which group a booking belongs to. Same grouping as the dashboard's Active Requests, plus Completed. */
  function kindOf(r) {
    if (r.frozen || r.booking_status === 'disputed') return 'issue';
    if (r.open === false) return r.booking_status === 'completed' ? 'completed' : 'closed';
    switch (r.lt_status) {
      case 'quote_approved': return 'active';
      case 'tasker_confirmed': case 'quote_sent': case 'quote_declined': return 'quote';
      default: return 'new';
    }
  }
  function chipText(r) { return CHIP[r._kind] || B.bookingLabel(r.booking_status); }

  /* ── Date range (on the day the customer asked) ── */
  function rangeOptions() {
    var now = new Date();
    var month = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    return [{ id: 'all', label: 'Any time' }, { id: 'month', label: 'This month (' + month + ')' }, { id: 'd30', label: 'Last 30 days' }, { id: 'm6', label: 'Last 6 months' }];
  }
  function inRange(r) {
    if (range === 'all') return true;
    var t = new Date(r.created_at).getTime(); if (isNaN(t)) return false;
    var now = new Date();
    if (range === 'month') { var d = new Date(t); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }
    var days = range === 'd30' ? 30 : 183;
    return t >= now.getTime() - days * 86400000;
  }

  function haystack(r) { return [r.title, r.customer_name, B.ref(r.booking_id), chipText(r)].join(' ').toLowerCase(); }
  function pool() { return rows.filter(inRange); }
  function filtered() {
    var q = query.trim().toLowerCase();
    return pool().filter(function (r) { return (pill === 'all' || r._kind === pill) && (!q || haystack(r).indexOf(q) > -1); });
  }
  function counts(list) {
    var c = { all: list.length, new: 0, quote: 0, active: 0, completed: 0, issue: 0 };
    list.forEach(function (r) { if (c[r._kind] != null) c[r._kind] += 1; });
    return c;
  }

  function buildTabs() {
    var wrap = $('coTbTabs'); wrap.textContent = '';
    var c = counts(pool());
    PILLS.forEach(function (t) {
      var b = C.el('button', 'co-filter' + (t.id === pill ? ' is-active' : '') + (t.id === 'issue' && c.issue && t.id !== pill ? ' is-alert' : ''), t.label + ' (' + c[t.id] + ')');
      b.type = 'button'; b.setAttribute('aria-pressed', t.id === pill ? 'true' : 'false');
      b.addEventListener('click', function () { pill = t.id; page = 1; buildTabs(); render(); });
      wrap.appendChild(b);
    });
  }

  /* ── Rows ── */
  function label(r, short) {
    if (r._kind === 'issue') return 'View problem';
    if (r._next.tab === 'action') return short ? 'Open and act' : 'Open and act' + (B.naira(r.amount) ? ' (' + B.naira(r.amount) + ')' : '');
    return short ? 'Open' : 'Open booking';
  }
  function button(r, short) {
    var a = C.el('a', 'btn co-bq-btn ' + (r._next.tab === 'action' || r._kind === 'issue' ? 'btn-primary' : 'btn-mint') + (short ? ' btn-sm' : ' btn-full'), label(r, short));
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', label(r, true) + ': ' + (r.title || 'Booking'));
    return a;
  }
  function paid(r) { return r.payment_status === 'paid' || r.payment_status === 'released'; }
  function strongSpan(cls, text) { return C.el('span', cls, text); }

  /* Tablet and up: one table row */
  function deskRow(r) {
    var box = C.el('div', 'co-bq-desk');
    var c1 = C.el('div', 'co-bq-cell co-bq-cust');
    c1.appendChild(C.el('span', 'co-tasker-avatar co-bq-avatar', C.initialsOf(r.customer_name, 'CU')));
    var t = C.el('div', 'co-bq-ctext');
    var nm = C.el('p', 'co-bq-name'); nm.appendChild(document.createTextNode(r.customer_name || 'Customer')); nm.appendChild(C.el('span', 'co-bq-ref', ' ' + B.ref(r.booking_id)));
    t.appendChild(nm); t.appendChild(C.el('p', 'co-bq-job', r.title || 'Booking'));
    c1.appendChild(t); box.appendChild(c1);

    var c2 = C.el('div', 'co-bq-cell');
    c2.appendChild(C.el('p', 'co-bq-main', B.whenText(r) || 'Not scheduled yet'));
    c2.appendChild(C.el('p', 'co-bq-sub' + (r._next.tab === 'action' ? ' is-action' : ''), r._next.text));
    box.appendChild(c2);

    var c3 = C.el('div', 'co-bq-cell');
    c3.appendChild(C.el('p', 'co-bq-main', B.naira(r.amount) || '\u2014'));
    c3.appendChild(C.el('p', 'co-bq-sub' + (paid(r) ? ' is-paid' : ''), B.payLabel(r.payment_status)));
    box.appendChild(c3);

    var c4 = C.el('div', 'co-bq-cell'); c4.appendChild(C.el('span', 'co-bq-chip co-bq-chip--' + r._kind, chipText(r))); box.appendChild(c4);
    var c5 = C.el('div', 'co-bq-cell co-bq-go'); c5.appendChild(button(r, true)); box.appendChild(c5);
    return box;
  }

  /* Phones: one card */
  function phoneCard(r) {
    var box = C.el('div', 'co-bq-card');
    var head = C.el('div', 'co-bq-chead');
    head.appendChild(C.el('span', 'co-tasker-avatar co-bq-avatar', C.initialsOf(r.customer_name, 'CU')));
    var who = C.el('div', 'co-bq-cwho');
    who.appendChild(C.el('p', 'co-bq-name', r.customer_name || 'Customer'));
    who.appendChild(C.el('p', 'co-bq-ref', B.ref(r.booking_id)));
    head.appendChild(who);
    head.appendChild(C.el('span', 'co-bq-chip co-bq-chip--' + r._kind, chipText(r)));
    box.appendChild(head);

    box.appendChild(C.el('h3', 'co-bq-ctitle', r.title || 'Booking'));
    var when = C.el('p', 'co-bq-cwhen'); var ic = C.el('span', 'co-bq-ico'); ic.innerHTML = ICON_CAL; when.appendChild(ic);   /* fixed icon markup */
    when.appendChild(document.createTextNode(B.whenText(r) || 'Date not set')); box.appendChild(when);
    box.appendChild(C.el('p', 'co-bq-cnext' + (r._next.tab === 'action' ? ' is-action' : ''), r._next.text));

    var pay = C.el('div', 'co-bq-cpay');
    var pl = C.el('div', 'co-bq-cpaytext');
    pl.appendChild(C.el('span', 'co-bq-paylabel', 'Payment status'));
    pl.appendChild(C.el('span', 'co-bq-payvalue' + (paid(r) ? ' is-paid' : ''), B.payLabel(r.payment_status)));
    pay.appendChild(pl);
    if (B.naira(r.amount)) pay.appendChild(C.el('span', 'co-bq-amount', B.naira(r.amount)));
    box.appendChild(pay);
    box.appendChild(button(r, false));
    return box;
  }

  function row(r) {
    var li = C.el('li', 'co-bq-row' + (r._kind === 'issue' ? ' is-issue' : ''));
    li.appendChild(deskRow(r)); li.appendChild(phoneCard(r));
    return li;
  }

  /* ── Pager ── */
  function pageNumbers(cur, total) {
    var out = [], last = 0;
    for (var i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - cur) <= 1) { if (last && i - last > 1) out.push(0); out.push(i); last = i; }
    }
    return out;
  }
  function buildPager(total, from, to) {
    var pager = $('coTbPager'), pages = $('coTbPages');
    pages.textContent = '';
    $('coTbCount').textContent = total ? 'Showing ' + from + '\u2013' + to + ' of ' + total + (total === 1 ? ' booking' : ' bookings') : '';
    var n = Math.ceil(total / PAGE);
    pager.hidden = !total;
    if (n <= 1) return;
    function go(p) { page = p; render(); var q = $('coTbQueue'); if (q && q.scrollIntoView) q.scrollIntoView({ block: 'start' }); }
    var prev = C.el('button', 'co-bq-pg', 'Previous'); prev.type = 'button'; prev.disabled = page <= 1;
    prev.addEventListener('click', function () { go(page - 1); }); pages.appendChild(prev);
    pageNumbers(page, n).forEach(function (p) {
      if (!p) { pages.appendChild(C.el('span', 'co-bq-gap', '\u2026')); return; }
      var b = C.el('button', 'co-bq-pg co-bq-pg--num' + (p === page ? ' is-current' : ''), String(p)); b.type = 'button';
      b.setAttribute('aria-label', 'Page ' + p); if (p === page) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', function () { go(p); }); pages.appendChild(b);
    });
    var next = C.el('button', 'co-bq-pg', 'Next'); next.type = 'button'; next.disabled = page >= n;
    next.addEventListener('click', function () { go(page + 1); }); pages.appendChild(next);
  }

  function render() {
    var list = $('coTbList'), empty = $('coTbEmpty'), nomatch = $('coTbNoMatch'), tools = $('coTbToolbar'), queue = $('coTbQueue');
    list.textContent = ''; empty.hidden = true; nomatch.hidden = true;
    if (!rows.length) { queue.hidden = true; tools.hidden = true; empty.hidden = false; return; }
    tools.hidden = false;
    var shown = filtered(), n = Math.max(1, Math.ceil(shown.length / PAGE));
    if (page > n) page = n;
    var from = (page - 1) * PAGE;
    shown.slice(from, from + PAGE).forEach(function (r) { list.appendChild(row(r)); });
    $('coTbHeading').textContent = 'Bookings Queue (' + shown.length + ')';
    queue.hidden = !shown.length;
    buildPager(shown.length, from + 1, Math.min(from + PAGE, shown.length));
    if (!shown.length) {
      nomatch.hidden = false;
      var narrowed = query.trim() || range !== 'all';
      $('coTbNoMatchTitle').textContent = narrowed ? 'No match' : 'Nothing here';
      $('coTbNoMatchText').textContent = narrowed ? 'None of these bookings match your search or date range.' : 'No bookings in this group right now.';
    }
  }

  /* ── Export (the bookings that match the search, range and pill, not just the page on screen) ── */
  function csvCell(v) {
    var t = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t]/.test(t)) t = "'" + t;   /* a spreadsheet must never read customer text as a formula */
    return '"' + t.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var head = ['Reference', 'Customer', 'Job', 'Status', 'Scheduled', 'Amount (NGN)', 'Payment', 'Requested'];
    var lines = [head.map(csvCell).join(',')];
    filtered().forEach(function (r) {
      lines.push([B.ref(r.booking_id), r.customer_name, r.title, chipText(r), B.whenText(r), r.amount, B.payLabel(r.payment_status), r.created_at ? String(r.created_at).slice(0, 10) : ''].map(csvCell).join(','));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'bookings-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function summary() {
    var need = rows.filter(function (r) { return r._next.tab === 'action'; }).length;
    $('coTbSummary').textContent = need
      ? need + (need === 1 ? ' booking needs' : ' bookings need') + ' your action.'
      : 'Nothing needs your action right now.';
  }

  async function load(again) {
    var mark = ++seq;
    $('coTbLoading').hidden = false; $('coTbQueue').hidden = true; $('coTbToolbar').hidden = true;
    $('coTbEmpty').hidden = true; $('coTbNoMatch').hidden = true; $('coTbError').hidden = true;
    var all = await window.STCoTasker.bookings(again);
    if (mark !== seq) return;
    $('coTbLoading').hidden = true;
    if (!all) { $('coTbError').hidden = false; return; }
    rows = all.filter(function (r) { return r && r.tasker_user_id === taskerId; }).map(function (r) { r._next = B.nextAction(r); r._kind = kindOf(r); return r; });
    /* most urgent first (problems, then what needs you, then waiting, then closed); newest first inside a group */
    rows.sort(function (a, b) {
      var d = (URGENCY[a._next.tab] || 0) - (URGENCY[b._next.tab] || 0);
      return d || (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0);
    });
    var sel = $('coTbRange'); sel.textContent = '';
    rangeOptions().forEach(function (o) { var op = C.el('option', null, o.label); op.value = o.id; sel.appendChild(op); });
    sel.value = range;
    buildTabs(); summary(); render();
  }

  function maybeStart() {
    if (started || !ready || !opened || !C.isUuid(taskerId) || !window.STCoTasker) return;
    started = true; load(false);
  }

  document.addEventListener('coordinator:ready', function () { ready = true; maybeStart(); });
  document.addEventListener('coordinator-tasker:tab', function (e) { if (e.detail && e.detail.tab === 'bookings') { opened = true; maybeStart(); } });
  document.addEventListener('DOMContentLoaded', function () {
    $('coTbRetry').addEventListener('click', function () { if (started) load(true); });
    $('coTbSearch').addEventListener('input', function () { query = this.value; page = 1; if (started) render(); });
    $('coTbRange').addEventListener('change', function () { range = this.value; page = 1; if (started) { buildTabs(); render(); } });
    $('coTbExport').addEventListener('click', function () { if (started) exportCsv(); });
  });
})();

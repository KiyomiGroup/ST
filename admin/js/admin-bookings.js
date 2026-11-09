/* StreetTasker Admin: Bookings and Tasks (stage A12a, spec S10, READ ONLY).
   Reads go through admin_booking_list, admin_booking_detail and admin_task_list (sql/admin/a12a-bookings.sql). Each checks the
   bookings.view permission on the server. This page has no button that writes anything: no reassign, unlock, cancel, refund or release
   (those are A12b, and money is never moved from the admin area). The street address, phone numbers, notes and completion code are
   never returned by the server, so they cannot be shown here.
   All text is inserted with textContent, so names and titles cannot inject markup. */
'use strict';
AdminShell.init({ page: 'bookings', title: 'Bookings and Tasks', permission: 'bookings.view' }).then(function (ctx) {
  var sb = window.supabase;
  var $ = function (id) { return document.getElementById(id); };

  var TABS = [['regular', 'Bookings'], ['local', 'Local bookings'], ['tasks', 'Tasks']];
  var BOOKING_FILTERS = [['all', 'All bookings'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'],
    ['locked', 'Completion code locked'], ['disputed', 'Has a dispute reason'], ['other', 'Other status']];
  var LOCAL_FILTERS = [['all', 'All Local bookings'], ['needs_reassignment', 'Needs a coordinator'], ['assigned', 'Assigned'],
    ['awaiting_tasker_confirmation', 'Waiting for the worker'], ['tasker_confirmed', 'Worker agreed'], ['tasker_declined', 'Worker declined'],
    ['quote_sent', 'Quote sent'], ['quote_approved', 'Quote approved'], ['quote_declined', 'Quote declined']];
  var TASK_FILTERS = [['all', 'All tasks'], ['open', 'Open'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled'],
    ['draft', 'Draft'], ['other', 'Other status']];
  var STATUS = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', open: 'Open', in_progress: 'In progress', draft: 'Draft' };
  var LT = { needs_reassignment: 'Needs a coordinator', assigned: 'Assigned', awaiting_tasker_confirmation: 'Waiting for the worker', tasker_confirmed: 'Worker agreed',
    tasker_declined: 'Worker declined', quote_sent: 'Quote sent', quote_approved: 'Quote approved', quote_declined: 'Quote declined' };
  var SECTION = { booking: 'booking details', local: 'Local booking state', quote: 'quote', milestones: 'on-site steps', exceptions: 'problems reported',
    local_events: 'Local booking history', timeline: 'timeline', payment: 'payment status', disputes: 'disputes' };
  var state = { tab: 'regular', filter: 'all', search: '', offset: 0, data: null, sel: null, loadId: 0 };

  $('adBk').hidden = false;

  /* ---------- helpers ---------- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(t) { if (!t) return '-'; var d = new Date(t); return isNaN(d) ? '-' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function num(v) { return v == null ? '-' : String(v); }
  function naira(v) { var n = Number(v); return v == null || isNaN(n) ? '-' : '₦' + n.toLocaleString('en-NG'); }
  function words(s) { return s ? String(s).replace(/_/g, ' ') : ''; }
  function dl(pairs) {
    var d = h('dl', 'ad-dl');
    pairs.forEach(function (p) { add(d, h('dt', null, p[0]), h('dd', null, p[1] == null || p[1] === '' ? '-' : String(p[1]))); });
    return d;
  }
  function statusBadge(st) {
    var cls = st === 'completed' ? 'badge badge-green' : (st === 'cancelled' ? 'badge badge-gray' : 'badge badge-amber');
    return h('span', cls, STATUS[st] || words(st) || 'Unknown');
  }
  function filtersFor(tab) { return tab === 'local' ? LOCAL_FILTERS : (tab === 'tasks' ? TASK_FILTERS : BOOKING_FILTERS); }

  /* Every function answers { ok, error, ... }. Anything else is a failure. */
  async function call(name, args) {
    try {
      var r = await sb.rpc(name, args || {});
      if (r.error) {
        if (r.error.code === '42501') return { ok: false, error: 'You do not have permission to do this.' };
        if (r.error.code === '42883' || r.error.code === 'PGRST202') {
          return { ok: false, missing: true, error: 'A server function is missing. Run sql/admin/a12a-bookings.sql in the Supabase SQL editor.' };
        }
        return { ok: false, error: r.error.message || 'Request failed.' };
      }
      var d = r.data;
      if (d && typeof d === 'object' && 'ok' in d) return d;
      return { ok: false, error: 'Unexpected reply from the server.' };
    } catch (e) { return { ok: false, error: 'Could not reach the server.' }; }
  }

  /* ---------- tabs and filters ---------- */
  function drawTabs() {
    var box = $('bkTabs'); clear(box);
    TABS.forEach(function (t) {
      var on = state.tab === t[0];
      var b = h('button', 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'), t[1]); b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (state.tab === t[0]) return;
        state.tab = t[0]; state.filter = 'all'; state.search = ''; state.offset = 0; state.sel = null; state.data = null;
        $('bkSearch').value = ''; drawTabs(); drawFilter(); load();
      });
      box.appendChild(b);
    });
    $('bkSearchLabel').textContent = state.tab === 'regular' ? 'Search (customer, worker or booking id)'
      : (state.tab === 'local' ? 'Search (customer, Local Tasker or booking id)' : 'Search (title, customer or task id)');
  }
  function drawFilter() {
    var sel = $('bkFilter'); clear(sel);
    filtersFor(state.tab).forEach(function (f) { var o = h('option', null, f[1]); o.value = f[0]; sel.appendChild(o); });
    sel.value = state.filter;
  }
  $('bkFilters').addEventListener('submit', function (e) {
    e.preventDefault();
    state.search = $('bkSearch').value.trim(); state.filter = $('bkFilter').value; state.offset = 0; state.sel = null; load();
  });
  $('bkReset').addEventListener('click', function () {
    $('bkSearch').value = ''; $('bkFilter').value = 'all'; state.search = ''; state.filter = 'all'; state.offset = 0; state.sel = null; load();
  });

  /* ---------- load the list ---------- */
  async function load() {
    var mine = ++state.loadId; var body = $('bkBody');
    clear(body); body.appendChild(ctx.skeleton(4));
    var r = state.tab === 'tasks'
      ? await call('admin_task_list', { p_search: state.search || null, p_filter: state.filter, p_offset: state.offset })
      : await call('admin_booking_list', { p_kind: state.tab, p_search: state.search || null, p_filter: state.filter, p_offset: state.offset });
    if (mine !== state.loadId) return;
    if (!r.ok) { clear(body); ctx.showError(body, r.error, load); return; }
    state.data = r; render();
  }
  function items() { return (state.data && state.data.items) || []; }
  function byId(id) { return items().filter(function (x) { return x.id === id; })[0]; }

  function summary(counts) {
    var line = h('p', 'ad-hint'); var c = counts || {}; var parts;
    if (state.tab === 'local') {
      parts = [c.all + ' in all', c.needs_reassignment + ' need a coordinator', c.awaiting_tasker_confirmation + ' waiting for the worker',
        c.tasker_declined + ' declined by the worker', c.quote_sent + ' with a quote sent'];
    } else if (state.tab === 'tasks') {
      parts = [c.all + ' in all', c.open + ' open', c.in_progress + ' in progress', c.completed + ' completed', c.cancelled + ' cancelled', c.draft + ' draft'];
      if (c.other) parts.push(c.other + ' other');
    } else {
      parts = [c.all + ' in all', c.pending + ' pending', c.confirmed + ' confirmed', c.completed + ' completed', c.cancelled + ' cancelled'];
      if (c.other) parts.push(c.other + ' other status');
      if (c.locked) parts.push(c.locked + ' with the completion code locked');
    }
    line.textContent = parts.join(' · ');
    return line;
  }

  function pager(card, d) {
    if (!(state.offset > 0 || state.offset + items().length < d.total)) return;
    var p = h('div', 'ad-actions ad-pager');
    var prev = h('button', 'btn', 'Previous'); prev.type = 'button'; prev.disabled = state.offset <= 0;
    var next = h('button', 'btn', 'Next'); next.type = 'button'; next.disabled = state.offset + items().length >= d.total;
    prev.addEventListener('click', function () { state.offset = Math.max(0, state.offset - d.page_size); state.sel = null; load(); });
    next.addEventListener('click', function () { state.offset += d.page_size; state.sel = null; load(); });
    add(p, prev, h('span', 'ad-hint', 'Showing ' + (state.offset + 1) + ' to ' + (state.offset + items().length) + ' of ' + d.total), next);
    card.appendChild(p);
  }

  function render() {
    var body = $('bkBody'); clear(body);
    var d = state.data;
    var isTasks = state.tab === 'tasks';
    var split = h('div', 'ad-split' + (state.sel && !isTasks ? ' is-detail' : ''));
    var listCol = h('section', 'ad-split-list'); listCol.setAttribute('aria-label', isTasks ? 'Tasks' : 'Bookings');
    var detCol = h('section', 'ad-split-detail'); detCol.setAttribute('aria-label', 'Booking detail');
    var back = h('button', 'btn ad-back', 'Back to the list'); back.type = 'button';
    back.addEventListener('click', function () { state.sel = null; render(); });
    var detail = h('div'); add(detCol, back, detail);

    var card = h('div', 'ad-card');
    add(card, summary(d.counts), h('p', 'ad-hint', d.total + (d.total === 1 ? ' match' : ' matches')));
    if (!items().length) {
      var filtered = state.search || state.filter !== 'all';
      ctx.showEmpty(card, filtered ? 'Nothing matches these filters.' : (isTasks ? 'No task has been posted yet.' : 'No bookings here yet.'));
    } else {
      var ul = h('ul', 'ad-rows');
      items().forEach(function (x) {
        var b = isTasks ? h('div', 'ad-row') : h('button', 'ad-row'); if (!isTasks) b.type = 'button';
        if (state.sel === x.id) b.setAttribute('aria-current', 'true');
        if (isTasks) {
          add(b, add(h('span', 'ad-row-top'), h('span', 'ad-row-title', x.title || 'Task'), statusBadge(x.status)),
            h('span', 'ad-row-sub', [x.owner_name ? 'Posted by ' + x.owner_name : '', x.location].filter(Boolean).join(' · ')),
            h('span', 'ad-hint', [x.budget != null ? 'Budget ' + naira(x.budget) : '', when(x.created_at)].filter(Boolean).join(' · ')));
        } else {
          var facts = [x.tasker_name ? 'With ' + x.tasker_name : 'No worker named', x.amount != null ? naira(x.amount) : '', x.payment_status ? 'Payment: ' + words(x.payment_status) : '', when(x.created_at)];
          var top = add(h('span', 'ad-row-top'), h('span', 'ad-row-title', x.customer_name || 'Customer'),
            state.tab === 'local' ? h('span', 'badge badge-amber', LT[x.lt_status] || words(x.lt_status) || 'Local') : statusBadge(x.status));
          if (state.tab === 'local' && x.status) top.appendChild(statusBadge(x.status));
          if (x.locked) top.appendChild(h('span', 'badge badge-amber', 'Code locked'));
          if (x.disputed) top.appendChild(h('span', 'badge badge-amber', 'Dispute reason'));
          add(b, top, h('span', 'ad-row-sub', state.tab === 'local' && x.coordinator_name ? 'Coordinator: ' + x.coordinator_name : (x.work_stage ? 'On site: ' + words(x.work_stage) : '')),
            h('span', 'ad-hint', facts.filter(Boolean).join(' · ')));
          b.addEventListener('click', function () { state.sel = x.id; render(); });
        }
        add(ul, add(h('li'), b));
      });
      card.appendChild(ul);
      pager(card, d);
    }
    add(listCol, card);
    if (isTasks) { body.appendChild(listCol); return; }
    add(split, listCol, detCol); body.appendChild(split);
    var row = state.sel && byId(state.sel);
    if (row) drawDetail(detail, row);
    else add(detail, add(h('div', 'ad-card'), h('p', 'ad-note', 'Choose a booking on the left.')));
  }

  /* ---------- booking detail ---------- */
  function list(title, rows, empty, make) {
    var c = h('div', 'ad-card ad-panel'); add(c, h('h2', 'ad-panel-title', title));
    if (rows == null) add(c, h('p', 'ad-note', 'Not available.'));
    else if (!rows.length) add(c, h('p', 'ad-note', empty));
    else { var u = h('ul', 'ad-sub'); rows.forEach(function (r) { u.appendChild(make(r)); }); c.appendChild(u); }
    return c;
  }
  function eventName(e) { return words(e.kind || e.event || e.event_type || e.type) || 'Event'; }

  async function drawDetail(box, row) {
    var holder = h('div'); holder.appendChild(ctx.skeleton(3)); box.appendChild(holder);
    var r = await call('admin_booking_detail', { p_booking: row.id });
    if (state.sel !== row.id) return;
    clear(holder);
    if (!r.ok) { ctx.showError(holder, r.error, function () { render(); }); return; }
    var b = r.booking || {};

    var head = h('div', 'ad-card ad-panel');
    add(head, add(h('div', 'ad-row-top'), h('h2', 'ad-panel-title', 'Booking'), statusBadge(b.status)));
    add(head, dl([['Booking id', b.id], ['Customer', b.customer_name], [r.local ? 'Local Tasker' : 'Worker', r.local ? r.local.worker_name : b.tasker_name],
      ['Task', b.task_title], ['Amount', b.amount != null ? naira(b.amount) : null], ['Payment status', words(b.payment_status)],
      ['On-site step', words(b.work_stage)], ['Booked for', b.scheduled_time ? when(b.scheduled_time) : null], ['Created', when(b.created_at)],
      ['Completed', b.completed_at ? when(b.completed_at) : null], ['Completion code', b.locked ? 'Locked after wrong tries (' + num(b.code_attempts) + ')' : 'Wrong tries: ' + num(b.code_attempts)],
      ['Dispute reason', b.dispute_reason]]));
    add(head, h('p', 'ad-note', 'The street address, phone numbers, notes and the completion code are private and are not shown here. This page cannot change the booking or move money.'));
    if (r.sections_failed && r.sections_failed.length) {
      add(head, h('p', 'ad-error', 'Some parts could not be read: ' + r.sections_failed.map(function (k) { return SECTION[k] || k; }).join(', ') + '.'));
    }
    holder.appendChild(head);

    if (r.local) {
      var l = r.local; var lc = h('div', 'ad-card ad-panel'); add(lc, h('h2', 'ad-panel-title', 'Local booking'));
      add(lc, dl([['Stage', LT[l.lt_status] || words(l.lt_status)], ['Coordinator', l.coordinator_name], ['First coordinator', l.original_coordinator_name && l.original_coordinator_name !== l.coordinator_name ? l.original_coordinator_name : null]]));
      if (r.quote) add(lc, h('p', 'ad-hint', 'Current quote (version ' + num(r.quote.version) + '): service ' + naira(r.quote.service_fee) + ', transport ' + naira(r.quote.transport_amount) + ', materials ' + naira(r.quote.materials_amount) + '. Read only: admin never sets or changes a price.'));
      else add(lc, h('p', 'ad-hint', 'No current quote.'));
      add(lc, h('p', 'ad-hint', 'The worker must agree to each job. Reassigning a coordinator and unlocking a code are not on this page yet.'));
      holder.appendChild(lc);
      holder.appendChild(list('On-site steps', r.milestones, 'No on-site step recorded.', function (m) { return add(h('li'), h('span', null, eventName(m) + ' · ' + when(m.created_at))); }));
      holder.appendChild(list('Problems reported', r.exceptions, 'No problem reported.', function (m) {
        return add(h('li'), h('span', null, eventName(m) + ' · ' + when(m.created_at)), h('span', 'badge ' + (m.resolved_at ? 'badge-green' : 'badge-amber'), m.resolved_at ? 'Resolved' : 'Open'));
      }));
      holder.appendChild(list('Local booking history', r.local_events, 'No history yet.', function (e) { return add(h('li'), h('span', null, eventName(e) + ' · ' + when(e.created_at))); }));
    }

    var pay = h('div', 'ad-card ad-panel'); add(pay, h('h2', 'ad-panel-title', 'Payment held for this booking (read only)'));
    if (r.payment == null) add(pay, h('p', 'ad-note', 'Not available.'));
    else if (!r.payment.length) add(pay, h('p', 'ad-note', 'No payment record found.'));
    else {
      var pu = h('ul', 'ad-sub');
      r.payment.forEach(function (p) {
        add(pu, add(h('li'), h('span', null, naira(p.amount) + ' · fee ' + naira(p.platform_fee) + ' · worker ' + naira(p.tasker_amount) + ' · ' + when(p.created_at)), h('span', 'badge badge-gray', words(p.status) || 'Unknown')));
      });
      pay.appendChild(pu);
    }
    add(pay, h('p', 'ad-hint', 'Admin never releases, refunds or changes a payment from this page.'));
    holder.appendChild(pay);

    holder.appendChild(list('Disputes', r.disputes, 'No dispute found for this booking.', function (d) {
      var li = h('li'); add(li, h('span', null, (words(d.category) || 'Dispute') + ' · opened ' + when(d.opened_at) + (d.opened_by_role ? ' by the ' + d.opened_by_role : '')), h('span', 'badge badge-gray', words(d.status) || 'Unknown'));
      return li;
    }));
    holder.appendChild(list('Timeline', r.timeline, 'No timeline events found.', function (e) { return add(h('li'), h('span', null, eventName(e) + ' · ' + when(e.created_at))); }));
  }

  drawTabs(); drawFilter(); load();
});

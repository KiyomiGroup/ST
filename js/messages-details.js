/* ============================================================
   STREETTASKER — messages-details.js   (Job Room, Stage 4)
   The Job Details column: task, location, schedule, money and status,
   plus Payment History and Activity. On desktop (1045px and up) it fills the
   third column (#jrDetailBody). Below that the same content opens as a
   draggable bottom sheet from the room header (#chatHeadDetails).

   Public API (window.JRDetails):
     JRDetails.init()            wire the sheet, header button and viewport watcher
     JRDetails.update(ctx)       redraw for the open room ({ thread, user, role });
                                 call again whenever money or status changed
     JRDetails.openSheet()       open the bottom sheet (mobile / tablet)
     JRDetails.closeSheet()

   Where the figures come from:
     Every money figure comes from JRMoney.summary(thread) and
     JRMoney.history(thread), which read this task's own payment_requests.
     Nothing here is typed in or computed a second time.
     "Paid", "Held" and "Released" only show when the server set them.

   Other data (best effort, a blocked query just leaves that row blank):
     tasks        title, location, deadline
     bookings     scheduled_time
     job_events   Activity timeline (hidden if the table is missing)

   NOT built here (greyed in the action list with the reason):
     Receipts (Stage 8) and Evidence (Stage 9) have no data yet.

   No inline styles in markup, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var SNAP_PEEK = 0.58;        /* sheet height as a share of the room, half open */
  var SNAP_FULL = 0.94;        /* fully open */
  var CLOSE_BELOW = 0.32;      /* released lower than this = dismiss */
  var DESKTOP_MIN = 1045;

  var PAY_STATE = {
    none:       { label: 'No payment requested',       tone: 'muted'   },
    requested:  { label: 'Waiting for payment',        tone: 'action'  },
    processing: { label: 'Processing payment',         tone: 'action'  },
    partial:    { label: 'Part paid',                  tone: 'action'  },
    held:       { label: 'Paid, held by SafePay',      tone: 'success' },
    released:   { label: 'Released to the Tasker',     tone: 'success' },
    refunded:   { label: 'Refunded',                   tone: 'muted'   },
    disputed:   { label: 'Disputed, funds held',       tone: 'danger'  }
  };

  /* Request status as the person reads it. Matches the card states (spec 12, 42). */
  var REQ_STATUS = {
    pending:   { label: 'Waiting',    tone: 'action'  },
    accepted:  { label: 'Processing', tone: 'action'  },
    paid:      { label: 'Paid',       tone: 'success' },
    declined:  { label: 'Declined',   tone: 'muted'   },
    cancelled: { label: 'Cancelled',  tone: 'muted'   },
    failed:    { label: 'Failed',     tone: 'danger'  },
    refunded:  { label: 'Refunded',   tone: 'muted'   },
    disputed:  { label: 'Disputed',   tone: 'danger'  }
  };

  var ICON_CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  var ICON_BACK    = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var ICON_CLOSE   = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICONS = {
    task:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
    invoice:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>',
    receipt:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/></svg>',
    history:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    activity: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    evidence: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
  };

  var S = {
    ctx: null,                 /* { thread, user, role } */
    threadId: null,
    view: 'main',              /* main | history | activity */
    filter: 'all',             /* history filter: all | invoice */
    extra: {},                 /* per thread: { title, location, deadline, scheduled } */
    ev: { key: '', rows: null, loading: false, failed: false },
    eventsReady: null,         /* null = not probed, true / false after */
    sig: '',
    raf: 0,
    sheet: { open: false, h: 0, drag: null, lastFocus: null },
    bound: false
  };

  /* ── helpers ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgSpan(cls, svg) {
    var s = el('span', cls);
    s.innerHTML = svg;                 /* constant strings above, never user data */
    return s;
  }
  function naira(n) {
    return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  }
  function validDate(v) { var d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; }
  function fmtDate(v) {
    var d = validDate(v);
    return d ? d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }
  function fmtDateTime(v) {
    var d = validDate(v);
    if (!d) return '';
    return fmtDate(v) + ', ' + d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function isDesktop() { return window.matchMedia('(min-width: ' + DESKTOP_MIN + 'px)').matches; }
  function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function humanise(k) {
    var s = String(k || '').replace(/_/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Update';
  }
  function bookingIdOf(t) {
    return (t && t.context_type === 'booking' && t.context_id) ? t.context_id : null;
  }

  /* ── data (all best effort) ──────────────────────────────── */
  async function loadExtra(t) {
    if (!t || S.extra[t.id]) return false;
    var x = { taskId: t._taskId || null, title: '', location: '', deadline: '', scheduled: '' };
    S.extra[t.id] = x;                                   /* claim it so we only ask once */
    var sb = window.supabase;
    if (!sb) return false;
    if (t._taskId) {
      try {
        var r = await sb.from('tasks').select('id,title,location,deadline').eq('id', t._taskId).maybeSingle();
        if (r.error) r = await sb.from('tasks').select('id,title,location').eq('id', t._taskId).maybeSingle();
        if (r.data) {
          x.title = r.data.title || '';
          x.location = r.data.location || '';
          x.deadline = r.data.deadline || '';
        }
      } catch (_e) {}
    }
    var bid = bookingIdOf(t);
    if (bid) {
      try {
        var b = await sb.from('bookings').select('id,scheduled_time').eq('id', bid).maybeSingle();
        if (b.data) x.scheduled = b.data.scheduled_time || '';
      } catch (_e2) {}
    }
    return true;
  }

  async function probeEvents() {
    if (S.eventsReady !== null) return S.eventsReady;
    try {
      var r = await window.supabase.from('job_events').select('id').limit(1);
      S.eventsReady = !r.error;
    } catch (_e) { S.eventsReady = false; }
    return S.eventsReady;
  }

  async function loadEvents() {
    var c = S.ctx;
    var bid = c && bookingIdOf(c.thread);
    if (!bid || !S.eventsReady) { S.ev = { key: '', rows: [], loading: false, failed: false }; return false; }
    var key = bid + '|' + (c.thread.last_message_at || '');
    if (key === S.ev.key || S.ev.loading) return false;
    S.ev.loading = true;
    var token = c.thread.id;
    try {
      var r = await window.supabase.from('job_events')
        .select('id,kind,text,note,created_at,actor_id').eq('booking_id', bid)
        .order('created_at', { ascending: false }).limit(100);
      if (!S.ctx || S.ctx.thread.id !== token) { S.ev.loading = false; return false; }
      S.ev = { key: key, rows: r.error ? null : (r.data || []), loading: false, failed: !!r.error };
      return true;
    } catch (_e) {
      S.ev = { key: key, rows: null, loading: false, failed: true };
      return true;
    }
  }

  /* ── view model: one object both hosts draw from ─────────── */
  function model() {
    var c = S.ctx;
    if (!c) return null;
    var t = c.thread;
    var x = S.extra[t.id] || { title: '', location: '', deadline: '', scheduled: '' };
    var sm = window.JRMoney ? window.JRMoney.summary(t) : { base: 0, additions: 0, addonsPaid: 0, total: 0, paid: 0, outstanding: 0, payState: 'none' };
    var hist = window.JRMoney ? window.JRMoney.history(t) : [];
    var st = window.JRRoom ? window.JRRoom.statusFor(t, c.role) : { label: '' };
    return {
      t: t, role: c.role, me: c.user && c.user.id,
      title: x.title || t._title || 'This task',
      taskId: t._taskId || null,
      location: x.location,
      scheduled: x.scheduled, deadline: x.deadline,
      status: st.label || 'Discussing details',
      sm: sm, hist: hist,
      bookingId: bookingIdOf(t),
      ev: S.ev, eventsReady: S.eventsReady
    };
  }

  function signature(m) {
    if (!m) return 'none';
    return JSON.stringify([
      S.view, S.filter, m.t.id, m.title, m.location, m.scheduled, m.deadline, m.status,
      m.sm, m.hist, m.ev.rows, m.ev.loading, m.ev.failed, m.eventsReady, m.me
    ]);
  }

  /* ── building blocks ─────────────────────────────────────── */
  function row(label, valueNode, mod) {
    var r = el('div', 'jr-dt-row' + (mod ? ' jr-dt-row--' + mod : ''));
    r.appendChild(el('dt', 'jr-dt-label', label));
    var dd = el('dd', 'jr-dt-value');
    if (typeof valueNode === 'string') dd.textContent = valueNode; else dd.appendChild(valueNode);
    r.appendChild(dd);
    return r;
  }
  function muted(text) { return el('span', 'jr-dt-muted', text); }
  function chip(text, tone) { return el('span', 'jr-chip jr-chip--' + tone, text); }

  function group(title) {
    var g = el('section', 'jr-dt-group');
    g.appendChild(el('h3', 'jr-dt-heading', title));
    return g;
  }

  function actionItem(def) {
    /* def: { icon, label, hint, href, onClick, reason } — a reason greys it out and is always shown */
    var node;
    if (def.href && !def.reason) {
      node = el('a', 'jr-sheet-item jr-dt-action');
      node.href = def.href;
    } else {
      node = el('button', 'jr-sheet-item jr-dt-action');
      node.type = 'button';
      if (def.reason) node.disabled = true;
      else if (def.onClick) node.addEventListener('click', def.onClick);
    }
    node.appendChild(svgSpan('jr-sheet-item-icon', ICONS[def.icon]));
    var txt = el('span', 'jr-sheet-item-text');
    txt.appendChild(el('span', 'jr-sheet-item-label', def.label));
    var hint = def.reason || def.hint;
    if (hint) txt.appendChild(el('span', 'jr-sheet-item-hint' + (def.reason ? ' is-reason' : ''), hint));
    node.appendChild(txt);
    if (!def.reason) node.appendChild(svgSpan('jr-dt-chevron', ICON_CHEVRON));
    return node;
  }

  function goto(view, filter) {
    S.view = view; S.filter = filter || 'all';
    if (view === 'activity') {
      probeEvents().then(function () { return loadEvents(); }).then(function () { paint(true); });
    }
    paint(true);
    var body = S.sheet.open ? $('jrDetailSheetBody') : $('jrDetailBody');
    if (body) body.scrollTop = 0;
  }

  /* ── main view ───────────────────────────────────────────── */
  function viewMain(m) {
    var wrap = el('div', 'jr-dt');

    /* The job */
    var g1 = group('The job');
    var dl1 = el('dl', 'jr-dt-list');
    dl1.appendChild(row('Task', m.title));
    dl1.appendChild(row('Location', m.location || muted('Not set')));
    var when = m.scheduled ? fmtDateTime(m.scheduled)
             : (m.deadline ? 'Needed by ' + fmtDate(m.deadline) : '');
    dl1.appendChild(row('Scheduled', when || muted('Not scheduled yet')));
    dl1.appendChild(row('Task status', chip(m.status, m.t._job && m.t._job.key === 'disputed' ? 'danger' : 'success')));
    g1.appendChild(dl1);
    wrap.appendChild(g1);

    /* Payment */
    var sm = m.sm;
    var g2 = group('Payment');
    var dl2 = el('dl', 'jr-dt-list');
    dl2.appendChild(row('Agreed price', sm.base > 0 ? naira(sm.base) : muted('Not agreed yet')));
    dl2.appendChild(row('Additional paid costs', naira(sm.addonsPaid)));
    dl2.appendChild(row('Total paid', naira(sm.paid)));
    dl2.appendChild(row('Outstanding balance', sm.total > 0 ? naira(sm.outstanding) : muted('None yet'), 'key'));
    var ps = PAY_STATE[sm.payState] || PAY_STATE.none;
    dl2.appendChild(row('Payment status', chip(ps.label, ps.tone)));
    g2.appendChild(dl2);

    if (sm.total > 0) {
      var bar = el('progress', 'jr-dt-bar');
      bar.max = sm.total;
      bar.value = Math.min(sm.paid, sm.total);
      bar.setAttribute('aria-label', naira(sm.paid) + ' paid of ' + naira(sm.total));
      g2.appendChild(bar);
      g2.appendChild(el('p', 'jr-dt-bar-note', naira(sm.paid) + ' of ' + naira(sm.total) + ' paid'));
    } else {
      g2.appendChild(el('p', 'jr-dt-note', 'Agreed price, extra costs and payments for this task will appear here.'));
    }
    if (sm.waiting > 0) {
      g2.appendChild(el('p', 'jr-dt-note', naira(sm.waiting) + ' in requests is waiting for a reply and is not counted yet.'));
    }
    wrap.appendChild(g2);

    /* Links */
    var g3 = group('Records');
    var list = el('div', 'jr-dt-actions');
    var invoices = m.hist.filter(function (h) { return h.kind === 'invoice'; });
    var isCustomer = m.role === 'customer';
    var taskHref = m.taskId
      ? (isCustomer ? 'customer-applications.html?task=' : 'find-tasks.html?task=') + encodeURIComponent(m.taskId)
      : '';

    list.appendChild(actionItem({
      icon: 'task', label: 'View task', href: taskHref,
      reason: taskHref ? '' : 'No task linked to this conversation'
    }));
    list.appendChild(actionItem({
      icon: 'invoice', label: 'Invoice',
      hint: invoices.length ? (invoices.length === 1 ? '1 invoice' : invoices.length + ' invoices') : '',
      reason: invoices.length ? '' : 'No invoice for this task yet',
      onClick: function () { goto('history', 'invoice'); }
    }));
    list.appendChild(actionItem({
      icon: 'receipt', label: 'Receipts',
      reason: 'Not available yet'
    }));
    list.appendChild(actionItem({
      icon: 'history', label: 'Payment history',
      hint: m.hist.length ? (m.hist.length === 1 ? '1 request' : m.hist.length + ' requests') : '',
      reason: m.hist.length ? '' : 'No payments or requests yet',
      onClick: function () { goto('history', 'all'); }
    }));
    var actReason = '';
    if (!m.bookingId) actReason = 'Starts once the job is booked';
    else if (m.eventsReady === false) actReason = 'Not available yet';
    list.appendChild(actionItem({
      icon: 'activity', label: 'Activity', reason: actReason,
      onClick: function () { goto('activity'); }
    }));
    list.appendChild(actionItem({
      icon: 'evidence', label: 'Evidence',
      reason: 'Not available yet'
    }));
    g3.appendChild(list);
    wrap.appendChild(g3);
    return wrap;
  }

  /* ── sub-view frame ──────────────────────────────────────── */
  function frame(title, sub) {
    var wrap = el('div', 'jr-dt');
    var back = el('button', 'jr-sheet-back');
    back.type = 'button';
    back.appendChild(svgSpan('jr-dt-backicon', ICON_BACK));
    back.appendChild(document.createTextNode('Job details'));
    back.addEventListener('click', function () { goto('main'); });
    wrap.appendChild(back);
    wrap.appendChild(el('h3', 'jr-dt-title', title));
    if (sub) wrap.appendChild(el('p', 'jr-dt-sub', sub));
    return wrap;
  }

  /* ── Payment History ─────────────────────────────────────── */
  function viewHistory(m) {
    var invoicesOnly = S.filter === 'invoice';
    var wrap = frame(invoicesOnly ? 'Invoices' : 'Payment history',
      naira(m.sm.paid) + ' paid' + (m.sm.total > 0 ? ' · ' + naira(m.sm.outstanding) + ' still to pay' : ''));

    var items = m.hist.filter(function (h) { return !invoicesOnly || h.kind === 'invoice'; });
    if (!items.length) {
      wrap.appendChild(el('div', 'jr-dt-empty', invoicesOnly
        ? 'No invoice for this task yet.'
        : 'No payments yet. Payment requests, extra costs and refunds for this task will be listed here.'));
      return wrap;
    }

    var ol = el('ol', 'jr-dt-pay-list');
    var anyUncounted = false;
    items.forEach(function (h) {
      var rs = REQ_STATUS[h.status] || { label: humanise(h.status), tone: 'muted' };
      var dead = ['declined', 'cancelled', 'failed'].indexOf(h.status) !== -1;
      if (dead) anyUncounted = true;
      var li = el('li', 'jr-dt-pay' + (dead ? ' is-dead' : ''));

      var top = el('div', 'jr-dt-pay-top');
      var name = h.label + (h.invoiceNo ? ' ' + h.invoiceNo : '');
      top.appendChild(el('span', 'jr-dt-pay-name', name));
      top.appendChild(el('span', 'jr-dt-pay-amount', naira(h.amount)));
      li.appendChild(top);

      var det = h.title || h.reason;
      if (det) li.appendChild(el('div', 'jr-dt-pay-detail', det));

      var bot = el('div', 'jr-dt-pay-bottom');
      bot.appendChild(el('span', 'jr-dt-pay-date', fmtDateTime(h.date)));
      bot.appendChild(chip(rs.label, rs.tone));
      li.appendChild(bot);

      /* Original price and additional charges stay separate (spec 11 rule 8) */
      if (h.addon) li.appendChild(el('div', 'jr-dt-pay-tag', 'Additional charge, not part of the agreed price'));
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    if (anyUncounted) {
      wrap.appendChild(el('p', 'jr-dt-note', 'Declined, cancelled and failed requests stay in this list but are not counted in the totals.'));
    }
    return wrap;
  }

  /* ── Activity ────────────────────────────────────────────── */
  function viewActivity(m) {
    var wrap = frame('Activity', 'Newest first');
    var ev = m.ev;
    if (!m.bookingId) {
      wrap.appendChild(el('div', 'jr-dt-empty', 'Activity starts once the job is booked.'));
      return wrap;
    }
    if (m.eventsReady === false || ev.failed) {
      wrap.appendChild(el('div', 'jr-dt-empty', 'Activity is not available right now. Try again later.'));
      return wrap;
    }
    if (ev.loading || ev.rows === null) {
      wrap.appendChild(el('div', 'jr-dt-empty', 'Loading activity…'));
      return wrap;
    }
    if (!ev.rows.length) {
      wrap.appendChild(el('div', 'jr-dt-empty', 'Nothing has happened on this job yet. Payments, arrival and work updates will show here.'));
      return wrap;
    }
    var ol = el('ol', 'jr-dt-timeline');
    ev.rows.forEach(function (e) {
      var li = el('li', 'jr-dt-event');
      li.appendChild(el('span', 'jr-dt-dot'));
      var body = el('div', 'jr-dt-event-body');
      body.appendChild(el('div', 'jr-dt-event-text', e.text || humanise(e.kind)));
      if (e.note) body.appendChild(el('div', 'jr-dt-event-note', e.note));
      var who = e.actor_id ? (e.actor_id === m.me ? 'You' : (m.role === 'customer' ? 'Tasker' : 'Customer')) : 'StreetTasker';
      body.appendChild(el('div', 'jr-dt-event-meta', who + ' · ' + fmtDateTime(e.created_at)));
      li.appendChild(body);
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    return wrap;
  }

  function buildView(m) {
    if (S.view === 'history') return viewHistory(m);
    if (S.view === 'activity') return viewActivity(m);
    return viewMain(m);
  }

  /* ── paint into both hosts ───────────────────────────────── */
  function paint(force) {
    var m = model();
    var sig = signature(m);
    if (!force && sig === S.sig) return;
    S.sig = sig;

    var hosts = [$('jrDetailBody'), $('jrDetailSheetBody')];
    hosts.forEach(function (host) {
      if (!host) return;
      var keep = host.scrollTop;
      var hadFocusInside = host.contains(document.activeElement);
      host.textContent = '';
      if (!m) {
        host.appendChild(el('div', 'jr-detail-empty', 'Select a conversation to see the task, agreed price, payment status and activity.'));
        return;
      }
      host.appendChild(buildView(m));
      host.scrollTop = keep;
      if (hadFocusInside && force) {
        var target = host.querySelector('.jr-sheet-back, .jr-dt-action:not(:disabled)');
        if (target) target.focus();
      }
    });
  }

  function schedule() {
    if (S.raf) return;
    S.raf = window.requestAnimationFrame(function () { S.raf = 0; paint(false); });
  }

  /* ── public: update ──────────────────────────────────────── */
  function update(ctx) {
    if (ctx) {
      var changed = !S.ctx || S.ctx.thread.id !== ctx.thread.id;
      S.ctx = ctx;
      if (changed) {
        S.threadId = ctx.thread.id;
        S.view = 'main'; S.filter = 'all';
        S.ev = { key: '', rows: null, loading: false, failed: false };
        if (S.sheet.open) closeSheet(true);
      }
    }
    if (!S.ctx) { paint(true); return; }
    var t = S.ctx.thread;
    schedule();
    var have = S.extra[t.id];
    if (!have || (t._taskId && have.taskId !== t._taskId)) {
      /* first time for this thread, or the list found the task after we first looked */
      delete S.extra[t.id];
      loadExtra(t).then(function (did) { if (did) schedule(); });
    }
    if (S.view === 'activity') {
      probeEvents().then(function () { return loadEvents(); }).then(function (did) { if (did) schedule(); });
    }
    updateHeaderButton();
  }

  function updateHeaderButton() {
    var b = $('chatHeadDetails');
    if (b) b.hidden = !S.ctx;
  }

  /* ── bottom sheet ────────────────────────────────────────── */
  function layerEl() { return $('jrDetailSheetLayer'); }
  function sheetEl() { return $('jrDetailSheet'); }
  function layerH() { var l = layerEl(); return (l && l.clientHeight) || window.innerHeight; }

  function setHeight(px, settle) {
    var s = sheetEl(); if (!s) return;
    s.classList.toggle('is-settling', !!settle && !reducedMotion());
    s.style.setProperty('--dsheet-h', Math.round(px) + 'px');
    S.sheet.h = px;
    s.setAttribute('data-snap', px >= layerH() * ((SNAP_PEEK + SNAP_FULL) / 2) ? 'full' : 'peek');
  }

  function openSheet() {
    if (!S.ctx || isDesktop()) return;
    var layer = layerEl(), s = sheetEl();
    if (!layer || !s) return;
    S.sheet.lastFocus = document.activeElement;
    paint(true);
    layer.hidden = false;
    S.sheet.open = true;
    var btn = $('chatHeadDetails'); if (btn) btn.setAttribute('aria-expanded', 'true');
    setHeight(layerH() * SNAP_PEEK, false);
    var close = $('jrDetailSheetClose');
    if (close) close.focus();
  }

  function closeSheet(silent) {
    var layer = layerEl();
    if (!layer || !S.sheet.open) return;
    layer.hidden = true;
    S.sheet.open = false;
    var btn = $('chatHeadDetails'); if (btn) btn.setAttribute('aria-expanded', 'false');
    if (!silent && S.sheet.lastFocus && S.sheet.lastFocus.focus) S.sheet.lastFocus.focus();
    S.sheet.lastFocus = null;
  }

  function snapTo(which) {
    var target = which === 'full' ? SNAP_FULL : SNAP_PEEK;
    setHeight(layerH() * target, true);
  }

  function bindDrag(handle) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button') && e.target !== handle) return;   /* let the close button click */
      var s = sheetEl(); if (!s) return;
      s.classList.remove('is-settling');
      S.sheet.drag = { y: e.clientY, h: S.sheet.h, lastY: e.clientY, lastT: e.timeStamp, vy: 0 };
      s.classList.add('is-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (_e) {}
    });
    handle.addEventListener('pointermove', function (e) {
      var d = S.sheet.drag; if (!d) return;
      var max = layerH() * SNAP_FULL;
      var h = Math.max(0, Math.min(max, d.h - (e.clientY - d.y)));
      var dt = e.timeStamp - d.lastT;
      if (dt > 0) d.vy = (e.clientY - d.lastY) / dt;          /* px per ms, positive = moving down */
      d.lastY = e.clientY; d.lastT = e.timeStamp;
      setHeight(h, false);
    });
    function end(e) {
      var d = S.sheet.drag; if (!d) return;
      S.sheet.drag = null;
      var s = sheetEl(); if (s) s.classList.remove('is-dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch (_e) {}
      var H = layerH();
      var projected = S.sheet.h - d.vy * 160;                 /* where it was heading */
      var cands = [
        { k: 'close', h: 0 },
        { k: 'peek',  h: H * SNAP_PEEK },
        { k: 'full',  h: H * SNAP_FULL }
      ];
      if (projected < H * CLOSE_BELOW) { closeSheet(); return; }
      var best = cands[1];
      cands.forEach(function (c) { if (Math.abs(c.h - projected) < Math.abs(best.h - projected) && c.k !== 'close') best = c; });
      snapTo(best.k);
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);

    handle.addEventListener('keydown', function (e) {
      var s = sheetEl(); if (!s) return;
      var isFull = s.getAttribute('data-snap') === 'full';
      if (e.key === 'ArrowUp') { e.preventDefault(); snapTo('full'); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (isFull) snapTo('peek'); else closeSheet(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); snapTo(isFull ? 'peek' : 'full'); }
    });
  }

  function trapTab(e) {
    if (e.key !== 'Tab' || !S.sheet.open) return;
    var s = sheetEl(); if (!s) return;
    var f = s.querySelectorAll('a[href], button:not(:disabled), [tabindex="0"]');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ── init ────────────────────────────────────────────────── */
  function init() {
    if (S.bound) return;
    S.bound = true;
    var open = $('chatHeadDetails');
    if (open) open.addEventListener('click', openSheet);
    var close = $('jrDetailSheetClose');
    if (close) close.addEventListener('click', function () { closeSheet(); });
    var back = $('jrDetailSheetBackdrop');
    if (back) back.addEventListener('click', function () { closeSheet(); });
    var handle = $('jrDetailSheetHandle');
    if (handle) bindDrag(handle);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.sheet.open) { e.stopPropagation(); closeSheet(); }
      trapTab(e);
    });
    /* Resized up to the three-column layout: the sheet is no longer needed */
    var mq = window.matchMedia('(min-width: ' + DESKTOP_MIN + 'px)');
    var onMq = function () { if (mq.matches) closeSheet(true); else if (S.sheet.open) setHeight(Math.min(S.sheet.h, layerH() * SNAP_FULL), false); };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    window.addEventListener('resize', function () { if (S.sheet.open) setHeight(Math.min(S.sheet.h, layerH() * SNAP_FULL), false); });
    paint(true);
  }

  window.JRDetails = { init: init, update: update, openSheet: openSheet, closeSheet: closeSheet };

})();

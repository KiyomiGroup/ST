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

   Receipts (Stage 8): the list and each receipt are read from payment_receipts (written by the
     server when a payment is confirmed) and drawn inline here, with the same card as the chat
     ("View receipt"). They are drawn inside this panel on purpose: on a phone this sheet sits
     above the Request sheet, so a receipt opened in the Request sheet would be hidden behind it.

   Problem reports (Stage 10): job_disputes, job_refunds and dispute_events are read here and shown in
     the "dispute" view; a report is opened or withdrawn only through the server functions
     open_job_dispute / withdraw_job_dispute. A decision and a "Refund recorded" line appear only
     once support has written them. Refunds are made in the Paystack dashboard by the owner; this
     page never moves money. A bar above the composer (#jrDisputeBar) shows while a report is live.

   NOT built here (greyed in the action list with the reason):
     (nothing left: Evidence is the \"evidence\" view, read from job_attachments)

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
    dispute:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/></svg>',
    evidence: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
  };

  var LIVE = ['open', 'under_review'];
  var DP_STATUS = {
    open:         { label: 'Open',         tone: 'danger' },
    under_review: { label: 'Under review', tone: 'action' },
    resolved:     { label: 'Resolved',     tone: 'success' },
    withdrawn:    { label: 'Withdrawn',    tone: 'muted' }
  };
  var DP_CATEGORY = {
    not_done: 'The work was not done', poor_quality: 'The work was poor quality',
    no_show: 'The other person did not show up', wrong_amount: 'The amount is wrong',
    payment_issue: 'A payment problem', other: 'Something else'
  };
  var DP_OUTCOME = {
    refund_full: 'Full refund', refund_partial: 'Partial refund',
    release_to_tasker: 'The Tasker is paid, no refund', split: 'Part refunded, the rest to the Tasker',
    no_action: 'No action needed'
  };
  var DP_REASON_MIN = 10, DP_REASON_MAX = 1000;

  var S = {
    ctx: null,                 /* { thread, user, role } */
    threadId: null,
    view: 'main',              /* main | history | activity | receipts | receipt | evidence | dispute */
    filter: 'all',             /* history filter: all | invoice */
    extra: {},                 /* per thread: { title, location, deadline, scheduled } */
    ev: { key: '', rows: null, loading: false, failed: false },
    rc: { key: '', rows: null, loading: false, failed: false },   /* receipts of this thread */
    dp: { key: '', rows: null, refunds: [], events: [], loading: false, failed: false },   /* problem reports */
    evd: { key: '', rows: null, removed: 0, loading: false, failed: false },   /* evidence files of this thread (Stage 9) */
    dpDraft: { category: '', reason: '' },     /* kept so a redraw never wipes what the person typed */
    dpBusy: false, dpError: '',
    rcOpen: null,              /* receipt row shown in the 'receipt' view */
    rcBack: 'receipts',        /* where Back goes from the 'receipt' view */
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

  /* Evidence (Stage 9): every file kept against this task (job_attachments). Files support removed are
     not returned by the server to the two people, so they simply are not here; we only say how many. */
  async function loadEvidence(force) {
    var c = S.ctx;
    if (!c || !window.supabase) return false;
    var token = c.thread.id;
    var key = token + '|' + (c.thread.last_message_at || '');
    if (!force && (key === S.evd.key || S.evd.loading)) return false;
    S.evd.loading = true;
    try {
      var rs = await Promise.all([
        window.supabase.from('job_attachments')
          .select('id,kind,storage_path,mime,size,label,uploader_id,job_request_id,payment_request_id,created_at')
          .eq('thread_id', token).order('created_at', { ascending: false }).limit(200),
        window.supabase.from('evidence_removals').select('id', { count: 'exact', head: true }).eq('thread_id', token)
      ]);
      if (!S.ctx || S.ctx.thread.id !== token) { S.evd.loading = false; return false; }
      S.evd = { key: key, rows: rs[0].error ? null : (rs[0].data || []), removed: rs[1].error ? 0 : (rs[1].count || 0),
                loading: false, failed: !!rs[0].error };
      return true;
    } catch (_e) {
      S.evd = { key: key, rows: null, removed: 0, loading: false, failed: true };
      return true;
    }
  }

  /* Receipts: reloaded when the thread changes or another payment was paid (the server writes the
     receipt in the same transaction that marks the payment paid, so it is there when we look). */
  function paidCount() {
    var c = S.ctx;
    if (!c || !window.JRMoney) return 0;
    return window.JRMoney.history(c.thread).filter(function (h) { return h.status === 'paid'; }).length;
  }
  async function loadReceipts() {
    var c = S.ctx;
    if (!c || !window.JRMoney || !window.JRMoney.receiptsForThread) return false;
    var key = c.thread.id + '|' + paidCount();
    if (key === S.rc.key || S.rc.loading) return false;
    S.rc.loading = true;
    var token = c.thread.id;
    var rows = await window.JRMoney.receiptsForThread(token);
    if (!S.ctx || S.ctx.thread.id !== token) { S.rc.loading = false; return false; }
    S.rc = { key: key, rows: rows, loading: false, failed: rows === null };
    return true;
  }

  /* Problem reports of this thread. Reloaded when the thread changes, a message arrives, the
     dispute view is opened, or the person sends / withdraws a report (force). */
  function liveDispute() {
    var rows = S.dp.rows || [];
    for (var i = 0; i < rows.length; i++) if (LIVE.indexOf(rows[i].status) !== -1) return rows[i];
    return null;
  }
  async function loadDisputes(force) {
    var c = S.ctx;
    if (!c || !window.supabase) return false;
    var token = c.thread.id;
    var key = token + '|' + (c.thread.last_message_at || '');
    if (!force && (key === S.dp.key || S.dp.loading)) return false;
    S.dp.loading = true;
    try {
      var sb = window.supabase;
      var rs = await Promise.all([
        sb.from('job_disputes')
          .select('id,status,category,reason,opened_by,opened_by_role,outcome,resolution_note,opened_at,resolved_at')
          .eq('thread_id', token).order('opened_at', { ascending: false }).limit(20),
        sb.from('job_refunds').select('id,dispute_id,amount,paystack_ref,created_at')
          .eq('thread_id', token).order('created_at', { ascending: true }).limit(50),
        sb.from('dispute_events').select('id,dispute_id,kind,actor_id,note,created_at')
          .eq('thread_id', token).order('created_at', { ascending: true }).limit(100)
      ]);
      if (!S.ctx || S.ctx.thread.id !== token) { S.dp.loading = false; return false; }
      var bad = !!rs[0].error;
      S.dp = {
        key: key, loading: false, failed: bad,
        rows: bad ? null : (rs[0].data || []),
        refunds: rs[1].error ? [] : (rs[1].data || []),
        events: rs[2].error ? [] : (rs[2].data || [])
      };
      return true;
    } catch (_e) {
      S.dp = { key: key, loading: false, failed: true, rows: null, refunds: [], events: [] };
      return true;
    }
  }

  function updateBar() {
    var bar = $('jrDisputeBar');
    if (!bar) return;
    var live = S.ctx ? liveDispute() : null;
    if (!live) { bar.hidden = true; return; }
    var txt = $('jrDisputeBarText');
    /* Stage 12: the server now refuses release, the completion code and new payment requests while a report is live
       (job_booking_frozen), so it is true to say payment is on hold. */
    if (txt) txt.textContent = live.status === 'under_review'
      ? 'A problem report on this job is being reviewed by StreetTasker support. Payment is on hold until it is decided.'
      : 'A problem report is open on this job. Payment is on hold until StreetTasker support has decided it.';
    bar.hidden = false;
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
      ev: S.ev, eventsReady: S.eventsReady,
      rc: S.rc, dp: S.dp, evd: S.evd
    };
  }

  function signature(m) {
    if (!m) return 'none';
    return JSON.stringify([
      S.view, S.filter, m.t.id, m.title, m.location, m.scheduled, m.deadline, m.status,
      m.sm, m.hist, m.ev.rows, m.ev.loading, m.ev.failed, m.eventsReady, m.me,
      m.rc.rows && m.rc.rows.map(function (r) { return r.id; }), m.rc.failed, S.rcOpen && S.rcOpen.id,
      m.dp.key, m.dp.failed, m.dp.loading, m.dp.rows && m.dp.rows.map(function (d) { return d.id + d.status; }),
      m.dp.refunds.length, m.dp.events.length, S.dpBusy, S.dpError,
      m.evd.key, m.evd.failed, m.evd.loading, m.evd.removed, m.evd.rows && m.evd.rows.map(function (a) { return a.id; })
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
    if (view === 'receipts') loadReceipts().then(function (did) { if (did) schedule(); });
    if (view === 'evidence') loadEvidence(true).then(function (did) { if (did) paint(true); });
    if (view === 'dispute') { S.dpError = ''; loadDisputes(true).then(function (did) { if (did) { updateBar(); paint(true); } }); }
    paint(true);
    var body = S.sheet.open ? $('jrDetailSheetBody') : $('jrDetailBody');
    if (body) body.scrollTop = 0;
  }

  /* ── main view ───────────────────────────────────────────── */
  function viewMain(m) {
    var wrap = el('div', 'jr-dt');

    /* A live problem report comes first: both people must see it */
    var liveDp = m.dp.rows ? (function () { for (var i = 0; i < m.dp.rows.length; i++) if (LIVE.indexOf(m.dp.rows[i].status) !== -1) return m.dp.rows[i]; return null; })() : null;
    if (liveDp) {
      var alertBox = el('div', 'jr-dp-card jr-dp-card--live');
      alertBox.setAttribute('role', 'status');
      alertBox.appendChild(el('div', 'jr-dp-name', 'A problem report is ' + (liveDp.status === 'under_review' ? 'being reviewed' : 'open')));
      var seeBtn = el('button', 'jr-req-btn', 'View report');
      seeBtn.type = 'button';
      seeBtn.addEventListener('click', function () { goto('dispute'); });
      alertBox.appendChild(seeBtn);
      wrap.appendChild(alertBox);
    }

    /* At a glance: the few things people open this panel for (price, state, release code) */
    var gl = el('div', 'jr-glance');
    var glTop = el('div', 'jr-glance-top');
    var glPrice = el('div', 'jr-glance-price');
    glPrice.appendChild(el('span', 'jr-glance-label', m.sm.paid > 0 ? 'Paid' : 'Agreed price'));
    glPrice.appendChild(el('strong', 'jr-glance-amount', m.sm.paid > 0 ? naira(m.sm.paid) : (m.sm.base > 0 ? naira(m.sm.base) : 'Not agreed yet')));
    glTop.appendChild(glPrice);
    glTop.appendChild(chip(m.status, m.t._job && m.t._job.key === 'disputed' ? 'danger' : 'success'));
    gl.appendChild(glTop);
    if (m.sm.paid > 0 && m.sm.outstanding > 0) gl.appendChild(el('p', 'jr-glance-note', naira(m.sm.outstanding) + ' still to pay.'));
    if (m.role === 'customer' && m.bookingId && m.sm.paid > 0 && m.t._job && ['completed', 'cancelled'].indexOf(m.t._job.key) === -1 && window.JRFlow && window.JRFlow.codeNode) {
      gl.appendChild(window.JRFlow.codeNode(m.bookingId));
    }
    wrap.appendChild(gl);

    /* The job */
    var g1 = group('The job');
    var dl1 = el('dl', 'jr-dt-list');
    dl1.appendChild(row('Task', m.title));
    dl1.appendChild(row('Location', m.location || muted('Not set')));
    var when = m.scheduled ? fmtDateTime(m.scheduled)
             : (m.deadline ? 'Needed by ' + fmtDate(m.deadline) : '');
    dl1.appendChild(row('Scheduled', when || muted('Not scheduled yet')));
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
    var g3 = el('details', 'jr-dt-fold');
    g3.open = !!S.recOpen;
    g3.addEventListener('toggle', function () { S.recOpen = g3.open; });
    g3.appendChild(el('summary', 'jr-dt-fold-sum', 'Records and more'));
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
    var rcRows = m.rc.rows || [];
    list.appendChild(actionItem({
      icon: 'receipt', label: 'Receipts',
      hint: rcRows.length ? (rcRows.length === 1 ? '1 receipt' : rcRows.length + ' receipts') : '',
      reason: rcRows.length ? ''
        : (m.rc.failed ? 'Not available yet'
          : (m.rc.rows === null ? 'Loading…' : 'No receipts yet. One is issued for every payment')),
      onClick: function () { goto('receipts'); }
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
    var evRows = m.evd.rows || [];
    list.appendChild(actionItem({
      icon: 'evidence', label: 'Evidence',
      hint: evRows.length ? (evRows.length === 1 ? '1 file' : evRows.length + ' files') : '',
      reason: evRows.length ? ''
        : (m.evd.failed ? 'Not available yet' : (m.evd.rows === null ? 'Loading…' : 'No photos, videos or files yet')),
      onClick: function () { goto('evidence'); }
    }));
    g3.appendChild(list);
    wrap.appendChild(g3);

    /* Problem reports */
    var g4 = group('Problem with this job?');
    var list4 = el('div', 'jr-dt-actions');
    var pastCount = (m.dp.rows || []).filter(function (d) { return LIVE.indexOf(d.status) === -1; }).length;
    var dpReason = '';
    if (m.dp.failed) dpReason = 'Not available yet';
    else if (m.dp.rows === null) dpReason = 'Loading…';
    else if (!liveDp && !m.bookingId && !(m.sm.paid > 0)) dpReason = 'Available once a payment or booking exists';   /* UI hint only; the server decides */
    list4.appendChild(actionItem({
      icon: 'dispute',
      label: liveDp ? 'Problem report' : 'Report a problem',
      hint: liveDp ? DP_STATUS[liveDp.status].label : (pastCount ? (pastCount === 1 ? '1 past report' : pastCount + ' past reports') : ''),
      reason: dpReason,
      onClick: function () { goto('dispute'); }
    }));
    g4.appendChild(list4);
    wrap.appendChild(g4);
    return wrap;
  }

  /* ── sub-view frame ──────────────────────────────────────── */
  function frame(title, sub, backTo) {
    var wrap = el('div', 'jr-dt');
    var back = el('button', 'jr-sheet-back');
    back.type = 'button';
    back.appendChild(svgSpan('jr-dt-backicon', ICON_BACK));
    back.appendChild(document.createTextNode(backTo === 'receipts' ? 'Receipts' : (backTo === 'history' ? 'Payment history' : 'Job details')));
    back.addEventListener('click', function () { goto(backTo || 'main'); });
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
      /* Invoice due date. "Overdue" is display only: the server keeps no such state. */
      if (h.kind === 'invoice' && h.dueDate) {
        var dueRow = el('div', 'jr-dt-pay-detail', 'Due ' + fmtDate(String(h.dueDate).slice(0, 10) + 'T00:00:00') + ' ');
        if (h.overdue) dueRow.appendChild(chip('Overdue', 'danger'));
        li.appendChild(dueRow);
      }

      var bot = el('div', 'jr-dt-pay-bottom');
      bot.appendChild(el('span', 'jr-dt-pay-date', fmtDateTime(h.date)));
      bot.appendChild(chip(rs.label, rs.tone));
      li.appendChild(bot);

      /* Original price and additional charges stay separate (spec 11 rule 8) */
      if (h.addon) li.appendChild(el('div', 'jr-dt-pay-tag', 'Additional charge, not part of the agreed price'));
      /* Paid: the receipt, once the server has written it */
      if (h.status === 'paid') {
        var rcRow = receiptOfRequest(m, h.id);
        if (rcRow) {
          var vb = el('button', 'jr-req-btn', 'View receipt'); vb.type = 'button';
          vb.addEventListener('click', function () { openReceiptView(rcRow, 'history'); });
          li.appendChild(vb);
        }
      }
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    if (anyUncounted) {
      wrap.appendChild(el('p', 'jr-dt-note', 'Declined, cancelled and failed requests stay in this list but are not counted in the totals.'));
    }
    return wrap;
  }

  /* ── Receipts (Stage 8) ─────────────────────────────────── */
  var RECEIPT_LABEL = {
    payment: 'Payment', full_payment: 'Full payment', remaining_payment: 'Remaining payment', transport: 'Transport',
    additional_cost: 'Additional cost', materials: 'Materials', invoice: 'Invoice', booking: 'Booking payment'
  };
  function receiptOfRequest(m, requestId) {
    var rows = m.rc.rows || [];
    for (var i = 0; i < rows.length; i++) { if (rows[i].payment_request_id === requestId) return rows[i]; }
    return null;
  }
  function openReceiptView(rc, backTo) {
    S.rcOpen = rc; S.rcBack = backTo || 'receipts';
    goto('receipt');
  }

  function viewReceipts(m) {
    var rows = m.rc.rows || [];
    var wrap = frame('Receipts', 'A record of every payment on this task. A receipt cannot be changed.');
    if (!rows.length) {
      wrap.appendChild(el('div', 'jr-dt-empty', m.rc.failed
        ? 'Receipts are not available right now. Try again later.'
        : 'No receipts yet. One is issued each time a payment is confirmed.'));
      return wrap;
    }
    var ol = el('ol', 'jr-dt-pay-list');
    rows.forEach(function (rc) {
      var li = el('li', 'jr-dt-pay');
      var top = el('div', 'jr-dt-pay-top');
      top.appendChild(el('span', 'jr-dt-pay-name', (RECEIPT_LABEL[rc.kind] || 'Payment') + (rc.invoice_number ? ' ' + rc.invoice_number : '')));
      top.appendChild(el('span', 'jr-dt-pay-amount', naira(rc.amount)));
      li.appendChild(top);
      if (rc.title) li.appendChild(el('div', 'jr-dt-pay-detail', rc.title));
      var bot = el('div', 'jr-dt-pay-bottom');
      bot.appendChild(el('span', 'jr-dt-pay-date', rc.receipt_number + ' · ' + fmtDateTime(rc.paid_at)));
      li.appendChild(bot);
      var vb = el('button', 'jr-req-btn', 'View receipt'); vb.type = 'button';
      vb.addEventListener('click', function () { openReceiptView(rc, 'receipts'); });
      li.appendChild(vb);
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    return wrap;
  }

  function viewReceipt(m) {
    var wrap = frame('Receipt', '', S.rcBack);
    var rc = S.rcOpen;
    if (!rc || !window.JRRequests || !window.JRRequests.receiptNode) {
      wrap.appendChild(el('div', 'jr-dt-empty', 'This receipt is not available right now.'));
      return wrap;
    }
    wrap.appendChild(window.JRRequests.receiptNode(rc, m.role));
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

  /* ── Problem report ──────────────────────────────────────── */
  function naira2(n) {
    return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function toast(msg, type) { if (window.JRThread && window.JRThread.toast) window.JRThread.toast(msg, type); }

  function whoOf(m, actorId, d) {
    if (!actorId) return 'StreetTasker';
    if (actorId === m.me) return 'You';
    if (d && actorId === d.opened_by) return d.opened_by_role === 'customer' ? 'The Customer' : 'The Tasker';
    return 'StreetTasker support';
  }
  var EVENT_TEXT = {
    opened: 'Report opened', under_review: 'Support started reviewing', withdrawn: 'Report withdrawn',
    resolved: 'Decision recorded', refund_recorded: '', evidence_removed: '', chat_viewed: 'Support read the conversation'
  };

  async function sendReport(m) {
    var cat = S.dpDraft.category, reason = (S.dpDraft.reason || '').trim();
    if (!cat) { S.dpError = 'Choose what the problem is about.'; paint(true); return; }
    if (reason.length < DP_REASON_MIN) { S.dpError = 'Please describe the problem in at least ' + DP_REASON_MIN + ' characters.'; paint(true); return; }
    if (window.JRThread && window.JRThread.hasContactInfo && window.JRThread.hasContactInfo(reason)) {
      S.dpError = 'Please do not include phone numbers, emails or links. Describe what happened instead.'; paint(true); return;
    }
    S.dpBusy = true; S.dpError = ''; paint(true);
    var token = m.t.id;
    try {
      var r = await window.supabase.rpc('open_job_dispute', { p_thread: String(token), p_category: cat, p_reason: reason });
      var d = r && r.data;
      if (r.error || !d || !d.ok) {
        S.dpError = (d && d.error) || 'Could not send your report. Please try again.';
      } else {
        S.dpDraft = { category: '', reason: '' };
        toast('Report sent. Support will review it.');
      }
    } catch (_e) { S.dpError = 'Could not send your report. Check your connection and try again.'; }
    S.dpBusy = false;
    if (S.ctx && S.ctx.thread.id === token) { await loadDisputes(true); updateBar(); }
    paint(true);
  }

  async function withdrawReport(m, d) {
    if (!window.confirm('Withdraw this report? You can open a new one later if you need to.')) return;
    S.dpBusy = true; S.dpError = ''; paint(true);
    var token = m.t.id;
    try {
      var r = await window.supabase.rpc('withdraw_job_dispute', { p_dispute: d.id });
      var res = r && r.data;
      if (r.error || !res || !res.ok) S.dpError = (res && res.error) || 'Could not withdraw the report. Please try again.';
      else toast('Report withdrawn.');
    } catch (_e) { S.dpError = 'Could not withdraw the report. Check your connection and try again.'; }
    S.dpBusy = false;
    if (S.ctx && S.ctx.thread.id === token) { await loadDisputes(true); updateBar(); }
    paint(true);
  }

  function disputeCard(m, d, live) {
    var card = el('div', 'jr-dp-card' + (live ? ' jr-dp-card--live' : ''));
    var top = el('div', 'jr-dp-top');
    top.appendChild(el('span', 'jr-dp-name', DP_CATEGORY[d.category] || 'Problem report'));
    var st = DP_STATUS[d.status] || { label: humanise(d.status), tone: 'muted' };
    top.appendChild(chip(st.label, st.tone));
    card.appendChild(top);
    card.appendChild(el('div', 'jr-dp-meta', 'Opened by ' + whoOf(m, d.opened_by, d).toLowerCase() + ' · ' + fmtDateTime(d.opened_at)));
    card.appendChild(el('p', 'jr-dp-text', d.reason));

    if (d.status === 'resolved') {
      var head = el('div', 'jr-dp-name', 'Decision: ' + (DP_OUTCOME[d.outcome] || humanise(d.outcome)));
      card.appendChild(head);
      if (d.resolution_note) card.appendChild(el('p', 'jr-dp-text', d.resolution_note));
      if (d.resolved_at) card.appendChild(el('div', 'jr-dp-meta', 'Decided ' + fmtDateTime(d.resolved_at)));
    }

    var refunds = m.dp.refunds.filter(function (x) { return x.dispute_id === d.id; });
    if (refunds.length) {
      card.appendChild(el('div', 'jr-dp-name', 'Refund recorded'));
      refunds.forEach(function (x) {
        var line = el('div', 'jr-dp-refund');
        line.appendChild(el('span', '', naira2(x.amount)));
        line.appendChild(el('span', 'jr-dp-refund-ref', 'Ref ' + x.paystack_ref + ' · ' + fmtDate(x.created_at)));
        card.appendChild(line);
      });
    }

    if (live) {
      var evs = m.dp.events.filter(function (x) { return x.dispute_id === d.id; });
      if (evs.length) {
        var ol = el('ol', 'jr-dt-timeline');
        evs.forEach(function (e) {
          var li = el('li', 'jr-dt-event');
          li.appendChild(el('span', 'jr-dt-dot'));
          var b = el('div', 'jr-dt-event-body');
          var text = EVENT_TEXT[e.kind] || e.note || humanise(e.kind);
          b.appendChild(el('div', 'jr-dt-event-text', text));
          b.appendChild(el('div', 'jr-dt-event-meta', whoOf(m, e.actor_id, d) + ' · ' + fmtDateTime(e.created_at)));
          li.appendChild(b); ol.appendChild(li);
        });
        card.appendChild(ol);
      }
      card.appendChild(el('p', 'jr-dp-note', 'Keep sharing photos and details in this chat. Support can see them while the report is open.'));
      if (d.status === 'open' && d.opened_by === m.me) {
        var wd = el('button', 'jr-req-btn', 'Withdraw report');
        wd.type = 'button'; wd.disabled = S.dpBusy;
        wd.addEventListener('click', function () { withdrawReport(m, d); });
        card.appendChild(wd);
      }
    }
    return card;
  }

  function disputeForm(m) {
    var form = el('div', 'jr-dp-form');
    var l1 = el('label', 'jr-dp-label', 'What is the problem about?');
    l1.htmlFor = 'jrDpCategory';
    var sel = el('select', 'jr-dp-select');
    sel.id = 'jrDpCategory';
    var ph = el('option', '', 'Choose one'); ph.value = '';
    sel.appendChild(ph);
    Object.keys(DP_CATEGORY).forEach(function (k) {
      var o = el('option', '', DP_CATEGORY[k]); o.value = k; sel.appendChild(o);
    });
    sel.value = S.dpDraft.category || '';
    sel.addEventListener('change', function () { S.dpDraft.category = sel.value; });

    var l2 = el('label', 'jr-dp-label', 'What happened?');
    l2.htmlFor = 'jrDpReason';
    var ta = el('textarea', 'jr-dp-textarea');
    ta.id = 'jrDpReason'; ta.maxLength = DP_REASON_MAX; ta.rows = 5;
    ta.placeholder = 'Describe the problem and what you would like to happen. The other person and StreetTasker support can read this.';
    ta.value = S.dpDraft.reason || '';
    var count = el('span', 'jr-dp-count', ta.value.length + ' / ' + DP_REASON_MAX);
    ta.addEventListener('input', function () { S.dpDraft.reason = ta.value; count.textContent = ta.value.length + ' / ' + DP_REASON_MAX; });

    var err = el('p', 'jr-dp-error', S.dpError);
    err.setAttribute('role', 'alert');
    err.hidden = !S.dpError;

    var go = el('button', 'jr-req-btn jr-req-btn--primary', S.dpBusy ? 'Sending…' : 'Send report');
    go.type = 'button'; go.disabled = S.dpBusy;
    go.addEventListener('click', function () { sendReport(m); });

    form.appendChild(l1); form.appendChild(sel);
    form.appendChild(l2); form.appendChild(ta); form.appendChild(count);
    form.appendChild(err); form.appendChild(go);
    form.appendChild(el('p', 'jr-dp-note', 'Reports are for real problems with this job. Your payment stays handled by StreetTasker and refunds, if any, are decided by support.'));
    return form;
  }

  function viewDispute(m) {
    var wrap = frame('Problem report', 'Tell us if something went wrong with this job.', 'main');
    var dp = m.dp;
    if (dp.failed) { wrap.appendChild(el('div', 'jr-dt-empty', 'Problem reports are not available right now. Try again later.')); return wrap; }
    if (dp.rows === null) { wrap.appendChild(el('div', 'jr-dt-empty', 'Loading…')); return wrap; }

    var live = null;
    for (var i = 0; i < dp.rows.length; i++) if (LIVE.indexOf(dp.rows[i].status) !== -1) { live = dp.rows[i]; break; }

    if (live) {
      wrap.appendChild(disputeCard(m, live, true));
      if (S.dpError) { var e1 = el('p', 'jr-dp-error', S.dpError); e1.setAttribute('role', 'alert'); wrap.appendChild(e1); }
    } else {
      wrap.appendChild(disputeForm(m));
    }

    var past = dp.rows.filter(function (d) { return LIVE.indexOf(d.status) === -1; });
    if (past.length) {
      var g = group('Past reports');
      var ul = el('ul', 'jr-dp-list');
      past.forEach(function (d) { var li = el('li'); li.appendChild(disputeCard(m, d, false)); ul.appendChild(li); });
      g.appendChild(ul);
      wrap.appendChild(g);
    }
    return wrap;
  }

  var EVD_GROUPS = [
    ['Photos and videos', ['photo', 'video']],
    ['Receipts', ['receipt']],
    ['Files', ['file']]
  ];
  var EVD_KIND = { photo: 'Photo', video: 'Video', file: 'File', receipt: 'Receipt' };
  function evdSize(b) { var n = Number(b) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function viewEvidence(m) {
    var rows = m.evd.rows || [];
    var wrap = frame('Evidence', 'Photos, videos and files kept with this task. Only you, the other person and StreetTasker support can open them. Photos are always optional.');
    if (!rows.length) {
      wrap.appendChild(el('div', 'jr-dt-empty', m.evd.failed
        ? 'Evidence is not available right now. Try again later.'
        : (m.evd.rows === null ? 'Loading…' : 'Nothing has been shared on this task yet.')));
      return wrap;
    }
    EVD_GROUPS.forEach(function (gdef) {
      var items = rows.filter(function (a) { return gdef[1].indexOf(a.kind) !== -1; });
      if (!items.length) return;
      var g = group(gdef[0]);
      var ol = el('ol', 'jr-dt-pay-list');
      items.forEach(function (a) {
        var li = el('li', 'jr-dt-pay');
        var top = el('div', 'jr-dt-pay-top');
        top.appendChild(el('span', 'jr-dt-pay-name', a.label || EVD_KIND[a.kind] || 'File'));
        top.appendChild(el('span', 'jr-dt-pay-amount', evdSize(a.size)));
        li.appendChild(top);
        var who = a.uploader_id === m.me ? 'You' : (m.role === 'customer' ? 'Tasker' : 'Customer');
        var extra = a.job_request_id ? ' · Answer to a request' : (a.payment_request_id ? ' · Attached to a payment' : '');
        li.appendChild(el('div', 'jr-dt-pay-date', who + ' · ' + (EVD_KIND[a.kind] || 'File') + ' · ' + fmtDateTime(a.created_at) + extra));
        var ob = el('button', 'jr-req-btn', 'Open'); ob.type = 'button';
        ob.addEventListener('click', async function () {
          ob.disabled = true;
          var url = window.JRThread && window.JRThread.signedUrl ? await window.JRThread.signedUrl(a.storage_path, true) : '';
          ob.disabled = false;
          if (!url) { toast('Could not open the file. Try again.', 'error'); return; }
          window.open(url, '_blank', 'noopener');
        });
        li.appendChild(ob);
        ol.appendChild(li);
      });
      g.appendChild(ol);
      wrap.appendChild(g);
    });
    if (m.evd.removed > 0) {
      wrap.appendChild(el('p', 'jr-dt-sub', (m.evd.removed === 1 ? '1 file was' : m.evd.removed + ' files were') + ' removed by StreetTasker support.'));
    }
    return wrap;
  }

  function buildView(m) {
    if (S.view === 'evidence') return viewEvidence(m);
    if (S.view === 'dispute') return viewDispute(m);
    if (S.view === 'history') return viewHistory(m);
    if (S.view === 'activity') return viewActivity(m);
    if (S.view === 'receipts') return viewReceipts(m);
    if (S.view === 'receipt') return viewReceipt(m);
    return viewMain(m);
  }

  /* ── paint into both hosts ───────────────────────────────── */
  function paint(force) {
    var m = model();
    updateBar();
    var sig = signature(m);
    if (!force && sig === S.sig) return;
    /* Never redraw under someone who is typing a report */
    var ae = document.activeElement;
    if (!force && S.view === 'dispute' && ae && /^(TEXTAREA|SELECT)$/.test(ae.tagName) &&
        ((($('jrDetailBody') || {}).contains && $('jrDetailBody').contains(ae)) || (($('jrDetailSheetBody') || {}).contains && $('jrDetailSheetBody').contains(ae)))) return;
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
        S.rc = { key: '', rows: null, loading: false, failed: false };
        S.rcOpen = null;
        S.dp = { key: '', rows: null, refunds: [], events: [], loading: false, failed: false };
        S.dpDraft = { category: '', reason: '' }; S.dpError = ''; S.dpBusy = false;
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
    loadReceipts().then(function (did) { if (did) schedule(); });      /* also enables the Receipts link */
    loadDisputes(false).then(function (did) { if (did) { updateBar(); schedule(); } });
    loadEvidence(false).then(function (did) { if (did) schedule(); });
    updateHeaderButton();
  }

  /* The schedule is read once per thread; call this after a reschedule was accepted so the new time shows */
  function refreshExtra() {
    if (S.ctx && S.ctx.thread) delete S.extra[S.ctx.thread.id];
    update();
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
    var barBtn = $('jrDisputeBarBtn');
    if (barBtn) barBtn.addEventListener('click', function () {
      goto('dispute');
      if (!isDesktop()) openSheet();
    });
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

  window.JRDetails = { init: init, update: update, refreshExtra: refreshExtra, openSheet: openSheet, closeSheet: closeSheet };

})();

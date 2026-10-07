/* ============================================================
   STREETTASKER — messages-request.js   (Job Room, step 5)
   The "Request" sheet (spec sections 6, 7 and 39).

   One button in the composer opens one sheet. The items in the sheet
   change with the ROLE (customer / tasker) and the JOB STATE (no job
   yet, payment pending, payment secured, work started, completion
   submitted, disputed, closed). Nothing else sits under the chat.

   Public API (window.JRRequest), used by messages.html:
     JRRequest.init({ handlers })     wire the button + sheet (call once).
                                      handlers: { action_id: function () {} }
     JRRequest.setContext(ctx)        a thread was opened: ctx = { thread, user, role }
     JRRequest.open() / close()       show / hide the sheet
     JRRequest.itemsFor(thread, role) groups + items the sheet would show now

   Each action below has a `live` flag. Only live actions run. Everything
   else is shown greyed with a "Soon" tag until its step ships (money cards
   step 6, work steps 7, proof step 8, safety step 10). To switch one on:
   set live: true and add its handler in messages.html.

   Rule results (see `rule` on each action):
     null            available
     'some reason'   shown greyed with that reason (tap shows it)
     false           not shown at all

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var S = { thread: null, user: null, role: 'customer', handlers: {}, bound: false, isOpen: false };

  /* ── icons (constant markup only) ────────────────────────── */
  function svg(inner) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ICONS = {
    payment:   svg('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
    transport: svg('<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    costs:     svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
    documents: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
    work:      svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    schedule:  svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    issue:     svg('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    close:     svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')
  };

  /* Group order follows spec section 39. */
  var GROUPS = [
    { key: 'payment',   label: 'Payment' },
    { key: 'transport', label: 'Transport' },
    { key: 'costs',     label: 'Job costs' },
    { key: 'documents', label: 'Documents' },
    { key: 'work',      label: 'Work' },
    { key: 'schedule',  label: 'Schedule' },
    { key: 'issue',     label: 'Issue' }
  ];

  /* ── job context (what the rules look at) ────────────────────
     Built from the same state the status banner uses, so the sheet
     never disagrees with the banner. */
  var WORKING = ['started', 'in_progress', 'paused'];

  function contextFor(thread, role) {
    var st = (window.JRRoom && window.JRRoom.statusFor)
      ? window.JRRoom.statusFor(thread, role)
      : { key: 'inquiry', job: { key: 'inquiry' } };
    var key = (st.job && st.job.key) || 'inquiry';
    var bk = thread.booking || null;

    var pr = thread.latestRequest || null;
    var closed = key === 'completed' || key === 'cancelled';
    /* A disputed job is always a paid one, but derive() reports it as 'disputed' */
    var paidBeforeDispute = key === 'disputed' && ((bk && bk.payment_status === 'paid') || (pr && pr.status === 'paid'));
    var paid = key === 'secured' || key === 'awaiting_confirmation' || st.key === 'work' || paidBeforeDispute;
    return {
      role: role,
      key: key,
      closed: closed,
      cancelled: key === 'cancelled',
      disputed: key === 'disputed',
      paymentPending: key === 'payment_pending',
      awaiting: key === 'awaiting_confirmation',
      paid: paid && !closed,
      hasJob: key !== 'inquiry' || st.key === 'booked',
      workStarted: !!(bk && WORKING.indexOf(bk.status) !== -1)
    };
  }

  var LOCKED = 'Locked while an issue is under review';
  var NEEDS_PAYMENT = 'Available once payment is secured';
  var NEEDS_JOB = 'Available once the job is booked';

  /* ── actions ─────────────────────────────────────────────────
     roles: who sees it. group: where it sits. rule(c): see header.
     Wording follows spec sections 6 and 7. */
  var ACTIONS = [
    /* ===== TASKER (spec 7) ===== */
    { id: 'request_payment', roles: ['tasker'], group: 'payment', label: 'Request Payment', hint: 'Ask the customer to pay for this job', live: true,
      rule: function (c) {
        if (c.closed) return false;
        if (c.disputed) return LOCKED;
        if (c.paymentPending) return 'A payment request is already waiting';
        if (c.paid) return 'Payment is already secured';
        return null;
      } },
    { id: 'request_remaining', roles: ['tasker'], group: 'payment', label: 'Request Remaining Payment', hint: 'Ask for the balance still owed',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (c.disputed) return LOCKED;
        if (c.awaiting) return 'Waiting for the customer to confirm the work';
        if (!c.paid) return 'Available once the first payment is secured';
        return null;
      } },
    { id: 'request_transport', roles: ['tasker'], group: 'transport', label: 'Request Transport', hint: 'Ask the customer to approve a transport cost',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (c.disputed) return LOCKED;
        if (c.awaiting) return 'Waiting for the customer to confirm the work';
        return null;
      } },
    { id: 'request_materials', roles: ['tasker'], group: 'costs', label: 'Request Materials', hint: 'Ask the customer to approve materials',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (c.disputed) return LOCKED;
        if (c.awaiting) return 'Waiting for the customer to confirm the work';
        if (!c.paid) return NEEDS_PAYMENT;
        return null;
      } },
    { id: 'request_additional_cost', roles: ['tasker'], group: 'costs', label: 'Request Additional Cost', hint: 'Extra work or parts found during the job',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (c.disputed) return LOCKED;
        if (c.awaiting) return 'Waiting for the customer to confirm the work';
        if (!c.paid) return NEEDS_PAYMENT;
        return null;
      } },
    { id: 'send_invoice', roles: ['tasker'], group: 'documents', label: 'Send Invoice', hint: 'Labour, materials and transport in one invoice',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (c.disputed) return LOCKED;
        return null;
      } },
    { id: 'submit_proof', roles: ['tasker'], group: 'work', label: 'Submit Proof', hint: 'Photos, receipts or documents of the work',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (!c.paid) return NEEDS_PAYMENT;
        return null;
      } },
    { id: 'send_update', roles: ['tasker'], group: 'work', label: 'Send Work Update', hint: 'Tell the customer how the job is going',
      rule: function (c) { return (c.closed || !c.hasJob) ? false : null; } },
    { id: 'start_work', roles: ['tasker'], group: 'work', label: 'Mark Work Started', hint: 'Record the time you began',
      rule: function (c) {
        if (c.closed || !c.hasJob || c.workStarted || c.awaiting) return false;
        if (c.disputed) return LOCKED;
        if (!c.paid) return NEEDS_PAYMENT;
        return null;
      } },
    { id: 'complete_work', roles: ['tasker'], group: 'work', label: 'Mark Work Completed', hint: 'Submit the work for customer confirmation',
      rule: function (c) {
        if (c.closed || !c.hasJob || c.awaiting || !c.paid) return false;
        if (c.disputed) return LOCKED;
        if (!c.workStarted) return 'Mark the work as started first';
        return null;
      } },
    { id: 'request_extension', roles: ['tasker'], group: 'schedule', label: 'Request Extension', hint: 'Ask for more time on this job',
      rule: function (c) {
        if (c.closed || c.awaiting || !c.workStarted) return false;
        if (c.disputed) return LOCKED;
        return null;
      } },

    /* ===== CUSTOMER (spec 6) ===== */
    { id: 'make_payment', roles: ['customer'], group: 'payment', label: 'Make Payment', hint: 'Pay the request waiting in this chat',
      rule: function (c) {
        if (c.closed || !c.hasJob || c.paid) return false;
        if (c.disputed) return LOCKED;
        if (!c.paymentPending) return 'No payment has been requested yet';
        return null;
      } },
    { id: 'pay_remaining', roles: ['customer'], group: 'payment', label: 'Pay Remaining Balance', hint: 'Pay what is still owed on this job',
      rule: function (c) {
        if (c.closed || !c.paid || c.awaiting) return false;
        if (c.disputed) return LOCKED;
        return 'No balance has been requested yet';
      } },
    { id: 'release_payment', roles: ['customer'], group: 'payment', label: 'Release Payment', hint: 'Confirm the work is done and pay the tasker',
      rule: function (c) {
        if (c.closed || !c.paid) return false;
        if (c.disputed) return LOCKED;
        if (!c.awaiting) return 'Available once the tasker submits the work';
        return null;
      } },
    { id: 'approve_additional_cost', roles: ['customer'], group: 'costs', label: 'Approve Additional Cost', hint: 'Review extra costs from the tasker',
      rule: function (c) {
        if (c.closed || !c.paid) return false;
        if (c.disputed) return LOCKED;
        return 'No additional cost is waiting for you';
      } },
    { id: 'request_invoice', roles: ['customer'], group: 'documents', label: 'Request Invoice', hint: 'Ask the tasker for an invoice',
      rule: function (c) { return (c.closed || !c.hasJob) ? false : null; } },
    { id: 'request_receipt', roles: ['customer'], group: 'documents', label: 'Request Receipt', hint: 'Ask for material or purchase receipts',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (!c.paid) return NEEDS_PAYMENT;
        return null;
      } },
    { id: 'request_update', roles: ['customer'], group: 'work', label: 'Request Update', hint: 'Ask how the job is going',
      rule: function (c) { return (c.closed || !c.hasJob) ? false : null; } },
    { id: 'request_arrival', roles: ['customer'], group: 'work', label: 'Request Arrival', hint: 'Ask when the tasker will arrive',
      rule: function (c) { return (c.closed || !c.paid || c.workStarted || c.awaiting) ? false : null; } },
    { id: 'request_proof', roles: ['customer'], group: 'work', label: 'Request Proof of Work', hint: 'Before and after photos, receipts or video',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (!c.paid) return NEEDS_PAYMENT;
        return null;
      } },
    { id: 'add_information', roles: ['customer'], group: 'work', label: 'Add Information', hint: 'Send extra details about the job',
      rule: function (c) { return (c.closed || !c.hasJob) ? false : null; } },
    { id: 'share_location', roles: ['customer'], group: 'work', label: 'Share Location', hint: 'Send the job location',
      rule: function (c) { return (c.closed || !c.hasJob) ? false : null; } },

    /* ===== BOTH ===== */
    { id: 'reschedule', roles: ['customer', 'tasker'], group: 'schedule', label: 'Reschedule', hint: 'Propose a new date or time',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (c.disputed) return LOCKED;
        if (c.awaiting) return 'Not available while the work awaits confirmation';
        return null;
      } },
    { id: 'request_refund', roles: ['customer'], group: 'issue', label: 'Request Refund', hint: 'Ask for money back on a paid job',
      rule: function (c) { return (c.closed || !c.paid) ? false : null; } },
    { id: 'request_cancellation', roles: ['customer'], group: 'issue', label: 'Request Cancellation', hint: 'Ask to cancel this job',
      rule: function (c) {
        if (c.closed || !c.hasJob) return false;
        if (c.disputed) return LOCKED;
        return null;
      } },
    { id: 'report_issue', roles: ['customer', 'tasker'], group: 'issue', label: 'Report an Issue', hint: 'Tell StreetTasker something is wrong',
      rule: function (c) {
        if (c.cancelled) return false;
        if (c.disputed) return 'An issue is already under review';
        return null;
      } }
  ];

  /* ── what the sheet shows right now ──────────────────────── */
  function itemsFor(thread, role) {
    var c = contextFor(thread, role);
    var groups = [];
    GROUPS.forEach(function (g) {
      var items = [];
      ACTIONS.forEach(function (a) {
        if (a.group !== g.key || a.roles.indexOf(role) === -1) return;
        var r = a.rule(c);
        if (r === false) return;
        items.push({
          id: a.id, label: a.label, hint: a.hint,
          live: a.live === true,
          blockedReason: typeof r === 'string' ? r : ''
        });
      });
      if (items.length) groups.push({ key: g.key, label: g.label, items: items });
    });
    return { groups: groups, hasJob: c.hasJob };
  }

  /* ── dom ─────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg, type) {
    if (window.JRThread && window.JRThread.toast) window.JRThread.toast(msg, type);
  }

  function itemNode(it) {
    var btn = el('button', 'jr-sheet-item');
    btn.type = 'button';
    btn.dataset.action = it.id;
    var usable = it.live && !it.blockedReason;
    if (!usable) {
      btn.classList.add('is-disabled');
      btn.setAttribute('aria-disabled', 'true');
    }

    var text = el('span', 'jr-sheet-item-text');
    text.appendChild(el('span', 'jr-sheet-item-label', it.label));
    text.appendChild(el('span', 'jr-sheet-item-hint', it.blockedReason || it.hint));
    btn.appendChild(text);

    if (!it.blockedReason && !it.live) btn.appendChild(el('span', 'jr-sheet-tag', 'Soon'));

    btn.addEventListener('click', function () {
      if (it.blockedReason) { toast(it.blockedReason); return; }
      if (!it.live) { toast(it.label + ' is coming soon.'); return; }
      var fn = S.handlers[it.id];
      close();
      if (typeof fn === 'function') fn();
    });
    return btn;
  }

  function build() {
    var host = $('jrSheet');
    if (!host || !S.thread) return;
    host.textContent = '';

    host.appendChild(el('div', 'jr-sheet-grip'));

    var head = el('div', 'jr-sheet-head');
    head.appendChild(el('h2', 'jr-sheet-title', 'Request'));
    var x = el('button', 'jr-icon-btn');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = ICONS.close;               /* constant markup */
    x.addEventListener('click', close);
    head.appendChild(x);
    host.appendChild(head);

    var body = el('div', 'jr-sheet-body');
    var res = itemsFor(S.thread, S.role);
    res.groups.forEach(function (g) {
      var sec = el('div', 'jr-sheet-group');
      var title = el('div', 'jr-sheet-group-title');
      var ic = el('span', 'jr-sheet-group-icon');
      ic.innerHTML = ICONS[g.key] || '';      /* constant markup */
      title.appendChild(ic);
      title.appendChild(document.createTextNode(g.label));
      sec.appendChild(title);
      g.items.forEach(function (it) { sec.appendChild(itemNode(it)); });
      body.appendChild(sec);
    });
    if (!res.groups.length) {
      body.appendChild(el('p', 'jr-sheet-note', 'There is nothing to request on this job.'));
    } else if (!res.hasJob) {
      body.appendChild(el('p', 'jr-sheet-note', 'More actions appear here once a job is booked.'));
    }
    host.appendChild(body);
  }

  /* ── open / close ────────────────────────────────────────── */
  function setOpen(on) {
    var host = $('jrSheet'), back = $('jrSheetBackdrop'), btn = $('jrRequestBtn');
    if (!host || !back || !btn) return;
    S.isOpen = on;
    host.hidden = !on;
    back.hidden = !on;
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function open() {
    if (!S.thread) return;
    build();
    setOpen(true);
    var first = document.querySelector('#jrSheet .jr-sheet-item:not(.is-disabled)') || document.querySelector('#jrSheet .jr-icon-btn');
    if (first) first.focus();
  }

  function close() {
    if (!S.isOpen) return;
    setOpen(false);
    var btn = $('jrRequestBtn');
    if (btn && !btn.hidden) btn.focus();
  }

  function setContext(ctx) {
    S.thread = ctx.thread; S.user = ctx.user; S.role = ctx.role;
    setOpen(false);
    var btn = $('jrRequestBtn');
    if (btn) btn.hidden = false;
  }

  function init(opts) {
    if (S.bound) return;
    S.bound = true;
    S.handlers = (opts && opts.handlers) || {};
    var btn = $('jrRequestBtn'), back = $('jrSheetBackdrop');
    if (btn) btn.addEventListener('click', function () { if (S.isOpen) close(); else open(); });
    if (back) back.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.isOpen) close();
    });
  }

  window.JRRequest = { init: init, setContext: setContext, open: open, close: close, itemsFor: itemsFor };

})();

/* ============================================================
   STREETTASKER — messages-requests.js   (Job Room, step 5)
   The "Request" button + bottom sheet (spec sections 6, 7, 39).

   The sheet only lists actions that make sense RIGHT NOW for this person
   (their role, the job status, what is already pending). Later steps add
   actions by pushing onto ACTIONS below; nothing else needs to change.

   Public API (window.JRRequests), used by messages.html / messages-room.js:
     JRRequests.init({ onChange })   wire the button + sheet (call once)
     JRRequests.update([ctx])        recompute what is available, show/hide button
                                     ctx: { thread, user, role } (JRRoom passes it)
     JRRequests.open() / .close()
     JRRequests.whenReady()          promise: is the step 5 table available?
     JRRequests.register(actions)    add actions to the sheet (used by messages-work.js, messages-forms.js)
     JRRequests.openView(title, fn)  open the sheet straight on a custom view; fn(body, {close, back})
     JRRequests.KINDS                labels per request kind (also used by the cards)
     JRRequests.openInvoice(opts)    Stage 8: the invoice form (opts.revise = declined invoice, opts.answers = job_request id)
     JRRequests.openReceipt(ref)     Stage 8: a payment receipt in the sheet (ref = request id, or a receipt row)
     JRRequests.receiptNode(rc, role) Stage 8: the receipt card as a DOM node (Job Details draws it inline)

   Stage 3: the sheet is grouped as in spec section 39 (see GROUP_ORDER). An action says how it
   behaves with ONE of:
     rule(x)    false = not shown, 'a reason' = shown greyed with that reason, null = available
     when(x) / blocked(x)   older pair, same result (when false = not shown, blocked string = greyed)
   `ui: true` marks an item whose form is finished but NOT connected to the server yet; it gets a
   "Not connected yet" tag. `group` may be a string or { tasker: '..', customer: '..' }.
   A disputed task greys every item with a reason unless the action sets allowDisputed.
   A completed or cancelled task shows nothing to request.

   Needs the step 5 SQL (sql/messaging-step5.sql) for the customer "ask" actions and
   the step 6 SQL (sql/messaging-step6.sql) for transport / additional cost / full /
   remaining payment. Until they have run those actions stay hidden; the plain
   "Request payment" still works.

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var NOTE_MAX = 300;

  /* What each request kind says on its card (rendered by messages-thread.js) */
  var KINDS = {
    update:  { title: 'Update requested',        byMe: 'You asked for an update on this job.',        byOther: 'The customer would like an update on this job.' },
    arrival: { title: 'Arrival time requested',  byMe: 'You asked when the tasker will arrive.',      byOther: 'The customer would like to know when you will arrive.' },
    proof:   { title: 'Proof of work requested', byMe: 'You asked for photos or proof of the work.',  byOther: 'The customer would like photos or proof of the work.' },
    /* Stage 8 custom requests. Their own kind names on purpose: 'invoice' is a payment kind and a
       pending ask called 'invoice' would grey out the tasker's "Send invoice". */
    invoice_request: { title: 'Invoice requested', byMe: 'You asked the tasker for an invoice.',                    byOther: 'The customer would like an invoice for this job.' },
    /* Stage 13: the tasker proposes the agreed price, the customer accepts or declines (server: price_propose / price_respond) */
    /* Stage 15: a custom request without money (server: job_custom_request). With an amount it is an additional-cost payment request. */
    custom: { title: 'Custom request', byMe: 'You sent a request to the customer.', byOther: 'The tasker has a request for you.' },
    /* Stage 14: a new date and time, proposed by either person, answered by the other (server: job_reschedule_propose / _respond) */
    reschedule: { title: 'Reschedule requested', byMe: 'You asked to change the date and time.', byOther: 'The other person would like to change the date and time.' },
    price_proposal: { title: 'Price proposed', byMe: 'You proposed a price for this job.', byOther: 'The tasker proposed a price for this job.' },
    receipt_request: { title: 'Receipt requested', byMe: 'You asked the tasker for a receipt for what they bought.', byOther: 'The customer would like the receipt for something you bought for this job.' }
  };

  var S = { ctx: null, ready: null, probe: null, moneyReady: null, moneyProbe: null, onChange: null, bound: false, opener: null, view: 'menu' };

  /* ── helpers ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(inner) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var I = {
    card:    svg('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    clock:   svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    camera:  svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    close:   svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    back:    svg('<polyline points="15 18 9 12 15 6"/>'),
    tag:     svg('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
    truck:   svg('<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    doc:     svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
    tool:    svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>')
  };

  function naira(n) { return window.JRMoney ? window.JRMoney.naira(n) : '₦' + Number(n || 0).toLocaleString(); }

  function statusKey() {
    if (!S.ctx || !window.JRRoom) return 'inquiry';
    return window.JRRoom.statusFor(S.ctx.thread, S.ctx.role).key;
  }

  /* ── probe: is the step 5 table there? ───────────────────── */
  function probe() {
    if (S.probe) return S.probe;
    S.probe = (async function () {
      try {
        var r = await window.supabase.from('job_requests').select('id').limit(1);
        S.ready = !r.error;
      } catch (_e) { S.ready = false; }
      return S.ready;
    })();
    return S.probe;
  }

  /* step 6 columns present? (kind / reason / breakdown on payment_requests) */
  function probeMoney() {
    if (S.moneyProbe) return S.moneyProbe;
    S.moneyProbe = (async function () {
      try {
        var r = await window.supabase.from('payment_requests').select('id,kind,reason,breakdown').limit(1);
        S.moneyReady = !r.error;
      } catch (_e) { S.moneyReady = false; }
      return S.moneyReady;
    })();
    return S.moneyProbe;
  }

  /* ── actions registry ────────────────────────────────────────
     when(x)  x = { status, role, pending (array of pending kinds), ready }
     run(x)   called when the item is chosen                         */
  var LOCKED = 'Locked while an issue is under review';
  var NEEDS_JOB = 'Available once the job is booked';
  var NEEDS_PAYMENT = 'Available once payment is secured';
  var WAITING_CONFIRM = 'Waiting for the customer to confirm the work';

  /* Group names and their order, per role (spec section 39) */
  var GROUP = {
    MONEY: 'Money', TRANSPORT: 'Transport', COSTS: 'Materials & Job Costs', DOCS: 'Documents',
    WORK: 'Work & Evidence', SCHEDULE: 'Schedule', ISSUE: 'Issue',
    PAY: 'Payment', EVIDENCE: 'Evidence', JOB: 'Job'
  };
  var GROUP_ORDER = {
    tasker:   [GROUP.MONEY, GROUP.TRANSPORT, GROUP.COSTS, GROUP.DOCS, GROUP.WORK, GROUP.SCHEDULE, GROUP.ISSUE],
    customer: [GROUP.PAY, GROUP.DOCS, GROUP.EVIDENCE, GROUP.JOB, GROUP.ISSUE]
  };
  var PAYABLE = ['payment', 'full_payment', 'remaining_payment', 'transport', 'additional_cost', 'materials', 'invoice'];
  var LINE_LABEL = { work: 'Additional work', materials: 'Materials' };   /* breakdown line labels (additional cost form) */

  function hasJob(x) { return x.status !== 'inquiry'; }

  var ACTIONS = [
    /* ── Tasker: Money ── */
    {
      id: 'propose_price', roles: ['tasker'], group: GROUP.MONEY, icon: I.tag, kind: 'price_proposal', needsTable: true,
      label: 'Propose agreed price',
      hint: function (x) { return x.money.base > 0 ? 'Agreed price: ' + naira(x.money.base) + '. Propose a new one' : 'Set the price for this job. The customer accepts or declines'; },
      rule: function (x) {
        if (x.money.paidMain > 0) return 'The price cannot change after the first payment';
        return null;
      },
      run: function () { showPriceForm(); }
    },
    {
      id: 'request_payment', roles: ['tasker'], group: GROUP.MONEY, icon: I.card, kind: 'payment',
      label: 'Request payment', hint: 'Ask for a custom amount',
      rule: function () { return null; },
      run: function () { showForm('payment'); }
    },
    {
      id: 'request_full', roles: ['tasker'], group: GROUP.MONEY, icon: I.card, kind: 'full_payment', needsMoney: true,
      label: 'Request full payment',
      hint: function (x) { return 'Agreed amount: ' + naira(x.money.base); },
      rule: function (x) {
        /* paidMain: a transport / additional cost paid early is not the main payment */
        if (x.money.paidMain > 0 && x.money.outstanding <= 0) return 'This task is already paid in full';
        if (x.money.paidMain > 0) return 'Part of this task is paid. Use Request remaining payment';
        if (!(x.money.base > 0)) return 'Propose and agree a price first';
        return null;
      },
      run: function (x) { showConfirm('full_payment', x.money.base); }
    },
    {
      id: 'request_remaining', roles: ['tasker'], group: GROUP.MONEY, icon: I.card, kind: 'remaining_payment', needsMoney: true,
      label: 'Request remaining payment',
      hint: function (x) { return 'Still to pay: ' + naira(x.money.outstanding); },
      rule: function (x) {
        if (!(x.money.paidMain > 0)) return 'Available once the first payment is paid';
        if (!(x.money.outstanding > 0)) return 'Nothing is left to pay';
        return null;
      },
      run: function (x) { showConfirm('remaining_payment', x.money.outstanding); }
    },
    /* ── Tasker: Transport, Additional cost ── */
    {
      id: 'request_transport', roles: ['tasker'], group: GROUP.TRANSPORT, icon: I.truck, kind: 'transport', needsMoney: true,
      label: 'Request transport', hint: 'Ask the customer to pay a transport cost',
      rule: function () { return null; },
      run: function () { showForm('transport'); }
    },
    {
      id: 'request_additional', roles: ['tasker'], group: GROUP.COSTS, icon: I.tool, kind: 'additional_cost', needsMoney: true,
      label: 'Request additional cost', hint: 'Extra work or materials found on site',
      rule: function (x) {
        if (x.status === 'awaiting_confirmation') return WAITING_CONFIRM;
        return ['secured', 'work'].indexOf(x.status) !== -1 ? null : NEEDS_PAYMENT;
      },
      run: function () { showForm('additional_cost'); }
    },
    /* ── Documents (Stage 8) ── */
    {
      id: 'send_invoice', roles: ['tasker'], group: GROUP.DOCS, icon: I.doc, kind: 'invoice', needsMoney: true,
      label: 'Send invoice', hint: 'Itemised, with a due date. The customer can pay or decline',
      rule: function (x) { return x.bookingId ? null : NEEDS_JOB; },
      run: function () { showInvoiceForm(); }
    },
    {
      id: 'request_invoice', roles: ['customer'], group: GROUP.DOCS, icon: I.doc, kind: 'invoice_request', needsTable: true,
      label: 'Request invoice', hint: 'Ask the tasker for an itemised invoice',
      rule: function (x) { return hasJob(x) ? null : false; },
      run: function () { showAskForm('invoice_request'); }
    },
    {
      id: 'request_receipt', roles: ['customer'], group: GROUP.DOCS, icon: I.doc, kind: 'receipt_request', needsTable: true,
      label: 'Request receipt', hint: 'Ask for the receipt of something bought for the job',
      rule: function (x) { return hasJob(x) ? null : false; },
      run: function () { showAskForm('receipt_request'); }
    },
    /* ── Customer: Payment ── */
    {
      id: 'pay_request', roles: ['customer'], group: GROUP.PAY, icon: I.card, needsMoney: true,
      label: 'Pay a request', hint: 'Go to the payment waiting in this chat',
      rule: function (x) {
        if (!hasJob(x)) return false;
        var waiting = x.pending.some(function (k) { return PAYABLE.indexOf(k) !== -1; });
        return waiting ? null : 'No payment has been requested yet';
      },
      run: function () { close(); goToPayButton(); }
    },
    /* ── Customer: Job and Evidence (asks) ── */
    {
      id: 'ask_update', roles: ['customer'], group: GROUP.JOB, icon: I.refresh, kind: 'update', needsTable: true,
      label: 'Request an update', hint: 'Ask how the job is going',
      rule: function (x) {
        if (!hasJob(x)) return false;
        if (['booked', 'secured', 'work', 'awaiting_confirmation'].indexOf(x.status) !== -1) return null;
        return x.status === 'payment_pending' ? NEEDS_PAYMENT : 'Not available right now';
      },
      run: function () { showAskForm('update'); }
    },
    {
      id: 'ask_arrival', roles: ['customer'], group: GROUP.JOB, icon: I.clock, kind: 'arrival', needsTable: true,
      label: 'Request arrival time', hint: 'Ask when the tasker will get there',
      rule: function (x) {
        if (!hasJob(x)) return false;
        if (['booked', 'secured'].indexOf(x.status) !== -1) return null;
        return x.status === 'payment_pending' ? NEEDS_PAYMENT : 'Only before the tasker starts';
      },
      run: function () { showAskForm('arrival'); }
    },
    {
      id: 'ask_proof', roles: ['customer'], group: GROUP.EVIDENCE, icon: I.camera, kind: 'proof', needsTable: true,
      label: 'Request proof of work', hint: 'Ask for photos of the work',
      rule: function (x) {
        if (!hasJob(x)) return false;
        return ['secured', 'work', 'awaiting_confirmation'].indexOf(x.status) !== -1 ? null : NEEDS_PAYMENT;
      },
      run: function () { showAskForm('proof'); }
    }
  ];

  /* "Pay a request": bring the customer to the Pay button of the waiting card (navigation only) */
  function goToPayButton() {
    var btn = document.querySelector('.payment-request-card .prc-pay-btn:not(:disabled)');
    if (!btn) return;
    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try { btn.focus({ preventScroll: true }); } catch (_e) {}
  }

  function groupOf(a, role) { return (a.group && typeof a.group === 'object') ? a.group[role] : a.group; }

  function available() {
    if (!S.ctx) return [];
    var pending = (window.JRThread && window.JRThread.pendingKinds) ? window.JRThread.pendingKinds() : [];
    var money = window.JRMoney ? window.JRMoney.summary(S.ctx.thread) : { base: 0, additions: 0, total: 0, paid: 0, outstanding: 0 };
    var th = S.ctx.thread, bk = th.booking || null;
    var x = { status: statusKey(), role: S.ctx.role, pending: pending, ready: S.ready === true, money: money,
              booking: bk, stage: bk ? (bk.work_stage || null) : null,
              bookingId: (th.context_type === 'booking' && th.context_id) ? th.context_id : null,
              paid: !!(bk && bk.payment_status === 'paid'), thread: th };
    if (x.status === 'completed' || x.status === 'cancelled') return [];

    var order = GROUP_ORDER[x.role] || [];
    var out = [];
    ACTIONS.forEach(function (a, i) {
      if (a.roles.indexOf(x.role) === -1) return;
      if (a.needsTable && !x.ready) return;
      if (a.needsMoney && S.moneyReady !== true) return;
      var reason = null;
      if (a.rule) {
        var r = a.rule(x);
        if (r === false) return;
        if (typeof r === 'string') reason = r;
      } else {
        if (a.when && !a.when(x)) return;
        if (a.blocked) reason = a.blocked(x);
      }
      if (x.status === 'disputed' && !a.allowDisputed) reason = LOCKED;
      var waiting = !reason && a.kind && pending.indexOf(a.kind) !== -1;
      var hint = typeof a.hint === 'function' ? a.hint(x) : a.hint;
      var g = groupOf(a, x.role) || 'Other';
      out.push({
        action: a, group: g, order: i, ui: a.ui === true, x: x,
        disabled: !!reason || !!waiting,
        isReason: !!reason || !!waiting,
        hint: waiting ? 'Waiting for a reply' : (reason || hint)
      });
    });
    function rank(g) { var n = order.indexOf(g); return n === -1 ? order.length : n; }
    out.sort(function (p, q) { return rank(p.group) - rank(q.group) || p.order - q.order; });
    return out;
  }

  /* ── button ──────────────────────────────────────────────── */
  function update(ctx) {
    if (ctx) S.ctx = ctx;
    var btn = $('requestBtn');
    if (!btn) return;
    if (!S.ctx) { btn.hidden = true; return; }
    if (S.ready === null) {
      probe().then(function () { update(); });
    }
    if (S.moneyReady === null) {
      probeMoney().then(function () { update(); });
    }
    btn.hidden = available().length === 0;
    /* If the sheet is open and the list changed, redraw it */
    var layer = $('jrSheetLayer');
    if (layer && !layer.hidden && S.view === 'menu') renderMenu();
  }

  /* ── sheet ───────────────────────────────────────────────── */
  function setTitle(text) { var t = $('jrSheetTitle'); if (t) t.textContent = text; }
  /* A new view starts at the top, not where the last one was scrolled to */
  function toTop() { var b = $('jrSheetBody'); if (b) b.scrollTop = 0; }

  function renderMenu() {
    var fromView = S.view !== 'menu';
    S.view = 'menu';
    setTitle('Request');
    var body = $('jrSheetBody');
    if (!body) return;
    body.textContent = '';
    if (fromView) toTop();
    var items = available();
    if (!items.length) {
      var closed = ['completed', 'cancelled'].indexOf(statusKey()) !== -1;
      body.appendChild(el('div', 'jr-sheet-empty', closed ? 'This task is closed, so there is nothing to request.' : 'Nothing to request right now.'));
      return;
    }
    var groups = [];
    items.forEach(function (it) {
      var g = groups.filter(function (x) { return x.name === it.group; })[0];
      if (!g) { g = { name: it.group, items: [] }; groups.push(g); }
      g.items.push(it);
    });
    groups.forEach(function (g) {
      body.appendChild(el('div', 'jr-sheet-group', g.name));
      g.items.forEach(function (it) {
        var b = el('button', 'jr-sheet-item');
        b.type = 'button';
        b.disabled = it.disabled;
        var ic = el('span', 'jr-sheet-item-icon'); ic.innerHTML = it.action.icon;
        var tx = el('span', 'jr-sheet-item-text');
        tx.appendChild(el('span', 'jr-sheet-item-label', it.action.label));
        tx.appendChild(el('span', 'jr-sheet-item-hint' + (it.isReason ? ' is-reason' : ''), it.hint));
        b.appendChild(ic); b.appendChild(tx);
        if (it.ui) b.appendChild(el('span', 'jr-sheet-tag', 'Not connected yet'));
        b.addEventListener('click', function () { it.action.run(it.x); });
        body.appendChild(b);
      });
    });
  }

  function showAskForm(kind) {
    S.view = 'form';
    var meta = KINDS[kind];
    setTitle(meta.title.replace(' requested', ''));
    var body = $('jrSheetBody');
    body.textContent = '';
    toTop();

    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);

    body.appendChild(el('p', 'jr-sheet-lead', 'The tasker will see this in the conversation and can mark it as done.'));

    var label = el('label', 'jr-sheet-label', 'Add a note (optional)');
    label.setAttribute('for', 'jrAskNote');
    var note = el('textarea', 'jr-sheet-note');
    note.id = 'jrAskNote'; note.rows = 3; note.maxLength = NOTE_MAX;
    note.placeholder = 'e.g. I will be out from 2pm, please call the gate first.';
    var err = el('div', 'jr-sheet-error'); err.hidden = true;
    err.setAttribute('role', 'alert');
    body.appendChild(label); body.appendChild(note); body.appendChild(err);

    var send = el('button', 'jr-sheet-send', 'Send request'); send.type = 'button';
    send.addEventListener('click', async function () {
      err.hidden = true;
      var text = note.value.trim();
      if (text && window.JRThread && window.JRThread.hasContactInfo(text)) {
        err.textContent = 'Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.';
        err.hidden = false;
        if (typeof window.handleContactViolation === 'function' && S.ctx) window.handleContactViolation(S.ctx.user.id);
        return;
      }
      send.disabled = true; send.textContent = 'Sending…';
      var ok = await createAsk(kind, text);
      if (ok) { close(); }
      else { send.disabled = false; send.textContent = 'Send request'; }
    });
    body.appendChild(send);
    note.focus();
  }

  /* ── money forms (tasker) ────────────────────────────────── */
  var FORMS = {
    payment: {
      title: 'Request payment', lead: 'Enter the amount you and the customer agreed on for this job.', notice: true,
      fields: [{ id: 'amount', label: 'Amount (₦)', type: 'money', required: true, placeholder: 'e.g. 15000' }],
      submit: 'Send payment request'
    },
    transport: {
      title: 'Request transport', lead: 'The customer can pay or decline this request.',
      fields: [
        { id: 'amount', label: 'Transport cost (₦)', type: 'money', required: true, placeholder: 'e.g. 3500' },
        { id: 'reason', label: 'What is the transport for?', type: 'text', required: true, placeholder: 'e.g. To bring the replacement pump from the market' }
      ],
      submit: 'Send transport request'
    },
    full_payment: {
      title: 'Request full payment', lead: 'Enter the full amount for this job.',
      fields: [{ id: 'amount', label: 'Amount (₦)', type: 'money', required: true, placeholder: 'e.g. 15000' }],
      submit: 'Send full payment request'
    },
    remaining_payment: {
      title: 'Request remaining payment', lead: 'Enter the amount that is still to pay.',
      fields: [{ id: 'amount', label: 'Amount (₦)', type: 'money', required: true, placeholder: 'e.g. 5000' }],
      submit: 'Send remaining payment request'
    },
    additional_cost: {
      title: 'Request additional cost', lead: 'Explain what you found. The customer can pay or decline this request.',
      fields: [
        { id: 'work', label: 'Additional work (₦)', type: 'money', placeholder: 'Optional' },
        { id: 'materials', label: 'Materials (₦)', type: 'money', placeholder: 'Optional' },
        { id: 'reason', label: 'What did you find?', type: 'text', required: true, placeholder: 'e.g. Damaged pipe behind the wall' }
      ],
      sum: ['work', 'materials'], submit: 'Send additional cost request'
    }
  };

  function moneyOf(inputEl) {
    var n = Math.round(Number(inputEl && inputEl.value));
    return isFinite(n) && n > 0 ? n : 0;
  }

  /* opts.revise = the DECLINED request being revised (spec 20). The form starts with its values;
     sending creates a NEW request that points at it. The original is never edited or erased. */
  function showForm(kind, opts) {
    S.view = 'form';
    var def = FORMS[kind];
    var revise = opts && opts.revise ? opts.revise : null;
    setTitle(revise ? 'Send revised request' : def.title);
    var body = $('jrSheetBody');
    body.textContent = '';
    toTop();

    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', revise ? close : renderMenu);
    body.appendChild(back);
    body.appendChild(el('p', 'jr-sheet-lead', revise
      ? 'The customer declined ' + naira(revise.amount) + '. Change the amount or the explanation and send it again. The declined request stays in the history.'
      : def.lead));

    var inputs = {};
    def.fields.forEach(function (f) {
      var id = 'jrF_' + f.id;
      var label = el('label', 'jr-sheet-label', f.label + (f.required ? '' : ''));
      label.setAttribute('for', id);
      var inp;
      if (f.type === 'money') {
        inp = el('input', 'jr-sheet-input');
        inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '0'; inp.step = '100';
      } else {
        inp = el('textarea', 'jr-sheet-note'); inp.rows = 2; inp.maxLength = 300;
      }
      inp.id = id; inp.placeholder = f.placeholder || '';
      inputs[f.id] = inp;
      body.appendChild(label); body.appendChild(inp);
    });

    if (revise) {
      var bd = revise.breakdown && typeof revise.breakdown === 'object' ? revise.breakdown : null;
      if (bd && Array.isArray(bd)) {        /* [{key, label, amount}] */
        var byKey = {}; bd.forEach(function (l) { if (l && l.key) byKey[l.key] = l.amount; });
        bd = byKey;
      }
      if (def.sum && bd) def.sum.forEach(function (k) { if (inputs[k] && Number(bd[k]) > 0) inputs[k].value = String(Math.round(Number(bd[k]))); });
      else if (inputs.amount) inputs.amount.value = String(Math.round(Number(revise.amount)));
      if (inputs.reason && revise.reason) inputs.reason.value = revise.reason;
    }

    var totalBox = null;
    if (def.sum) { totalBox = el('div', 'jr-sheet-total'); body.appendChild(totalBox); }
    function refreshTotal() {
      if (!totalBox) return;
      var t = def.sum.reduce(function (a, k) { return a + moneyOf(inputs[k]); }, 0);
      totalBox.textContent = 'Total: ' + naira(t);
    }
    if (def.sum) { def.sum.forEach(function (k) { inputs[k].addEventListener('input', refreshTotal); }); refreshTotal(); }

    if (def.notice) {
      var n = el('div', 'jr-sheet-policy');
      n.appendChild(el('strong', null, 'Platform policy: '));
      n.appendChild(document.createTextNode('all payments must go through StreetTasker. Payments made outside are not covered by dispute protection and may lead to account suspension.'));
      body.appendChild(n);
    }

    var err = el('div', 'jr-sheet-error'); err.hidden = true; err.setAttribute('role', 'alert');
    body.appendChild(err);

    var submitLabel = revise ? 'Send revised request' : def.submit;
    var send = el('button', 'jr-sheet-send', submitLabel); send.type = 'button';
    send.addEventListener('click', async function () {
      err.hidden = true;
      function fail(msg) { err.textContent = msg; err.hidden = false; }
      var J = window.JRMoney;
      var amount, breakdown = null;
      if (def.sum) {
        /* payment_requests.breakdown must be a JSON ARRAY of lines (table CHECK payment_requests_breakdown_check):
           [{ key, label, amount }]. An object like {work: 7000} is refused by the database. */
        var parts = [];
        def.sum.forEach(function (k) {
          var v = moneyOf(inputs[k]);
          if (v) parts.push({ key: k, label: LINE_LABEL[k] || k, amount: v });
        });
        amount = parts.reduce(function (a, p) { return a + p.amount; }, 0);
        breakdown = parts;
      } else {
        amount = moneyOf(inputs.amount);
      }
      if (!amount || amount < J.MIN_AMOUNT) return fail('Enter an amount of at least ' + naira(J.MIN_AMOUNT) + '.');
      if (amount > J.MAX_AMOUNT) return fail('That amount is too large. Check for a typing mistake.');
      var reason = inputs.reason ? inputs.reason.value.trim() : '';
      if (inputs.reason) {
        if (reason.length < 3) return fail('Please add a short explanation for the customer.');
        if (window.JRThread.hasContactInfo(reason)) {
          if (typeof window.handleContactViolation === 'function' && S.ctx) window.handleContactViolation(S.ctx.user.id);
          return fail('Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.');
        }
      }
      send.disabled = true; send.textContent = 'Sending…';
      var ok = await J.create({ kind: kind, amount: amount, reason: reason || null, breakdown: breakdown, revises: revise ? revise.id : null });
      if (ok) close(); else { send.disabled = false; send.textContent = submitLabel; }
    });
    body.appendChild(send);
    var first = body.querySelector('input, textarea'); if (first) first.focus();
  }

  /* ── agreed price (Stage 13) ─────────────────────────────────
     The tasker proposes ONE price for the job. The customer sees a card with Accept / Decline. Only the server
     (price_respond) writes message_threads.agreed_price. Extras (transport, materials, additional cost, invoice) stay separate. */
  function showPriceForm() {
    S.view = 'form';
    setTitle('Propose agreed price');
    var body = $('jrSheetBody');
    body.textContent = '';
    toTop();
    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);
    body.appendChild(el('p', 'jr-sheet-lead', 'Enter the price for the whole job. The customer can accept or decline it. Once they accept, it is the agreed price and your payment requests must match it. Transport, materials and extra costs are asked for separately.'));

    var al = el('label', 'jr-sheet-label', 'Agreed price (₦)'); al.setAttribute('for', 'jrPriceAmount');
    var amount = el('input', 'jr-sheet-input');
    amount.id = 'jrPriceAmount'; amount.type = 'number'; amount.inputMode = 'numeric'; amount.min = '0'; amount.step = '100'; amount.placeholder = 'e.g. 15000';
    body.appendChild(al); body.appendChild(amount);

    var nl = el('label', 'jr-sheet-label'); nl.setAttribute('for', 'jrPriceNote');
    nl.appendChild(document.createTextNode('What the price covers '));
    nl.appendChild(el('span', 'jr-sheet-optional', '(optional)'));
    var note = el('textarea', 'jr-sheet-note'); note.id = 'jrPriceNote'; note.rows = 2; note.maxLength = NOTE_MAX;
    note.placeholder = 'e.g. Labour for replacing the kitchen tap. Materials are separate.';
    body.appendChild(nl); body.appendChild(note);

    var n = el('div', 'jr-sheet-policy');
    n.appendChild(el('strong', null, 'Platform policy: '));
    n.appendChild(document.createTextNode('all payments must go through StreetTasker. Payments made outside are not covered by dispute protection and may lead to account suspension.'));
    body.appendChild(n);

    var err = el('div', 'jr-sheet-error'); err.hidden = true; err.setAttribute('role', 'alert');
    body.appendChild(err);
    var send = el('button', 'jr-sheet-send', 'Send price to customer'); send.type = 'button';
    send.addEventListener('click', async function () {
      err.hidden = true;
      function fail(msg) { err.textContent = msg; err.hidden = false; }
      var J = window.JRMoney, a = moneyOf(amount), text = note.value.trim();
      if (!a || (J && a < J.MIN_AMOUNT)) return fail('Enter a price of at least ' + naira(J ? J.MIN_AMOUNT : 100) + '.');
      if (J && a > J.MAX_AMOUNT) return fail('That amount is too large. Check for a typing mistake.');
      if (text && window.JRThread.hasContactInfo(text)) {
        if (typeof window.handleContactViolation === 'function' && S.ctx) window.handleContactViolation(S.ctx.user.id);
        return fail('Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.');
      }
      send.disabled = true; send.textContent = 'Sending…';
      try {
        var r = await window.supabase.rpc('price_propose', { p_thread: S.ctx.thread.id, p_amount: a, p_note: text || null });
        if (r.error) throw r.error;
        if (window.JRThread && window.JRThread.reload) { try { await window.JRThread.reload(); } catch (_e) {} }
        close();
        update();
        if (S.onChange) S.onChange();
      } catch (e) {
        fail((e && e.message) || 'Could not send the price. Please try again.');
        send.disabled = false; send.textContent = 'Send price to customer';
      }
    });
    body.appendChild(send);
    amount.focus();
  }

  /* ── invoice (Stage 8) ──────────────────────────────────────
     An invoice is a payment_request (kind 'invoice'): title, itemised lines, optional due date and note.
     The customer pays it (Pay Invoice) or declines it, like any request. It is an ADD-ON: it never sets
     the agreed price and never creates the completion code (owner rule). The SERVER re-checks everything
     (title, lines above zero, total = sum of lines, due date), so this form only helps the tasker get it right.
       opts.revise   a DECLINED invoice: the form starts with its values, sending creates a NEW invoice
       opts.answers  id of the customer's "Request invoice" ask: it is marked done once the invoice is sent   */
  var LINES_MAX = 8;          /* the server allows 20; eight keeps a chat card readable */
  var INV_TITLE_MIN = 3, INV_TITLE_MAX = 80, INV_LABEL_MAX = 60;

  function isoDay(offsetDays) {
    var d = new Date(); d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function showInvoiceForm(opts) {
    S.view = 'form';
    var J = window.JRMoney;
    var revise = opts && opts.revise ? opts.revise : null;
    var answers = opts && opts.answers ? opts.answers : null;
    setTitle(revise ? 'Send revised invoice' : 'Send invoice');
    var body = $('jrSheetBody');
    body.textContent = '';
    toTop();

    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', (revise || answers) ? close : renderMenu);
    body.appendChild(back);
    body.appendChild(el('p', 'jr-sheet-lead', revise
      ? 'The customer declined invoice ' + (revise.invoice_number || '') + ' for ' + naira(revise.amount) + '. Change it and send it again. The declined invoice stays in the history.'
      : 'List what the customer is paying for. They can pay it or decline it. An invoice is an extra on top of the job price: it does not change the agreed price.'));

    var tl = el('label', 'jr-sheet-label', 'Invoice title'); tl.setAttribute('for', 'jrInvTitle');
    var title = el('input', 'jr-sheet-input jr-sheet-input--text');
    title.id = 'jrInvTitle'; title.type = 'text'; title.maxLength = INV_TITLE_MAX;
    title.placeholder = 'e.g. Materials bought for the bathroom';
    body.appendChild(tl); body.appendChild(title);

    body.appendChild(el('div', 'jr-sheet-label', 'Items'));
    var list = el('div', 'jr-lines'); list.id = 'jrInvLines';
    body.appendChild(list);
    var add = el('button', 'jr-sheet-add', '+ Add item'); add.type = 'button';
    body.appendChild(add);

    var totalBox = el('div', 'jr-sheet-total'); body.appendChild(totalBox);

    var dl = el('label', 'jr-sheet-label'); dl.setAttribute('for', 'jrInvDue');
    dl.appendChild(document.createTextNode('Due date '));
    dl.appendChild(el('span', 'jr-sheet-optional', '(optional)'));
    var due = el('input', 'jr-sheet-input jr-sheet-input--text');
    due.id = 'jrInvDue'; due.type = 'date'; due.min = isoDay(0); due.max = isoDay(365);
    body.appendChild(dl); body.appendChild(due);

    var nl = el('label', 'jr-sheet-label'); nl.setAttribute('for', 'jrInvNote');
    nl.appendChild(document.createTextNode('Note for the customer '));
    nl.appendChild(el('span', 'jr-sheet-optional', '(optional)'));
    var note = el('textarea', 'jr-sheet-note'); note.id = 'jrInvNote'; note.rows = 2; note.maxLength = 300;
    note.placeholder = 'e.g. Receipts for the materials are available on request.';
    body.appendChild(nl); body.appendChild(note);

    var rows = [];
    function lineTotal() { return rows.reduce(function (a, r) { return a + moneyOf(r.amount); }, 0); }
    function refresh() {
      totalBox.textContent = 'Total: ' + naira(lineTotal());
      add.disabled = rows.length >= LINES_MAX;
      rows.forEach(function (r) { r.remove.hidden = rows.length === 1; });
    }
    function addLine(label, amount) {
      var wrap = el('div', 'jr-line');
      var n = rows.length + 1;
      var lab = el('input', 'jr-sheet-input jr-sheet-input--text');
      lab.type = 'text'; lab.maxLength = INV_LABEL_MAX; lab.placeholder = 'Item (e.g. Labour)';
      lab.setAttribute('aria-label', 'Item ' + n + ' name');
      var amt = el('input', 'jr-sheet-input');
      amt.type = 'number'; amt.inputMode = 'numeric'; amt.min = '0'; amt.step = '100'; amt.placeholder = '₦';
      amt.setAttribute('aria-label', 'Item ' + n + ' amount in naira');
      var rm = el('button', 'jr-sheet-remove', 'Remove'); rm.type = 'button';
      if (label) lab.value = label;
      if (amount) amt.value = String(Math.round(Number(amount)));
      var row = { wrap: wrap, label: lab, amount: amt, remove: rm };
      rm.addEventListener('click', function () {
        rows.splice(rows.indexOf(row), 1); wrap.remove(); refresh();
      });
      amt.addEventListener('input', refresh);
      wrap.appendChild(lab); wrap.appendChild(amt); wrap.appendChild(rm);
      list.appendChild(wrap); rows.push(row); refresh();
      return row;
    }
    add.addEventListener('click', function () { if (rows.length < LINES_MAX) addLine().label.focus(); });

    /* start: a declined invoice's values, or one empty line */
    if (revise) {
      title.value = revise.title || '';
      var bd = Array.isArray(revise.breakdown) ? revise.breakdown : [];
      bd.slice(0, LINES_MAX).forEach(function (l) { if (l) addLine(l.label, l.amount); });
      if (revise.reason) note.value = revise.reason;
      if (revise.due_date && String(revise.due_date).slice(0, 10) >= isoDay(0)) due.value = String(revise.due_date).slice(0, 10);
    }
    if (!rows.length) addLine();

    var err = el('div', 'jr-sheet-error'); err.hidden = true; err.setAttribute('role', 'alert');
    body.appendChild(err);

    var submitLabel = revise ? 'Send revised invoice' : 'Send invoice';
    var send = el('button', 'jr-sheet-send', submitLabel); send.type = 'button';
    send.addEventListener('click', async function () {
      err.hidden = true;
      function fail(msg) { err.textContent = msg; err.hidden = false; }
      function contactCheck(text) {
        if (text && window.JRThread.hasContactInfo(text)) {
          if (typeof window.handleContactViolation === 'function' && S.ctx) window.handleContactViolation(S.ctx.user.id);
          fail('Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.');
          return true;
        }
        return false;
      }
      var t = title.value.trim();
      if (t.length < INV_TITLE_MIN) return fail('Give the invoice a short title (at least ' + INV_TITLE_MIN + ' letters).');
      var lines = [];
      for (var i = 0; i < rows.length; i++) {
        var name = rows[i].label.value.trim(), amt = moneyOf(rows[i].amount);
        if (!name && !amt) continue;                              /* an untouched line is ignored */
        if (!name) return fail('Item ' + (i + 1) + ' needs a name.');
        if (!amt) return fail('Item ' + (i + 1) + ' needs an amount above zero. Discounts are not supported: leave the item out instead.');
        lines.push({ key: 'item' + (lines.length + 1), label: name, amount: amt });
      }
      if (!lines.length) return fail('Add at least one item with an amount.');
      var total = lines.reduce(function (a, l) { return a + l.amount; }, 0);
      if (total < J.MIN_AMOUNT) return fail('The invoice total must be at least ' + naira(J.MIN_AMOUNT) + '.');
      if (total > J.MAX_AMOUNT) return fail('That total is too large. Check for a typing mistake.');
      var noteText = note.value.trim();
      if (contactCheck(t) || contactCheck(noteText) || lines.some(function (l) { return contactCheck(l.label); })) return;
      var dueDay = due.value || '';
      if (dueDay && (dueDay < isoDay(-1) || dueDay > isoDay(365))) return fail('Pick a due date from today to a year ahead, or leave it empty.');

      send.disabled = true; send.textContent = 'Sending…';
      var ok = await J.create({ kind: 'invoice', amount: total, title: t, dueDate: dueDay || null,
                                reason: noteText || null, breakdown: lines, revises: revise ? revise.id : null });
      if (ok) {
        if (answers) await markAsked(answers);
        close();
      } else { send.disabled = false; send.textContent = submitLabel; }
    });
    body.appendChild(send);
    title.focus();
  }

  /* The customer asked for an invoice and the tasker sent one: the ask is done */
  async function markAsked(id) {
    try {
      var r = await window.supabase.from('job_requests').update({ status: 'fulfilled' }).eq('id', id).select().maybeSingle();
      if (r.data && window.JRThread && window.JRThread.onRequestChange) window.JRThread.onRequestChange(r.data);
    } catch (_e) {}
  }

  /* Open the invoice form from a card ("Send invoice" on the customer's ask, or a declined invoice).
     The same rules as the sheet menu apply (locked while disputed, job must be booked, one open invoice). */
  function openInvoice(opts) {
    var layer = $('jrSheetLayer');
    if (!layer || !S.ctx) return;
    var toast = (window.JRThread && window.JRThread.toast) || function () {};
    if (!(opts && opts.revise)) {
      var me = available().filter(function (it) { return it.action.id === 'send_invoice'; })[0];
      if (!me) { toast('Invoices are not available here right now.', 'error'); return; }
      if (me.disabled) { toast(me.hint || 'You cannot send an invoice right now.', 'error'); return; }
    }
    if (layer.hidden) S.opener = document.activeElement;
    layer.hidden = false;
    showInvoiceForm(opts);
    var closeBtn = $('jrSheetClose');
    if (closeBtn) closeBtn.focus();
  }

  /* ── receipt (Stage 8) ───────────────────────────────────────
     Read-only. The receipt is written by the server when a payment is confirmed, cannot be edited,
     and only the customer and the tasker of that payment can read it. The platform fee is not shown. */
  var RECEIPT_KIND = {
    payment: 'Payment', full_payment: 'Full payment', remaining_payment: 'Remaining payment', transport: 'Transport',
    additional_cost: 'Additional cost', materials: 'Materials', invoice: 'Invoice', booking: 'Booking payment'
  };
  function whenLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* The receipt card as a DOM node. Used by the Request sheet (openReceipt) and by Job Details
     (messages-details.js draws it inline, because the Details sheet sits above the Request sheet). */
  function receiptNode(rc, role) {
    var card = el('div', 'jr-receipt');
    var head = el('div', 'jr-receipt-head');
    head.appendChild(el('strong', 'jr-receipt-no', rc.receipt_number));
    head.appendChild(el('span', 'jr-req-pill jr-req-pill--paid', 'Payment received'));
    card.appendChild(head);

    var rowsEl = el('div', 'jr-receipt-rows');
    function row(k, v) {
      var r = el('div', 'jr-receipt-row');
      r.appendChild(el('span', null, k)); r.appendChild(el('span', null, v));
      rowsEl.appendChild(r);
    }
    row('Date paid', whenLabel(rc.paid_at));
    row('For', (RECEIPT_KIND[rc.kind] || 'Payment') + (rc.invoice_number ? ' ' + rc.invoice_number : ''));
    if (rc.title) row('Title', rc.title);
    row(role === 'customer' ? 'Paid by' : 'Paid to', role === 'customer' ? 'You' : 'You (from the customer)');
    card.appendChild(rowsEl);

    var lines = el('div', 'jr-money-lines');
    (Array.isArray(rc.lines) ? rc.lines : []).forEach(function (l) {
      var r = el('div', 'jr-money-line');
      r.appendChild(el('span', null, String(l.label || ''))); r.appendChild(el('span', null, naira(l.amount)));
      lines.appendChild(r);
    });
    card.appendChild(lines);

    var total = el('div', 'jr-receipt-total');
    total.appendChild(el('span', null, 'Total paid')); total.appendChild(el('strong', null, naira(rc.amount)));
    card.appendChild(total);
    card.appendChild(el('p', 'jr-sheet-help', 'This is a record of the payment. It cannot be changed.'));
    return card;
  }

  /* ref = a payment request id (the receipt is read from payment_receipts)
           or a receipt row already loaded (a payment made straight on a booking has no request id) */
  function openReceipt(ref) {
    var toast = (window.JRThread && window.JRThread.toast) || function () {};
    if (!window.JRMoney || !S.ctx) return;
    var role = S.ctx.role;
    var got = (ref && typeof ref === 'object') ? Promise.resolve(ref) : window.JRMoney.receiptFor(ref);
    got.then(function (rc) {
      if (!rc) { toast('The receipt is not available yet. Please refresh and try again.', 'error'); return; }
      openView('Receipt', function (body) { body.appendChild(receiptNode(rc, role)); });
    });
  }

  /* One-tap requests where the amount is already known (full / remaining payment) */
  function showConfirm(kind, amount) {
    S.view = 'form';
    var J = window.JRMoney;
    setTitle(J.KINDS[kind].title);
    var body = $('jrSheetBody');
    body.textContent = '';
    toTop();
    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);

    body.appendChild(el('div', 'jr-sheet-bigamount', naira(amount)));
    var sm = S.ctx ? J.summary(S.ctx.thread) : null;
    if (kind === 'remaining_payment' && sm) {
      var list = el('div', 'jr-money-lines');
      [['Job total', sm.total], ['Paid so far', sm.paid]].forEach(function (r) {
        var row = el('div', 'jr-money-line');
        row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, naira(r[1])));
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    body.appendChild(el('p', 'jr-sheet-lead', 'The customer will see this as a payment request and can pay it securely through StreetTasker.'));
    var err = el('div', 'jr-sheet-error'); err.hidden = true; err.setAttribute('role', 'alert');
    body.appendChild(err);
    var send = el('button', 'jr-sheet-send', 'Send request for ' + naira(amount)); send.type = 'button';
    send.addEventListener('click', async function () {
      send.disabled = true; send.textContent = 'Sending…';
      var ok = await J.create({ kind: kind, amount: amount });
      if (ok) close(); else { send.disabled = false; send.textContent = 'Send request for ' + naira(amount); }
    });
    body.appendChild(send);
  }

  /* A custom view inside the sheet: fn(body, { close, back, helpers }) fills it */
  function showView(title, fn) {
    S.view = 'form';
    setTitle(title);
    var body = $('jrSheetBody');
    body.textContent = '';
    toTop();
    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);
    fn(body, { close: close, back: renderMenu, el: el, naira: naira });
  }

  function openView(title, fn) {
    var layer = $('jrSheetLayer');
    if (!layer || !S.ctx) return;
    if (layer.hidden) S.opener = document.activeElement;
    layer.hidden = false;
    showView(title, fn);
    var closeBtn = $('jrSheetClose');
    if (closeBtn) closeBtn.focus();
  }

  /* The tasker taps "Send Revised Request" on a declined card (messages-thread.js) */
  function openRevise(row) {
    var layer = $('jrSheetLayer');
    var kind = row && (row.kind || 'payment');
    if (kind === 'invoice') { openInvoice({ revise: row }); return; }
    if (!layer || !S.ctx || !FORMS[kind]) return;
    if (layer.hidden) S.opener = document.activeElement;
    layer.hidden = false;
    showForm(kind, { revise: row });
    var closeBtn = $('jrSheetClose');
    if (closeBtn) closeBtn.focus();
  }

  function register(defs) {
    (Array.isArray(defs) ? defs : [defs]).forEach(function (d) {
      if (ACTIONS.some(function (a) { return a.id === d.id; })) return;
      /* Stage 8: a "Not connected yet" stub (messages-forms.js) for something that now works is not added twice */
      var name = String(d.label || '').trim().toLowerCase();
      if (d.ui === true && name && ACTIONS.some(function (a) { return a.ui !== true && String(a.label || '').trim().toLowerCase() === name; })) return;
      ACTIONS.push(d);
    });
    update();
  }

  function open() {
    var layer = $('jrSheetLayer');
    if (!layer || !S.ctx) return;
    S.opener = document.activeElement;
    S.view = 'closed';
    renderMenu();
    layer.hidden = false;
    var closeBtn = $('jrSheetClose');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    var layer = $('jrSheetLayer');
    if (!layer) return;
    layer.hidden = true;
    if (S.opener && S.opener.focus) { try { S.opener.focus(); } catch (_e) {} }
    S.opener = null;
  }

  /* ── creating an ask ─────────────────────────────────────── */
  async function createAsk(kind, note) {
    var ctx = S.ctx;
    if (!ctx || !window.supabase) return false;
    var t = ctx.thread, me = ctx.user, sb = window.supabase;
    var toast = (window.JRThread && window.JRThread.toast) || function () {};

    if (window.JRThread && window.JRThread.pendingKinds().indexOf(kind) !== -1) {
      toast('You already have a pending request of this kind.', 'error');
      return false;
    }

    var reqRow;
    try {
      var r = await sb.from('job_requests').insert({
        thread_id: t.id, customer_id: t.customer_id, tasker_id: t.tasker_id,
        requested_by: me.id, kind: kind, note: note || null
      }).select().single();
      if (r.error) throw r.error;
      reqRow = r.data;
    } catch (e) {
      toast('Could not send the request: ' + ((e && e.message) || String(e)), 'error');
      return false;
    }

    var receiverId = me.id === t.customer_id ? t.tasker_id : t.customer_id;
    var preview = KINDS[kind].title;
    var msgRow;
    try {
      var m = await sb.from('messages').insert({
        thread_id: t.id, sender_id: me.id, receiver_id: receiverId,
        body: 'JOB_REQUEST:' + reqRow.id + ':' + kind, type: 'job_request',
        job_request_id: reqRow.id, flagged: false
      }).select().single();
      if (m.error) throw m.error;
      msgRow = m.data;
    } catch (e2) {
      /* No card means nobody would ever see the request: take it back */
      try { await sb.from('job_requests').update({ status: 'cancelled' }).eq('id', reqRow.id); } catch (_x) {}
      toast('Could not send the request: ' + ((e2 && e2.message) || String(e2)), 'error');
      return false;
    }

    /* Show it, bump the thread, tell the other person */
    window.JRThread.registerRequest(reqRow);
    window.JRThread.append(msgRow);

    var now = new Date().toISOString();
    var isCustomer = me.id === t.customer_id;
    var unreadCol = isCustomer ? 'tasker_unread' : 'customer_unread';
    var cur = isCustomer ? (t.tasker_unread || 0) : (t.customer_unread || 0);
    try {
      await sb.from('message_threads').update({ last_message: preview, last_message_at: now, [unreadCol]: cur + 1 }).eq('id', t.id);
    } catch (_e3) {}
    t.last_message = preview; t.last_message_at = now;
    if (isCustomer) t.tasker_unread = cur + 1; else t.customer_unread = cur + 1;
    if (S.onChange) S.onChange();

    try {
      var meta = me.user_metadata || {};
      await sb.from('notifications').insert({
        user_id: receiverId, type: 'new_message',
        title: preview + ' from ' + (meta.name || meta.email || 'a customer'),
        message: note ? (note.length > 80 ? note.slice(0, 80) + '…' : note) : KINDS[kind].byOther,
        data: { thread_id: t.id, sender_id: me.id, request_id: reqRow.id }, is_read: false
      });
    } catch (_e4) {}

    update();
    return true;
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function init(opts) {
    S.onChange = (opts && opts.onChange) || null;
    if (S.bound) return;
    S.bound = true;
    var btn = $('requestBtn'), layer = $('jrSheetLayer'), closeBtn = $('jrSheetClose'), back = $('jrSheetBackdrop');
    if (btn) btn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (back) back.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && layer && !layer.hidden) close();
    });
    var icon = $('jrSheetCloseIcon');
    if (icon) icon.innerHTML = I.close;
    probe().then(function () { update(); });
    probeMoney().then(function () { update(); });
  }

  window.JRRequests = { init: init, update: update, open: open, close: close, whenReady: probe, register: register, openView: openView, openRevise: openRevise, openInvoice: openInvoice, openReceipt: openReceipt, receiptNode: receiptNode, KINDS: KINDS, context: function () { return S.ctx; },
                        GROUP: GROUP, LOCKED: LOCKED, NEEDS_JOB: NEEDS_JOB, NEEDS_PAYMENT: NEEDS_PAYMENT, WAITING_CONFIRM: WAITING_CONFIRM };

})();

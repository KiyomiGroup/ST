/* ============================================================
   STREETTASKER — messages-cards.js   (Job Room, Stage 2)
   Transaction card library. Each card is defined once and rendered from
   (kind, state, role, data). Spec sections 4, 10-12, 15-28, 33, 41, 42.

   Public API (window.JRCards):
     JRCards.KINDS                      every card kind and its states
     JRCards.render(spec, opts)         -> card element
     JRCards.message(spec, opts)        -> card inside a message row (adds data-priority)
       spec = { kind, state, role: 'customer'|'tasker', data: {...}, from?: 'customer'|'tasker' }
       opts = { onAction(actionId, spec, extra) }   called when a button is pressed

   THIS FILE ONLY DRAWS. It never decides a state:
     - A card says "Paid" only when the caller passes state 'paid', and the
       caller must take that from the server (payment_requests.status), never
       from the browser (spec 12, 36).
     - Money cards offer Pay / Decline Request / Ask a Question and nothing
       else. There is no "Approve" state or button (spec 11, 12, 21, 42).
     - "Verified", "release processing" and "released" are three separate
       states (spec 16).
   The live thread (js/messages-thread.js) does not use this library yet; it
   keeps its own money / request cards until they are moved over (see handoff).

   data fields used (all optional, all plain text, never HTML):
     money kinds:   amount, reason, breakdown [{label, amount}], agreedPrice,
                    number, title, dueDate, paidOn, method
     other kinds:   rows [[label, value], ...], text, eta, thumbs [url], code,
                    by ('customer'|'tasker' = who made the request)

   No inline styles, no raw colours: classes live in css/messages.css (.jr-tcard*).
   ============================================================ */
'use strict';

(function () {

  /* ── helpers ─────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function naira(n) {
    return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  }
  function safeUrl(u) {
    u = String(u || '');
    return /^(https?:\/\/|blob:|[\w][\w./-]*$)/i.test(u) ? u : '';
  }
  function svg(inner) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  var ICON = {
    money:    svg('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
    doc:      svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
    receipt:  svg('<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>'),
    refund:   svg('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'),
    work:     svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.6-.6-2.2z"/>'),
    camera:   svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    check:    svg('<polyline points="20 6 9 17 4 12"/>'),
    key:      svg('<circle cx="8" cy="15" r="4"/><line x1="10.8" y1="12.2" x2="21" y2="2"/><line x1="17" y1="6" x2="20" y2="9"/>'),
    pin:      svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
    calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    cancel:   svg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
    alert:    svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    shield:   svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>')
  };

  /* ── state tables ────────────────────────────────────────── */
  /* tone: success | warning | danger | muted | neutral (pill colour only) */

  /* Payment states, exactly as worded in spec 12. */
  var MONEY_STATES = {
    pending:    { label: 'Payment requested', tone: 'warning' },
    processing: { label: 'Payment processing', tone: 'warning' },
    paid:       { label: 'Paid', tone: 'success' },
    failed:     { label: 'Payment failed', tone: 'danger' },
    declined:   { label: 'Request declined', tone: 'muted' },
    cancelled:  { label: 'Request cancelled', tone: 'muted' },
    refunded:   { label: 'Refunded', tone: 'muted' },
    disputed:   { label: 'Payment disputed', tone: 'danger' },
    released:   { label: 'Payment released', tone: 'success' }
  };
  function moneyStates(withReleased) {
    var out = {};
    Object.keys(MONEY_STATES).forEach(function (k) {
      if (k === 'released' && !withReleased) return;
      out[k] = MONEY_STATES[k];
    });
    return out;
  }

  /* Text under the amount, by state and viewer. */
  var MONEY_TEXT = {
    pending:    { customer: '', tasker: 'Waiting for the customer to pay or decline.' },
    processing: { customer: 'Waiting for the payment provider to confirm. Do not pay twice.', tasker: 'The customer is paying. This updates when the payment provider confirms it.' },
    paid:       { customer: 'Funds are held in escrow until the job is confirmed.', tasker: 'Paid by the customer. Funds are held in escrow until the job is confirmed.' },
    failed:     { customer: 'The payment did not go through. You have not been charged.', tasker: 'The payment did not go through.' },
    declined:   { customer: 'You declined this request. It stays in the history.', tasker: 'The customer declined this request. It stays in the history and does not change the task total.' },
    cancelled:  { customer: 'The Tasker cancelled this request.', tasker: 'You cancelled this request.' },
    refunded:   { customer: 'This payment was refunded.', tasker: 'This payment was refunded to the customer.' },
    disputed:   { customer: 'This payment is part of a dispute. Funds are not released while it is reviewed.', tasker: 'This payment is part of a dispute. Funds are not released while it is reviewed.' },
    released:   { customer: 'The payment was released to the Tasker.', tasker: 'The payment was released to you.' }
  };

  var ADDON_KINDS = ['transport_request', 'additional_cost', 'custom_expense'];

  /* kind -> { title, icon, from, priority, money?, states } */
  var KINDS = {
    /* ── Financial ── */
    payment_request:   { title: 'Payment request',   icon: 'money', from: 'tasker', priority: 'transactional', money: true, states: moneyStates(true) },
    remaining_payment: { title: 'Remaining payment', icon: 'money', from: 'tasker', priority: 'transactional', money: true, states: moneyStates(true) },
    transport_request: { title: 'Transport request', icon: 'money', from: 'tasker', priority: 'transactional', money: true, states: moneyStates(false) },
    additional_cost:   { title: 'Additional cost',   icon: 'money', from: 'tasker', priority: 'transactional', money: true, states: moneyStates(false) },
    custom_expense:    { title: 'Custom expense',    icon: 'money', from: 'tasker', priority: 'transactional', money: true, states: moneyStates(false) },
    invoice:           { title: 'Invoice',           icon: 'doc',   from: 'tasker', priority: 'transactional', money: true, states: moneyStates(false) },

    receipt: { title: 'Receipt', icon: 'receipt', from: 'system', priority: 'transactional', states: {
      issued: { label: 'Receipt issued', tone: 'success', text: 'This receipt records a payment that was confirmed by the payment provider.' }
    } },
    refund_status: { title: 'Refund', icon: 'refund', from: 'system', priority: 'transactional', amount: true, states: {
      requested:  { label: 'Refund requested', tone: 'warning', text: 'The refund is waiting to be reviewed.' },
      processing: { label: 'Refund processing', tone: 'warning', text: 'The refund has been started. It shows as refunded once the payment provider confirms it.' },
      refunded:   { label: 'Refunded', tone: 'muted', text: 'The refund was confirmed.' },
      failed:     { label: 'Refund failed', tone: 'danger', text: 'The refund did not go through. StreetTasker support will follow up.' },
      declined:   { label: 'Refund declined', tone: 'muted', text: 'This refund request was declined.' }
    } },

    /* ── Work ── */
    work_update: { title: 'Work update', icon: 'work', from: 'tasker', priority: 'important', states: {
      on_my_way:   { label: 'On my way', tone: 'neutral', text: 'The Tasker is on the way to the job location.' },
      arrived:     { label: 'Arrived', tone: 'success', text: 'The Tasker has arrived at the job location.' },
      in_progress: { label: 'In progress', tone: 'success', text: 'Work has started.' },
      paused:      { label: 'Work paused', tone: 'warning', text: 'The Tasker paused the work.' }
    } },
    proof_of_work: { title: 'Proof of work', icon: 'camera', from: 'tasker', priority: 'important', states: {
      submitted: { label: 'Proof submitted', tone: 'success', text: 'Photos are optional. They are never required to finish a job or release payment.' }
    } },
    completion_submission: { title: 'Completion submitted', icon: 'check', from: 'tasker', priority: 'important', states: {
      submitted: { label: 'Completion submitted', tone: 'warning',
        text: { customer: 'The Tasker says the job is done. Check the work. When you are satisfied, get your release code.', tasker: 'Waiting for the customer to review the work.' },
        actions: { customer: [['get_code', 'Get Release Code', 'primary'], ['request_changes', 'Request Changes'], ['report_issue', 'Report an Issue']] } },
      changes_requested: { label: 'Changes requested', tone: 'warning',
        text: { customer: 'You asked the Tasker for changes.', tasker: 'The customer asked for changes. Fix them, then submit completion again.' } },
      under_review: { label: 'Under review', tone: 'danger', text: 'An issue is open on this job. Funds are not released while it is reviewed.' },
      completed:    { label: 'Completed', tone: 'success', text: 'The job is complete.' }
    } },
    release_code_entry: { title: 'Release code', icon: 'key', from: 'system', priority: 'transactional', states: {
      awaiting_code: { label: 'Awaiting release code', tone: 'warning',
        text: { customer: 'Share this code with the Tasker only after the work is complete and you are satisfied with the result.', tasker: 'Ask the customer for their release code once the work is done. Enter it here.' } },
      verified:           { label: 'Release code verified', tone: 'success', text: 'The code was accepted. Payment has not been released yet.' },
      release_processing: { label: 'Payment release processing', tone: 'warning', text: 'The release has been started. It shows as released once the payment provider confirms it.' },
      released:           { label: 'Payment released', tone: 'success', text: 'The payment provider confirmed the release.' },
      invalid:            { label: 'Code not accepted', tone: 'danger', text: { customer: 'A wrong code was entered. No money was released.', tasker: 'That code was not accepted. No money was released. Check it with the customer and try again.' } },
      locked:             { label: 'Too many attempts', tone: 'danger', text: 'Code entry is locked after repeated wrong attempts. Contact StreetTasker support.' },
      expired:            { label: 'Code expired', tone: 'muted', text: 'This code is no longer valid. The customer can get a new one.' },
      on_hold:            { label: 'Release on hold', tone: 'danger', text: 'A code cannot release funds while a dispute or failed payment is open.' }
    } },

    /* ── Scheduling ── */
    arrival_update: { title: 'Arrival update', icon: 'pin', from: 'tasker', priority: 'important', states: {
      on_my_way: { label: 'On my way', tone: 'neutral', text: 'The Tasker is on the way.' },
      arrived:   { label: 'Arrived', tone: 'success', text: 'The Tasker has arrived.' },
      delayed:   { label: 'Running late', tone: 'warning', text: 'The Tasker is running late.' }
    } },
    reschedule_request: { title: 'Reschedule request', icon: 'calendar', from: 'requester', priority: 'important', states: {
      pending: { label: 'Awaiting response', tone: 'warning',
        text: { requester: 'Waiting for a reply to your new time.', recipient: 'A different time was proposed. This is a scheduling choice, not a payment.' },
        actions: { recipient: [['accept_time', 'Accept New Time', 'primary'], ['decline', 'Decline'], ['suggest_time', 'Suggest Another Time']], requester: [['cancel', 'Cancel Request']] } },
      accepted:  { label: 'New time confirmed', tone: 'success', text: 'The schedule was updated.' },
      declined:  { label: 'Declined', tone: 'muted', text: 'The original time stays.' },
      countered: { label: 'Another time suggested', tone: 'warning', text: 'A different time was suggested in reply.' },
      cancelled: { label: 'Request cancelled', tone: 'muted', text: 'The request was withdrawn.' },
      expired:   { label: 'Expired', tone: 'muted', text: 'No reply came in time. The original time stays.' }
    } },
    cancellation_request: { title: 'Cancellation request', icon: 'cancel', from: 'requester', priority: 'important', states: {
      pending: { label: 'Awaiting response', tone: 'warning',
        text: { requester: 'Waiting for the other person to respond.', recipient: 'The other person wants to cancel this task. Messages and payment records are kept either way.' },
        actions: { recipient: [['accept_cancel', 'Accept Cancellation', 'primary'], ['decline', 'Decline'], ['ask', 'Ask a Question']], requester: [['withdraw', 'Withdraw Request']] } },
      accepted:     { label: 'Task cancelled', tone: 'muted', text: 'The task was cancelled. Messages, payments and history are kept.' },
      declined:     { label: 'Declined', tone: 'muted', text: 'The task continues.' },
      under_review: { label: 'Under review', tone: 'danger', text: 'This cancellation needs review before it can be confirmed.' }
    } },

    /* ── Evidence ── */
    evidence_request: { title: 'Evidence request', icon: 'camera', from: 'requester', priority: 'important', states: {
      requested: { label: 'Requested', tone: 'warning',
        text: { requester: 'Waiting for the Tasker to send this.', recipient: 'The customer asked for this. Photos are optional unless you agree otherwise.' },
        actions: { recipient: [['submit_evidence', 'Send Evidence', 'primary'], ['decline', 'Decline']], requester: [['cancel', 'Cancel Request']] } },
      submitted: { label: 'Submitted', tone: 'success', text: 'The evidence was sent. It is stored against this task.' },
      completed: { label: 'Completed', tone: 'success', text: 'The request is complete.' },
      declined:  { label: 'Declined', tone: 'muted', text: 'The Tasker declined this request.' },
      cancelled: { label: 'Cancelled', tone: 'muted', text: 'The request was cancelled.' }
    } },

    /* ── Protection ── */
    issue_report: { title: 'Issue reported', icon: 'alert', from: 'customer', priority: 'important', states: {
      submitted:    { label: 'Issue reported', tone: 'warning', text: 'The issue was recorded and the other person was told.',
        actions: { tasker: [['reply', 'Reply']] } },
      under_review: { label: 'Under review', tone: 'danger', text: 'StreetTasker is reviewing this issue. Funds in dispute are held.',
        actions: { tasker: [['reply', 'Reply']] } },
      resolved:     { label: 'Resolved', tone: 'success', text: 'The issue was resolved.' }
    } },
    dispute_status: { title: 'Dispute', icon: 'shield', from: 'system', priority: 'important', states: {
      under_review:    { label: 'Payment disputed', tone: 'danger', text: 'Funds in dispute are held and will not be released while this is reviewed. A release code cannot override this.' },
      awaiting_info:   { label: 'More information needed', tone: 'warning', text: 'StreetTasker needs more information to decide.',
        actions: { customer: [['add_info', 'Add Information', 'primary']], tasker: [['add_info', 'Add Information', 'primary']] } },
      resolved_refund:  { label: 'Resolved: refunded', tone: 'muted', text: 'The review ended with a refund to the customer.' },
      resolved_release: { label: 'Resolved: payment released', tone: 'success', text: 'The review ended with the payment released to the Tasker.' }
    } }
  };

  /* ── actions ─────────────────────────────────────────────── */
  /* Money cards: Pay / Decline Request / Ask a Question. Nothing else for the customer. */
  function moneyActions(spec, fmt) {
    var role = spec.role, state = spec.state, kind = spec.kind, out = [];
    var payLabel = kind === 'invoice' ? 'Pay Invoice' : 'Pay ' + fmt;
    if (role === 'customer') {
      if (state === 'pending') out = [['pay', payLabel, 'primary'], ['decline', 'Decline Request'], ['ask', 'Ask a Question']];
      else if (state === 'failed') out = [['pay', 'Try Again', 'primary'], ['ask', 'Ask a Question']];
    } else {
      if (state === 'pending' || state === 'failed') out = [['cancel', 'Cancel Request']];
      else if (state === 'declined' && ADDON_KINDS.indexOf(kind) !== -1) out = [['revise', 'Send Revised Request']];
    }
    return out;
  }

  /* Who is the viewer relative to the request: requester / recipient (kinds with data.by). */
  function side(def, spec) {
    var by = (spec.data && spec.data.by) || spec.from || def.from;
    if (by !== 'customer' && by !== 'tasker') return null;
    return by === spec.role ? 'requester' : 'recipient';
  }
  function pick(map, spec, def) {
    if (map == null) return null;
    if (typeof map === 'string' || Array.isArray(map)) return map;
    var s = side(def, spec);
    if (s && map[s] != null) return map[s];
    return map[spec.role] != null ? map[spec.role] : null;
  }

  /* ── render ──────────────────────────────────────────────── */
  function unknown(spec) {
    var c = el('article', 'jr-tcard jr-tcard--muted');
    c.appendChild(el('div', 'jr-tcard-text', 'Unknown card: ' + String(spec && spec.kind) + ' / ' + String(spec && spec.state)));
    return c;
  }

  function render(spec, opts) {
    opts = opts || {};
    var def = KINDS[spec && spec.kind];
    var st = def && def.states[spec.state];
    if (!def || !st) return unknown(spec);
    var data = spec.data || {};
    var role = spec.role === 'tasker' ? 'tasker' : 'customer';
    spec = Object.assign({}, spec, { role: role });
    var fmt = data.amount != null ? naira(data.amount) : '—';

    var card = el('article', 'jr-tcard jr-tcard--' + st.tone);
    card.dataset.kind = spec.kind;
    card.dataset.state = spec.state;

    /* header */
    var head = el('div', 'jr-tcard-head');
    var icon = el('span', 'jr-tcard-icon'); icon.innerHTML = ICON[def.icon] || ICON.doc;
    head.appendChild(icon);
    head.appendChild(el('span', 'jr-tcard-title', def.title));
    head.appendChild(el('span', 'jr-tcard-pill jr-tcard-pill--' + st.tone, st.label));
    card.appendChild(head);

    if (data.number || data.title) {
      card.appendChild(el('div', 'jr-tcard-sub', [data.number ? '#' + data.number : '', data.title || ''].filter(Boolean).join(' · ')));
    }

    /* amount; agreed price and additional charges stay separate (spec 11, rule 8) */
    if ((def.money || def.amount) && data.amount != null) {
      card.appendChild(el('div', 'jr-tcard-amount', fmt));
    }
    if (def.money && ADDON_KINDS.indexOf(spec.kind) !== -1 && data.agreedPrice != null) {
      var sum = el('div', 'jr-tcard-summary');
      [['Agreed price', naira(data.agreedPrice)], ['Additional charge (this request)', fmt]].forEach(function (r) {
        var row = el('div', 'jr-tcard-row');
        row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, r[1]));
        sum.appendChild(row);
      });
      card.appendChild(sum);
    }

    if (data.reason) card.appendChild(el('div', 'jr-tcard-note', data.reason));

    /* line items: breakdown (money) or invoice lines */
    var lines = data.breakdown || data.lines;
    if (lines && lines.length) {
      var list = el('div', 'jr-tcard-lines');
      lines.forEach(function (l) {
        var row = el('div', 'jr-tcard-row');
        row.appendChild(el('span', null, l.label)); row.appendChild(el('span', null, naira(l.amount)));
        list.appendChild(row);
      });
      card.appendChild(list);
    }

    /* plain rows (reschedule current / proposed, issue reason, receipt number ...) */
    var rows = data.rows;
    if (rows && rows.length) {
      var rl = el('div', 'jr-tcard-lines');
      rows.forEach(function (r) {
        var row = el('div', 'jr-tcard-row');
        row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, r[1]));
        rl.appendChild(row);
      });
      card.appendChild(rl);
    }
    if (data.dueDate) card.appendChild(el('div', 'jr-tcard-meta', 'Due ' + data.dueDate));

    /* optional photos */
    if (data.thumbs && data.thumbs.length) {
      var grid = el('div', 'jr-tcard-thumbs');
      data.thumbs.forEach(function (u) {
        var url = safeUrl(u); if (!url) return;
        var im = el('img', 'jr-tcard-thumb'); im.src = url; im.alt = 'Photo'; im.loading = 'lazy';
        grid.appendChild(im);
      });
      card.appendChild(grid);
    }

    /* state text */
    var text = def.money ? (MONEY_TEXT[spec.state] && MONEY_TEXT[spec.state][role]) : pick(st.text, spec, def);
    if (data.text) text = data.text;
    if (text) card.appendChild(el('div', 'jr-tcard-text', text));

    /* release code: customer sees the code only if the server sent it; tasker types it */
    if (spec.kind === 'release_code_entry') {
      if (role === 'customer' && spec.state === 'awaiting_code' && data.code) {
        var box = el('div', 'jr-confirm-code');
        box.appendChild(el('div', 'jr-confirm-code-label', 'Your payment release code'));
        box.appendChild(el('div', 'jr-confirm-code-value', String(data.code)));
        box.appendChild(el('div', 'jr-confirm-code-hint', 'One time use. Give it to the Tasker only after the job is done.'));
        card.appendChild(box);
      } else if (role === 'tasker' && (spec.state === 'awaiting_code' || spec.state === 'invalid')) {
        var form = el('div', 'jr-tcard-codeform');
        var input = el('input', 'jr-tcard-codeinput');
        input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 6; input.autocomplete = 'off';
        input.placeholder = '000000'; input.setAttribute('aria-label', '6-digit release code');
        input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
        var go = el('button', 'jr-req-btn jr-req-btn--primary', 'Verify Code & Request Release'); go.type = 'button';
        go.addEventListener('click', function () { if (opts.onAction) opts.onAction('verify_code', spec, { code: input.value }); });
        form.appendChild(input); form.appendChild(go);
        card.appendChild(form);
      }
    }

    /* actions */
    var acts = def.money ? moneyActions(spec, fmt) : (pick(st.actions, spec, def) || []);
    if (acts.length) {
      var bar = el('div', 'jr-tcard-actions');
      acts.forEach(function (a) {
        var b = el('button', 'jr-req-btn' + (a[2] === 'primary' ? ' jr-req-btn--primary' : ''), a[1]);
        b.type = 'button';
        b.addEventListener('click', function () { if (opts.onAction) opts.onAction(a[0], spec); });
        bar.appendChild(b);
      });
      card.appendChild(bar);
    }

    /* pay-only-here notice on a payable card */
    if (def.money && role === 'customer' && (spec.state === 'pending' || spec.state === 'failed')) {
      var n = el('div', 'jr-tcard-notice');
      n.appendChild(el('strong', null, 'Important: '));
      n.appendChild(document.createTextNode('Only pay through StreetTasker. Payments made outside are not eligible for refunds and may result in account suspension.'));
      card.appendChild(n);
    }
    return card;
  }

  function message(spec, opts) {
    var def = KINDS[spec && spec.kind];
    var from = (spec && spec.from) || (spec && spec.data && spec.data.by) || (def && def.from) || 'system';
    var mine = from === (spec && spec.role);
    var wrap = el('div', 'msg-bubble-wrap is-card ' + (mine ? 'mine' : 'theirs'));
    wrap.dataset.priority = (def && def.priority) || 'important';
    wrap.appendChild(render(spec, opts));
    return wrap;
  }

  window.JRCards = { KINDS: KINDS, render: render, message: message };

})();

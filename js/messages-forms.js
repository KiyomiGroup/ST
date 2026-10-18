/* ============================================================
   STREETTASKER — messages-forms.js   (Job Room, Stage 3)
   Finished request forms that are NOT connected to the server yet.

   Each form is complete (fields, checks, wording) and sits in the Request sheet under its
   spec section 39 group with a "Not connected yet" tag.
   Stage 8 connected Send invoice, Request invoice and Request receipt (messages-requests.js), so
   their previews were removed from this file. Pressing the submit button checks the
   form, then says plainly that nothing was sent. No row is written, no message is posted, no
   money moves. Connecting a form later = replace its `send` function with the real call.

   Forms here (spec section in brackets):
     Tasker:   Custom request (7F), Request materials (7C),
               Send work update, Submit proof, Reschedule (22), Cancel (28)
     Customer: Reschedule (22), Cancel (28)
   Forms that already work are NOT here: payment, full / remaining payment, transport, additional
   cost, invoice, request invoice, request receipt and the receipt view (messages-requests.js),
   pause, report an issue, release code (messages-work.js).

   Public API (window.JRForms):
     JRForms.init()      register the actions into the Request sheet (call once)
     JRForms.open(id)    open one form directly (id = action id, e.g. 'send_update')
     JRForms.ids         list of form ids

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var TEXT_MAX = 300;
  var LINES_MAX = 8;
  var LINE_TYPES = ['Labour', 'Materials', 'Transport', 'Other'];

  var REASONS = {
    reschedule: {
      tasker:   ['Waiting for materials', 'Weather', 'Another job is running late', 'Personal emergency', 'Other'],
      customer: ['I am not available', 'I need a different time', 'Weather', 'Access to the location', 'Other']
    },
    cancel: {
      tasker:   ['I can no longer do this job', 'Customer is unreachable', 'Location is unsafe', 'Job is different from what was agreed', 'Other'],
      customer: ['I no longer need this job', 'Tasker is unreachable', 'Tasker is running late', 'Price or scope changed', 'Other']
    }
  };

  var S = { bound: false };
  function ctx() { return (window.JRRequests && window.JRRequests.context) ? window.JRRequests.context() : null; }

  /* ── helpers ─────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function naira(n) { return window.JRMoney ? window.JRMoney.naira(n) : '₦' + Number(n || 0).toLocaleString(); }
  function role() { var c = ctx(); return (c && c.role) || 'customer'; }
  function summary() {
    var c = ctx();
    return (window.JRMoney && c) ? window.JRMoney.summary(c.thread) : { base: 0, additions: 0, total: 0, paid: 0, outstanding: 0 };
  }
  function money(inp) {
    var n = Math.round(Number(inp && inp.value));
    return isFinite(n) && n > 0 ? n : 0;
  }
  function todayIso() {
    var d = new Date();
    var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m;
    var day = String(d.getDate()); if (day.length < 2) day = '0' + day;
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function svg(inner) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var I = {
    box:      svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
    chat:     svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    camera:   svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    cancel:   svg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
    star:     svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>')
  };

  /* ── small form parts ────────────────────────────────────── */
  function label(forId, text, optional) {
    var l = el('label', 'jr-sheet-label', text);
    if (optional) l.appendChild(el('span', 'jr-sheet-optional', ' (optional)'));
    l.setAttribute('for', forId);
    return l;
  }
  function textarea(id, placeholder, rows) {
    var t = el('textarea', 'jr-sheet-note'); t.id = id; t.rows = rows || 3; t.maxLength = TEXT_MAX; t.placeholder = placeholder || '';
    return t;
  }
  function textInput(id, placeholder, max) {
    var t = el('input', 'jr-sheet-input jr-sheet-input--text'); t.type = 'text'; t.id = id; t.maxLength = max || 80; t.placeholder = placeholder || '';
    return t;
  }
  function moneyInput(id, placeholder) {
    var t = el('input', 'jr-sheet-input'); t.type = 'number'; t.inputMode = 'numeric'; t.min = '0'; t.step = '100'; t.id = id; t.placeholder = placeholder || '';
    return t;
  }
  function errBox() { var e = el('div', 'jr-sheet-error'); e.hidden = true; e.setAttribute('role', 'alert'); return e; }
  function doneBox() { var d = el('div', 'jr-sheet-done'); d.hidden = true; d.setAttribute('role', 'status'); return d; }

  function previewNotice(body) {
    var n = el('div', 'jr-sheet-preview');
    n.appendChild(el('strong', null, 'Not connected yet. '));
    n.appendChild(document.createTextNode('You can fill this in to see how it will work, but nothing is sent and nothing changes on this task.'));
    body.appendChild(n);
  }

  function radios(name, list) {
    var wrap = el('div', 'jr-radio-list');
    var state = { value: null };
    list.forEach(function (r) {
      var row = el('label', 'jr-radio');
      var input = el('input'); input.type = 'radio'; input.name = name;
      input.addEventListener('change', function () { state.value = r; });
      row.appendChild(input); row.appendChild(el('span', null, r));
      wrap.appendChild(row);
    });
    return { node: wrap, state: state };
  }

  function contactOk(text, err) {
    if (text && window.JRThread && window.JRThread.hasContactInfo && window.JRThread.hasContactInfo(text)) {
      var c = ctx();
      if (typeof window.handleContactViolation === 'function' && c) window.handleContactViolation(c.user.id);
      err.textContent = 'Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.';
      err.hidden = false;
      return false;
    }
    return true;
  }

  /* Submit: check the form, then say plainly that nothing was sent.
     check() returns an error message or null. */
  function submitButton(text, check, err, done, extraClass) {
    var b = el('button', 'jr-sheet-send' + (extraClass ? ' ' + extraClass : ''), text); b.type = 'button';
    b.addEventListener('click', function () {
      err.hidden = true; done.hidden = true;
      var msg = check();
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      done.textContent = 'Form checked. Nothing was sent, because this request is not connected yet.';
      done.hidden = false;
    });
    return b;
  }

  /* Line items (materials): [type] description, amount. Returns { node, items(), total(), error() } */
  function lineItems(opts) {
    var wrap = el('div', 'jr-lines');
    var rows = [];
    var totalBox = el('div', 'jr-sheet-total');
    var addBtn = el('button', 'jr-sheet-add', opts.addLabel || 'Add another line'); addBtn.type = 'button';

    function total() { return rows.reduce(function (a, r) { return a + money(r.amount); }, 0); }
    function refresh() {
      totalBox.textContent = 'Total: ' + naira(total());
      addBtn.disabled = rows.length >= LINES_MAX;
      rows.forEach(function (r) { r.remove.hidden = rows.length < 2; });
    }
    function addRow() {
      var n = rows.length + 1;
      var row = el('div', 'jr-line');
      var r = { row: row };
      if (opts.types) {
        r.type = el('select', 'jr-sheet-input jr-sheet-select');
        r.type.setAttribute('aria-label', 'Line ' + n + ' type');
        LINE_TYPES.forEach(function (t) { var o = el('option', null, t); o.value = t; r.type.appendChild(o); });
        row.appendChild(r.type);
      }
      r.desc = textInput('jrLine_d' + n + '_' + Date.now(), opts.descPlaceholder || 'Description', 80);
      r.desc.setAttribute('aria-label', 'Line ' + n + ' description');
      r.amount = moneyInput('jrLine_a' + n + '_' + Date.now(), '₦');
      r.amount.setAttribute('aria-label', 'Line ' + n + ' amount in naira');
      r.amount.addEventListener('input', refresh);
      r.remove = el('button', 'jr-sheet-remove', 'Remove'); r.remove.type = 'button';
      r.remove.setAttribute('aria-label', 'Remove line ' + n);
      r.remove.addEventListener('click', function () {
        rows.splice(rows.indexOf(r), 1); row.remove(); refresh();
      });
      row.appendChild(r.desc); row.appendChild(r.amount); row.appendChild(r.remove);
      wrap.appendChild(row); rows.push(r); refresh();
    }
    addBtn.addEventListener('click', function () { if (rows.length < LINES_MAX) { addRow(); } });
    addRow();

    var node = el('div', 'jr-lines-wrap');
    node.appendChild(wrap); node.appendChild(addBtn); node.appendChild(totalBox);

    return {
      node: node,
      total: total,
      texts: function () { return rows.map(function (r) { return r.desc.value.trim(); }); },
      error: function () {
        var used = rows.filter(function (r) { return r.desc.value.trim() || money(r.amount); });
        if (!used.length) return 'Add at least one line.';
        for (var i = 0; i < used.length; i++) {
          if (used[i].desc.value.trim().length < 2) return 'Each line needs a short description.';
          if (!money(used[i].amount)) return 'Each line needs an amount.';
        }
        var J = window.JRMoney, t = total();
        if (J && t < J.MIN_AMOUNT) return 'The total must be at least ' + naira(J.MIN_AMOUNT) + '.';
        if (J && t > J.MAX_AMOUNT) return 'That total is too large. Check for a typing mistake.';
        return null;
      }
    };
  }

  /* ── forms ───────────────────────────────────────────────── */
  function formCustom(body) {
    body.appendChild(el('p', 'jr-sheet-lead', 'Use this for anything the other requests do not cover. If you add an amount, the customer can pay or decline it.'));
    previewNotice(body);
    body.appendChild(label('jrFm_title', 'What is this request?'));
    var title = textInput('jrFm_title', 'e.g. Access to the water meter', 60);
    body.appendChild(title);
    body.appendChild(label('jrFm_details', 'Details'));
    var details = textarea('jrFm_details', 'Explain what you need and why.', 4);
    body.appendChild(details);
    body.appendChild(label('jrFm_amount', 'Amount (₦)', true));
    var amount = moneyInput('jrFm_amount', 'Leave empty if no payment is needed');
    body.appendChild(amount);
    var err = errBox(), done = doneBox();
    body.appendChild(err); body.appendChild(done);
    body.appendChild(submitButton('Send custom request', function () {
      if (title.value.trim().length < 3) return 'Please give the request a short title.';
      if (details.value.trim().length < 5) return 'Please add some details for the customer.';
      var J = window.JRMoney, a = money(amount);
      if (amount.value && !a) return 'Enter a valid amount, or leave it empty.';
      if (a && J && a < J.MIN_AMOUNT) return 'Enter an amount of at least ' + naira(J.MIN_AMOUNT) + '.';
      if (a && J && a > J.MAX_AMOUNT) return 'That amount is too large. Check for a typing mistake.';
      if (!contactOk(title.value, err) || !contactOk(details.value, err)) return err.textContent;
      return null;
    }, err, done));
  }

  function formMaterials(body) {
    body.appendChild(el('p', 'jr-sheet-lead', 'List the materials you need to buy. The customer can pay or decline. The agreed price stays as it is; materials are shown separately.'));
    previewNotice(body);
    body.appendChild(el('div', 'jr-sheet-label', 'Materials'));
    var lines = lineItems({ types: false, descPlaceholder: 'Item, e.g. 2 x 20mm elbow joint', addLabel: 'Add another item' });
    body.appendChild(lines.node);
    body.appendChild(label('jrFm_note', 'Note to the customer', true));
    var note = textarea('jrFm_note', 'e.g. Bought at the market. I will send the receipt.', 3);
    body.appendChild(note);
    var err = errBox(), done = doneBox();
    body.appendChild(err); body.appendChild(done);
    body.appendChild(submitButton('Send materials request', function () {
      var e = lines.error(); if (e) return e;
      var texts = [note.value.trim()].concat(lines.texts());
      for (var i = 0; i < texts.length; i++) { if (!contactOk(texts[i], err)) return err.textContent; }
      return null;
    }, err, done));
  }

  function formWorkUpdate(body) {
    body.appendChild(el('p', 'jr-sheet-lead', 'Tell the customer how the job is going. They see it in the conversation.'));
    previewNotice(body);
    body.appendChild(label('jrFm_note', 'Update'));
    var note = textarea('jrFm_note', 'e.g. Old pipe removed. New one goes in this afternoon.', 4);
    body.appendChild(note);
    var err = errBox(), done = doneBox();
    body.appendChild(err); body.appendChild(done);
    body.appendChild(submitButton('Send update', function () {
      if (note.value.trim().length < 3) return 'Please write a short update.';
      if (!contactOk(note.value, err)) return err.textContent;
      return null;
    }, err, done));
  }

  function formProof(body) {
    body.appendChild(el('p', 'jr-sheet-lead', 'Show the customer what you did. Photos, video and files are always optional.'));
    previewNotice(body);
    var attach = el('button', 'jr-sheet-secondary jr-sheet-attach', 'Add photos, video or a file'); attach.type = 'button'; attach.disabled = true;
    body.appendChild(attach);
    body.appendChild(el('p', 'jr-sheet-help', 'Uploads are not available yet, so you can only add a note for now.'));
    body.appendChild(label('jrFm_note', 'Note'));
    var note = textarea('jrFm_note', 'e.g. Pipe replaced and tested for 15 minutes, no leaks.', 4);
    body.appendChild(note);
    var err = errBox(), done = doneBox();
    body.appendChild(err); body.appendChild(done);
    body.appendChild(submitButton('Submit proof', function () {
      if (note.value.trim().length < 3) return 'Please describe what you are showing.';
      if (!contactOk(note.value, err)) return err.textContent;
      return null;
    }, err, done));
  }

  function formReschedule(body) {
    var c = ctx();
    var title = (c && c.thread && c.thread._title) || 'this task';
    body.appendChild(el('p', 'jr-sheet-lead', 'Propose a new date and time for ' + title + '. The other person can accept, decline or suggest another time.'));
    previewNotice(body);
    body.appendChild(label('jrFm_date', 'New date'));
    var date = el('input', 'jr-sheet-input'); date.type = 'date'; date.id = 'jrFm_date'; date.min = todayIso();
    body.appendChild(date);
    body.appendChild(label('jrFm_time', 'Time'));
    var time = el('input', 'jr-sheet-input'); time.type = 'time'; time.id = 'jrFm_time';
    body.appendChild(time);
    body.appendChild(el('div', 'jr-sheet-label', 'Why do you need to reschedule?'));
    var reasons = radios('jrResched', REASONS.reschedule[role()]);
    body.appendChild(reasons.node);
    body.appendChild(label('jrFm_note', 'Add a note', true));
    var note = textarea('jrFm_note', 'e.g. The materials arrive on Friday.', 2);
    body.appendChild(note);
    var err = errBox(), done = doneBox();
    body.appendChild(err); body.appendChild(done);
    body.appendChild(submitButton('Send reschedule request', function () {
      if (!date.value) return 'Please choose a new date.';
      if (date.value < todayIso()) return 'The new date cannot be in the past.';
      if (!time.value) return 'Please choose a time.';
      if (!reasons.state.value) return 'Please choose a reason.';
      if (!contactOk(note.value, err)) return err.textContent;
      return null;
    }, err, done));
  }

  function formCancel(body) {
    var sm = summary();
    body.appendChild(el('p', 'jr-sheet-lead', 'Cancelling ends this task. Read what it means for the money before you continue.'));
    previewNotice(body);

    body.appendChild(el('div', 'jr-sheet-label', 'Why are you cancelling?'));
    var reasons = radios('jrCancel', REASONS.cancel[role()]);
    body.appendChild(reasons.node);
    body.appendChild(label('jrFm_note', 'Add a note', true));
    var note = textarea('jrFm_note', 'Anything the other person should know.', 2);
    body.appendChild(note);

    var box = el('div', 'jr-sheet-consequence');
    box.appendChild(el('div', 'jr-sheet-consequence-title', 'What this means for the money'));
    var lines = el('div', 'jr-money-lines');
    [['Paid so far', naira(sm.paid)], ['Still unpaid', naira(sm.outstanding)]].forEach(function (r) {
      var row = el('div', 'jr-money-line'); row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, r[1]));
      lines.appendChild(row);
    });
    box.appendChild(lines);
    box.appendChild(el('p', 'jr-sheet-help', sm.paid > 0
      ? 'How much is refunded or paid out depends on the cancellation policy and how far the work has gone. The exact amounts will be shown here before you confirm once cancellation is connected.'
      : 'Nothing has been paid on this task, so no money moves.'));
    body.appendChild(box);

    var ack = el('label', 'jr-radio');
    var chk = el('input'); chk.type = 'checkbox';
    ack.appendChild(chk); ack.appendChild(el('span', null, 'I understand this cannot be undone.'));
    body.appendChild(ack);

    var err = errBox(), done = doneBox();
    body.appendChild(err); body.appendChild(done);
    body.appendChild(submitButton('Cancel this job', function () {
      if (!reasons.state.value) return 'Please choose a reason.';
      if (!chk.checked) return 'Please confirm that you understand.';
      if (!contactOk(note.value, err)) return err.textContent;
      return null;
    }, err, done, 'jr-sheet-send--danger'));
  }

  /* ── registry ────────────────────────────────────────────── */
  var R, FORMS = {};

  function def(id, title, fn) { FORMS[id] = { title: title, fn: fn }; }
  def('custom_request',    'Custom request',    formCustom);
  def('request_materials', 'Request materials', formMaterials);
  def('send_update',       'Send work update',  formWorkUpdate);
  def('submit_proof',      'Submit proof',      formProof);
  def('reschedule',        'Reschedule',        formReschedule);
  def('cancel_job',        'Cancel this job',   formCancel);

  function open(id) {
    var f = FORMS[id];
    if (!f || !window.JRRequests) return;
    window.JRRequests.openView(f.title, function (body) { f.fn(body); });
  }

  function actions() {
    R = window.JRRequests;
    var G = R.GROUP, JOB = R.NEEDS_JOB, PAY = R.NEEDS_PAYMENT, WAIT = R.WAITING_CONFIRM;
    function needJob(x) { return x.status === 'inquiry' ? JOB : null; }
    function needPaid(x) {
      if (x.status === 'inquiry') return JOB;
      return ['secured', 'work', 'awaiting_confirmation'].indexOf(x.status) !== -1 ? null : PAY;
    }
    function run(id) { return function () { open(id); }; }

    return [
      { id: 'custom_request', roles: ['tasker'], group: G.MONEY, icon: I.chat, ui: true,
        label: 'Custom request', hint: 'Ask for anything else, with or without an amount',
        rule: needJob, run: run('custom_request') },

      { id: 'request_materials', roles: ['tasker'], group: G.COSTS, icon: I.box, ui: true,
        label: 'Request materials', hint: 'List what you need to buy for the job',
        rule: function (x) { return x.status === 'awaiting_confirmation' ? WAIT : needPaid(x); }, run: run('request_materials') },

      { id: 'send_update', roles: ['tasker'], group: G.WORK, icon: I.chat, ui: true,
        label: 'Send work update', hint: 'Tell the customer how the job is going',
        rule: needJob, run: run('send_update') },
      { id: 'submit_proof', roles: ['tasker'], group: G.WORK, icon: I.camera, ui: true,
        label: 'Submit proof', hint: 'Photos, video or a note. Always optional',
        rule: needPaid, run: run('submit_proof') },

      { id: 'reschedule', roles: ['customer', 'tasker'], group: { tasker: G.SCHEDULE, customer: G.JOB }, icon: I.calendar, ui: true,
        label: 'Reschedule', hint: 'Propose a new date or time',
        rule: function (x) { return x.status === 'awaiting_confirmation' ? 'Not available while the work awaits confirmation' : needJob(x); },
        run: run('reschedule') },

      { id: 'cancel_job', roles: ['customer', 'tasker'], group: { tasker: G.ISSUE, customer: G.JOB }, icon: I.cancel, ui: true,
        label: 'Cancel this job', hint: 'Choose a reason and see what it means for the money',
        rule: needJob, run: run('cancel_job') }
    ];
  }

  function init() {
    if (S.bound) return;
    S.bound = true;
    if (window.JRRequests) {
      window.JRRequests.register(actions());
    }
  }

  window.JRForms = { init: init, open: open, ids: Object.keys(FORMS) };

})();

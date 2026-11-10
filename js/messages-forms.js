/* ============================================================
   STREETTASKER — messages-forms.js   (Job Room, Stages 3 to 15)
   The request forms of the Request sheet. As of Stage 15 EVERY form here is connected to the server:
     Custom request    no amount: job_custom_request (card for the customer). With an amount: an "additional cost" payment request.
     Request materials itemised payment request (kind 'materials')
     Send work update  job_work_update (chat line + activity + notice)
     Submit proof      private upload + chat message + Evidence (Stage 9)
     Reschedule        job_reschedule_propose / job_reschedule_respond (Stage 14)
     Cancel            job_cancel when nothing is paid; otherwise a report to support (open_job_dispute)
   Payment, full / remaining payment, transport, additional cost, invoice, request invoice, request receipt and the
   receipt view live in messages-requests.js; pause, report an issue and the release code in messages-work.js.

   Public API (window.JRForms):
     JRForms.init()      register the actions into the Request sheet (call once)
     JRForms.open(id, opts)  open one form directly (id = action id, e.g. 'send_update').
                         Stage 9: Submit proof is CONNECTED (uploads + chat + Evidence); opts = { answers, kind }
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

  var KEEP = '__keep__';
  function actionButton(text, run, err, extraClass) {
    var b = el('button', 'jr-sheet-send' + (extraClass ? ' ' + extraClass : ''), text); b.type = 'button';
    b.addEventListener('click', async function () {
      err.hidden = true;
      b.disabled = true; b.textContent = 'Please wait…';
      var msg;
      try { msg = await run(); } catch (e) { msg = (e && e.message) || 'Something went wrong. Please try again.'; }
      if (msg === null || msg === undefined) { return; }          /* success: the caller closed the sheet */
      if (msg !== KEEP) { err.textContent = msg; err.hidden = false; }
      b.disabled = false; b.textContent = text;
    });
    return b;
  }
  function toast(m, t) { if (window.JRThread) window.JRThread.toast(m, t); }
  /* put the new card on screen for the sender, refresh the rest */
  async function afterSend(message) {
    if (window.JRRequests) window.JRRequests.close();
    if (message) toast(message);
    try { if (window.JRThread && window.JRThread.reload) await window.JRThread.reload(); } catch (_e) {}
    try { if (window.JRDetails) window.JRDetails.update(); } catch (_e2) {}
    try { if (window.JRRoom) window.JRRoom.refresh(); } catch (_e3) {}
    try { if (window.JRRequests) window.JRRequests.update(); } catch (_e4) {}
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
      entries: function () {
        return rows.map(function (r) { return { label: r.desc.value.trim(), amount: money(r.amount) }; })
                   .filter(function (e) { return e.label && e.amount; });
      },
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
    body.appendChild(label('jrFm_title', 'What is this request?'));
    var title = textInput('jrFm_title', 'e.g. Access to the water meter', 60);
    body.appendChild(title);
    body.appendChild(label('jrFm_details', 'Details'));
    var details = textarea('jrFm_details', 'Explain what you need and why.', 4);
    body.appendChild(details);
    body.appendChild(label('jrFm_amount', 'Amount (₦)', true));
    var amount = moneyInput('jrFm_amount', 'Leave empty if no payment is needed');
    body.appendChild(amount);
    var err = errBox();
    body.appendChild(err);
    body.appendChild(actionButton('Send custom request', async function () {
      var c = ctx(), J = window.JRMoney, a = money(amount);
      var t = title.value.trim(), d = details.value.trim();
      if (t.length < 3) return 'Please give the request a short title.';
      if (d.length < 5) return 'Please add some details for the customer.';
      if (amount.value && !a) return 'Enter a valid amount, or leave it empty.';
      if (a && J && a < J.MIN_AMOUNT) return 'Enter an amount of at least ' + naira(J.MIN_AMOUNT) + '.';
      if (a && J && a > J.MAX_AMOUNT) return 'That amount is too large. Check for a typing mistake.';
      if (!contactOk(t, err) || !contactOk(d, err)) return err.textContent;
      if (a) {
        /* with an amount it is a payment request the customer can pay or decline: an "additional cost" with ONE line named after the request */
        if (!J) return 'Payments are not available right now. Please refresh the page.';
        var ok = await J.create({ kind: 'additional_cost', amount: a, reason: (t + ': ' + d).slice(0, 300), breakdown: [{ key: 'work', label: t, amount: a }] });
        if (!ok) return KEEP;
        if (window.JRRequests) window.JRRequests.close();
        return null;
      }
      var r = await window.supabase.rpc('job_custom_request', { p_thread: c.thread.id, p_title: t, p_details: d });
      if (r.error) return r.error.message || 'Could not send the request.';
      await afterSend('Request sent to the customer');
      return null;
    }, err));
  }

  function formMaterials(body) {
    body.appendChild(el('p', 'jr-sheet-lead', 'List the materials you need to buy. The customer can pay or decline. The agreed price stays as it is; materials are shown separately.'));
    body.appendChild(el('div', 'jr-sheet-label', 'Materials'));
    var lines = lineItems({ types: false, descPlaceholder: 'Item, e.g. 2 x 20mm elbow joint', addLabel: 'Add another item' });
    body.appendChild(lines.node);
    body.appendChild(label('jrFm_note', 'Note to the customer', true));
    var note = textarea('jrFm_note', 'e.g. Bought at the market. I will send the receipt.', 3);
    body.appendChild(note);
    var err = errBox();
    body.appendChild(err);
    body.appendChild(actionButton('Send materials request', async function () {
      var J = window.JRMoney;
      if (!J) return 'Payments are not available right now. Please refresh the page.';
      var e = lines.error(); if (e) return e;
      var texts = [note.value.trim()].concat(lines.texts());
      for (var i = 0; i < texts.length; i++) { if (!contactOk(texts[i], err)) return err.textContent; }
      var items = lines.entries().map(function (l, i) { return { key: 'item' + (i + 1), label: l.label, amount: l.amount }; });
      var total = items.reduce(function (a, l) { return a + l.amount; }, 0);
      var ok = await J.create({ kind: 'materials', amount: total, reason: note.value.trim() || null, breakdown: items });
      if (!ok) return KEEP;
      if (window.JRRequests) window.JRRequests.close();
      return null;
    }, err));
  }

  function formWorkUpdate(body) {
    body.appendChild(el('p', 'jr-sheet-lead', 'Tell the customer how the job is going. They see it in the conversation.'));
    body.appendChild(label('jrFm_note', 'Update'));
    var note = textarea('jrFm_note', 'e.g. Old pipe removed. New one goes in this afternoon.', 4);
    body.appendChild(note);
    var err = errBox();
    body.appendChild(err);
    body.appendChild(actionButton('Send update', async function () {
      var c = ctx(), text = note.value.trim();
      if (text.length < 3) return 'Please write a short update.';
      if (!contactOk(text, err)) return err.textContent;
      var r = await window.supabase.rpc('job_work_update', { p_thread: c.thread.id, p_note: text });
      if (r.error) return r.error.message || 'Could not send the update.';
      await afterSend('Update sent to the customer');
      return null;
    }, err));
  }

  /* Submit proof / answer to a proof or receipt request. CONNECTED (Stage 9): files go to the private
     job-evidence bucket through JRThread.sendProof, then appear in the conversation and in Evidence.
     opts = { answers: job_requests.id, kind: 'receipt' } when it answers a customer's ask. */
  var PROOF_ACCEPT = 'image/*,video/mp4,video/webm,video/quicktime,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';
  function fileSizeText(b) { var n = Number(b) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function formProof(body, opts) {
    opts = opts || {};
    var isReceipt = opts.kind === 'receipt';
    body.appendChild(el('p', 'jr-sheet-lead', isReceipt
      ? 'Send the receipt for what you bought. It must be a photo or a PDF.'
      : 'Show the customer what you did. Photos, video and files are always optional. A note is enough.'));
    var picked = [];
    var input = el('input'); input.type = 'file'; input.multiple = true; input.id = 'jrFm_files';
    input.accept = isReceipt ? 'image/*,.pdf' : PROOF_ACCEPT; input.hidden = true;
    var attach = el('button', 'jr-sheet-secondary jr-sheet-attach', isReceipt ? 'Choose a photo or PDF' : 'Add photos, video or a file'); attach.type = 'button';
    attach.addEventListener('click', function () { input.click(); });
    var list = el('ul', 'jr-proof-files');
    function paintFiles() {
      list.textContent = '';
      picked.forEach(function (f, i) {
        var li = el('li', 'jr-proof-file');
        li.appendChild(el('span', 'jr-proof-name', f.name + ' · ' + fileSizeText(f.size)));
        var rm = el('button', 'jr-sheet-remove', 'Remove'); rm.type = 'button';
        rm.addEventListener('click', function () { picked.splice(i, 1); paintFiles(); });
        li.appendChild(rm); list.appendChild(li);
      });
      attach.disabled = picked.length >= 5;
    }
    input.addEventListener('change', function () {
      Array.prototype.forEach.call(input.files || [], function (f) { if (picked.length < 5) picked.push(f); });
      input.value = ''; paintFiles();
    });
    body.appendChild(attach); body.appendChild(input); body.appendChild(list);
    body.appendChild(el('p', 'jr-sheet-help', 'Up to 5 files. They are private: only you, the customer and StreetTasker support can open them.'));

    var payRows = [];
    if (window.JRMoney && ctx()) {
      payRows = window.JRMoney.history(ctx().thread).filter(function (h) {
        return ['materials', 'additional_cost', 'transport', 'invoice'].indexOf(h.kind) !== -1 && h.status !== 'declined' && h.status !== 'cancelled';
      });
    }
    var pay = null;
    if (payRows.length) {
      body.appendChild(label('jrFm_pay', 'Attach to a payment', true));
      pay = el('select', 'jr-sheet-input'); pay.id = 'jrFm_pay';
      var none = el('option', null, 'Not attached to a payment'); none.value = ''; pay.appendChild(none);
      payRows.forEach(function (h) { var o = el('option', null, h.label + ' · ' + naira(h.amount)); o.value = h.id; pay.appendChild(o); });
      body.appendChild(pay);
    }

    body.appendChild(label('jrFm_note', 'Note', true));
    var note = textarea('jrFm_note', 'e.g. Pipe replaced and tested for 15 minutes, no leaks.', 4);
    body.appendChild(note);
    var err = errBox(), done = doneBox();
    body.appendChild(err); body.appendChild(done);
    var go = el('button', 'jr-sheet-send', isReceipt ? 'Send receipt' : 'Submit proof'); go.type = 'button';
    go.addEventListener('click', async function () {
      err.hidden = true; done.hidden = true;
      var text = note.value.trim();
      if (isReceipt && !picked.length) { err.textContent = 'Choose the receipt photo or PDF.'; err.hidden = false; return; }
      if (!picked.length && text.length < 3) { err.textContent = 'Add a short note or at least one file.'; err.hidden = false; return; }
      if (!contactOk(text, err)) return;
      if (!window.JRThread || !window.JRThread.sendProof) { err.textContent = 'Sending is not available right now.'; err.hidden = false; return; }
      go.disabled = true; attach.disabled = true; go.textContent = 'Sending…';
      try {
        var r = await window.JRThread.sendProof({
          files: picked, note: text, kind: isReceipt ? 'receipt' : undefined,
          jobRequestId: opts.answers || undefined, paymentRequestId: (pay && pay.value) || undefined
        });
        if (r.failed.length) {
          done.textContent = 'Sent ' + r.sent + '. Not sent: ' + r.failed.join(' ');
          done.hidden = false; go.textContent = isReceipt ? 'Send receipt' : 'Submit proof'; go.disabled = false;
          picked = []; paintFiles();
        } else {
          if (window.JRThread.toast) window.JRThread.toast(isReceipt ? 'Receipt sent.' : 'Proof sent to the customer.');
          if (window.JRRequests && window.JRRequests.close) window.JRRequests.close();
        }
      } catch (e) {
        err.textContent = (e && e.message) || 'Could not send. Please try again.'; err.hidden = false;
        go.disabled = false; go.textContent = isReceipt ? 'Send receipt' : 'Submit proof'; paintFiles();
      }
    });
    body.appendChild(go);
  }

  /* Stage 14: connected. The other person accepts or declines the card in the chat (job_reschedule_respond). */
  function formReschedule(body) {
    var c = ctx();
    var title = (c && c.thread && c.thread._title) || 'this task';
    body.appendChild(el('p', 'jr-sheet-lead', 'Propose a new date and time for ' + title + '. The other person can accept or decline. The job keeps its current time until they accept.'));
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
    var err = errBox();
    body.appendChild(err);
    body.appendChild(actionButton('Send reschedule request', async function () {
      if (!date.value) return 'Please choose a new date.';
      if (date.value < todayIso()) return 'The new date cannot be in the past.';
      if (!time.value) return 'Please choose a time.';
      var when = new Date(date.value + 'T' + time.value);
      if (isNaN(when.getTime()) || when.getTime() <= Date.now()) return 'Please choose a time in the future.';
      if (!reasons.state.value) return 'Please choose a reason.';
      if (!contactOk(note.value, err)) return err.textContent;
      var extra = note.value.trim();
      var reason = reasons.state.value + (extra ? ' - ' + extra : '');
      var r = await window.supabase.rpc('job_reschedule_propose', { p_thread: c.thread.id, p_when: when.toISOString(), p_reason: reason.slice(0, 300) });
      if (r.error) return r.error.message || 'Could not send the request.';
      await afterSend('Reschedule request sent');
      return null;
    }, err));
  }

  /* Stage 14: connected.
     Nothing paid: the job is cancelled at once (job_cancel).
     Money held: the database refuses a direct cancel (bookings_guard), so this opens a problem report that asks support
     to cancel and settle the money (open_job_dispute); nothing moves until support decides. */
  function formCancel(body) {
    var sm = summary();
    var c = ctx();
    var held = !!(sm.paid > 0 || (c && c.thread && c.thread.booking && ['paid', 'released'].indexOf(c.thread.booking.payment_status) !== -1));
    body.appendChild(el('p', 'jr-sheet-lead', held
      ? 'Money is already held for this job, so it cannot be cancelled directly. This asks StreetTasker support to cancel it and settle the money fairly.'
      : 'Cancelling ends this task. Read what it means for the money before you continue.'));

    body.appendChild(el('div', 'jr-sheet-label', 'Why are you cancelling?'));
    var reasons = radios('jrCancel', REASONS.cancel[role()]);
    body.appendChild(reasons.node);
    body.appendChild(label('jrFm_note', held ? 'Tell support what happened' : 'Add a note', !held));
    var note = textarea('jrFm_note', 'Anything the other person should know.', held ? 3 : 2);
    body.appendChild(note);

    var box = el('div', 'jr-sheet-consequence');
    box.appendChild(el('div', 'jr-sheet-consequence-title', 'What this means for the money'));
    var lines = el('div', 'jr-money-lines');
    [['Paid so far', naira(sm.paid)], ['Still unpaid', naira(sm.outstanding)]].forEach(function (r) {
      var row = el('div', 'jr-money-line'); row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, r[1]));
      lines.appendChild(row);
    });
    box.appendChild(lines);
    box.appendChild(el('p', 'jr-sheet-help', held
      ? 'The held money stays protected and is frozen while support reviews your request. Support decides how much is refunded or paid out. You can follow it in Job details.'
      : 'Nothing has been paid on this task, so no money moves. Any open payment requests are closed.'));
    body.appendChild(box);

    var chk = null;
    if (!held) {
      var ack = el('label', 'jr-radio');
      chk = el('input'); chk.type = 'checkbox';
      ack.appendChild(chk); ack.appendChild(el('span', null, 'I understand this cannot be undone.'));
      body.appendChild(ack);
    }

    var err = errBox();
    body.appendChild(err);
    body.appendChild(actionButton(held ? 'Ask support to cancel' : 'Cancel this job', async function () {
      if (!reasons.state.value) return 'Please choose a reason.';
      if (chk && !chk.checked) return 'Please confirm that you understand.';
      if (!contactOk(note.value, err)) return err.textContent;
      var extra = note.value.trim();
      if (held) {
        if (extra.length < 5) return 'Please tell support a little about what happened.';
        var d = await window.supabase.rpc('open_job_dispute', { p_thread: c.thread.id, p_category: 'other',
          p_reason: ('Cancellation requested (' + role() + '): ' + reasons.state.value + ' - ' + extra).slice(0, 1000) });
        if (d.error) return d.error.message || 'Could not send the request.';
        if (!d.data || d.data.ok === false) return (d.data && d.data.error) || 'Could not send the request.';
        await afterSend('Sent to support. The money stays protected until they decide.');
        return null;
      }
      var r = await window.supabase.rpc('job_cancel', { p_thread: c.thread.id, p_reason: reasons.state.value, p_note: extra || null });
      if (r.error) return r.error.message || 'Could not cancel the job.';
      await afterSend('This job has been cancelled.');
      return null;
    }, err, held ? '' : 'jr-sheet-send--danger'));
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

  function open(id, opts) {
    var f = FORMS[id];
    if (!f || !window.JRRequests) return;
    window.JRRequests.openView(f.title, function (body) { f.fn(body, opts || {}); });
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

    /* Withdraw offer: only while the offer behind this conversation is still pending. The status is read once per conversation. */
    var OFFER = { id: '', status: null, busy: false };
    function toastMsg(m, t) { if (window.JRThread && window.JRThread.toast) window.JRThread.toast(m, t); }
    function offerPending(x) {
      var th = x.thread;
      if (!th || th.context_type !== 'task_application' || !th.context_id || !window.supabase) return false;
      var id = String(th.context_id);
      if (OFFER.id !== id) {
        OFFER.id = id; OFFER.status = null;
        window.supabase.from('task_applications').select('status').eq('id', id).maybeSingle().then(function (r) {
          if (OFFER.id !== id) return;
          OFFER.status = (r && r.data && r.data.status) || 'unknown';
          if (window.JRRequests) window.JRRequests.update();
        }, function () { /* no button */ });
        return false;
      }
      return OFFER.status === 'pending' ? null : false;
    }
    function withdrawOffer() {
      if (OFFER.busy || !OFFER.id) return;
      if (!window.confirm('Withdraw your offer? The client will be told. It still counts toward your offer limit, so you do not get it back.')) return;
      OFFER.busy = true;
      var done = function () { OFFER.busy = false; };
      (async function () {
        try {
          /* messages.html does not load db.js, so the same database function is called directly */
          var r = await window.supabase.rpc('withdraw_offer', { p_application: OFFER.id });
          if (r.error) {
            var code = String(r.error.message || '');
            throw new Error(code === 'offer_not_pending' ? 'Only an offer that is still waiting for an answer can be withdrawn.' : (r.error.details || 'Could not withdraw your offer.'));
          }
          OFFER.status = 'withdrawn';
          if (window.JRRequests) { window.JRRequests.close(); window.JRRequests.update(); }
          toastMsg('Offer withdrawn');
        } catch (e) { toastMsg((e && e.message) || 'Could not withdraw your offer.', 'error'); }
        done();
      })();
    }

    return [
      { id: 'withdraw_offer', roles: ['tasker'], group: G.ISSUE, icon: I.cancel,
        label: 'Withdraw offer', hint: 'Take back your offer. It still counts toward your limit',
        rule: offerPending, run: withdrawOffer },

      { id: 'custom_request', roles: ['tasker'], group: G.MONEY, icon: I.chat, kind: 'custom',
        label: 'Custom request', hint: 'Ask for anything else, with or without an amount',
        rule: needJob, run: run('custom_request') },

      { id: 'request_materials', roles: ['tasker'], group: G.COSTS, icon: I.box,
        label: 'Request materials', hint: 'List what you need to buy for the job',
        rule: function (x) { return x.status === 'awaiting_confirmation' ? WAIT : needPaid(x); }, run: run('request_materials') },

      { id: 'send_update', roles: ['tasker'], group: G.WORK, icon: I.chat,
        label: 'Send work update', hint: 'Tell the customer how the job is going',
        rule: needJob, run: run('send_update') },
      { id: 'submit_proof', roles: ['tasker'], group: G.WORK, icon: I.camera,
        label: 'Submit proof', hint: 'Photos, video or a note. Always optional',
        rule: needPaid, run: run('submit_proof') },

      { id: 'reschedule', roles: ['customer', 'tasker'], group: { tasker: G.SCHEDULE, customer: G.JOB }, icon: I.calendar, kind: 'reschedule',
        label: 'Reschedule', hint: 'Propose a new date or time',
        rule: function (x) { return x.status === 'awaiting_confirmation' ? 'Not available while the work awaits confirmation' : needJob(x); },
        run: run('reschedule') },

      { id: 'cancel_job', roles: ['customer', 'tasker'], group: { tasker: G.ISSUE, customer: G.JOB }, icon: I.cancel,
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

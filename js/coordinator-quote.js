/* ============================================================
   StreetTasker — coordinator-quote.js (Stage 5C-2)
   The "The quote" card on the coordinator booking page.
   Reads:  rpc local_booking_quote(p_booking)       (current quote with its lines, what the confirmation allows, earlier versions, and (5D-1) the customer's decision and reason)
   Writes: rpc local_booking_send_quote(...)        (the ONLY way to reach "quote sent")
   The service fee is shown, never typed: the database copies it from the Local Tasker's recorded price. Transport and
   materials can only go down from what the Local Tasker said. The total on screen is a preview; the database works out
   the real one. Nothing here touches payments. Everything typed is set with textContent / value.
   Mounted by coordinator-booking.js after it renders: STCoQuote.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, data = null, requestId = null, busy = false;
  var MAX = 10000000;

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function active(d) { return !!d && d.open && !d.frozen; }
  function relevant(d) { return !!d && ({ tasker_confirmed: 1, quote_sent: 1, quote_declined: 1, quote_approved: 1 })[d.lt_status] === 1; }
  function parseMoney(raw) {
    var t = String(raw == null ? '' : raw).replace(/[₦,\s]/g, '');
    if (t === '') return { value: 0, empty: true };
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return { bad: true };
    var v = Number(t); return isFinite(v) && v <= MAX ? { value: v } : { bad: true };
  }
  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function clearErrors() {
    ['coQtTransport', 'coQtMaterials', 'coQtOtherLabel', 'coQtOther', 'coQtNote'].forEach(function (id) { fieldError(id, ''); });
    $('coQtError').hidden = true;
  }
  function showError(msg) { $('coQtErrorText').textContent = msg; $('coQtError').hidden = false; }
  function fact(dl, label, value, cls) {
    dl.appendChild(C.el('dt', 'co-fact-label', label));
    dl.appendChild(C.el('dd', 'co-fact-value' + (cls ? ' ' + cls : ''), value));
  }

  function renderLines(dl, q) {
    dl.textContent = '';
    (q.lines || []).forEach(function (l) { fact(dl, l.label, B.naira(l.amount), l.key === 'service_fee' ? 'is-lock' : ''); });
    fact(dl, 'Total', B.naira(q.total));
  }

  function previewTotal() {
    var conf = data && data.confirmed; if (!conf) return;
    var tr = parseMoney($('coQtTransport').value), ma = parseMoney($('coQtMaterials').value), ot = parseMoney($('coQtOther').value);
    var sum = Number(conf.service_fee) + (tr.bad ? 0 : tr.value) + (ma.bad ? 0 : ma.value) + (ot.bad ? 0 : ot.value);
    $('coQtTotal').textContent = B.naira(sum);
  }

  function prepareForm(prev) {
    var conf = data.confirmed;
    $('coQtForm').reset(); clearErrors();
    var fixed = $('coQtFixed'); fixed.textContent = '';
    fact(fixed, 'Service fee', B.naira(conf.service_fee), 'is-lock');
    var tMax = Number(conf.transport_amount) || 0, mMax = Number(conf.materials_amount) || 0;
    $('coQtTransport').value = String(prev ? prev.transport_amount : tMax);
    $('coQtMaterials').value = String(prev ? prev.materials_amount : mMax);
    $('coQtTransportHelp').textContent = tMax > 0 ? 'The Local Tasker said ' + B.naira(tMax) + '. You can lower it or put 0, not raise it.' : 'The Local Tasker did not ask for transport. To add it, record a new answer.';
    $('coQtMaterialsHelp').textContent = mMax > 0 ? 'The Local Tasker said ' + B.naira(mMax) + (conf.materials_notes ? ' (' + conf.materials_notes + ')' : '') + '. You can lower it or put 0, not raise it.' : 'The Local Tasker did not ask for materials. To add them, record a new answer.';
    $('coQtTransport').disabled = tMax === 0; $('coQtMaterials').disabled = mMax === 0;
    if (prev && Number(prev.other_amount) > 0) { $('coQtOther').value = String(prev.other_amount); $('coQtOtherLabel').value = prev.other_label || ''; }
    previewTotal();
  }

  function render() {
    var d = ctx.detail, card = $('coQt');
    $('coQtSummary').hidden = true; $('coQtForm').hidden = true; $('coQtHistBox').hidden = true;
    if (!relevant(d) || !data) { card.hidden = true; return; }
    card.hidden = false;
    var cur = data.current, conf = data.confirmed, st = d.lt_status;
    var canBuild = active(d) && (st === 'tasker_confirmed' || st === 'quote_declined') && !!conf;
    if (canBuild) {
      var needSecond = conf.second_check_status === 'requested' || conf.second_check_status === 'failed';
      $('coQtLead').textContent = st === 'quote_declined'
        ? 'The customer declined the last quote. Revise it below, or go back to the Local Tasker if the price needs to change.' +
          (cur && cur.decision && cur.decision.reason ? ' Their reason: “' + cur.decision.reason + '”.' : '')
        : 'Check the figures below, then send the quote. The service fee is the Local Tasker’s own price.';
      if (needSecond) {
        $('coQtLead').textContent = 'An administrator call-back to the Local Tasker is still needed before a quote can be sent.';
      } else {
        if (!requestId) requestId = newId();
        prepareForm(st === 'quote_declined' ? cur : null);
        $('coQtForm').hidden = false;
      }
    } else if (cur) {
      renderLines($('coQtLines'), cur);
      $('coQtLead').textContent = 'Quote version ' + cur.version + (cur.created_at ? ' · ' + B.dateTime(cur.created_at) : '');
      $('coQtStatusNote').textContent = st === 'quote_approved' ? 'The customer approved this quote. Their payment requests are now waiting in the job room.' : st === 'quote_sent' ? 'Waiting for the customer to approve. To change the price, record a new answer from the Local Tasker.' : '';
      $('coQtSummary').hidden = false;
    } else {
      card.hidden = true; return;
    }
    var h = $('coQtHist'); h.textContent = '';
    var older = (data.history || []).filter(function (x) { return x.superseded; });
    $('coQtHistBox').hidden = !older.length;
    older.forEach(function (x) {
      var li = C.el('li', 'co-bk-event');
      li.appendChild(C.el('span', 'co-bk-event-text', 'Version ' + x.version + ' · ' + B.naira(x.total)));
      li.appendChild(C.el('span', 'co-consent-meta', B.dateTime(x.created_at) + ' · replaced'));
      h.appendChild(li);
    });
  }

  function read() {
    clearErrors();
    var conf = data.confirmed, ok = true, first = null;
    function bad(id, msg) { fieldError(id, msg); ok = false; if (!first) first = id; }
    var tr = parseMoney($('coQtTransport').value), ma = parseMoney($('coQtMaterials').value), ot = parseMoney($('coQtOther').value);
    var tMax = Number(conf.transport_amount) || 0, mMax = Number(conf.materials_amount) || 0, fee = Number(conf.service_fee);
    var label = $('coQtOtherLabel').value.trim(), onote = '', note = $('coQtNote').value.trim();
    if (tr.bad) bad('coQtTransport', 'Enter an amount like 1500, or 0.');
    else if (tr.value > tMax) bad('coQtTransport', 'This can’t be more than ' + B.naira(tMax) + '.');
    else if (tr.value > 0 && tr.value < 100) bad('coQtTransport', 'Use 0 or at least ₦100.');
    if (ma.bad) bad('coQtMaterials', 'Enter an amount like 3000, or 0.');
    else if (ma.value > mMax) bad('coQtMaterials', 'This can’t be more than ' + B.naira(mMax) + '.');
    else if (ma.value > 0 && ma.value < 100) bad('coQtMaterials', 'Use 0 or at least ₦100.');
    if (ot.bad) bad('coQtOther', 'Enter an amount like 1000.');
    else if (ot.value > 0) {
      if (ot.value < 100) bad('coQtOther', 'Use at least ₦100, or leave it empty.');
      else if (ot.value > fee) bad('coQtOther', 'This can’t be more than the service fee.');
      if (!label) bad('coQtOtherLabel', 'Say what this cost is for.');
    }
    if (label.length > 60) bad('coQtOtherLabel', 'Keep this to 60 characters.');
    if (note.length > 300) bad('coQtNote', 'Keep this to 300 characters.');
    if (ok && fee + (tr.value || 0) + (ma.value || 0) + (ot.value || 0) > MAX) { showError('The total is too large. Check for a typing mistake.'); ok = false; }
    if (!ok) { var f = first && $(first); if (f && f.focus) f.focus(); return null; }
    return { transport: tr.value || 0, materials: ma.value || 0, other: ot.value || 0, label: label, onote: onote, note: note };
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'booking_closed') return 'This booking is closed, so no quote can be sent.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so no quote can be sent right now.';
    if (hint === 'invalid_transition') return 'A quote can’t be sent at this step. Reload the page to see where the booking is.';
    if (hint === 'confirmation_required' || hint === 'second_check_pending' || hint === 'exceeds_confirmed' || hint === 'bad_input') return msg || 'We couldn’t send that.';
    return 'We couldn’t send the quote just now. Check your connection and try again. Nothing was sent.';
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !ctx || !data || !data.confirmed) return;
    var v = read(); if (!v) return;
    busy = true; var btn = $('coQtSend'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
    try {
      var res = await window.supabase.rpc('local_booking_send_quote', {
        p_booking: ctx.detail.booking_id, p_request_id: requestId, p_transport: v.transport, p_materials: v.materials,
        p_other: v.other, p_other_label: v.other > 0 ? v.label : null, p_other_note: null, p_note: v.note || null
      });
      if (res.error) throw res.error;
      requestId = null;
      await ctx.reload();
    } catch (err) {
      console.error('[coordinator quote]', err);
      showError(messageFor(err));
      busy = false; btn.disabled = false; btn.textContent = label;
      return;
    }
    busy = false;
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    data = null;
    var card = $('coQt'); if (!card) return;
    if (!relevant(detail) || !C.isUuid(detail.booking_id)) { card.hidden = true; return; }
    try {
      var res = await window.supabase.rpc('local_booking_quote', { p_booking: detail.booking_id });
      if (res.error) throw res.error;
      data = res.data || null;
    } catch (err) {
      console.error('[coordinator quote]', err);
      card.hidden = false; $('coQtSummary').hidden = true; $('coQtForm').hidden = true; $('coQtLead').textContent = '';
      showError('We couldn’t load the quote just now. Reload the page to try again.');
      return;
    }
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coQtForm'); if (!f) return;
    f.addEventListener('submit', submit);
    ['coQtTransport', 'coQtMaterials', 'coQtOther'].forEach(function (id) { $(id).addEventListener('input', previewTotal); });
  });

  window.STCoQuote = { mount: mount };
})();

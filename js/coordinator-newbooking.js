/* ============================================================
   StreetTasker — coordinator-newbooking.js (Stage B1)
   The "New booking" card: the order a coordinator follows on a new booking, and the one record it asks for
   (the chat with the customer: date, price, place and details confirmed).
   Reads:  nothing extra. customer_chat_recorded / customer_chat come with rpc local_booking_detail.
   Writes: rpc local_booking_record_customer_chat(...)   (the ONLY way that record is stored; the quote is blocked without it)
   If the database step has not been run yet, the detail has no customer_chat_recorded flag and this card stays hidden.
   Everything typed is set with textContent / value.
   Mounted by coordinator-booking.js and coordinator-chat.js: STCoNew.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, requestId = null, busy = false;

  var RECORDABLE = { assigned: 1, awaiting_tasker_confirmation: 1, tasker_confirmed: 1, tasker_declined: 1, quote_declined: 1 };
  var TASKER_DONE = { tasker_confirmed: 1, tasker_declined: 1, quote_sent: 1, quote_approved: 1, quote_declined: 1 };
  var ONBOARDING = { assigned: 1, awaiting_tasker_confirmation: 1 };

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function active(d) { return !!d && d.open && !d.frozen; }
  function known(d) { return !!d && typeof d.customer_chat_recorded === 'boolean'; }

  /* The five steps, in order. The first one not done is "now". */
  function stepsFor(d) {
    var chatDone = !!d.customer_chat_recorded, tDone = !!TASKER_DONE[d.lt_status];
    return [
      { text: 'Accept the application', done: true },
      { text: 'Chat with the customer: confirm the date, the price, the place and the details', done: chatDone },
      { text: 'Record what you agreed with the customer (below)', done: chatDone },
      { text: 'While you chat, phone the Local Tasker and check they can do it', done: tDone },
      { text: 'Record the Local Tasker’s answer (“The Local Tasker’s answer” card). Only then can you send the quote', done: tDone }
    ];
  }

  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function clearErrors() {
    fieldError('coNbNote', '');
    var e = $('coNbTicksErr'); if (e) { e.textContent = ''; e.hidden = true; }
    $('coNbError').hidden = true;
  }
  function showError(msg) { $('coNbErrorText').textContent = msg; $('coNbError').hidden = false; }

  function fact(dl, label, value) {
    var has = value != null && String(value).trim() !== '';
    dl.appendChild(C.el('dt', 'co-fact-label', label));
    dl.appendChild(C.el('dd', 'co-fact-value' + (has ? '' : ' is-empty'), has ? String(value) : 'Not set'));
  }

  function renderSteps(d) {
    var ul = $('coNbSteps'); ul.textContent = '';
    var now = false;
    stepsFor(d).forEach(function (s) {
      var li = C.el('li', 'co-check-item' + (s.done ? ' is-done' : ''));
      if (!s.done && !now) { li.className += ' is-now'; now = true; }
      li.appendChild(C.el('span', 'co-check-mark'));
      li.appendChild(C.el('span', 'co-check-text', s.text));
      ul.appendChild(li);
    });
  }

  function render() {
    var d = ctx.detail, card = $('coNb');
    if (!card) return;
    if (!known(d) || !d.open) { card.hidden = true; return; }
    var recorded = d.customer_chat_recorded;
    var canRecord = active(d) && !recorded && !!RECORDABLE[d.lt_status];
    var showSteps = active(d) && !!ONBOARDING[d.lt_status];
    if (!showSteps && !recorded && !canRecord) { card.hidden = true; return; }
    card.hidden = false;
    clearErrors();

    $('coNbStepsBox').hidden = !showSteps;
    if (showSteps) renderSteps(d);

    var form = $('coNbForm'), sum = $('coNbSummary');
    form.hidden = !canRecord; sum.hidden = !recorded;
    if (canRecord) {
      $('coNbLead').textContent = 'Before you send a quote, chat with the customer and agree four things. Then record it here. The quote stays locked until you do.';
      if (!requestId) requestId = newId();
      form.reset();
      var task = d.task || {}, svc = d.service || {};
      var dl = $('coNbBooking'); dl.textContent = '';
      fact(dl, 'When', B.whenText(d));
      fact(dl, 'Place', task.location || svc.location);
      fact(dl, 'Price', d.amount != null && Number(d.amount) > 0 ? B.naira(d.amount) : (task.budget != null && Number(task.budget) > 0 ? B.naira(task.budget) + ' (budget)' : ''));
      fact(dl, 'Details', task.description || d.notes);
    } else if (recorded) {
      $('coNbLead').textContent = 'You confirmed the date, price, place and details with the customer.';
      var cc = d.customer_chat || {}, f = $('coNbFacts'); f.textContent = '';
      fact(f, 'What you agreed', cc.note);
      fact(f, 'Recorded', B.dateTime(cc.recorded_at));
    }
  }

  function read() {
    clearErrors();
    var ok = true, first = null;
    var ticks = ['coNbDate', 'coNbPrice', 'coNbPlace', 'coNbDetails'].every(function (id) { return $(id).checked; });
    var note = $('coNbNote').value.trim();
    if (!ticks) { var e = $('coNbTicksErr'); e.textContent = 'Tick all four once you have confirmed each one with the customer.'; e.hidden = false; ok = false; first = 'coNbDate'; }
    if (note.length < 3) { fieldError('coNbNote', 'Write what you agreed, like “Friday 10am, ₦12,000, 12 Ade St, leaking sink”.'); ok = false; first = first || 'coNbNote'; }
    else if (note.length > 500) { fieldError('coNbNote', 'Keep this to 500 characters.'); ok = false; first = first || 'coNbNote'; }
    if (!ok) { var f = $(first); if (f && f.focus) f.focus(); return null; }
    return { note: note };
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'booking_closed') return 'This booking is closed, so nothing more can be recorded.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so nothing can be recorded right now.';
    if (hint === 'invalid_transition') return 'The quote has already been sent, so this can’t be recorded now. Reload the page to see where the booking is.';
    if (hint === 'bad_input' && msg) return msg;
    return 'We couldn’t save that just now. Check your connection and try again. Nothing was recorded.';
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !ctx) return;
    var v = read(); if (!v) return;
    busy = true; var btn = $('coNbSave'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var res = await window.supabase.rpc('local_booking_record_customer_chat', {
        p_booking: ctx.detail.booking_id, p_request_id: requestId,
        p_date_ok: $('coNbDate').checked, p_price_ok: $('coNbPrice').checked, p_place_ok: $('coNbPlace').checked, p_details_ok: $('coNbDetails').checked,
        p_note: v.note
      });
      if (res.error) throw res.error;
      requestId = null;
      await ctx.reload();
    } catch (err) {
      console.error('[coordinator new booking]', err);
      showError(messageFor(err));
      busy = false; btn.disabled = false; btn.textContent = label;
      return;
    }
    busy = false;
  }

  function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    if (!$('coNb')) return;
    if (!C.isUuid(detail && detail.booking_id)) { $('coNb').hidden = true; return; }
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coNbForm'); if (!f) return;
    f.addEventListener('submit', submit);
  });

  window.STCoNew = { mount: mount };
})();

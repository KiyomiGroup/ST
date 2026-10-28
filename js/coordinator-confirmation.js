/* ============================================================
   StreetTasker — coordinator-confirmation.js (Stage 5C-1)
   The "Local Tasker's answer" card on the coordinator booking page.
   Reads:  rpc local_booking_confirmations(p_booking)   (current record, calls made, tasker name and phone)
   Writes: rpc local_booking_record_confirmation(...)   (the ONLY way a price or an answer is stored)
           rpc local_booking_step(awaiting_tasker_confirmation) to send the booking back for a new answer
   The coordinator can record what the Local Tasker said; nothing here can edit a recorded price, set a payment
   state, or accept on the tasker's behalf without the call record. Everything typed is set with textContent / value.
   Mounted by coordinator-booking.js after it renders: STCoConfirm.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, data = null, requestId = null, busy = false;

  var WAITING = { assigned: 1, awaiting_tasker_confirmation: 1 };
  var CAN_REDO = { tasker_confirmed: 1, tasker_declined: 1, quote_sent: 1, quote_declined: 1 };

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function active(d) { return !!d && d.open && !d.frozen; }
  function relevant(d) {
    return !!d && ({ assigned: 1, awaiting_tasker_confirmation: 1, tasker_confirmed: 1, tasker_declined: 1, quote_sent: 1, quote_declined: 1, quote_approved: 1 })[d.lt_status] === 1;
  }

  /* Text under "Next step": what to do here, or what is coming. */
  function noteFor(d) {
    if (!active(d)) return '';
    if (WAITING[d.lt_status]) return 'Use “The Local Tasker’s answer” below to record your call.';
    if (d.lt_status === 'tasker_confirmed') return 'Building the quote arrives in the next update.';
    return '';
  }

  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function clearErrors() {
    ['coCfName', 'coCfNumber', 'coCfWhen', 'coCfPrice', 'coCfDuration', 'coCfTransport', 'coCfMaterials', 'coCfMatNotes', 'coCfLimits', 'coCfNotes'].forEach(function (id) { fieldError(id, ''); });
    ['coCfOutcomeErr', 'coCfAvailErr', 'coCfReadBackErr'].forEach(function (id) { var e = $(id); if (e) { e.textContent = ''; e.hidden = true; } });
    $('coCfError').hidden = true;
  }
  function showError(msg) { $('coCfErrorText').textContent = msg; $('coCfError').hidden = false; $('coCfError').scrollIntoView && $('coCfError').scrollIntoView({ block: 'nearest' }); }
  function plain(id, msg) { var e = $(id); if (e) { e.textContent = msg; e.hidden = false; } }

  function parseMoney(raw) {
    var t = String(raw == null ? '' : raw).replace(/[₦,\s]/g, '');
    if (t === '') return { empty: true, value: 0 };
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return { bad: true };
    var v = Number(t);
    if (!isFinite(v) || v > 10000000) return { bad: true };
    return { value: v };
  }
  function outcome() { var r = document.querySelector('input[name="coCfOutcome"]:checked'); return r ? r.value : ''; }
  function nowLocalInput() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function fact(dl, label, value, cls) {
    var has = value != null && String(value).trim() !== '';
    var dt = C.el('dt', 'co-fact-label', label);
    var dd = C.el('dd', 'co-fact-value' + (has ? '' : ' is-empty') + (cls ? ' ' + cls : ''), has ? String(value) : 'None');
    dl.appendChild(dt); dl.appendChild(dd);
  }
  function yesNo(v) { return v ? 'Yes' : 'No'; }
  function secondText(c) {
    switch (c.second_check_status) {
      case 'requested': return 'An administrator call-back was asked for. The quote can be sent once it is recorded as passed.';
      case 'passed': return 'Administrator call-back: passed.' + (c.second_check_note ? ' ' + c.second_check_note : '');
      case 'failed': return 'Administrator call-back: failed.' + (c.second_check_note ? ' ' + c.second_check_note : '') + ' Record a new answer to continue.';
      default: return '';
    }
  }

  function renderSummary(d, cur) {
    var dl = $('coCfFacts'); dl.textContent = '';
    if (cur.outcome === 'confirmed') {
      fact(dl, 'Answer', 'Can do the job');
      fact(dl, 'Spoke to', cur.called_name);
      fact(dl, 'Number called', cur.called_number);
      if (cur.number_matches_profile === false) fact(dl, 'Check', 'Not the number on their profile', 'co-cf-warn');
      fact(dl, 'Time of call', B.dateTime(cur.called_at));
      fact(dl, 'Available and able', yesNo(cur.available && cur.can_do));
      fact(dl, 'Their price', B.naira(cur.proposed_price));
      fact(dl, 'Time needed', cur.duration_text);
      fact(dl, 'Transport', Number(cur.transport_amount) > 0 ? B.naira(cur.transport_amount) : '');
      fact(dl, 'Materials', Number(cur.materials_amount) > 0 ? B.naira(cur.materials_amount) + (cur.materials_notes ? ' · ' + cur.materials_notes : '') : (cur.materials_notes || ''));
      fact(dl, 'Limits', cur.limitations);
      fact(dl, 'Other notes', cur.agreed_notes);
    } else {
      fact(dl, 'Answer', 'Declined');
      fact(dl, 'Spoke to', cur.called_name);
      fact(dl, 'Number called', cur.called_number);
      fact(dl, 'Time of call', B.dateTime(cur.called_at));
      fact(dl, 'Reason', cur.limitations || cur.agreed_notes);
    }
    $('coCfSecondNote').textContent = secondText(cur);
    $('coCfSecondNote').hidden = !$('coCfSecondNote').textContent;
    $('coCfAgainRow').hidden = !(active(d) && CAN_REDO[d.lt_status]);
    $('coCfAgainConfirm').hidden = true;
    $('coCfSummary').hidden = false;
  }

  function resetForm() {
    $('coCfForm').reset();
    clearErrors();
    $('coCfName').value = (data && data.tasker_name) || '';
    $('coCfNumber').value = (data && data.tasker_phone) || '';
    $('coCfWhen').value = nowLocalInput();
    var h = $('coCfNumberHelp'); h.textContent = '';
    if (data && data.tasker_phone) {
      h.appendChild(document.createTextNode('On their profile: '));
      var a = C.el('a', 'co-fact-link', String(data.tasker_phone)); a.href = 'tel:' + String(data.tasker_phone).replace(/[^0-9+]/g, ''); h.appendChild(a);
      h.appendChild(document.createTextNode('. Change it if you called a different number.'));
    } else {
      h.textContent = 'There is no number on their profile. Enter the one you called.';
    }
    toggleFields();
  }
  function toggleFields() {
    var o = outcome();
    $('coCfConfirmFields').hidden = o !== 'confirmed';
    $('coCfSureFields').hidden = o !== 'confirmed';
    $('coCfLimitsGroup').hidden = !(o === 'confirmed' || o === 'declined');
    $('coCfNotesGroup').hidden = !o;
    $('coCfActions').hidden = !o;
    $('coCfLimitsLabel').textContent = o === 'declined' ? 'Why can’t they do it?' : 'Limits or conditions (optional)';
    $('coCfSave').textContent = o === 'no_answer' ? 'Save, I’ll try again' : 'Save their answer';
  }

  function attempts(list) {
    var ul = $('coCfAttempts'); ul.textContent = '';
    var rows = Array.isArray(list) ? list : [];
    $('coCfAttemptsBox').hidden = !rows.length;
    rows.forEach(function (a) {
      var li = C.el('li', 'co-bk-event');
      var what = a.outcome === 'confirmed' ? 'Can do the job' + (a.proposed_price != null ? ' · ' + B.naira(a.proposed_price) : '') : a.outcome === 'declined' ? 'Declined' : 'No answer';
      li.appendChild(C.el('span', 'co-bk-event-text', what + (a.superseded ? ' (replaced by a later call)' : '')));
      li.appendChild(C.el('span', 'co-consent-meta', B.dateTime(a.called_at) + (a.called_name ? ' · ' + a.called_name : '')));
      ul.appendChild(li);
    });
  }

  function render() {
    var d = ctx.detail, card = $('coCf');
    if (!relevant(d)) { card.hidden = true; return; }
    card.hidden = false;
    var cur = data && data.current;
    var form = $('coCfForm'), summary = $('coCfSummary');
    form.hidden = true; summary.hidden = true;
    if (active(d) && WAITING[d.lt_status]) {
      $('coCfLead').textContent = 'Phone the Local Tasker, then record what they told you. This is the only way their answer and price get on the booking.';
      form.hidden = false;
      if (!requestId) requestId = newId();
      resetForm();
    } else if (cur) {
      $('coCfLead').textContent = d.lt_status === 'quote_approved' ? 'What the Local Tasker agreed on the phone.' : 'What the Local Tasker told you on the phone. A recorded answer can’t be edited.';
      renderSummary(d, cur);
    } else {
      $('coCfLead').textContent = active(d) ? 'No answer is on record for this booking.' : '';
      card.hidden = !$('coCfLead').textContent;
    }
    attempts(data && data.attempts);
  }

  function readForm() {
    var o = outcome(), ok = true, first = null;
    function bad(id, msg) { fieldError(id, msg); ok = false; if (!first) first = id; }
    clearErrors();
    var v = {
      outcome: o, name: $('coCfName').value.trim(), number: $('coCfNumber').value.trim(), when: $('coCfWhen').value,
      avail: $('coCfAvail').checked, can: $('coCfCan').checked, dur: $('coCfDuration').value.trim(),
      matNotes: $('coCfMatNotes').value.trim(), limits: $('coCfLimits').value.trim(), notes: $('coCfNotes').value.trim(),
      readBack: $('coCfReadBack').checked, second: $('coCfSecond').checked
    };
    if (!o) { plain('coCfOutcomeErr', 'Choose what they said.'); ok = false; first = first || 'coCfOutConfirmed'; }
    if (!v.name) bad('coCfName', 'Say who you spoke to.');
    if (!/^\+?[0-9][0-9 ()-]{5,28}$/.test(v.number)) bad('coCfNumber', 'Enter the number you called.');
    var at = v.when ? new Date(v.when) : null;
    if (!at || isNaN(at.getTime())) bad('coCfWhen', 'Enter when you called.');
    else if (at.getTime() > Date.now() + 5 * 60000) bad('coCfWhen', 'The time of the call can’t be in the future.');
    else v.whenIso = at.toISOString();
    var price = parseMoney($('coCfPrice').value), tr = parseMoney($('coCfTransport').value), ma = parseMoney($('coCfMaterials').value);
    v.price = price.value; v.transport = tr.value; v.materials = ma.value;
    if (tr.bad) bad('coCfTransport', 'Enter an amount like 1500.');
    if (ma.bad) bad('coCfMaterials', 'Enter an amount like 3000.');
    if (v.matNotes.length > 300) bad('coCfMatNotes', 'Keep this to 300 characters.');
    if (v.limits.length > 300) bad('coCfLimits', 'Keep this to 300 characters.');
    if (v.notes.length > 300) bad('coCfNotes', 'Keep this to 300 characters.');
    if (o === 'confirmed') {
      if (!v.avail || !v.can) { plain('coCfAvailErr', 'Tick both boxes, or choose “can’t do the job”.'); ok = false; first = first || 'coCfAvail'; }
      if (price.bad || price.empty || price.value <= 0) bad('coCfPrice', 'Enter the price they gave you, like 12500.');
      if (!v.dur) bad('coCfDuration', 'Enter how long they say it will take.');
      if (v.dur.length > 80) bad('coCfDuration', 'Keep this to 80 characters.');
      if (!v.readBack) { plain('coCfReadBackErr', 'Read the price back to them first.'); ok = false; first = first || 'coCfReadBack'; }
    } else if (o === 'declined') {
      if (v.limits.length < 3) bad('coCfLimits', 'Note why they can’t do it.');
    }
    if (!ok) { var f = $(first); if (f && f.focus) f.focus(); return null; }
    return v;
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'booking_closed') return 'This booking is closed, so nothing more can be recorded.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so nothing can be recorded right now.';
    if (hint === 'invalid_transition') return 'An answer is already on record. Reload the page to see it.';
    if (hint === 'bad_input' && msg) return msg;              // the database's own plain sentence, e.g. "Enter the number you called."
    return 'We couldn’t save that just now. Check your connection and try again. Nothing was recorded.';
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !ctx) return;
    var v = readForm(); if (!v) return;
    busy = true; var btn = $('coCfSave'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var res = await window.supabase.rpc('local_booking_record_confirmation', {
        p_booking: ctx.detail.booking_id, p_request_id: requestId, p_outcome: v.outcome, p_called_name: v.name, p_called_number: v.number,
        p_called_at: v.whenIso, p_available: v.outcome === 'no_answer' ? null : v.avail, p_can_do: v.outcome === 'no_answer' ? null : v.can,
        p_price: v.outcome === 'confirmed' ? v.price : null, p_duration: v.outcome === 'confirmed' ? v.dur : null,
        p_transport: v.outcome === 'confirmed' ? v.transport : 0, p_materials: v.outcome === 'confirmed' ? v.materials : 0,
        p_materials_notes: v.outcome === 'confirmed' ? (v.matNotes || null) : null, p_limitations: v.limits || null, p_notes: v.notes || null,
        p_read_back: v.outcome === 'confirmed' ? v.readBack : false, p_second_check: v.outcome === 'confirmed' ? v.second : false
      });
      if (res.error) throw res.error;
      requestId = null;                   // a saved call is finished; the next one gets a new id
      await ctx.reload();
    } catch (err) {
      console.error('[coordinator confirmation]', err);
      showError(messageFor(err));
      busy = false; btn.disabled = false; btn.textContent = label;
      return;
    }
    busy = false;
  }

  async function redo() {
    if (busy || !ctx) return;
    busy = true; $('coCfAgainGo').disabled = true;
    try {
      var res = await window.supabase.rpc('local_booking_step', { p_booking: ctx.detail.booking_id, p_to: 'awaiting_tasker_confirmation', p_note: 'New answer needed from the Local Tasker' });
      if (res.error) throw res.error;
      requestId = null;
      await ctx.reload();
    } catch (err) {
      console.error('[coordinator confirmation]', err);
      showError(messageFor(err));
    }
    busy = false; $('coCfAgainGo').disabled = false;
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    data = null;
    var card = $('coCf'); if (!card) return;
    if (!relevant(detail) || !C.isUuid(detail.booking_id)) { card.hidden = true; return; }
    try {
      var res = await window.supabase.rpc('local_booking_confirmations', { p_booking: detail.booking_id });
      if (res.error) throw res.error;
      data = res.data || null;
    } catch (err) {
      console.error('[coordinator confirmation]', err);
      card.hidden = false; $('coCfSummary').hidden = true; $('coCfForm').hidden = true;
      $('coCfLead').textContent = '';
      showError('We couldn’t load the Local Tasker’s answer just now. Reload the page to try again.');
      return;
    }
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coCfForm'); if (!f) return;
    f.addEventListener('submit', submit);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="coCfOutcome"]'), function (r) { r.addEventListener('change', function () { clearErrors(); toggleFields(); }); });
    $('coCfAgain').addEventListener('click', function () {
      var q = ctx && ctx.detail && ctx.detail.lt_status;
      $('coCfAgainText').textContent = q === 'quote_sent' || q === 'quote_declined'
        ? 'The quote already sent will need to be sent again after the new answer. The current answer stays in the history.'
        : 'The current answer stays in the history. You will phone the Local Tasker again and record what they say.';
      $('coCfAgainConfirm').hidden = false; $('coCfAgainRow').hidden = true;
    });
    $('coCfAgainCancel').addEventListener('click', function () { $('coCfAgainConfirm').hidden = true; $('coCfAgainRow').hidden = false; });
    $('coCfAgainGo').addEventListener('click', redo);
  });

  window.STCoConfirm = { mount: mount, noteFor: noteFor };
})();

/* ============================================================
   StreetTasker — coordinator-declined.js (Stage B2b)
   The "Quote declined" card: what the coordinator does, in order, after the customer declines a quote.
   Steps: 1 phone the Local Tasker with the customer's price, 2 record their new answer, 3 send the new quote.
   Reads:  nothing new on the booking: lt_status and the timeline come with rpc local_booking_detail.
           While the booking is at "quote declined" it also reads rpc local_booking_quote (the customer's price and reason, B2a).
   Writes: rpc local_booking_close_declined(...)   (B2c: "the customer will not accept": closes the booking, the task and the chat, and tells the customer).
           The steps themselves write nothing. The cards that do the work are "The Local Tasker's answer" and "The quote".
   If the B2c SQL has not been run, closing fails with a clear message and nothing changes.
   The customer's price is kept in sessionStorage (this tab, this booking) so the later steps can still show it after the
   old quote is replaced. Storage is optional: if it is not there, the steps simply leave the price out.
   Everything typed is set with textContent. Mounted by coordinator-booking.js: STCoDeclined.mount(detail).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, ask = null, token = 0, requestId = null, busy = false;

  var IN_ROUND = { quote_declined: 1, awaiting_tasker_confirmation: 1, tasker_confirmed: 1, tasker_declined: 1 };

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function showError(msg) { $('coDcErrorText').textContent = msg; $('coDcError').hidden = !msg; }
  function resetClose() {
    var f = $('coDcCloseForm'); if (!f) return;
    f.reset(); f.hidden = true; $('coDcCloseRow').hidden = false; $('coDcNoteErr').hidden = true; showError('');
  }
  function active(d) { return !!d && d.open && !d.frozen; }
  function key(id) { return 'st:declined-ask:' + id; }
  function saveAsk(id, a) { try { window.sessionStorage.setItem(key(id), JSON.stringify(a)); } catch (e) { /* storage not available: fine */ } }
  function loadAsk(id) {
    try { var raw = window.sessionStorage.getItem(key(id)); var a = raw ? JSON.parse(raw) : null; return a && typeof a === 'object' ? a : null; } catch (e) { return null; }
  }

  /* Is this booking in a "customer declined" round, and has the Local Tasker's new answer been recorded since? */
  function roundOf(d) {
    var st = d.lt_status;
    if (!IN_ROUND[st]) return { on: false };
    var ev = (Array.isArray(d.events) ? d.events : []).map(function (e, i) { return { e: e, i: i, t: new Date(e.created_at).getTime() || 0 }; });
    ev.sort(function (a, b) { return a.t - b.t || a.i - b.i; });
    var at = -1, k;
    for (k = 0; k < ev.length; k++) if (ev[k].e.kind === 'status_changed' && ev[k].e.to_status === 'quote_declined') at = k;
    if (st !== 'quote_declined') {
      if (at < 0) return { on: false };
      for (k = at + 1; k < ev.length; k++) if (ev[k].e.to_status === 'quote_sent') return { on: false };
    }
    var answered = false;
    if (st === 'tasker_confirmed' || st === 'tasker_declined') answered = true;
    for (k = at + 1; k < ev.length && at >= 0; k++) if (ev[k].e.kind === 'confirmation_recorded') answered = true;
    return { on: true, answered: answered };
  }

  function fact(dl, label, value) {
    dl.appendChild(C.el('dt', 'co-fact-label', label));
    dl.appendChild(C.el('dd', 'co-fact-value', value));
  }

  function stepsFor(d, r) {
    var has = !!(ask && Number(ask.counter) > 0);
    var price = has ? B.naira(ask.counter) : '';
    var was = ask && Number(ask.fee) > 0 ? ' (the quote had ' + B.naira(ask.fee) + ')' : '';
    if (has) {
      return [
        { text: 'Phone the Local Tasker. Tell them the customer asks for a service price of ' + price + was + ', and ask if they agree.', done: r.answered },
        { text: 'Record what they said: open “The Local Tasker’s answer” and press “Record a new answer”. The price they agree to is the new service fee.', done: r.answered },
        { text: 'Send the new quote in “The quote”. Transport and materials stay as the Local Tasker confirmed them.', done: false }
      ];
    }
    return [
      { text: 'Read the customer’s reason below. If it is not clear, ask them in the chat.', done: true },
      { text: 'If the price has to change, phone the Local Tasker and record their new answer: open “The Local Tasker’s answer” and press “Record a new answer”.', done: r.answered, advice: true },
      { text: 'Send the new quote in “The quote”.', done: false }
    ];
  }

  function render() {
    var d = ctx.detail, card = $('coDc');
    if (!card) return;
    var r = active(d) ? roundOf(d) : { on: false };
    if (!r.on) { card.hidden = true; return; }
    card.hidden = false;

    var st = d.lt_status, facts = $('coDcFacts'), box = $('coDcStepsBox'), list = $('coDcSteps');
    $('coDcClose').hidden = !(st === 'quote_declined' || st === 'tasker_declined');
    if (!busy) { resetClose(); requestId = null; }
    facts.textContent = ''; list.textContent = '';

    if (ask && Number(ask.counter) > 0) fact(facts, 'The customer asks for', B.naira(ask.counter) + ' for the service');
    if (ask && Number(ask.fee) > 0) fact(facts, 'The quote had', B.naira(ask.fee) + ' for the service');
    if (ask && ask.reason) fact(facts, 'Their reason', String(ask.reason));
    $('coDcFactsBox').hidden = !facts.children.length;

    if (st === 'tasker_declined') {
      $('coDcLead').textContent = 'The Local Tasker can’t do the job. Tell the customer what happened. If the Local Tasker changes their mind, you can record a new answer in “The Local Tasker’s answer”.';
      box.hidden = true;
      return;
    }
    $('coDcLead').textContent = st === 'quote_declined'
      ? 'The customer declined the quote. Follow these steps in order.'
      : st === 'tasker_confirmed'
        ? 'The Local Tasker has answered. The last step is to send the new quote.'
        : 'You are getting a new answer from the Local Tasker. Follow these steps in order.';
    box.hidden = false;
    var now = false;
    stepsFor(d, r).forEach(function (s) {
      var li = C.el('li', 'co-check-item' + (s.done ? ' is-done' : '') + (s.advice ? ' is-advice' : ''));
      if (!s.done && !now) { li.className += ' is-now'; now = true; }
      li.appendChild(C.el('span', 'co-check-mark'));
      li.appendChild(C.el('span', 'co-check-text', s.text));
      list.appendChild(li);
    });
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (error && (error.code === '42883' || error.code === 'PGRST202')) return 'This step is not switched on yet (the database update has not been run). Nothing was changed.';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'booking_closed') return 'This booking is already closed. Reload the page.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so it can’t be closed here right now.';
    if (hint === 'money_held') return 'Money is already held or paid for this booking. Use “Cancel or report a problem” below so support can settle it safely.';
    if (hint === 'payment_started') return 'A payment has just started. Wait a moment and try again.';
    if (hint === 'invalid_transition' || hint === 'bad_input' || hint === 'wrong_status') return msg || 'This booking can’t be closed at this step.';
    return 'We couldn’t close the booking just now. Check your connection and try again. Nothing was changed.';
  }

  async function submitClose(e) {
    e.preventDefault();
    if (busy || !ctx) return;
    var note = $('coDcNote').value.trim();
    if (note.length > 250) { var er = $('coDcNoteErr'); er.textContent = 'Keep this to 250 characters.'; er.hidden = false; $('coDcNote').focus(); return; }
    $('coDcNoteErr').hidden = true; showError('');
    if (!requestId) requestId = newId();
    busy = true; var btn = $('coDcCloseGo'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Closing…';
    try {
      var res = await window.supabase.rpc('local_booking_close_declined', { p_booking: ctx.detail.booking_id, p_request_id: requestId, p_note: note || null });
      if (res.error) throw res.error;
      requestId = null;
      busy = false;
      if (ctx.reload) await ctx.reload();
    } catch (err) {
      console.error('[coordinator declined]', err);
      showError(messageFor(err));
      busy = false; btn.disabled = false; btn.textContent = label;
    }
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    var mine = ++token;
    ask = null;
    var card = $('coDc'); if (!card) return;
    if (!C.isUuid(detail && detail.booking_id) || !active(detail) || !roundOf(detail).on) { card.hidden = true; return; }
    ask = loadAsk(detail.booking_id);
    if (detail.lt_status === 'quote_declined') {
      try {
        var res = await window.supabase.rpc('local_booking_quote', { p_booking: detail.booking_id });
        if (res.error) throw res.error;
        var cur = res.data && res.data.current, dec = cur && cur.decision;
        if (dec && dec.decision === 'declined') {
          ask = { counter: Number(dec.counter_amount) > 0 ? Number(dec.counter_amount) : 0, fee: Number(cur.service_fee) || 0, reason: dec.reason || '' };
          saveAsk(detail.booking_id, ask);
        }
      } catch (err) {
        console.error('[coordinator declined]', err);   // the steps still show, without the price
      }
    }
    if (mine !== token) return;
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coDcCloseForm'); if (!f) return;
    $('coDcCloseOpen').addEventListener('click', function () { $('coDcCloseForm').hidden = false; $('coDcCloseRow').hidden = true; $('coDcNote').focus(); });
    $('coDcCloseCancel').addEventListener('click', function () { if (!busy) resetClose(); });
    f.addEventListener('submit', submitClose);
  });

  window.STCoDeclined = { mount: mount, roundOf: roundOf };
})();

/* ============================================================
   StreetTasker — coordinator-reduction.js (Stage 5D-3c-2)
   The "Lower the price" card on the coordinator booking page.
   Reads:  rpc local_booking_reduction(p_booking)                  can a reduction be reported now (and why not), what was paid, the list
   Writes: rpc local_booking_request_reduction(...)                 opens a problem report (category wrong_amount) for the Local Tasker, with the
                                                                     amount, what was paid, how it was confirmed and why in its reason
           rpc local_booking_withdraw_problem(p_booking, p_dispute) the existing 5D-3b withdraw, only while support has not started on it
   This card never refunds anything and never changes a price or a payment: StreetTasker support decides and records any refund.
   Everything from the database is set with textContent. Mounted by coordinator-booking.js: STCoReduction.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, data = null, ids = {}, busy = false;
  var STATUS = { open: 'Sent to support, not yet looked at', under_review: 'Support is looking at it', resolved: 'Support has decided', withdrawn: 'Withdrawn' };
  var OUTCOME = { refund_full: 'Support decided: full refund', refund_partial: 'Support decided: part of the money is refunded', split: 'Support decided: the money is split',
                  release_to_tasker: 'Support decided: no refund', no_action: 'Support decided: nothing changes' };
  var WHY = {
    not_paid: 'Nothing has been paid yet. To lower the price, send the booking back to the Local Tasker for a new answer and a new quote. The old quote’s unpaid requests are cancelled for you.',
    payment_started: 'A payment is in progress. Try again in a moment.',
    dispute_open: 'A problem report is open, so nothing else can be done until support has decided it.',
    too_many: 'Several reports were opened on this booking today. Please wait before opening another.',
    nothing_left: 'Everything that was paid is already covered by earlier reduction requests.'
  };
  var FIELDS = ['coRdAmount', 'coRdWhy', 'coRdHow', 'coRdSure'];

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function idFor(sig) { if (!ids[sig]) ids[sig] = newId(); return ids[sig]; }      /* same id for the same request until it succeeds: a retry never doubles */
  function naira(n) { return '₦' + Number(n).toLocaleString('en-NG'); }
  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function clearErrors() { FIELDS.forEach(function (k) { fieldError(k, ''); }); $('coRdError').hidden = true; }
  function showError(msg) { $('coRdErrorText').textContent = msg; $('coRdError').hidden = false; }

  function render() {
    var card = $('coRd');
    var items = (data && data.items) || [];
    if (!data || (!data.can_request && !items.length && (data.blocked === 'not_approved' || data.blocked === 'booking_closed' || data.blocked === 'not_found'))) { card.hidden = true; return; }
    card.hidden = false;
    clearErrors();
    var list = $('coRdList'); list.textContent = '';
    items.forEach(function (x) {
      var li = C.el('li', 'co-bk-event');
      li.appendChild(C.el('span', 'co-bk-event-text', 'Lower by ' + naira(x.amount) + ': ' + x.why));
      var state = x.status === 'resolved' ? (OUTCOME[x.outcome] || STATUS.resolved) : (STATUS[x.status] || '');
      li.appendChild(C.el('span', 'co-consent-meta', state + ' · ' + B.dateTime(x.created_at)));
      if (x.can_withdraw) {
        var b = C.el('button', 'btn btn-outline btn-sm', 'Withdraw'); b.type = 'button'; b.disabled = busy;
        b.addEventListener('click', function () { withdraw(x.dispute_id); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    $('coRdForm').hidden = !data.can_request;
    var lead = data.can_request ? 'If the Local Tasker agreed to a lower price after the customer paid, record it here. This does not refund anything: it sends a report to StreetTasker support, who decide and record any refund. Payments on this job are paused until support has decided.'
                                : (WHY[data.blocked] || '');
    $('coRdLead').textContent = lead; $('coRdLead').hidden = !lead;
    $('coRdAmountHelp').textContent = 'Whole naira, 100 or more, and no more than ' + naira(data.room) + ' (what the customer has paid and not already asked to lower).';
    $('coRdSubmit').disabled = busy;
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'not_approved') return 'The customer has not approved the quote yet. We have reloaded the card.';
    if (hint === 'not_paid') return 'Nothing has been paid yet, so a report is not needed. Send the booking back to the Local Tasker for a new quote instead. We have reloaded the card.';
    if (hint === 'payment_started') return 'A payment has just started. Please wait a moment and try again.';
    if (hint === 'dispute_open') return 'A problem report is already open on this booking. We have reloaded the card.';
    if (hint === 'too_many') return 'Too many reports today. Please wait before opening another.';
    if (hint === 'booking_closed') return 'This booking is already closed. We have reloaded the card.';
    if (hint === 'over_limit') return msg || 'That is more than can still be asked for on this booking.';
    if (hint === 'not_open') return 'Support is already reviewing or has decided this report, so it can’t be withdrawn. We have reloaded the card.';
    if (hint === 'bad_input') return msg || 'That could not be saved.';
    return 'We couldn’t do that just now. Check your connection and try again. Nothing was changed.';
  }
  var RELOAD = { not_approved: 1, not_paid: 1, payment_started: 1, dispute_open: 1, too_many: 1, booking_closed: 1, over_limit: 1, not_open: 1 };

  async function load() {
    var res = await window.supabase.rpc('local_booking_reduction', { p_booking: ctx.detail.booking_id });
    if (res.error) throw res.error;
    data = res.data;
  }
  async function after(err, sig) {
    if (RELOAD[err && err.hint]) {
      delete ids[sig]; busy = false;
      try { await load(); render(); } catch (e2) { /* keep the message below */ }
    }
    showError(messageFor(err));
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !data) return;
    clearErrors();
    var raw = $('coRdAmount').value.replace(/[\s,₦]/g, ''), why = $('coRdWhy').value.trim(), how = $('coRdHow').value;
    if (!/^\d+$/.test(raw) || Number(raw) < 100 || Number(raw) > 10000000) { fieldError('coRdAmount', 'Enter a whole amount from 100 to 10,000,000.'); $('coRdAmount').focus(); return; }
    var amount = Number(raw);
    if (amount > Number(data.room)) { fieldError('coRdAmount', 'That is more than the ' + naira(data.room) + ' that can still be asked for.'); $('coRdAmount').focus(); return; }
    if (why.length < 5 || why.length > 300) { fieldError('coRdWhy', 'Say why the price goes down, in 5 to 300 characters.'); $('coRdWhy').focus(); return; }
    if (!how) { fieldError('coRdHow', 'Say how the Local Tasker confirmed it.'); $('coRdHow').focus(); return; }
    if (!$('coRdSure').checked) { fieldError('coRdSure', 'Tick the box to confirm.'); $('coRdSure').focus(); return; }
    var sig = [amount, why, how].join('|');
    busy = true; $('coRdSubmit').disabled = true;
    try {
      var res = await window.supabase.rpc('local_booking_request_reduction', {
        p_booking: ctx.detail.booking_id, p_request_id: idFor(sig), p_amount: amount, p_why: why, p_how: how });
      if (res.error) throw res.error;
      delete ids[sig];
      ['coRdAmount', 'coRdWhy', 'coRdHow'].forEach(function (k) { $(k).value = ''; });
      $('coRdSure').checked = false;
      busy = false;
      await load(); render();
      ctx.reload();
    } catch (err) { await after(err, sig); }
    finally { busy = false; var b = $('coRdSubmit'); if (b) b.disabled = false; }
  }

  async function withdraw(disputeId) {
    if (busy || !data) return;
    busy = true; clearErrors();
    Array.prototype.forEach.call(document.querySelectorAll('#coRdList button'), function (b) { b.disabled = true; });
    try {
      var res = await window.supabase.rpc('local_booking_withdraw_problem', { p_booking: ctx.detail.booking_id, p_dispute: disputeId });
      if (res.error) throw res.error;
      busy = false;
      await load(); render();
      ctx.reload();
    } catch (err) { await after(err, 'withdraw'); }
    finally { busy = false; Array.prototype.forEach.call(document.querySelectorAll('#coRdList button'), function (b) { b.disabled = false; }); }
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    if (!detail || !detail.booking_id) { data = null; $('coRd').hidden = true; return; }
    try { await load(); render(); }
    catch (err) { $('coRd').hidden = false; $('coRdForm').hidden = true; $('coRdLead').textContent = ''; showError('We couldn’t load this card. Reload the page to try again.'); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coRdForm'); if (f) f.addEventListener('submit', submit);
  });
  window.STCoReduction = { mount: mount };
})();

/* ============================================================
   StreetTasker — coordinator-extras.js (Stage 5D-3c-1)
   The "Extra costs" card on the coordinator booking page.
   Reads:  rpc local_booking_extras(p_booking)               can a request be made now (and why not), the room left, the list
   Writes: rpc local_booking_request_extra(...)              records the Local Tasker's confirmation and asks the customer to pay an extra cost
           rpc local_booking_cancel_extra(p_booking, p_extra) withdraws a request the customer has not paid
   This card never changes the agreed price and never moves money: the customer pays or declines in the Job Room.
   Everything from the database is set with textContent. Mounted by coordinator-booking.js: STCoExtras.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, data = null, ids = {}, busy = false;
  var KIND = { additional_cost: 'Extra work', materials: 'Materials', transport: 'Transport' };
  var STATUS = { pending: 'Waiting for the customer', processing: 'Payment in progress', paid: 'Paid', declined: 'Declined by the customer', cancelled: 'Withdrawn', failed: 'Payment failed', refunded: 'Refunded' };
  var WHY = {
    not_approved: 'The customer has not approved the quote yet. Change the quote instead of adding an extra cost.',
    one_waiting: 'An earlier extra cost is still waiting for the customer.',
    dispute_open: 'A problem report is open, so nothing else can be done until support has decided it.',
    booking_closed: 'This booking is closed.'
  };
  var FIELDS = ['coXtKind', 'coXtAmount', 'coXtTitleIn', 'coXtDetails', 'coXtHow', 'coXtSure'];

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
  function clearErrors() { FIELDS.forEach(function (k) { fieldError(k, ''); }); $('coXtError').hidden = true; }
  function showError(msg) { $('coXtErrorText').textContent = msg; $('coXtError').hidden = false; }

  function render() {
    var card = $('coXt');
    var items = (data && data.items) || [];
    if (!data || (!data.can_request && !items.length && data.blocked !== 'one_waiting')) { card.hidden = true; return; }
    card.hidden = false;
    clearErrors();
    var list = $('coXtList'); list.textContent = '';
    items.forEach(function (x) {
      var li = C.el('li', 'co-bk-event');
      li.appendChild(C.el('span', 'co-bk-event-text', (KIND[x.kind] || '') + ': ' + x.title + ' · ' + naira(x.amount)));
      li.appendChild(C.el('span', 'co-consent-meta', (STATUS[x.status] || '') + ' · ' + B.dateTime(x.created_at)));
      if (x.can_cancel) {
        var b = C.el('button', 'btn btn-outline btn-sm', 'Withdraw'); b.type = 'button'; b.disabled = busy;
        b.addEventListener('click', function () { withdraw(x.id); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    $('coXtForm').hidden = !data.can_request;
    var lead = data.can_request ? 'If the Local Tasker needs more money for the job (more work, materials or transport), record it here. The customer is asked to pay it and can decline.'
                                : (WHY[data.blocked] || '');
    $('coXtLead').textContent = lead; $('coXtLead').hidden = !lead;
    $('coXtAmountHelp').textContent = 'Whole naira, 100 or more. You can still add up to ' + naira(data.room) + ' on this booking (the quote total is the limit).';
    $('coXtSubmit').disabled = busy;
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'not_approved') return 'The customer has not approved the quote yet. We have reloaded the card.';
    if (hint === 'one_waiting') return 'An earlier extra cost is still waiting for the customer. We have reloaded the card.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking. We have reloaded the card.';
    if (hint === 'booking_closed') return 'This booking is already closed. We have reloaded the card.';
    if (hint === 'over_limit') return msg || 'That is more than is still allowed on this booking.';
    if (hint === 'not_pending') return 'The customer has already paid or started paying this, so it can’t be withdrawn. We have reloaded the card.';
    if (hint === 'bad_input') return msg || 'That could not be saved.';
    return 'We couldn’t do that just now. Check your connection and try again. Nothing was changed.';
  }
  var RELOAD = { not_approved: 1, one_waiting: 1, dispute_open: 1, booking_closed: 1, not_pending: 1, over_limit: 1 };

  async function load() {
    var res = await window.supabase.rpc('local_booking_extras', { p_booking: ctx.detail.booking_id });
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
    var kind = $('coXtKind').value, raw = $('coXtAmount').value.replace(/[\s,₦]/g, ''), title = $('coXtTitleIn').value.trim(),
        details = $('coXtDetails').value.trim(), how = $('coXtHow').value;
    if (!kind) { fieldError('coXtKind', 'Choose what the extra cost is for.'); $('coXtKind').focus(); return; }
    if (!/^\d+$/.test(raw) || Number(raw) < 100 || Number(raw) > 10000000) { fieldError('coXtAmount', 'Enter a whole amount from 100 to 10,000,000.'); $('coXtAmount').focus(); return; }
    var amount = Number(raw);
    if (amount > Number(data.room)) { fieldError('coXtAmount', 'That is more than the ' + naira(data.room) + ' still allowed on this booking.'); $('coXtAmount').focus(); return; }
    if (title.length < 3 || title.length > 60) { fieldError('coXtTitleIn', 'Give it a title of 3 to 60 characters.'); $('coXtTitleIn').focus(); return; }
    if (details.length < 5 || details.length > 300) { fieldError('coXtDetails', 'Add details of 5 to 300 characters.'); $('coXtDetails').focus(); return; }
    if (!how) { fieldError('coXtHow', 'Say how the Local Tasker confirmed it.'); $('coXtHow').focus(); return; }
    if (!$('coXtSure').checked) { fieldError('coXtSure', 'Tick the box to confirm.'); $('coXtSure').focus(); return; }
    var sig = [kind, amount, title, details, how].join('|');
    busy = true; $('coXtSubmit').disabled = true;
    try {
      var res = await window.supabase.rpc('local_booking_request_extra', {
        p_booking: ctx.detail.booking_id, p_request_id: idFor(sig), p_kind: kind, p_amount: amount, p_title: title, p_details: details, p_how: how });
      if (res.error) throw res.error;
      delete ids[sig];
      ['coXtKind', 'coXtAmount', 'coXtTitleIn', 'coXtDetails', 'coXtHow'].forEach(function (k) { $(k).value = ''; });
      $('coXtSure').checked = false;
      busy = false;
      await load(); render();
      ctx.reload();
    } catch (err) { await after(err, sig); }
    finally { busy = false; var b = $('coXtSubmit'); if (b) b.disabled = false; }
  }

  async function withdraw(extraId) {
    if (busy || !data) return;
    busy = true; clearErrors();
    Array.prototype.forEach.call(document.querySelectorAll('#coXtList button'), function (b) { b.disabled = true; });
    try {
      var res = await window.supabase.rpc('local_booking_cancel_extra', { p_booking: ctx.detail.booking_id, p_extra: extraId });
      if (res.error) throw res.error;
      busy = false;
      await load(); render();
      ctx.reload();
    } catch (err) { await after(err, 'withdraw'); }
    finally { busy = false; Array.prototype.forEach.call(document.querySelectorAll('#coXtList button'), function (b) { b.disabled = false; }); }
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    if (!detail || !detail.booking_id) { data = null; $('coXt').hidden = true; return; }
    try { await load(); render(); }
    catch (err) { $('coXt').hidden = false; $('coXtForm').hidden = true; $('coXtLead').textContent = ''; showError('We couldn’t load this card. Reload the page to try again.'); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coXtForm'); if (f) f.addEventListener('submit', submit);
  });
  window.STCoExtras = { mount: mount };
})();

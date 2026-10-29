/* ============================================================
   StreetTasker — coordinator-closeout.js (Stage 5D-3b)
   The "Cancel or report a problem" card on the coordinator booking page.
   Reads:  rpc local_booking_closeout(p_booking)             what can be done now (and why not), the cancellation, the reports opened here
   Writes: rpc local_booking_cancel(...)                     cancels a booking nothing was paid for (same effects as the customer's cancel)
           rpc local_booking_open_problem(...)               opens a real problem report for the Local Tasker, who cannot sign in
           rpc local_booking_withdraw_problem(...)           withdraws a report opened here, while support has not started on it
   This card never touches a payment, the release code or the payout. Cancelling is refused by the database when money is held;
   then the only way is a problem report, which pauses the booking until support decides. Everything from the database is set
   with textContent. Mounted by coordinator-booking.js after it renders: STCoCloseout.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, data = null, ids = {}, busy = false;
  var REASON = {
    customer_asked: 'The customer asked to cancel', customer_unreachable: 'The customer could not be reached',
    tasker_unavailable: 'The Local Tasker is not available', tasker_no_show: 'The Local Tasker did not come', other: 'Something else'
  };
  var CATEGORY = {
    not_done: 'The work was not done', poor_quality: 'The work was poor quality', no_show: 'Someone did not turn up',
    wrong_amount: 'The amount is wrong', payment_issue: 'A payment problem', other: 'Something else'
  };
  var STATUS = { open: 'Waiting for support', under_review: 'Support is reviewing it', resolved: 'Decided by support', withdrawn: 'Withdrawn' };
  var WHY_CANCEL = {
    money_held: 'Money is already held or paid, so it can’t be cancelled here. Report a problem and support will settle it.',
    payment_started: 'A payment has just started. Wait a few minutes, then try again.',
    dispute_open: 'A problem report is open, so nothing else can be done until support has decided it.',
    wrong_status: 'It can’t be cancelled while the job is waiting for confirmation.',
    booking_closed: 'This booking is closed.'
  };
  var WHY_REPORT = {
    dispute_open: 'A problem report is already open.',
    too_many: 'Three reports were opened in the last 24 hours. Wait before opening another.',
    booking_closed: 'This booking is closed.'
  };

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function idFor(sig) { if (!ids[sig]) ids[sig] = newId(); return ids[sig]; }      /* the same id for the same request until it succeeds: a retry never doubles */
  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function clearErrors() { ['coCoKind', 'coCoReason', 'coCoNote', 'coCoSure', 'coCoCategory', 'coCoDesc'].forEach(function (k) { fieldError(k, ''); }); $('coCoError').hidden = true; }
  function showError(msg) { $('coCoErrorText').textContent = msg; $('coCoError').hidden = false; }
  function picked() { var r = document.querySelector('input[name="coCoKind"]:checked'); return r ? r.value : ''; }

  function render() {
    var card = $('coCo');
    var probs = (data && data.problems) || [];
    if (!data || (!data.can_cancel && !data.can_report && !data.cancellation && !probs.length)) { card.hidden = true; return; }
    card.hidden = false;
    clearErrors();

    var cx = $('coCoCancelled');
    if (data.cancellation) {
      cx.textContent = 'Cancelled: ' + (REASON[data.cancellation.reason] || '') + (data.cancellation.note ? ' · ' + data.cancellation.note : '') + ' · ' + B.dateTime(data.cancellation.at);
      cx.hidden = false;
    } else { cx.textContent = ''; cx.hidden = true; }

    var list = $('coCoList'); list.textContent = '';
    probs.forEach(function (p) {
      var li = C.el('li', 'co-bk-event');
      li.appendChild(C.el('span', 'co-bk-event-text', 'Problem reported: ' + (CATEGORY[p.category] || '')));
      li.appendChild(C.el('span', 'co-consent-meta', (STATUS[p.status] || '') + ' · ' + B.dateTime(p.opened_at)));
      if (p.can_withdraw) {
        var b = C.el('button', 'btn btn-outline btn-sm', 'Withdraw this report'); b.type = 'button'; b.disabled = busy;
        b.setAttribute('data-withdraw', p.dispute_id);
        b.addEventListener('click', function () { withdraw(p.dispute_id); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });

    var c = $('coCoCancel'), r = $('coCoReport');
    c.disabled = !data.can_cancel || busy; r.disabled = !data.can_report || busy;
    [['coCoCancelWhy', data.can_cancel, data.cancel_blocked, WHY_CANCEL], ['coCoReportWhy', data.can_report, data.report_blocked, WHY_REPORT]].forEach(function (a) {
      var el = $(a[0]), txt = a[3][a[2]];
      /* a closed booking only needs saying once, under the first choice */
      el.textContent = a[1] ? '' : (txt || ''); el.hidden = !!a[1] || !txt;
    });
    if (picked() === 'cancel' && c.disabled) c.checked = false;
    if (picked() === 'report' && r.disabled) r.checked = false;

    var any = data.can_cancel || data.can_report;
    $('coCoForm').hidden = !any;
    var lead = '';
    if (any && data.can_cancel) lead = 'If this booking will not go ahead and nothing has been paid, cancel it. If something went wrong, report a problem for the Local Tasker and support will decide.';
    else if (any) lead = 'Money is already held or paid, so this booking can’t be cancelled here. If something went wrong, report a problem and support will settle it.';
    else if (probs.some(function (p) { return p.status === 'open' || p.status === 'under_review'; })) lead = 'A problem report is open on this booking. Payments are paused until support has decided it.';
    $('coCoLead').textContent = lead; $('coCoLead').hidden = !lead;
    switchFields();
    $('coCoSubmit').disabled = busy;
  }

  function switchFields() {
    var k = picked();
    $('coCoCancelFields').hidden = k !== 'cancel';
    $('coCoReportFields').hidden = k !== 'report';
    $('coCoSubmit').textContent = k === 'cancel' ? 'Cancel this booking' : k === 'report' ? 'Open a problem report' : 'Continue';
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'money_held') return 'Money is already held or paid for this booking, so it can’t be cancelled here. Report a problem instead. We have reloaded the card.';
    if (hint === 'payment_started') return 'A payment has just started. Wait a few minutes and try again.';
    if (hint === 'dispute_open') return 'A problem report is already open on this booking. We have reloaded the card.';
    if (hint === 'booking_closed') return 'This booking is already closed. We have reloaded the card.';
    if (hint === 'wrong_status') return 'This booking can’t be cancelled right now. We have reloaded the card.';
    if (hint === 'too_many') return 'Three reports were already opened in the last 24 hours. Wait before opening another.';
    if (hint === 'not_open') return 'Support has already started on this report, so it can’t be withdrawn. We have reloaded the card.';
    if (hint === 'bad_input') return msg || 'That could not be saved.';
    return 'We couldn’t do that just now. Check your connection and try again. Nothing was changed.';
  }
  var RELOAD = { money_held: 1, payment_started: 1, dispute_open: 1, booking_closed: 1, wrong_status: 1, too_many: 1, not_open: 1 };

  async function load() {
    var res = await window.supabase.rpc('local_booking_closeout', { p_booking: ctx.detail.booking_id });
    if (res.error) throw res.error;
    data = res.data;
  }
  async function after(err, sig) {
    var h = err && err.hint;
    if (RELOAD[h]) {
      delete ids[sig]; busy = false;
      try { await load(); render(); } catch (e2) { /* keep the message below */ }
    }
    showError(messageFor(err));
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !data) return;
    clearErrors();
    var kind = picked();
    if (!kind) { fieldError('coCoKind', 'Choose what you want to do.'); $('coCoCancel').focus(); return; }
    var args, fn, sig;
    if (kind === 'cancel') {
      var reason = $('coCoReason').value, note = $('coCoNote').value.trim();
      if (!reason) { fieldError('coCoReason', 'Choose a reason.'); $('coCoReason').focus(); return; }
      if (note.length > 300) { fieldError('coCoNote', 'Keep this to 300 characters.'); $('coCoNote').focus(); return; }
      if (reason === 'other' && note.length < 3) { fieldError('coCoNote', 'Say what the reason is.'); $('coCoNote').focus(); return; }
      if (!$('coCoSure').checked) { fieldError('coCoSure', 'Tick the box to confirm.'); $('coCoSure').focus(); return; }
      sig = 'cancel|' + reason + '|' + note;
      fn = 'local_booking_cancel';
      args = { p_booking: ctx.detail.booking_id, p_request_id: idFor(sig), p_reason: reason, p_note: note || null };
    } else {
      var cat = $('coCoCategory').value, desc = $('coCoDesc').value.trim();
      if (!cat) { fieldError('coCoCategory', 'Choose what the problem is about.'); $('coCoCategory').focus(); return; }
      if (desc.length < 10) { fieldError('coCoDesc', 'Describe the problem in at least 10 characters.'); $('coCoDesc').focus(); return; }
      if (desc.length > 1000) { fieldError('coCoDesc', 'Keep this to 1000 characters.'); $('coCoDesc').focus(); return; }
      sig = 'report|' + cat + '|' + desc;
      fn = 'local_booking_open_problem';
      args = { p_booking: ctx.detail.booking_id, p_request_id: idFor(sig), p_category: cat, p_reason: desc };
    }
    busy = true; $('coCoSubmit').disabled = true;
    try {
      var res = await window.supabase.rpc(fn, args);
      if (res.error) throw res.error;
      delete ids[sig];
      ['coCoReason', 'coCoNote', 'coCoCategory', 'coCoDesc'].forEach(function (k) { $(k).value = ''; });
      $('coCoSure').checked = false;
      var chk = document.querySelector('input[name="coCoKind"]:checked'); if (chk) chk.checked = false;
      busy = false;
      await load(); render();
      ctx.reload();
    } catch (err) { await after(err, sig); }
    finally { busy = false; var b = $('coCoSubmit'); if (b) b.disabled = false; }
  }

  async function withdraw(disputeId) {
    if (busy || !data) return;
    busy = true; clearErrors();
    Array.prototype.forEach.call(document.querySelectorAll('#coCoList button'), function (b) { b.disabled = true; });
    try {
      var res = await window.supabase.rpc('local_booking_withdraw_problem', { p_booking: ctx.detail.booking_id, p_dispute: disputeId });
      if (res.error) throw res.error;
      busy = false;
      await load(); render();
      ctx.reload();
    } catch (err) { await after(err, 'withdraw'); }
    finally { busy = false; Array.prototype.forEach.call(document.querySelectorAll('#coCoList button'), function (b) { b.disabled = false; }); }
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    if (!detail || !detail.booking_id) { data = null; $('coCo').hidden = true; return; }
    try { await load(); render(); }
    catch (err) { $('coCo').hidden = false; $('coCoForm').hidden = true; $('coCoLead').textContent = ''; showError('We couldn’t load this card. Reload the page to try again.'); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coCoForm');
    if (f) { f.addEventListener('submit', submit); f.addEventListener('change', function (ev) { if (ev.target && ev.target.name === 'coCoKind') switchFields(); }); }
  });
  window.STCoCloseout = { mount: mount };
})();

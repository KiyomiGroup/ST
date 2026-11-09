/* ============================================================
   StreetTasker — coordinator-payout-status.js (Stage B4)
   The "Payout to the Local Tasker" card on the coordinator booking page. After the release code is accepted the payout
   waits 24 hours, then StreetTasker sends it to the Local Tasker's bank account. This card shows the countdown and the state.
   Reads:  rpc local_booking_payout_state(p_booking)  { has_payout, phase, amount, release_after, seconds_left, paid_at, reason }
           phase = waiting | due | processing | paid | failed | review | reversed; commission = null | { phase: pending | credited, amount }
   Writes nothing, touches no money. All text from the database is set with textContent. The countdown is worked out from
   the server's seconds_left, not from this device's clock, so a wrong phone clock cannot change it.
   Mounted by coordinator-booking.js: STCoPayoutStatus.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var ctx = null, data = null, timer = null, loadedAt = 0;
  function $(id) { return document.getElementById(id); }

  var LEAD = {
    due: 'The 24 hour wait is over. StreetTasker will send the payout to the Local Tasker’s bank account next.',
    processing: 'The payout has been sent to the bank and is being confirmed. This can take a little while.',
    paid: 'The payout has been paid to the Local Tasker’s bank account. You do not need to do anything. Tell the Local Tasker it is on its way.',
    failed: 'The bank transfer did not go through. StreetTasker support has been shown this and will retry it. You do not need to do anything.',
    review: 'This payout is on hold while StreetTasker checks it. Contact StreetTasker support if the Local Tasker asks about it.',
    reversed: 'The bank sent this payout back. StreetTasker support will decide what happens next. Contact support if the Local Tasker asks about it.'
  };
  var NO_ACCOUNT = 'There is no verified bank account for this Local Tasker, so the payout is on hold. Register the account on the Local Tasker’s payout page, then contact StreetTasker support to release it.';

  function naira(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return '\u20A6' + v.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  }
  function left(seconds) {
    var s = Math.max(0, Math.floor(seconds));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h >= 1) return h + (h === 1 ? ' hour ' : ' hours ') + m + (m === 1 ? ' minute' : ' minutes');
    if (m >= 1) return m + (m === 1 ? ' minute' : ' minutes');
    return 'less than a minute';
  }

  function render() {
    var card = $('coPo');
    if (!card) return;
    if (!data || data.has_payout !== true) { card.hidden = true; return; }
    card.hidden = false;
    var phase = data.phase, lead = '', count = '';
    if (phase === 'waiting') {
      var remaining = (typeof data.seconds_left === 'number' ? data.seconds_left : 0) - Math.floor((Date.now() - loadedAt) / 1000);
      if (remaining <= 0) { phase = 'due'; lead = LEAD.due; }
      else {
        lead = 'The payout of ' + naira(data.amount) + ' is sent to the Local Tasker’s bank account 24 hours after the release code. Nothing is needed from you.';
        count = 'Time left: ' + left(remaining);
      }
    } else if (phase === 'review' && data.reason === 'no_verified_account') {
      lead = NO_ACCOUNT;
    } else {
      lead = LEAD[phase] || '';
    }
    $('coPoLead').textContent = lead; $('coPoLead').hidden = !lead;
    $('coPoCount').textContent = count; $('coPoCount').hidden = !count;
    /* Stage B4b: the coordinator's own commission is held for the same 24 hours */
    var cm = data.commission, comm = '';
    if (cm && cm.phase === 'pending') comm = 'Your commission of ' + naira(cm.amount) + ' is added to your wallet 24 hours after the release code, at the same time as the payout.';
    else if (cm && cm.phase === 'credited') comm = 'Your commission of ' + naira(cm.amount) + ' has been added to your wallet.';
    $('coPoComm').textContent = comm; $('coPoComm').hidden = !comm;
  }

  async function load() {
    var res = await window.supabase.rpc('local_booking_payout_state', { p_booking: ctx.detail.booking_id });
    if (res.error) throw res.error;
    data = res.data; loadedAt = Date.now();
  }

  function tick() { if (data && data.phase === 'waiting') render(); }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: opts && opts.reload };
    if (timer) { clearInterval(timer); timer = null; }
    var card = $('coPo');
    if (!card) return;
    /* only a booking that is paid and closed can have a payout: skip the call otherwise */
    if (!detail || (detail.payment_status !== 'released')) { data = null; card.hidden = true; return; }
    try { await load(); render(); } catch (e) { data = null; card.hidden = true; return; }
    timer = setInterval(tick, 30000);
  }

  window.STCoPayoutStatus = { mount: mount };
})();

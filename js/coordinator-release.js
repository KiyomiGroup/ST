/* ============================================================
   StreetTasker — coordinator-release.js (Stage 7C-1c)
   The "Release the payment" card on the coordinator booking page: the coordinator types the 6-digit release code the
   customer gave them, for the Local Tasker (who cannot sign in).
   Reads:  rpc local_booking_code_state(p_booking)      { state, remaining }  state = ready | not_paid | frozen | locked | released | closed | consent_revoked
   Writes: rpc local_booking_submit_code(p_booking, p_code) the ONE release path (7C-1b). A wrong code comes back as a result, not an error,
           because the database counts it. This card never reads, stores or shows the real code, and never touches money, payouts or wallets.
   The typed code is cleared after every send and is never written to storage, the address bar or the console.
   Only a code of exactly 6 digits is sent, so a typo can't use up one of the three attempts.
   Everything from the database is set with textContent. Mounted by coordinator-booking.js: STCoRelease.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var ctx = null, data = null, busy = false;
  function $(id) { return document.getElementById(id); }

  var LEAD = {
    ready: 'When the job is finished and the customer is happy with it, ask them for their release code and enter it here. Entering it releases the payment to the Local Tasker.',
    locked: 'This booking is locked because three wrong codes were entered. Contact StreetTasker support. An administrator can unlock it once they have checked with the customer.',
    frozen: 'A problem report is open on this booking, so the payment can’t be released now. Support will decide, and then this card will work again if the booking goes ahead.',
    consent_revoked: 'This Local Tasker has withdrawn their consent, so the payment can’t be released here. Contact StreetTasker support.'
  };
  var DONE = 'The payment has been released. StreetTasker pays it to the Local Tasker’s bank account. This can take a little while, and you don’t need to do anything.';

  function fieldError(msg) {
    var e = $('coRlCodeErr'); e.textContent = msg || ''; e.hidden = !msg;
    $('coRlCode').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function showError(msg) { $('coRlErrorText').textContent = msg; $('coRlError').hidden = false; }
  function clearMessages() { fieldError(''); $('coRlError').hidden = true; }

  function attemptsText(n) {
    if (n >= 3) return '';
    if (n === 1) return 'Last attempt. Check the digits with the customer before you try again.';
    return n + ' attempts left.';
  }

  function render() {
    var card = $('coRl');
    var st = data && data.state;
    /* nothing to do (not paid yet, or the booking is closed): the card stays out of the way */
    if (!st || st === 'not_paid' || st === 'closed') { card.hidden = true; return; }
    card.hidden = false;

    var ready = st === 'ready';
    $('coRlForm').hidden = !ready;
    $('coRlSubmit').disabled = busy;
    $('coRlCode').disabled = busy;
    var lead = LEAD[st] || '';
    $('coRlLead').textContent = lead; $('coRlLead').hidden = !lead;
    $('coRlDone').hidden = st !== 'released';
    $('coRlDoneText').textContent = st === 'released' ? DONE : '';
    $('coRlFoot').hidden = st === 'released';
    var left = typeof data.remaining === 'number' ? data.remaining : 3;
    var at = ready ? attemptsText(left) : '';
    $('coRlAttempts').textContent = at; $('coRlAttempts').hidden = !at;
  }

  async function load() {
    var res = await window.supabase.rpc('local_booking_code_state', { p_booking: ctx.detail.booking_id });
    if (res.error) throw res.error;
    data = res.data;
  }

  /* After anything unexpected, ask the database what is true now and show that (never guess). */
  async function refresh() {
    try { await load(); render(); return true; } catch (e) { return false; }
  }

  function wrongMessage(remaining) {
    if (remaining <= 0) return 'Incorrect code. No attempts are left. Contact StreetTasker support.';
    if (remaining === 1) return 'Incorrect code. 1 attempt left.';
    return 'Incorrect code. ' + remaining + ' attempts left.';
  }
  var REASON_TEXT = {
    not_paid: 'Payment has not been made for this booking yet.',
    already_released: 'The payment has already been released.',
    already_completed: 'This booking is already completed.',
    frozen: 'A problem report is open on this booking, so the payment can’t be released now.',
    locked: 'Too many incorrect codes. Contact StreetTasker support.',
    consent_revoked: 'This Local Tasker has withdrawn consent. Contact StreetTasker support.'
  };

  async function submit(e) {
    e.preventDefault();
    if (busy || !data || data.state !== 'ready') return;
    clearMessages();
    var input = $('coRlCode');
    var code = input.value.replace(/\s+/g, '');
    if (!/^[0-9]{6}$/.test(code)) {
      fieldError('Enter the 6 digits of the code. Nothing was sent.');
      input.focus(); return;
    }
    busy = true; render();
    var res = null, err = null;
    try {
      res = await window.supabase.rpc('local_booking_submit_code', { p_booking: ctx.detail.booking_id, p_code: code });
      if (res.error) err = res.error;
    } catch (ex) { err = ex || { message: 'network' }; }
    code = null; input.value = '';                 /* the typed code never stays on the page */
    busy = false;

    if (err) {
      var hint = err.hint, msg = err.message || '';
      if (hint === 'not_found' || /not found/i.test(msg)) {
        showError('This booking is no longer yours, or it can’t be found.');
        $('coRl').hidden = false; $('coRlForm').hidden = true; return;
      }
      /* We can't tell whether the call arrived. Ask the database instead of guessing. */
      var ok = await refresh();
      showError(ok ? 'We couldn’t confirm that. The card now shows the real state, so check it before you try again. Nothing was entered twice.'
                   : 'We couldn’t reach StreetTasker. Check your connection and reload the page before you try again.');
      if (!ok) render();
      return;
    }
    var out = res.data || {};
    if (out.ok === true) {
      data = { state: 'released', remaining: 0 };
      render();
      if (ctx.reload) ctx.reload();
      return;
    }
    if (out.reason === 'wrong_code') {
      var r = typeof out.remaining === 'number' ? out.remaining : 0;
      data = { state: r > 0 ? 'ready' : 'locked', remaining: r };
      render();
      showError(wrongMessage(r));
      input.setAttribute('aria-invalid', 'true');
      if (r > 0) input.focus();
      return;
    }
    /* any other refusal: show the reason, then the true state */
    await refresh();
    showError(REASON_TEXT[out.reason] || 'The payment could not be released. Nothing was changed.');
  }

  function digitsOnly() {
    var i = $('coRlCode'), v = i.value.replace(/[^0-9]/g, '').slice(0, 6);
    if (v !== i.value) i.value = v;
    if ($('coRlCodeErr').hidden === false) fieldError('');
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    if (!detail || !detail.booking_id) { data = null; $('coRl').hidden = true; return; }
    $('coRlError').hidden = true;
    try { await load(); render(); }
    catch (err) {
      /* the database function isn't installed yet (site updated before the SQL): stay out of the way, never offer the field */
      if (err && (err.code === 'PGRST202' || err.code === '42883')) { data = null; $('coRl').hidden = true; return; }
      /* any other failed read must never offer the field: say so and stop */
      data = null; $('coRl').hidden = false; $('coRlForm').hidden = true; $('coRlDone').hidden = true;
      $('coRlLead').textContent = ''; $('coRlLead').hidden = true;
      showError('We couldn’t load this card. Reload the page to try again.');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coRlForm');
    if (f) f.addEventListener('submit', submit);
    var i = $('coRlCode');
    if (i) i.addEventListener('input', digitsOnly);
  });
  window.STCoRelease = { mount: mount };
})();

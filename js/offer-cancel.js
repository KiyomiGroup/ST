/* ============================================================
   STREETTASKER — offer-cancel.js   (stage M5)
   The customer's "Cancel accepted offer" dialog, shared by customer-applications.html and my-tasks.html.
   It only calls the database function cancel_accepted_offer(p_application, p_reason) (stage M3). The database
   decides whether the cancel is allowed (task owner only, before payment only) and says why not in plain words.
   Uses the existing .ap-dialog / .ap-btn classes from css/applications.css. No new styles, no inline style.

   STOfferCancel.open({ applicationId, taskerName, taskTitle, onDone })
     onDone(result) runs after a successful cancel (result.changed is false on a harmless retry).
   STOfferCancel.canCancel(booking)  true while nothing is paid for the job (the database re-checks).
   ============================================================ */
(function () {
  'use strict';

  var REASON_MAX = 300;
  var dlg = null, els = null, ctx = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build() {
    dlg = el('dialog', 'ap-dialog');
    dlg.setAttribute('aria-labelledby', 'ocTitle');
    var body = el('div', 'ap-dialog-body');
    var title = el('h2', 'ap-dialog-title', 'Cancel this accepted offer?'); title.id = 'ocTitle';
    var intro = el('p', 'ap-state-text');
    var list = el('p', 'ap-state-text', 'The chat closes, the tasker is told, and your task opens again for offers. This tasker cannot send another offer on this task.');
    var field = el('label', 'ap-field');
    field.appendChild(el('span', null, 'Reason (optional)'));
    var reason = el('textarea', 'ap-input ap-input-plain ap-textarea');
    reason.rows = 3; reason.maxLength = REASON_MAX; reason.id = 'ocReason';
    reason.setAttribute('aria-describedby', 'ocCount');
    field.appendChild(reason);
    var count = el('span', 'ap-state-text', '0 / ' + REASON_MAX); count.id = 'ocCount';
    var err = el('p', 'ap-error'); err.id = 'ocError'; err.setAttribute('role', 'alert'); err.hidden = true;
    var actions = el('div', 'ap-actions ap-dialog-actions');
    var keep = el('button', 'ap-btn', 'Keep Offer'); keep.type = 'button';
    var go = el('button', 'ap-btn ap-btn-danger', 'Cancel Offer'); go.type = 'button';
    actions.appendChild(keep); actions.appendChild(go);
    [title, intro, list, field, count, err, actions].forEach(function (n) { body.appendChild(n); });
    dlg.appendChild(body);
    document.body.appendChild(dlg);

    els = { intro: intro, reason: reason, count: count, err: err, go: go, keep: keep };
    dlg.addEventListener('click', function (e) { if (e.target === dlg && !els.go.disabled) dlg.close(); });
    keep.addEventListener('click', function () { dlg.close(); });
    reason.addEventListener('input', function () { count.textContent = reason.value.length + ' / ' + REASON_MAX; });
    go.addEventListener('click', run);
  }

  /* The database sends plain sentences. Only the "function missing" case needs our own words. */
  function friendly(error) {
    var msg = String((error && error.message) || '');
    if (error && (error.code === 'PGRST202' || /could not find the function|does not exist/i.test(msg))) {
      return 'Cancelling an accepted offer is not available yet. Please try again later.';
    }
    return msg || 'Could not cancel this offer. Please try again.';
  }

  async function run() {
    if (!ctx) return;
    var reason = els.reason.value.trim();
    els.err.hidden = true; els.go.disabled = true; els.keep.disabled = true;
    els.go.textContent = 'Cancelling…';
    try {
      var res = await window.supabase.rpc('cancel_accepted_offer', { p_application: String(ctx.applicationId), p_reason: reason || null });
      if (res.error) throw res.error;
      var done = ctx.onDone, out = res.data || {};
      dlg.close(); ctx = null;
      if (done) done(out);
    } catch (e) {
      els.err.textContent = friendly(e); els.err.hidden = false;
    }
    els.go.disabled = false; els.keep.disabled = false; els.go.textContent = 'Cancel Offer';
  }

  function open(opts) {
    if (!dlg) build();
    ctx = opts || {};
    els.intro.textContent = (ctx.taskerName ? ctx.taskerName : 'This tasker') + (ctx.taskTitle ? ' was hired for “' + ctx.taskTitle + '”.' : ' was hired for your task.') +
      ' You can cancel only before you pay. After payment, use Report a problem in the chat.';
    els.reason.value = ''; els.count.textContent = '0 / ' + REASON_MAX; els.err.hidden = true;
    dlg.showModal();
  }

  /* Money rule shown in the page: no booking yet, or a booking with nothing paid, can be cancelled here. */
  function canCancel(booking) {
    if (!booking) return true;
    var st = String(booking.status || ''), pay = String(booking.payment_status || 'unpaid');
    if (st === 'cancelled' || st === 'completed' || st === 'disputed') return false;
    return pay === 'unpaid' || pay === '';
  }

  window.STOfferCancel = { open: open, canCancel: canCancel };
})();

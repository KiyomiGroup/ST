/* ============================================================
   StreetTasker — coordinator-milestones.js (Stage 5D-2)
   The "On the day" card on the coordinator booking page.
   Reads:  rpc local_booking_milestones(p_booking)         what is recorded, what comes next, and whether it can be recorded now
   Writes: rpc local_booking_record_milestone(...)         the ONLY way to record a step (address confirmed, arrived, started, finished)
   A step is a RECORD of what the Local Tasker said on the phone. It never changes a payment, the booking status or the release
   code, and "finished" does not mark the job done. Everything from the database is set with textContent.
   Mounted by coordinator-booking.js after it renders: STCoMilestones.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, data = null, ids = {}, busy = false;
  var NAME = { address_confirmed: 'Address confirmed', arrived: 'Arrived', started: 'Work started', finished: 'Work finished' };
  var ASK = {
    address_confirmed: 'Record this once the Local Tasker has confirmed the address with you.',
    arrived: 'Record this once the Local Tasker has told you they have arrived.',
    started: 'Record this once the Local Tasker has told you the work has begun.',
    finished: 'Record this once the Local Tasker has told you the work is finished.'
  };
  var BUTTON = { address_confirmed: 'Record: address confirmed', arrived: 'Record: arrived', started: 'Record: work started', finished: 'Record: work finished' };
  var BLOCK = {
    not_approved: 'The customer has not approved the quote yet.',
    payment_needed: 'The customer has not paid yet, so the work cannot be marked as started.',
    dispute_open: 'A problem report is open on this booking. Nothing can be recorded right now.',
    booking_closed: 'This booking is closed.',
    all_recorded: 'All four steps are recorded. The job is finished from your side; the customer’s release code and the payout come next.'
  };

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function showError(msg) { $('coMsErrorText').textContent = msg; $('coMsError').hidden = false; }
  function nowLocalInput() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16);
  }

  function render() {
    var card = $('coMs');
    if (!data || (data.lt_status !== 'quote_approved' && !(data.items || []).length)) { card.hidden = true; return; }
    card.hidden = false;
    $('coMsError').hidden = true;
    var list = $('coMsList'); list.textContent = '';
    (data.items || []).forEach(function (x) {
      var li = C.el('li', 'co-bk-event');
      li.appendChild(C.el('span', 'co-bk-event-text', NAME[x.kind] || ''));
      li.appendChild(C.el('span', 'co-consent-meta', B.dateTime(x.happened_at) + (x.note ? ' · ' + x.note : '')));
      list.appendChild(li);
    });
    var form = $('coMsForm'), lead = $('coMsLead');
    if (data.can_record && data.next_kind) {
      lead.textContent = ASK[data.next_kind];
      form.hidden = false;
      $('coMsSubmit').textContent = BUTTON[data.next_kind];
      $('coMsSubmit').disabled = busy;
      if (!$('coMsWhen').value) $('coMsWhen').value = nowLocalInput();
    } else {
      form.hidden = true;
      lead.textContent = BLOCK[data.blocked_reason] || '';
    }
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'booking_closed') return 'This booking is closed, so nothing can be recorded.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so nothing can be recorded right now.';
    if (hint === 'not_approved') return 'The customer has not approved the quote yet.';
    if (hint === 'payment_needed') return 'The customer has not paid yet, so the work cannot be marked as started.';
    if (hint === 'already_recorded' || hint === 'out_of_order') return 'That step has changed since you opened the page. We have reloaded it.';
    if (hint === 'bad_time' || hint === 'bad_input') return msg || 'That could not be recorded.';
    return 'We couldn’t record that just now. Check your connection and try again. Nothing was recorded.';
  }

  async function load() {
    var res = await window.supabase.rpc('local_booking_milestones', { p_booking: ctx.detail.booking_id });
    if (res.error) throw res.error;
    data = res.data;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !data || !data.next_kind) return;
    fieldError('coMsWhen', ''); fieldError('coMsNote', ''); $('coMsError').hidden = true;
    var raw = $('coMsWhen').value, at = raw ? new Date(raw) : null;
    if (!at || isNaN(at.getTime())) { fieldError('coMsWhen', 'Enter when it happened.'); $('coMsWhen').focus(); return; }
    if (at.getTime() > Date.now() + 5 * 60000) { fieldError('coMsWhen', 'The time can’t be in the future.'); $('coMsWhen').focus(); return; }
    var note = $('coMsNote').value.trim();
    if (note.length > 300) { fieldError('coMsNote', 'Keep this to 300 characters.'); $('coMsNote').focus(); return; }
    var kind = data.next_kind;
    if (!ids[kind]) ids[kind] = newId();            /* the same id until it succeeds, so a retry never records twice */
    busy = true; $('coMsSubmit').disabled = true;
    try {
      var res = await window.supabase.rpc('local_booking_record_milestone', {
        p_booking: ctx.detail.booking_id, p_request_id: ids[kind], p_kind: kind, p_happened_at: at.toISOString(), p_note: note || null
      });
      if (res.error) throw res.error;
      delete ids[kind]; $('coMsWhen').value = ''; $('coMsNote').value = '';
      await load(); render();
      ctx.reload();
    } catch (err) {
      var h = err && err.hint;
      if (h === 'already_recorded' || h === 'out_of_order' || h === 'not_approved' || h === 'payment_needed' || h === 'dispute_open' || h === 'booking_closed') {
        delete ids[kind];
        try { await load(); render(); } catch (e2) { /* keep the message below */ }
      }
      showError(messageFor(err));
    } finally { busy = false; var b = $('coMsSubmit'); if (b) b.disabled = false; }
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    if (!detail || (detail.lt_status !== 'quote_approved' && detail.lt_status !== 'quote_sent' && detail.lt_status !== 'quote_declined' && detail.lt_status !== 'tasker_confirmed')) { $('coMs').hidden = true; return; }
    try { await load(); render(); }
    catch (err) { $('coMs').hidden = false; $('coMsForm').hidden = true; $('coMsLead').textContent = ''; showError('We couldn’t load this step. Reload the page to try again.'); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coMsForm'); if (f) f.addEventListener('submit', submit);
  });
  window.STCoMilestones = { mount: mount };
})();

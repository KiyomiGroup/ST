/* ============================================================
   StreetTasker — coordinator-exceptions.js (Stage 5D-3a)
   The "When something goes wrong" card on the coordinator booking page.
   Reads:  rpc local_booking_exceptions(p_booking)          what is recorded and which exception can be recorded right now
   Writes: rpc local_booking_record_exception(...)          the ONLY way to record one (customer could not be reached, Local Tasker did not come)
   An exception is a RECORD of what happened. It never changes a payment, the booking status or the release code, and it does not
   cancel the booking (cancellation and problem reports are Stage 5D-3b). Everything from the database is set with textContent.
   Mounted by coordinator-booking.js after it renders: STCoExceptions.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var ctx = null, data = null, ids = {}, busy = false;
  var NAME = { customer_unreachable: 'Customer could not be reached', tasker_no_show: 'Local Tasker did not come as agreed' };
  var WHY = {
    wrong_step: 'Not available at this step.',
    limit_reached: 'Five attempts are already recorded. Contact an administrator.',
    already_arrived: 'The Local Tasker is already recorded as arrived.',
    already_recorded: 'Already recorded for this quote.',
    dispute_open: 'A problem report is open on this booking.',
    booking_closed: 'This booking is closed.'
  };
  var BUTTON = { customer_unreachable: 'Record: customer not reached', tasker_no_show: 'Record: Local Tasker did not come' };

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function showError(msg) { $('coExErrorText').textContent = msg; $('coExError').hidden = false; }
  function nowLocalInput() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16);
  }
  function picked() { var r = document.querySelector('input[name="coExKind"]:checked'); return r ? r.value : ''; }

  function render() {
    var card = $('coEx');
    if (!data || (!(data.items || []).length && !data.can_unreachable && !data.can_no_show)) { card.hidden = true; return; }
    card.hidden = false;
    $('coExError').hidden = true;
    var list = $('coExList'); list.textContent = '';
    (data.items || []).forEach(function (x) {
      var li = C.el('li', 'co-bk-event');
      li.appendChild(C.el('span', 'co-bk-event-text', NAME[x.kind] || ''));
      li.appendChild(C.el('span', 'co-consent-meta', B.dateTime(x.happened_at) + (x.note ? ' · ' + x.note : '')));
      list.appendChild(li);
    });
    var u = $('coExUnreach'), n = $('coExNoShow');
    u.disabled = !data.can_unreachable || busy; n.disabled = !data.can_no_show || busy;
    [['coExUnreachWhy', data.can_unreachable, data.unreachable_blocked], ['coExNoShowWhy', data.can_no_show, data.no_show_blocked]].forEach(function (a) {
      var el = $(a[0]); el.textContent = a[1] ? '' : (WHY[a[2]] || ''); el.hidden = !!a[1] || !WHY[a[2]];
    });
    if (picked() === 'customer_unreachable' && u.disabled) u.checked = false;
    if (picked() === 'tasker_no_show' && n.disabled) n.checked = false;
    var any = data.can_unreachable || data.can_no_show;
    $('coExForm').hidden = !any;
    var lead = '';
    if (data.no_show_standing) lead = 'A no-show is on record. No step on the day can be recorded until the booking is sent back to the Local Tasker for a new answer.';
    else if (any) lead = 'Record it here if you could not reach the customer, or the Local Tasker did not turn up.';
    else if ((data.items || []).length) lead = 'Nothing more can be recorded here right now.';
    $('coExLead').textContent = lead;
    if (any) {
      if (!$('coExWhen').value) $('coExWhen').value = nowLocalInput();
      var k = picked(); $('coExSubmit').textContent = k ? BUTTON[k] : 'Record';
      $('coExSubmit').disabled = busy;
    }
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'This booking is no longer yours, or it can’t be found.';
    if (hint === 'booking_closed') return 'This booking is closed, so nothing can be recorded.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so nothing can be recorded right now.';
    if (hint === 'wrong_step' || hint === 'already_arrived' || hint === 'already_recorded' || hint === 'limit_reached') return 'That can’t be recorded now. We have reloaded the card.';
    if (hint === 'bad_time' || hint === 'bad_input') return msg || 'That could not be recorded.';
    return 'We couldn’t record that just now. Check your connection and try again. Nothing was recorded.';
  }

  async function load() {
    var res = await window.supabase.rpc('local_booking_exceptions', { p_booking: ctx.detail.booking_id });
    if (res.error) throw res.error;
    data = res.data;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !data) return;
    fieldError('coExKind', ''); fieldError('coExWhen', ''); fieldError('coExNote', ''); $('coExError').hidden = true;
    var kind = picked();
    if (!kind) { fieldError('coExKind', 'Choose what happened.'); $('coExUnreach').focus(); return; }
    var raw = $('coExWhen').value, at = raw ? new Date(raw) : null;
    if (!at || isNaN(at.getTime())) { fieldError('coExWhen', 'Enter when it happened.'); $('coExWhen').focus(); return; }
    if (at.getTime() > Date.now() + 5 * 60000) { fieldError('coExWhen', 'The time can’t be in the future.'); $('coExWhen').focus(); return; }
    var note = $('coExNote').value.trim();
    if (note.length > 300) { fieldError('coExNote', 'Keep this to 300 characters.'); $('coExNote').focus(); return; }
    if (!ids[kind]) ids[kind] = newId();            /* the same id until it succeeds, so a retry never records twice */
    busy = true; $('coExSubmit').disabled = true;
    try {
      var res = await window.supabase.rpc('local_booking_record_exception', {
        p_booking: ctx.detail.booking_id, p_request_id: ids[kind], p_kind: kind, p_happened_at: at.toISOString(), p_note: note || null
      });
      if (res.error) throw res.error;
      delete ids[kind]; $('coExWhen').value = ''; $('coExNote').value = '';
      var chk = document.querySelector('input[name="coExKind"]:checked'); if (chk) chk.checked = false;
      busy = false;
      await load(); render();
      ctx.reload();
    } catch (err) {
      var h = err && err.hint;
      if (h === 'wrong_step' || h === 'already_arrived' || h === 'already_recorded' || h === 'limit_reached' || h === 'dispute_open' || h === 'booking_closed') {
        delete ids[kind]; busy = false;
        try { await load(); render(); } catch (e2) { /* keep the message below */ }
      }
      showError(messageFor(err));
    } finally { busy = false; var b = $('coExSubmit'); if (b) b.disabled = false; }
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    var st = detail && detail.lt_status;
    if (!detail || (st !== 'quote_sent' && st !== 'quote_approved')) { data = null; $('coEx').hidden = true; return; }
    try { await load(); render(); }
    catch (err) { $('coEx').hidden = false; $('coExForm').hidden = true; $('coExLead').textContent = ''; showError('We couldn’t load this card. Reload the page to try again.'); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coExForm'); if (f) { f.addEventListener('submit', submit); f.addEventListener('change', function (ev) { if (ev.target && ev.target.name === 'coExKind') { var k = picked(); $('coExSubmit').textContent = k ? BUTTON[k] : 'Record'; } }); }
  });
  window.STCoExceptions = { mount: mount };
})();

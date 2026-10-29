/* ============================================================
   StreetTasker — customer-quote.js (Stage 5D-1)
   The Local Tasker quote on the customer's Bookings page (customer-bookings.html).
   Reads:  rpc local_booking_customer_quotes(p_booking)    the customer's own Local Tasker bookings that have a quote
   Writes: rpc local_booking_decide_quote(...)             approve or decline (the ONLY way); the database creates the
                                                           payment requests in the Job Room when the quote is approved.
   This file never creates, changes or pays a payment request. Paying happens in the Job Room (the existing path).
   Everything that came from the database is set through escapeHtml / textContent, never as markup.
   Used by customer-bookings.js:  STCustQuote.load(), .html(id), .hint(id), .label(id), .needsPay(id), .dueCount(), .bind(listEl, opts)
   ============================================================ */
'use strict';

(function () {
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var S = { by: {}, ms: {}, ui: {}, ids: {}, busy: {}, err: {}, opts: null };
  var naira = function (n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); };
  var icon = function (id) { return '<svg class="bk-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var REASON_MAX = 300;

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }

  /* ── data ───────────────────────────────────────────────── */
  async function load() {
    S.by = {}; S.ms = {}; S.ex = {};
    try {
      var res = await window.supabase.rpc('local_booking_customer_quotes', { p_booking: null });
      if (res.error) throw res.error;
      (res.data || []).forEach(function (q) { if (q && q.booking_id) S.by[q.booking_id] = q; });
    } catch (e) {
      /* The page still works without quotes: an ordinary booking never has one, and the Job Room is unchanged. */
      console.error('[customer quote]', e);
    }
    /* Stage 5D-2: what the coordinator recorded on the day (read only). Never blocks the page. */
    try {
      var mr = await window.supabase.rpc('local_booking_customer_milestones', { p_booking: null });
      if (mr.error) throw mr.error;
      (mr.data || []).forEach(function (m) { if (m && m.booking_id) S.ms[m.booking_id] = m.items || []; });
    } catch (e2) { console.error('[customer milestones]', e2); }
    /* Stage 5D-3a: exceptions the coordinator recorded (customer could not be reached, Local Tasker did not come). Never blocks the page. */
    try {
      var xr = await window.supabase.rpc('local_booking_customer_exceptions', { p_booking: null });
      if (xr.error) throw xr.error;
      (xr.data || []).forEach(function (m) { if (m && m.booking_id) S.ex[m.booking_id] = m.items || []; });
    } catch (e3) { console.error('[customer exceptions]', e3); }
  }
  function get(id) { return S.by[id] || null; }

  /* what is still to pay (the requests the approval created) */
  function payState(q) {
    var p = (q && q.payments) || [], open = 0, paid = 0, going = 0, dead = 0;
    p.forEach(function (x) {
      if (x.status === 'paid') paid++;
      else if (x.status === 'processing') going++;
      else if (x.status === 'declined' || x.status === 'cancelled' || x.status === 'refunded') dead++;
      else open++;
    });
    return { open: open, paid: paid, going: going, dead: dead, total: p.length };
  }
  function payOf(q, key) {
    var r = ((q && q.payments) || []).filter(function (x) { return x.key === key; })[0];
    return r ? r.status : '';
  }

  /* ── what the booking card needs to know ────────────────── */
  function due(id) { var q = get(id); return !!q && q.lt_status === 'quote_sent'; }
  function needsPay(id) {
    var q = get(id); if (!q || q.lt_status !== 'quote_approved') return false;
    var s = payState(q); return s.open > 0;
  }
  function dueCount() { return Object.keys(S.by).filter(due).length; }
  function label(id) {
    var q = get(id); if (!q) return null;
    if (q.lt_status === 'quote_sent') return { text: 'Quote to Review', tone: 'warn' };
    if (q.lt_status === 'quote_declined') return { text: 'Quote Declined', tone: 'done' };
    if (q.lt_status === 'quote_approved') {
      var s = payState(q);
      if (s.open > 0) return { text: 'Payment Needed', tone: 'warn' };
      if (s.going > 0) return { text: 'Payment Processing', tone: 'progress' };
      if (s.total > 0 && s.paid === s.total - s.dead && s.paid > 0) return { text: 'In Progress', tone: 'progress' };
    }
    return null;
  }
  function hint(id) {
    var q = get(id); if (!q) return null;
    if (q.lt_status === 'quote_sent') return { tone: 'warn', text: 'A quote is waiting for your answer. Approving it does not charge you.' };
    if (q.lt_status === 'quote_declined') return { tone: 'muted', text: 'You declined this quote. The coordinator will send a revised one, and you will see it here.' };
    if (q.lt_status === 'quote_approved') {
      var s = payState(q);
      if (s.open > 0) return { tone: 'warn', text: 'Quote approved. Pay in the job room to lock it in. The money is held safely until the work is done.' };
      if (s.going > 0) return { tone: '', text: 'Your payment is being confirmed.' };
    }
    return null;
  }

  /* ── markup ─────────────────────────────────────────────── */
  var STATUS_TEXT = { pending: 'To pay', failed: 'Payment failed, try again', processing: 'Confirming', paid: 'Paid', declined: 'Declined', cancelled: 'Cancelled', refunded: 'Refunded' };

  function lines(q, withStatus) {
    var qt = q.quote || {}, rows = (qt.lines || []).map(function (l) {
      var st = withStatus ? payOf(q, l.key) : '';
      return '<div class="bk-pay-row"><span>' + esc(l.label) + (st ? ' <span class="bk-q-state is-' + esc(st) + '">' + esc(STATUS_TEXT[st] || st) + '</span>' : '') + '</span><span>' + naira(l.amount) + '</span></div>';
    }).join('');
    return '<div class="bk-pay-sum" role="group" aria-label="Quote lines">' + rows + '<div class="bk-pay-row is-total"><span>Total</span><span>' + naira(qt.total) + '</span></div></div>';
  }

  function errBox(id) {
    var m = S.err[id];
    return m ? '<div class="bk-hint is-danger bk-q-error" role="alert">' + icon('info') + '<span>' + esc(m) + '</span></div>' : '';
  }

  function inner(id) {
    var q = get(id); if (!q) return '';
    var qt = q.quote || {}, ui = S.ui[id] || {}, busy = !!S.busy[id], head, body = '', who = esc(q.tasker_name || 'Your Local Tasker');
    var dis = busy ? ' disabled' : '';

    if (q.lt_status === 'quote_sent') {
      head = '<h3 class="bk-q-title">Quote from ' + who + '</h3><p class="bk-q-sub">Check the figures, then approve or decline. Nothing is charged when you approve.</p>';
      body = lines(q, false) + (qt.note ? '<p class="bk-q-note"><strong>Note:</strong> ' + esc(qt.note) + '</p>' : '');
      if (ui.mode === 'approve') {
        body += '<div class="bk-q-panel"><p class="bk-q-panel-text">You are approving ' + naira(qt.total) + ' in total. You will then pay each item in the job room, and the money is held safely until the work is done.</p>' +
          '<div class="bk-actions"><button type="button" class="bk-btn bk-btn-primary" data-qact="confirm-approve" data-id="' + esc(id) + '"' + dis + '>' + (busy ? 'Approving…' : 'Yes, approve') + '</button>' +
          '<button type="button" class="bk-btn bk-btn-text" data-qact="back" data-id="' + esc(id) + '"' + dis + '>Back</button></div></div>';
      } else if (ui.mode === 'decline') {
        body += '<div class="bk-q-panel"><label class="bk-q-label" for="bkqr-' + esc(id) + '">Why are you declining? (optional)</label>' +
          '<textarea class="bk-textarea" id="bkqr-' + esc(id) + '" maxlength="' + REASON_MAX + '" data-qreason="' + esc(id) + '"' + dis + '></textarea>' +
          '<p class="bk-q-help">The coordinator sees this so they can send a revised quote.</p>' +
          '<div class="bk-actions"><button type="button" class="bk-btn bk-btn-danger" data-qact="confirm-decline" data-id="' + esc(id) + '"' + dis + '>' + (busy ? 'Declining…' : 'Decline quote') + '</button>' +
          '<button type="button" class="bk-btn bk-btn-text" data-qact="back" data-id="' + esc(id) + '"' + dis + '>Back</button></div></div>';
      } else {
        body += '<div class="bk-actions"><button type="button" class="bk-btn bk-btn-primary" data-qact="approve" data-id="' + esc(id) + '">Approve quote</button>' +
          '<button type="button" class="bk-btn" data-qact="decline" data-id="' + esc(id) + '">Decline</button></div>';
      }
    } else if (q.lt_status === 'quote_approved') {
      var s = payState(q);
      head = '<h3 class="bk-q-title">Quote approved</h3><p class="bk-q-sub">' + (s.open > 0 ? 'Pay each item in the job room. They are listed there as payment requests.' : s.going > 0 ? 'Your payment is being confirmed.' : 'Everything on this quote has been paid.') + '</p>';
      body = lines(q, true);
      if (s.open > 0) body += '<div class="bk-actions"><button type="button" class="bk-btn bk-btn-primary" data-qact="room" data-id="' + esc(id) + '">' + icon('lock') + 'Pay in Job Room</button></div>';
    } else {
      var d = q.decision || {};
      head = '<h3 class="bk-q-title">You declined this quote</h3><p class="bk-q-sub">The coordinator will send a revised quote, and you will see it here. You have not been charged.</p>';
      body = lines(q, false) + (d.reason ? '<p class="bk-q-note"><strong>Your reason:</strong> ' + esc(d.reason) + '</p>' : '');
    }
    return head + body + errBox(id);
  }

  var MS_LABEL = { address_confirmed: 'Address confirmed', arrived: 'Arrived', started: 'Work started', finished: 'Work finished' };
  function when(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  /* the day-of-the-job steps the coordinator recorded; empty until the first one */
  var EX_TEXT = { customer_unreachable: 'We tried to reach you and could not', tasker_no_show: 'The Local Tasker did not arrive as agreed' };
  function progressHtml(id) {
    var items = S.ms[id] || [], ex = S.ex[id] || [];
    if (!items.length && !ex.length) return '';
    var rows = items.map(function (x) {
      return '<li class="bk-ms-item"><span class="bk-ms-name">' + esc(MS_LABEL[x.kind] || '') + '</span><span class="bk-q-help">' + esc(when(x.happened_at)) + '</span></li>';
    }).join('');
    var exRows = ex.map(function (x) {
      return '<li class="bk-ms-item bk-ms-item-alert"><span class="bk-ms-name">' + esc(EX_TEXT[x.kind] || 'Something went wrong') + '</span><span class="bk-q-help">' + esc(when(x.happened_at)) + '</span></li>';
    }).join('');
    var sub = items.length ? 'Recorded by your coordinator after speaking to the Local Tasker.' : 'Recorded by your coordinator.';
    var tail = ex.length ? '<p class="bk-q-sub">Your coordinator is following this up. This note does not change any payment.</p>' : '';
    return '<section class="bk-q bk-ms" aria-label="Progress on the day"><h3 class="bk-q-title">Progress on the day</h3>' +
      '<p class="bk-q-sub">' + sub + '</p><ul class="bk-ms-list">' + rows + exRows + '</ul>' + tail + '</section>';
  }

  function html(id) {
    if (!get(id)) return '';
    return '<section class="bk-q" data-qbox="' + esc(id) + '" aria-label="Quote">' + inner(id) + '</section>' + progressHtml(id);
  }

  function redraw(id) {
    var el = S.list && S.list.querySelector('[data-qbox="' + id + '"]');
    if (!el) return;
    var keep = S.list.querySelector('[data-qreason="' + id + '"]');
    var text = keep ? keep.value : null;
    el.innerHTML = inner(id);
    if (text != null) { var ta = S.list.querySelector('[data-qreason="' + id + '"]'); if (ta) ta.value = text; }
  }

  /* ── actions ────────────────────────────────────────────── */
  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'quote_changed') return 'The quote was updated. We are showing you the new one. Please read it before you answer.';
    if (hint === 'invalid_transition') return 'This quote has already been answered or was replaced. We have refreshed the page.';
    if (hint === 'booking_closed') return 'This booking is closed, so the quote cannot be answered.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so the quote cannot be answered right now.';
    if (hint === 'already_paid') return 'This booking already has a payment on record, so the quote cannot be approved here. Please contact support.';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'We could not find this booking. Reload the page.';
    if (hint === 'bad_input') return msg || 'That answer could not be saved.';
    return 'We could not save your answer. Nothing was changed. Check your connection and try again.';
  }

  async function answer(id, decision) {
    var q = get(id); if (!q || S.busy[id]) return;
    var ta = S.list.querySelector('[data-qreason="' + id + '"]');
    var reason = decision === 'declined' && ta ? ta.value.trim() : '';
    if (reason.length > REASON_MAX) { S.err[id] = 'Keep the reason to ' + REASON_MAX + ' characters.'; redraw(id); return; }
    var version = q.quote && q.quote.version;
    var key = id + ':' + version + ':' + decision;
    if (!S.ids[key]) S.ids[key] = newId();        /* the same id until it succeeds, so a retry never answers twice */
    S.busy[id] = true; S.err[id] = ''; redraw(id);
    var changed = false;
    try {
      var res = await window.supabase.rpc('local_booking_decide_quote', {
        p_booking: id, p_version: version, p_request_id: S.ids[key], p_decision: decision, p_reason: reason || null
      });
      if (res.error) throw res.error;
      delete S.ids[key]; S.ui[id] = {}; changed = true;
    } catch (e) {
      console.error('[customer quote]', e);
      S.err[id] = messageFor(e);
      var h = e && e.hint;
      if (h === 'quote_changed' || h === 'invalid_transition' || h === 'booking_closed' || h === 'dispute_open') { delete S.ids[key]; S.ui[id] = {}; changed = true; }
    }
    S.busy[id] = false;
    if (changed && S.opts && S.opts.refresh) { var msg = S.err[id]; await S.opts.refresh(id); S.err[id] = msg; redraw(id); }
    else redraw(id);
  }

  function bind(list, opts) {
    S.list = list; S.opts = opts || {};
    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-qact]'); if (!b) return;
      var id = b.dataset.id, act = b.dataset.qact;
      if (act === 'approve') { S.ui[id] = { mode: 'approve' }; S.err[id] = ''; redraw(id); var c = list.querySelector('[data-qbox="' + id + '"] [data-qact="confirm-approve"]'); if (c) c.focus(); }
      else if (act === 'decline') { S.ui[id] = { mode: 'decline' }; S.err[id] = ''; redraw(id); var t = list.querySelector('[data-qreason="' + id + '"]'); if (t) t.focus(); }
      else if (act === 'back') { S.ui[id] = {}; S.err[id] = ''; redraw(id); }
      else if (act === 'confirm-approve') answer(id, 'approved');
      else if (act === 'confirm-decline') answer(id, 'declined');
      else if (act === 'room' && S.opts.openRoom) S.opts.openRoom(id);
    });
  }

  window.STCustQuote = { load: load, html: html, hint: hint, label: label, needsPay: needsPay, dueCount: dueCount, due: due, bind: bind, _state: S };
})();

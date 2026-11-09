/* ============================================================
   StreetTasker — messages-quote.js (Stage B2e)
   The Local Tasker quote as a card in the customer's Job Room (messages.html), with Approve and Decline.
   The chat line comes from the database (stage B2d): a message of type `system` whose payload says { card: 'quote', quote_id, version }.
   Reads:  rpc local_booking_customer_quotes(p_booking)   the customer's current quote of this booking (lines, status, their own answer)
   Writes: rpc local_booking_decide_quote(...)            approve or decline (the ONLY way), same call as the Bookings page (customer-quote.js, B2a);
                                                          the database creates the payment requests when a quote is approved.
   This file never creates, changes or pays a payment request. Payments appear as the usual payment cards in this chat.
   Only the customer gets the card. Anyone else (and any failure to load) sees the plain chat line, as before.
   Everything from the database is put on the page with textContent, never as markup.
   Used by js/messages-thread.js:  JRQuote.isCard(m), JRQuote.load(thread, role), JRQuote.build(m)
   ============================================================ */
'use strict';

(function () {
  var S = { booking: null, cur: null, loaded: false, ui: {}, ids: {}, busy: false, err: '', loading: null };
  var REASON_MAX = 300;

  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function naira(n) { return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }); }
  function timeLabel(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';

  function isCard(m) { return !!(m && m.type === 'system' && m.payload && typeof m.payload === 'object' && m.payload.card === 'quote'); }
  function serviceFee(q) {
    var l = ((q && q.quote && q.quote.lines) || []).filter(function (x) { return x.key === 'service_fee'; })[0];
    return l ? Number(l.amount) : 0;
  }

  /* ── data ──────────────────────────────────────────────────── */
  /* Loads the current quote of the open conversation. Never throws: on any problem the quote lines stay plain chat lines. */
  async function load(thread, role) {
    S.booking = null; S.cur = null; S.loaded = false;
    if (!thread || role !== 'customer' || thread.context_type !== 'booking' || !thread.context_id) return false;
    S.booking = String(thread.context_id);
    return refresh();
  }
  async function refresh() {
    if (!S.booking) return false;
    var id = S.booking, res;
    try { res = await window.supabase.rpc('local_booking_customer_quotes', { p_booking: id }); } catch (e) { res = { error: e }; }
    if (S.booking !== id) return false;
    if (res.error || !Array.isArray(res.data)) { S.cur = null; S.loaded = false; return false; }
    S.cur = res.data.filter(function (x) { return x && String(x.booking_id) === id; })[0] || null;
    S.loaded = true;
    return true;
  }

  /* ── card ──────────────────────────────────────────────────── */
  function plainLine(m, extra) {
    var row = el('div', 'jr-system'), chip = el('div', 'jr-system-chip'), ic = el('span', 'jr-system-icon'); ic.innerHTML = ICON;
    if (m.id) row.dataset.id = String(m.id);
    chip.appendChild(ic); chip.appendChild(document.createTextNode(String(m.body || 'Quote') + (extra || ''))); row.appendChild(chip);
    row.appendChild(el('div', 'jr-system-time', timeLabel(m.created_at)));
    return row;
  }

  function lineRows(q) {
    var lines = ((q.quote && q.quote.lines) || []).filter(function (l) { return l && Number(l.amount) > 0 && l.label; });
    var list = el('div', 'jr-money-lines');
    lines.forEach(function (l) { var r = el('div', 'jr-money-line'); r.appendChild(el('span', null, String(l.label))); r.appendChild(el('span', null, naira(l.amount))); list.appendChild(r); });
    var t = el('div', 'jr-money-line jr-quote-total'); t.appendChild(el('span', null, 'Total')); t.appendChild(el('span', null, naira(q.quote && q.quote.total))); list.appendChild(t);
    return list;
  }

  function messageFor(error) {
    var hint = error && error.hint, msg = (error && error.message) || '';
    if (hint === 'quote_changed') return 'The quote was updated. We are showing you the new one. Please read it before you answer.';
    if (hint === 'invalid_transition') return 'This quote has already been answered or was replaced. We have refreshed the chat.';
    if (hint === 'booking_closed') return 'This booking is closed, so the quote cannot be answered.';
    if (hint === 'dispute_open') return 'A problem report is open on this booking, so the quote cannot be answered right now.';
    if (hint === 'already_paid') return 'This booking already has a payment on record, so the quote cannot be approved here. Please contact support.';
    if (hint === 'not_found' || /not found/i.test(msg)) return 'We could not find this booking. Reload the page.';
    if (hint === 'bad_input') return msg || 'That answer could not be saved.';
    return 'We could not save your answer. Nothing was changed. Check your connection and try again.';
  }

  function paint(node, m) {
    var q = S.cur, wrap = node;
    wrap.textContent = '';
    var v = Number(m.payload && m.payload.version), cv = q && q.quote ? Number(q.quote.version) : 0;
    /* the plain line when there is no card to show */
    if (!q || !q.quote || (v && cv && v > cv)) { wrap.appendChild(plainLine(m)); return; }
    if (v && cv && v < cv) { wrap.appendChild(plainLine(m, '. Replaced by a newer quote.')); return; }

    var st = q.lt_status, tone = st === 'quote_approved' ? 'paid' : st === 'quote_declined' ? 'declined' : 'pending';
    var card = el('div', 'payment-request-card jr-money jr-money--' + tone); card.id = 'quote-card-' + (q.quote.version || '');
    var head = el('div', 'prc-header'), ic = el('div', 'prc-icon'); ic.innerHTML = ICON; head.appendChild(ic);
    head.appendChild(el('span', 'prc-label', cv > 1 ? 'Quote ' + cv : 'Quote'));
    head.appendChild(el('span', 'jr-req-pill jr-req-pill--' + tone, st === 'quote_approved' ? 'Approved' : st === 'quote_declined' ? 'Declined' : 'Your answer needed')); card.appendChild(head);
    card.appendChild(el('div', 'jr-req-note', 'From ' + (q.tasker_name || 'your Local Tasker')));
    card.appendChild(lineRows(q));
    if (q.quote.note) card.appendChild(el('div', 'jr-req-note', 'Note: ' + q.quote.note));

    var ui = S.ui[cv] || {}, dis = S.busy;
    if (st === 'quote_sent') {
      if (ui.mode === 'approve') {
        var p = el('div', 'jr-quote-panel');
        p.appendChild(el('p', 'jr-quote-help', 'You are approving ' + naira(q.quote.total) + ' in total. You will then pay each item here in the chat, and the money is held safely until the work is done.'));
        var a = el('div', 'jr-req-actions');
        var y = el('button', 'jr-req-btn jr-req-btn--primary', S.busy ? 'Approving…' : 'Yes, approve'); y.type = 'button'; y.disabled = dis; y.dataset.qact = 'confirm-approve';
        var bk = el('button', 'jr-req-btn', 'Back'); bk.type = 'button'; bk.disabled = dis; bk.dataset.qact = 'back';
        a.appendChild(y); a.appendChild(bk); p.appendChild(a); card.appendChild(p);
      } else if (ui.mode === 'decline') {
        var d = el('div', 'jr-quote-panel');
        var l1 = el('label', 'form-label', 'Why are you declining? (optional)'); l1.htmlFor = 'jrq-reason';
        var ta = el('textarea', 'form-textarea'); ta.id = 'jrq-reason'; ta.maxLength = REASON_MAX; ta.disabled = dis; ta.dataset.qreason = '1'; ta.value = ui.reason || '';
        var l2 = el('label', 'form-label', 'Do you have a service price in mind? (optional)'); l2.htmlFor = 'jrq-price';
        var pi = el('input', 'form-input'); pi.id = 'jrq-price'; pi.type = 'text'; pi.setAttribute('inputmode', 'numeric'); pi.autocomplete = 'off'; pi.placeholder = 'e.g. 8000'; pi.disabled = dis; pi.dataset.qprice = '1'; pi.value = ui.price || '';
        d.appendChild(l1); d.appendChild(ta); d.appendChild(el('p', 'jr-quote-help', 'The coordinator sees this so they can send a revised quote.'));
        d.appendChild(l2); d.appendChild(pi);
        d.appendChild(el('p', 'jr-quote-help', 'The service fee on this quote is ' + naira(serviceFee(q)) + '. Your coordinator takes your price to the Local Tasker. It is a request, not a promise.'));
        var a2 = el('div', 'jr-req-actions');
        var n = el('button', 'jr-req-btn jr-req-btn--primary', S.busy ? 'Declining…' : 'Decline quote'); n.type = 'button'; n.disabled = dis; n.dataset.qact = 'confirm-decline';
        var b2 = el('button', 'jr-req-btn', 'Back'); b2.type = 'button'; b2.disabled = dis; b2.dataset.qact = 'back';
        a2.appendChild(n); a2.appendChild(b2); d.appendChild(a2); card.appendChild(d);
      } else {
        card.appendChild(el('p', 'jr-quote-help', 'Check the figures, then approve or decline. Nothing is charged when you approve.'));
        var a3 = el('div', 'jr-req-actions');
        var ap = el('button', 'jr-req-btn jr-req-btn--primary', 'Approve quote'); ap.type = 'button'; ap.dataset.qact = 'approve';
        var dc = el('button', 'jr-req-btn', 'Decline'); dc.type = 'button'; dc.dataset.qact = 'decline';
        a3.appendChild(ap); a3.appendChild(dc); card.appendChild(a3);
      }
    } else if (st === 'quote_approved') {
      var act = el('div', 'prc-actions'); act.appendChild(el('span', 'prc-status-badge paid', '✓ You approved this quote. Pay each item in the payment cards in this chat.')); card.appendChild(act);
    } else {
      var dd = q.decision || {};
      if (Number(dd.counter_amount) > 0) card.appendChild(el('div', 'jr-req-note', 'Service price you asked for: ' + naira(dd.counter_amount)));
      if (dd.reason) card.appendChild(el('div', 'jr-req-note', 'Your reason: ' + dd.reason));
      var act2 = el('div', 'prc-actions'); act2.appendChild(el('span', 'prc-status-badge accepted', 'You declined this quote. You have not been charged. Your coordinator will send a revised quote.')); card.appendChild(act2);
    }
    if (S.err) { var er = el('div', 'jr-quote-error', S.err); er.setAttribute('role', 'alert'); card.appendChild(er); }
    wrap.appendChild(card); wrap.appendChild(el('div', 'msg-time', timeLabel(m.created_at)));
  }

  function build(m) {
    var wrap = el('div', 'msg-bubble-wrap is-card theirs'); wrap.dataset.id = String(m.id || ''); wrap.dataset.quoteMsg = '1';
    wrap._quoteMsg = m;
    paint(wrap, m);
    /* a quote line that arrived live may be newer than the data loaded: fetch once, then draw again */
    var v = Number(m.payload && m.payload.version), cv = S.cur && S.cur.quote ? Number(S.cur.quote.version) : 0;
    if (S.booking && (!S.loaded || (v && v > cv))) refresh().then(function () { if (wrap.isConnected !== false) paint(wrap, m); });
    return wrap;
  }
  function repaintAll() {
    var body = document.getElementById('chatBody'); if (!body) return;
    var nodes = body.querySelectorAll('[data-quote-msg]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i]._quoteMsg) paint(nodes[i], nodes[i]._quoteMsg);
  }

  /* ── answer ────────────────────────────────────────────────── */
  async function answer(decision) {
    var q = S.cur; if (!q || !q.quote || S.busy) return;
    var version = q.quote.version, ui = S.ui[version] || (S.ui[version] = {});
    var reason = '', counter = null;
    if (decision === 'declined') {
      reason = String(ui.reason || '').trim();
      if (reason.length > REASON_MAX) { S.err = 'Keep the reason to ' + REASON_MAX + ' characters.'; repaintAll(); return; }
      var raw = String(ui.price || '').replace(/[₦,\s]/g, ''), fee = serviceFee(q);
      if (raw !== '') {
        if (!/^\d+$/.test(raw)) { S.err = 'Enter the price as a whole number, for example 8000.'; repaintAll(); return; }
        counter = Number(raw);
        if (counter < 100) { S.err = 'The price must be at least ' + naira(100) + '.'; repaintAll(); return; }
        if (fee && counter >= fee) { S.err = 'The price you propose must be lower than the current service fee of ' + naira(fee) + '.'; repaintAll(); return; }
      }
    }
    var key = S.booking + ':' + version + ':' + decision;
    if (!S.ids[key]) S.ids[key] = newId();           /* the same id until it succeeds, so a retry never answers twice */
    S.busy = true; S.err = ''; repaintAll();
    var changed = false;
    try {
      var res = await window.supabase.rpc('local_booking_decide_quote', {
        p_booking: S.booking, p_version: version, p_request_id: S.ids[key], p_decision: decision, p_reason: reason || null, p_counter: counter
      });
      if (res.error) throw res.error;
      delete S.ids[key]; S.ui[version] = {}; changed = true;
    } catch (e) {
      if (window.console) console.error('[job room quote]', e);
      S.err = messageFor(e);
      var h = e && e.hint;
      if (h === 'quote_changed' || h === 'invalid_transition' || h === 'booking_closed' || h === 'dispute_open') { delete S.ids[key]; S.ui[version] = {}; changed = true; }
    }
    S.busy = false;
    if (changed) {
      var msg = S.err;
      await refresh();
      /* reload draws the whole chat again, so the payment cards the approval created show up */
      if (window.JRThread && window.JRThread.reload) { try { await window.JRThread.reload(); } catch (_x) { /* the card below still repaints */ } }
      S.err = msg;
    }
    repaintAll();
  }

  function bind() {
    var body = document.getElementById('chatBody'); if (!body || body._quoteBound) return;
    body._quoteBound = true;
    body.addEventListener('input', function (e) {
      var t = e.target; if (!t || !t.dataset || !S.cur || !S.cur.quote) return;
      var v = S.cur.quote.version, ui = S.ui[v] || (S.ui[v] = {});
      if (t.dataset.qreason) ui.reason = t.value; else if (t.dataset.qprice) ui.price = t.value;
    });
    body.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-qact]'); if (!b || !S.cur || !S.cur.quote) return;
      var act = b.dataset.qact, v = S.cur.quote.version;
      if (act === 'approve') { S.ui[v] = { mode: 'approve' }; S.err = ''; repaintAll(); }
      else if (act === 'decline') { S.ui[v] = { mode: 'decline' }; S.err = ''; repaintAll(); var t = body.querySelector('[data-qreason]'); if (t) t.focus(); }
      else if (act === 'back') { S.ui[v] = {}; S.err = ''; repaintAll(); }
      else if (act === 'confirm-approve') answer('approved');
      else if (act === 'confirm-decline') answer('declined');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();

  window.JRQuote = { isCard: isCard, load: load, build: build, bind: bind, _state: S };
})();

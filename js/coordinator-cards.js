/* ============================================================
   StreetTasker — coordinator-cards.js (Stage 6D-1)
   Draws, for the coordinator chat (coordinator-chat.html), the same payment and request cards the Job Room shows in a conversation,
   plus the "Payment history" and "Activity" blocks of the right-hand column. READ ONLY: there is no Pay, Decline or Cancel button here.
   Data comes only from two database functions (both check the signed-in coordinator, current or former):
     coordinator_chat_cards     payment requests, job requests and receipts of the booking's conversation
     coordinator_chat_activity  the activity timeline (job_events) of the booking
   Never touches a money table itself. Everything from the database is put on the page with textContent, never innerHTML
   (the only innerHTML is the fixed icon markup below). Same classes as the Job Room (css/messages.css); no new colours.
   Public API (window.STCoCards): load(id), loadActivity(id), has(id), sig(), cardFor(message, mine), fallbackText(message),
                                  historyBlock(id), activityBlock(id), clear()
   Stage 6D-4b: setHooks({ actionsFor(request) -> [{ label, primary, run() }] }) lets js/coordinator-jobactions.js put "Send update", "Send proof" and
   "Mark as done" on the customer's own pending asks; pending(kind) and find(id) read what is loaded. Without hooks the cards stay read only.
   ============================================================ */
'use strict';

(function () {
  var D = { id: null, ok: false, payments: {}, requests: {}, receipts: [], list: [], sigText: '' };
  var A = { id: null, ok: false, rows: [], showAll: false, sigText: '' };
  var SHOW = 6;
  var H = null;      /* hooks from coordinator-jobactions.js (Stage 6D-4b) */

  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function svg(inner) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; }
  var ICON_CARD = svg('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>');
  var ICON_CLIP = svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>');
  function naira(n) { return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }); }
  function sb() { return window.supabase; }
  function timeLabel(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function dateTime(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  /* What each kind says (same words as the Job Room) */
  var PAY_TITLE = { payment: 'Payment request', full_payment: 'Full payment', remaining_payment: 'Remaining payment', transport: 'Transport request',
                    additional_cost: 'Additional cost', materials: 'Materials', invoice: 'Invoice', refund: 'Refund' };
  var ADDON = ['transport', 'additional_cost', 'materials', 'invoice'];
  var REQ_TEXT = {
    update:          ['Update requested', 'The customer would like an update on this job.', 'The Local Tasker was asked for an update.'],
    arrival:         ['Arrival time requested', 'The customer would like to know when the Local Tasker will arrive.', 'The customer was asked when the Local Tasker will arrive.'],
    proof:           ['Proof of work requested', 'The customer would like photos or proof of the work.', 'Photos or proof of the work were requested.'],
    invoice_request: ['Invoice requested', 'The customer would like an invoice for this job.', 'An invoice was requested.'],
    custom:          ['Custom request', 'The customer has a request.', 'A request was sent to the customer.'],
    reschedule:      ['Reschedule requested', 'The customer would like to change the date and time.', 'A new date and time was proposed to the customer.'],
    price_proposal:  ['Price proposed', 'The customer proposed a price for this job.', 'A price was proposed to the customer.'],
    receipt_request: ['Receipt requested', 'The customer would like the receipt for something bought for this job.', 'A receipt was requested.']
  };
  var REQ_PILL = { pending: 'Pending', fulfilled: 'Done', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' };
  var PAY_PILL = { pending: 'Payment requested', processing: 'Payment processing', paid: 'Paid', released: 'Released', declined: 'Declined', cancelled: 'Cancelled', failed: 'Payment failed', refunded: 'Refunded' };
  var CHIP = { pending: 'action', processing: 'action', paid: 'success', released: 'success', declined: 'muted', cancelled: 'muted', failed: 'danger', refunded: 'muted' };

  function normStatus(s) { return s === 'approved' ? 'pending' : s === 'accepted' ? 'processing' : (s || 'pending'); }

  /* ── loading ───────────────────────────────────────────────── */
  function clear() { D = { id: null, ok: false, payments: {}, requests: {}, receipts: [], list: [], sigText: '' }; A = { id: null, ok: false, rows: [], showAll: false, sigText: '' }; }

  var latest = null, latestAct = null;
  async function load(id) {
    latest = id;
    var res;
    try { res = await sb().rpc('coordinator_chat_cards', { p_booking: id }); } catch (e) { res = { error: e }; }
    if (latest !== id) return false;   /* the person moved to another conversation while this was loading */
    if (res.error || !res.data) { if (D.id !== id) D = { id: id, ok: false, payments: {}, requests: {}, receipts: [], list: [], sigText: 'x' }; else D.ok = false; return false; }
    var d = res.data, n = { id: id, ok: true, payments: {}, requests: {}, receipts: d.receipts || [], list: d.payments || [], sigText: '' };
    (d.payments || []).forEach(function (p) { n.payments[p.id] = p; });
    (d.requests || []).forEach(function (r) { n.requests[r.id] = r; });
    n.sigText = (d.payments || []).map(function (p) { return p.id + p.status + (p.settlement || ''); }).concat((d.requests || []).map(function (r) { return r.id + r.status; }),
                 (d.receipts || []).map(function (r) { return r.id; })).join(',');
    D = n; return true;
  }
  async function loadActivity(id) {
    latestAct = id;
    var res;
    try { res = await sb().rpc('coordinator_chat_activity', { p_booking: id, p_limit: 100 }); } catch (e) { res = { error: e }; }
    if (latestAct !== id) return false;
    if (res.error || !res.data) { A = { id: id, ok: false, rows: A.id === id ? A.rows : [], showAll: false, sigText: A.sigText }; return false; }
    var rows = res.data.events || [];
    A = { id: id, ok: true, rows: rows, showAll: A.id === id ? A.showAll : false, sigText: rows.length ? rows[0].id : '' };
    return true;
  }
  function has(id) { return D.id === id; }
  function sig() { return D.id + ':' + D.sigText + ':' + (D.ok ? 1 : 0); }

  /* ── cards in the conversation ─────────────────────────────── */
  function idOf(body, prefix) { var p = String(body || '').split(':'); return p[0] === prefix ? (p[1] || '') : ''; }
  function kindOfBody(body) { var p = String(body || '').split(':'); return p[0] === 'JOB_REQUEST' ? (p[2] || '') : ''; }

  function moneyCard(m, mine, req) {
    var status = normStatus(req.status), kind = req.kind || 'payment';
    var released = status === 'paid' && req.settlement === 'released';
    var wrap = el('div', 'msg-bubble-wrap is-card ' + (mine ? 'mine' : 'theirs')); wrap.dataset.id = String(m.id || ''); wrap.dataset.moneyId = String(req.id);
    var card = el('div', 'payment-request-card jr-money jr-money--' + status + (mine ? ' mine-card' : '')); card.id = 'prc-' + req.id;
    var head = el('div', 'prc-header'), ic = el('div', 'prc-icon'); ic.innerHTML = ICON_CARD; head.appendChild(ic);
    head.appendChild(el('span', 'prc-label', PAY_TITLE[kind] || 'Payment request'));
    var pillKey = released ? 'released' : status, pill = PAY_PILL[pillKey] || status;
    if (kind === 'invoice' && pillKey === 'pending') pill = 'Awaiting payment';
    head.appendChild(el('span', 'jr-req-pill jr-req-pill--' + pillKey, pill)); card.appendChild(head);
    card.appendChild(el('div', 'prc-amount', Number(req.amount) > 0 ? naira(req.amount) : '—'));
    if (kind === 'invoice') {
      if (req.title) card.appendChild(el('div', 'jr-inv-title', req.title));
      var bits = [];
      if (req.invoice_number) bits.push(req.invoice_number);
      if (req.due_date) { var dd = new Date(String(req.due_date).slice(0, 10) + 'T00:00:00'); if (!isNaN(dd)) bits.push('Due ' + dd.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })); }
      if (bits.length) card.appendChild(el('div', 'jr-inv-meta', bits.join(' · ')));
    }
    if (req.reason) card.appendChild(el('div', 'jr-req-note', req.reason));
    var lines = Array.isArray(req.breakdown) ? req.breakdown.filter(function (l) { return l && Number(l.amount) > 0 && l.label; }) : [];
    if (lines.length) {
      var list = el('div', 'jr-money-lines');
      lines.forEach(function (l) { var row = el('div', 'jr-money-line'); row.appendChild(el('span', null, String(l.label))); row.appendChild(el('span', null, naira(l.amount))); list.appendChild(row); });
      card.appendChild(list);
    }
    var badge = '', cls = 'accepted';
    if (status === 'pending') badge = 'Waiting for the customer to pay';
    else if (status === 'processing') badge = 'Customer is paying';
    else if (status === 'failed') badge = 'Payment failed. The customer can try again';
    else if (status === 'paid') { badge = released ? '✓ Paid. Released' : '✓ Paid. Funds in escrow'; cls = 'paid'; }
    else if (status === 'declined') badge = 'Declined by the customer';
    else if (status === 'cancelled') badge = 'Cancelled';
    else if (status === 'refunded') badge = 'Refunded';
    if (badge) { var act = el('div', 'prc-actions'); act.appendChild(el('span', 'prc-status-badge ' + cls, badge)); card.appendChild(act); }
    if (req.revises_id) card.appendChild(el('div', 'jr-req-note', 'Revised request. The earlier one was declined and is kept in the history.'));
    wrap.appendChild(card); wrap.appendChild(el('div', 'msg-time', timeLabel(m.created_at)));
    return wrap;
  }

  function requestCard(m, mine, req) {
    var kind = req.kind, tx = REQ_TEXT[kind] || ['Request', 'The customer sent a request.', 'A request was sent.'], status = req.status || 'pending';
    var wrap = el('div', 'msg-bubble-wrap is-card ' + (mine ? 'mine' : 'theirs')); wrap.dataset.id = String(m.id || ''); wrap.dataset.reqId = String(req.id);
    var card = el('div', 'jr-req jr-req--' + status + (mine ? ' is-mine' : ''));
    var head = el('div', 'jr-req-head'), ic = el('div', 'jr-req-icon'); ic.innerHTML = ICON_CLIP; head.appendChild(ic);
    head.appendChild(el('span', 'jr-req-title', tx[0]));
    var pill = (kind === 'price_proposal' || kind === 'reschedule') && status === 'fulfilled' ? (kind === 'price_proposal' ? 'Agreed' : 'Accepted') : (REQ_PILL[status] || status);
    head.appendChild(el('span', 'jr-req-pill jr-req-pill--' + status, pill)); card.appendChild(head);
    card.appendChild(el('div', 'jr-req-text', mine ? tx[2] : tx[1]));
    var p = req.payload || {};
    if (kind === 'custom' && p.title) card.appendChild(el('div', 'jr-req-subject', String(p.title)));
    if (kind === 'price_proposal' && Number(p.amount) > 0) card.appendChild(el('div', 'jr-req-amount', naira(Number(p.amount))));
    if (kind === 'reschedule' && p.when) {
      var wd = new Date(p.when);
      if (!isNaN(wd.getTime())) card.appendChild(el('div', 'jr-req-when', 'New time: ' + wd.toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })));
    }
    if (req.note) card.appendChild(el('div', 'jr-req-note', req.note));
    /* Stage 6D-4b: buttons on the customer's own pending ask (the database function checks who you are and what the request is) */
    var acts = (H && H.actionsFor && !mine && status === 'pending' && req.by === 'customer') ? H.actionsFor(req) : null;
    if (acts && acts.length) {
      var row = el('div', 'jr-req-actions');
      acts.forEach(function (a) {
        var b = el('button', 'jr-req-btn' + (a.primary ? ' jr-req-btn--primary' : ''), a.label); b.type = 'button';
        b.addEventListener('click', function () {
          b.disabled = true;
          Promise.resolve().then(function () { return a.run(); }).catch(function () { /* the action shows its own message */ }).then(function () { b.disabled = false; });
        });
        row.appendChild(b);
      });
      card.appendChild(row);
    }
    wrap.appendChild(card); wrap.appendChild(el('div', 'msg-time', timeLabel(m.created_at)));
    return wrap;
  }

  /* The card for one message, or null when the message is not a card or its row could not be loaded (the caller then draws a plain line). */
  function cardFor(m, mine) {
    if (!D.ok || !m) return null;
    var pid = idOf(m.body, 'PAYMENT_REQUEST'); if (pid && D.payments[pid]) return moneyCard(m, mine, D.payments[pid]);
    var rid = idOf(m.body, 'JOB_REQUEST'); if (rid && D.requests[rid]) return requestCard(m, mine, D.requests[rid]);
    return null;
  }
  /* Plain line used when a card cannot be drawn (rows not loaded). Never shows the raw code. */
  function fallbackText(m) {
    var t = String((m && m.body) || ''), pr = /^PAYMENT_REQUEST:[^:]*:(\d+)/.exec(t);
    if (pr) return 'Payment request: ₦' + Number(pr[1]).toLocaleString('en-NG');
    if (/^JOB_REQUEST:/.test(t)) { var k = kindOfBody(t); return (REQ_TEXT[k] || ['Request'])[0]; }
    return '';
  }
  function isCardBody(m) { var b = String((m && m.body) || ''); return /^(PAYMENT_REQUEST|JOB_REQUEST):/.test(b); }

  /* ── right-hand column ─────────────────────────────────────── */
  function block(title) { var c = el('section', 'cc-card'); c.appendChild(el('h3', 'cc-card-title', title)); return c; }
  function chip(text, tone) { return el('span', 'jr-chip jr-chip--' + (tone || 'muted'), text); }

  function historyBlock(id) {
    if (D.id !== id) return null;
    var c = block('Payment history');
    if (!D.ok) { c.appendChild(el('p', 'cc-card-note', 'Payment history is not available right now. Try again later.')); return c; }
    var rows = D.list;
    if (!rows.length) { c.appendChild(el('p', 'cc-card-note', 'No payment requests yet. Requests, extra costs and refunds for this booking will be listed here.')); return c; }
    var paid = 0, waiting = 0;
    rows.forEach(function (p) { var s = normStatus(p.status); if (s === 'paid' && p.kind !== 'refund') paid += Number(p.amount) || 0; else if (s === 'pending' || s === 'processing') waiting += Number(p.amount) || 0; });
    c.appendChild(el('p', 'cc-card-note', naira(paid) + ' paid' + (waiting > 0 ? ' · ' + naira(waiting) + ' waiting for the customer' : '')));
    var ol = el('ol', 'jr-dt-pay-list');
    rows.slice().reverse().forEach(function (p) {
      var s = normStatus(p.status), dead = ['declined', 'cancelled', 'failed'].indexOf(s) !== -1, released = s === 'paid' && p.settlement === 'released';
      var li = el('li', 'jr-dt-pay' + (dead ? ' is-dead' : ''));
      var top = el('div', 'jr-dt-pay-top');
      top.appendChild(el('span', 'jr-dt-pay-name', (PAY_TITLE[p.kind] || 'Payment request') + (p.invoice_number ? ' ' + p.invoice_number : '')));
      top.appendChild(el('span', 'jr-dt-pay-amount', naira(p.amount))); li.appendChild(top);
      var det = p.title || p.reason; if (det) li.appendChild(el('div', 'jr-dt-pay-detail', det));
      var bot = el('div', 'jr-dt-pay-bottom'); bot.appendChild(el('span', 'jr-dt-pay-date', dateTime(p.paid_at || p.created_at)));
      var key = released ? 'released' : s; bot.appendChild(chip(PAY_PILL[key] || s, CHIP[key])); li.appendChild(bot);
      if (ADDON.indexOf(p.kind) !== -1) li.appendChild(el('div', 'jr-dt-pay-tag', 'Additional charge, not part of the agreed price'));
      if (s === 'paid') {
        var rc = D.receipts.filter(function (r) { return r.payment_request_id === p.id; })[0];
        if (rc && rc.receipt_number) li.appendChild(el('div', 'jr-dt-pay-tag', 'Receipt ' + rc.receipt_number));
      }
      ol.appendChild(li);
    });
    c.appendChild(ol);
    if (rows.some(function (p) { return ['declined', 'cancelled', 'failed'].indexOf(normStatus(p.status)) !== -1; })) {
      c.appendChild(el('p', 'cc-card-note', 'Declined, cancelled and failed requests stay in the list but are not counted in the totals.'));
    }
    return c;
  }

  var WHO = { customer: 'Customer', local_tasker: 'Local Tasker', staff: 'StreetTasker staff', system: 'StreetTasker' };
  function activityBlock(id, onMore) {
    if (A.id !== id) return null;
    var c = block('Activity');
    if (!A.ok && !A.rows.length) { c.appendChild(el('p', 'cc-card-note', 'Activity is not available right now. Try again later.')); return c; }
    if (!A.rows.length) { c.appendChild(el('p', 'cc-card-note', 'Nothing has happened on this booking yet. Payments, arrival and work updates will show here.')); return c; }
    var ol = el('ol', 'jr-dt-timeline'), shown = A.showAll ? A.rows : A.rows.slice(0, SHOW);
    shown.forEach(function (e) {
      var li = el('li', 'jr-dt-event'); li.appendChild(el('span', 'jr-dt-dot'));
      var b = el('div', 'jr-dt-event-body'); b.appendChild(el('div', 'jr-dt-event-text', e.text || String(e.kind || '').replace(/_/g, ' ')));
      if (e.note) b.appendChild(el('div', 'jr-dt-event-note', e.note));
      b.appendChild(el('div', 'jr-dt-event-meta', (WHO[e.by] || 'StreetTasker') + ' · ' + dateTime(e.created_at))); li.appendChild(b); ol.appendChild(li);
    });
    c.appendChild(ol);
    if (!A.showAll && A.rows.length > SHOW) {
      var more = el('button', 'btn btn-outline btn-sm', 'Show all ' + A.rows.length); more.type = 'button';
      more.addEventListener('click', function () { A.showAll = true; if (onMore) onMore(); }); c.appendChild(more);
    }
    return c;
  }

  function pending(kind) { return (D.ok ? Object.keys(D.requests) : []).map(function (k) { return D.requests[k]; }).filter(function (r) { return r.kind === kind && r.status === 'pending'; }); }
  function find(id) { return D.ok ? (D.requests[id] || null) : null; }
  function setHooks(h) { H = h || null; }

  window.STCoCards = { pending: pending, find: find, setHooks: setHooks, load: load, loadActivity: loadActivity, has: has, sig: sig, cardFor: cardFor, fallbackText: fallbackText, isCardBody: isCardBody,
                       historyBlock: historyBlock, activityBlock: activityBlock, clear: clear };
})();

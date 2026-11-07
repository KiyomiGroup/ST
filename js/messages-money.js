/* ============================================================
   STREETTASKER — messages-money.js   (Job Room, step 6)
   Money requests inside a conversation, stored in `payment_requests`
   and paid through the existing Paystack flow (js/payments.js).

   Kinds (payment_requests.kind, needs sql/messaging-step6.sql):
     payment            custom amount          (what existed before)
     full_payment       the agreed amount, no typing
     remaining_payment  what is still unpaid
     transport          the customer pays or declines (no approve step)
     additional_cost    the customer pays or declines (no approve step)
     invoice            Stage 8: itemised invoice (title, lines, due date). An ADD-ON like transport:
                        it never sets the price or the code. The server checks title, lines and total.
     materials          add-on for materials bought (same rules as an invoice add-on)

   Status of a request (Stage 7, needs sql/messaging-step7.sql):
     pending -> processing -> paid        the customer pays; 'processing' = started, not confirmed
     processing -> failed -> processing   a payment attempt failed; the customer can try again
     pending -> declined                  the customer declines ANY kind
     pending -> cancelled                 the tasker cancels
   A paid request is also 'held' (in escrow) until the job is released (settlement 'released').
   Old rows may still say 'approved' (= pending) or 'accepted' (= processing): normStatus().

   Public API (window.JRMoney), used by messages.html / -thread / -requests:
     JRMoney.init({ onChange })
     JRMoney.KINDS                   labels + class per kind
     JRMoney.isAddon(kind)           transport / additional_cost
     JRMoney.summary(thread)         { base, additions, addonsPaid, total, paid, paidMain, outstanding,
                                       refunded, waiting, processing, payState }
     JRMoney.history(thread)         every request for the task, newest first (Payment History)
     JRMoney.respond(id, status)     declined (customer) | cancelled (tasker)
     JRMoney.normStatus(status)      old 'approved' -> 'pending', old 'accepted' -> 'processing'
     JRMoney.canRevise(row)          tasker, declined, nothing open already revises it
     JRMoney.create(def)             def.revises = id of a declined request to send a revised one;
                                     def.title / def.dueDate ('YYYY-MM-DD') are for invoices
     JRMoney.isOverdue(row)          invoice past its due date and still unpaid (display only, no server state)
     JRMoney.receiptFor(requestId)   Promise: the receipt of a paid request (payment_receipts, Stage 8) or null
     JRMoney.receiptsForThread(id)   Promise: every receipt of a conversation, newest first, or null if unreadable
     JRMoney.pay(id)                 customer pays a request (Paystack, or gift cards on main service payments)
     JRMoney.naira(n)

   Payments are confirmed and recorded by the SERVER (step 6a, see PAYMENTS-HARDENING.md):
   this file never writes a payment status, an amount or a message about a payment.

   No inline styles, no raw colours.
   ============================================================ */
'use strict';

(function () {

  var MAIN_KINDS  = ['payment', 'full_payment'];          /* set the agreed price */
  var PAY_KINDS   = ['payment', 'full_payment', 'remaining_payment'];
  var ADDON_KINDS = ['transport', 'additional_cost', 'materials', 'invoice'];
  var MIN_AMOUNT = 100;
  var MAX_AMOUNT = 10000000;

  var KINDS = {
    payment:           { title: 'Payment request',    short: 'Payment request',    pre: 'Payment request' },
    full_payment:      { title: 'Full payment',       short: 'Full payment',       pre: 'Full payment request' },
    remaining_payment: { title: 'Remaining payment',  short: 'Remaining payment',  pre: 'Remaining payment request' },
    transport:         { title: 'Transport request',  short: 'Transport',          pre: 'Transport request' },
    additional_cost:   { title: 'Additional cost',    short: 'Additional cost',    pre: 'Additional cost request' },
    materials:         { title: 'Materials',          short: 'Materials',          pre: 'Materials request' },
    invoice:           { title: 'Invoice',            short: 'Invoice',            pre: 'Invoice' }
  };

  var S = { onChange: null, busy: {}, receipts: {} };

  function naira(n) {
    return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  }
  function toast(msg, type) { if (window.JRThread) window.JRThread.toast(msg, type); }
  function ctx() { return window.JRRoom && window.JRRoom.current ? window.JRRoom.current() : null; }
  function isAddon(kind) { return ADDON_KINDS.indexOf(kind) !== -1; }
  function kindOf(row) { return (row && row.kind) || 'payment'; }
  function changed() { if (S.onChange) S.onChange(); }
  /* One name per state. The database may still hold an old 'approved' / 'accepted' row. */
  function normStatus(st) {
    if (st === 'approved') return 'pending';
    if (st === 'accepted') return 'processing';
    return st || 'pending';
  }

  /* ── financial summary (spec 21, 30) ─────────────────────────
     The ONE place the Job Details panel and the status banner get their figures.
     Everything is computed from this task's own payment_requests (never typed in).
     The server mirrors it in job_money_snapshot() (sql/messaging-step7.sql) for the
     checks that must not be trusted to the browser (no second full payment, remaining
     payment never above what is left). Keep the two in step.
       base         the originally agreed amount
       additions    transport / additional cost that is PAID (a pending, declined or
                    cancelled add-on never changes the total, spec 21)
       addonsPaid   same as additions (server confirmed)
       total        base + additions
       paid         everything paid so far (status 'paid' only, set by the server)
       paidMain     paid minus paid add-ons (an add-on may be paid before the main amount)
       outstanding  what is still to pay (never counts an unpaid add-on)
       refunded     money returned (status 'refunded')
       waiting      amount in requests still to be paid (pending, or a payment that failed)
       processing   true while a payment has started but is not confirmed
       payState     none | requested | processing | partial | held | released |
                    refunded | disputed
     A declined or cancelled request never touches any figure (spec 21).      */
  function summary(thread, rowsArg) {
    var rows = rowsArg || (window.JRThread ? window.JRThread.moneyRows() : []);
    var bk = thread && thread.booking;
    var base = 0, additions = 0, addonsPaid = 0, paid = 0, refunded = 0, waiting = 0, processing = false;

    var mains = rows.filter(function (r) {
      var st = normStatus(r.status);
      return MAIN_KINDS.indexOf(kindOf(r)) !== -1 && (st === 'paid' || st === 'processing');
    }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });

    if (mains.length) base = Number(mains[0].amount) || 0;
    else if (bk && bk.payment_status !== 'paid' && Number(bk.amount) > 0) base = Number(bk.amount);
    else if (thread && Number(thread.agreed_price) > 0) base = Number(thread.agreed_price);

    rows.forEach(function (r) {
      var amt = Number(r.amount) || 0;
      var addon = isAddon(kindOf(r));
      var st = normStatus(r.status);
      if (st === 'paid') { paid += amt; if (addon) { addonsPaid += amt; additions += amt; } }
      if (st === 'refunded') refunded += amt;
      if (st === 'pending' || st === 'failed') waiting += amt;
      if (st === 'processing') processing = true;
    });

    /* Paid some other way (dashboard booking flow): trust the booking */
    if (!paid && bk && bk.payment_status === 'paid' && Number(bk.amount) > 0) {
      paid = Number(bk.amount);
      if (!base) base = paid;
    }

    var total = base + additions;
    var outstanding = Math.max(0, total - paid);
    var paidMain = Math.max(0, paid - addonsPaid);

    /* Wording for "Paid" / "Released" only appears when the server says so (spec 12, 36) */
    var payState = 'none';
    if (bk && bk.status === 'disputed') payState = 'disputed';
    else if (paid > 0 && bk && bk.status === 'completed') payState = 'released';
    else if (paid > 0 && outstanding > 0) payState = 'partial';
    else if (paid > 0) payState = 'held';
    else if (refunded > 0) payState = 'refunded';
    else if (processing) payState = 'processing';
    else if (waiting > 0) payState = 'requested';

    return {
      base: base, additions: additions, addonsPaid: addonsPaid, total: total, paid: paid,
      paidMain: paidMain, outstanding: outstanding, refunded: refunded, waiting: waiting, processing: processing,
      payState: payState
    };
  }

  /* ── history (Payment History list) ──────────────────────────
     Every request for this task, newest first. Declined, cancelled and failed
     requests stay in the list (spec 21) but `counted` is false for them.   */
  var HISTORY_LABEL = {
    refund: 'Refund'
  };
  function history(thread, rowsArg) {
    var rows = rowsArg || (window.JRThread ? window.JRThread.moneyRows() : []);
    return rows.slice()
      .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
      .map(function (r) {
        var kind = kindOf(r);
        var label = (KINDS[kind] && KINDS[kind].title) || HISTORY_LABEL[kind] || 'Payment request';
        return {
          id: r.id, kind: kind, label: label,
          amount: Number(r.amount) || 0,
          status: normStatus(r.status),                 /* old approved = pending, old accepted = processing */
          /* paid -> held in escrow -> released (spec 12). Set by the server only. */
          stage: normStatus(r.status) === 'paid' ? (r.settlement || 'held') : '',
          revises: r.revises_id || '',
          counted: r.status === 'paid',
          addon: isAddon(kind),
          reason: r.reason || '',
          title: r.title || '',
          invoiceNo: r.invoice_no || r.invoice_number || '',
          dueDate: r.due_date || '',
          overdue: isOverdue(r),
          date: r.paid_at || r.created_at || ''
        };
      });
  }

  /* ── create (tasker) ─────────────────────────────────────────
     def: { kind, amount, reason?, breakdown? }                         */
  async function create(def) {
    var c = ctx();
    if (!c || !window.supabase) return false;
    var t = c.thread, me = c.user, sb = window.supabase;
    var kind = def.kind;
    var amount = Math.round(Number(def.amount));

    if (!KINDS[kind]) { toast('Unknown request type.', 'error'); return false; }
    if (!amount || amount < MIN_AMOUNT) { toast('Please enter an amount of at least ' + naira(MIN_AMOUNT) + '.', 'error'); return false; }
    if (amount > MAX_AMOUNT) { toast('That amount is too large. Check for a typing mistake.', 'error'); return false; }
    if (window.JRThread.pendingKinds().indexOf(kind) !== -1) { toast('You already have a pending request of this kind.', 'error'); return false; }

    var row = {
      thread_id: t.id, tasker_id: t.tasker_id, customer_id: t.customer_id,
      amount: amount, status: 'pending'
    };
    /* A revised request points at the declined one. The original is never edited (spec 20). */
    if (def.revises) { row.revises_id = def.revises; row.kind = kind; }
    if (kind !== 'payment' || def.reason) {
      row.kind = kind;
      if (def.reason) row.reason = def.reason;
      if (def.breakdown) row.breakdown = def.breakdown;
    }
    /* Invoice (Stage 8): the server checks title, lines, total and due date, and numbers it itself */
    if (kind === 'invoice') {
      row.kind = kind;
      if (def.title) row.title = def.title;
      if (def.dueDate) row.due_date = def.dueDate;
    }

    var req;
    try {
      var r = await sb.from('payment_requests').insert(row).select().single();
      if (r.error) throw r.error;
      req = r.data;
    } catch (e) {
      var msg = (e && e.message) || String(e);
      if (/revises_id/.test(msg)) msg = 'Run sql/messaging-step7.sql first (' + msg + ')';
      else if (/kind|reason|breakdown/.test(msg)) msg = 'Run sql/messaging-step6.sql first (' + msg + ')';
      toast('Could not send the request: ' + msg, 'error');
      return false;
    }

    var receiverId = t.customer_id;
    var body = 'PAYMENT_REQUEST:' + req.id + ':' + amount;
    var msgRow;
    try {
      var m = await sb.from('messages').insert({
        thread_id: t.id, sender_id: me.id, receiver_id: receiverId,
        body: body, type: 'payment_request', payment_request_id: req.id, flagged: false
      }).select().single();
      if (m.error) throw m.error;
      msgRow = m.data;
    } catch (e2) {
      try { await sb.from('payment_requests').update({ status: 'cancelled' }).eq('id', req.id); } catch (_x) {}
      toast('Could not send the request: ' + ((e2 && e2.message) || String(e2)), 'error');
      return false;
    }

    window.JRThread.registerMoney(req);
    window.JRThread.append(msgRow);

    var now = new Date().toISOString();
    var preview = ((def.revises ? 'Revised ' + KINDS[kind].pre.toLowerCase() : KINDS[kind].pre) + ': ' + naira(amount)).slice(0, 80);
    var cur = t.customer_unread || 0;
    try {
      await sb.from('message_threads').update({ last_message: preview, last_message_at: now, customer_unread: cur + 1 }).eq('id', t.id);
    } catch (_e3) {}
    t.last_message = preview; t.last_message_at = now; t.customer_unread = cur + 1;

    try {
      await sb.from('notifications').insert({
        user_id: receiverId, type: 'payment_request',
        title: KINDS[kind].pre + ': ' + naira(amount),
        message: isAddon(kind)
          ? 'Your tasker sent a ' + KINDS[kind].short.toLowerCase() + ' request. Review it, then pay or decline.'
          : 'Your service provider has sent a payment request. Review and pay securely through the platform.',
        data: { thread_id: t.id, payment_request_id: req.id }, is_read: false
      });
    } catch (_e4) {}

    changed();
    return true;
  }

  /* ── decline / cancel ─────────────────────────────────────────
     There is no approve step (spec 11, 12, 21): the customer pays or declines ANY kind,
     the tasker may cancel a request that has not been answered. The database decides
     (payment_requests_guard); if it refuses we show its message and repaint the card. */
  async function respond(id, status) {
    if (S.busy[id]) return false;
    if (status !== 'declined' && status !== 'cancelled') return false;
    var c = ctx();
    var row = window.JRThread.getMoney(id);
    if (!c || !row) return false;
    S.busy[id] = true;
    try {
      var r = await window.supabase.from('payment_requests').update({ status: status }).eq('id', id).select().maybeSingle();
      if (r.error) throw r.error;
      /* No row back = the database did not change it (not allowed, or not yours). Never pretend it worked. */
      if (!r.data || r.data.status !== status) throw new Error('That request could not be ' + status + '. Please refresh and try again.');
      var next = Object.assign({}, row, r.data);
      window.JRThread.onMoneyChange(next);

      var t = c.thread, me = c.user, kind = kindOf(row);
      var other = me.id === t.customer_id ? t.tasker_id : t.customer_id;
      if (status === 'declined') {
        /* the database posts the "declined" line in the chat itself */
        try {
          await window.supabase.from('notifications').insert({
            user_id: other, type: 'new_message',
            title: (KINDS[kind] ? KINDS[kind].short : 'Payment request') + ' declined',
            message: 'The customer declined ' + naira(row.amount) + '. You can send a revised request.',
            data: { thread_id: t.id, payment_request_id: id }, is_read: false
          });
        } catch (_n) {}
      }
      changed();
      return true;
    } catch (e) {
      toast((e && e.message) || 'Could not update the request', 'error');
      /* show the truth: the request may have changed on the server (e.g. payment just started) */
      try {
        var cur = await window.supabase.from('payment_requests').select('*').eq('id', id).maybeSingle();
        window.JRThread.onMoneyChange(Object.assign({}, row, cur.data || {}));
      } catch (_x) { window.JRThread.onMoneyChange(row); }
      return false;
    } finally {
      S.busy[id] = false;
    }
  }

  /* A declined request can be revised by its tasker, once, while no revision is open (spec 20) */
  function canRevise(row) {
    var c = ctx();
    if (!row || !c || c.role !== 'tasker' || normStatus(row.status) !== 'declined' || !KINDS[kindOf(row)]) return false;
    var rows = window.JRThread ? window.JRThread.moneyRows() : [];
    return !rows.some(function (r) {
      var st = normStatus(r.status);
      return r.revises_id === row.id && (st === 'pending' || st === 'processing' || st === 'paid');
    });
  }

  /* ── overdue (display only, no server state) ─────────────────
     An invoice is overdue when its due date is before today (the viewer's own date)
     and it has not been paid. Nothing is written anywhere: pay / decline work as before. */
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isOverdue(row) {
    if (!row || kindOf(row) !== 'invoice' || !row.due_date) return false;
    var st = normStatus(row.status);
    return (st === 'pending' || st === 'failed' || st === 'processing') && String(row.due_date).slice(0, 10) < todayLocal();
  }

  /* ── receipts (Stage 8, table payment_receipts) ──────────────
     One immutable row per successful payment, written by the SERVER. We only read it.
     null = no receipt (not paid, older than step 8 and not backfilled, or step 8 not run). */
  async function receiptFor(requestId) {
    if (!requestId || !window.supabase) return null;
    if (S.receipts[requestId]) return S.receipts[requestId];
    try {
      var r = await window.supabase.from('payment_receipts').select('*').eq('payment_request_id', requestId).maybeSingle();
      if (r.error) throw r.error;
      if (r.data) S.receipts[requestId] = r.data;
      return r.data || null;
    } catch (_e) { return null; }
  }

  /* All receipts of one conversation, newest first (Job Details > Receipts).
     Returns an array, or null when the table cannot be read (step 8 not run yet). */
  async function receiptsForThread(threadId) {
    if (!threadId || !window.supabase) return null;
    try {
      var r = await window.supabase.from('payment_receipts').select('*')
        .eq('thread_id', threadId).order('paid_at', { ascending: false }).limit(100);
      if (r.error) throw r.error;
      var rows = r.data || [];
      rows.forEach(function (x) { if (x.payment_request_id) S.receipts[x.payment_request_id] = x; });
      return rows;
    } catch (_e) { return null; }
  }

  /* ── how to pay (main service payments only) ─────────────────
     Gift cards are offered only for the main amount (payment, full payment, remaining payment), never for
     transport, additional costs or invoices. The SERVER works out what the cards can cover (gift-card-pay);
     this only shows the choice. Resolves 'gift', 'paystack', or null when the customer closes the sheet. */
  var ICON_GIFT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>';
  var ICON_WALLET = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>';
  var ICON_CARD = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';

  function chooseMethod(row, q, wallet) {
    q = q || { giftAmount: 0, remainder: 0, price: 0 };
    return new Promise(function (resolve) {
      var R = window.JRRequests, layer = document.getElementById('jrSheetLayer');
      var settled = false, obs = null;
      function finish(v) {
        if (settled) return;
        settled = true;
        if (obs) obs.disconnect();
        resolve(v);
      }
      var total = Number(row.amount) || Number(q.price) || 0;
      var title = ((KINDS[kindOf(row)] || KINDS.payment).title || 'payment').toLowerCase();

      R.openView('Choose how to pay', function (body, h) {
        var back = body.querySelector('.jr-sheet-back');   /* this is not a step inside the request menu */
        if (back && back.parentNode) back.parentNode.removeChild(back);
        body.appendChild(h.el('p', 'jr-sheet-lead', 'Paying ' + naira(total) + ' for the ' + title + '.'));

        function option(icon, label, hint, value) {
          var b = h.el('button', 'jr-sheet-item'); b.type = 'button';
          var ic = h.el('span', 'jr-sheet-item-icon'); ic.innerHTML = icon;
          var tx = h.el('span', 'jr-sheet-item-text');
          tx.appendChild(h.el('span', 'jr-sheet-item-label', label));
          tx.appendChild(h.el('span', 'jr-sheet-item-hint', hint));
          b.appendChild(ic); b.appendChild(tx);
          b.addEventListener('click', function () { finish(value); h.close(); });
          body.appendChild(b);
        }
        if (wallet && wallet.enough) {
          option(ICON_WALLET, 'Pay from wallet', 'Your wallet has ' + naira(wallet.balance) + '. ' + naira(total) + ' is taken and held safely until the job is done.', 'wallet');
        }
        if (q.giftAmount > 0) {
          option(ICON_GIFT, 'Use gift cards',
            q.remainder > 0 ? naira(q.giftAmount) + ' from your gift cards, then ' + naira(q.remainder) + ' with Paystack.'
                            : 'Your gift cards cover the full ' + naira(total) + '.', 'gift');
        }
        option(ICON_CARD, 'Pay with card or bank (Paystack)',
          'Pay ' + naira(total) + ' with Paystack.' + (q.giftAmount > 0 ? ' Your gift cards are not used.' : ''), 'paystack');
      });

      if (!layer || layer.hidden) { finish('paystack'); return; }   /* the sheet could not open: carry on as before */
      if (window.MutationObserver) {
        obs = new MutationObserver(function () { if (layer.hidden) finish(null); });
        obs.observe(layer, { attributes: true, attributeFilter: ['hidden'] });
      }
    });
  }

  /* ── pay (customer) ──────────────────────────────────────── */
  /* HARDENED (step 6a): the browser only starts the payment. The SERVER decides the
     amount, confirms it with Paystack, marks the request paid, sets the agreed price,
     holds the money in escrow and posts the confirmation in the chat. */
  async function pay(id) {
    if (S.busy[id]) return false;
    var c = ctx();
    var local = window.JRThread.getMoney(id);
    if (!c || !local) { toast('Request not found. Please refresh.', 'error'); return false; }
    var t = c.thread, me = c.user, sb = window.supabase;
    S.busy[id] = true;
    window.JRThread.onMoneyChange(Object.assign({}, local, { _busy: true }));

    try {
      if (!(window.ST && window.ST.payments)) throw new Error('Payment module not loaded. Please refresh.');
      var meta = me.user_metadata || {};
      var P = window.ST.payments;
      var method = 'paystack';
      /* How to pay: wallet (if it covers the amount), gift cards (main service payments only), Paystack. Ask only when there is a real choice. */
      var wallet = null, q = null;
      try {
        var wr = await sb.from('wallets').select('balance').eq('user_id', me.id).maybeSingle();
        var bal = Number(wr && wr.data && wr.data.balance) || 0;
        wallet = { balance: bal, enough: bal >= Number(local.amount) && bal > 0 };
      } catch (_w) { wallet = null; }
      if (PAY_KINDS.indexOf(kindOf(local)) !== -1 && P.getGiftQuote && P.payWithGiftCards) {
        try { q = await P.getGiftQuote({ requestId: id }); } catch (_q) { q = null; }
      }
      var hasGift = !!(q && q.giftAmount > 0), hasWallet = !!(wallet && wallet.enough);
      if ((hasGift || hasWallet) && window.JRRequests && window.JRRequests.openView) {
        method = await chooseMethod(local, hasGift ? q : null, wallet);
        if (!method) {   /* the customer closed the sheet: nothing was started */
          window.JRThread.onMoneyChange(Object.assign({}, local, { _busy: false }));
          return false;
        }
      }
      var payOpts = { requestId: id, customerEmail: meta.email || me.email };
      var result = method === 'gift' ? await P.payWithGiftCards(payOpts)
        : method === 'wallet' ? await P.payFromWallet({ requestId: id })
        : await P.initiatePayment(payOpts);

      if (result && result.firstPayment) {
        toast('Payment confirmed. Your money is held safely. When the job is done, review the work in this chat to release it.');
      } else {
        toast('Payment confirmed. ' + naira(result && result.amount) + ' added to escrow.');
      }

      /* The server already confirmed this payment (the call above only returns after that), so show the paid
         state and the release code RIGHT NOW. The slower refreshes below happen behind it. */
      try {
        if (result && result.bookingId && window.JRFlow && window.JRFlow.hintBooking) window.JRFlow.hintBooking(t.id, result.bookingId);
        window.JRThread.onMoneyChange(Object.assign({}, local, { status: 'paid', _busy: false }));
        if (window.JRFlow) window.JRFlow.update();
      } catch (_o) {}

      /* Then catch up with what the server did: the request row, the confirmation message, the list. Not awaited. */
      (async function () {
        try {
          var fr = await sb.from('payment_requests').select('*').eq('id', id).maybeSingle();
          if (fr.data) window.JRThread.onMoneyChange(fr.data);
        } catch (_f) {}
        try { await window.JRThread.reload(); } catch (_r0) {}
        try { if (window.JRList) await window.JRList.refreshOne(t, c.role); } catch (_r) {}
        changed();
      })();
      return true;
    } catch (e) {
      var msg = (e && e.message) || 'Payment failed. Please try again.';
      var closed = /closed|cancelled/i.test(msg);
      toast(msg, closed ? '' : 'error');
      /* The card may have changed on the server (e.g. already paid): show the truth */
      try {
        var cur = await sb.from('payment_requests').select('*').eq('id', id).maybeSingle();
        window.JRThread.onMoneyChange(Object.assign({}, cur.data || local, { _busy: false }));
      } catch (_g) {
        window.JRThread.onMoneyChange(Object.assign({}, local, { _busy: false }));
      }
      return false;
    } finally {
      S.busy[id] = false;
    }
  }

  function init(opts) { S.onChange = (opts && opts.onChange) || null; }

  window.JRMoney = {
    init: init, KINDS: KINDS, isAddon: isAddon, kindOf: kindOf, PAY_KINDS: PAY_KINDS,
    summary: summary, history: history, create: create, respond: respond, pay: pay, naira: naira,
    normStatus: normStatus, canRevise: canRevise, isOverdue: isOverdue, receiptFor: receiptFor, receiptsForThread: receiptsForThread,
    MIN_AMOUNT: MIN_AMOUNT, MAX_AMOUNT: MAX_AMOUNT
  };

})();

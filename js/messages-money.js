/* ============================================================
   STREETTASKER — messages-money.js   (Job Room, step 6)
   Money requests inside a conversation, stored in `payment_requests`
   and paid through the existing Paystack flow (js/payments.js).

   Kinds (payment_requests.kind, needs sql/messaging-step6.sql):
     payment            custom amount          (what existed before)
     full_payment       the agreed amount, no typing
     remaining_payment  what is still unpaid
     transport          needs the customer's approval, then is paid
     additional_cost    needs the customer's approval, then is paid

   Public API (window.JRMoney), used by messages.html / -thread / -requests:
     JRMoney.init({ onChange })
     JRMoney.KINDS                   labels + class per kind
     JRMoney.isAddon(kind)           transport / additional_cost
     JRMoney.summary(thread)         { base, additions, total, paid, outstanding }
     JRMoney.create(def)             tasker sends a request
     JRMoney.respond(id, status)     approved | declined | cancelled
     JRMoney.pay(id)                 customer pays a request (Paystack)
     JRMoney.naira(n)

   Payments are confirmed and recorded by the SERVER (step 6a, see PAYMENTS-HARDENING.md):
   this file never writes a payment status, an amount or a message about a payment.

   No inline styles, no raw colours.
   ============================================================ */
'use strict';

(function () {

  var MAIN_KINDS  = ['payment', 'full_payment'];          /* set the agreed price */
  var PAY_KINDS   = ['payment', 'full_payment', 'remaining_payment'];
  var ADDON_KINDS = ['transport', 'additional_cost'];
  var MIN_AMOUNT = 100;
  var MAX_AMOUNT = 10000000;

  var KINDS = {
    payment:           { title: 'Payment request',    short: 'Payment request',    pre: 'Payment request' },
    full_payment:      { title: 'Full payment',       short: 'Full payment',       pre: 'Full payment request' },
    remaining_payment: { title: 'Remaining payment',  short: 'Remaining payment',  pre: 'Remaining payment request' },
    transport:         { title: 'Transport request',  short: 'Transport',          pre: 'Transport request' },
    additional_cost:   { title: 'Additional cost',    short: 'Additional cost',    pre: 'Additional cost request' }
  };

  var S = { onChange: null, busy: {} };

  function naira(n) {
    return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  }
  function toast(msg, type) { if (window.JRThread) window.JRThread.toast(msg, type); }
  function ctx() { return window.JRRoom && window.JRRoom.current ? window.JRRoom.current() : null; }
  function isAddon(kind) { return ADDON_KINDS.indexOf(kind) !== -1; }
  function kindOf(row) { return (row && row.kind) || 'payment'; }
  function changed() { if (S.onChange) S.onChange(); }

  /* ── financial summary (spec 21, 30) ─────────────────────────
     base         the originally agreed amount
     additions    approved (or paid) transport / additional cost
     total        base + additions
     paid         everything paid so far
     outstanding  what is still to pay                                    */
  function summary(thread, rowsArg) {
    var rows = rowsArg || (window.JRThread ? window.JRThread.moneyRows() : []);
    var bk = thread && thread.booking;
    var base = 0, additions = 0, paid = 0;

    var mains = rows.filter(function (r) {
      return MAIN_KINDS.indexOf(kindOf(r)) !== -1 && (r.status === 'paid' || r.status === 'accepted');
    }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });

    if (mains.length) base = Number(mains[0].amount) || 0;
    else if (bk && bk.payment_status !== 'paid' && Number(bk.amount) > 0) base = Number(bk.amount);
    else if (thread && Number(thread.agreed_price) > 0) base = Number(thread.agreed_price);

    rows.forEach(function (r) {
      var amt = Number(r.amount) || 0;
      if (r.status === 'paid') paid += amt;
      if (isAddon(kindOf(r)) && (r.status === 'approved' || r.status === 'paid')) additions += amt;
    });

    /* Paid some other way (dashboard booking flow): trust the booking */
    if (!paid && bk && bk.payment_status === 'paid' && Number(bk.amount) > 0) {
      paid = Number(bk.amount);
      if (!base) base = paid;
    }

    var total = base + additions;
    return { base: base, additions: additions, total: total, paid: paid, outstanding: Math.max(0, total - paid) };
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
    if (kind !== 'payment' || def.reason) {
      row.kind = kind;
      if (def.reason) row.reason = def.reason;
      if (def.breakdown) row.breakdown = def.breakdown;
    }

    var req;
    try {
      var r = await sb.from('payment_requests').insert(row).select().single();
      if (r.error) throw r.error;
      req = r.data;
    } catch (e) {
      var msg = (e && e.message) || String(e);
      if (/kind|reason|breakdown/.test(msg)) msg = 'Run sql/messaging-step6.sql first (' + msg + ')';
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
    var preview = (KINDS[kind].pre + ': ' + naira(amount)).slice(0, 80);
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

  /* ── approve / decline / cancel ──────────────────────────── */
  async function respond(id, status) {
    if (S.busy[id]) return false;
    var c = ctx();
    var row = window.JRThread.getMoney(id);
    if (!c || !row) return false;
    S.busy[id] = true;
    try {
      var r = await window.supabase.from('payment_requests').update({ status: status }).eq('id', id).select().maybeSingle();
      if (r.error) throw r.error;
      var next = Object.assign({}, row, r.data || {}, { status: (r.data && r.data.status) || status });
      window.JRThread.onMoneyChange(next);

      var t = c.thread, me = c.user, kind = kindOf(row);
      var other = me.id === t.customer_id ? t.tasker_id : t.customer_id;
      if (status === 'approved' || status === 'declined') {
        var verb = status === 'approved' ? 'approved' : 'declined';
        /* the database posts the "approved / declined" line in the chat itself */
        try {
          await window.supabase.from('notifications').insert({
            user_id: other, type: 'new_message',
            title: KINDS[kind].short + ' ' + verb,
            message: 'The customer ' + verb + ' ' + naira(row.amount) + '.',
            data: { thread_id: t.id, payment_request_id: id }, is_read: false
          });
        } catch (_n) {}
      }
      changed();
      return true;
    } catch (e) {
      toast((e && e.message) || 'Could not update the request', 'error');
      window.JRThread.onMoneyChange(row);                    /* repaint: re-enables the buttons */
      return false;
    } finally {
      S.busy[id] = false;
    }
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
      var result = await window.ST.payments.initiatePayment({ requestId: id, customerEmail: meta.email || me.email });

      if (result && result.firstPayment) {
        toast('Payment confirmed. Your completion code is in the chat. Share it with the tasker only when the job is done.');
      } else {
        toast('Payment confirmed. ' + naira(result && result.amount) + ' added to escrow.');
      }

      /* Show what the server did: the request is paid, and the confirmation message is in the chat */
      try {
        var fr = await sb.from('payment_requests').select('*').eq('id', id).maybeSingle();
        if (fr.data) window.JRThread.onMoneyChange(fr.data);
      } catch (_f) {}
      try { await window.JRThread.reload(); } catch (_r0) {}
      try { if (window.JRList) await window.JRList.refreshOne(t, c.role); } catch (_r) {}
      changed();
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
    summary: summary, create: create, respond: respond, pay: pay, naira: naira,
    MIN_AMOUNT: MIN_AMOUNT, MAX_AMOUNT: MAX_AMOUNT
  };

})();

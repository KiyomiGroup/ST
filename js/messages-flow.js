/* ============================================================
   STREETTASKER — messages-flow.js   (Job Room, "next step" card)
   One card, pinned above the conversation, that answers "what do I do now?"
   for the normal job: agree the price > pay > do the work > hand over the release code.

   Fast pay and fast work come first. Transport, extra costs, invoices, receipts and the other
   less common jobs stay in the Request menu under "More options".

   Public API (window.JRFlow), called by messages-room.js on every refresh:
     JRFlow.update({ thread, user, role })

   This file never writes money or status itself. It only shows the right button and calls
   the functions that already exist and that the SERVER checks:
     JRMoney.create / JRMoney.pay          payment request, Paystack
     JRRequests.run(id)                    the same actions as the Request menu
     JRThread.answerDecision               accept / decline a proposed price
     ST.payments.getCompletionCode         the customer's 6-digit release code (customer only)

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var STEPS = ['Price', 'Pay', 'Work', 'Release'];
  var MAIN_KINDS = ['payment', 'full_payment', 'remaining_payment'];
  var S = { ctx: null, code: null, codeFor: '', shown: false, shownFor: '', busy: false, copied: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function naira(n) { return window.JRMoney ? window.JRMoney.naira(n) : '₦' + Number(n || 0).toLocaleString(); }
  function toast(m, t) { if (window.JRThread && window.JRThread.toast) window.JRThread.toast(m, t); }
  function pay() { return window.ST && window.ST.payments; }

  /* ── what state is this job in? ───────────────────────────── */
  function read() {
    var c = S.ctx, th = c.thread, bk = th.booking || null;
    var J = window.JRMoney;
    var sm = J ? J.summary(th) : { base: 0, paid: 0, paidMain: 0, outstanding: 0, total: 0, processing: false };
    var st = window.JRRoom ? window.JRRoom.statusFor(th, c.role) : { key: 'inquiry' };
    var rows = (window.JRThread && window.JRThread.moneyRows) ? window.JRThread.moneyRows() : [];
    /* the oldest main payment request that is waiting for the customer */
    var waiting = rows.filter(function (r) {
      var s = J.normStatus(r.status);
      return MAIN_KINDS.indexOf(J.kindOf(r)) !== -1 && (s === 'pending' || s === 'failed');
    }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })[0] || null;
    var paid = !!(bk && bk.payment_status === 'paid') || sm.paidMain > 0;
    return {
      role: c.role, thread: th, booking: bk, bookingId: (th.context_type === 'booking' && th.context_id) ? th.context_id : null,
      sm: sm, status: st.key, stage: bk ? (bk.work_stage || null) : null, paid: paid,
      waiting: waiting, decision: window.JRThread && window.JRThread.pendingDecision ? window.JRThread.pendingDecision() : null,
      processing: !!sm.processing
    };
  }

  function stepIndex(v) {
    if (v.status === 'completed') return 4;
    if (v.status === 'awaiting_confirmation') return 3;
    if (v.paid) return 2;
    /* the price only counts as agreed once someone accepted it (agreed_price) or a payment is already requested */
    if (v.waiting || v.processing || Number(v.thread.agreed_price) > 0) return 1;
    return 0;
  }

  /* ── the card's content for this person, in this state ────── */
  function plan(v) {
    var customer = v.role === 'customer';
    var P = { title: '', text: '', amount: 0, primary: null, secondary: null, code: false };

    if (v.status === 'cancelled') return { title: 'This job was cancelled', text: '', closed: true };
    if (v.status === 'completed') return { title: 'Job complete', text: customer ? 'The payment has been released to the tasker.' : 'Your payment has been released to your wallet.', closed: true, amount: v.sm.paid };
    if (v.status === 'disputed') return { title: 'Payment is on hold', text: 'A problem is being reviewed. Open Job details to see the report.', closed: true };
    if (v.status === 'awaiting_confirmation') {
      /* the panel below this card (messages-work.js) has the review / code-entry buttons */
      return { title: customer ? 'Work submitted' : 'Work submitted for review', text: customer ? 'Check the work, then get your release code below.' : 'Waiting for the customer. You will enter their code to get paid.', amount: v.sm.paid, compact: true };
    }

    /* ── paid: work + code ── */
    if (v.paid) {
      P.amount = v.sm.paid;
      if (customer) {
        P.title = 'Payment secured';
        P.text = 'StreetTasker is holding ' + naira(v.sm.paid) + ' until the job is done. Give the tasker your code only when you are happy with the work.';
        P.code = true;
        return P;
      }
      P.title = 'Customer has paid';
      var map = {
        none:        ['work_on_my_way', "I'm on my way", 'work_start', 'Start work', 'Payment is secured. Head to the job.'],
        en_route:    ['work_arrived', "I've arrived", 'work_start', 'Start work', 'The customer knows you are on the way.'],
        arrived:     ['work_start', 'Start work', null, '', 'You are there. Start when you are ready.'],
        in_progress: ['work_complete', 'Mark work complete', 'work_pause', 'Pause', 'Work is underway. Mark it complete when you finish.'],
        paused:      ['work_resume', 'Resume work', 'work_complete', 'Mark work complete', 'Work is paused.']
      };
      var m = map[v.stage || 'none'] || map.none;
      P.text = m[4];
      if (v.stage === 'in_progress' || v.stage === 'paused') P.text += ' After that the customer gets a code. Ask them for it to be paid.';
      P.primary = { label: m[1], id: m[0] };
      if (m[2]) P.secondary = { label: m[3], id: m[2] };
      return P;
    }

    /* ── not paid yet ── */
    if (v.processing) return { title: 'Confirming payment', text: 'This can take a moment. You do not need to pay again.', amount: v.sm.base };

    var d = v.decision;
    if (d && d.kind === 'price_proposal') {
      P.amount = d.amount;
      if (d.mine) { P.title = 'Waiting for the customer'; P.text = 'You proposed ' + naira(d.amount) + '. They can accept or decline.'; return P; }
      P.title = 'New price proposed';
      P.text = (customer ? 'The tasker proposed ' : 'The other person proposed ') + naira(d.amount) + (d.note ? '. ' + d.note : '.');
      P.primary = { label: 'Accept ' + naira(d.amount), decide: { id: d.id, accept: true } };
      P.secondary = { label: 'Decline', decide: { id: d.id, accept: false } };
      return P;
    }

    if (v.waiting) {
      var amt = Number(v.waiting.amount) || 0;
      P.amount = amt;
      if (customer) {
        P.title = 'Pay ' + naira(amt);
        P.text = 'The tasker requested this payment. It is held safely until the job is done.';
        P.primary = { label: 'Pay ' + naira(amt), pay: v.waiting.id };
      } else {
        P.title = 'Waiting for the customer to pay';
        P.text = naira(amt) + ' requested. You will be told as soon as it is paid.';
      }
      return P;
    }

    if (v.sm.base > 0) {
      P.amount = v.sm.base;
      if (customer) {
        P.title = 'Price: ' + naira(v.sm.base);
        P.text = 'Waiting for the tasker to confirm this price and send the payment request. Want a different price? Say so in the chat.';
      } else {
        P.title = 'Customer price: ' + naira(v.sm.base);
        P.text = 'Agree and the customer is asked to pay straight away, or suggest another price.';
        P.primary = { label: 'Agree ' + naira(v.sm.base) + ' and request payment', agree: v.sm.base };
        P.secondary = { label: 'Change price', id: 'propose_price' };
      }
      return P;
    }

    if (v.status === 'inquiry') return null;           /* just chatting: no card */
    if (customer) { P.title = 'Agree the price'; P.text = 'Talk it through here. The tasker sends the price, you accept, then pay.'; return P; }
    P.title = 'Set the price';
    P.text = 'Propose one price for the job. The customer accepts it, then pays.';
    P.primary = { label: 'Propose price', id: 'propose_price' };
    return P;
  }

  /* ── pieces ───────────────────────────────────────────────── */
  function stepper(idx) {
    var ol = el('ol', 'jr-flow-steps');
    ol.setAttribute('aria-label', 'Job progress');
    STEPS.forEach(function (name, i) {
      var li = el('li', 'jr-flow-step' + (i < idx ? ' is-done' : (i === idx ? ' is-now' : '')));
      if (i === idx) li.setAttribute('aria-current', 'step');
      li.appendChild(el('span', 'jr-flow-dot', i < idx ? '✓' : String(i + 1)));
      li.appendChild(el('span', 'jr-flow-step-name', name));
      ol.appendChild(li);
    });
    return ol;
  }

  function codeBox(v) {
    var wrap = el('div', 'jr-flow-code');
    wrap.appendChild(el('div', 'jr-flow-code-label', 'Your release code'));
    var line = el('div', 'jr-flow-code-line');
    var digits = el('span', 'jr-flow-code-digits', '••••••');
    digits.setAttribute('aria-live', 'polite');
    line.appendChild(digits);
    var show = el('button', 'jr-flow-link', 'Show'); show.type = 'button';
    var copy = el('button', 'jr-flow-link', 'Copy'); copy.type = 'button'; copy.hidden = true;
    line.appendChild(show); line.appendChild(copy);
    wrap.appendChild(line);
    wrap.appendChild(el('div', 'jr-flow-code-note', 'Keep it private until the work is finished. Never send it in the chat.'));

    function paint() {
      var visible = S.shown && S.shownFor === v.bookingId && S.code;
      digits.textContent = visible ? S.code : '••••••';
      show.textContent = visible ? 'Hide' : 'Show';
      copy.hidden = !visible;
      copy.textContent = S.copied ? 'Copied' : 'Copy';
    }
    function load() {
      if (S.codeFor === v.bookingId && S.code) return Promise.resolve(S.code);
      if (!pay() || !pay().getCompletionCode) return Promise.reject(new Error('unavailable'));
      return pay().getCompletionCode(v.bookingId).then(function (c) { S.code = c ? String(c) : null; S.codeFor = v.bookingId; return S.code; });
    }
    show.addEventListener('click', function () {
      if (S.shown && S.shownFor === v.bookingId) { S.shown = false; paint(); return; }
      show.disabled = true;
      load().then(function (c) {
        if (!c) throw new Error('none');
        S.shown = true; S.shownFor = v.bookingId; S.copied = false; paint();
      }).catch(function () { toast('The code is not available yet. Try again in a moment.', 'error'); })
        .then(function () { show.disabled = false; });
    });
    copy.addEventListener('click', function () {
      if (!S.code) return;
      var done = function () { S.copied = true; paint(); window.setTimeout(function () { S.copied = false; paint(); }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(S.code).then(done).catch(function () {});
    });
    paint();
    return wrap;
  }

  function act(btn, label, fn) {
    btn.addEventListener('click', function () {
      if (S.busy) return;
      S.busy = true; btn.disabled = true; btn.textContent = 'Please wait…';
      Promise.resolve().then(fn).catch(function (e) { toast((e && e.message) || 'That did not work. Please try again.', 'error'); })
        .then(function () { S.busy = false; paint(); });
    });
  }

  function button(def, cls) {
    var b = el('button', 'jr-flow-btn ' + cls, def.label); b.type = 'button';
    if (def.pay) {
      act(b, def.label, function () { return window.JRMoney.pay(def.pay); });
    } else if (def.decide) {
      act(b, def.label, function () { return window.JRThread.answerDecision(def.decide.id, def.decide.accept); });
    } else if (def.agree) {
      /* one tap: the full agreed amount is sent as a payment request, the same call as Request full payment */
      act(b, def.label, function () {
        return window.JRMoney.create({ kind: 'full_payment', amount: def.agree }).then(function (ok) { if (ok) toast('Payment requested. The customer can pay now.'); });
      });
    } else if (def.id) {
      b.addEventListener('click', function () { if (!window.JRRequests.run(def.id)) toast('That is not available right now.', 'error'); });
    }
    return b;
  }

  /* ── draw ─────────────────────────────────────────────────── */
  function paint() {
    var host = $('jrFlow');
    if (!host) return;
    host.textContent = '';
    if (!S.ctx || !S.ctx.thread) { host.hidden = true; return; }
    var v = read();
    var p = plan(v);
    if (!p) { host.hidden = true; return; }
    host.hidden = false;
    host.className = 'jr-flow' + (p.closed ? ' jr-flow--closed' : '') + (p.compact ? ' jr-flow--compact' : '');

    if (!p.closed) host.appendChild(stepper(stepIndex(v)));

    var head = el('div', 'jr-flow-head');
    var txt = el('div', 'jr-flow-main');
    txt.appendChild(el('div', 'jr-flow-title', p.title));
    if (p.text) txt.appendChild(el('div', 'jr-flow-text', p.text));
    head.appendChild(txt);
    host.appendChild(head);

    if (p.code) host.appendChild(codeBox(v));
    if (p.primary || p.secondary) {
      var row = el('div', 'jr-flow-actions');
      if (p.primary) row.appendChild(button(p.primary, 'jr-flow-btn--primary'));
      if (p.secondary) row.appendChild(button(p.secondary, ''));
      host.appendChild(row);
    }
  }

  function update(ctx) {
    if (ctx) {
      var changed = !S.ctx || S.ctx.thread.id !== ctx.thread.id;
      S.ctx = ctx;
      if (changed) { S.shown = false; S.code = null; S.codeFor = ''; }
    }
    paint();
  }

  window.JRFlow = { update: update, codeNode: function (bookingId) { return codeBox({ bookingId: bookingId }); } };
})();

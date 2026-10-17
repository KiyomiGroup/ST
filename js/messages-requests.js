/* ============================================================
   STREETTASKER — messages-requests.js   (Job Room, step 5)
   The "Request" button + bottom sheet (spec sections 6, 7, 39).

   The sheet only lists actions that make sense RIGHT NOW for this person
   (their role, the job status, what is already pending). Later steps add
   actions by pushing onto ACTIONS below; nothing else needs to change.

   Public API (window.JRRequests), used by messages.html / messages-room.js:
     JRRequests.init({ onChange })   wire the button + sheet (call once)
     JRRequests.update([ctx])        recompute what is available, show/hide button
                                     ctx: { thread, user, role } (JRRoom passes it)
     JRRequests.open() / .close()
     JRRequests.whenReady()          promise: is the step 5 table available?
     JRRequests.register(actions)    add actions to the sheet (used by messages-work.js)
     JRRequests.openView(title, fn)  open the sheet straight on a custom view; fn(body, {close, back})
     JRRequests.KINDS                labels per request kind (also used by the cards)

   Needs the step 5 SQL (sql/messaging-step5.sql) for the customer "ask" actions and
   the step 6 SQL (sql/messaging-step6.sql) for transport / additional cost / full /
   remaining payment. Until they have run those actions stay hidden; the plain
   "Request payment" still works.

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var NOTE_MAX = 300;

  /* What each request kind says on its card (rendered by messages-thread.js) */
  var KINDS = {
    update:  { title: 'Update requested',        byMe: 'You asked for an update on this job.',        byOther: 'The customer would like an update on this job.' },
    arrival: { title: 'Arrival time requested',  byMe: 'You asked when the tasker will arrive.',      byOther: 'The customer would like to know when you will arrive.' },
    proof:   { title: 'Proof of work requested', byMe: 'You asked for photos or proof of the work.',  byOther: 'The customer would like photos or proof of the work.' }
  };

  var S = { ctx: null, ready: null, probe: null, moneyReady: null, moneyProbe: null, onChange: null, bound: false, opener: null, view: 'menu' };

  /* ── helpers ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(inner) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var I = {
    card:    svg('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    clock:   svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    camera:  svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    close:   svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    back:    svg('<polyline points="15 18 9 12 15 6"/>'),
    truck:   svg('<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    tool:    svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>')
  };

  function naira(n) { return window.JRMoney ? window.JRMoney.naira(n) : '₦' + Number(n || 0).toLocaleString(); }

  function statusKey() {
    if (!S.ctx || !window.JRRoom) return 'inquiry';
    return window.JRRoom.statusFor(S.ctx.thread, S.ctx.role).key;
  }

  /* ── probe: is the step 5 table there? ───────────────────── */
  function probe() {
    if (S.probe) return S.probe;
    S.probe = (async function () {
      try {
        var r = await window.supabase.from('job_requests').select('id').limit(1);
        S.ready = !r.error;
      } catch (_e) { S.ready = false; }
      return S.ready;
    })();
    return S.probe;
  }

  /* step 6 columns present? (kind / reason / breakdown on payment_requests) */
  function probeMoney() {
    if (S.moneyProbe) return S.moneyProbe;
    S.moneyProbe = (async function () {
      try {
        var r = await window.supabase.from('payment_requests').select('id,kind,reason,breakdown').limit(1);
        S.moneyReady = !r.error;
      } catch (_e) { S.moneyReady = false; }
      return S.moneyReady;
    })();
    return S.moneyProbe;
  }

  /* ── actions registry ────────────────────────────────────────
     when(x)  x = { status, role, pending (array of pending kinds), ready }
     run(x)   called when the item is chosen                         */
  var CLOSED = ['completed', 'cancelled', 'disputed'];

  var ACTIONS = [
    {
      id: 'request_payment', roles: ['tasker'], group: 'Payment', icon: I.card, kind: 'payment',
      label: 'Request payment', hint: 'Ask for a custom amount',
      when: function (x) { return CLOSED.indexOf(x.status) === -1; },
      run: function () { showForm('payment'); }
    },
    {
      id: 'request_full', roles: ['tasker'], group: 'Payment', icon: I.card, kind: 'full_payment', needsMoney: true,
      label: 'Request full payment',
      hint: function (x) { return 'Agreed amount: ' + naira(x.money.base); },
      when: function (x) { return CLOSED.indexOf(x.status) === -1 && x.money.base > 0 && x.money.paid === 0; },
      run: function (x) { showConfirm('full_payment', x.money.base); }
    },
    {
      id: 'request_remaining', roles: ['tasker'], group: 'Payment', icon: I.card, kind: 'remaining_payment', needsMoney: true,
      label: 'Request remaining payment',
      hint: function (x) { return 'Still to pay: ' + naira(x.money.outstanding); },
      when: function (x) { return CLOSED.indexOf(x.status) === -1 && x.money.paid > 0 && x.money.outstanding > 0; },
      run: function (x) { showConfirm('remaining_payment', x.money.outstanding); }
    },
    {
      id: 'request_transport', roles: ['tasker'], group: 'Job costs', icon: I.truck, kind: 'transport', needsMoney: true,
      label: 'Request transport', hint: 'Ask the customer to pay a transport cost',
      when: function (x) { return CLOSED.indexOf(x.status) === -1; },
      run: function () { showForm('transport'); }
    },
    {
      id: 'request_additional', roles: ['tasker'], group: 'Job costs', icon: I.tool, kind: 'additional_cost', needsMoney: true,
      label: 'Request additional cost', hint: 'Extra work or materials found on site',
      when: function (x) { return ['secured', 'work'].indexOf(x.status) !== -1; },
      run: function () { showForm('additional_cost'); }
    },
    {
      id: 'ask_update', roles: ['customer'], group: 'Ask the tasker', icon: I.refresh, kind: 'update', needsTable: true,
      label: 'Request an update', hint: 'Ask how the job is going',
      when: function (x) { return ['booked', 'secured', 'work', 'awaiting_confirmation'].indexOf(x.status) !== -1; },
      run: function () { showAskForm('update'); }
    },
    {
      id: 'ask_arrival', roles: ['customer'], group: 'Ask the tasker', icon: I.clock, kind: 'arrival', needsTable: true,
      label: 'Request arrival time', hint: 'Ask when the tasker will get there',
      when: function (x) { return ['booked', 'secured'].indexOf(x.status) !== -1; },
      run: function () { showAskForm('arrival'); }
    },
    {
      id: 'ask_proof', roles: ['customer'], group: 'Ask the tasker', icon: I.camera, kind: 'proof', needsTable: true,
      label: 'Request proof of work', hint: 'Ask for photos of the work',
      when: function (x) { return ['secured', 'work', 'awaiting_confirmation'].indexOf(x.status) !== -1; },
      run: function () { showAskForm('proof'); }
    }
  ];

  function available() {
    if (!S.ctx) return [];
    var pending = (window.JRThread && window.JRThread.pendingKinds) ? window.JRThread.pendingKinds() : [];
    var money = window.JRMoney ? window.JRMoney.summary(S.ctx.thread) : { base: 0, additions: 0, total: 0, paid: 0, outstanding: 0 };
    var th = S.ctx.thread, bk = th.booking || null;
    var x = { status: statusKey(), role: S.ctx.role, pending: pending, ready: S.ready === true, money: money,
              booking: bk, stage: bk ? (bk.work_stage || null) : null,
              bookingId: (th.context_type === 'booking' && th.context_id) ? th.context_id : null,
              paid: !!(bk && bk.payment_status === 'paid') };
    return ACTIONS.filter(function (a) {
      if (a.roles.indexOf(x.role) === -1) return false;
      if (a.needsTable && !x.ready) return false;
      if (a.needsMoney && S.moneyReady !== true) return false;
      return a.when(x);
    }).map(function (a) {
      var waiting = a.kind && pending.indexOf(a.kind) !== -1;
      var blocked = a.blocked ? a.blocked(x) : null;
      var hint = typeof a.hint === 'function' ? a.hint(x) : a.hint;
      return { action: a, disabled: !!waiting || !!blocked, hint: waiting ? 'Waiting for a reply' : (blocked || hint), x: x };
    });
  }

  /* ── button ──────────────────────────────────────────────── */
  function update(ctx) {
    if (ctx) S.ctx = ctx;
    var btn = $('requestBtn');
    if (!btn) return;
    if (!S.ctx) { btn.hidden = true; return; }
    if (S.ready === null) {
      probe().then(function () { update(); });
    }
    if (S.moneyReady === null) {
      probeMoney().then(function () { update(); });
    }
    btn.hidden = available().length === 0;
    /* If the sheet is open and the list changed, redraw it */
    var layer = $('jrSheetLayer');
    if (layer && !layer.hidden && S.view === 'menu') renderMenu();
  }

  /* ── sheet ───────────────────────────────────────────────── */
  function setTitle(text) { var t = $('jrSheetTitle'); if (t) t.textContent = text; }

  function renderMenu() {
    S.view = 'menu';
    setTitle('Request');
    var body = $('jrSheetBody');
    if (!body) return;
    body.textContent = '';
    var items = available();
    if (!items.length) {
      body.appendChild(el('div', 'jr-sheet-empty', 'Nothing to request right now.'));
      return;
    }
    var groups = [];
    items.forEach(function (it) {
      var g = groups.filter(function (x) { return x.name === it.action.group; })[0];
      if (!g) { g = { name: it.action.group, items: [] }; groups.push(g); }
      g.items.push(it);
    });
    groups.forEach(function (g) {
      body.appendChild(el('div', 'jr-sheet-group', g.name));
      g.items.forEach(function (it) {
        var b = el('button', 'jr-sheet-item');
        b.type = 'button';
        b.disabled = it.disabled;
        var ic = el('span', 'jr-sheet-item-icon'); ic.innerHTML = it.action.icon;
        var tx = el('span', 'jr-sheet-item-text');
        tx.appendChild(el('span', 'jr-sheet-item-label', it.action.label));
        tx.appendChild(el('span', 'jr-sheet-item-hint', it.hint));
        b.appendChild(ic); b.appendChild(tx);
        b.addEventListener('click', function () { it.action.run(it.x); });
        body.appendChild(b);
      });
    });
  }

  function showAskForm(kind) {
    S.view = 'form';
    var meta = KINDS[kind];
    setTitle(meta.title.replace(' requested', ''));
    var body = $('jrSheetBody');
    body.textContent = '';

    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);

    body.appendChild(el('p', 'jr-sheet-lead', 'The tasker will see this in the conversation and can mark it as done.'));

    var label = el('label', 'jr-sheet-label', 'Add a note (optional)');
    label.setAttribute('for', 'jrAskNote');
    var note = el('textarea', 'jr-sheet-note');
    note.id = 'jrAskNote'; note.rows = 3; note.maxLength = NOTE_MAX;
    note.placeholder = 'e.g. I will be out from 2pm, please call the gate first.';
    var err = el('div', 'jr-sheet-error'); err.hidden = true;
    err.setAttribute('role', 'alert');
    body.appendChild(label); body.appendChild(note); body.appendChild(err);

    var send = el('button', 'jr-sheet-send', 'Send request'); send.type = 'button';
    send.addEventListener('click', async function () {
      err.hidden = true;
      var text = note.value.trim();
      if (text && window.JRThread && window.JRThread.hasContactInfo(text)) {
        err.textContent = 'Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.';
        err.hidden = false;
        if (typeof window.handleContactViolation === 'function' && S.ctx) window.handleContactViolation(S.ctx.user.id);
        return;
      }
      send.disabled = true; send.textContent = 'Sending…';
      var ok = await createAsk(kind, text);
      if (ok) { close(); }
      else { send.disabled = false; send.textContent = 'Send request'; }
    });
    body.appendChild(send);
    note.focus();
  }

  /* ── money forms (tasker) ────────────────────────────────── */
  var FORMS = {
    payment: {
      title: 'Request payment', lead: 'Enter the amount you and the customer agreed on for this job.', notice: true,
      fields: [{ id: 'amount', label: 'Amount (₦)', type: 'money', required: true, placeholder: 'e.g. 15000' }],
      submit: 'Send payment request'
    },
    transport: {
      title: 'Request transport', lead: 'The customer can pay or decline this request.',
      fields: [
        { id: 'amount', label: 'Transport cost (₦)', type: 'money', required: true, placeholder: 'e.g. 3500' },
        { id: 'reason', label: 'What is the transport for?', type: 'text', required: true, placeholder: 'e.g. To bring the replacement pump from the market' }
      ],
      submit: 'Send transport request'
    },
    additional_cost: {
      title: 'Request additional cost', lead: 'Explain what you found. The customer can pay or decline this request.',
      fields: [
        { id: 'work', label: 'Additional work (₦)', type: 'money', placeholder: 'Optional' },
        { id: 'materials', label: 'Materials (₦)', type: 'money', placeholder: 'Optional' },
        { id: 'reason', label: 'What did you find?', type: 'text', required: true, placeholder: 'e.g. Damaged pipe behind the wall' }
      ],
      sum: ['work', 'materials'], submit: 'Send additional cost request'
    }
  };

  function moneyOf(inputEl) {
    var n = Math.round(Number(inputEl && inputEl.value));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function showForm(kind) {
    S.view = 'form';
    var def = FORMS[kind];
    setTitle(def.title);
    var body = $('jrSheetBody');
    body.textContent = '';

    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);
    body.appendChild(el('p', 'jr-sheet-lead', def.lead));

    var inputs = {};
    def.fields.forEach(function (f) {
      var id = 'jrF_' + f.id;
      var label = el('label', 'jr-sheet-label', f.label + (f.required ? '' : ''));
      label.setAttribute('for', id);
      var inp;
      if (f.type === 'money') {
        inp = el('input', 'jr-sheet-input');
        inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '0'; inp.step = '100';
      } else {
        inp = el('textarea', 'jr-sheet-note'); inp.rows = 2; inp.maxLength = 300;
      }
      inp.id = id; inp.placeholder = f.placeholder || '';
      inputs[f.id] = inp;
      body.appendChild(label); body.appendChild(inp);
    });

    var totalBox = null;
    if (def.sum) { totalBox = el('div', 'jr-sheet-total'); body.appendChild(totalBox); }
    function refreshTotal() {
      if (!totalBox) return;
      var t = def.sum.reduce(function (a, k) { return a + moneyOf(inputs[k]); }, 0);
      totalBox.textContent = 'Total: ' + naira(t);
    }
    if (def.sum) { def.sum.forEach(function (k) { inputs[k].addEventListener('input', refreshTotal); }); refreshTotal(); }

    if (def.notice) {
      var n = el('div', 'jr-sheet-policy');
      n.appendChild(el('strong', null, 'Platform policy: '));
      n.appendChild(document.createTextNode('all payments must go through StreetTasker. Payments made outside are not covered by dispute protection and may lead to account suspension.'));
      body.appendChild(n);
    }

    var err = el('div', 'jr-sheet-error'); err.hidden = true; err.setAttribute('role', 'alert');
    body.appendChild(err);

    var send = el('button', 'jr-sheet-send', def.submit); send.type = 'button';
    send.addEventListener('click', async function () {
      err.hidden = true;
      function fail(msg) { err.textContent = msg; err.hidden = false; }
      var J = window.JRMoney;
      var amount, breakdown = null;
      if (def.sum) {
        var parts = {};
        def.sum.forEach(function (k) { var v = moneyOf(inputs[k]); if (v) parts[k] = v; });
        amount = Object.keys(parts).reduce(function (a, k) { return a + parts[k]; }, 0);
        breakdown = parts;
      } else {
        amount = moneyOf(inputs.amount);
      }
      if (!amount || amount < J.MIN_AMOUNT) return fail('Enter an amount of at least ' + naira(J.MIN_AMOUNT) + '.');
      if (amount > J.MAX_AMOUNT) return fail('That amount is too large. Check for a typing mistake.');
      var reason = inputs.reason ? inputs.reason.value.trim() : '';
      if (inputs.reason) {
        if (reason.length < 3) return fail('Please add a short explanation for the customer.');
        if (window.JRThread.hasContactInfo(reason)) {
          if (typeof window.handleContactViolation === 'function' && S.ctx) window.handleContactViolation(S.ctx.user.id);
          return fail('Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.');
        }
      }
      send.disabled = true; send.textContent = 'Sending…';
      var ok = await J.create({ kind: kind, amount: amount, reason: reason || null, breakdown: breakdown });
      if (ok) close(); else { send.disabled = false; send.textContent = def.submit; }
    });
    body.appendChild(send);
    var first = body.querySelector('input, textarea'); if (first) first.focus();
  }

  /* One-tap requests where the amount is already known (full / remaining payment) */
  function showConfirm(kind, amount) {
    S.view = 'form';
    var J = window.JRMoney;
    setTitle(J.KINDS[kind].title);
    var body = $('jrSheetBody');
    body.textContent = '';
    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);

    body.appendChild(el('div', 'jr-sheet-bigamount', naira(amount)));
    var sm = S.ctx ? J.summary(S.ctx.thread) : null;
    if (kind === 'remaining_payment' && sm) {
      var list = el('div', 'jr-money-lines');
      [['Job total', sm.total], ['Paid so far', sm.paid]].forEach(function (r) {
        var row = el('div', 'jr-money-line');
        row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, naira(r[1])));
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    body.appendChild(el('p', 'jr-sheet-lead', 'The customer will see this as a payment request and can pay it securely through StreetTasker.'));
    var err = el('div', 'jr-sheet-error'); err.hidden = true; err.setAttribute('role', 'alert');
    body.appendChild(err);
    var send = el('button', 'jr-sheet-send', 'Send request for ' + naira(amount)); send.type = 'button';
    send.addEventListener('click', async function () {
      send.disabled = true; send.textContent = 'Sending…';
      var ok = await J.create({ kind: kind, amount: amount });
      if (ok) close(); else { send.disabled = false; send.textContent = 'Send request for ' + naira(amount); }
    });
    body.appendChild(send);
  }

  /* A custom view inside the sheet: fn(body, { close, back, helpers }) fills it */
  function showView(title, fn) {
    S.view = 'form';
    setTitle(title);
    var body = $('jrSheetBody');
    body.textContent = '';
    var back = el('button', 'jr-sheet-back'); back.type = 'button';
    back.innerHTML = I.back; back.appendChild(document.createTextNode(' Back'));
    back.addEventListener('click', renderMenu);
    body.appendChild(back);
    fn(body, { close: close, back: renderMenu, el: el, naira: naira });
  }

  function openView(title, fn) {
    var layer = $('jrSheetLayer');
    if (!layer || !S.ctx) return;
    if (layer.hidden) S.opener = document.activeElement;
    layer.hidden = false;
    showView(title, fn);
    var closeBtn = $('jrSheetClose');
    if (closeBtn) closeBtn.focus();
  }

  function register(defs) {
    (Array.isArray(defs) ? defs : [defs]).forEach(function (d) {
      if (!ACTIONS.some(function (a) { return a.id === d.id; })) ACTIONS.push(d);
    });
    update();
  }

  function open() {
    var layer = $('jrSheetLayer');
    if (!layer || !S.ctx) return;
    S.opener = document.activeElement;
    renderMenu();
    layer.hidden = false;
    var closeBtn = $('jrSheetClose');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    var layer = $('jrSheetLayer');
    if (!layer) return;
    layer.hidden = true;
    if (S.opener && S.opener.focus) { try { S.opener.focus(); } catch (_e) {} }
    S.opener = null;
  }

  /* ── creating an ask ─────────────────────────────────────── */
  async function createAsk(kind, note) {
    var ctx = S.ctx;
    if (!ctx || !window.supabase) return false;
    var t = ctx.thread, me = ctx.user, sb = window.supabase;
    var toast = (window.JRThread && window.JRThread.toast) || function () {};

    if (window.JRThread && window.JRThread.pendingKinds().indexOf(kind) !== -1) {
      toast('You already have a pending request of this kind.', 'error');
      return false;
    }

    var reqRow;
    try {
      var r = await sb.from('job_requests').insert({
        thread_id: t.id, customer_id: t.customer_id, tasker_id: t.tasker_id,
        requested_by: me.id, kind: kind, note: note || null
      }).select().single();
      if (r.error) throw r.error;
      reqRow = r.data;
    } catch (e) {
      toast('Could not send the request: ' + ((e && e.message) || String(e)), 'error');
      return false;
    }

    var receiverId = me.id === t.customer_id ? t.tasker_id : t.customer_id;
    var preview = KINDS[kind].title;
    var msgRow;
    try {
      var m = await sb.from('messages').insert({
        thread_id: t.id, sender_id: me.id, receiver_id: receiverId,
        body: 'JOB_REQUEST:' + reqRow.id + ':' + kind, type: 'job_request',
        job_request_id: reqRow.id, flagged: false
      }).select().single();
      if (m.error) throw m.error;
      msgRow = m.data;
    } catch (e2) {
      /* No card means nobody would ever see the request: take it back */
      try { await sb.from('job_requests').update({ status: 'cancelled' }).eq('id', reqRow.id); } catch (_x) {}
      toast('Could not send the request: ' + ((e2 && e2.message) || String(e2)), 'error');
      return false;
    }

    /* Show it, bump the thread, tell the other person */
    window.JRThread.registerRequest(reqRow);
    window.JRThread.append(msgRow);

    var now = new Date().toISOString();
    var isCustomer = me.id === t.customer_id;
    var unreadCol = isCustomer ? 'tasker_unread' : 'customer_unread';
    var cur = isCustomer ? (t.tasker_unread || 0) : (t.customer_unread || 0);
    try {
      await sb.from('message_threads').update({ last_message: preview, last_message_at: now, [unreadCol]: cur + 1 }).eq('id', t.id);
    } catch (_e3) {}
    t.last_message = preview; t.last_message_at = now;
    if (isCustomer) t.tasker_unread = cur + 1; else t.customer_unread = cur + 1;
    if (S.onChange) S.onChange();

    try {
      var meta = me.user_metadata || {};
      await sb.from('notifications').insert({
        user_id: receiverId, type: 'new_message',
        title: preview + ' from ' + (meta.name || meta.email || 'a customer'),
        message: note ? (note.length > 80 ? note.slice(0, 80) + '…' : note) : KINDS[kind].byOther,
        data: { thread_id: t.id, sender_id: me.id, request_id: reqRow.id }, is_read: false
      });
    } catch (_e4) {}

    update();
    return true;
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function init(opts) {
    S.onChange = (opts && opts.onChange) || null;
    if (S.bound) return;
    S.bound = true;
    var btn = $('requestBtn'), layer = $('jrSheetLayer'), closeBtn = $('jrSheetClose'), back = $('jrSheetBackdrop');
    if (btn) btn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (back) back.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && layer && !layer.hidden) close();
    });
    var icon = $('jrSheetCloseIcon');
    if (icon) icon.innerHTML = I.close;
    probe().then(function () { update(); });
    probeMoney().then(function () { update(); });
  }

  window.JRRequests = { init: init, update: update, open: open, close: close, whenReady: probe, register: register, openView: openView, KINDS: KINDS };

})();

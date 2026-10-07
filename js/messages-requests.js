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
     JRRequests.KINDS                labels per request kind (also used by the cards)

   Needs the step 5 SQL (sql/messaging-step5.sql) for the "ask" actions.
   Until it has run those actions stay hidden; "Request payment" still works.

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

  var S = { ctx: null, ready: null, probe: null, onChange: null, bound: false, opener: null, view: 'menu' };

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
    back:    svg('<polyline points="15 18 9 12 15 6"/>')
  };

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

  /* ── actions registry ────────────────────────────────────────
     when(x)  x = { status, role, pending (array of pending kinds), ready }
     run(x)   called when the item is chosen                         */
  var CLOSED = ['completed', 'cancelled', 'disputed'];

  var ACTIONS = [
    {
      id: 'request_payment', roles: ['tasker'], group: 'Payment', icon: I.card,
      label: 'Request payment', hint: 'Ask the customer to pay the agreed amount',
      when: function (x) { return CLOSED.indexOf(x.status) === -1; },
      run: function () { close(); if (window.openPayModal) window.openPayModal(); }
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
    var x = { status: statusKey(), role: S.ctx.role, pending: pending, ready: S.ready === true };
    return ACTIONS.filter(function (a) {
      if (a.roles.indexOf(x.role) === -1) return false;
      if (a.needsTable && !x.ready) return false;
      return a.when(x);
    }).map(function (a) {
      var waiting = a.kind && pending.indexOf(a.kind) !== -1;
      return { action: a, disabled: !!waiting, hint: waiting ? 'Waiting for a reply' : a.hint, x: x };
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
  }

  window.JRRequests = { init: init, update: update, open: open, close: close, whenReady: probe, KINDS: KINDS };

})();

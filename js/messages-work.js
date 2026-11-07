/* ============================================================
   STREETTASKER — messages-work.js   (Job Room, step 7)
   The work lifecycle inside the conversation:
     Tasker:   I'm on my way > I've arrived > Start work > (Pause / Resume) > Mark work complete
     Customer: review the completed work > Get Release Code / Request Changes /
               Report an Issue, then share the 6-digit code with the tasker
     Tasker:   enter the code > payment released
   (spec sections 23-28, 15-17)

   Every step is done by the SERVER (sql/messaging-step7.sql + step 6a): who may do what, in what
   order, the completion code check, the activity record and the line posted in the chat. This
   file only shows the right buttons and calls ST.payments.* / supabase.rpc.

   Public API (window.JRWork), used by messages.html / messages-room.js:
     JRWork.init({ onChange })
     JRWork.update(ctx)        ctx: { thread, user, role } (JRRoom passes it on every refresh)

   Needs sql/messaging-step7.sql. Without it the work actions and the panel stay hidden
   (everything else keeps working).

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var PAUSE_REASONS = ['Waiting for materials', 'Customer unavailable', 'Weather', 'Additional approval required', 'Returning another day', 'Other'];
  var ISSUE_REASONS = ['Work not completed', 'Work is incomplete', 'Work differs from the agreement', 'Poor quality', 'Damage', 'Missing item', 'Payment issue', 'Safety concern', 'Other'];
  var LIFECYCLE = ['work_completed', 'completion_confirmed', 'changes_requested'];

  var S = { ctx: null, ready: null, probing: null, onChange: null, events: null, eventsKey: '', loading: false, bound: false, code: null, codeFor: '' };

  /* ── helpers ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function naira(n) { return window.JRMoney ? window.JRMoney.naira(n) : '₦' + Number(n || 0).toLocaleString(); }
  function toast(m, t) { if (window.JRThread) window.JRThread.toast(m, t); }
  function pay() { return window.ST && window.ST.payments; }

  function view() {
    var th = S.ctx && S.ctx.thread;
    var bk = th && th.booking ? th.booking : null;
    return {
      thread: th, booking: bk, role: S.ctx && S.ctx.role,
      bookingId: (th && th.context_type === 'booking' && th.context_id) ? th.context_id : null,
      stage: bk ? (bk.work_stage || null) : null,
      paid: !!(bk && bk.payment_status === 'paid'),
      status: bk ? bk.status : null
    };
  }

  function probe() {
    if (S.probing) return S.probing;
    S.probing = (async function () {
      try {
        var r = await window.supabase.from('job_events').select('id').limit(1);
        S.ready = !r.error;
      } catch (_e) { S.ready = false; }
      return S.ready;
    })();
    return S.probing;
  }

  /* After any action: close the sheet, show the server's chat line, refresh status + panel */
  async function after(message) {
    if (window.JRRequests) window.JRRequests.close();
    if (message) toast(message);
    var c = S.ctx;
    try { if (window.JRList && c) await window.JRList.refreshOne(c.thread, c.role); } catch (_e) {}
    try { if (window.JRThread) await window.JRThread.reload(); } catch (_e2) {}
    S.eventsKey = '';
    if (S.onChange) S.onChange();
    if (window.JRRoom) window.JRRoom.refresh();
  }

  function guardText(text, errEl) {
    if (text && window.JRThread && window.JRThread.hasContactInfo(text)) {
      if (typeof window.handleContactViolation === 'function' && S.ctx) window.handleContactViolation(S.ctx.user.id);
      errEl.textContent = 'Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.';
      errEl.hidden = false;
      return false;
    }
    return true;
  }

  /* Run an async action from a button inside the sheet */
  function runFromView(btn, errEl, label, fn, doneMessage) {
    errEl.hidden = true;
    btn.disabled = true; btn.textContent = 'Please wait…';
    fn().then(function () { return after(doneMessage); }).catch(function (e) {
      errEl.textContent = (e && e.message) || 'Something went wrong. Please try again.';
      errEl.hidden = false;
      btn.disabled = false; btn.textContent = label;
    });
  }

  function errBox() { var e = el('div', 'jr-sheet-error'); e.hidden = true; e.setAttribute('role', 'alert'); return e; }
  function sendBtn(label) { var b = el('button', 'jr-sheet-send', label); b.type = 'button'; return b; }
  function textarea(id, placeholder, rows) {
    var t = el('textarea', 'jr-sheet-note'); t.id = id; t.rows = rows || 3; t.maxLength = 300; t.placeholder = placeholder || '';
    return t;
  }
  function label(forId, text) { var l = el('label', 'jr-sheet-label', text); l.setAttribute('for', forId); return l; }

  /* ── tasker views ────────────────────────────────────────── */
  function viewSimple(title, lead, actionLabel, action, doneMsg, withNote, notePlaceholder) {
    window.JRRequests.openView(title, function (body) {
      body.appendChild(el('p', 'jr-sheet-lead', lead));
      var note = null;
      if (withNote) {
        body.appendChild(label('jrWk_note', 'Add a note (optional)'));
        note = textarea('jrWk_note', notePlaceholder, 2);
        body.appendChild(note);
      }
      var err = errBox(); body.appendChild(err);
      var b = sendBtn(actionLabel);
      b.addEventListener('click', function () {
        var v = view();
        var text = note ? note.value.trim() : '';
        if (note && !guardText(text, err)) return;
        runFromView(b, err, actionLabel, function () { return pay().jobProgress(v.bookingId, action, text); }, doneMsg);
      });
      body.appendChild(b);
    });
  }

  function viewPause() {
    window.JRRequests.openView('Pause work', function (body) {
      body.appendChild(el('p', 'jr-sheet-lead', 'Why are you pausing? The customer will see this so the task does not look stuck.'));
      var list = el('div', 'jr-radio-list');
      var chosen = null;
      PAUSE_REASONS.forEach(function (r) {
        var row = el('label', 'jr-radio');
        var input = el('input'); input.type = 'radio'; input.name = 'jrPause';
        input.addEventListener('change', function () { chosen = r; });
        row.appendChild(input); row.appendChild(el('span', null, r));
        list.appendChild(row);
      });
      body.appendChild(list);
      body.appendChild(label('jrWk_note', 'Add a note (optional)'));
      var note = textarea('jrWk_note', 'e.g. Back tomorrow at 9am', 2);
      body.appendChild(note);
      var err = errBox(); body.appendChild(err);
      var b = sendBtn('Pause work');
      b.addEventListener('click', function () {
        if (!chosen) { err.textContent = 'Please choose a reason.'; err.hidden = false; return; }
        var extra = note.value.trim();
        if (!guardText(extra, err)) return;
        var text = chosen + (extra ? ' — ' + extra : '');
        runFromView(b, err, 'Pause work', function () { return pay().jobProgress(view().bookingId, 'pause', text); }, 'Work paused');
      });
      body.appendChild(b);
    });
  }

  function viewComplete() {
    window.JRRequests.openView('Mark work complete', function (body) {
      body.appendChild(el('p', 'jr-sheet-lead', 'The customer will review your work and can then share a release code with you. Describe what you did so they can check it.'));
      body.appendChild(label('jrWk_note', 'What did you do?'));
      var note = textarea('jrWk_note', 'e.g. Replaced the burst pipe and tested it for 15 minutes with no leaks.', 4);
      body.appendChild(note);
      var err = errBox(); body.appendChild(err);
      var b = sendBtn('Submit for customer confirmation');
      b.addEventListener('click', function () {
        var text = note.value.trim();
        if (text.length < 5) { err.textContent = 'Please describe the work you did.'; err.hidden = false; return; }
        if (!guardText(text, err)) return;
        runFromView(b, err, 'Submit for customer confirmation', function () { return pay().markJobDone(view().bookingId, text); }, 'Submitted. The customer will review your work.');
      });
      body.appendChild(b);
    });
  }

  /* ── report an issue (both roles) ─────────────────────────── */
  function viewIssue() {
    window.JRRequests.openView('Report an Issue', function (body) {
      body.appendChild(el('p', 'jr-sheet-lead', 'Payment stays protected while the issue is reviewed.'));
      var list = el('div', 'jr-radio-list');
      var chosen = null;
      ISSUE_REASONS.forEach(function (r) {
        var row = el('label', 'jr-radio');
        var input = el('input'); input.type = 'radio'; input.name = 'jrIssue';
        input.addEventListener('change', function () { chosen = r; });
        row.appendChild(input); row.appendChild(el('span', null, r));
        list.appendChild(row);
      });
      body.appendChild(list);
      body.appendChild(label('jrWk_note', 'Describe the issue'));
      var note = textarea('jrWk_note', 'What happened?', 4);
      body.appendChild(note);
      var err = errBox(); body.appendChild(err);
      var b = sendBtn('Submit report');
      b.addEventListener('click', function () {
        var text = note.value.trim();
        if (!chosen) { err.textContent = 'Please choose what went wrong.'; err.hidden = false; return; }
        if (text.length < 5) { err.textContent = 'Please describe the issue.'; err.hidden = false; return; }
        if (!guardText(text, err)) return;
        runFromView(b, err, 'Submit report', function () { return pay().raiseDispute(view().bookingId, chosen + ': ' + text); }, 'Report submitted. Payment is protected while we review.');
      });
      body.appendChild(b);
    });
  }

  /* ── customer: completion protection (spec 17) ───────────────── */
  function completionNote() {
    var ev = (S.events || []).filter(function (e) { return e.kind === 'work_completed'; })[0];
    return ev && ev.note ? ev.note : '';
  }

  function viewProtection() {
    window.JRRequests.openView('Confirm completion', function (body) {
      var v = view();
      body.appendChild(el('p', 'jr-sheet-lead', 'Are you satisfied that the work has been completed?'));
      var rows = el('div', 'jr-money-lines');
      var sm = window.JRMoney ? window.JRMoney.summary(v.thread) : null;
      [['Task', v.thread._title || 'Task'],
       ['Tasker', (v.thread.tasker && v.thread.tasker.name) || 'Tasker'],
       ['Amount held', naira(sm && sm.paid ? sm.paid : (v.booking && v.booking.amount))]].forEach(function (r) {
        var row = el('div', 'jr-money-line'); row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, r[1]));
        rows.appendChild(row);
      });
      body.appendChild(rows);
      var note = completionNote();
      if (note) { body.appendChild(el('div', 'jr-req-note', note)); }
      body.appendChild(el('p', 'jr-sheet-lead', 'You will then get a 6-digit code. Give it to the tasker only when you are happy: they enter it to receive the payment.'));
      var err = errBox(); body.appendChild(err);
      var yes = sendBtn('Get Release Code');
      yes.addEventListener('click', function () {
        runFromView(yes, err, 'Get Release Code', function () { return pay().confirmJobComplete(v.bookingId); },
          'Thank you. Your completion code is shown above the chat.');
      });
      body.appendChild(yes);
      var not = el('button', 'jr-sheet-secondary', 'Not yet'); not.type = 'button';
      not.addEventListener('click', function () { window.JRRequests.close(); });
      body.appendChild(not);
      var rep = el('button', 'jr-sheet-link', 'Report an Issue'); rep.type = 'button';
      rep.addEventListener('click', viewIssue);
      body.appendChild(rep);
    });
  }

  function viewChanges() {
    window.JRRequests.openView('Request Changes', function (body) {
      body.appendChild(el('p', 'jr-sheet-lead', 'Tell the tasker what still needs to be done. The job goes back to in progress and your payment stays protected.'));
      body.appendChild(label('jrWk_note', 'What needs to change?'));
      var note = textarea('jrWk_note', 'e.g. There is still a small leak under the sink.', 4);
      body.appendChild(note);
      var err = errBox(); body.appendChild(err);
      var b = sendBtn('Send to tasker');
      b.addEventListener('click', function () {
        var text = note.value.trim();
        if (text.length < 5) { err.textContent = 'Please say what needs to change.'; err.hidden = false; return; }
        if (!guardText(text, err)) return;
        runFromView(b, err, 'Send to tasker', function () { return pay().requestJobChanges(view().bookingId, text); }, 'Sent. The tasker has been asked to fix it.');
      });
      body.appendChild(b);
    });
  }

  /* ── actions in the Request sheet ─────────────────────────── */
  var CLOSED = ['completed', 'cancelled', 'disputed', 'rejected', 'declined', 'awaiting_confirmation'];
  function active(x) {
    return S.ready === true && !!x.bookingId && !!x.booking && x.booking.status === 'confirmed' && x.booking.payment_status !== 'released';
  }
  var G = 'Work & Evidence';

  function actions() {
    return [
      { id: 'work_on_my_way', roles: ['tasker'], group: G, icon: iconPin(), label: "I'm on my way", hint: 'Tell the customer you are heading there',
        when: function (x) { return active(x) && !x.stage; },
        run: function () { viewSimple("I'm on my way", 'The customer will be told you are on the way.', "Yes, I'm on my way", 'on_my_way', 'The customer has been told you are on the way', true, 'e.g. ETA 15 minutes'); } },
      { id: 'work_arrived', roles: ['tasker'], group: G, icon: iconPin(), label: "I've arrived", hint: 'Tell the customer you are at the location',
        when: function (x) { return active(x) && (!x.stage || x.stage === 'en_route'); },
        run: function () { viewSimple("I've arrived", 'The customer will be told you have arrived.', "Yes, I've arrived", 'arrived', 'The customer has been told you have arrived', false); } },
      { id: 'work_start', roles: ['tasker'], group: G, icon: iconPlay(), label: 'Start work', hint: 'Record the time work begins',
        when: function (x) { return active(x) && (!x.stage || x.stage === 'en_route' || x.stage === 'arrived'); },
        blocked: function (x) { return x.paid ? null : 'Waiting for the customer to pay'; },
        run: function () { viewSimple('Start work', 'Start this task now? The start time is recorded.', 'Start work', 'start', 'Work started', false); } },
      { id: 'work_pause', roles: ['tasker'], group: G, icon: iconPause(), label: 'Pause work', hint: 'For jobs that take more than one visit',
        when: function (x) { return active(x) && x.stage === 'in_progress'; }, run: viewPause },
      { id: 'work_resume', roles: ['tasker'], group: G, icon: iconPlay(), label: 'Resume work', hint: 'Continue where you stopped',
        when: function (x) { return active(x) && x.stage === 'paused'; },
        run: function () { viewSimple('Resume work', 'Resume this task now?', 'Resume work', 'resume', 'Work resumed', false); } },
      { id: 'work_complete', roles: ['tasker'], group: G, icon: iconCheck(), label: 'Mark work complete', hint: 'Ask the customer to review the work',
        when: function (x) { return active(x) && x.paid && x.stage !== 'paused'; }, run: viewComplete },
      { id: 'work_release', roles: ['customer'], group: 'Payment', icon: iconCheck(), label: 'Get Release Code', hint: 'Show your 6-digit code and confirm the work is done',
        rule: function (x) {
          if (!(S.ready === true && x.bookingId && x.booking && x.paid)) return false;
          return null;
        }, run: viewProtection },
      { id: 'report_issue', roles: ['customer', 'tasker'], group: 'Issue', icon: iconFlag(), label: 'Report an Issue', hint: 'Payment stays protected while it is reviewed',
        when: function (x) {
          return !!x.bookingId && !!x.booking && x.paid && ['confirmed', 'awaiting_confirmation'].indexOf(x.booking.status) !== -1;
        }, run: viewIssue }
    ];
  }

  function svg(inner) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  function iconPin()   { return svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'); }
  function iconPlay()  { return svg('<polygon points="5 3 19 12 5 21 5 3"/>'); }
  function iconPause() { return svg('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'); }
  function iconCheck() { return svg('<polyline points="20 6 9 17 4 12"/>'); }
  function iconFlag()  { return svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'); }

  /* ── completion panel (above the conversation) ─────────────── */
  function lifecyclePhase(role) {
    var last = (S.events || []).filter(function (e) { return LIFECYCLE.indexOf(e.kind) !== -1; })[0];
    if (last) return last.kind === 'completion_confirmed' ? 'code' : 'review';
    return role === 'tasker' ? 'code' : 'review';        /* completed outside Messages (no event): old behaviour */
  }

  function row(label, value) {
    var r = el('div', 'jr-wp-row'); r.appendChild(el('span', null, label)); r.appendChild(el('strong', null, value)); return r;
  }
  function btn(text, cls, fn) { var b = el('button', 'jr-wp-btn ' + (cls || ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; }

  function paintPanel() {
    var host = $('jrWorkPanel');
    if (!host) return;
    var v = view();
    host.textContent = '';
    /* One simple flow: pay > the customer holds the code > the tasker enters it > paid.
       The tasker's code box is there as soon as the customer has paid. "On my way", "arrived" and "start work"
       stay optional in the Actions menu. The customer's code is on the pinned card (messages-flow.js). */
    var LIVE = ['confirmed', 'in_progress', 'awaiting_code', 'awaiting_confirmation'];
    if (!v.bookingId || !v.booking || !v.paid || LIVE.indexOf(v.status) === -1) { host.hidden = true; return; }
    if (v.role === 'customer' && v.status !== 'awaiting_confirmation') { host.hidden = true; return; }   /* the pinned card shows the code */
    host.hidden = false;
    var phase = lifecyclePhase(v.role);

    if (v.role === 'customer' && phase === 'review') {
      host.appendChild(el('div', 'jr-wp-title', 'Work completed'));
      host.appendChild(el('div', 'jr-wp-text', 'Review the work. When you are satisfied, get your release code.'));
      var note = completionNote();
      if (note) host.appendChild(el('div', 'jr-wp-note', note));
      var a = el('div', 'jr-wp-actions');
      a.appendChild(btn('Get Release Code', 'jr-wp-btn--primary', viewProtection));
      a.appendChild(btn('Request Changes', '', viewChanges));
      a.appendChild(btn('Report an Issue', '', viewIssue));
      host.appendChild(a);
      return;
    }

    if (v.role === 'customer') {                                   /* phase: code */
      host.appendChild(el('div', 'jr-wp-title', 'Your completion code'));
      var codeEl = el('div', 'jr-wp-code', '······');
      host.appendChild(codeEl);
      host.appendChild(el('div', 'jr-wp-text', 'Give this code to the tasker only if you are satisfied with the work. They enter it to receive the payment.'));
      var ca = el('div', 'jr-wp-actions');
      ca.appendChild(btn('Report an Issue', '', viewIssue));
      host.appendChild(ca);
      if (S.codeFor === v.bookingId && S.code) { codeEl.textContent = S.code; }
      else if (pay() && pay().getCompletionCode) {
        var wanted = v.bookingId;
        pay().getCompletionCode(wanted).then(function (c) {
          S.code = c || null; S.codeFor = wanted;
          codeEl.textContent = c ? String(c) : '—';
        }).catch(function () { codeEl.textContent = '—'; });
      }
      return;
    }

    /* tasker: the code box now lives in the docked panel above the message box (messages-dock.js); this panel only
       keeps it when that file is not loaded */
    if (window.JRDock) { host.hidden = true; return; }
    codeEntry(host, v);
  }

  /* The tasker's code box: "ask the customer for the 6-digit code once the job is done, enter it here to get paid".
     Drawn into any host element (the dock uses it). Same server call as before: ST.payments.submitCompletionCode. */
  function codeEntry(host, v) {
    v = v || view();
    var inDock = host.id === 'jrDock' || !!host.closest('#jrDock');
    host.appendChild(el('div', 'jr-wp-title', inDock ? 'Release Code' : 'Enter the release code'));
    host.appendChild(el('div', 'jr-wp-text', inDock
      ? 'Ask the customer for the release code once the job is done.'
      : 'The customer has paid and holds a 6-digit release code. When the job is done, ask them for it and enter it here to get paid.'));
    var form = el('div', 'jr-wp-form');
    var input = el('input', 'jr-code-input');
    input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 6; input.autocomplete = 'one-time-code';
    input.placeholder = '000000'; input.setAttribute('aria-label', '6-digit completion code');
    var go = btn(inDock ? 'Release Code' : 'Confirm completion', 'jr-wp-btn--primary', function () {
      var code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { err.textContent = 'Enter the 6-digit code.'; err.hidden = false; return; }
      err.hidden = true; go.disabled = true; go.textContent = 'Checking…';
      pay().submitCompletionCode(v.bookingId, code).then(function () {
        return after('Code accepted. Payment released to your wallet.').then(function () {
          /* M7: ask for the review right now (the database still decides; a closed chat does not matter) */
          if (window.STReview) window.STReview.open({ bookingId: v.bookingId });
        });
      }).catch(function (e) {
        err.textContent = (e && e.message) || 'Could not release the payment.'; err.hidden = false;
        go.disabled = false; go.textContent = inDock ? 'Release Code' : 'Confirm completion'; input.value = '';
      });
    });
    var err = el('div', 'jr-wp-error'); err.hidden = true; err.setAttribute('role', 'alert');
    form.appendChild(input); form.appendChild(go);
    host.appendChild(form); host.appendChild(err);
  }

  /* ── events + update ──────────────────────────────────────── */
  async function loadEvents(v) {
    var key = v.bookingId + '|' + v.status + '|' + (v.stage || '') + '|' + (v.thread && v.thread.last_message_at || '');
    if (key === S.eventsKey || S.loading) return false;
    S.loading = true;
    try {
      var r = await window.supabase.from('job_events')
        .select('kind,text,note,created_at,actor_id').eq('booking_id', v.bookingId)
        .order('created_at', { ascending: false }).limit(30);
      S.events = r.error ? null : (r.data || []);
      S.eventsKey = key;
      return true;
    } catch (_e) { S.events = null; return false; }
    finally { S.loading = false; }
  }

  function update(ctx) {
    if (ctx) S.ctx = ctx;
    if (!S.ctx) return;
    if (S.ready === null) { probe().then(function () { update(); }); }
    if (window.JRRequests) window.JRRequests.update();     /* work actions depend on status / stage */
    var v = view();
    paintPanel();
    if (S.ready && v.bookingId && v.status === 'awaiting_confirmation' && v.paid) {
      loadEvents(v).then(function (changed) { if (changed) paintPanel(); });
    }
  }

  function init(opts) {
    S.onChange = (opts && opts.onChange) || null;
    if (S.bound) return;
    S.bound = true;
    if (window.JRRequests) window.JRRequests.register(actions());
    probe().then(function () { update(); });
  }

  window.JRWork = { init: init, update: update, codeEntry: codeEntry };

})();

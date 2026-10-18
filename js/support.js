/* Support console (support.html).
 * Every action goes to a support_* server function, which refuses anyone who is not support.
 * This file only shows things and sends requests. It never decides who may do what, and it
 * never says money moved: refunds are made in the Paystack dashboard and only RECORDED here.
 * All text is inserted with textContent (no innerHTML), so report text cannot inject markup.
 */
(function () {
  'use strict';

  var sb = window.supabase;
  var $ = function (id) { return document.getElementById(id); };

  var CATEGORY = {
    not_done: 'Work not done', poor_quality: 'Poor quality', no_show: 'No show',
    wrong_amount: 'Wrong amount', payment_issue: 'Payment issue', other: 'Other'
  };
  var OUTCOME = {
    refund_full: 'Full refund', refund_partial: 'Partial refund',
    release_to_tasker: 'Tasker is paid, no refund', split: 'Part refunded, rest to Tasker', no_action: 'No action'
  };
  var STATUS = { open: 'Open', under_review: 'Under review', resolved: 'Resolved', withdrawn: 'Withdrawn' };
  var EVENT = {
    opened: 'Report opened', under_review: 'Review started', withdrawn: 'Withdrawn', resolved: 'Decision sent',
    refund_recorded: 'Refund recorded', evidence_removed: 'File removed'
  };
  var REFUND_OUTCOMES = ['refund_full', 'refund_partial', 'split'];

  var state = { filter: 'live', list: [], selected: null };

  /* ---------- small helpers ---------- */
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function naira(n) {
    var v = Number(n) || 0;
    return 'NGN ' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return String(t || ''); } }
  function short(id) { return id ? String(id).slice(0, 8) : '-'; }
  function size(b) { var n = Number(b) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function badge(status) {
    var cls = status === 'open' ? 'badge badge-amber' : status === 'under_review' ? 'badge badge-blue'
            : status === 'resolved' ? 'badge badge-green' : 'badge badge-gray';
    return h('span', cls, STATUS[status] || status);
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('spToast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }
  function setState(msg) { var s = $('spState'); s.textContent = msg; s.hidden = false; }
  function isLive(d) { return d.status === 'open' || d.status === 'under_review'; }

  /* The server returns { ok, error } for every action. Anything else is shown as a failure. */
  async function call(name, args) {
    try {
      var r = await sb.rpc(name, args || {});
      if (r.error) return { ok: false, error: r.error.message || 'Request failed.' };
      var d = r.data;
      if (d && typeof d === 'object' && 'ok' in d) return d;
      return { ok: false, error: 'Unexpected reply from the server.' };
    } catch (e) { return { ok: false, error: 'Could not reach the server.' }; }
  }

  /* ---------- list ---------- */
  async function loadList() {
    var q = await sb.from('job_disputes')
      .select('id,thread_id,status,category,outcome,opened_by_role,opened_at,reason')
      .order('opened_at', { ascending: false }).limit(200);
    if (q.error) { setState('Could not load reports: ' + q.error.message); return; }
    state.list = q.data || [];
    renderList();
  }
  function renderList() {
    var ul = $('spList'); ul.textContent = '';
    var rows = state.list.filter(function (d) {
      return state.filter === 'all' ? true : state.filter === 'live' ? isLive(d) : !isLive(d);
    });
    if (!rows.length) { add(ul, add(h('li'), h('p', 'sp-state', 'Nothing here.'))); }
    rows.forEach(function (d) {
      var b = h('button', 'sp-item'); b.type = 'button'; b.setAttribute('data-id', d.id);
      if (state.selected === d.id) b.setAttribute('aria-current', 'true');
      add(b,
        add(h('span', 'sp-item-top'), h('span', 'sp-item-cat', CATEGORY[d.category] || d.category), badge(d.status)),
        h('span', 'sp-item-meta', 'By the ' + d.opened_by_role + ' · ' + when(d.opened_at)),
        h('span', 'sp-item-text', d.reason));
      b.addEventListener('click', function () { select(d.id); });
      add(ul, add(h('li'), b));
    });
    Array.prototype.forEach.call($('spFilter').querySelectorAll('button'), function (btn) {
      var on = btn.getAttribute('data-f') === state.filter;
      btn.className = 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost');
    });
  }

  /* ---------- detail ---------- */
  async function select(id) {
    state.selected = id; renderList();
    var box = $('spDetail'); box.textContent = ''; add(box, h('p', 'sp-state', 'Loading…'));
    var d = state.list.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    var res = await Promise.all([
      call('support_dispute_context', { p_dispute: id }),
      sb.from('dispute_events').select('id,kind,note,actor_id,created_at').eq('dispute_id', id).order('created_at', { ascending: true }),
      sb.from('job_refunds').select('id,amount,paystack_ref,note,created_at').eq('thread_id', d.thread_id).order('created_at', { ascending: true }),
      sb.from('job_attachments').select('id,kind,storage_path,mime,size,created_at,uploader_id').eq('thread_id', d.thread_id).order('created_at', { ascending: true }),
      sb.from('job_disputes').select('status,outcome,resolution_note,resolved_at').eq('id', id).maybeSingle()
    ]);
    if (state.selected !== id) return;                 // the person clicked another report meanwhile
    var ctx = res[0];
    if (!ctx.ok) { box.textContent = ''; add(box, h('p', 'sp-error', ctx.error)); return; }
    if (res[4] && res[4].data) { Object.assign(d, res[4].data); }
    renderDetail(d, ctx, res[1].data || [], res[2].data || [], res[3].data || []);
  }

  function panel(title) {
    var p = h('section', 'card sp-panel');
    if (title) add(p, h('h2', 'sp-h', title));
    return p;
  }
  function kv(pairs) {
    var dl = h('dl', 'sp-kv');
    pairs.forEach(function (p) { add(dl, h('dt', null, p[0]), h('dd', null, p[1])); });
    return dl;
  }

  function renderDetail(d, ctx, events, refunds, files) {
    var box = $('spDetail'); box.textContent = '';

    // 1. the report
    var p1 = panel('Report');
    add(p1,
      add(h('div', 'sp-row'), h('strong', null, CATEGORY[d.category] || d.category), badge(d.status)),
      h('p', 'sp-text', d.reason),
      kv([['Opened by', 'The ' + d.opened_by_role + ' · ' + when(d.opened_at)],
          ['Customer', short(ctx.customer_id)], ['Tasker', short(ctx.tasker_id)],
          ['Thread', short(d.thread_id)],
          ['Linked payment', d.payment_request_id ? short(d.payment_request_id) : 'None']]));
    if (d.status === 'resolved') {
      add(p1, h('p', 'sp-meta', 'Decision: ' + (OUTCOME[d.outcome] || d.outcome) + ' · ' + when(d.resolved_at)),
              h('p', 'sp-text', d.resolution_note));
    }
    add(box, p1);

    // 2. money
    var p2 = panel('Money on this job (records, not a live balance)');
    add(p2, kv([['Paid', naira(ctx.paid)], ['Refund records', naira(ctx.refunded)], ['Still refundable', naira(ctx.refundable)]]));
    if (!(Number(ctx.paid) > 0)) add(p2, h('p', 'sp-warn', 'No paid payment is recorded on this job, so no refund can be recorded.'));
    add(p2, h('p', 'sp-hint', 'A dispute does not freeze release yet. Check the booking in the Paystack dashboard before deciding.'));
    add(box, p2);

    // 3. actions
    if (isLive(d)) add(box, decisionPanel(d, ctx));
    else if (d.status === 'resolved' && REFUND_OUTCOMES.indexOf(d.outcome) !== -1) add(box, extraRefundPanel(d, ctx));

    // 4. refunds
    var p4 = panel('Refund records');
    if (!refunds.length) add(p4, h('p', 'sp-meta', 'None recorded.'));
    else {
      var ul = h('ul', 'sp-sub');
      refunds.forEach(function (r) {
        add(ul, add(h('li'), h('span', null, naira(r.amount)), h('span', 'sp-meta', r.paystack_ref + ' · ' + when(r.created_at))));
      });
      add(p4, ul);
    }
    add(box, p4);

    // 5. evidence
    add(box, evidencePanel(d, ctx, files));

    // 6. history
    var p6 = panel('History');
    var ev = h('ul', 'sp-sub');
    events.forEach(function (e) {
      add(ev, add(h('li'), h('span', null, (EVENT[e.kind] || e.kind) + (e.note ? ' · ' + e.note : '')), h('span', 'sp-meta', when(e.created_at))));
    });
    add(p6, ev); add(box, p6);
  }

  /* ---------- decision ---------- */
  function field(label, input) {
    var g = h('div', 'form-group');
    var l = h('label', 'form-label', label);
    if (input.id) l.setAttribute('for', input.id);
    return add(g, l, input);
  }
  function input(id, type, cls) { var i = h('input', cls || 'form-input'); i.id = id; i.type = type; return i; }
  function errBox() { var p = h('p', 'sp-error'); p.hidden = true; p.setAttribute('role', 'alert'); return p; }
  function showErr(p, msg) { p.textContent = msg; p.hidden = !msg; }
  function parseAmount(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; }

  function decisionPanel(d, ctx) {
    var p = panel('Decision');
    if (d.status === 'open') {
      var row = h('div', 'sp-actions');
      var rb = h('button', 'btn btn-sm btn-outline', 'Start review'); rb.type = 'button'; rb.id = 'spStartReview';
      rb.addEventListener('click', async function () {
        rb.disabled = true;
        var r = await call('support_start_review', { p_dispute: d.id });
        if (!r.ok) { rb.disabled = false; toast(r.error); return; }
        toast('Review started. Both people can see it is under review.');
        await refresh(d.id);
      });
      add(p, add(row, rb), h('p', 'sp-hint', 'Starting a review stops the person from withdrawing the report.'));
    }

    var f = h('form', 'sp-form'); f.id = 'spResolve'; f.noValidate = true;
    var sel = h('select', 'form-select'); sel.id = 'spOutcome';
    Object.keys(OUTCOME).forEach(function (k) { var o = h('option', null, OUTCOME[k]); o.value = k; add(sel, o); });
    var note = h('textarea', 'form-textarea'); note.id = 'spNote'; note.maxLength = 1000;
    var refundBox = h('div', 'sp-form'); refundBox.id = 'spRefundBox';
    var amt = input('spAmount', 'text'); amt.setAttribute('inputmode', 'decimal');
    var ref = input('spRef', 'text'); ref.maxLength = 100;
    var rnote = input('spRefundNote', 'text'); rnote.maxLength = 500;
    add(refundBox,
      h('p', 'sp-hint', 'Refund in the Paystack dashboard first. This only records it. Most you can record: ' + naira(ctx.refundable) + '.'),
      field('Refunded amount (NGN)', amt), field('Paystack refund reference', ref), field('Internal note (optional)', rnote));
    function syncRefund() { refundBox.hidden = REFUND_OUTCOMES.indexOf(sel.value) === -1; }
    sel.addEventListener('change', syncRefund); syncRefund();
    var err = errBox();
    var go = h('button', 'btn btn-primary', 'Send decision'); go.type = 'submit';
    add(f, field('Outcome', sel), field('Decision note (both people will read this)', note), refundBox, err, go);
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); showErr(err, '');
      var outcome = sel.value, needs = REFUND_OUTCOMES.indexOf(outcome) !== -1;
      var args = { p_dispute: d.id, p_outcome: outcome, p_note: note.value.trim() };
      if (args.p_note.length < 10) { showErr(err, 'Write the decision note (at least 10 characters).'); return; }
      if (needs) {
        var n = parseAmount(amt.value);
        if (!(n > 0)) { showErr(err, 'Enter the refunded amount.'); return; }
        if (n > Number(ctx.refundable)) { showErr(err, 'That is more than can still be refunded (' + naira(ctx.refundable) + ').'); return; }
        if (ref.value.trim().length < 3) { showErr(err, 'Enter the Paystack refund reference.'); return; }
        args.p_refund_amount = n; args.p_refund_ref = ref.value.trim();
        if (rnote.value.trim()) args.p_refund_note = rnote.value.trim();
      }
      if (!window.confirm('Send this decision to both people? It cannot be undone.')) return;
      go.disabled = true;
      var r = await call('support_resolve_dispute', args);
      go.disabled = false;
      if (!r.ok) { showErr(err, r.error); return; }
      toast('Decision sent.');
      await refresh(d.id);
    });
    return add(p, f);
  }

  function extraRefundPanel(d, ctx) {
    var p = panel('Record another refund');
    var f = h('form', 'sp-form'); f.id = 'spExtra'; f.noValidate = true;
    var amt = input('spXAmount', 'text'); amt.setAttribute('inputmode', 'decimal');
    var ref = input('spXRef', 'text'); ref.maxLength = 100;
    var err = errBox();
    var go = h('button', 'btn btn-sm btn-outline', 'Record refund'); go.type = 'submit';
    add(f, h('p', 'sp-hint', 'Refund in Paystack first. Still refundable: ' + naira(ctx.refundable) + '.'),
      field('Refunded amount (NGN)', amt), field('Paystack refund reference', ref), err, go);
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); showErr(err, '');
      var n = parseAmount(amt.value);
      if (!(n > 0)) { showErr(err, 'Enter the refunded amount.'); return; }
      if (ref.value.trim().length < 3) { showErr(err, 'Enter the Paystack refund reference.'); return; }
      go.disabled = true;
      var r = await call('support_record_refund', { p_dispute: d.id, p_amount: n, p_ref: ref.value.trim() });
      go.disabled = false;
      if (!r.ok) { showErr(err, r.error); return; }
      toast('Refund recorded.'); await refresh(d.id);
    });
    return add(p, f);
  }

  /* ---------- evidence ---------- */
  function evidencePanel(d, ctx, files) {
    var p = panel('Evidence files');
    var removed = {};
    (ctx.removals || []).forEach(function (r) { removed[r.attachment_id] = r; });
    if (!files.length) { add(p, h('p', 'sp-meta', 'No files on this job.')); return p; }
    var ul = h('ul', 'sp-sub');
    files.forEach(function (a) {
      var li = h('li'); var rem = removed[a.id];
      var label = h('span', rem ? 'sp-removed' : null,
        (a.kind || 'file') + ' · ' + size(a.size) + ' · ' + when(a.created_at) + (rem ? ' · removed (' + rem.reason + ')' : ''));
      add(li, label);
      var acts = h('span', 'sp-actions');
      var open = h('button', 'btn btn-sm btn-ghost', 'Open'); open.type = 'button';
      open.addEventListener('click', async function () {
        var s = await sb.storage.from('job-evidence').createSignedUrl(a.storage_path, 120);   // short-lived
        if (s.error || !s.data || !s.data.signedUrl) { toast('Could not open the file.'); return; }
        window.open(s.data.signedUrl, '_blank', 'noopener');
      });
      add(acts, open);
      if (!rem) {
        var rm = h('button', 'btn btn-sm btn-outline', 'Remove'); rm.type = 'button';
        rm.addEventListener('click', function () { removeForm(li, a, d); });
        add(acts, rm);
      }
      add(li, acts); add(ul, li);
    });
    return add(p, ul);
  }
  function removeForm(li, a, d) {
    if (li.querySelector('form')) return;
    var f = h('form', 'sp-form'); f.noValidate = true;
    var why = input('spWhy-' + a.id, 'text'); why.maxLength = 500;
    var err = errBox();
    var go = h('button', 'btn btn-sm btn-primary', 'Remove file'); go.type = 'submit';
    var no = h('button', 'btn btn-sm btn-ghost', 'Cancel'); no.type = 'button';
    no.addEventListener('click', function () { f.remove(); });
    add(f, h('p', 'sp-hint', 'The two people stop seeing this file. The reason stays internal. The file itself is purged later in the Storage dashboard.'),
      field('Reason (internal, 5 to 500 characters)', why), err, add(h('div', 'sp-actions'), go, no));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); showErr(err, '');
      if (why.value.trim().length < 5) { showErr(err, 'Give a reason (at least 5 characters).'); return; }
      go.disabled = true;
      var r = await call('support_remove_evidence', { p_attachment: a.id, p_reason: why.value.trim() });
      go.disabled = false;
      if (!r.ok) { showErr(err, r.error); return; }
      toast('File removed from view.'); await select(d.id);
    });
    add(li, f);
  }

  /* ---------- orphans ---------- */
  async function loadOrphans() {
    var body = $('spOrphanBody'); body.textContent = 'Loading…';
    var r = await sb.rpc('support_list_orphan_uploads');
    body.textContent = '';
    if (r.error) { add(body, h('p', 'sp-error', r.error.message)); return; }
    var rows = r.data || [];
    if (!rows.length) { add(body, h('p', 'sp-meta', 'None older than 1 hour.')); return; }
    var ul = h('ul', 'sp-sub');
    rows.forEach(function (o) { add(ul, add(h('li'), h('span', null, o.name), h('span', 'sp-meta', size(o.size) + ' · ' + when(o.created_at)))); });
    add(body, h('p', 'sp-hint', 'Delete these in the Storage dashboard (bucket job-evidence).'), ul);
  }

  async function refresh(id) { await loadList(); await select(id); }

  /* ---------- start ---------- */
  async function init() {
    if (!sb || !sb.auth) { setState('Could not connect.'); return; }
    var s = await sb.auth.getSession();
    var user = s && s.data && s.data.session && s.data.session.user;
    if (!user) { setState('Please log in with a support account.'); return; }
    var who = $('spWho'); who.textContent = user.email || short(user.id);
    var r = await sb.rpc('_is_support');
    if (r.error || r.data !== true) { setState('This page is for support staff only.'); return; }
    $('spState').hidden = true; $('spApp').hidden = false;
    Array.prototype.forEach.call($('spFilter').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { state.filter = b.getAttribute('data-f'); renderList(); });
    });
    $('spOrphans').addEventListener('toggle', function () { if (this.open) loadOrphans(); });
    await loadList();
  }
  document.addEventListener('DOMContentLoaded', init);
})();

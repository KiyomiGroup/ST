/* StreetTasker Admin: Disputes (stage A13, spec S12). Moves the support console into the admin frame.
   READS use the existing support_* functions and the staff read policies (both open to an admin who holds disputes.manage,
   because A13 extends _is_support()). WRITES go through admin_dispute_* (A13 SQL): each checks the permission, calls the
   existing support_* function, and adds a row to the admin activity log. This page never decides who may do what and never
   says money moved: refunds are made in the Paystack dashboard and only RECORDED here (hard boundary 1).
   All text is inserted with textContent, so report text and chat cannot inject markup. support.html is left working. */
'use strict';
AdminShell.init({ page: 'disputes', title: 'Disputes', permission: 'disputes.manage' }).then(function (ctx) {
  var sb = window.supabase;
  var $ = function (id) { return document.getElementById(id); };
  var canRefund = ctx.has('disputes.refund.record');

  var CATEGORY = { not_done: 'Work not done', poor_quality: 'Poor quality', no_show: 'No show', wrong_amount: 'Wrong amount', payment_issue: 'Payment issue', other: 'Other' };
  var OUTCOME = { refund_full: 'Full refund', refund_partial: 'Partial refund', release_to_tasker: 'Tasker is paid, no refund', split: 'Part refunded, rest to Tasker', no_action: 'No action' };
  var STATUS = { open: 'Open', under_review: 'Under review', resolved: 'Resolved', withdrawn: 'Withdrawn' };
  var EVENT = { opened: 'Report opened', under_review: 'Review started', withdrawn: 'Withdrawn', resolved: 'Decision sent', refund_recorded: 'Refund recorded', evidence_removed: 'File removed', chat_viewed: 'Support read the conversation' };
  var SETTLE = {
    refunded_all: 'The held money was refunded and the booking was cancelled.',
    partial_then_released: 'The refund was taken out of the held money and the rest was released to the Tasker.',
    released: 'The held money was released to the Tasker.',
    unfrozen: 'The report is closed. Payment can continue normally.',
    nothing_held: 'No money is held on this job (it was already released or paid another way). Settle it by hand.',
    booking_not_paid: 'The booking was not paid, so nothing was released.',
    no_booking: 'This conversation has no booking, so no held money was changed.'
  };
  var OUTCOME_HINT = {
    refund_full: 'Everything held goes back to the customer (refund it in Paystack first) and the booking is cancelled.',
    refund_partial: 'The refund is taken out of the held money, the platform fee is reduced in proportion, and the rest is released to the Tasker now.',
    split: 'Same as a partial refund: refund part, the rest is released to the Tasker now.',
    release_to_tasker: 'All held money is released to the Tasker now.',
    no_action: 'Nothing changes. Payment is no longer on hold and the job continues.'
  };
  var PAGE = 50;
  var REFUND_OUTCOMES = ['refund_full', 'refund_partial', 'split'];
  var FILTER_ARG = { live: 'needs_action', resolved: 'closed', all: 'all' };
  var state = { filter: 'live', list: [], total: 0, selected: null, search: '', loadId: 0 };

  $('adDisputes').hidden = false;

  /* ---------- small helpers ---------- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function naira(n) { var v = Number(n) || 0; return 'NGN ' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function when(t) { var d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function short(id) { return id ? String(id).slice(0, 8) : '-'; }
  function size(b) { var n = Number(b) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function isLive(d) { return d.status === 'open' || d.status === 'under_review'; }
  function badge(status) {
    var cls = status === 'open' ? 'badge badge-amber' : status === 'under_review' ? 'badge badge-blue' : status === 'resolved' ? 'badge badge-green' : 'badge badge-gray';
    return h('span', cls, STATUS[status] || status);
  }
  function parseAmount(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; }

  /* Every support_* and admin_dispute_* function answers { ok, error }. Anything else is shown as a failure. */
  async function call(name, args) {
    try {
      var r = await sb.rpc(name, args || {});
      if (r.error) {
        if (r.error.code === '42501') return { ok: false, error: 'You do not have permission to do this.' };
        if (r.error.code === '42883' || r.error.code === 'PGRST202') return { ok: false, missing: true, error: 'A server function is missing. Run sql/admin/a13-disputes.sql in the Supabase SQL editor.' };
        return { ok: false, error: r.error.message || 'Request failed.' };
      }
      var d = r.data;
      if (d && typeof d === 'object' && 'ok' in d) return d;
      return { ok: false, error: 'Unexpected reply from the server.' };
    } catch (e) { return { ok: false, error: 'Could not reach the server.' }; }
  }

  /* ---------- list ---------- */
  async function loadList(more) {
    var mine = ++state.loadId;
    var offset = more ? state.list.length : 0;
    if (!more) { clear($('dpList')); $('dpList').appendChild(ctx.skeleton(4)); }
    var r = await call('support_list_disputes', { p_filter: FILTER_ARG[state.filter] || 'needs_action', p_search: state.search || null, p_limit: PAGE, p_offset: offset });
    if (mine !== state.loadId) return;
    if (!r.ok) {
      ctx.showError($('dpList'), r.missing ? r.error : (r.error === 'Not allowed.' || /permission|allowed/i.test(r.error) ? 'The server did not accept your access to disputes. If you have just been given the role, run sql/admin/a13-disputes.sql and sign in again.' : 'The reports could not be loaded: ' + r.error), function () { loadList(false); });
      $('dpCount').textContent = ''; $('dpMoreRow').hidden = true;
      return;
    }
    state.total = Number(r.total) || 0;
    state.list = more ? state.list.concat(r.items || []) : (r.items || []);
    renderList();
  }
  function renderList() {
    var box = $('dpList'); clear(box);
    if (!state.list.length) {
      if (state.search) ctx.showNoResults(box); else ctx.showEmpty(box, state.filter === 'live' ? 'No report needs action right now.' : 'No reports in this view.');
    } else {
      var ul = h('ul', 'ad-rows');
      state.list.forEach(function (d) {
        var b = h('button', 'ad-row'); b.type = 'button'; b.setAttribute('data-id', d.id);
        if (state.selected === d.id) b.setAttribute('aria-current', 'true');
        var top = add(h('span', 'ad-row-top'), h('span', 'ad-row-title', CATEGORY[d.category] || d.category || 'Report'), badge(d.status));
        if (d.overdue) add(top, h('span', 'badge badge-amber', 'Overdue'));
        add(b, top,
          h('span', 'ad-row-sub', (d.customer_name || 'Customer') + ' · ' + (d.tasker_name || 'Tasker')),
          h('span', 'ad-hint', 'By the ' + d.opened_by_role + ' · ' + when(d.opened_at)),
          h('span', 'ad-row-text', d.reason));
        b.addEventListener('click', function () { select(d.id); });
        add(ul, add(h('li'), b));
      });
      box.appendChild(ul);
    }
    $('dpMoreRow').hidden = state.list.length >= state.total;
    $('dpMore').textContent = 'Show more (' + Math.max(0, state.total - state.list.length) + ' left)';
    $('dpCount').textContent = state.total + (state.total === 1 ? ' report' : ' reports');
    Array.prototype.forEach.call($('dpFilter').querySelectorAll('button'), function (btn) {
      var on = btn.getAttribute('data-f') === state.filter;
      btn.className = 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'); btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- detail ---------- */
  function showDetailColumn(on) { document.querySelector('.ad-split').classList.toggle('is-detail', !!on); $('dpBack').hidden = !on; }
  async function select(id) {
    state.selected = id; renderList(); showDetailColumn(true);
    var box = $('dpDetail'); clear(box); box.appendChild(ctx.skeleton(4));
    var d = state.list.filter(function (x) { return x.id === id; })[0];
    if (!d) { clear(box); ctx.showEmpty(box, 'This report is not in the current list. Change the filter or search.'); return; }
    var res;
    try {
      res = await Promise.all([
        call('support_dispute_context', { p_dispute: id }),
        sb.from('dispute_events').select('id,kind,note,actor_id,created_at').eq('dispute_id', id).order('created_at', { ascending: true }),
        sb.from('job_refunds').select('id,amount,paystack_ref,note,created_at').eq('thread_id', d.thread_id).order('created_at', { ascending: true }),
        sb.from('job_attachments').select('id,kind,storage_path,mime,size,created_at,uploader_id').eq('thread_id', d.thread_id).order('created_at', { ascending: true }),
        sb.from('job_disputes').select('status,outcome,resolution_note,resolved_at').eq('id', id).maybeSingle()
      ]);
    } catch (e) { if (state.selected === id) { ctx.showError(box, 'The report could not be loaded. Nothing was changed.', function () { select(id); }); } return; }
    if (state.selected !== id) return;                       /* another report was chosen meanwhile */
    var ctxr = res[0];
    if (!ctxr.ok) { ctx.showError(box, ctxr.error, function () { select(id); }); return; }
    var failedRead = [res[1], res[2], res[3]].some(function (x) { return x && x.error; });
    if (res[4] && res[4].data) Object.assign(d, res[4].data);
    renderDetail(d, ctxr, (res[1] && res[1].data) || [], (res[2] && res[2].data) || [], (res[3] && res[3].data) || [], failedRead);
  }

  function panel(title) { var p = h('section', 'ad-card ad-panel'); if (title) add(p, h('h2', 'ad-panel-title', title)); return p; }
  function kv(pairs) { var dl = h('dl', 'ad-dl'); pairs.forEach(function (p) { add(dl, h('dt', null, p[0]), h('dd', null, p[1])); }); return dl; }

  function renderDetail(d, c, events, refunds, files, failedRead) {
    var box = $('dpDetail'); clear(box);
    if (failedRead) add(box, h('div', 'ad-banner', 'Some parts of this report (history, refund records or files) could not be read. What is shown may be incomplete.'));

    var p1 = panel('Report');
    add(p1, add(h('div', 'ad-row-top'), h('strong', null, CATEGORY[d.category] || d.category), badge(d.status), d.overdue && isLive(d) ? h('span', 'badge badge-amber', 'Overdue') : null),
      h('p', 'ad-text', d.reason),
      kv([['Opened by', 'The ' + d.opened_by_role + ' · ' + when(d.opened_at)],
          ['Customer', (c.customer_name || '') + ' (' + short(c.customer_id) + ')'],
          ['Tasker', (c.tasker_name || '') + ' (' + short(c.tasker_id) + ')'],
          ['Thread', short(d.thread_id)],
          ['Linked payment', d.payment_request_id ? short(d.payment_request_id) : 'None']]));
    if (d.status === 'resolved') add(p1, h('p', 'ad-hint', 'Decision: ' + (OUTCOME[d.outcome] || d.outcome) + ' · ' + when(d.resolved_at)), h('p', 'ad-text', d.resolution_note));
    add(box, p1);

    var p2 = panel('Money on this job (records, not a live balance)');
    add(p2, kv([['Paid', naira(c.paid)], ['Refund records', naira(c.refunded)], ['Still refundable', naira(c.refundable)]]));
    if (!(Number(c.paid) > 0)) add(p2, h('p', 'ad-banner', 'No paid payment is recorded on this job, so no refund can be recorded.'));
    if (isLive(d)) add(p2, h('p', 'ad-banner ad-banner--info', 'Payment is on hold. Nothing can be released, no code can be used and no new payment request can be sent until this report is decided or withdrawn.'));
    if (d.overdue) add(p2, h('p', 'ad-banner', 'This report has been open for more than 7 days.'));
    add(box, p2);

    if (isLive(d)) add(box, decisionPanel(d, c));
    else if (d.status === 'resolved' && REFUND_OUTCOMES.indexOf(d.outcome) !== -1 && canRefund) add(box, extraRefundPanel(d, c));

    var p4 = panel('Refund records');
    if (!refunds.length) add(p4, h('p', 'ad-hint', 'None recorded.'));
    else { var ul = h('ul', 'ad-sub'); refunds.forEach(function (r) { add(ul, add(h('li'), h('span', null, naira(r.amount)), h('span', 'ad-hint', r.paystack_ref + ' · ' + when(r.created_at)))); }); add(p4, ul); }
    add(box, p4);

    add(box, evidencePanel(d, c, files), chatPanel(d));

    var p6 = panel('History'); var ev = h('ul', 'ad-sub');
    events.forEach(function (e) { add(ev, add(h('li'), h('span', null, (EVENT[e.kind] || e.kind) + (e.note ? ' · ' + e.note : '')), h('span', 'ad-hint', when(e.created_at)))); });
    if (!events.length) add(p6, h('p', 'ad-hint', 'No history rows.'));
    add(p6, ev); add(box, p6);
  }

  /* ---------- conversation (read only, logged twice: dispute history and admin log) ---------- */
  function chatPanel(d) {
    var p = panel('Conversation'); var body = h('div'); body.id = 'dpChat';
    var btn = h('button', 'btn ad-btn-small', 'Read the conversation'); btn.type = 'button'; btn.id = 'dpReadChat';
    add(p, h('p', 'ad-hint', 'Reading is logged in the report history and in the activity log, and both people can see that support read it. Read it only to decide this report.'), add(h('div', 'ad-actions'), btn), body);
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      var r = await call('admin_dispute_read_chat', { p_dispute: d.id, p_limit: '200' });
      btn.disabled = false; clear(body);
      if (!r.ok) { add(body, h('p', 'ad-error', r.error)); return; }
      var msgs = r.messages || [];
      if (!msgs.length) { add(body, h('p', 'ad-hint', 'No messages.')); return; }
      var ul = h('ul', 'ad-sub');
      msgs.forEach(function (m) { add(ul, add(h('li'), h('span', null, (m.sender_name || 'User') + ': ' + (m.body || '')), h('span', 'ad-hint', when(m.created_at)))); });
      add(body, ul); btn.textContent = 'Refresh the conversation';
    });
    return p;
  }

  /* ---------- decision ---------- */
  function field(label, input) { var g = h('div', 'ad-field'); var l = h('label', null, label); if (input.id) l.setAttribute('for', input.id); return add(g, l, input); }
  function input(id, type) { var i = h('input', 'form-input'); i.id = id; i.type = type; return i; }
  function errBox() { var p = h('p', 'ad-error'); p.hidden = true; p.setAttribute('role', 'alert'); return p; }
  function showErr(p, msg) { p.textContent = msg; p.hidden = !msg; }

  function decisionPanel(d, c) {
    var p = panel('Decision');
    if (d.status === 'open') {
      var rb = h('button', 'btn ad-btn-small', 'Start review'); rb.type = 'button'; rb.id = 'dpStartReview';
      rb.addEventListener('click', async function () {
        rb.disabled = true;
        var r = await call('admin_dispute_start_review', { p_dispute: d.id });
        if (!r.ok) { rb.disabled = false; ctx.toast(r.error, 'error'); return; }
        ctx.toast('Review started. Both people can see it is under review.'); await refresh(d.id);
      });
      add(p, add(h('div', 'ad-actions'), rb), h('p', 'ad-hint', 'Starting a review stops the person from withdrawing the report.'));
    }
    var f = h('form', 'ad-form'); f.id = 'dpResolve'; f.noValidate = true;
    var sel = h('select', 'form-input'); sel.id = 'dpOutcome';
    Object.keys(OUTCOME).forEach(function (k) {
      if (!canRefund && REFUND_OUTCOMES.indexOf(k) !== -1) return;   /* the server refuses it anyway; do not offer it */
      var o = h('option', null, OUTCOME[k]); o.value = k; add(sel, o);
    });
    var note = h('textarea', 'form-input'); note.id = 'dpNote'; note.maxLength = 1000; note.rows = 4;
    var refundBox = h('div', 'ad-form'); refundBox.id = 'dpRefundBox';
    var amt = input('dpAmount', 'text'); amt.setAttribute('inputmode', 'decimal');
    var ref = input('dpRef', 'text'); ref.maxLength = 100;
    var rnote = input('dpRefundNote', 'text'); rnote.maxLength = 500;
    add(refundBox, h('p', 'ad-hint', 'Refund in the Paystack dashboard first. This only records it. Most you can record: ' + naira(c.refundable) + '.'),
      field('Refunded amount (NGN)', amt), field('Paystack refund reference', ref), field('Internal note (optional)', rnote));
    var hint = h('p', 'ad-hint'); hint.id = 'dpOutcomeHint';
    function sync() { refundBox.hidden = REFUND_OUTCOMES.indexOf(sel.value) === -1; hint.textContent = OUTCOME_HINT[sel.value] || ''; }
    sel.addEventListener('change', sync); sync();
    var err = errBox();
    var go = h('button', 'btn btn-primary', 'Send decision'); go.type = 'submit';
    add(f, field('Outcome', sel), hint, field('Decision note (both people will read this)', note), refundBox, err, go);
    if (!canRefund) add(f, h('p', 'ad-hint', 'Refund outcomes are not offered because your role does not include recording refunds.'));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); showErr(err, '');
      var outcome = sel.value, needs = REFUND_OUTCOMES.indexOf(outcome) !== -1;
      var args = { p_dispute: d.id, p_outcome: outcome, p_note: note.value.trim() };
      if (args.p_note.length < 10) { showErr(err, 'Write the decision note (at least 10 characters).'); return; }
      if (needs) {
        var n = parseAmount(amt.value);
        if (!(n > 0)) { showErr(err, 'Enter the refunded amount.'); return; }
        if (n > Number(c.refundable)) { showErr(err, 'That is more than can still be refunded (' + naira(c.refundable) + ').'); return; }
        if (ref.value.trim().length < 3) { showErr(err, 'Enter the Paystack refund reference.'); return; }
        args.p_refund_amount = String(n); args.p_refund_ref = ref.value.trim();
        if (rnote.value.trim()) args.p_refund_note = rnote.value.trim();
      }
      if (!window.confirm('Send this decision to both people? ' + (OUTCOME_HINT[outcome] || '') + ' It cannot be undone.')) return;
      go.disabled = true;
      var r = await call('admin_dispute_resolve', args);
      go.disabled = false;
      if (!r.ok) { showErr(err, r.error); return; }
      var act = r.settlement && r.settlement.action;
      ctx.toast('Decision sent. ' + (SETTLE[act] || '')); await refresh(d.id);
    });
    return add(p, f);
  }

  function extraRefundPanel(d, c) {
    var p = panel('Record another refund');
    var f = h('form', 'ad-form'); f.id = 'dpExtra'; f.noValidate = true;
    var amt = input('dpXAmount', 'text'); amt.setAttribute('inputmode', 'decimal');
    var ref = input('dpXRef', 'text'); ref.maxLength = 100;
    var err = errBox();
    var go = h('button', 'btn', 'Record refund'); go.type = 'submit';
    add(f, h('p', 'ad-hint', 'Refund in Paystack first. Still refundable: ' + naira(c.refundable) + '.'), field('Refunded amount (NGN)', amt), field('Paystack refund reference', ref), err, go);
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); showErr(err, '');
      var n = parseAmount(amt.value);
      if (!(n > 0)) { showErr(err, 'Enter the refunded amount.'); return; }
      if (n > Number(c.refundable)) { showErr(err, 'That is more than can still be refunded (' + naira(c.refundable) + ').'); return; }
      if (ref.value.trim().length < 3) { showErr(err, 'Enter the Paystack refund reference.'); return; }
      go.disabled = true;
      var r = await call('admin_dispute_record_refund', { p_dispute: d.id, p_amount: String(n), p_ref: ref.value.trim() });
      go.disabled = false;
      if (!r.ok) { showErr(err, r.error); return; }
      ctx.toast('Refund recorded.'); await refresh(d.id);
    });
    return add(p, f);
  }

  /* ---------- evidence ---------- */
  function evidencePanel(d, c, files) {
    var p = panel('Evidence files'); var removed = {};
    (c.removals || []).forEach(function (r) { removed[r.attachment_id] = r; });
    if (!files.length) { add(p, h('p', 'ad-hint', 'No files on this job.')); return p; }
    var ul = h('ul', 'ad-sub');
    files.forEach(function (a) {
      var li = h('li'); var rem = removed[a.id];
      add(li, h('span', rem ? 'ad-muted' : null, (a.kind || 'file') + ' · ' + size(a.size) + ' · ' + when(a.created_at) + (rem ? ' · removed (' + rem.reason + ')' : '')));
      var acts = h('span', 'ad-actions ad-actions--tight');
      var open = h('button', 'btn ad-btn-small', 'Open'); open.type = 'button';
      open.addEventListener('click', async function () {
        var s = await sb.storage.from('job-evidence').createSignedUrl(a.storage_path, 120);   /* short-lived link */
        if (s.error || !s.data || !s.data.signedUrl) { ctx.toast('Could not open the file.', 'error'); return; }
        window.open(s.data.signedUrl, '_blank', 'noopener');
      });
      add(acts, open);
      if (!rem) { var rm = h('button', 'btn ad-btn-small', 'Remove'); rm.type = 'button'; rm.addEventListener('click', function () { removeForm(li, a, d); }); add(acts, rm); }
      add(li, acts); add(ul, li);
    });
    return add(p, ul);
  }
  function removeForm(li, a, d) {
    if (li.querySelector('form')) return;
    var f = h('form', 'ad-form ad-inline-form'); f.noValidate = true;
    var why = input('dpWhy-' + a.id, 'text'); why.maxLength = 500;
    var err = errBox();
    var go = h('button', 'btn btn-primary', 'Remove file'); go.type = 'submit';
    var no = h('button', 'btn', 'Cancel'); no.type = 'button'; no.addEventListener('click', function () { f.remove(); });
    add(f, h('p', 'ad-hint', 'The two people stop seeing this file. The reason stays internal. The file itself is purged later in the Storage dashboard.'),
      field('Reason (internal, 5 to 500 characters)', why), err, add(h('div', 'ad-actions'), go, no));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); showErr(err, '');
      if (why.value.trim().length < 5) { showErr(err, 'Give a reason (at least 5 characters).'); return; }
      go.disabled = true;
      var r = await call('admin_dispute_remove_evidence', { p_attachment: a.id, p_reason: why.value.trim() });
      go.disabled = false;
      if (!r.ok) { showErr(err, r.error); return; }
      ctx.toast('File removed from view.'); await select(d.id);
    });
    add(li, f);
  }

  /* ---------- orphans ---------- */
  async function loadOrphans() {
    var body = $('dpOrphanBody'); clear(body); body.appendChild(ctx.skeleton(2));
    var r; try { r = await sb.rpc('support_list_orphan_uploads'); } catch (e) { r = { error: e }; }
    clear(body);
    if (r.error) { add(body, h('p', 'ad-error', 'Could not load the list.')); return; }
    var rows = r.data || [];
    if (!rows.length) { add(body, h('p', 'ad-hint', 'None older than 1 hour.')); return; }
    var ul = h('ul', 'ad-sub');
    rows.forEach(function (o) { add(ul, add(h('li'), h('span', null, o.name), h('span', 'ad-hint', size(o.size) + ' · ' + when(o.created_at)))); });
    add(body, h('p', 'ad-hint', 'Delete these in the Storage dashboard (bucket job-evidence).'), ul);
  }

  async function refresh(id) { await loadList(false); await select(id); }

  /* new or changed reports appear without a reload (Realtime follows the same staff-only read rules) */
  function watchLive() {
    if (!sb.channel) return;
    var t = null;
    function soon() { clearTimeout(t); t = setTimeout(function () { loadList(false); }, 800); }
    try {
      sb.channel('admin-disputes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'job_disputes' }, soon)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dispute_events' }, soon)
        .subscribe();
    } catch (e) { /* the list still works, it just will not refresh by itself */ }
  }

  /* ---------- start ---------- */
  Array.prototype.forEach.call($('dpFilter').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { state.filter = b.getAttribute('data-f'); loadList(false); });
  });
  var q = $('dpSearch'), qt = null;
  q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { state.search = q.value.trim(); loadList(false); }, 300); });
  $('dpMore').addEventListener('click', function () { loadList(true); });
  $('dpBack').addEventListener('click', function () { showDetailColumn(false); });
  $('dpOrphans').addEventListener('toggle', function () { if (this.open) loadOrphans(); });
  watchLive();
  loadList(false);
});

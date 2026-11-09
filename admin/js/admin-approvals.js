/* StreetTasker Admin: Pending approvals (spec S02 and S26). A5a: read; A5b: decide and cancel.
   Reads: rpc admin_approval_counts, admin_approval_list (50 per page, newest first), admin_approval_detail (diff, history, expiry).
   Writes (A5b): rpc admin_decide_approval(p_id, p_approve, p_reason) for a Super Admin (approvals.decide) who is NOT the requester, and
   admin_cancel_approval(p_id, p_reason) for the requester or a Super Admin. Every button asks twice and needs a reason of 10+ characters
   (cancel: optional). The buttons only mark the request; they never carry out the change (the requester does, in a later stage's page).
   The server decides every rule again (self-approval, expiry, who may cancel); the page only shows what is likely to work.
   Needs one of approvals.view, approvals.request or approvals.decide. An admin with approvals.request only sees their own requests.
   All text via textContent. */
'use strict';
AdminShell.init({ page: 'approvals', title: 'Pending approvals', permission: null }).then(function (ctx) {
  var PAGE = 50;
  var PERMS = ['approvals.view', 'approvals.request', 'approvals.decide'];
  var root = document.getElementById('apRoot');
  var body = document.getElementById('apBody');
  if (!PERMS.some(function (p) { return ctx.has(p); })) { ctx.showNoPermission(ctx.content, 'approvals.view'); return; }
  root.hidden = false;

  var TABS = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['expired', 'Expired or cancelled']];
  var STATUS = { pending: ['Pending', 'badge-blue'], approved: ['Approved', 'badge-green'], consumed: ['Approved and used', 'badge-green'],
    rejected: ['Rejected', 'badge-gray'], expired: ['Expired', 'badge-gray'], cancelled: ['Cancelled', 'badge-gray'] };
  var RISK = { medium: ['Medium risk', 'badge-gray'], high: ['High risk', 'badge-amber'], critical: ['Critical risk', 'badge-amber'] };
  var state = { tab: 'pending', search: '', offset: 0, rows: [], more: false, sel: null, counts: null, scope: 'all', req: 0, detail: null, detailReq: 0 };

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { if (!v) return '\u2014'; var d = new Date(v); return isNaN(d) ? '\u2014' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function shortId(v) { var s = String(v == null ? '' : v); return s.length > 13 ? s.slice(0, 8) + '\u2026' : s; }
  function badge(map, key) { var m = map[key] || [words(key), 'badge-gray']; return h('span', 'badge ' + m[1], m[0]); }

  function left(sec) {
    if (sec == null) return '';
    if (sec <= 0) return 'Expired';
    var m = Math.floor(sec / 60), hr = Math.floor(m / 60), d = Math.floor(hr / 24);
    if (d >= 1) return 'Expires in ' + d + (d === 1 ? ' day ' : ' days ') + (hr % 24) + ' h';
    if (hr >= 1) return 'Expires in ' + hr + ' h ' + (m % 60) + ' min';
    return 'Expires in ' + Math.max(1, m) + ' min';
  }
  function show(v) {
    if (v === undefined || v === null) return '\u2014';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function errorFor(node, res, retry) {
    var code = res.error && res.error.code;
    if (code === '42501') ctx.showNoPermission(node, 'approvals.view');
    else if (code === '42883' || code === 'PGRST202') ctx.showError(node, 'The approvals functions are not on the server yet. Run sql/admin/a5a-approvals-reader.sql in the Supabase SQL editor, then press Retry.', retry);
    else ctx.showError(node, 'The server could not answer. Nothing was changed.', retry);
  }

  /* ---------- tabs ---------- */
  function drawTabs() {
    var box = document.getElementById('apTabs'); clear(box);
    TABS.forEach(function (t) {
      var on = state.tab === t[0];
      var n = state.counts && state.counts[t[0]] != null ? ' (' + state.counts[t[0]] + ')' : '';
      var b = h('button', 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'), t[1] + n); b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (state.tab === t[0]) return;
        state.tab = t[0]; state.offset = 0; state.sel = null; state.detail = null; drawTabs(); load();
      });
      box.appendChild(b);
    });
  }

  /* ---------- detail ---------- */
  function diffTable(prev, next) {
    var pv = isObj(prev) ? prev : null, nx = isObj(next) ? next : {};
    var keys = Object.keys(nx);
    if (pv) Object.keys(pv).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var wrap = h('div', 'ad-tablewrap');
    var tbl = h('table', 'ad-table');
    tbl.appendChild(h('caption', 'ad-sr', 'Current value next to proposed value'));
    var hr = h('tr');
    ['Field', 'Current value', 'Proposed value', ''].forEach(function (t) { var th = h('th', null, t); th.scope = 'col'; hr.appendChild(th); });
    var th0 = h('thead'); th0.appendChild(hr); tbl.appendChild(th0);
    var tb = h('tbody');
    keys.forEach(function (k) {
      var a = pv ? pv[k] : undefined, b = nx[k];
      var changed = pv ? JSON.stringify(a) !== JSON.stringify(b) : true;
      var tr = h('tr');
      var c0 = h('td', null, words(k)); c0.setAttribute('data-label', 'Field');
      var c1 = h('td', null, show(a)); c1.setAttribute('data-label', 'Current value');
      var c2 = h('td', null, show(b)); c2.setAttribute('data-label', 'Proposed value');
      var c3 = h('td'); c3.setAttribute('data-label', '');
      if (pv && changed) c3.appendChild(h('span', 'badge badge-amber', 'Changes'));
      add(tr, c0, c1, c2, c3); tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl);
    return wrap;
  }

  /* ---------- actions (A5b) ---------- */
  var uidn = 0;
  function afterChange(msg, id) { ctx.toast(msg); load().then(function () { if (id) openDetail(id); }); }

  /* One form: a reason box and one or more buttons. Each button asks twice, the second press shows exactly what will change. */
  function actionForm(d, o) {
    var f = h('form', 'ad-form'); f.noValidate = true;
    uidn += 1; var rid = 'apWhy' + uidn;
    var lab = h('label', 'ad-filter-label', o.reasonLabel); lab.htmlFor = rid;
    var reason = h('textarea', 'form-input'); reason.id = rid; reason.rows = 3; reason.maxLength = 300;
    var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var sure = h('p', 'ad-note'); sure.hidden = true; sure.setAttribute('aria-live', 'polite');
    var bar = h('div', 'ad-actions ad-actions--tight'); var armed = null; var btns = [];
    function disarm() { armed = null; sure.hidden = true; btns.forEach(function (x) { x.el.textContent = x.def.label; }); }
    o.buttons.forEach(function (def) {
      var b = h('button', 'btn ' + (def.primary ? 'btn-primary' : 'btn-outline'), def.label); b.type = 'button';
      btns.push({ el: b, def: def });
      b.addEventListener('click', async function () {
        err.hidden = true;
        var text = reason.value.trim();
        if (text.length < def.min) { err.textContent = 'Write a reason of at least ' + def.min + ' characters.'; err.hidden = false; disarm(); return; }
        if (armed !== def) {
          disarm(); armed = def; b.textContent = 'Press again to confirm';
          sure.textContent = def.sure; sure.hidden = false; return;
        }
        btns.forEach(function (x) { x.el.disabled = true; });
        var res;
        try { res = await window.supabase.rpc(def.fn, def.args(text)); } catch (e) { res = { error: e }; }
        btns.forEach(function (x) { x.el.disabled = false; });
        disarm();
        var r = res && res.data;
        if (res.error || !r) {
          err.textContent = (res.error && res.error.code === '42501') ? 'You do not have permission to do this.' : 'The server could not answer. Nothing was changed.';
          err.hidden = false; return;
        }
        if (!r.ok) { err.textContent = r.error || 'It could not be done. Nothing was changed.'; err.hidden = false; return; }
        afterChange(def.done, d.id);
      });
      bar.appendChild(b);
    });
    reason.addEventListener('input', disarm);
    add(f, lab, reason, err, sure, bar);
    return f;
  }

  function actionPanel(d) {
    var eff = d.effective_status;
    if (eff !== 'pending' && eff !== 'approved') return null;
    var canDecide = ctx.has('approvals.decide');
    var canCancel = ctx.has('approvals.request') && (d.is_mine || canDecide);
    var what = '"' + (d.action_label || words(d.action)) + '" on ' + words(d.target_type) + ' ' + d.target_id + ', asked by ' + (d.requested_by_name || 'an admin');
    var panel = h('div', 'ad-panel');
    panel.appendChild(h('h3', 'ad-panel-title', 'Decision'));

    if (eff === 'pending') {
      if (!canDecide) {
        panel.appendChild(h('p', 'ad-note', 'Only a Super Admin can approve or reject a request.'));
      } else if (d.is_mine) {
        panel.appendChild(h('p', 'ad-error', 'You cannot approve or reject your own request. Another Super Admin must.'));
        var row = h('div', 'ad-actions ad-actions--tight');
        ['Approve', 'Reject'].forEach(function (t) { var b = h('button', 'btn btn-outline', t); b.type = 'button'; b.disabled = true; row.appendChild(b); });
        panel.appendChild(row);
      } else {
        panel.appendChild(h('p', 'ad-note', 'Approving does not carry out the change. It lets the person who asked carry it out once, before it expires. Rejecting ends the request.'));
        panel.appendChild(actionForm(d, {
          reasonLabel: 'Reason (at least 10 characters; it goes in the activity log)',
          buttons: [
            { label: 'Approve', primary: true, min: 10, fn: 'admin_decide_approval', done: 'Approved. Nothing has been carried out yet.',
              args: function (t) { return { p_id: d.id, p_approve: true, p_reason: t }; },
              sure: 'You are about to APPROVE ' + what + '. Press the button again to confirm.' },
            { label: 'Reject', primary: false, min: 10, fn: 'admin_decide_approval', done: 'Rejected.',
              args: function (t) { return { p_id: d.id, p_approve: false, p_reason: t }; },
              sure: 'You are about to REJECT ' + what + '. The request will end. Press the button again to confirm.' }
          ]
        }));
      }
    } else {
      panel.appendChild(h('p', 'ad-note', 'Approved. The change has not been carried out by this page: the person who asked does that. It can be cancelled until it is used or expires.'));
    }

    if (canCancel) {
      panel.appendChild(h('h3', 'ad-panel-title', 'Cancel this request'));
      panel.appendChild(actionForm(d, {
        reasonLabel: 'Reason (optional)',
        buttons: [{ label: 'Cancel request', primary: false, min: 0, fn: 'admin_cancel_approval', done: 'The request was cancelled.',
          args: function (t) { return { p_id: d.id, p_reason: t || null }; },
          sure: 'You are about to CANCEL ' + what + '. It cannot be used afterwards. Press the button again to confirm.' }]
      }));
    }
    return panel;
  }

  function drawDetail(holder) {
    clear(holder);
    var d = state.detail;
    if (!d) { holder.appendChild(add(h('div', 'ad-card'), h('p', 'ad-note', 'Choose a request on the left.'))); return; }
    if (d === 'loading') { holder.appendChild(add(h('div', 'ad-card'), ctx.skeleton(3))); return; }
    if (d === 'error') { var eb = h('div', 'ad-card'); holder.appendChild(eb); ctx.showError(eb, 'The request could not be loaded. Nothing was changed.', function () { openDetail(state.sel); }); return; }
    if (!d.found) { holder.appendChild(add(h('div', 'ad-card'), h('p', 'ad-note', 'This request was not found.'))); return; }

    var card = h('div', 'ad-card ad-panel');
    var top = add(h('div', 'ad-row-top'), h('h2', 'ad-panel-title', d.action_label || words(d.action)), badge(STATUS, d.effective_status), badge(RISK, d.risk));
    card.appendChild(top);

    var dl = h('dl', 'ad-dl');
    function row(k, v) { if (v == null || v === '') return; dl.appendChild(h('dt', null, k)); dl.appendChild(h('dd', null, v)); }
    row('Request', shortId(d.id));
    row('On', words(d.target_type) + ' ' + d.target_id);
    row('Asked by', (d.requested_by_name || 'An admin') + (d.is_mine ? ' (you)' : ''));
    row('Asked at', when(d.requested_at));
    row('Reason', d.reason);
    if (d.effective_status === 'pending' || d.effective_status === 'approved') row('Time left', left(d.seconds_left));
    else row('Expiry', when(d.expires_at));
    if (d.decided_at) row(d.status === 'rejected' ? 'Rejected by' : 'Decided by', (d.decided_by_name || 'A Super Admin') + ' on ' + when(d.decided_at));
    if (d.decision_reason) row('Decision reason', d.decision_reason);
    if (d.consumed_at) row('Carried out', (d.consumed_by_name || 'An admin') + ' on ' + when(d.consumed_at));
    card.appendChild(dl);

    card.appendChild(h('h3', 'ad-panel-title', 'What would change'));
    card.appendChild(isObj(d.payload) && Object.keys(d.payload).length ? diffTable(d.previous_value, d.payload) : h('p', 'ad-note', 'No details of the change were recorded.'));
    if (!isObj(d.previous_value)) card.appendChild(h('p', 'ad-hint', 'The current value was not recorded for this request.'));

    card.appendChild(h('h3', 'ad-panel-title', 'History'));
    if (d.history && d.history.length) {
      var ul = h('ul', 'ad-sub');
      d.history.forEach(function (x) {
        var li = h('li');
        add(li, h('span', null, words(x.action) + (x.actor_name ? ' by ' + x.actor_name : '') + (x.outcome && x.outcome !== 'ok' ? ' (' + words(x.outcome) + ')' : '') + (x.reason ? ': ' + x.reason : '')),
          h('span', 'ad-hint', when(x.at)));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    } else card.appendChild(h('p', 'ad-note', 'Nothing has been logged for this request yet.'));

    var ap = actionPanel(d); if (ap) card.appendChild(ap);
    holder.appendChild(card);
  }

  async function openDetail(id) {
    state.sel = id; state.detail = 'loading'; render();
    var mine = ++state.detailReq, res;
    try { res = await window.supabase.rpc('admin_approval_detail', { p_id: id }); } catch (e) { res = { error: e }; }
    if (mine !== state.detailReq) return;
    state.detail = (res.error || !res.data) ? 'error' : res.data;
    render();
  }

  /* ---------- list ---------- */
  function render() {
    clear(body);
    var split = h('div', 'ad-split' + (state.sel ? ' is-detail' : ''));
    var listCol = h('section', 'ad-split-list'); listCol.setAttribute('aria-label', 'Approval requests');
    var detCol = h('section', 'ad-split-detail'); detCol.setAttribute('aria-label', 'Request detail');
    var back = h('button', 'btn ad-back', 'Back to the list'); back.type = 'button';
    back.addEventListener('click', function () { state.sel = null; state.detail = null; render(); });
    var holder = h('div'); add(detCol, back, holder);

    var card = h('div', 'ad-card');
    if (!state.rows.length) {
      if (state.search) ctx.showNoResults(card);
      else if (state.offset > 0) card.appendChild(h('p', 'ad-note', 'No more requests.'));
      else ctx.showEmpty(card, state.tab === 'pending' ? 'No request is waiting for a decision.' : 'No requests here yet.');
    } else {
      var ul = h('ul', 'ad-rows');
      state.rows.forEach(function (x) {
        var b = h('button', 'ad-row'); b.type = 'button';
        if (state.sel === x.id) b.setAttribute('aria-current', 'true');
        var top = add(h('span', 'ad-row-top'), h('span', 'ad-row-title', x.action_label || words(x.action)), badge(STATUS, x.effective_status), badge(RISK, x.risk));
        add(b, top,
          h('span', 'ad-row-sub', words(x.target_type) + ' ' + shortId(x.target_id)),
          h('span', 'ad-hint', ['By ' + (x.requested_by_name || 'an admin') + (x.is_mine ? ' (you)' : ''), when(x.requested_at),
            (x.effective_status === 'pending' || x.effective_status === 'approved') ? left(x.seconds_left) : ''].filter(Boolean).join(' \u00b7 ')));
        b.addEventListener('click', function () { openDetail(x.id); });
        add(ul, add(h('li'), b));
      });
      card.appendChild(ul);
      if (state.offset > 0 || state.more) {
        var p = h('div', 'ad-actions ad-pager');
        var prev = h('button', 'btn', 'Newer'); prev.type = 'button'; prev.disabled = state.offset === 0;
        var next = h('button', 'btn', 'Older'); next.type = 'button'; next.disabled = !state.more;
        prev.addEventListener('click', function () { state.offset = Math.max(0, state.offset - PAGE); state.sel = null; state.detail = null; load(); });
        next.addEventListener('click', function () { state.offset += PAGE; state.sel = null; state.detail = null; load(); });
        add(p, prev, next); card.appendChild(p);
      }
    }
    add(listCol, card);
    add(split, listCol, detCol); body.appendChild(split);
    drawDetail(holder);
  }

  async function load() {
    var mine = ++state.req;
    clear(body); body.appendChild(ctx.skeleton(4));
    var res, cres;
    try {
      res = await window.supabase.rpc('admin_approval_list', { p_tab: state.tab, p_search: state.search || null, p_limit: PAGE, p_offset: state.offset });
      cres = await window.supabase.rpc('admin_approval_counts');
    } catch (e) { res = { error: e }; }
    if (mine !== state.req) return;                           /* a newer request replaced this one */
    if (res.error || !res.data) { errorFor(body, res, load); return; }
    state.rows = res.data.rows || []; state.more = !!res.data.has_more; state.scope = res.data.scope || 'all';
    if (cres && !cres.error && cres.data) state.counts = cres.data;
    document.getElementById('apScope').textContent = state.scope === 'own' ? 'You can see only the requests you made. Ask a Super Admin if you need to see all of them.' : '';
    drawTabs(); render();
  }

  document.getElementById('apFilters').addEventListener('submit', function (e) {
    e.preventDefault(); state.search = document.getElementById('apSearch').value.trim(); state.offset = 0; state.sel = null; state.detail = null; load();
  });
  document.getElementById('apReset').addEventListener('click', function () {
    document.getElementById('apSearch').value = ''; state.search = ''; state.offset = 0; state.sel = null; state.detail = null; load();
  });
  drawTabs(); load();
});

/* StreetTasker Admin: Identity verification (stage A11, spec S09). READ ONLY.
   Calls admin_verification_overview, admin_verification_list and admin_verification_detail (each checks verification.view again).
   No button marks anyone verified, retries a check or changes anything. No ID numbers, photos or dates of birth are ever loaded.
   All text via textContent. */
'use strict';
AdminShell.init({ page: 'verification', title: 'Identity verification', permission: 'verification.view' }).then(function (ctx) {
  var $ = function (id) { return document.getElementById(id); };
  $('ivRoot').hidden = false;
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { var d = new Date(v); return (v == null || isNaN(d)) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }); }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim().toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function fail(res) {
    if (res && res.error) return 'The server could not answer. Nothing was changed.';
    if (res && res.data && res.data.ok === false) return res.data.error || 'The server refused this.';
    return null;
  }
  async function call(n, a) { try { return await window.supabase.rpc(n, a || {}); } catch (e) { return { error: e }; } }
  function stat(label, value, def, cls) {
    var s = el('div', 'ad-stat' + (cls ? ' ad-stat--' + cls : ''));
    s.appendChild(el('div', 'ad-stat-label', label)); s.appendChild(el('div', 'ad-stat-num', value));
    if (def) s.appendChild(el('p', 'ad-hint', def));
    return s;
  }
  function tableOf(caption, heads) {
    var wrap = el('div', 'ad-tablewrap ad-cards'), tbl = el('table', 'ad-table ad-table--cards');
    tbl.appendChild(el('caption', 'ad-sr', caption));
    var tr = el('tr'); heads.forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; tr.appendChild(th); });
    var th = el('thead'); th.appendChild(tr); tbl.appendChild(th);
    var tb = el('tbody'); tbl.appendChild(tb); wrap.appendChild(tbl);
    return { wrap: wrap, body: tb };
  }
  function cell(tr, label, content) {
    var td = el('td'); td.setAttribute('data-label', label);
    if (content && content.nodeType) td.appendChild(content); else td.textContent = content == null ? '' : content;
    tr.appendChild(td); return td;
  }
  function flag(text) { return el('span', 'badge', text); }
  function facts(pairs) {
    var dl = el('dl', 'ad-dl');
    pairs.forEach(function (p) { if (p[1] == null || p[1] === '') return; dl.appendChild(el('dt', null, p[0])); dl.appendChild(el('dd', null, String(p[1]))); });
    return dl;
  }
  function yn(v) { return v === true ? 'Passed' : v === false ? 'Not passed' : 'Not reported'; }
  function kindLabel(k) { return { tasker_regular: 'Regular Tasker', tasker_local: 'Local Tasker', customer: 'Customer', coordinator: 'Coordinator' }[k] || words(k); }
  var STATUS_LABEL = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', PENDING: 'Pending', VERIFIED: 'Verified', FAILED: 'Failed', REVIEW_REQUIRED: 'Review required', RESUBMIT_REQUESTED: 'Additional information', EXPIRED: 'Expired', ABANDONED: 'Abandoned' };
  function statusLabel(s) { return STATUS_LABEL[s] || words(s); }
  function tabs(box, list, current, onPick) {
    clear(box);
    list.forEach(function (x) {
      var b = el('button', 'btn btn-sm ' + (x[0] === current ? 'btn-outline' : 'btn-ghost'), x[1]); b.type = 'button';
      b.setAttribute('aria-pressed', x[0] === current ? 'true' : 'false');
      b.addEventListener('click', function () { onPick(x[0]); });
      box.appendChild(b);
    });
  }
  function subTable(caption, heads, rows) {
    var t = tableOf(caption, heads);
    rows.forEach(function (r) { var tr = el('tr'); r.forEach(function (c, i) { cell(tr, heads[i], c); }); t.body.appendChild(tr); });
    return t.wrap;
  }

  var TABS = [['all', 'All'], ['review', 'Review required'], ['resubmit', 'Additional information'], ['pending', 'Pending'], ['failed', 'Failed'], ['verified', 'Verified'], ['unfinished', 'Not finished']];
  var KINDS = [['all', 'Everyone'], ['tasker_regular', 'Regular Taskers'], ['tasker_local', 'Local Taskers'], ['coordinator', 'Coordinators'], ['customer', 'Customers']];
  var filt = 'all', kind = 'all', off = 0, req = 0, PAGE = 25;

  async function loadOverview() {
    var res = await call('admin_verification_overview');
    var m = fail(res), alerts = $('ivAlerts'), sum = $('ivSummary');
    clear(alerts); clear(sum);
    if (m || !res.data) { ctx.showError(alerts, m || 'The summary could not be read.', loadAll); return; }
    var d = res.data, bs = d.by_status || {}, bk = d.by_kind || {}, warn = [];
    if (d.waiting_review > 0) warn.push(d.waiting_review + ' check(s) need a person: review required or additional information requested.');
    if (d.events_rejected > 0) warn.push(d.events_rejected + ' provider message(s) were rejected by the site. Open a check to see its events.');
    if (d.events_unprocessed > 0) warn.push(d.events_unprocessed + ' provider message(s) were received but not processed.');
    if (warn.length) {
      var b = el('div', 'ad-banner'); b.appendChild(el('strong', null, 'Needs attention'));
      var ul = el('ul'); warn.forEach(function (w) { ul.appendChild(el('li', null, w)); }); b.appendChild(ul); alerts.appendChild(b);
    } else alerts.appendChild(el('p', 'ad-note', 'No check is waiting for a person, and no provider message was rejected.'));
    var g = el('div', 'ad-grid');
    g.appendChild(stat('Verified', String(bs.VERIFIED || 0), 'Passed the provider check.'));
    g.appendChild(stat('Review required', String(bs.REVIEW_REQUIRED || 0), 'The provider asked for a manual look.', bs.REVIEW_REQUIRED > 0 ? 'warn' : null));
    g.appendChild(stat('Failed', String(bs.FAILED || 0), 'Did not pass.'));
    g.appendChild(stat('Total checks', String(d.total || 0), (d.sandbox_rows || 0) + ' are test (sandbox) checks.'));
    sum.appendChild(g);
    sum.appendChild(el('p', 'ad-hint', 'By status: ' + Object.keys(STATUS_LABEL).map(function (k) { return statusLabel(k) + ' ' + (bs[k] || 0); }).join(', ') + '.'));
    sum.appendChild(el('p', 'ad-hint', 'By kind: ' + ['tasker_regular', 'tasker_local', 'coordinator', 'customer'].map(function (k) { return kindLabel(k) + ' ' + (bk[k] || 0); }).join(', ') + '.'));
    var gt = d.gate;
    sum.appendChild(el('p', 'ad-hint', 'Consents: ' + (d.consents_active || 0) + ' active, ' + (d.consents_revoked || 0) + ' withdrawn. Provider messages stored: ' + (d.webhook_events || 0) + '. Accounts currently taken down: ' + (d.takedowns_open || 0) + '. ' +
      (gt ? 'Customer gate: ' + (gt.gate_customers ? 'on' : 'off') + '. Lockdown: ' + (gt.lockdown_enabled ? 'on' : 'off') + '. (Set in the database, not here.)' : 'Gate settings: not available.')));
    $('ivStamp').textContent = 'Read from the server at ' + when(d.generated_at) + '.';
  }

  function buildDetail(holder, id) {
    holder.appendChild(ctx.skeleton(2));
    call('admin_verification_detail', { p_id: id }).then(function (res) {
      clear(holder);
      var m = fail(res);
      if (m || !res.data) { ctx.showError(holder, m || 'The details could not be read.', function () { clear(holder); buildDetail(holder, id); }); return; }
      var d = res.data, v = d.verification || {};
      holder.appendChild(facts([['Person id', v.user_id], ['Kind', kindLabel(v.subject_kind)], ['Provider', v.provider], ['Provider session', v.provider_session_id], ['Workflow', v.workflow_id],
        ['Environment', v.environment === 'sandbox' ? 'Test (sandbox)' : 'Live'], ['Status', statusLabel(v.status)], ['Provider status', v.provider_status],
        ['Reason codes', (v.reason_codes || []).join(', ')], ['Liveness check', yn(v.liveness_ok)], ['Face match', yn(v.face_match_ok)], ['Document check', yn(v.document_ok)],
        ['NIN database match', v.nin_database_match ? words(v.nin_database_match) : ''], ['Last provider message', when(v.last_event_created_at)], ['Started', when(v.created_at)], ['Completed', when(v.completed_at)]]));
      holder.appendChild(el('h3', null, 'All attempts by this person'));
      holder.appendChild(d.attempts && d.attempts.length ? subTable('Attempts', ['Started', 'Kind', 'Status', 'Completed'], d.attempts.map(function (a) { return [when(a.created_at), kindLabel(a.subject_kind), statusLabel(a.status), when(a.completed_at)]; })) : el('p', 'ad-hint', 'None.'));
      holder.appendChild(el('h3', null, 'Provider messages for those sessions (latest 50)'));
      holder.appendChild(d.events && d.events.length ? subTable('Events', ['Received', 'Type', 'Provider status', 'Result on the site', 'Processed'], d.events.map(function (e) { return [when(e.received_at), e.webhook_type, e.provider_status, words(e.outcome), when(e.processed_at)]; })) : el('p', 'ad-hint', 'No provider messages stored.'));
      holder.appendChild(el('h3', null, 'Consent'));
      holder.appendChild(d.consents && d.consents.length ? subTable('Consent', ['Recorded', 'Version', 'Method', 'Withdrawn', 'Reason'], d.consents.map(function (c) { return [when(c.recorded_at), c.consent_version, words(c.method), c.revoked_at ? when(c.revoked_at) : 'No', c.revoke_reason || '']; })) : el('p', 'ad-hint', 'No consent record.'));
      if (d.takedowns && d.takedowns.length) {
        holder.appendChild(el('h3', null, 'Takedowns'));
        holder.appendChild(subTable('Takedowns', ['Taken', 'What', 'Reason', 'Restored', 'Restore skipped'], d.takedowns.map(function (t) { return [when(t.taken_at), words(t.entity), t.reason || '', t.restored_at ? when(t.restored_at) : 'Not restored', t.restore_skipped || '']; })));
      }
    });
  }

  async function loadList() {
    var mine = ++req, box = $('ivList');
    tabs($('ivTabs'), TABS, filt, function (f) { filt = f; off = 0; loadList(); });
    tabs($('ivKinds'), KINDS, kind, function (k) { kind = k; off = 0; loadList(); });
    clear(box); box.appendChild(ctx.skeleton(3)); $('ivPager').hidden = true;
    var res = await call('admin_verification_list', { p_filter: filt, p_offset: off, p_kind: kind });
    if (mine !== req) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The checks could not be read.', loadList); return; }
    var d = res.data, items = d.items || [];
    $('ivCount').textContent = d.total + ' check(s) in this view.';
    clear(box);
    if (!items.length) { if (off > 0) ctx.showEmpty(box, 'No older checks.'); else if (filt === 'all' && kind === 'all') ctx.showEmpty(box, 'No identity checks yet.'); else ctx.showNoResults(box); }
    else {
      var t = tableOf('Identity checks', ['Updated', 'Person', 'Kind', 'Status', 'Attempts', '']);
      items.forEach(function (x) {
        var tr = el('tr');
        cell(tr, 'Updated', when(x.updated_at));
        cell(tr, 'Person', x.name || 'Unnamed');
        cell(tr, 'Kind', kindLabel(x.subject_kind));
        var st = el('span'); st.appendChild(flag(statusLabel(x.status))); if (x.environment === 'sandbox') st.appendChild(flag('Test'));
        cell(tr, 'Status', st);
        cell(tr, 'Attempts', String(x.attempts || 1));
        var drow = el('tr', 'ad-detail-row'), td = el('td'); td.colSpan = 6; td.setAttribute('data-label', '');
        var holder = el('div', 'ad-detail'); td.appendChild(holder); drow.appendChild(td);
        var act = el('td'); act.setAttribute('data-label', '');
        var b = el('button', 'btn ad-btn-small', 'Details'); b.type = 'button';
        b.addEventListener('click', function () {
          if (holder.firstChild) { clear(holder); b.textContent = 'Details'; return; }
          b.textContent = 'Hide'; buildDetail(holder, x.id);
        });
        act.appendChild(b); tr.appendChild(act); t.body.appendChild(tr); t.body.appendChild(drow);
      });
      box.appendChild(t.wrap);
    }
    $('ivNewer').disabled = off === 0; $('ivOlder').disabled = items.length < PAGE;
    $('ivPager').hidden = off === 0 && items.length < PAGE;
  }

  function loadAll() { return Promise.all([loadOverview(), loadList()]); }
  $('ivNewer').addEventListener('click', function () { off = Math.max(0, off - PAGE); loadList(); });
  $('ivOlder').addEventListener('click', function () { off += PAGE; loadList(); });
  loadAll();
});

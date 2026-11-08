/* StreetTasker Admin: Activity log (stage A6, spec S25). READ ONLY.
   Calls rpc admin_activity_feed (merged, newest first, 50 per page) and admin_activity_detail (previous and new value of one
   admin row). Needs audit_logs.view; the server checks it again. No edit or delete exists anywhere. All text via textContent. */
'use strict';
AdminShell.init({ page: 'audit', title: 'Activity log', permission: 'audit_logs.view' }).then(function (ctx) {
  var PAGE = 50;
  var root = document.getElementById('adAudit');
  var body = document.getElementById('adAuditBody');
  var pager = document.getElementById('adPager');
  var note = document.getElementById('adSrcNote');
  var f = {
    form: document.getElementById('adFilters'), source: document.getElementById('fSource'), outcome: document.getElementById('fOutcome'),
    search: document.getElementById('fSearch'), from: document.getElementById('fFrom'), to: document.getElementById('fTo'),
    security: document.getElementById('fSecurity'), reset: document.getElementById('fReset')
  };
  var prev = document.getElementById('pPrev'), next = document.getElementById('pNext');
  var offset = 0, sourcesDrawn = false, req = 0;
  root.hidden = false;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function when(v) { var d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function shortId(v) { var s = String(v == null ? '' : v); return s.length > 13 ? s.slice(0, 8) + '\u2026' : s; }

  function drawSources(list) {
    if (sourcesDrawn) return;
    sourcesDrawn = true;
    clear(f.source);
    var all = el('option', null, 'All logs'); all.value = ''; f.source.appendChild(all);
    list.forEach(function (s) {
      var o = el('option', null, s.label + (s.available ? '' : ' (not available)'));
      o.value = s.key; if (!s.available) o.disabled = true;
      f.source.appendChild(o);
    });
  }
  function drawSourceNote(list) {
    var bad = list.filter(function (s) { return !s.available; });
    note.textContent = bad.length
      ? 'Not available: ' + bad.map(function (s) { return s.label + ' (' + (s.reason || 'could not be read') + ')'; }).join('; ') + '. The other logs are shown.'
      : '';
  }

  function dayStart(v) { return v ? new Date(v + 'T00:00:00').toISOString() : null; }
  function dayAfter(v) { if (!v) return null; var d = new Date(v + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString(); }

  function resultBadge(o) {
    if (!o) return el('span', 'ad-muted', '\u2014');
    return el('span', 'badge', o === 'ok' ? 'Done' : (o === 'refused' ? 'Refused' : 'Error'));
  }

  async function showDetail(row, holder, btn) {
    if (holder.dataset.open === '1') { clear(holder); holder.dataset.open = ''; btn.textContent = 'Details'; return; }
    btn.disabled = true;
    var res;
    try { res = await window.supabase.rpc('admin_activity_detail', { p_id: row.admin_log_id }); } catch (e) { res = { error: e }; }
    btn.disabled = false;
    if (res.error || !res.data) { ctx.toast('The detail could not be loaded. Nothing was changed.', 'error'); return; }
    clear(holder);
    var d = res.data;
    if (!d.found) { holder.appendChild(el('p', 'ad-note', 'This row was not found.')); }
    else {
      var dl = el('dl', 'ad-dl');
      function add(k, v) { if (v == null || v === '') return; dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
      add('Roles at the time', (d.actor_roles || []).map(words).join(', '));
      add('Reason', d.reason);
      add('Approval', d.approval_id);
      ['old_value', 'new_value', 'detail'].forEach(function (k) {
        if (d[k] == null) return;
        dl.appendChild(el('dt', null, k === 'old_value' ? 'Previous value' : (k === 'new_value' ? 'New value' : 'More detail')));
        dl.appendChild(el('dd', null)).appendChild(el('pre', 'ad-pre', JSON.stringify(d[k], null, 2)));
      });
      if (!dl.firstChild) holder.appendChild(el('p', 'ad-note', 'Nothing more was recorded for this row.'));
      else holder.appendChild(dl);
    }
    holder.dataset.open = '1'; btn.textContent = 'Hide';
  }

  function drawRows(rows) {
    clear(body);
    var wrap = el('div', 'ad-tablewrap ad-cards');
    var tbl = el('table', 'ad-table ad-table--cards');
    tbl.appendChild(el('caption', 'ad-sr', 'Activity log'));
    var hr = el('tr');
    ['Time', 'Log', 'Who', 'What', 'On', 'Result', ''].forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; hr.appendChild(th); });
    var thead = el('thead'); thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      function cell(label, content) { var td = el('td'); td.setAttribute('data-label', label); if (content && content.nodeType) td.appendChild(content); else td.textContent = content == null ? '' : content; tr.appendChild(td); return td; }
      cell('Time', when(r.at));
      cell('Log', words(r.source));
      cell('Who', r.actor_name || (r.actor ? shortId(r.actor) : '\u2014'));
      cell('What', words(r.action) || '\u2014');
      cell('On', (r.target_type ? words(r.target_type) : '') + (r.target_id ? ' ' + shortId(r.target_id) : '') || '\u2014');
      cell('Result', resultBadge(r.outcome));
      var act = el('td'); act.setAttribute('data-label', '');
      if (r.source === 'admin' && r.admin_log_id != null) {
        var b = el('button', 'btn ad-btn-small', 'Details'); b.type = 'button';
        var holder = el('div', 'ad-detail');
        b.addEventListener('click', function () { showDetail(r, holder, b); });
        act.appendChild(b); act.appendChild(holder);
      }
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl); body.appendChild(wrap);
  }

  async function load() {
    var mine = ++req;
    clear(body); body.appendChild(ctx.skeleton(4)); pager.hidden = true;
    var res;
    try {
      res = await window.supabase.rpc('admin_activity_feed', {
        p_source: f.source.value || null, p_outcome: f.outcome.value || null, p_search: f.search.value.trim() || null,
        p_from: dayStart(f.from.value), p_to: dayAfter(f.to.value), p_security: !!f.security.checked,
        p_limit: PAGE, p_offset: offset
      });
    } catch (e) { res = { error: e }; }
    if (mine !== req) return;                                   /* a newer request replaced this one */
    if (res.error || !res.data) {
      var code = res.error && res.error.code;
      if (code === '42501') ctx.showNoPermission(body, 'audit_logs.view');
      else if (code === '42883' || code === 'PGRST202') ctx.showError(body, 'The activity log function is not on the server yet. Run sql/admin/a6-activity-feed.sql in the Supabase SQL editor, then press Retry.', load);
      else ctx.showError(body, 'The server could not answer. Nothing was changed.', load);
      return;
    }
    var d = res.data;
    drawSources(d.sources || []); drawSourceNote(d.sources || []);
    var rows = d.rows || [];
    if (!rows.length) {
      var filtered = offset > 0 || f.source.value || f.outcome.value || f.search.value.trim() || f.from.value || f.to.value || f.security.checked;
      if (filtered && offset === 0) ctx.showNoResults(body); else if (offset > 0) { clear(body); body.appendChild(el('p', 'ad-note', 'No older rows.')); } else ctx.showEmpty(body, 'Nothing has been logged yet.');
    } else drawRows(rows);
    prev.disabled = offset === 0; next.disabled = !d.has_more;
    pager.hidden = !(offset > 0 || d.has_more);
  }

  f.form.addEventListener('submit', function (e) { e.preventDefault(); offset = 0; load(); });
  f.reset.addEventListener('click', function () { f.form.reset(); offset = 0; load(); });
  prev.addEventListener('click', function () { offset = Math.max(0, offset - PAGE); load(); });
  next.addEventListener('click', function () { offset += PAGE; load(); });
  load();
});

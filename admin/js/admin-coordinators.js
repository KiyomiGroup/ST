/* StreetTasker Admin: Coordinators and applications (stage A9, spec S07).
   Every read and write goes through an admin_coordinator_* database function (sql/admin/a9-coordinators.sql). Each one checks the
   admin permission on the server, refuses the admin's own coordinator account (Rule R-SELF), and writes the admin activity log.
   This page never decides who may do what: it only hides what the permissions say you cannot use.
   What it never does: set or change a Local Tasker's price, accept a job for a worker, touch money, or edit identity status.
   The coordinator's plan limit is decided by the database (assignment guard); a full coordinator is refused there.
   All text is inserted with textContent, so applicant answers cannot inject markup. */
'use strict';
AdminShell.init({ page: 'coordinators', title: 'Coordinators', permission: null }).then(function (ctx) {
  var sb = window.supabase;
  var $ = function (id) { return document.getElementById(id); };
  var canView = ctx.has('coordinators.view');
  var canReview = ctx.has('coordinators.applications.review');
  if (!canView && !canReview) { ctx.showNoPermission(ctx.content, 'coordinators.view'); return; }

  var STATUS = { pending: 'Waiting for identity check', active: 'Active', suspended: 'Suspended', deactivated: 'Deactivated' };
  var APP_STATUS = { new: 'New', approved: 'Approved', rejected: 'Rejected', passed: 'Passed the test' };
  var CODE_STATE = { issued: 'A sign-up code was issued', used: 'The sign-up code was used', expired: 'The sign-up code expired' };
  var ANSWER_LABEL = { trades: 'Skills or trades', age_range: 'Age range', occupation: 'Occupation', areas: 'Areas they know', years_in_area: 'Years in the area',
    how_you_know: 'How they know people there', experience: 'Experience', hours: 'Hours they can give', languages: 'Languages', smartphone: 'Has a smartphone',
    has_id: 'Has an ID', why: 'Why they want to be a coordinator', heard: 'How they heard of us', social: 'Social media', ref_name: 'Reference name', ref_phone: 'Reference phone', notes: 'Notes' };
  var SKIP_ANSWER = { consent: 1, consent_at: 1 };
  var TABS = [
    { key: 'coordinators', label: 'Coordinators', need: canView },
    { key: 'applications', label: 'Applications', need: canReview },
    { key: 'workload', label: 'Workload', need: canView }
  ].filter(function (t) { return t.need; });
  var state = { tab: TABS[0].key, ov: null, sel: null, apps: null, appFilter: 'new', selApp: null, loadId: 0 };

  $('adCoord').hidden = false;

  /* ---------- helpers ---------- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(t) { if (!t) return 'Never'; var d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function num(v) { return v == null ? '-' : String(v); }
  function pretty(k) { return ANSWER_LABEL[k] || String(k).replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); }); }
  function yn(b) { return b === true ? 'Yes' : b === false ? 'No' : '-'; }
  function statusBadge(st) {
    var cls = st === 'active' ? 'badge badge-green' : st === 'pending' ? 'badge badge-amber' : st === 'suspended' ? 'badge badge-amber' : 'badge badge-gray';
    return h('span', cls, STATUS[st] || st || 'Unknown');
  }
  function appBadge(st) {
    var cls = st === 'new' ? 'badge badge-amber' : st === 'approved' || st === 'passed' ? 'badge badge-green' : 'badge badge-gray';
    return h('span', cls, APP_STATUS[st] || st || 'Unknown');
  }
  function field(label, control) { var g = h('div', 'ad-field'); var l = h('label', null, label); if (control.id) l.setAttribute('for', control.id); return add(g, l, control); }
  var uid = 0;
  function nextId(p) { uid += 1; return p + uid; }
  function dl(pairs) {
    var d = h('dl', 'ad-dl');
    pairs.forEach(function (p) { add(d, h('dt', null, p[0]), h('dd', null, p[1] == null || p[1] === '' ? '-' : String(p[1]))); });
    return d;
  }

  /* Every admin_coordinator_* function answers { ok, error, ... }. Anything else is a failure. */
  async function call(name, args) {
    try {
      var r = await sb.rpc(name, args || {});
      if (r.error) {
        if (r.error.code === '42501') return { ok: false, error: 'You do not have permission to do this.' };
        if (r.error.code === '42883' || r.error.code === 'PGRST202') return { ok: false, missing: true, error: 'A server function is missing. Run sql/admin/a9-coordinators.sql in the Supabase SQL editor.' };
        return { ok: false, error: r.error.message || 'Request failed.' };
      }
      var d = r.data;
      if (d && typeof d === 'object' && 'ok' in d) return d;
      return { ok: false, error: 'Unexpected reply from the server.' };
    } catch (e) { return { ok: false, error: 'Could not reach the server.' }; }
  }

  function copyBox(label, value, note) {
    var box = h('div', 'ad-secretbox');
    var id = nextId('coCopy');
    var inp = h('input', 'form-input'); inp.id = id; inp.type = 'text'; inp.readOnly = true; inp.value = value || '';
    var btn = h('button', 'btn btn-primary', 'Copy'); btn.type = 'button';
    btn.addEventListener('click', async function () {
      try { await navigator.clipboard.writeText(inp.value); ctx.toast('Copied.'); }
      catch (e) { inp.focus(); inp.select(); ctx.toast('Press Ctrl+C (or hold and copy) to copy it.'); }
    });
    add(box, field(label, inp), add(h('div', 'ad-actions ad-actions--tight'), btn));
    if (note) add(box, h('p', 'ad-hint', note));
    return box;
  }

  /* ---------- load ---------- */
  async function loadOverview() {
    var mine = ++state.loadId;
    if (!canView) { render(); return; }
    var body = $('coBody');
    if (!state.ov) { clear(body); body.appendChild(ctx.skeleton(4)); }
    var r = await call('admin_coordinator_overview');
    if (mine !== state.loadId) return;
    if (!r.ok) { ctx.showError(body, r.error, loadOverview); return; }
    state.ov = r; render();
  }
  function coords() { return (state.ov && state.ov.coordinators) || []; }
  function coordById(id) { return coords().filter(function (c) { return c.user_id === id; })[0]; }
  function coordName(c) { return (c && (c.name || c.email)) || 'Coordinator'; }
  function capText(c) { return num(c.workers) + ' of ' + (c.capacity == null ? '?' : c.capacity) + ' places'; }

  function drawTabs() {
    var box = $('coTabs'); clear(box);
    TABS.forEach(function (t) {
      var on = t.key === state.tab;
      var b = h('button', 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'), t.label); b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () { state.tab = t.key; render(); });
      box.appendChild(b);
    });
  }
  function render() {
    drawTabs();
    var body = $('coBody'); clear(body);
    if (state.tab === 'applications') return renderApplications(body);
    if (!state.ov) { body.appendChild(ctx.skeleton(4)); return; }
    if (state.tab === 'workload') return renderWorkload(body);
    renderCoordinators(body);
  }

  /* ---------- the shared "place a Local Tasker" form (first assignment or move) ---------- */
  function assignForm(opt) {
    var f = h('form', 'ad-form ad-inline-form'); f.noValidate = true;
    var sel = h('select', 'form-input'); sel.id = nextId('coTo');
    add(sel, (function () { var o = h('option', null, 'Choose a coordinator'); o.value = ''; return o; })());
    coords().filter(function (c) { return c.status === 'active' && c.user_id !== opt.from && !c.is_me; }).forEach(function (c) {
      var full = c.capacity != null && c.workers >= c.capacity;
      var o = h('option', null, coordName(c) + ' (' + capText(c) + (full ? ', full' : '') + ')'); o.value = c.user_id; if (full) o.disabled = true; sel.appendChild(o);
    });
    var reason = h('textarea', 'form-input'); reason.id = nextId('coWhy'); reason.rows = 3; reason.maxLength = 300;
    var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var go = h('button', 'btn btn-primary', opt.moving ? 'Move ' + opt.name : 'Assign ' + opt.name); go.type = 'submit';
    var cancel = h('button', 'btn btn-ghost', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', function () { if (f.parentNode) f.parentNode.removeChild(f); });
    add(f, field('New coordinator', sel), field('Reason (at least 10 characters; it goes in the activity log)', reason), err, add(h('div', 'ad-actions ad-actions--tight'), go, cancel));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); err.hidden = true;
      if (!sel.value) { err.textContent = 'Choose a coordinator.'; err.hidden = false; return; }
      if (reason.value.trim().length < 10) { err.textContent = 'Write a reason of at least 10 characters.'; err.hidden = false; return; }
      go.disabled = true;
      var r = await call('admin_coordinator_assign_local_tasker', { p_tasker: opt.tasker, p_coordinator: sel.value, p_reason: reason.value.trim() });
      go.disabled = false;
      if (!r.ok) { err.textContent = r.error || 'It could not be done. Nothing was changed.'; err.hidden = false; return; }
      ctx.toast(r.kind === 'moved' ? 'Local Tasker moved.' : 'Local Tasker assigned.');
      state.ov = null; await loadOverview();
      if (opt.after) opt.after();
    });
    return f;
  }

  /* ---------- Coordinators tab ---------- */
  function renderCoordinators(body) {
    var r = state.ov;
    if (r.coordinators_error || r.coordinators == null) { ctx.showError(body, r.coordinators_error || 'The coordinator list could not be read.', function () { state.ov = null; loadOverview(); }); return; }
    var split = h('div', 'ad-split' + (state.sel ? ' is-detail' : ''));
    var listCol = h('section', 'ad-split-list'); listCol.setAttribute('aria-label', 'Coordinators');
    var detCol = h('section', 'ad-split-detail'); detCol.setAttribute('aria-label', 'Coordinator detail');
    var back = h('button', 'btn ad-back', 'Back to the list'); back.type = 'button';
    back.addEventListener('click', function () { state.sel = null; render(); });
    var detail = h('div');
    add(detCol, back, detail);

    var card = h('div', 'ad-card');
    add(card, h('p', 'ad-hint', coords().length + (coords().length === 1 ? ' coordinator' : ' coordinators')));
    if (!coords().length) ctx.showEmpty(card, 'No coordinator has signed up yet.');
    else {
      var ul = h('ul', 'ad-rows');
      coords().forEach(function (c) {
        var b = h('button', 'ad-row'); b.type = 'button';
        if (state.sel === c.user_id) b.setAttribute('aria-current', 'true');
        add(b, add(h('span', 'ad-row-top'), h('span', 'ad-row-title', coordName(c)), statusBadge(c.status)),
          h('span', 'ad-row-sub', c.email || ''), h('span', 'ad-hint', capText(c) + ' · last sign-in ' + when(c.last_sign_in_at)));
        b.addEventListener('click', function () { state.sel = c.user_id; render(); });
        add(ul, add(h('li'), b));
      });
      card.appendChild(ul);
    }
    add(listCol, card);
    add(split, listCol, detCol); body.appendChild(split);
    var c = state.sel && coordById(state.sel);
    if (c) drawCoordinatorDetail(detail, c);
    else add(detail, add(h('div', 'ad-card'), h('p', 'ad-note', 'Choose a coordinator on the left.')));
  }

  async function drawCoordinatorDetail(box, c) {
    var card = h('div', 'ad-card ad-panel');
    add(card, add(h('div', 'ad-row-top'), h('h2', 'ad-panel-title', coordName(c)), statusBadge(c.status)));
    if (c.is_me) add(card, h('p', 'ad-note', 'This is your own coordinator account. For safety you cannot move Local Taskers to or from it, or deactivate it, from the admin area.'));
    add(card, dl([['Email', c.email], ['Plan tier', c.tier], ['Places used', capText(c)], ['Published Local Taskers', num(c.published)],
      ['Local bookings (all)', num(c.bookings_total)], ['Last sign-in', when(c.last_sign_in_at)], ['Signed up', when(c.created_at)]]));
    box.appendChild(card);

    var wcard = h('div', 'ad-card ad-panel');
    add(wcard, h('h2', 'ad-panel-title', 'Local Taskers in their care'));
    var wbody = h('div'); wbody.appendChild(ctx.skeleton(2)); add(wcard, wbody); box.appendChild(wcard);
    var r = await call('admin_coordinator_workers', { p_coordinator: c.user_id });
    if (state.sel !== c.user_id) return;
    clear(wbody);
    if (!r.ok) { ctx.showError(wbody, r.error, function () { render(); }); }
    else if (!r.workers.length) add(wbody, h('p', 'ad-note', 'No Local Taskers right now.'));
    else {
      var ul = h('ul', 'ad-sub');
      r.workers.forEach(function (w) {
        var li = h('li');
        var left = h('span', null, (w.name || 'Local Tasker') + (w.areas ? ' · ' + w.areas : '') + ' · ' + num(w.bookings) + ' booking' + (w.bookings === 1 ? '' : 's'));
        add(li, left, h('span', 'badge badge-gray', w.status || 'unknown'));
        if (state.ov.can_assign && !c.is_me) {
          var mv = h('button', 'btn btn-sm btn-outline', 'Move'); mv.type = 'button';
          mv.addEventListener('click', function () {
            if (li.querySelector('form')) return;
            li.appendChild(assignForm({ tasker: w.tasker_user_id, name: w.name || 'this Local Tasker', from: c.user_id, moving: true }));
          });
          li.appendChild(mv);
        }
        ul.appendChild(li);
      });
      wbody.appendChild(ul);
    }

    if (state.ov.can_manage && !c.is_me && c.status !== 'deactivated') box.appendChild(deactivatePanel(c));
  }

  function deactivatePanel(c) {
    var card = h('div', 'ad-card ad-panel');
    add(card, h('h2', 'ad-panel-title', 'Deactivate this coordinator'));
    add(card, h('p', 'ad-note', 'Only possible when no Local Taskers and no open Local bookings are left with them. Move the Local Taskers first. Nothing is deleted: the account, assignments and history stay.'));
    var f = h('form', 'ad-form'); f.noValidate = true;
    var reason = h('textarea', 'form-input'); reason.id = nextId('coDeact'); reason.rows = 3; reason.maxLength = 300;
    var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var go = h('button', 'btn btn-outline', 'Deactivate'); go.type = 'submit';
    var armed = false;
    add(f, field('Reason (at least 10 characters)', reason), err, add(h('div', 'ad-actions ad-actions--tight'), go));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); err.hidden = true;
      if (reason.value.trim().length < 10) { err.textContent = 'Write a reason of at least 10 characters.'; err.hidden = false; return; }
      if (!armed) { armed = true; go.textContent = 'Press again to confirm'; return; }
      go.disabled = true;
      var r = await call('admin_coordinator_deactivate', { p_coordinator: c.user_id, p_reason: reason.value.trim() });
      go.disabled = false; armed = false; go.textContent = 'Deactivate';
      if (!r.ok) { err.textContent = r.error || 'It could not be done. Nothing was changed.'; err.hidden = false; return; }
      ctx.toast('Coordinator deactivated.');
      state.ov = null; await loadOverview();
    });
    reason.addEventListener('input', function () { armed = false; go.textContent = 'Deactivate'; });
    add(card, f);
    return card;
  }

  /* ---------- Workload tab ---------- */
  function renderWorkload(body) {
    var r = state.ov;
    var card = h('div', 'ad-card');
    add(card, h('h2', 'ad-card-title', 'Workload'), h('p', 'ad-note', 'Places used against each coordinator\'s plan limit. The limit is set by their plan and enforced by the database.'));
    if (r.coordinators == null) { ctx.showError(card, r.coordinators_error || 'The coordinator list could not be read.', function () { state.ov = null; loadOverview(); }); body.appendChild(card); }
    else if (!coords().length) { ctx.showEmpty(card, 'No coordinator has signed up yet.'); body.appendChild(card); }
    else {
      var wrap = h('div', 'ad-tablewrap'); var t = h('table', 'ad-table ad-table--cards');
      var thead = h('thead'); var hr = h('tr');
      ['Coordinator', 'Status', 'Places used', 'Local bookings (all)'].forEach(function (x) { hr.appendChild(h('th', null, x)); });
      thead.appendChild(hr); t.appendChild(thead);
      var tb = h('tbody');
      coords().forEach(function (c) {
        var tr = h('tr');
        var td1 = h('td'); td1.setAttribute('data-label', 'Coordinator'); td1.textContent = coordName(c);
        var td2 = h('td'); td2.setAttribute('data-label', 'Status'); td2.appendChild(statusBadge(c.status));
        var td3 = h('td'); td3.setAttribute('data-label', 'Places used');
        if (c.capacity != null) { var m = h('meter'); m.min = 0; m.max = c.capacity || 1; m.value = Math.min(c.workers, c.capacity || 1); m.setAttribute('aria-label', capText(c)); add(td3, m, h('span', 'ad-hint', ' ' + capText(c))); }
        else td3.textContent = capText(c);
        var td4 = h('td', null, num(c.bookings_total)); td4.setAttribute('data-label', 'Local bookings (all)');
        add(tr, td1, td2, td3, td4); tb.appendChild(tr);
      });
      t.appendChild(tb); wrap.appendChild(t); card.appendChild(wrap); body.appendChild(card);
    }
    var ucard = h('div', 'ad-card ad-panel');
    add(ucard, h('h2', 'ad-panel-title', 'Local Taskers with no coordinator'));
    if (r.unassigned == null) add(ucard, h('p', 'ad-note', 'Not available: the Local Tasker list could not be read.'));
    else if (!r.unassigned.length) add(ucard, h('p', 'ad-note', 'Every Local Tasker has a coordinator.'));
    else {
      var ul = h('ul', 'ad-sub');
      r.unassigned.forEach(function (w) {
        var li = h('li');
        add(li, h('span', null, (w.name || 'Local Tasker') + (w.areas ? ' · ' + w.areas : '')), h('span', 'badge badge-gray', w.status || 'unknown'));
        if (r.can_assign) {
          var b = h('button', 'btn btn-sm btn-outline', 'Assign'); b.type = 'button';
          b.addEventListener('click', function () {
            if (li.querySelector('form')) return;
            li.appendChild(assignForm({ tasker: w.tasker_user_id, name: w.name || 'this Local Tasker', from: null, moving: false }));
          });
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
      ucard.appendChild(ul);
    }
    body.appendChild(ucard);
  }

  /* ---------- Applications tab ---------- */
  var APP_FILTERS = [['new', 'New'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['passed', 'Passed the test'], ['', 'All']];
  async function loadApps() {
    var mine = ++state.loadId;
    var body = $('coBody');
    if (!state.apps) { clear(body); drawTabs(); body.appendChild(ctx.skeleton(4)); }
    var r = await call('admin_coordinator_applications', { p_status: state.appFilter || null });
    if (mine !== state.loadId) return;
    if (!r.ok) { clear(body); ctx.showError(body, r.error, loadApps); return; }
    state.apps = r.applications || []; render();
  }
  function renderApplications(body) {
    if (!state.apps) { loadApps(); return; }
    if (ctx.has('coordinators.manage')) { if (!state.codeEl) state.codeEl = codeCreator(); body.appendChild(state.codeEl); }
    var split = h('div', 'ad-split' + (state.selApp ? ' is-detail' : ''));
    var listCol = h('section', 'ad-split-list'); listCol.setAttribute('aria-label', 'Applications');
    var detCol = h('section', 'ad-split-detail'); detCol.setAttribute('aria-label', 'Application detail');
    var back = h('button', 'btn ad-back', 'Back to the list'); back.type = 'button';
    back.addEventListener('click', function () { state.selApp = null; render(); });
    var detail = h('div'); add(detCol, back, detail);

    var card = h('div', 'ad-card');
    var tabs = h('div', 'ad-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Show');
    APP_FILTERS.forEach(function (f) {
      var on = (state.appFilter || '') === f[0];
      var b = h('button', 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'), f[1]); b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () { state.appFilter = f[0]; state.apps = null; state.selApp = null; render(); });
      tabs.appendChild(b);
    });
    add(card, tabs, h('p', 'ad-hint', state.apps.length + (state.apps.length === 1 ? ' application' : ' applications')));
    if (!state.apps.length) ctx.showEmpty(card, state.appFilter === 'new' ? 'No application is waiting.' : 'No applications in this view.');
    else {
      var ul = h('ul', 'ad-rows');
      state.apps.forEach(function (a) {
        var b = h('button', 'ad-row'); b.type = 'button';
        if (state.selApp === a.id) b.setAttribute('aria-current', 'true');
        add(b, add(h('span', 'ad-row-top'), h('span', 'ad-row-title', a.full_name || 'Applicant'), appBadge(a.status)),
          h('span', 'ad-row-sub', [a.city, a.state].filter(Boolean).join(', ')),
          h('span', 'ad-hint', 'Can bring ' + num(a.tasker_count) + ' Local Taskers · ' + when(a.created_at)));
        b.addEventListener('click', function () { state.selApp = a.id; render(); });
        add(ul, add(h('li'), b));
      });
      card.appendChild(ul);
    }
    add(listCol, card); add(split, listCol, detCol); body.appendChild(split);
    var a = state.selApp && state.apps.filter(function (x) { return x.id === state.selApp; })[0];
    if (a) drawApplication(detail, a); else add(detail, add(h('div', 'ad-card'), h('p', 'ad-note', 'Choose an application on the left.')));
  }

  function drawApplication(box, a) {
    var card = h('div', 'ad-card ad-panel');
    add(card, add(h('div', 'ad-row-top'), h('h2', 'ad-panel-title', a.full_name || 'Applicant'), appBadge(a.status)));
    add(card, dl([['Email', a.email], ['Phone', a.phone], ['WhatsApp', a.whatsapp], ['Location', [a.city, a.state].filter(Boolean).join(', ')],
      ['Local Taskers they can bring', num(a.tasker_count)], ['Area they would cover (square metres)', num(a.area_sqm)],
      ['Can meet Local Taskers in person', yn(a.can_meet_taskers)], ['Can explain what a Local Tasker is', yn(a.can_explain)], ['Applied', when(a.created_at)]]));
    if (a.explain_text) add(card, h('h3', 'ad-card-title', 'In their own words'), h('p', 'ad-text', a.explain_text));
    if (a.code_state) add(card, h('p', 'ad-note', CODE_STATE[a.code_state] || a.code_state));
    if (a.status === 'rejected') {
      var why = a.reject_reason || a.rejected_reason || a.decision_note;
      if (why) add(card, h('p', 'ad-note', 'Reason given: ' + why));
    }
    box.appendChild(card);

    var ans = a.answers && typeof a.answers === 'object' ? a.answers : {};
    var keys = Object.keys(ans).filter(function (k) { return !SKIP_ANSWER[k] && ans[k] !== '' && ans[k] != null; });
    if (keys.length) {
      var acard = h('div', 'ad-card ad-panel'); add(acard, h('h2', 'ad-panel-title', 'Their answers'));
      acard.appendChild(dl(keys.map(function (k) {
        var v = ans[k]; v = Array.isArray(v) ? v.join(', ') : (typeof v === 'boolean' ? yn(v) : (typeof v === 'object' ? JSON.stringify(v) : v));
        return [pretty(k), v];
      })));
      box.appendChild(acard);
    }
    if (a.status === 'new') box.appendChild(decisionPanel(a));
    else if (a.status === 'approved') add(box, add(h('div', 'ad-card'), h('p', 'ad-note', 'Approved. The test link is shown only once, when you approve, and is never stored in the activity log.')));
  }

  function decisionPanel(a) {
    var card = h('div', 'ad-card ad-panel'); add(card, h('h2', 'ad-panel-title', 'Decision'));
    var out = h('div');
    var days = h('select', 'form-input'); days.id = nextId('coDays');
    [['', 'Default'], ['3', '3 days'], ['7', '7 days'], ['14', '14 days']].forEach(function (o) { var op = h('option', null, o[1]); op.value = o[0]; days.appendChild(op); });
    var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var approve = h('button', 'btn btn-primary', 'Approve and get the test link'); approve.type = 'button';
    approve.addEventListener('click', async function () {
      err.hidden = true; approve.disabled = true;
      var r = await call('admin_coordinator_application_approve', { p_application: a.id, p_days: days.value ? Number(days.value) : null });
      approve.disabled = false;
      if (!r.ok) { err.textContent = r.error || 'It could not be done. Nothing was changed.'; err.hidden = false; return; }
      clear(card);
      add(card, h('h2', 'ad-panel-title', 'Approved'));
      if (r.link) add(card, copyBox('Test link for ' + (a.full_name || 'the applicant'), r.link, 'Copy it now and send it to the applicant yourself. It is not shown again and is not kept in the activity log.'));
      else add(card, h('p', 'ad-note', 'Approved, but the server returned no link. Ask the developer to check the approval function.'));
      state.apps = null; /* the list is reloaded when the admin leaves this card */
    });
    add(card, h('p', 'ad-note', 'Approving gives the applicant a link to the coordinator test. It does not create a coordinator account.'),
      field('Link lasts', days), err, add(h('div', 'ad-actions ad-actions--tight'), approve), out);

    var f = h('form', 'ad-form'); f.noValidate = true;
    var reason = h('textarea', 'form-input'); reason.id = nextId('coRej'); reason.rows = 3; reason.maxLength = 300;
    var rerr = h('p', 'ad-error'); rerr.hidden = true; rerr.setAttribute('role', 'alert');
    var rej = h('button', 'btn btn-outline', 'Reject'); rej.type = 'submit';
    add(f, field('Reject with a reason (at least 10 characters)', reason), rerr, add(h('div', 'ad-actions ad-actions--tight'), rej));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); rerr.hidden = true;
      if (reason.value.trim().length < 10) { rerr.textContent = 'Write a reason of at least 10 characters.'; rerr.hidden = false; return; }
      rej.disabled = true;
      var r = await call('admin_coordinator_application_reject', { p_application: a.id, p_reason: reason.value.trim() });
      rej.disabled = false;
      if (!r.ok) { rerr.textContent = r.error || 'It could not be done. Nothing was changed.'; rerr.hidden = false; return; }
      ctx.toast('Application rejected.'); state.apps = null; state.selApp = null; render();
    });
    add(card, f);
    return card;
  }

  function codeCreator() {
    var d = h('details', 'ad-card ad-orphans');
    add(d, h('summary', null, 'Create a sign-up code by hand (optional)'));
    var f = h('form', 'ad-form'); f.noValidate = true;
    var note = h('input', 'form-input'); note.id = nextId('coNote'); note.type = 'text'; note.maxLength = 120;
    var days = h('select', 'form-input'); days.id = nextId('coCDays');
    [['7', '7 days'], ['14', '14 days'], ['30', '30 days']].forEach(function (o) { var op = h('option', null, o[1]); op.value = o[0]; if (o[0] === '30') op.selected = true; days.appendChild(op); });
    var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var go = h('button', 'btn btn-primary', 'Create code'); go.type = 'submit';
    var out = h('div');
    add(f, field('Who is it for? (3 to 120 characters)', note), field('Valid for', days), err, add(h('div', 'ad-actions ad-actions--tight'), go));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); err.hidden = true;
      if (note.value.trim().length < 3) { err.textContent = 'Write who the code is for.'; err.hidden = false; return; }
      go.disabled = true;
      var r = await call('admin_coordinator_code_create', { p_note: note.value.trim(), p_days: Number(days.value) });
      go.disabled = false;
      if (!r.ok) { err.textContent = r.error || 'It could not be done.'; err.hidden = false; return; }
      clear(out); note.value = '';
      add(out, copyBox('Sign-up code', r.code || '', 'Shown once. It is not kept in the activity log.'));
    });
    add(d, f, out);
    return d;
  }

  if (canView) loadOverview(); else render();
});

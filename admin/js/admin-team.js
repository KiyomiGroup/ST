/* StreetTasker Admin: Admin team (spec S08). A5c: READ ONLY.
   Calls rpc admin_team_list (every admin login: name, email, status, roles, last active, two-step on or off).
   Needs admin.team.view; the server checks it again. No invite, role change or deactivate exists here yet (A5d and A5e).
   All text via textContent. */
'use strict';
AdminShell.init({ page: 'team', title: 'Admin team', permission: 'admin.team.view' }).then(function (ctx) {
  var root = document.getElementById('tmRoot');
  var body = document.getElementById('tmBody');
  root.hidden = false;

  var TABS = [['active', 'Active'], ['inactive', 'Not active'], ['all', 'All']];
  var STATUS = { active: ['Active', 'badge-green'], suspended: ['Suspended', 'badge-amber'], removed: ['Removed', 'badge-gray'] };
  var state = { tab: 'active', rows: [], supers: null, mfaRequired: false, req: 0 };

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { if (!v) return 'Never'; var d = new Date(v); return isNaN(d) ? 'Never' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function isActive(r) { return r.status === 'active' && !r.removed; }
  function effStatus(r) { return r.removed ? 'removed' : r.status; }

  function inTab(r) {
    if (state.tab === 'active') return isActive(r);
    if (state.tab === 'inactive') return !isActive(r);
    return true;
  }
  function count(tab) {
    return state.rows.filter(function (r) { return tab === 'all' ? true : (tab === 'active' ? isActive(r) : !isActive(r)); }).length;
  }

  function errorFor(node, res, retry) {
    var code = res.error && res.error.code;
    if (code === '42501') ctx.showNoPermission(node, 'admin.team.view');
    else if (code === '42883' || code === 'PGRST202') ctx.showError(node, 'The team function is not on the server yet. Run sql/admin/a5c-team-read.sql in the Supabase SQL editor, then press Retry.', retry);
    else ctx.showError(node, 'The server could not answer. Nothing was changed.', retry);
  }

  function drawTabs() {
    var box = document.getElementById('tmTabs'); clear(box);
    TABS.forEach(function (t) {
      var on = state.tab === t[0];
      var b = h('button', 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'), t[1] + ' (' + count(t[0]) + ')');
      b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () { if (state.tab === t[0]) return; state.tab = t[0]; drawTabs(); render(); });
      box.appendChild(b);
    });
  }

  function drawNotes() {
    var box = document.getElementById('tmNotes'); clear(box);
    if (state.supers != null && state.supers < 2) {
      box.appendChild(h('p', 'ad-note', state.supers === 0
        ? 'There is no active Super Admin.'
        : 'Only one Super Admin is active. A request must be decided by a Super Admin other than the person who asked, so approvals cannot be decided until a second Super Admin is active.'));
    }
    if (!state.mfaRequired) box.appendChild(h('p', 'ad-note', 'Two-step sign-in is not required for every admin yet. The Two-step column shows who has an authenticator app set up.'));
  }

  function rolesCell(r) {
    var td = h('td'); td.setAttribute('data-label', 'Roles');
    var rs = r.roles || [];
    if (!rs.length) { td.textContent = 'No role'; return td; }
    rs.forEach(function (x, i) { if (i) td.appendChild(document.createTextNode(' ')); td.appendChild(h('span', 'badge badge-gray', x.label || x.key)); });
    return td;
  }

  function render() {
    clear(body);
    var rows = state.rows.filter(inTab);
    var card = h('section', 'ad-card');
    if (!rows.length) {
      ctx.showEmpty(card, state.tab === 'inactive' ? 'No admin is suspended or removed.' : 'No admins here yet.');
      body.appendChild(card); return;
    }
    var wrap = h('div', 'ad-tablewrap');
    var tbl = h('table', 'ad-table ad-table--cards');
    tbl.appendChild(h('caption', 'ad-sr', 'Admin team'));
    var hr = h('tr');
    ['Name', 'Email', 'Roles', 'Status', 'Last active', 'Two-step'].forEach(function (t) { var th = h('th', null, t); th.scope = 'col'; hr.appendChild(th); });
    var th0 = h('thead'); th0.appendChild(hr); tbl.appendChild(th0);
    var tb = h('tbody');
    rows.forEach(function (r) {
      var tr = h('tr');
      var c0 = h('td'); c0.setAttribute('data-label', 'Name');
      c0.appendChild(h('span', null, r.display_name || 'Unnamed admin'));
      if (r.is_me) { c0.appendChild(document.createTextNode(' ')); c0.appendChild(h('span', 'badge badge-blue', 'You')); }
      var c1 = h('td', null, r.email || '\u2014'); c1.setAttribute('data-label', 'Email');
      var c3 = h('td'); c3.setAttribute('data-label', 'Status');
      var st = STATUS[effStatus(r)] || [effStatus(r), 'badge-gray'];
      c3.appendChild(h('span', 'badge ' + st[1], st[0]));
      var c4 = h('td', null, when(r.last_seen_at)); c4.setAttribute('data-label', 'Last active');
      var c5 = h('td'); c5.setAttribute('data-label', 'Two-step');
      c5.appendChild(h('span', 'badge ' + (r.mfa_on ? 'badge-green' : 'badge-amber'), r.mfa_on ? 'On' : 'Off'));
      add(tr, c0, c1, rolesCell(r), c3, c4, c5); tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl); card.appendChild(wrap); body.appendChild(card);
  }

  async function load() {
    var mine = ++state.req;
    clear(body); body.appendChild(ctx.skeleton(4));
    var res;
    try { res = await window.supabase.rpc('admin_team_list'); } catch (e) { res = { error: e }; }
    if (mine !== state.req) return;
    if (res.error || !res.data) { errorFor(body, res, load); return; }
    state.rows = res.data.rows || []; state.supers = res.data.active_super_admins; state.mfaRequired = !!res.data.mfa_required;
    drawTabs(); drawNotes(); render();
  }
  load();
});

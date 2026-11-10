/* StreetTasker Admin: Roles and permissions (spec S24). A5c: READ ONLY.
   Calls rpc admin_role_directory (every role, its permissions, its active members, and the full permission list by group).
   Needs admin.team.view or admin.roles.manage; the server checks it again. Nothing can be edited here yet (A5d).
   All text via textContent. */
'use strict';
AdminShell.init({ page: 'roles', title: 'Roles and permissions', permission: null }).then(function (ctx) {
  var root = document.getElementById('rlRoot');
  var body = document.getElementById('rlBody');
  if (!(ctx.has('admin.team.view') || ctx.has('admin.roles.manage'))) { ctx.showNoPermission(ctx.content, 'admin.team.view'); return; }
  root.hidden = false;

  var state = { roles: [], perms: [], sel: null, req: 0 };

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function errorFor(node, res, retry) {
    var code = res.error && res.error.code;
    if (code === '42501') ctx.showNoPermission(node, 'admin.team.view');
    else if (code === '42883' || code === 'PGRST202') ctx.showError(node, 'The roles function is not on the server yet. Run sql/admin/a5c-team-read.sql in the Supabase SQL editor, then press Retry.', retry);
    else ctx.showError(node, 'The server could not answer. Nothing was changed.', retry);
  }

  function role() { return state.roles.filter(function (r) { return r.key === state.sel; })[0] || null; }

  function drawTabs() {
    var box = document.getElementById('rlTabs'); clear(box);
    state.roles.forEach(function (r) {
      var on = state.sel === r.key;
      var b = h('button', 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'), r.label);
      b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () { if (state.sel === r.key) return; state.sel = r.key; drawTabs(); render(); });
      box.appendChild(b);
    });
  }

  function render() {
    clear(body);
    var r = role();
    if (!r) { ctx.showEmpty(body, 'No roles exist yet.'); return; }
    var allowed = {}; (r.permission_keys || []).forEach(function (k) { allowed[k] = true; });
    var total = state.perms.length, have = r.all_permissions ? total : Object.keys(allowed).length;

    var head = h('section', 'ad-card');
    var top = add(h('div', 'ad-row-top'), h('h2', 'ad-card-title', r.label), r.is_system ? h('span', 'badge badge-gray', 'System role') : null);
    head.appendChild(top);
    head.appendChild(h('p', 'ad-note', r.all_permissions
      ? 'Holds every permission, including any added later.'
      : 'Holds ' + have + ' of ' + total + ' permissions.'));
    var mem = r.members || [];
    head.appendChild(h('p', 'ad-note', mem.length ? 'Active admins with this role (' + mem.length + '): ' + mem.join(', ') : 'No active admin has this role.'));
    body.appendChild(head);

    var groups = [], seen = {};
    state.perms.forEach(function (p) { if (!seen[p.group_name]) { seen[p.group_name] = []; groups.push(p.group_name); } seen[p.group_name].push(p); });
    groups.forEach(function (g) {
      var card = h('section', 'ad-card');
      card.appendChild(h('h2', 'ad-card-title', g));
      var wrap = h('div', 'ad-tablewrap');
      var tbl = h('table', 'ad-table ad-table--cards');
      tbl.appendChild(h('caption', 'ad-sr', g + ' permissions for ' + r.label));
      var hr = h('tr');
      ['Permission', 'Access', 'Care'].forEach(function (t) { var th = h('th', null, t); th.scope = 'col'; hr.appendChild(th); });
      var th0 = h('thead'); th0.appendChild(hr); tbl.appendChild(th0);
      var tb = h('tbody');
      seen[g].forEach(function (p) {
        var ok = r.all_permissions || !!allowed[p.key];
        var tr = h('tr');
        var c0 = h('td', null, p.label); c0.setAttribute('data-label', 'Permission');
        var c1 = h('td'); c1.setAttribute('data-label', 'Access');
        c1.appendChild(h('span', 'badge ' + (ok ? 'badge-green' : 'badge-gray'), ok ? 'Allowed' : 'Not allowed'));
        var c2 = h('td'); c2.setAttribute('data-label', 'Care');
        if (p.sensitive) c2.appendChild(h('span', 'badge badge-amber', 'Sensitive'));
        add(tr, c0, c1, c2); tb.appendChild(tr);
      });
      tbl.appendChild(tb); wrap.appendChild(tbl); card.appendChild(wrap); body.appendChild(card);
    });
  }

  async function load() {
    var mine = ++state.req;
    clear(body); body.appendChild(ctx.skeleton(4));
    var res;
    try { res = await window.supabase.rpc('admin_role_directory'); } catch (e) { res = { error: e }; }
    if (mine !== state.req) return;
    if (res.error || !res.data) { errorFor(body, res, load); return; }
    state.roles = res.data.roles || []; state.perms = res.data.permissions || [];
    if (!role()) state.sel = state.roles.length ? state.roles[0].key : null;
    drawTabs(); render();
  }
  load();
});

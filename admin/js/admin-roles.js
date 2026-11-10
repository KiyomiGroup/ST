/* StreetTasker Admin: Roles and permissions (spec S24). A5c: read; A5d: ask to change a role's permissions through an approval.
   Reads: rpc admin_role_directory, admin_team_changes_mine. Writes (only with admin.roles.manage): admin_role_request_change and
   admin_role_apply_change. A request changes NOTHING: a different Super Admin approves it on Pending approvals, then the person who
   asked applies it here. Super Admin cannot be edited, and approvals.decide cannot be given to another role (the server refuses both).
   All text via textContent. */
'use strict';
AdminShell.init({ page: 'roles', title: 'Roles and permissions', permission: null }).then(function (ctx) {
  var root = document.getElementById('rlRoot');
  var body = document.getElementById('rlBody');
  if (!(ctx.has('admin.team.view') || ctx.has('admin.roles.manage'))) { ctx.showNoPermission(ctx.content, 'admin.team.view'); return; }
  root.hidden = false;

  var canManage = ctx.has('admin.roles.manage');
  var AC = window.AdminChange;
  var state = { roles: [], perms: [], sel: null, req: 0, edit: false, boxes: {} };
  var chg = AC.mine(ctx, {
    action: 'admin.role.change', applyFn: 'admin_role_apply_change', onDone: function () { state.edit = false; load(); },
    describe: function (r) {
      var now = (r.payload && r.payload.permissions) || [], was = (r.previous_value && r.previous_value.permissions) || [];
      var add = now.filter(function (k) { return was.indexOf(k) < 0; }), del = was.filter(function (k) { return now.indexOf(k) < 0; });
      return [add.length ? 'add ' + add.join(', ') : '', del.length ? 'remove ' + del.join(', ') : ''].filter(Boolean).join('; ') || 'change permissions';
    }
  });
  var editBox = h('div');

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
      b.addEventListener('click', function () { if (state.sel === r.key) return; state.sel = r.key; state.edit = false; drawTabs(); render(); });
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
    var editing = canManage && state.edit && !r.all_permissions;
    if (canManage && !r.all_permissions && !state.edit) {
      var eb = h('button', 'btn btn-outline', 'Ask to change this role\u2019s permissions'); eb.type = 'button';
      eb.addEventListener('click', function () { state.edit = true; render(); });
      head.appendChild(add(h('div', 'ad-actions ad-actions--tight'), eb));
    }
    if (editing) head.appendChild(h('p', 'ad-note', 'Tick what this role should be allowed to do, then send a request at the bottom of the page. Nothing changes until a different Super Admin approves it and you apply it.'));
    state.boxes = {};
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
        if (editing) {
          var lb = h('label', 'ad-check'); var cb = h('input'); cb.type = 'checkbox'; cb.value = p.key; cb.checked = ok;
          if (p.key === 'approvals.decide') { cb.checked = false; cb.disabled = true; }
          state.boxes[p.key] = cb; add(lb, cb, h('span', null, p.key === 'approvals.decide' ? 'Super Admin only' : 'Allowed')); c1.appendChild(lb);
        } else c1.appendChild(h('span', 'badge ' + (ok ? 'badge-green' : 'badge-gray'), ok ? 'Allowed' : 'Not allowed'));
        var c2 = h('td'); c2.setAttribute('data-label', 'Care');
        if (p.sensitive) c2.appendChild(h('span', 'badge badge-amber', 'Sensitive'));
        add(tr, c0, c1, c2); tb.appendChild(tr);
      });
      tbl.appendChild(tb); wrap.appendChild(tbl); card.appendChild(wrap); body.appendChild(card);
    });
    if (editing) body.appendChild(requestForm(r, allowed));
  }

  function requestForm(r, was) {
    var card = h('section', 'ad-card');
    card.appendChild(h('h2', 'ad-card-title', 'Ask to change ' + r.label));
    function picked() { return Object.keys(state.boxes).filter(function (k) { return state.boxes[k].checked; }); }
    function diff() {
      var now = picked(), add = now.filter(function (k) { return !was[k]; }), del = Object.keys(was).filter(function (k) { return now.indexOf(k) < 0; });
      return { add: add, del: del };
    }
    var f = AC.form({
      buttons: [{ label: 'Ask to change permissions', primary: true, fn: 'admin_role_request_change', done: 'Request sent. A different Super Admin must approve it on Pending approvals.',
        check: function () { var d = diff(); return (d.add.length || d.del.length) ? null : 'Nothing is different from what this role has now.'; },
        sure: function () { var d = diff(); return 'You are asking to change ' + r.label + ': ' + [d.add.length ? 'ADD ' + d.add.join(', ') : '', d.del.length ? 'REMOVE ' + d.del.join(', ') : ''].filter(Boolean).join('; ') + '. Every admin with only this role is affected once it is applied. Press the button again to send the request.'; },
        args: function (t) { return { p_role: r.key, p_permissions: picked(), p_reason: t }; } }],
      onDone: function (msg) { state.edit = false; ctx.toast(msg); chg.load(); render(); }
    });
    var cancel = h('button', 'btn btn-ghost', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', function () { state.edit = false; render(); });
    card.appendChild(f); card.appendChild(add(h('div', 'ad-actions ad-actions--tight'), cancel));
    return card;
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
    if (canManage) chg.load();
  }
  if (canManage) root.insertBefore(chg.node, document.getElementById('rlBody'));
  load();
});

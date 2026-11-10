/* ============================================================
   StreetTasker Admin: admin/js/admin-shell.js (stage A3a; Help menu item on in A3c; Dashboard on in A4; Activity log on in A6; Disputes on in A13; Coordinators on in A9; Pending approvals on in A5a; Admin team and Roles on in A5c)
   The one shared script of every admin page. It:
     1. checks the sign-in and asks the database who the admin is (rpc admin_my_access);
     2. shows "No access", "Two-step needed", or an error with Retry, instead of the page, when it should;
     3. draws the permission-aware menu, top bar, toasts, and the shared list states.
   Hiding a menu item is a convenience, NOT security: every admin_* database function checks the
   permission again on the server (ADMIN-HANDOFF.md hard boundary 8).
   Rules: data is written with textContent only, never innerHTML. No localStorage, no st_* keys:
   this file never touches the customer navbar cache.
   Usage on a page:  AdminShell.init({ page: 'index', title: 'Overview', permission: null }).then(function (ctx) { ... })
   ctx = { access, has(perm), content (the element to fill), state helpers }.
   ============================================================ */
'use strict';

(function () {
  var NS = 'http://www.w3.org/2000/svg';

  /* Menu. `built: false` items are not drawn until their stage ships (a link to a page that does not exist is a 404).
     `any`: the admin needs at least one of these permissions; null = any active admin. Flip `built` in the stage that
     adds the page. Names and order follow 02-SCREEN-SPECS.md section 3. */
  var NAV = [
    { group: 'Overview', items: [
      { key: 'index',     label: 'Overview',          href: 'index.html',     icon: 'home',   any: null, built: true },
      { key: 'dashboard', label: 'Dashboard',         href: 'dashboard.html', icon: 'chart',  any: null, built: true },
      { key: 'approvals', label: 'Pending approvals', href: 'approvals.html', icon: 'check',  any: ['approvals.view', 'approvals.request', 'approvals.decide'], built: true }
    ] },
    { group: 'People', items: [
      { key: 'local-taskers', label: 'Local Taskers', href: 'local-taskers.html', icon: 'users', any: ['local_taskers.view'], built: true },
      { key: 'coordinators', label: 'Coordinators',   href: 'coordinators.html', icon: 'users', any: ['coordinators.view', 'coordinators.applications.review'], built: true }
    ] },
    { group: 'Marketplace', items: [
      { key: 'bookings',  label: 'Bookings and Tasks', href: 'bookings.html', icon: 'list', any: ['bookings.view'], built: true },
      { key: 'disputes',  label: 'Disputes',          href: 'disputes.html',  icon: 'flag',   any: ['disputes.manage'], built: true }
    ] },
    { group: 'System', items: [
      { key: 'team',      label: 'Admin team',        href: 'team.html',      icon: 'users',  any: ['admin.team.view'], built: true },
      { key: 'roles',     label: 'Roles and permissions', href: 'roles.html', icon: 'check',  any: ['admin.team.view', 'admin.roles.manage'], built: true },
      { key: 'audit',     label: 'Activity log',      href: 'audit.html',     icon: 'list',   any: ['audit_logs.view'], built: true }
    ] },
    { group: 'General', items: [
      { key: 'help',      label: 'Help',              href: 'help.html',      icon: 'help',   any: null, built: true },
      { key: 'profile',   label: 'My profile',        href: 'profile.html',   icon: 'user',   any: null, built: true }
    ] }
  ];

  var ICONS = {
    home:  'M3 11l9-8 9 8M5 10v10h14V10',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    check: 'M9 12l2 2 4-4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    help:  'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01',
    user:  'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    flag:  'M4 22V4M4 4h13l-2 4 2 4H4',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    list:  'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    menu:  'M3 6h18M3 12h18M3 18h18',
    out:   'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'
  };

  var ctx = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ad-icon');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICONS[name] || ICONS.home);
    s.appendChild(p);
    return s;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ── Shared states (loading, empty, error with Retry, no permission) ── */
  function skeleton(rows) {
    var w = el('div', 'ad-skel');
    w.setAttribute('role', 'status');
    w.setAttribute('aria-label', 'Loading');
    var cls = ['ad-skel-bar--wide', 'ad-skel-bar--mid', 'ad-skel-bar--short'];
    for (var i = 0; i < (rows || 3); i++) w.appendChild(el('div', 'ad-skel-bar ' + cls[i % cls.length]));
    return w;
  }
  function stateBox(title, text, opts) {
    opts = opts || {};
    var b = el('div', 'ad-state' + (opts.error ? ' ad-state--error' : ''));
    b.appendChild(el('div', 'ad-state-title', title));
    if (text) b.appendChild(el('p', 'ad-state-text', text));
    if (opts.code) { var c = el('span', 'ad-state-code', opts.code); b.appendChild(c); }
    (opts.actions || []).forEach(function (a) {
      var btn = el(a.href ? 'a' : 'button', 'btn btn-primary', a.label);
      if (a.href) btn.href = a.href; else { btn.type = 'button'; btn.addEventListener('click', a.onClick); }
      b.appendChild(btn);
    });
    return b;
  }
  function showEmpty(node, text) { clear(node); node.appendChild(stateBox('Nothing here yet', text || '')); }
  function showNoResults(node) { clear(node); node.appendChild(stateBox('No results', 'Nothing matches your search or filters.')); }
  function showError(node, text, onRetry) {
    clear(node);
    node.appendChild(stateBox('Something went wrong', text || 'The server could not answer. Nothing was changed.', { error: true, actions: onRetry ? [{ label: 'Retry', onClick: onRetry }] : [] }));
  }
  function showNoPermission(node, permission) {
    clear(node);
    node.appendChild(stateBox('You do not have access to this page', 'Your role does not include the permission this page needs. Ask a Super Admin if you need it.', { code: permission ? 'Missing: ' + permission : '' }));
  }

  /* ── Toasts ── */
  function toast(message, kind) {
    var host = $('adToasts');
    if (!host) return;
    var t = el('div', 'ad-toast' + (kind === 'error' ? ' ad-toast--error' : ''), message);
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, kind === 'error' ? 7000 : 3500);
  }

  /* ── Guard ── */
  function pageName() { return (window.location.pathname.split('/').pop() || 'index.html'); }
  function loginUrl(withRedirect) {
    var u = 'login.html';
    var p = pageName();
    if (withRedirect && /^[a-z0-9-]+\.html$/.test(p) && p !== 'login.html') u += '?redirect=' + encodeURIComponent(p);
    return u;
  }
  function hasPerm(access, perm) { return !!access && (access.permissions || []).indexOf(perm) !== -1; }
  function hasAny(access, list) {
    if (!list) return true;
    return list.some(function (p) { return hasPerm(access, p); });
  }

  async function signOut() {
    try { await window.supabase.auth.signOut(); } catch (e) { /* the redirect below still happens */ }
    window.location.replace('login.html?signedout=1');
  }

  function gate(box) {
    var g = $('adGate');
    clear(g);
    var wrap = el('div', 'ad-gate-box');
    wrap.appendChild(box);
    g.appendChild(wrap);
    g.hidden = false;
    $('adApp').hidden = true;
  }
  function gateLoading() {
    var box = el('div', 'ad-card');
    box.appendChild(el('div', 'ad-card-title', 'Checking your access'));
    box.appendChild(skeleton(3));
    gate(box);
  }
  function gateCard(title, text, actions, error) {
    var box = el('div', 'ad-card');
    box.appendChild(stateBox(title, text, { actions: actions, error: !!error }));
    gate(box);
  }

  /* ── Draw the shell ── */
  function buildNav(access, current) {
    var nav = $('adNav');
    clear(nav);
    NAV.forEach(function (g) {
      var items = g.items.filter(function (i) { return i.built && hasAny(access, i.any); });
      if (!items.length) return;                       /* a group with nothing permitted is not drawn */
      var sec = el('div', 'ad-nav-group');
      sec.appendChild(el('div', 'ad-nav-label', g.group));
      items.forEach(function (i) {
        var a = el('a', 'ad-nav-link');
        a.href = i.href;
        a.title = i.label;
        a.appendChild(icon(i.icon));
        a.appendChild(el('span', 'ad-nav-text', i.label));
        if (i.key === current) a.setAttribute('aria-current', 'page');
        sec.appendChild(a);
      });
      nav.appendChild(sec);
    });
    var out = el('div', 'ad-nav-group');
    var btn = el('button', 'ad-nav-link');
    btn.type = 'button';
    btn.title = 'Sign out';
    btn.appendChild(icon('out'));
    btn.appendChild(el('span', 'ad-nav-text', 'Sign out'));
    btn.addEventListener('click', signOut);
    out.appendChild(btn);
    nav.appendChild(out);
  }

  function roleLabel(key) {
    return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function drawShell(access, opts) {
    $('adGate').hidden = true;
    $('adApp').hidden = false;
    buildNav(access, opts.page);
    $('adTitle').textContent = opts.title || 'Admin';
    document.title = (opts.title || 'Admin') + ' · StreetTasker Admin';
    $('adUserName').textContent = access.display_name || 'Admin';
    $('adUserRoles').textContent = (access.roles || []).map(roleLabel).join(', ') || 'No role';
    wireDrawer();
  }

  function wireDrawer() {
    var sb = $('adSidebar'), scrim = $('adScrim'), btn = $('adMenuBtn');
    if (!sb || !btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    function close() { sb.classList.remove('is-open'); scrim.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function open()  { sb.classList.add('is-open'); scrim.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    btn.addEventListener('click', function () { sb.classList.contains('is-open') ? close() : open(); });
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* init(): resolves with the page context, or never resolves when the page must not show
     (redirect to sign-in, no access, error). A page script only runs its own code in .then(). */
  function init(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      async function run() {
        gateLoading();
        var sb = window.supabase;
        if (!sb || !sb.auth) { gateCard('Cannot start', 'The sign-in service did not load. Check your connection and try again.', [{ label: 'Retry', onClick: run }], true); return; }
        var session;
        try {
          var s = await sb.auth.getSession();
          session = s && s.data && s.data.session;
        } catch (e) { gateCard('Cannot check your sign-in', 'The server could not be reached. Nothing was changed.', [{ label: 'Retry', onClick: run }], true); return; }
        if (!session) { window.location.replace(loginUrl(true)); return; }

        var res;
        try { res = await sb.rpc('admin_my_access'); }
        catch (e) { res = { error: e }; }
        if (res.error) { gateCard('Cannot check your access', 'The server could not answer. Nothing was changed.', [{ label: 'Retry', onClick: run }], true); return; }
        var access = res.data || {};

        if (!access.active) {
          gateCard('No access', 'This account is not an admin account. If you should have access, ask a Super Admin.', [{ label: 'Sign out', onClick: signOut }]);
          return;
        }
        if (access.mfa_required && !access.mfa_ok) {
          gateCard('Enter your two-step code', 'Admin pages open after you enter the 6-digit code from your authenticator app.', [{ label: 'Enter code', href: loginUrl(true) }, { label: 'Sign out', onClick: signOut }]);
          return;
        }

        drawShell(access, opts);
        var content = $('adMain');
        ctx = {
          access: access,
          has: function (p) { return hasPerm(access, p); },
          content: content,
          toast: toast, skeleton: skeleton, showEmpty: showEmpty, showNoResults: showNoResults,
          showError: showError, showNoPermission: showNoPermission, signOut: signOut
        };
        if (opts.permission && !hasPerm(access, opts.permission)) { showNoPermission(content, opts.permission); return; }
        resolve(ctx);
      }
      run();
    });
  }

  window.AdminShell = { init: init, toast: toast, signOut: signOut, nav: NAV };
})();

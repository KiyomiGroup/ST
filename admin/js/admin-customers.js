/* StreetTasker Admin: Customers (stage A7, spec S04).
   Reads: admin_customer_list, admin_customer_get (customers.view). Contact details are MASKED; a logged "Reveal" (pii.reveal, reason required)
   asks admin_customer_reveal for one value at a time and shows it on screen only. Suspend and restore (customers.suspend, reason required) go
   through the Edge Function admin-account-action, which blocks or unblocks the login and records it; bookings, disputes, reviews and refunds
   are never touched. The street address, date of birth, bio and dispute text are never returned by the server.
   The server checks every permission and rule again. All text is inserted with textContent. */
'use strict';
AdminShell.init({ page: 'customers', title: 'Customers', permission: 'customers.view' }).then(function (ctx) {
  var sb = window.supabase;
  var $ = function (id) { return document.getElementById(id); };
  var FILTERS = [['all', 'All customers'], ['active', 'Active'], ['suspended', 'Suspended'], ['flagged', 'Flagged by the site'], ['open_dispute', 'Has an open dispute']];
  var state = { filter: 'all', search: '', offset: 0, data: null, sel: null, loadId: 0, prof: null };
  var canSuspend = ctx.has('customers.suspend'), canReveal = ctx.has('pii.reveal');
  $('adBk').hidden = false;

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(t) { if (!t) return '-'; var d = new Date(t); return isNaN(d) ? '-' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function day(t) { if (!t) return '-'; var d = new Date(t); return isNaN(d) ? '-' : d.toLocaleDateString('en-NG', { dateStyle: 'medium' }); }
  function naira(v) { var n = Number(v); return v == null || isNaN(n) ? '-' : '₦' + n.toLocaleString('en-NG'); }
  function words(s) { return s ? String(s).replace(/_/g, ' ') : ''; }
  function dl(pairs) { var d = h('dl', 'ad-dl'); pairs.forEach(function (p) { add(d, h('dt', null, p[0]), h('dd', null, p[1] == null || p[1] === '' ? '-' : String(p[1]))); }); return d; }
  function badge(text, cls) { return h('span', 'badge ' + cls, text); }
  function statusBadge(st) { return st === 'suspended' ? badge('Suspended', 'badge-amber') : badge('Active', 'badge-green'); }

  async function call(name, args) {
    try {
      var r = await sb.rpc(name, args || {});
      if (r.error) {
        if (r.error.code === '42501') return { ok: false, error: 'You do not have permission to do this.' };
        if (r.error.code === '42883' || r.error.code === 'PGRST202') return { ok: false, error: 'A server function is missing. Run sql/admin/a7-customers.sql in the Supabase SQL editor.' };
        return { ok: false, error: r.error.message || 'Request failed.' };
      }
      var d = r.data; if (d && typeof d === 'object' && 'ok' in d) return d;
      return { ok: false, error: 'Unexpected reply from the server.' };
    } catch (e) { return { ok: false, error: 'Could not reach the server.' }; }
  }
  /* The Edge Function: only ids, the action and the reason go in. */
  async function runAction(userId, action, reason) {
    var res;
    try { res = await sb.functions.invoke('admin-account-action', { body: { user_id: userId, action: action, reason: reason } }); } catch (e) { res = { error: e }; }
    if (res && !res.error && res.data && res.data.ok) return { data: { ok: true } };
    var msg = 'The server could not answer. Nothing was changed.';
    try {
      var c = res && res.error && res.error.context;
      if (c && typeof c.json === 'function') { var j = await c.json(); if (j && j.message) msg = j.message; }
    } catch (e) { /* keep the general message */ }
    return { data: { ok: false, error: msg } };
  }

  /* ---------- filters ---------- */
  function drawFilter() { var sel = $('cuFilter'); clear(sel); FILTERS.forEach(function (f) { var o = h('option', null, f[1]); o.value = f[0]; sel.appendChild(o); }); sel.value = state.filter; }
  $('cuFilters').addEventListener('submit', function (e) { e.preventDefault(); state.search = $('cuSearch').value.trim(); state.filter = $('cuFilter').value; state.offset = 0; state.sel = null; load(); });
  $('cuReset').addEventListener('click', function () { $('cuSearch').value = ''; $('cuFilter').value = 'all'; state.search = ''; state.filter = 'all'; state.offset = 0; state.sel = null; load(); });

  /* ---------- list ---------- */
  async function load() {
    var mine = ++state.loadId; var body = $('cuBody'); clear(body); body.appendChild(ctx.skeleton(4));
    var r = await call('admin_customer_list', { p_search: state.search || null, p_filter: state.filter, p_offset: state.offset });
    if (mine !== state.loadId) return;
    if (!r.ok) { clear(body); ctx.showError(body, r.error, load); return; }
    state.data = r; render();
  }
  function items() { return (state.data && state.data.items) || []; }

  function render() {
    var body = $('cuBody'); clear(body); var d = state.data; var c = d.counts || {};
    var split = h('div', 'ad-split' + (state.sel ? ' is-detail' : ''));
    var listCol = h('section', 'ad-split-list'); listCol.setAttribute('aria-label', 'Customers');
    var detCol = h('section', 'ad-split-detail'); detCol.setAttribute('aria-label', 'Customer profile');
    var back = h('button', 'btn ad-back', 'Back to the list'); back.type = 'button';
    back.addEventListener('click', function () { state.sel = null; render(); });
    var detail = h('div'); add(detCol, back, detail);
    var card = h('div', 'ad-card');
    add(card, h('p', 'ad-hint', [c.all + ' in all', c.active + ' active', c.suspended + ' suspended', c.flagged + ' flagged by the site', c.open_dispute + ' with an open dispute'].join(' · ')),
        h('p', 'ad-hint', d.total + (d.total === 1 ? ' match' : ' matches')));
    if (!items().length) {
      ctx.showEmpty(card, (state.search || state.filter !== 'all') ? 'Nothing matches these filters.' : 'No customers yet.');
    } else {
      var ul = h('ul', 'ad-rows');
      items().forEach(function (x) {
        var b = h('button', 'ad-row'); b.type = 'button';
        if (state.sel === x.id) b.setAttribute('aria-current', 'true');
        var top = add(h('span', 'ad-row-top'), h('span', 'ad-row-title', x.name || 'Unnamed customer'), statusBadge(x.status));
        if (x.flagged) top.appendChild(badge('Flagged', 'badge-amber'));
        if (x.open_dispute) top.appendChild(badge('Open dispute', 'badge-amber'));
        add(b, top, h('span', 'ad-hint', 'Joined ' + day(x.joined) + ' · ' + x.bookings + (x.bookings === 1 ? ' booking' : ' bookings')));
        b.addEventListener('click', function () { state.sel = x.id; render(); });
        add(ul, add(h('li'), b));
      });
      card.appendChild(ul);
      if (state.offset > 0 || state.offset + items().length < d.total) {
        var p = h('div', 'ad-actions ad-pager');
        var prev = h('button', 'btn', 'Previous'); prev.type = 'button'; prev.disabled = state.offset <= 0;
        var next = h('button', 'btn', 'Next'); next.type = 'button'; next.disabled = state.offset + items().length >= d.total;
        prev.addEventListener('click', function () { state.offset = Math.max(0, state.offset - d.limit); state.sel = null; load(); });
        next.addEventListener('click', function () { state.offset += d.limit; state.sel = null; load(); });
        add(p, prev, h('span', 'ad-hint', 'Showing ' + (state.offset + 1) + ' to ' + (state.offset + items().length) + ' of ' + d.total), next);
        card.appendChild(p);
      }
    }
    listCol.appendChild(card); add(split, listCol, detCol); body.appendChild(split);
    if (state.sel) openProfile(detail, state.sel); else detail.appendChild(h('p', 'ad-note', 'Choose a customer to see the profile.'));
  }

  /* ---------- profile ---------- */
  async function openProfile(box, id) {
    box.appendChild(ctx.skeleton(3));
    var r = await call('admin_customer_get', { p_id: id });
    if (state.sel !== id) return;
    clear(box);
    if (!r.ok) { ctx.showError(box, r.error, function () { render(); }); return; }
    var a = r.account, ct = r.contact;
    var head = h('section', 'ad-card');
    add(head, add(h('div', 'ad-row-top'), h('h2', 'ad-card-title', a.name || 'Unnamed customer'), statusBadge(r.status)));
    var badges = h('p', 'ad-hint');
    if (a.is_admin) badges.appendChild(badge('Also an admin login', 'badge-blue'));
    if (a.is_tasker) badges.appendChild(badge('Also a Tasker', 'badge-blue'));
    if (a.is_coordinator) badges.appendChild(badge('Also a coordinator', 'badge-blue'));
    if (a.verified) badges.appendChild(badge('Verified', 'badge-green'));
    if (a.flagged) badges.appendChild(badge('Flagged by the site', 'badge-amber'));
    if (badges.childNodes.length) head.appendChild(badges);
    head.appendChild(dl([['Joined', day(a.joined)], ['Location', a.location], ['Roles', (a.roles || []).join(', ')], ['Customer id', a.id],
      ['Site trust flag', a.flagged ? (a.flagged_reason || 'Flagged (no reason stored)') : 'None'], ['Contact-rule violations', a.contact_violations]]));
    box.appendChild(head);

    /* contact, masked, with logged reveal */
    var cc = h('section', 'ad-card'); cc.appendChild(h('h3', 'ad-card-title', 'Contact (masked)'));
    function contactRow(label, masked, has, field) {
      var row = h('div', 'ad-contact'); var val = h('strong', null, has ? masked : 'Not on file'); add(row, h('span', 'ad-hint', label + ': '), val);
      if (has && canReveal) {
        var rb = h('button', 'btn btn-sm btn-outline', 'Reveal'); rb.type = 'button'; row.appendChild(rb);
        var slot = h('div'); 
        rb.addEventListener('click', function () {
          clear(slot);
          slot.appendChild(AdminChange.form({
            reasonLabel: 'Why do you need this? (at least 10 characters; it goes in the activity log)',
            buttons: [{ label: 'Reveal ' + label.toLowerCase(), primary: true, run: function (t) { return sb.rpc('admin_customer_reveal', { p_id: a.id, p_field: field, p_reason: t }).then(function (res) {
                if (res && res.data && res.data.ok) { val.textContent = res.data.value; rb.hidden = true; clear(slot); ctx.toast(label + ' shown. This was logged.'); return { data: { ok: true, __shown: true } }; }
                return res; }); },
              sure: function () { return 'The ' + label.toLowerCase() + ' will be shown on this screen and the reveal is logged with your reason. Press again to continue.'; }, done: null }],
            onDone: function () { /* value already shown */ }
          }));
        });
        row.appendChild(slot);
      }
      return row;
    }
    add(cc, contactRow('Email', ct.email, ct.has_email, 'email'), contactRow('WhatsApp', ct.whatsapp, ct.has_whatsapp, 'whatsapp'));
    if (!canReveal) cc.appendChild(h('p', 'ad-hint', 'Your role cannot reveal contact details.'));
    box.appendChild(cc);

    /* status, restrictions, suspend / restore */
    var sc = h('section', 'ad-card'); sc.appendChild(h('h3', 'ad-card-title', 'Account status and restrictions'));
    if (r.suspension) sc.appendChild(h('p', 'ad-note', 'Suspended since ' + when(r.suspension.since) + '. Reason: ' + r.suspension.reason));
    else sc.appendChild(h('p', 'ad-note', 'No active restriction.'));
    if ((r.restrictions || []).length) {
      var ul = h('ul', 'ad-rows');
      r.restrictions.forEach(function (x) {
        var li = h('li'); var p = h('div', 'ad-panel');
        add(p, h('strong', null, 'Suspended ' + when(x.since) + (x.by ? ' by ' + x.by : '')), h('p', 'ad-hint', x.reason),
          x.lifted_at ? h('p', 'ad-hint', 'Restored ' + when(x.lifted_at) + (x.lifted_by ? ' by ' + x.lifted_by : '') + ': ' + (x.lift_reason || '')) : h('p', 'ad-hint', 'Still in force'));
        add(ul, add(li, p));
      });
      sc.appendChild(ul);
    }
    if (canSuspend && !a.is_admin && !a.is_tasker && !a.is_coordinator) {
      var suspended = r.status === 'suspended';
      sc.appendChild(AdminChange.form({
        reasonLabel: (suspended ? 'Why restore this customer?' : 'Why suspend this customer?') + ' (at least 10 characters; it goes in the activity log)',
        buttons: [{ label: suspended ? 'Restore customer' : 'Suspend customer', primary: !suspended,
          sure: function () { return suspended ? 'This unblocks the sign-in of ' + (a.name || 'this customer') + '. Press again to confirm.'
            : 'This blocks the sign-in of ' + (a.name || 'this customer') + ' now. Their bookings, disputes and refunds stay. A session already open can work for up to an hour. Press again to confirm.'; },
          run: function (t) { return runAction(a.id, suspended ? 'restore' : 'suspend', t); }, done: suspended ? 'Customer restored.' : 'Customer suspended.' }],
        onDone: function (msg) { ctx.toast(msg); state.data = null; load(); }
      }));
    } else if (canSuspend) {
      sc.appendChild(h('p', 'ad-hint', 'This login is also an admin, Tasker or coordinator, so it is managed on that screen, not here.'));
    }
    box.appendChild(sc);

    /* bookings */
    var bc = h('section', 'ad-card'); bc.appendChild(h('h3', 'ad-card-title', 'Bookings (' + r.bookings_total + ')'));
    if (!(r.bookings || []).length) bc.appendChild(h('p', 'ad-note', 'No bookings.'));
    else {
      var wrap = h('div', 'ad-table-wrap'); var t = h('table', 'ad-table'); var tr0 = h('tr');
      ['When', 'Job', 'Worker', 'Status', 'Payment', 'Amount'].forEach(function (x) { var th = h('th', null, x); th.scope = 'col'; tr0.appendChild(th); });
      add(t, add(h('thead'), tr0)); var tb = h('tbody');
      r.bookings.forEach(function (x) { add(tb, add(h('tr'), h('td', null, day(x.created_at)), h('td', null, x.title || 'Booking'), h('td', null, x.worker || '-'), h('td', null, words(x.status) || '-'), h('td', null, words(x.payment_status) || '-'), h('td', null, naira(x.amount)))); });
      add(t, tb); add(wrap, t); bc.appendChild(wrap);
      if (r.bookings_total > r.bookings.length) bc.appendChild(h('p', 'ad-hint', 'The latest ' + r.bookings.length + ' are shown.'));
    }
    box.appendChild(bc);

    /* payments summary */
    var pc = h('section', 'ad-card'); pc.appendChild(h('h3', 'ad-card-title', 'Payments summary'));
    var keys = Object.keys(r.payments || {});
    if (!keys.length) pc.appendChild(h('p', 'ad-note', 'No payments.'));
    else pc.appendChild(dl(keys.map(function (k) { return [words(k), r.payments[k].count + (r.payments[k].count === 1 ? ' booking, ' : ' bookings, ') + naira(r.payments[k].amount)]; })));
    pc.appendChild(h('p', 'ad-hint', 'Booking amounts grouped by payment status. Read only: money is never moved from the admin area.'));
    box.appendChild(pc);

    /* reviews, disputes, gift cards, reports */
    var rc = h('section', 'ad-card'); rc.appendChild(h('h3', 'ad-card-title', 'Reviews, disputes and gift cards'));
    var rv = r.reviews || {};
    rc.appendChild(dl([['Reviews written', rv.given_count + (rv.given_avg != null ? ' (average ' + rv.given_avg + ')' : '')],
      ['Reviews received', rv.received_count + (rv.received_avg != null ? ' (average ' + rv.received_avg + ')' : '')],
      ['Gift cards redeemed', (r.gift_cards.redeemed_count || 0) + ' (' + naira(r.gift_cards.redeemed_amount) + ')']]));
    rc.appendChild(h('h4', 'ad-card-title', 'Disputes they opened'));
    if (!(r.disputes || []).length) rc.appendChild(h('p', 'ad-note', 'None.'));
    else { var du = h('ul', 'ad-rows'); r.disputes.forEach(function (x) {
      add(du, add(h('li'), add(h('div', 'ad-panel'), h('strong', null, words(x.category) || 'Dispute'), h('p', 'ad-hint', 'Opened ' + when(x.opened_at) + ' · ' + (x.resolved_at ? 'Resolved ' + when(x.resolved_at) + (x.outcome ? ' (' + words(x.outcome) + ')' : '') : 'Open (' + words(x.status) + ')'))))); }); rc.appendChild(du); }
    rc.appendChild(h('p', 'ad-hint', r.reports_note));
    box.appendChild(rc);
  }

  drawFilter(); load();
});

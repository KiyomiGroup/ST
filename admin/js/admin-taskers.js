/* StreetTasker Admin: Regular Taskers (stage A8, spec S05).
   Reads: admin_tasker_list, admin_tasker_get (taskers.view). The Money tab (wallet, wallet movements, withdrawals) is returned by the server only with
   payouts.view and is READ ONLY: this page has no control that changes a rating, wallet, commission, verification or membership. Contact details are
   MASKED; a logged "Reveal" (pii.reveal, reason required) shows one value on screen only. Suspend and restore (taskers.suspend, reason required) go through
   the Edge Function admin-account-action with target "tasker": it blocks or unblocks the login and records it; services, bookings, wallets, disputes,
   reviews and refunds are never touched. All text is inserted with textContent. The server checks every permission and rule again. */
'use strict';
AdminShell.init({ page: 'taskers', title: 'Regular Taskers', permission: 'taskers.view' }).then(function (ctx) {
  var sb = window.supabase;
  var $ = function (id) { return document.getElementById(id); };
  var FILTERS = [['all', 'All Taskers'], ['active', 'Active'], ['suspended', 'Suspended'], ['verified', 'Identity verified'], ['unverified', 'Not verified'],
                 ['available', 'Available for work'], ['flagged', 'Flagged by the site'], ['open_dispute', 'Has an open dispute']];
  var TABS = [['overview', 'Overview'], ['services', 'Services'], ['offers', 'Offers'], ['bookings', 'Bookings'], ['reviews', 'Reviews'], ['money', 'Earnings and wallet'], ['verification', 'Verification and plan']];
  var state = { filter: 'all', search: '', offset: 0, data: null, sel: null, loadId: 0, tab: 'overview' };
  var canSuspend = ctx.has('taskers.suspend'), canReveal = ctx.has('pii.reveal');
  $('adBk').hidden = false;

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(t) { if (!t) return '-'; var d = new Date(t); return isNaN(d) ? '-' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function day(t) { if (!t) return '-'; var d = new Date(t); return isNaN(d) ? '-' : d.toLocaleDateString('en-NG', { dateStyle: 'medium' }); }
  function naira(v) { var n = Number(v); return v == null || isNaN(n) ? '-' : '₦' + n.toLocaleString('en-NG'); }
  function words(s) { return s ? String(s).replace(/_/g, ' ') : ''; }
  function yn(v) { return v === true ? 'Yes' : (v === false ? 'No' : '-'); }
  function dl(pairs) { var d = h('dl', 'ad-dl'); pairs.forEach(function (p) { add(d, h('dt', null, p[0]), h('dd', null, p[1] == null || p[1] === '' ? '-' : String(p[1]))); }); return d; }
  function badge(text, cls) { return h('span', 'badge ' + cls, text); }
  function statusBadge(st) { return st === 'suspended' ? badge('Suspended', 'badge-amber') : badge('Active', 'badge-green'); }
  function table(heads, rows) {
    var wrap = h('div', 'ad-table-wrap'); var t = h('table', 'ad-table'); var tr0 = h('tr');
    heads.forEach(function (x) { var th = h('th', null, x); th.scope = 'col'; tr0.appendChild(th); });
    add(t, add(h('thead'), tr0)); var tb = h('tbody');
    rows.forEach(function (r) { var tr = h('tr'); r.forEach(function (c) { tr.appendChild(h('td', null, c == null || c === '' ? '-' : String(c))); }); tb.appendChild(tr); });
    add(t, tb); return add(wrap, t);
  }

  async function call(name, args) {
    try {
      var r = await sb.rpc(name, args || {});
      if (r.error) {
        if (r.error.code === '42501') return { ok: false, error: 'You do not have permission to do this.' };
        if (r.error.code === '42883' || r.error.code === 'PGRST202') return { ok: false, error: 'A server function is missing. Run sql/admin/a8-taskers.sql in the Supabase SQL editor.' };
        return { ok: false, error: r.error.message || 'Request failed.' };
      }
      var d = r.data; if (d && typeof d === 'object' && 'ok' in d) return d;
      return { ok: false, error: 'Unexpected reply from the server.' };
    } catch (e) { return { ok: false, error: 'Could not reach the server.' }; }
  }
  /* The Edge Function: only the id, the target, the action and the reason go in. */
  async function runAction(userId, action, reason) {
    var res;
    try { res = await sb.functions.invoke('admin-account-action', { body: { target: 'tasker', user_id: userId, action: action, reason: reason } }); } catch (e) { res = { error: e }; }
    if (res && !res.error && res.data && res.data.ok) return { data: { ok: true } };
    var msg = 'The server could not answer. Nothing was changed.';
    try {
      var c = res && res.error && res.error.context;
      if (c && typeof c.json === 'function') { var j = await c.json(); if (j && j.message) msg = j.message; }
    } catch (e) { /* keep the general message */ }
    return { data: { ok: false, error: msg } };
  }

  /* ---------- filters ---------- */
  function drawFilter() { var sel = $('tkFilter'); clear(sel); FILTERS.forEach(function (f) { var o = h('option', null, f[1]); o.value = f[0]; sel.appendChild(o); }); sel.value = state.filter; }
  $('tkFilters').addEventListener('submit', function (e) { e.preventDefault(); state.search = $('tkSearch').value.trim(); state.filter = $('tkFilter').value; state.offset = 0; state.sel = null; load(); });
  $('tkReset').addEventListener('click', function () { $('tkSearch').value = ''; $('tkFilter').value = 'all'; state.search = ''; state.filter = 'all'; state.offset = 0; state.sel = null; load(); });

  /* ---------- list ---------- */
  async function load() {
    var mine = ++state.loadId; var body = $('tkBody'); clear(body); body.appendChild(ctx.skeleton(4));
    var r = await call('admin_tasker_list', { p_search: state.search || null, p_filter: state.filter, p_offset: state.offset });
    if (mine !== state.loadId) return;
    if (!r.ok) { clear(body); ctx.showError(body, r.error, load); return; }
    state.data = r; render();
  }
  function items() { return (state.data && state.data.items) || []; }

  function render() {
    var body = $('tkBody'); clear(body); var d = state.data; var c = d.counts || {};
    var split = h('div', 'ad-split' + (state.sel ? ' is-detail' : ''));
    var listCol = h('section', 'ad-split-list'); listCol.setAttribute('aria-label', 'Taskers');
    var detCol = h('section', 'ad-split-detail'); detCol.setAttribute('aria-label', 'Tasker profile');
    var back = h('button', 'btn ad-back', 'Back to the list'); back.type = 'button';
    back.addEventListener('click', function () { state.sel = null; render(); });
    var detail = h('div'); add(detCol, back, detail);
    var card = h('div', 'ad-card');
    add(card, h('p', 'ad-hint', [c.all + ' in all', c.active + ' active', c.suspended + ' suspended', c.verified + ' identity verified', c.available + ' available', c.flagged + ' flagged by the site', c.open_dispute + ' with an open dispute'].join(' · ')),
        h('p', 'ad-hint', d.total + (d.total === 1 ? ' match' : ' matches')));
    if (!items().length) {
      ctx.showEmpty(card, (state.search || state.filter !== 'all') ? 'Nothing matches these filters.' : 'No Taskers yet.');
    } else {
      var ul = h('ul', 'ad-rows');
      items().forEach(function (x) {
        var b = h('button', 'ad-row'); b.type = 'button';
        if (state.sel === x.id) b.setAttribute('aria-current', 'true');
        var top = add(h('span', 'ad-row-top'), h('span', 'ad-row-title', x.name || 'Unnamed Tasker'), statusBadge(x.status));
        if (x.verified) top.appendChild(badge('Identity verified', 'badge-green'));
        if (x.flagged) top.appendChild(badge('Flagged', 'badge-amber'));
        if (x.open_dispute) top.appendChild(badge('Open dispute', 'badge-amber'));
        add(b, top, h('span', 'ad-hint', (x.category ? words(x.category) + ' · ' : '') + 'Joined ' + day(x.joined) + ' · ' + x.services + (x.services === 1 ? ' service' : ' services') + ' · ' + x.bookings + (x.bookings === 1 ? ' booking' : ' bookings') + (x.available ? ' · Available' : '')));
        b.addEventListener('click', function () { state.sel = x.id; state.tab = 'overview'; render(); });
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
    if (state.sel) openProfile(detail, state.sel); else detail.appendChild(h('p', 'ad-note', 'Choose a Tasker to see the profile.'));
  }

  /* ---------- profile ---------- */
  async function openProfile(box, id) {
    box.appendChild(ctx.skeleton(3));
    var r = await call('admin_tasker_get', { p_id: id });
    if (state.sel !== id) return;
    clear(box);
    if (!r.ok) { ctx.showError(box, r.error, function () { render(); }); return; }
    var a = r.account;
    var head = h('section', 'ad-card');
    add(head, add(h('div', 'ad-row-top'), h('h2', 'ad-card-title', a.name || 'Unnamed Tasker'), statusBadge(r.status)));
    var badges = h('p', 'ad-hint');
    if (a.verified) badges.appendChild(badge('Identity verified', 'badge-green'));
    if (r.plan && r.plan.label) badges.appendChild(badge('Membership: ' + r.plan.label, 'badge-blue'));
    if (a.is_admin) badges.appendChild(badge('Also an admin login', 'badge-blue'));
    if (a.is_customer) badges.appendChild(badge('Also a customer', 'badge-blue'));
    if (a.is_coordinator) badges.appendChild(badge('Also a coordinator', 'badge-blue'));
    if (a.flagged) badges.appendChild(badge('Flagged by the site', 'badge-amber'));
    if (badges.childNodes.length) head.appendChild(badges);
    box.appendChild(head);

    var tabs = h('div', 'ad-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Profile sections');
    var panel = h('div');
    TABS.forEach(function (t) {
      if (t[0] === 'money' && !r.money_allowed) return;
      var on = state.tab === t[0];
      var b = h('button', 'btn btn-sm ' + (on ? 'btn-outline' : 'btn-ghost'), t[1]); b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () { state.tab = t[0]; render(); });
      tabs.appendChild(b);
    });
    if (state.tab === 'money' && !r.money_allowed) state.tab = 'overview';
    add(box, tabs, panel);
    ({ overview: tabOverview, services: tabServices, offers: tabOffers, bookings: tabBookings, reviews: tabReviews, money: tabMoney, verification: tabVerification })[state.tab](panel, r);
  }

  function tabOverview(box, r) {
    var a = r.account, ct = r.contact;
    var head = h('section', 'ad-card');
    head.appendChild(dl([['Joined', day(a.joined)], ['Location', a.location], ['Business name', a.business_name], ['Main category', words(a.category)], ['Roles', (a.roles || []).join(', ')],
      ['Available for work', yn(a.available) + (a.availability_status ? ' (' + words(a.availability_status) + ')' : '')], ['Tasker id', a.id],
      ['Site trust flag', a.flagged ? (a.flagged_reason || 'Flagged (no reason stored)') : 'None'], ['Contact-rule violations', a.contact_violations],
      ['Open or pending bookings', r.bookings_open]]));
    box.appendChild(head);

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
            buttons: [{ label: 'Reveal ' + label.toLowerCase(), primary: true, run: function (t) { return sb.rpc('admin_tasker_reveal', { p_id: a.id, p_field: field, p_reason: t }).then(function (res) {
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
    add(cc, contactRow('Email', ct.email, ct.has_email, 'email'), contactRow('WhatsApp', ct.whatsapp, ct.has_whatsapp, 'whatsapp'), contactRow('Phone', ct.phone, ct.has_phone, 'phone'));
    if (!canReveal) cc.appendChild(h('p', 'ad-hint', 'Your role cannot reveal contact details.'));
    box.appendChild(cc);

    var sc = h('section', 'ad-card'); sc.appendChild(h('h3', 'ad-card-title', 'Account status and restrictions'));
    if (r.suspension) sc.appendChild(h('p', 'ad-note', 'Suspended since ' + when(r.suspension.since) + '. Reason: ' + r.suspension.reason));
    else sc.appendChild(h('p', 'ad-note', 'No active restriction.'));
    if ((r.restrictions || []).length) {
      var ul = h('ul', 'ad-rows');
      r.restrictions.forEach(function (x) {
        var p = h('div', 'ad-panel');
        add(p, h('strong', null, 'Suspended ' + when(x.since) + (x.by ? ' by ' + x.by : '')), h('p', 'ad-hint', x.reason),
          x.lifted_at ? h('p', 'ad-hint', 'Restored ' + when(x.lifted_at) + (x.lifted_by ? ' by ' + x.lifted_by : '') + ': ' + (x.lift_reason || '')) : h('p', 'ad-hint', 'Still in force'));
        add(ul, add(h('li'), p));
      });
      sc.appendChild(ul);
    }
    if (canSuspend && !a.is_admin && !a.is_coordinator) {
      var suspended = r.status === 'suspended';
      sc.appendChild(AdminChange.form({
        reasonLabel: (suspended ? 'Why restore this Tasker?' : 'Why suspend this Tasker?') + ' (at least 10 characters; it goes in the activity log)',
        buttons: [{ label: suspended ? 'Restore Tasker' : 'Suspend Tasker', primary: !suspended,
          sure: function () { return suspended ? 'This unblocks the sign-in of ' + (a.name || 'this Tasker') + '. Press again to confirm.'
            : 'This blocks the sign-in of ' + (a.name || 'this Tasker') + ' now' + (r.bookings_open > 0 ? ' (they have ' + r.bookings_open + ' open or pending booking' + (r.bookings_open === 1 ? '' : 's') + ', which will not be able to move forward until you restore them)' : '') +
              '. Services, wallet, bookings and disputes stay, and the public profile stays visible until the services stage. A session already open can work for up to an hour. Press again to confirm.'; },
          run: function (t) { return runAction(a.id, suspended ? 'restore' : 'suspend', t); }, done: suspended ? 'Tasker restored.' : 'Tasker suspended.' }],
        onDone: function (msg) { ctx.toast(msg); state.data = null; load(); }
      }));
    } else if (canSuspend) {
      sc.appendChild(h('p', 'ad-hint', 'This login is also an admin or coordinator, so it is managed on that screen, not here.'));
    }
    box.appendChild(sc);

    var dc = h('section', 'ad-card'); dc.appendChild(h('h3', 'ad-card-title', 'Disputes they opened'));
    if (!(r.disputes || []).length) dc.appendChild(h('p', 'ad-note', 'None.'));
    else dc.appendChild(table(['Opened', 'Type', 'Status', 'Outcome'], r.disputes.map(function (x) { return [when(x.opened_at), words(x.category), x.resolved_at ? 'Resolved ' + day(x.resolved_at) : words(x.status), words(x.outcome)]; })));
    dc.appendChild(h('p', 'ad-hint', 'Only disputes this Tasker opened are listed here. Open the Disputes page for the full case.'));
    box.appendChild(dc);
  }

  function tabServices(box, r) {
    var c = h('section', 'ad-card'); c.appendChild(h('h3', 'ad-card-title', 'Services (' + (r.services || []).length + ')'));
    if (!(r.services || []).length) c.appendChild(h('p', 'ad-note', 'No services listed.'));
    else c.appendChild(table(['Service', 'Category', 'Price', 'Listing', 'Available', 'Main', 'Rating'], r.services.map(function (s) {
      return [s.name, words(s.category), naira(s.price) + (s.rate_unit ? ' / ' + words(s.rate_unit) : ''), words(s.listing_status), yn(s.available), yn(s.is_main), s.rating != null ? s.rating + ' (' + (s.reviews_count || 0) + ')' : '-']; })));
    c.appendChild(h('p', 'ad-hint', 'The site does not record who paused a listing. Hiding or unhiding a service with a reason arrives with the services stage; it is not done here.'));
    box.appendChild(c);
    if ((r.takedowns || []).length) {
      var t = h('section', 'ad-card'); t.appendChild(h('h3', 'ad-card-title', 'Identity take-downs'));
      t.appendChild(table(['Item', 'Taken down', 'Restored', 'Reason'], r.takedowns.map(function (x) { return [words(x.entity), when(x.taken_at), x.restored_at ? when(x.restored_at) : 'Not restored', x.reason]; })));
      box.appendChild(t);
    }
  }

  function tabOffers(box, r) {
    var c = h('section', 'ad-card'); c.appendChild(h('h3', 'ad-card-title', 'Offers and applications'));
    var k = Object.keys(r.application_counts || {});
    c.appendChild(k.length ? dl(k.map(function (x) { return [words(x), r.application_counts[x]]; })) : h('p', 'ad-note', 'No offers yet.'));
    if ((r.applications || []).length) {
      c.appendChild(table(['Sent', 'Task', 'Offer', 'Task status'], r.applications.map(function (x) { return [when(x.created_at), x.task_title || 'Task', words(x.status), words(x.task_status)]; })));
      c.appendChild(h('p', 'ad-hint', 'The latest ' + r.applications.length + ' are shown. Offer messages, phone numbers and WhatsApp numbers are never shown here.'));
    }
    box.appendChild(c);
  }

  function tabBookings(box, r) {
    var c = h('section', 'ad-card'); c.appendChild(h('h3', 'ad-card-title', 'Bookings (' + r.bookings_total + ')'));
    if (!(r.bookings || []).length) c.appendChild(h('p', 'ad-note', 'No bookings.'));
    else {
      c.appendChild(table(['When', 'Job', 'Customer', 'Status', 'Payment', 'Amount'], r.bookings.map(function (x) { return [day(x.created_at), x.title || 'Booking', x.customer, words(x.status), words(x.payment_status), naira(x.amount)]; })));
      if (r.bookings_total > r.bookings.length) c.appendChild(h('p', 'ad-hint', 'The latest ' + r.bookings.length + ' are shown.'));
    }
    box.appendChild(c);
  }

  function tabReviews(box, r) {
    var rv = r.reviews || {};
    var c = h('section', 'ad-card'); c.appendChild(h('h3', 'ad-card-title', 'Ratings and reviews'));
    c.appendChild(dl([['Reviews received', (rv.count || 0) + (rv.avg != null ? ' (average ' + rv.avg + ')' : '')]].concat(
      [5, 4, 3, 2, 1].map(function (n) { return [n + ' star', (rv.by_rating && rv.by_rating[String(n)]) || 0]; }))));
    if ((r.review_list || []).length) {
      var ul = h('ul', 'ad-rows');
      r.review_list.forEach(function (x) { add(ul, add(h('li'), add(h('div', 'ad-panel'), h('strong', null, x.rating + ' / 5 · ' + (x.reviewer || 'A customer') + ' · ' + day(x.created_at)), h('p', 'ad-hint', x.comment || '(no comment)')))); });
      c.appendChild(ul);
    }
    c.appendChild(h('p', 'ad-hint', 'Read only. A rating or review is never edited or removed from this screen.'));
    box.appendChild(c);
  }

  function tabMoney(box, r) {
    var m = r.money || {}; var w = m.wallet;
    var c = h('section', 'ad-card'); c.appendChild(h('h3', 'ad-card-title', 'Wallet (read only)'));
    c.appendChild(dl([['Balance', w ? naira(w.balance) : 'No wallet'], ['Pending balance', w ? naira(w.pending_balance) : '-'], ['Updated', w ? when(w.updated_at) : '-'],
      ['Platform fee rate', m.platform_fee_rate != null ? (Number(m.platform_fee_rate) <= 1 ? Math.round(Number(m.platform_fee_rate) * 10000) / 100 : m.platform_fee_rate) + '%' : '-']]));
    c.appendChild(h('p', 'ad-hint', 'Admin never moves money, changes a wallet or changes a payment. This is a view of what the database holds.'));
    box.appendChild(c);

    var t = h('section', 'ad-card'); t.appendChild(h('h3', 'ad-card-title', 'Latest wallet movements'));
    if (!(m.transactions || []).length) t.appendChild(h('p', 'ad-note', 'No movements.'));
    else t.appendChild(table(['When', 'Type', 'Amount', 'Status'], m.transactions.map(function (x) { return [when(x.created_at), words(x.type), naira(x.amount), words(x.status)]; })));
    box.appendChild(t);

    var d = h('section', 'ad-card'); d.appendChild(h('h3', 'ad-card-title', 'Withdrawals'));
    var wk = Object.keys(m.withdrawal_counts || {});
    if (wk.length) d.appendChild(dl(wk.map(function (k) { return [words(k), m.withdrawal_counts[k].count + (m.withdrawal_counts[k].count === 1 ? ' withdrawal, ' : ' withdrawals, ') + naira(m.withdrawal_counts[k].amount)]; })));
    if (!(m.withdrawals || []).length) d.appendChild(h('p', 'ad-note', 'No withdrawals.'));
    else d.appendChild(table(['Requested', 'Status', 'Amount', 'Fee', 'Net', 'Bank', 'Problem'], m.withdrawals.map(function (x) {
      return [when(x.created_at), words(x.status), naira(x.amount), naira(x.fee), naira(x.net_amount), (x.bank_name || '') + (x.account_last4 ? ' ****' + x.account_last4 : ''), x.failure_reason]; })));
    if ((m.bank_accounts || []).length) d.appendChild(h('p', 'ad-hint', 'Bank accounts on file: ' + m.bank_accounts.map(function (b) { return (b.bank_name || 'Bank') + (b.account_last4 ? ' ****' + b.account_last4 : '') + (b.is_default ? ' (default)' : '') + (b.removed_at ? ' (removed)' : ''); }).join(', ') + '. Full account numbers are never shown.'));
    box.appendChild(d);
  }

  function tabVerification(box, r) {
    var v = h('section', 'ad-card'); v.appendChild(h('h3', 'ad-card-title', 'Identity verification (provider result)'));
    if (!(r.verification || []).length) v.appendChild(h('p', 'ad-note', 'No identity check started.'));
    else v.appendChild(table(['Started', 'Status', 'Provider status', 'Liveness', 'Face match', 'Document', 'Finished'], r.verification.map(function (x) {
      return [when(x.started), words(x.status), words(x.provider_status), yn(x.liveness_ok), yn(x.face_match_ok), yn(x.document_ok), x.completed_at ? when(x.completed_at) : '-']; })));
    v.appendChild(h('p', 'ad-hint', 'This shows what the identity provider reported. Nothing here sets or removes a verified mark, and identity numbers are never shown.'));
    box.appendChild(v);
    var p = h('section', 'ad-card'); p.appendChild(h('h3', 'ad-card-title', 'Membership (a subscription label, not identity)'));
    var s = r.plan && r.plan.subscription;
    p.appendChild(dl([['Label on the site', (r.plan && r.plan.label) || 'None'], ['Plan', s && s.plan], ['Tier', s && s.tier], ['Status', s && words(s.status)],
      ['Period', s ? day(s.period_start) + ' to ' + day(s.period_end) : null], ['Ends at period end', s ? yn(s.cancel_at_period_end) : null], ['Change waiting', s && s.pending_plan]]));
    box.appendChild(p);
  }

  drawFilter(); load();
});

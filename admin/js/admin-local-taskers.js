/* StreetTasker Admin: Local Taskers (stage A10, spec S06).
   Reads go through admin_local_tasker_list and admin_local_tasker_detail; writes through admin_local_tasker_unpublish and
   admin_local_tasker_deactivate (sql/admin/a10-local-taskers.sql), and placing or moving a Local Tasker through the A9 function
   admin_coordinator_assign_local_tasker. Each checks the admin permission on the server, refuses a Local Tasker in the acting admin's own
   coordinator care (Rule R-SELF) and writes the admin activity log. This page only hides what the permissions say you cannot use.
   What it never does: set or change a price or a service, accept a job for a worker, touch money, change identity status, or show a
   phone number, bank detail or consent evidence. The coordinator's plan limit is decided by the database.
   All text is inserted with textContent, so profile text cannot inject markup. */
'use strict';
AdminShell.init({ page: 'local-taskers', title: 'Local Taskers', permission: 'local_taskers.view' }).then(function (ctx) {
  var sb = window.supabase;
  var $ = function (id) { return document.getElementById(id); };

  var STATUS = { draft: 'Draft', ready: 'Ready, not published', published: 'Published', inactive: 'Deactivated' };
  var FILTERS = [['all', 'Everyone'], ['published', 'Published'], ['not_published', 'Not published yet'], ['unassigned', 'No coordinator'],
    ['unverified', 'Identity not verified'], ['needs_republish', 'Changed since publishing'], ['has_bookings', 'Has bookings'], ['inactive', 'Deactivated']];
  var IDV = { VERIFIED: 'Verified', PENDING: 'Waiting for a result', IN_PROGRESS: 'In progress', NOT_STARTED: 'Not started', FAILED: 'Failed',
    REVIEW_REQUIRED: 'Needs a manual review', RESUBMIT_REQUESTED: 'Asked to try again', EXPIRED: 'Expired', ABANDONED: 'Abandoned' };
  var LT = { needs_reassignment: 'Needs a coordinator', assigned: 'Assigned', awaiting_tasker_confirmation: 'Waiting for the worker', tasker_confirmed: 'Worker agreed',
    tasker_declined: 'Worker declined', quote_sent: 'Quote sent', quote_approved: 'Quote approved', quote_declined: 'Quote declined' };
  var SECTION = { coordinator: 'coordinator history', identity: 'identity status', services: 'services', photos: 'photos', consents: 'consent records', bookings: 'bookings', payouts: 'payout records' };
  var state = { filter: 'all', search: '', coord: '', offset: 0, data: null, sel: null, loadId: 0 };

  $('adLt').hidden = false;

  /* ---------- helpers ---------- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(t) { if (!t) return '-'; var d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function num(v) { return v == null ? '-' : String(v); }
  function naira(v) { var n = Number(v); return isNaN(n) ? '-' : '₦' + n.toLocaleString('en-NG'); }
  function field(label, control) { var g = h('div', 'ad-field'); var l = h('label', null, label); if (control.id) l.setAttribute('for', control.id); return add(g, l, control); }
  var uid = 0; function nextId(p) { uid += 1; return p + uid; }
  function dl(pairs) {
    var d = h('dl', 'ad-dl');
    pairs.forEach(function (p) { add(d, h('dt', null, p[0]), h('dd', null, p[1] == null || p[1] === '' ? '-' : String(p[1]))); });
    return d;
  }
  function statusBadge(st) {
    var cls = st === 'published' ? 'badge badge-green' : st === 'inactive' ? 'badge badge-gray' : 'badge badge-amber';
    return h('span', cls, STATUS[st] || st || 'Unknown');
  }
  function capText(c) { return num(c.workers) + ' of ' + (c.capacity == null ? '?' : c.capacity) + ' places'; }

  /* Every function answers { ok, error, ... }. Anything else is a failure. */
  async function call(name, args) {
    try {
      var r = await sb.rpc(name, args || {});
      if (r.error) {
        if (r.error.code === '42501') return { ok: false, error: 'You do not have permission to do this.' };
        if (r.error.code === '42883' || r.error.code === 'PGRST202') {
          return { ok: false, missing: true, error: 'A server function is missing. Run ' + (name.indexOf('admin_coordinator_') === 0 ? 'sql/admin/a9-coordinators.sql' : 'sql/admin/a10-local-taskers.sql') + ' in the Supabase SQL editor.' };
        }
        return { ok: false, error: r.error.message || 'Request failed.' };
      }
      var d = r.data;
      if (d && typeof d === 'object' && 'ok' in d) return d;
      return { ok: false, error: 'Unexpected reply from the server.' };
    } catch (e) { return { ok: false, error: 'Could not reach the server.' }; }
  }

  /* ---------- filters ---------- */
  FILTERS.forEach(function (f) { var o = h('option', null, f[1]); o.value = f[0]; $('ltFilter').appendChild(o); });
  function drawCoordFilter() {
    var sel = $('ltCoord'); var keep = state.coord; clear(sel);
    var all = h('option', null, 'Any coordinator'); all.value = ''; sel.appendChild(all);
    ((state.data && state.data.coordinators) || []).forEach(function (c) { var o = h('option', null, (c.name || 'Coordinator') + (c.is_me ? ' (you)' : '')); o.value = c.user_id; sel.appendChild(o); });
    sel.value = keep;
  }
  $('ltFilters').addEventListener('submit', function (e) {
    e.preventDefault();
    state.search = $('ltSearch').value.trim(); state.filter = $('ltFilter').value; state.coord = $('ltCoord').value; state.offset = 0; state.sel = null; load();
  });
  $('ltReset').addEventListener('click', function () {
    $('ltSearch').value = ''; $('ltFilter').value = 'all'; $('ltCoord').value = '';
    state.search = ''; state.filter = 'all'; state.coord = ''; state.offset = 0; state.sel = null; load();
  });

  /* ---------- load the list ---------- */
  async function load() {
    var mine = ++state.loadId; var body = $('ltBody');
    clear(body); body.appendChild(ctx.skeleton(4));
    var r = await call('admin_local_tasker_list', { p_search: state.search || null, p_filter: state.filter, p_coordinator: state.coord || null, p_offset: state.offset });
    if (mine !== state.loadId) return;
    if (!r.ok) { clear(body); ctx.showError(body, r.error, load); return; }
    state.data = r; drawCoordFilter(); render();
  }
  function items() { return (state.data && state.data.items) || []; }
  function byId(id) { return items().filter(function (x) { return x.tasker_user_id === id; })[0]; }

  function summary(counts) {
    var line = h('p', 'ad-hint');
    line.textContent = counts.all + ' in all · ' + counts.published + ' published · ' + counts.not_published + ' not published yet · '
      + counts.unassigned + ' with no coordinator · ' + counts.unverified + ' not identity-verified · ' + counts.inactive + ' deactivated';
    return line;
  }

  function render() {
    var body = $('ltBody'); clear(body);
    var d = state.data;
    var split = h('div', 'ad-split' + (state.sel ? ' is-detail' : ''));
    var listCol = h('section', 'ad-split-list'); listCol.setAttribute('aria-label', 'Local Taskers');
    var detCol = h('section', 'ad-split-detail'); detCol.setAttribute('aria-label', 'Local Tasker detail');
    var back = h('button', 'btn ad-back', 'Back to the list'); back.type = 'button';
    back.addEventListener('click', function () { state.sel = null; render(); });
    var detail = h('div'); add(detCol, back, detail);

    var card = h('div', 'ad-card');
    add(card, summary(d.counts || {}), h('p', 'ad-hint', d.total + (d.total === 1 ? ' match' : ' matches')));
    if (!items().length) {
      var filtered = state.search || state.coord || state.filter !== 'all';
      ctx.showEmpty(card, filtered ? 'No Local Taskers match these filters.' : 'No Local Tasker has been added yet.');
    } else {
      var ul = h('ul', 'ad-rows');
      items().forEach(function (w) {
        var b = h('button', 'ad-row'); b.type = 'button';
        if (state.sel === w.tasker_user_id) b.setAttribute('aria-current', 'true');
        var facts = [w.coordinator_name ? 'With ' + w.coordinator_name : 'No coordinator', w.identity_verified ? 'Identity verified' : 'Identity not verified',
          num(w.bookings) + (w.bookings === 1 ? ' booking' : ' bookings')];
        if (w.needs_republish && w.status === 'published') facts.push('Changed since publishing');
        add(b, add(h('span', 'ad-row-top'), h('span', 'ad-row-title', w.name || 'Local Tasker'), statusBadge(w.status)),
          h('span', 'ad-row-sub', w.areas || ''), h('span', 'ad-hint', facts.join(' · ')));
        b.addEventListener('click', function () { state.sel = w.tasker_user_id; render(); });
        add(ul, add(h('li'), b));
      });
      card.appendChild(ul);
      if (state.offset > 0 || state.offset + items().length < d.total) {
        var pager = h('div', 'ad-actions ad-pager');
        var prev = h('button', 'btn', 'Previous'); prev.type = 'button'; prev.disabled = state.offset <= 0;
        var next = h('button', 'btn', 'Next'); next.type = 'button'; next.disabled = state.offset + items().length >= d.total;
        prev.addEventListener('click', function () { state.offset = Math.max(0, state.offset - d.page_size); state.sel = null; load(); });
        next.addEventListener('click', function () { state.offset += d.page_size; state.sel = null; load(); });
        add(pager, prev, h('span', 'ad-hint', 'Showing ' + (state.offset + 1) + ' to ' + (state.offset + items().length) + ' of ' + d.total), next);
        card.appendChild(pager);
      }
    }
    add(listCol, card); add(split, listCol, detCol); body.appendChild(split);
    var w = state.sel && byId(state.sel);
    if (w) drawDetail(detail, w);
    else add(detail, add(h('div', 'ad-card'), h('p', 'ad-note', 'Choose a Local Tasker on the left.')));
  }

  /* ---------- detail ---------- */
  async function drawDetail(box, w) {
    var holder = h('div'); holder.appendChild(ctx.skeleton(3)); box.appendChild(holder);
    var r = await call('admin_local_tasker_detail', { p_tasker: w.tasker_user_id });
    if (state.sel !== w.tasker_user_id) return;
    clear(holder);
    if (!r.ok) { ctx.showError(holder, r.error, function () { render(); }); return; }
    var p = r.profile;

    var head = h('div', 'ad-card ad-panel');
    add(head, add(h('div', 'ad-row-top'), h('h2', 'ad-panel-title', p.name || 'Local Tasker'), statusBadge(p.status)));
    add(head, dl([['Areas served', p.areas], ['Skills', (p.skills || []).join(', ')], ['Availability notes', p.availability_notes],
      ['Phone', p.phone_hint], ['Published on', p.published_at ? when(p.published_at) : 'Not published'], ['Added', when(p.created_at)],
      ['Identity check', r.identity ? (IDV[r.identity.status] || r.identity.status) : 'No check on record']]));
    if (p.needs_republish && p.status === 'published') add(head, h('p', 'ad-note', 'Their services, photos or profile changed after publishing. Customers already see the changes; the coordinator has been shown a "publish again" notice.'));
    add(head, h('p', 'ad-note', 'Workers must agree to each job, and coordinators cannot set prices. This page never edits a price.'));
    if (r.sections_failed && r.sections_failed.length) {
      add(head, h('p', 'ad-error', 'Some parts could not be read: ' + r.sections_failed.map(function (k) { return SECTION[k] || k; }).join(', ') + '.'));
    }
    holder.appendChild(head);

    /* coordinator and history */
    var cc = h('div', 'ad-card ad-panel'); add(cc, h('h2', 'ad-panel-title', 'Coordinator'));
    if (r.coordinator) {
      add(cc, dl([['Looked after by', r.coordinator.name], ['Coordinator status', r.coordinator.coordinator_status], ['Since', when(r.coordinator.assigned_at)]]));
    } else add(cc, h('p', 'ad-note', p.status === 'inactive' ? 'No coordinator: this person is deactivated.' : 'No coordinator right now.'));
    if (r.history && r.history.length) {
      add(cc, h('h3', 'ad-card-title', 'History'));
      var hu = h('ul', 'ad-sub');
      r.history.forEach(function (a) {
        var li = h('li');
        add(li, h('span', null, (a.name || 'Coordinator') + ' · from ' + when(a.assigned_at) + (a.ended_at ? ' to ' + when(a.ended_at) : ' (now)')
          + (a.ended_at && a.end_reason ? ' · ' + a.end_reason : '')));
        hu.appendChild(li);
      });
      cc.appendChild(hu);
    }
    holder.appendChild(cc);

    /* services: read only */
    var sc = h('div', 'ad-card ad-panel'); add(sc, h('h2', 'ad-panel-title', 'Services and prices (read only)'));
    if (r.services == null) add(sc, h('p', 'ad-note', 'Not available.'));
    else if (!r.services.length) add(sc, h('p', 'ad-note', 'No services yet.'));
    else {
      var su = h('ul', 'ad-sub');
      r.services.forEach(function (s) {
        var li = h('li');
        add(li, h('span', null, (s.service_name || 'Service') + ' · ' + naira(s.price) + (s.rate_unit || '') + (s.category ? ' · ' + s.category : '')),
          h('span', 'badge ' + (s.available ? 'badge-green' : 'badge-gray'), (s.is_main ? 'Main, ' : '') + (s.available ? 'Live' : 'Paused')));
        su.appendChild(li);
      });
      sc.appendChild(su);
    }
    if (r.photos) add(sc, h('p', 'ad-hint', 'Photos: ' + num(r.photos.portfolio) + ' portfolio, ' + num(r.photos.profile_picture) + ' profile picture'
      + (r.photos.removed ? ', ' + r.photos.removed + ' removed' : '') + '. Files are not shown here.'));
    holder.appendChild(sc);

    /* bookings, consents, payouts */
    var bc = h('div', 'ad-card ad-panel'); add(bc, h('h2', 'ad-panel-title', 'Bookings'));
    if (r.bookings == null) add(bc, h('p', 'ad-note', 'Not available.'));
    else if (!r.bookings.length) add(bc, h('p', 'ad-note', 'No bookings yet.'));
    else {
      var bu = h('ul', 'ad-sub');
      r.bookings.forEach(function (b) {
        add(bu, add(h('li'), h('span', null, when(b.created_at) + ' · booking ' + (b.booking_status || '-')), h('span', 'badge badge-gray', LT[b.lt_status] || b.lt_status || 'Unknown')));
      });
      bc.appendChild(bu);
      if (r.bookings.length >= 25) add(bc, h('p', 'ad-hint', 'The latest 25 are shown.'));
    }
    holder.appendChild(bc);

    var pc = h('div', 'ad-card ad-panel'); add(pc, h('h2', 'ad-panel-title', 'Payouts and consent'));
    if (r.payouts == null) add(pc, h('p', 'ad-note', 'Payout records are not available.'));
    else if (!r.payouts.length) add(pc, h('p', 'ad-note', 'No payouts yet.'));
    else {
      var pu = h('ul', 'ad-sub');
      r.payouts.forEach(function (x) {
        var amt = x.amount != null ? naira(x.amount) : (x.amount_kobo != null ? naira(Number(x.amount_kobo) / 100) : '-');
        add(pu, add(h('li'), h('span', null, when(x.created_at) + ' · ' + amt), h('span', 'badge badge-gray', x.status || 'Unknown')));
      });
      pc.appendChild(pu);
    }
    if (r.payout_accounts && r.payout_accounts.length) {
      var a = r.payout_accounts[0];
      add(pc, h('p', 'ad-hint', 'Payout account: ' + (a.bank_name ? a.bank_name + ' ' : '') + ((a.last4 || a.account_last4) ? 'ending ' + (a.last4 || a.account_last4) : '(last four not shown)') + '. Recorded only; admin never moves money.'));
    }
    add(pc, h('h3', 'ad-card-title', 'Consent records'));
    if (r.consents == null) add(pc, h('p', 'ad-note', 'Not available.'));
    else if (!r.consents.length) add(pc, h('p', 'ad-note', 'No consent recorded.'));
    else {
      var cu = h('ul', 'ad-sub');
      r.consents.forEach(function (c) {
        add(cu, add(h('li'), h('span', null, (c.purpose || 'Consent') + ' · ' + (c.method || '-') + ' · ' + when(c.created_at || c.recorded_at)),
          h('span', 'badge ' + (c.revoked_at ? 'badge-gray' : 'badge-green'), c.revoked_at ? 'Withdrawn' : 'Active')));
      });
      pc.appendChild(cu);
    }
    holder.appendChild(pc);

    /* actions */
    if (p.in_my_care) {
      holder.appendChild(add(h('div', 'ad-card'), h('p', 'ad-note', 'This Local Tasker is in the care of your own coordinator account. For safety you cannot move, unpublish or deactivate them from the admin area.')));
    } else if (p.status !== 'inactive') {
      if (r.can_assign) holder.appendChild(placePanel(w, p, r));
      if (r.can_manage && p.status === 'published') holder.appendChild(unpublishPanel(w));
      if (r.can_manage) holder.appendChild(deactivatePanel(w));
    }
  }

  /* ---------- actions ---------- */
  function afterChange(msg) { ctx.toast(msg); state.data = null; load(); }

  function reasonForm(opt) {
    var f = h('form', 'ad-form'); f.noValidate = true;
    var reason = h('textarea', 'form-input'); reason.id = nextId('ltWhy'); reason.rows = 3; reason.maxLength = 300;
    var err = h('p', 'ad-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var go = h('button', 'btn ' + (opt.primary ? 'btn-primary' : 'btn-outline'), opt.label); go.type = 'submit';
    var armed = false;
    if (opt.extra) f.appendChild(opt.extra);
    add(f, field('Reason (at least 10 characters; it goes in the activity log)', reason), err, add(h('div', 'ad-actions ad-actions--tight'), go));
    reason.addEventListener('input', function () { armed = false; go.textContent = opt.label; });
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); err.hidden = true;
      if (opt.validate) { var bad = opt.validate(); if (bad) { err.textContent = bad; err.hidden = false; return; } }
      if (reason.value.trim().length < 10) { err.textContent = 'Write a reason of at least 10 characters.'; err.hidden = false; return; }
      if (opt.confirm && !armed) { armed = true; go.textContent = 'Press again to confirm'; return; }
      go.disabled = true;
      var r = await opt.run(reason.value.trim());
      go.disabled = false; armed = false; go.textContent = opt.label;
      if (!r.ok) { err.textContent = r.error || 'It could not be done. Nothing was changed.'; err.hidden = false; return; }
      afterChange(opt.done(r));
    });
    return f;
  }

  function placePanel(w, p, r) {
    var card = h('div', 'ad-card ad-panel');
    var has = !!r.coordinator;
    add(card, h('h2', 'ad-panel-title', has ? 'Move to another coordinator' : 'Place with a coordinator'));
    add(card, h('p', 'ad-note', 'The coordinator\'s plan limit is checked by the database. A coordinator with no free place is refused and nothing changes.'));
    var sel = h('select', 'form-input'); sel.id = nextId('ltTo');
    var first = h('option', null, 'Choose a coordinator'); first.value = ''; sel.appendChild(first);
    ((state.data && state.data.coordinators) || []).filter(function (c) { return !c.is_me && c.user_id !== (r.coordinator && r.coordinator.coordinator_id); }).forEach(function (c) {
      var full = c.capacity != null && c.workers >= c.capacity;
      var o = h('option', null, (c.name || 'Coordinator') + ' (' + capText(c) + (full ? ', full' : '') + ')'); o.value = c.user_id; if (full) o.disabled = true; sel.appendChild(o);
    });
    card.appendChild(reasonForm({
      label: has ? 'Move ' + (p.name || 'this Local Tasker') : 'Assign ' + (p.name || 'this Local Tasker'), primary: true, extra: field('Coordinator', sel),
      validate: function () { return sel.value ? '' : 'Choose a coordinator.'; },
      run: function (reason) { return call('admin_coordinator_assign_local_tasker', { p_tasker: w.tasker_user_id, p_coordinator: sel.value, p_reason: reason }); },
      done: function (res) { return res.kind === 'moved' ? 'Local Tasker moved.' : 'Local Tasker assigned.'; }
    }));
    return card;
  }

  function unpublishPanel(w) {
    var card = h('div', 'ad-card ad-panel');
    add(card, h('h2', 'ad-panel-title', 'Unpublish'));
    add(card, h('p', 'ad-note', 'Hides this person from customers. Their profile, services, photos and bookings are kept, and their coordinator is told. The coordinator can publish again once they are ready.'));
    card.appendChild(reasonForm({
      label: 'Unpublish', confirm: true,
      run: function (reason) { return call('admin_local_tasker_unpublish', { p_tasker: w.tasker_user_id, p_reason: reason }); },
      done: function () { return 'Unpublished.'; }
    }));
    return card;
  }

  function deactivatePanel(w) {
    var card = h('div', 'ad-card ad-panel');
    add(card, h('h2', 'ad-panel-title', 'Deactivate'));
    add(card, h('p', 'ad-note', 'Retires this person: hidden from customers, no coordinator, and the coordinator\'s place is freed. Only possible when they have no open bookings. Nothing is deleted: services, photos, consents, bookings and history stay. There is no undo button here; to bring someone back, ask the developer.'));
    card.appendChild(reasonForm({
      label: 'Deactivate', confirm: true,
      run: function (reason) { return call('admin_local_tasker_deactivate', { p_tasker: w.tasker_user_id, p_reason: reason }); },
      done: function () { return 'Local Tasker deactivated.'; }
    }));
    return card;
  }

  load();
});

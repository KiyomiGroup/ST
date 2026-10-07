/* ============================================================
   STREETTASKER — applications.js
   Tasker "My Applications" page (applications.html).
   Stage 1: load the signed-in tasker's applications, filter, search, sort, render.
   Data: task_applications joined to tasks. The proposed rate is stored inside
   the message text ("| Proposed rate: ...") so it is parsed out here.
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var state = { apps: [], filter: 'all', query: '', category: '', sort: 'recent', shown: PAGE_SIZE };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var icon = function (id) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var naira = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); };

  /* Map a database status onto the five tabs */
  function group(status) {
    if (status === 'accepted') return 'accepted';
    if (status === 'completed') return 'completed';
    if (status === 'rejected' || status === 'closed' || status === 'declined' || status === 'withdrawn') return 'declined';
    return 'pending';
  }

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min' : ' mins') + ' ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + ' ago';
    var d = Math.floor(h / 24); return d + (d === 1 ? ' day' : ' days') + ' ago';
  }

  /* Split the stored message into the pitch text and the proposed rate */
  function parseMessage(msg) {
    var text = String(msg || '');
    var m = text.match(/\|\s*Proposed rate:\s*([^|]+)/i);
    var rate = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : NaN;
    return { pitch: text.replace(/\|\s*Proposed rate:.*$/i, '').trim(), rate: isNaN(rate) ? null : rate };
  }

  /* ── Data ─────────────────────────────────────────────── */
  async function load() {
    var sess = await window.supabase.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.replace('login.html?next=applications.html'); return; }

    var role = null;
    try { role = await window.ST.auth.getUserRole(user); } catch (e) { /* fall back to cache */ }
    role = role || localStorage.getItem('st_role');
    if (role === 'customer') { window.location.replace('dashboard-customer.html?panel=applications'); return; }

    var res = await window.supabase.from('task_applications')
      .select('*, tasks!task_id(id, title, budget, location, category, status, created_at, user_id, customer_id)')
      .eq('tasker_id', user.id).order('created_at', { ascending: false });
    if (res.error) { renderError(res.error.message); return; }
    var rows = res.data || [];

    /* Optional extras: customer names and competing offers. Each may be blocked
       by row permissions, in which case the card simply hides that detail. */
    var ownerIds = {}, taskIds = {};
    rows.forEach(function (a) {
      var t = a.tasks || {}; var o = t.customer_id || t.user_id;
      if (o) ownerIds[o] = 1; if (t.id) taskIds[t.id] = 1;
    });
    var names = {}, rivals = {};
    try {
      var ids = Object.keys(ownerIds);
      if (ids.length) {
        var u = await window.supabase.from('users').select('id, name').in('id', ids);
        (u.data || []).forEach(function (r) { names[r.id] = r.name; });
      }
    } catch (e) { /* hide names */ }
    try {
      var tids = Object.keys(taskIds);
      if (tids.length) {
        var c = await window.supabase.from('task_applications').select('task_id, tasker_id').in('task_id', tids);
        (c.data || []).forEach(function (r) { if (r.tasker_id !== user.id) rivals[r.task_id] = (rivals[r.task_id] || 0) + 1; });
      }
    } catch (e) { /* hide competition */ }

    state.apps = rows.map(function (a) {
      var t = a.tasks || {}; var p = parseMessage(a.message);
      return {
        id: a.id, raw: a, task: t, status: a.status, group: group(a.status), created: a.created_at,
        pitch: p.pitch, offer: p.rate != null ? p.rate : (t.budget || null),
        customer: names[t.customer_id || t.user_id] || '', rivals: rivals[t.id] || 0,
      };
    });
    buildCategories(); render();
  }

  /* ── Render ───────────────────────────────────────────── */
  function buildCategories() {
    var seen = {}, sel = $('apCategory');
    state.apps.forEach(function (a) { if (a.task.category) seen[a.task.category] = 1; });
    Object.keys(seen).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });
  }

  function visible() {
    var q = state.query.toLowerCase();
    var list = state.apps.filter(function (a) {
      if (state.filter !== 'all' && a.group !== state.filter) return false;
      if (state.category && a.task.category !== state.category) return false;
      if (q && (String(a.task.title || '') + ' ' + a.customer).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (x, y) {
      if (state.sort === 'oldest') return new Date(x.created) - new Date(y.created);
      if (state.sort === 'offer') return (y.offer || 0) - (x.offer || 0);
      return new Date(y.created) - new Date(x.created);
    });
    return list;
  }

  function badge(a) {
    var map = {
      pending:   ['ap-badge-pending',   '<span class="ap-badge-dot"></span>Pending Review'],
      accepted:  ['ap-badge-accepted',  icon('circle-check') + 'Accepted \u2022 Ready to Start'],
      declined:  ['ap-badge-declined',  'Declined'],
      completed: ['ap-badge-completed', icon('circle-check') + 'Completed'],
    }[a.group];
    return '<span class="ap-badge ' + map[0] + '">' + map[1] + '</span>';
  }

  function card(a) {
    var t = a.task, g = a.group;
    var loc = t.location ? '<span>' + icon('pin') + esc(t.location) + '</span>' : '';
    var who = a.customer ? '<strong>' + esc(a.customer) + '</strong>' : '';
    var posted = t.created_at ? '<span>Posted ' + esc(ago(t.created_at)) + '</span>' : '';
    var sub = '<div class="ap-card-sub">' + who + loc + posted + '</div>';
    var when = g === 'pending' || g === 'declined'
      ? '<span class="ap-meta">' + icon('clock') + 'Applied ' + esc(ago(a.created)) + '</span>'
      : '<span class="ap-meta">' + esc(ago(a.created)) + '</span>';
    var body = '';

    if (g === 'pending' || g === 'declined') {
      var rival = a.rivals > 0
        ? '<div class="ap-fig-text">' + icon('users') + a.rivals + ' other offer' + (a.rivals === 1 ? '' : 's') + ' submitted</div>' : '';
      body += '<div class="ap-figures">' +
        '<div><div class="ap-fig-label">Client Budget</div><div class="ap-fig-value">' + (t.budget ? naira(t.budget) : '\u2014') + '</div></div>' +
        '<div><div class="ap-fig-label">Your Offer</div><div class="ap-fig-value is-offer">' + (a.offer ? naira(a.offer) : '\u2014') + '</div></div>' +
        '<div>' + (rival ? '<div class="ap-fig-label">Competition</div>' + rival : '') + '</div></div>';
    } else {
      body += '<div class="ap-figures"><div><div class="ap-fig-label">' + (g === 'completed' ? 'Payout' : 'Agreed Contract Price') + '</div>' +
        '<div class="ap-fig-value is-offer">' + (a.offer ? naira(a.offer) : '\u2014') + '</div></div></div>';
    }
    if (a.pitch) {
      body += '<div><div class="ap-proposal-head"><span class="ap-fig-label">Your Submitted Proposal</span></div>' +
        '<p class="ap-quote">\u201C' + esc(a.pitch) + '\u201D</p></div>';
    }
    /* Stage 2 adds: Edit Offer, Withdraw, Message Customer, escrow note */
    var actions = '<div class="ap-actions"><a class="ap-btn" href="explore-tasks.html">View Task Details</a></div>';
    return '<article class="ap-card" data-id="' + esc(a.id) + '"><div class="ap-card-top">' + badge(a) + when + '</div>' +
      '<div><h2 class="ap-card-title">' + esc(t.title || 'Task') + '</h2>' + sub + '</div>' + body + actions + '</article>';
  }

  function render() {
    var all = state.apps, list = visible(), host = $('apList');
    var counts = { all: all.length, pending: 0, accepted: 0, declined: 0, completed: 0 };
    all.forEach(function (a) { counts[a.group]++; });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var n = counts[el.getAttribute('data-count')]; el.textContent = n > 0 ? n : '';
    });
    var total = $('apTotal'); total.hidden = !all.length; total.textContent = all.length + ' Total';

    if (!all.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">No applications yet</h2>' +
        '<p class="ap-state-text">Browse open tasks and send a proposal to get hired.</p>' +
        '<a class="ap-btn ap-btn-primary" href="explore-tasks.html">Browse Open Tasks</a></div>';
      $('apMore').hidden = true; return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Nothing matches</h2>' +
        '<p class="ap-state-text">Try a different tab, search or category.</p></div>';
      $('apMore').hidden = true; return;
    }
    host.innerHTML = list.slice(0, state.shown).map(card).join('');
    $('apMore').hidden = list.length <= state.shown;
  }

  function renderError(msg) {
    $('apList').innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Could not load applications</h2><p class="ap-state-text">' + esc(msg) + '</p></div>';
  }

  /* ── Events ───────────────────────────────────────────── */
  function reset() { state.shown = PAGE_SIZE; render(); }
  $('apTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.ap-tab'); if (!b) return;
    state.filter = b.getAttribute('data-filter');
    document.querySelectorAll('.ap-tab').forEach(function (t) { t.setAttribute('aria-pressed', t === b ? 'true' : 'false'); });
    reset();
  });
  $('apSearch').addEventListener('input', function (e) { state.query = e.target.value.trim(); reset(); });
  $('apCategory').addEventListener('change', function (e) { state.category = e.target.value; reset(); });
  $('apSort').addEventListener('change', function (e) { state.sort = e.target.value; reset(); });
  $('apMore').addEventListener('click', function () { state.shown += PAGE_SIZE; render(); });

  load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
})();

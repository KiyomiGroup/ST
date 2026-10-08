/* ============================================================
   STREETTASKER — customer-applications.js
   Customer "Applications" page (customer-applications.html).
   Stage 1: load every application on the customer's tasks (batched queries),
   then filter, search, sort and render applicant cards.
   Data: tasks -> task_applications -> taskers + users (names, photos, ratings).
   ============================================================ */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var state = { user: null, apps: [], tasks: [], filter: 'all', query: '', task: '', sort: 'recent', shown: PAGE_SIZE };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var icon = function (id) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var naira = function (n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); };
  var safeUrl = function (u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; };

  function group(status) {
    if (status === 'accepted' || status === 'completed') return 'accepted';
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
  /* The pitch and the proposed rate are stored together in one message string */
  function parseMessage(msg) {
    var text = String(msg || '');
    var m = text.match(/\|\s*Proposed rate:\s*([^|]+)/i);
    var rate = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : NaN;
    return { pitch: text.replace(/\|\s*Proposed rate:.*$/i, '').trim(), rate: isNaN(rate) ? null : rate };
  }
  function initials(name) {
    return String(name).replace(/[^a-zA-Z ]/g, '').trim().split(' ').filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || '??';
  }

  /* ── Data ─────────────────────────────────────────────── */
  async function load() {
    var sess = await window.supabase.auth.getSession();
    var user = sess.data.session && sess.data.session.user;
    if (!user) { window.location.replace('login.html?next=customer-applications.html'); return; }
    state.user = user;

    var role = null;
    try { role = await window.ST.auth.getUserRole(user); } catch (e) { /* use cache */ }
    role = role || localStorage.getItem('st_role');
    if (role === 'tasker') { window.location.replace('applications.html'); return; }

    var tr = await window.supabase.from('tasks').select('id, title, budget, location, status, created_at')
      .or('customer_id.eq.' + user.id + ',user_id.eq.' + user.id).order('created_at', { ascending: false });
    if (tr.error) { renderError(tr.error.message); return; }
    state.tasks = tr.data || [];
    var byTask = {}; state.tasks.forEach(function (t) { byTask[t.id] = t; });

    var rows = [];
    if (state.tasks.length) {
      var ar = await window.supabase.from('task_applications').select('*')
        .in('task_id', state.tasks.map(function (t) { return t.id; })).order('created_at', { ascending: false });
      if (ar.error) { renderError(ar.error.message); return; }
      rows = ar.data || [];
    }

    /* One batched lookup each for tasker profiles and user records */
    var ids = Object.keys(rows.reduce(function (o, a) { if (a.tasker_id) o[a.tasker_id] = 1; return o; }, {}));
    var profiles = {}, users = {}, offersPerTask = {};
    if (ids.length) {
      try {
        var t = await window.supabase.from('taskers')
          .select('user_id, name, service, service_name, location, rating, photo_url, business_name').in('user_id', ids);
        (t.data || []).forEach(function (r) { profiles[r.user_id] = r; });
      } catch (e) { /* fall back to users */ }
      try {
        var u = await window.supabase.from('users').select('id, name, business_name, avatar_url').in('id', ids);
        (u.data || []).forEach(function (r) { users[r.id] = r; });
      } catch (e) { /* fall back to ids */ }
    }
    rows.forEach(function (a) { offersPerTask[a.task_id] = (offersPerTask[a.task_id] || 0) + 1; });

    state.apps = rows.map(function (a) {
      var p = profiles[a.tasker_id] || {}, u = users[a.tasker_id] || {};
      var msg = parseMessage(a.message), task = byTask[a.task_id] || {};
      var name = p.business_name || u.business_name || p.name || u.name || ('Tasker #' + String(a.tasker_id || '').slice(0, 6).toUpperCase());
      return {
        id: a.id, taskerId: a.tasker_id, task: task, status: a.status, group: group(a.status), created: a.created_at,
        name: name, service: p.service || p.service_name || '', location: p.location || '',
        rating: p.rating ? parseFloat(p.rating) : null, photo: safeUrl(p.photo_url || u.avatar_url || ''),
        pitch: msg.pitch, offer: msg.rate != null ? msg.rate : null, offers: offersPerTask[a.task_id] || 0,
      };
    });
    buildTaskOptions(); render();
  }

  /* ── Render ───────────────────────────────────────────── */
  function buildTaskOptions() {
    var sel = $('apTask'), seen = {};
    state.apps.forEach(function (a) {
      if (!a.task.id || seen[a.task.id]) return; seen[a.task.id] = 1;
      var o = document.createElement('option'); o.value = a.task.id; o.textContent = a.task.title || 'Task'; sel.appendChild(o);
    });
  }

  function visible() {
    var q = state.query.toLowerCase();
    var list = state.apps.filter(function (a) {
      if (state.filter !== 'all' && a.group !== state.filter) return false;
      if (state.task && String(a.task.id) !== String(state.task)) return false;
      if (q && (a.name + ' ' + (a.task.title || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (x, y) {
      if (state.sort === 'oldest') return new Date(x.created) - new Date(y.created);
      if (state.sort === 'lowest') return (x.offer == null ? Infinity : x.offer) - (y.offer == null ? Infinity : y.offer);
      if (state.sort === 'rating') return (y.rating || 0) - (x.rating || 0);
      return new Date(y.created) - new Date(x.created);
    });
    return list;
  }

  function badge(a) {
    var label = { rejected: 'Declined', closed: 'Closed', completed: 'Completed' }[a.status];
    var map = {
      pending:  ['ap-badge-pending',  '<span class="ap-badge-dot"></span>Needs Review'],
      accepted: ['ap-badge-accepted', icon('circle-check') + (label || 'Accepted')],
      declined: ['ap-badge-declined', label || 'Declined'],
    }[a.group];
    return '<span class="ap-badge ' + map[0] + '">' + map[1] + '</span>';
  }

  function card(a) {
    var t = a.task;
    var avatar = '<span class="ap-avatar">' + (a.photo ? '<img src="' + esc(a.photo) + '" alt="" loading="lazy" />' : esc(initials(a.name))) + '</span>';
    var sub = [];
    if (a.rating) sub.push('<span class="ap-rating">' + icon('star') + a.rating.toFixed(1) + '</span>');
    if (a.service) sub.push('<span>' + esc(a.service) + '</span>');
    if (a.location) sub.push('<span>' + icon('pin') + esc(a.location) + '</span>');

    var delta = '';
    if (a.offer && t.budget) {
      var d = a.offer - t.budget;
      delta = d < 0 ? '<div class="ap-delta is-below">' + naira(-d) + ' below your budget</div>'
            : d > 0 ? '<div class="ap-delta is-above">' + naira(d) + ' above your budget</div>'
            : '<div class="ap-delta">Matches your budget</div>';
    }
    var figures = '<div class="ap-figures">' +
      '<div><div class="ap-fig-label">Your Budget</div><div class="ap-fig-value">' + (t.budget ? naira(t.budget) : '\u2014') + '</div></div>' +
      '<div><div class="ap-fig-label">Their Offer</div><div class="ap-fig-value is-offer">' + (a.offer ? naira(a.offer) : '\u2014') + '</div>' + delta + '</div>' +
      '<div>' + (a.offers > 1 ? '<div class="ap-fig-label">Competition</div><div class="ap-fig-text">' + icon('users') + a.offers + ' offers on this task</div>' : '') + '</div></div>';

    var pitch = a.pitch ? '<div><div class="ap-proposal-head"><span class="ap-fig-label">Their Proposal</span></div><p class="ap-quote">\u201C' + esc(a.pitch) + '\u201D</p></div>' : '';
    var profile = 'tasker-profile.html?id=' + encodeURIComponent(a.taskerId || '') + '&task=' + encodeURIComponent(t.id || '') + '&app=' + encodeURIComponent(a.id);
    /* Stage 2 adds: Accept, Decline, Message Tasker */
    var actions = '<div class="ap-actions"><a class="ap-btn' + (a.group === 'pending' ? ' ap-btn-primary' : '') + '" href="' + profile + '">' +
      (a.group === 'pending' ? 'View Profile &amp; Decide' : 'View Profile') + '</a></div>';

    return '<article class="ap-card" data-id="' + esc(a.id) + '"><div class="ap-card-top">' + badge(a) +
      '<span class="ap-meta">' + icon('clock') + 'Applied ' + esc(ago(a.created)) + '</span></div>' +
      '<div class="ap-person">' + avatar + '<div><h2 class="ap-person-name">' + esc(a.name) + '</h2><div class="ap-card-sub">' + sub.join('') + '</div></div></div>' +
      '<p class="ap-for">For <strong>' + esc(t.title || 'your task') + '</strong></p>' + figures + pitch + actions + '</article>';
  }

  function render() {
    $('apList').setAttribute('aria-busy', 'false');
    var all = state.apps, list = visible(), host = $('apList');
    var counts = { all: all.length, pending: 0, accepted: 0, declined: 0 };
    all.forEach(function (a) { counts[a.group]++; });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var n = counts[el.getAttribute('data-count')]; el.textContent = n > 0 ? n : '';
    });
    var total = $('apTotal'); total.hidden = !all.length; total.textContent = all.length + ' Total';

    if (!state.tasks.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">No tasks yet</h2><p class="ap-state-text">Post a task to start receiving applications from taskers.</p>' +
        '<a class="ap-btn ap-btn-primary" href="post-task.html">Post a Task</a></div>';
      $('apMore').hidden = true; return;
    }
    if (!all.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">No applications yet</h2><p class="ap-state-text">Taskers will apply as they see your tasks. You\u2019ll be notified when they do.</p></div>';
      $('apMore').hidden = true; return;
    }
    if (!list.length) {
      host.innerHTML = '<div class="ap-state"><h2 class="ap-state-title">Nothing matches</h2><p class="ap-state-text">Try a different tab, search or task.</p></div>';
      $('apMore').hidden = true; return;
    }
    host.innerHTML = list.slice(0, state.shown).map(card).join('');
    $('apMore').hidden = list.length <= state.shown;
  }

  function renderError(msg) {
    $('apList').setAttribute('aria-busy', 'false');
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
  $('apTask').addEventListener('change', function (e) { state.task = e.target.value; reset(); });
  $('apSort').addEventListener('change', function (e) { state.sort = e.target.value; reset(); });
  $('apMore').addEventListener('click', function () { state.shown += PAGE_SIZE; render(); });

  load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
})();

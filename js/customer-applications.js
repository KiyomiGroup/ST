/* ============================================================
   STREETTASKER — customer-applications.js
   Customer "Applications" page (customer-applications.html).
   Stage 1: load every application on the customer's tasks (batched queries),
   then filter, search, sort and render applicant cards.
   Stage 3: Accept uses the accept_application() database function when it exists (atomic),
   otherwise falls back to the three separate updates.
   Stage 2: sidebar snapshot, Accept / Decline (with confirmation), Message Tasker.
   Data: tasks -> task_applications -> taskers + users (names, photos) and rating_summary (ratings, through STRating).
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
    if (status === 'rejected' || status === 'closed' || status === 'declined' || status === 'withdrawn' || status === 'cancelled') return 'declined';   /* cancelled = accepted, then cancelled by the customer (M3/M5) */
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
    var w = text.match(/\|\s*Arrival:\s*([^|]+)/i);
    return { pitch: text.replace(/\|\s*Proposed rate:.*$/i, '').trim(), rate: isNaN(rate) ? null : rate, arrival: w ? w[1].trim() : '', proofs: proofLinks(text) };
  }
  /* Proof photos the tasker attached: " | Proof: https://... https://..." (only public files from our own storage) */
  function proofLinks(text) {
    var m = String(text || '').match(/\|\s*Proof:\s*([^|]+)/i);
    return m ? m[1].trim().split(/\s+/).filter(function (u) { return /^https:\/\/[^\s\/]+\/storage\/v1\/object\/public\/\S+$/.test(u); }).slice(0, 5) : [];
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
        .in('task_id', state.tasks.map(function (t) { return t.id; })).neq('status', 'withdrawn').order('created_at', { ascending: false });   /* withdrawn offers are kept but not shown */
      if (ar.error) { renderError(ar.error.message); return; }
      rows = ar.data || [];
    }

    /* One batched lookup each for tasker profiles and user records */
    var ids = Object.keys(rows.reduce(function (o, a) { if (a.tasker_id) o[a.tasker_id] = 1; return o; }, {}));
    var profiles = {}, users = {}, offersPerTask = {};
    if (ids.length) {
      try {
        var t = await window.supabase.from('taskers')
          .select('user_id, name, service, service_name, location, photo_url, business_name').in('user_id', ids);
        (t.data || []).forEach(function (r) { profiles[r.user_id] = r; });
      } catch (e) { /* fall back to users */ }
      try {
        var u = await window.supabase.from('users').select('id, name, business_name, avatar_url').in('id', ids);
        (u.data || []).forEach(function (r) { users[r.id] = r; });
      } catch (e) { /* fall back to ids */ }
    }
    /* M10a/b: the tasker's rating from rating_summary, never taskers.rating (users can write it) */
    var ratingMap = {};
    try { if (window.STRating && ids.length) ratingMap = await STRating.load(ids, 'tasker'); } catch (e) { /* no rating shown */ }
    rows.forEach(function (a) { offersPerTask[a.task_id] = (offersPerTask[a.task_id] || 0) + 1; });
    /* Membership labels (S4i): one question for every applicant; no answer = no label. */
    if (window.STMembership) { try { await window.STMembership.load(ids); } catch (e) { /* label is optional */ } }

    /* M5: is anything paid for an accepted job? Optional: if it cannot be read the button still shows and the database decides. */
    var bookingByJob = {};
    if (rows.some(function (a) { return a.status === 'accepted'; })) {
      try {
        var bk = await window.supabase.from('bookings').select('task_id, tasker_id, status, payment_status').eq('customer_id', user.id);
        (bk.data || []).forEach(function (b) {
          if (b.status === 'cancelled') return;
          bookingByJob[String(b.task_id) + '|' + String(b.tasker_id)] = b;
        });
      } catch (e) { /* no payment info */ }
    }

    state.apps = rows.map(function (a) {
      var p = profiles[a.tasker_id] || {}, u = users[a.tasker_id] || {};
      var msg = parseMessage(a.message), task = byTask[a.task_id] || {};
      var name = p.business_name || u.business_name || p.name || u.name || ('Tasker #' + String(a.tasker_id || '').slice(0, 6).toUpperCase());
      return {
        id: a.id, taskerId: a.tasker_id, task: task, status: a.status, group: group(a.status), created: a.created_at,
        name: name, service: p.service || p.service_name || '', location: p.location || '',
        rating: (ratingMap[String(a.tasker_id).toLowerCase()] || {}).avg || null, photo: safeUrl(p.photo_url || u.avatar_url || ''),
        pitch: msg.pitch, arrival: msg.arrival, proofs: msg.proofs, offer: msg.rate != null ? msg.rate : null, offers: offersPerTask[a.task_id] || 0,
        booking: bookingByJob[String(a.task_id) + '|' + String(a.tasker_id)] || null,
      };
    });
    buildTaskOptions();
    /* Arriving from My Tasks (?task=<id>): show only that task's applications */
    var wanted = new URLSearchParams(window.location.search).get('task');
    if (wanted && state.apps.some(function (a) { return String(a.task.id) === wanted; })) {
      state.task = wanted; $('apTask').value = wanted;
    }
    render();
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
    var label = { rejected: 'Declined', closed: 'Closed', completed: 'Completed', cancelled: 'Cancelled' }[a.status];
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
      '<div><div class="ap-fig-label">Your Budget</div><div class="ap-fig-value">' + (t.budget ? naira(t.budget) : 'No budget') + '</div></div>' +
      '<div><div class="ap-fig-label">Their Offer</div><div class="ap-fig-value is-offer">' + (a.offer ? naira(a.offer) : '\u2014') + '</div>' + delta + '</div>' +
      '<div>' + (a.offers > 1 ? '<div class="ap-fig-label">Competition</div><div class="ap-fig-text">' + icon('users') + a.offers + ' offers on this task</div>' : '') + '</div></div>';

    var pitch = a.pitch ? '<div><div class="ap-proposal-head"><span class="ap-fig-label">Their Proposal</span></div><p class="ap-quote">\u201C' + esc(a.pitch) + '\u201D</p></div>' : '';
    var arrival = a.arrival ? '<div><div class="ap-fig-label">Can start</div><div class="ap-fig-text">' + icon('clock') + esc(a.arrival) + '</div></div>' : '';
    var proofs = a.proofs && a.proofs.length ? '<div><div class="ap-fig-label">Previous work</div><div class="ap-proofs">' + a.proofs.map(function (u, i) {
      return '<a class="ap-proof" href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Previous work photo ' + (i + 1) + '" loading="lazy" /></a>';
    }).join('') + '</div></div>' : '';
    var profile = 'tasker-profile.html?id=' + encodeURIComponent(a.taskerId || '') + '&task=' + encodeURIComponent(t.id || '') + '&app=' + encodeURIComponent(a.id);
    var id = esc(a.id);
    var actions = '<div class="ap-actions">';
    if (a.group === 'pending') {
      actions += '<button type="button" class="ap-btn ap-btn-primary" data-act="accept" data-id="' + id + '">Accept Offer</button>' +
        '<a class="ap-btn" href="' + profile + '">View Profile</a>' +
        '<button type="button" class="ap-btn ap-btn-quiet" data-act="decline" data-id="' + id + '">Decline</button>';
    } else if (a.group === 'accepted') {
      actions += '<button type="button" class="ap-btn ap-btn-primary" data-act="message" data-id="' + id + '">' + icon('chat') + 'Message Tasker</button>' +
        '<a class="ap-btn" href="' + profile + '">View Profile</a>';
      /* M5: cancel only before payment (the database enforces it too). After payment: Report a problem in the chat. */
      if (a.status === 'accepted' && window.STOfferCancel && window.STOfferCancel.canCancel(a.booking)) {
        actions += '<button type="button" class="ap-btn ap-btn-quiet" data-act="cancel-offer" data-id="' + id + '">Cancel Accepted Offer</button>';
      }
    } else {
      actions += '<a class="ap-btn" href="' + profile + '">View Profile</a>';
    }
    actions += '</div>';
    var note = '';
    if (a.status === 'cancelled') note = '<div class="ap-fig-text">You cancelled this accepted offer. The chat is closed.</div>';
    else if (a.status === 'accepted' && a.booking && window.STOfferCancel && !window.STOfferCancel.canCancel(a.booking)) {
      note = '<div class="ap-fig-text">Payment has been made, so this offer can no longer be cancelled here. If something is wrong, use Report a problem in the chat.</div>';
    }

    return '<article class="ap-card" data-id="' + esc(a.id) + '"><div class="ap-card-top">' + badge(a) +
      '<span class="ap-meta">' + icon('clock') + 'Applied ' + esc(ago(a.created)) + '</span></div>' +
      '<div class="ap-person">' + avatar + '<div><h2 class="ap-person-name">' + esc(a.name) + (window.STMembership ? window.STMembership.html(a.taskerId, { small: true }) : '') + '</h2><div class="ap-card-sub">' + sub.join('') + '</div></div></div>' +
      '<p class="ap-for">For <strong>' + esc(t.title || 'your task') + '</strong></p>' + figures + pitch + arrival + proofs + note + actions + '</article>';
  }

  function renderMetrics() {
    var a = state.apps, pend = a.filter(function (x) { return x.group === 'pending'; }), tasks = {}, week = 0, low = null;
    pend.forEach(function (x) { tasks[x.task.id] = 1; if (x.offer != null && (low == null || x.offer < low)) low = x.offer; });
    a.forEach(function (x) { if (Date.now() - new Date(x.created).getTime() < 7 * 864e5) week++; });
    var hired = a.filter(function (x) { return x.group === 'accepted'; }).length, declined = a.length - pend.length - hired;
    $('mTotal').textContent = a.length;
    $('mWeek').textContent = week ? '+' + week + ' this week' : '';
    $('mPending').textContent = pend.length;
    $('mTasks').textContent = pend.length ? 'across ' + Object.keys(tasks).length + (Object.keys(tasks).length === 1 ? ' task' : ' tasks') : '';
    $('mLow').textContent = low == null ? '\u2014' : naira(low);
    $('mHired').textContent = hired;
    var bar = $('mBar').children, n = a.length || 1;
    bar[0].style.width = (pend.length / n * 100) + '%'; bar[1].style.width = (hired / n * 100) + '%'; bar[2].style.width = (declined / n * 100) + '%';
    $('mBarText').textContent = pend.length + ' to review \u2022 ' + hired + ' hired \u2022 ' + declined + ' declined';
  }

  function render() {
    renderMetrics();
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
  // Search button (in the hero bar): the list already filters as you type, so this just applies the current text and returns focus
  var searchBtn = $('apSearchBtn');
  if (searchBtn) searchBtn.addEventListener('click', function () { var box = $('apSearch'); state.query = box.value.trim(); reset(); box.focus(); });
  $('apTask').addEventListener('change', function (e) { state.task = e.target.value; reset(); });
  $('apSort').addEventListener('change', function (e) { state.sort = e.target.value; reset(); });
  $('apMore').addEventListener('click', function () { state.shown += PAGE_SIZE; render(); });

  /* ── Actions ──────────────────────────────────────────── */
  var current = null;
  function findApp(id) { return state.apps.filter(function (a) { return String(a.id) === String(id); })[0]; }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function wire(dlg) { dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close(); }); }
  ['apAcceptDlg', 'apDeclineDlg', 'apFirstDlg'].forEach(function (id) { wire($(id)); });

  function openChat(a, firstMsg) {
    if (!a.taskerId) { toast('Cannot open chat \u2014 tasker ID missing.'); return; }
    sessionStorage.setItem('st_chat_context', JSON.stringify({
      contextType: 'task_application', contextId: String(a.id), taskerId: String(a.taskerId), customerId: String(state.user.id) }));
    if (firstMsg) sessionStorage.setItem('st_first_msg', firstMsg);
    window.location.href = 'messages.html';
  }

  $('apList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = findApp(b.getAttribute('data-id')); if (!a) return;
    current = a;
    var act = b.getAttribute('data-act');
    if (act === 'message') { openChat(a); return; }
    if (act === 'cancel-offer') {
      if (!window.STOfferCancel) { toast('Cancelling is not available right now. Please refresh the page.'); return; }
      window.STOfferCancel.open({
        applicationId: a.id, taskerName: a.name, taskTitle: a.task.title || '',
        onDone: function () {
          a.status = 'cancelled'; a.group = 'declined'; a.task.status = 'open';
          render(); toast('Offer cancelled. The chat is closed and your task is open for offers again.');
        }
      });
      return;
    }
    if (act === 'accept') {
      var taken = state.apps.some(function (x) { return x.task.id === a.task.id && x.group === 'accepted'; });
      if (taken) { toast('You already hired someone for this task.'); return; }
      $('apAcSummary').innerHTML = '<strong>' + esc(a.name) + '</strong>for \u201C' + esc(a.task.title || 'your task') + '\u201D' +
        (a.offer ? ' at <b>' + naira(a.offer) + '</b>' : '');
      $('apAcError').hidden = true; $('apAcceptDlg').showModal();
    } else if (act === 'decline') {
      $('apDcText').textContent = a.name + ' will be told their application wasn\u2019t accepted this time. This can\u2019t be undone.';
      $('apDcError').hidden = true; $('apDeclineDlg').showModal();
    }
  });

  $('apAcConfirm').addEventListener('click', async function () {
    var btn = this, a = current, err = $('apAcError'); btn.disabled = true; err.hidden = true;
    try {
      var rpc = await window.supabase.rpc('accept_application', { p_application_id: String(a.id) });
      /* Stage M3: accepting goes only through accept_application; the database refuses direct status changes. */
      if (rpc.error) throw new Error(rpc.error.message);
      a.status = 'accepted'; a.group = 'accepted';
      state.apps.forEach(function (x) { if (x !== a && x.task.id === a.task.id && x.group === 'pending') { x.status = 'closed'; x.group = 'declined'; } });
      a.task.status = 'in_progress';
      $('apAcceptDlg').close(); render();
      $('apFmName').textContent = a.name;
      $('apFmText').value = 'Hi! I accepted your application. When are you available to get started?';
      $('apFirstDlg').showModal();
    } catch (x) { err.textContent = x.message || 'Could not accept this application.'; err.hidden = false; }
    btn.disabled = false;
  });

  $('apDcConfirm').addEventListener('click', async function () {
    var btn = this, a = current, err = $('apDcError'); btn.disabled = true; err.hidden = true;
    try {
      await window.updateApplicationStatus(a.id, 'rejected');          /* also notifies the tasker */
      a.status = 'rejected'; a.group = 'declined';
      $('apDeclineDlg').close(); render(); toast('Application declined.');
    } catch (x) { err.textContent = x.message || 'Could not decline this application.'; err.hidden = false; }
    btn.disabled = false;
  });

  $('apFmSend').addEventListener('click', function () { openChat(current, $('apFmText').value.trim()); });

  load().catch(function (e) { renderError(e && e.message ? e.message : 'Something went wrong.'); });
})();

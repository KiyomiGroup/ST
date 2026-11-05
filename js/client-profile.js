/* ============================================================
   STREETTASKER — client-profile.js
   Public Client (customer) Profile: client-profile.html?id=<auth user id>
   With no id, a signed-in customer sees their own profile.

   Reads:  users (name, bio, location, avatar_url, created_at, is_verified, profile_details jsonb written by
           edit-profile-customer.js), tasks, bookings, task_applications, reviews (only if the table exists).
   Never shows email or any contact detail. Every statistic is computed from rows; nothing is invented, and a
   row or stat with no data hides itself.

   Formulas
     Tasks posted   = the customer's tasks that are not drafts.
     Hire rate      = tasks that led to a hire (in progress, completed, or with a booking) divided by tasks that have
                      been decided (hired + closed/cancelled/expired). Shown once 3 tasks are decided.
     Escrow Funding = started bookings whose payment is in escrow or released, divided by started bookings
                      (started = not pending, declined, cancelled or rejected).
     Dispute Rate   = disputed started bookings divided by started bookings.
     Customer rating= average of reviews written about this user (reviews.reviewee_id), when that table has rows.
   Needs:  supabaseClient.js, sanitize.js (escapeHtml), auth.js, db.js, ui.js (showToast). "Make an Offer" opens make-offer.html?task=<id>.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return escapeHtml(s); };
  var NAIRA = '\u20a6';
  var HISTORY_PAGE = 5;
  var ENDED = ['cancelled', 'canceled', 'closed', 'done', 'expired'];
  var NOT_STARTED = ['pending', 'declined', 'cancelled', 'canceled', 'rejected'];

  var state = { id: null, viewer: null, role: '', isOwner: false, isTasker: false, first: '', name: '', openTasks: [], appliedIds: {}, allTaskIds: [], history: [], histShown: HISTORY_PAGE, posted: 0 };

  /* ── helpers ─────────────────────────────────────────────── */
  function icon(name) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function money(n) { var v = Number(n); return isFinite(v) && v > 0 ? NAIRA + v.toLocaleString('en-NG') : ''; }
  function parseDetails(raw) {
    if (!raw) return {};
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return {}; } }
    return (raw && typeof raw === 'object') ? raw : {};
  }
  function safeUrl(u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'C';
  }
  function shortName(name) {
    var p = text(name).split(/\s+/).filter(Boolean);
    if (!p.length) return '';
    return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0];
  }
  function paras(s) { return text(s).split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function fmtDate(iso, opts) { var d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('en-NG', opts) : ''; }
  function toast(msg) { if (window.showToast) window.showToast(msg); }
  function toLogin() { window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.href); }
  function taskGroup(status) {
    var s = String(status || 'open').toLowerCase();
    if (s === 'completed') return 'completed';
    if (s === 'in_progress') return 'progress';
    if (s === 'draft') return 'draft';
    if (ENDED.indexOf(s) !== -1) return 'closed';
    return 'open';
  }
  function stars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<span class="tp-star' + (i <= Math.round(n) ? ' is-on' : '') + '">' + icon('star') + '</span>';
    return '<span class="tp-stars" role="img" aria-label="' + esc(n) + ' out of 5">' + out + '</span>';
  }
  function closing(deadline) {
    var d = new Date(deadline);
    if (!deadline || isNaN(d)) return '';
    var days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    if (days < 0) return '';
    if (days === 0) return 'Closing today';
    return 'Closing in ' + days + ' day' + (days === 1 ? '' : 's');
  }

  async function currentUser() {
    if (state.viewer) return state.viewer;
    var s = await window.supabase.auth.getSession();
    state.viewer = s.data.session && s.data.session.user;
    return state.viewer;
  }

  function showError(title, msg, href, label) {
    $('cpLoading').hidden = true;
    setText('cpErrorTitle', title); setText('cpErrorText', msg);
    var cta = $('cpErrorCta'); cta.href = href || 'index.html'; cta.textContent = label || 'Back to Home';
    $('cpError').hidden = false;
  }

  /* ── data ────────────────────────────────────────────────── */
  async function loadTasks(sb, id) {
    var r = await sb.from('tasks').select('*').or('customer_id.eq.' + id + ',user_id.eq.' + id).order('created_at', { ascending: false }).limit(200);
    if (r.error) r = await sb.from('tasks').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(200);
    return r.data || [];
  }
  async function loadBookings(sb, id) {
    try {
      var r = await sb.from('bookings').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(500);
      return r.error ? [] : (r.data || []);
    } catch (e) { return []; }
  }
  async function loadReviews(sb, id) {
    try {
      var r = await sb.from('reviews').select('*').eq('reviewee_id', id).order('created_at', { ascending: false }).limit(20);
      if (r.error || !r.data || !r.data.length) return [];
      var ids = r.data.map(function (x) { return x.reviewer_id; }).filter(Boolean);
      var names = {}, svc = {};
      if (ids.length) {
        var us = await sb.from('users').select('id, name, avatar_url').in('id', ids);
        (us.data || []).forEach(function (x) { names[x.id] = x; });
        var ts = await sb.from('taskers').select('user_id, service').in('user_id', ids.map(String));
        (ts.data || []).forEach(function (x) { svc[x.user_id] = x.service; });
      }
      return r.data.map(function (x) {
        var u = names[x.reviewer_id] || {};
        return { name: shortName(x.reviewer_name || u.name), avatar: safeUrl(u.avatar_url), service: text(svc[x.reviewer_id]),
          rating: Number(x.rating) || 0, text: text(x.comment || x.review || x.text), date: x.created_at };
      }).filter(function (x) { return x.text || x.rating; });
    } catch (e) { return []; }
  }
  async function loadBids(sb, taskIds) {
    var out = { counts: {}, mine: {} };
    if (!taskIds.length) return out;
    try {
      var r = await sb.from('task_applications').select('task_id, tasker_id').in('task_id', taskIds).neq('status', 'withdrawn');
      (r.data || []).forEach(function (a) {
        out.counts[a.task_id] = (out.counts[a.task_id] || 0) + 1;
        if (state.viewer && String(a.tasker_id) === String(state.viewer.id)) out.mine[a.task_id] = true;
      });
    } catch (e) { /* blocked by RLS: bid counts stay hidden */ }
    return out;
  }
  async function loadTaskerNames(sb, ids) {
    var names = {};
    if (!ids.length) return names;
    try {
      var us = await sb.from('users').select('id, name').in('id', ids);
      (us.data || []).forEach(function (x) { if (x.name) names[x.id] = x.name; });
      var missing = ids.filter(function (i) { return !names[i]; });
      if (missing.length) {
        var ts = await sb.from('taskers').select('user_id, name, business_name').in('user_id', missing.map(String));
        (ts.data || []).forEach(function (x) { names[x.user_id] = x.name || x.business_name || ''; });
      }
    } catch (e) { /* names are optional */ }
    return names;
  }

  /* ── model ───────────────────────────────────────────────── */
  function computeScore(bookings) {
    var started = bookings.filter(function (b) { return NOT_STARTED.indexOf(String(b.status || '').toLowerCase()) === -1; });
    var funded = started.filter(function (b) { return ['paid', 'released', 'disputed'].indexOf(b.payment_status) !== -1 || b.status === 'completed'; });
    var disputed = started.filter(function (b) { return b.status === 'disputed' || b.payment_status === 'disputed'; });
    var released = started.filter(function (b) { return b.payment_status === 'released' || b.status === 'completed'; });
    return { started: started.length, funded: funded.length, disputed: disputed.length, released: released.length };
  }

  /* ── rendering ───────────────────────────────────────────── */
  function renderHero(u, d, verified, score, joined) {
    state.name = text(u.name) || text(u.business_name) || 'StreetTasker client';
    state.first = state.name.split(/\s+/)[0];
    document.title = state.name + ' \u2014 StreetTasker';

    var av = $('cpAvatar'); av.textContent = '';
    var url = safeUrl(u.avatar_url);
    if (url) {
      var img = document.createElement('img'); img.alt = ''; img.src = url;
      img.addEventListener('error', function () { av.textContent = initials(state.name); });
      av.appendChild(img);
    } else { av.textContent = initials(state.name); }

    setText('cpName', state.name);
    $('cpTick').hidden = !verified;
    var tag = $('cpTag'); tag.textContent = verified ? 'Verified Customer' : ''; tag.hidden = !verified;

    var meta = [];
    if (text(u.location)) meta.push('<span class="cp-meta-item">' + icon('pin') + esc(u.location) + '</span>');
    var since = fmtDate(joined, { month: 'long', year: 'numeric' });
    if (since) meta.push('<span class="cp-meta-item">' + icon('calendar') + 'Member since ' + esc(since) + '</span>');
    var m = $('cpMeta'); m.innerHTML = meta.join('<span class="cp-meta-dot" aria-hidden="true"></span>'); m.hidden = !meta.length;

    var chips = [];
    if (verified) chips.push(['id', 'ID & Bank Verified']);
    if (score.started > 0 && score.funded === score.started) chips.push(['wallet', '100% Escrow Funded']);
    else chips.push(['shield', 'Escrow Protected']);
    $('cpChips').innerHTML = chips.map(function (c) { return '<span class="pp-hero-chip cp-chip">' + icon(c[0]) + esc(c[1]) + '</span>'; }).join('');

    $('cpEdit').hidden = !state.isOwner;
  }

  function renderStats(m) {
    var s = [];
    s.push(['Tasks posted', esc(m.posted), m.completed > 0 ? m.completed + ' completed' : 'On StreetTasker']);
    if (m.open > 0) s.push(['Open now', esc(m.open), 'Taking offers']);
    if (m.hireRate != null) s.push(['Hire rate', esc(m.hireRate) + '%', 'Tasks that led to a hire']);
    if (m.rating > 0) s.push(['Customer rating', esc(m.rating.toFixed(1)) + ' ' + icon('star'), m.reviewCount + ' review' + (m.reviewCount === 1 ? '' : 's')]);
    $('cpStats').innerHTML = s.map(function (x) {
      return '<div class="pp-stat"><span class="pp-stat-label">' + esc(x[0]) + '</span><span class="pp-stat-value">' + x[1] +
        '</span><span class="pp-stat-note">' + esc(x[2]) + '</span></div>';
    }).join('');
  }

  function renderAbout(u, d) {
    var ps = paras(u.bio);
    var cats = list(d.categories).map(text).filter(Boolean).slice(0, 6);
    setText('cpFirst', state.first);
    $('cpBio').innerHTML = ps.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    $('cpCats').innerHTML = cats.map(function (c) { return '<span class="cp-pill cp-pill-cat">' + esc(c) + '</span>'; }).join('');
    $('secAbout').hidden = !(ps.length || cats.length);
    return cats;
  }

  function renderScore(score) {
    var rows = [];
    if (score.started > 0) {
      rows.push(['lock', 'Escrow Funding', score.funded + ' of ' + score.started + ' started job' + (score.started === 1 ? '' : 's') + ' pre-funded', Math.round(score.funded / score.started * 100) + '%']);
      rows.push(['gavel', 'Dispute Rate', score.disputed + ' of ' + score.started + ' job' + (score.started === 1 ? '' : 's') + ' disputed', (score.disputed / score.started * 100).toFixed(1) + '%']);
      if (score.released > 0) rows.push(['wallet', 'Payments Released', 'Funds released after sign-off', String(score.released)]);
    }
    $('cpScoreRows').innerHTML = rows.map(function (r) {
      return '<div class="cp-row"><span class="cp-row-icon">' + icon(r[0]) + '</span><div class="cp-row-body"><strong>' + esc(r[1]) + '</strong><span>' + esc(r[2]) + '</span></div><span class="cp-row-value">' + esc(r[3]) + '</span></div>';
    }).join('');
    setText('cpFirstNote', state.first);
    $('secScore').hidden = !rows.length;
  }

  function renderHiring(tasks, fallbackCats) {
    var counts = {}, total = 0;
    tasks.forEach(function (t) { var c = text(t.category); if (c) { counts[c] = (counts[c] || 0) + 1; total++; } });
    var items = [];
    if (total) {
      var sorted = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
      var top = sorted.slice(0, 3), rest = sorted.slice(3).reduce(function (n, k) { return n + counts[k]; }, 0);
      top.forEach(function (k) { items.push({ name: k, n: counts[k] }); });
      if (rest) items.push({ name: 'Other', n: rest });
      var used = 0;
      items.forEach(function (it, i) {
        it.pct = i === items.length - 1 ? 100 - used : Math.round(it.n / total * 100);
        used += it.pct;
      });
    } else {
      items = fallbackCats.slice(0, 4).map(function (c) { return { name: c, n: 1, pct: null }; });
    }
    var bar = $('cpBar'); bar.textContent = '';
    items.forEach(function (it, i) {
      var seg = document.createElement('span');
      seg.className = 'cp-seg-' + (i % 4);
      seg.style.flexGrow = String(it.n);
      bar.appendChild(seg);
    });
    $('cpLegend').innerHTML = items.map(function (it, i) {
      return '<li><span class="cp-legend-dot cp-seg-' + (i % 4) + '"></span><span class="cp-legend-name">' + esc(it.name) + '</span>' +
        (it.pct != null ? '<span class="cp-legend-pct">' + esc(it.pct) + '%</span>' : '') + '</li>';
    }).join('');
    $('secHiring').hidden = !items.length;
  }

  function renderTasks(bids) {
    var tasks = state.openTasks;
    setText('cpFirstTasks', state.first);
    setText('cpOpenCount', tasks.length + ' Currently Open');
    $('cpTasks').innerHTML = tasks.map(function (t) {
      var desc = text(t.description), cut = desc.length > 140 ? desc.slice(0, 140).trim() + '\u2026' : desc;
      var n = bids.counts[t.id] || 0, when = closing(t.deadline);
      var meta = [];
      if (text(t.category)) meta.push('<span class="cp-badge">' + esc(t.category) + '</span>');
      meta.push('<span>' + icon(when ? 'clock' : 'hourglass') + esc(when || 'Open for offers') + '</span>');
      if (n > 0) meta.push('<span>' + icon('users') + n + ' bid' + (n === 1 ? '' : 's') + ' received</span>');
      var budget = money(t.budget);
      var applied = !!bids.mine[t.id] || !!state.appliedIds[t.id];
      var btn = state.isTasker && !state.isOwner
        ? '<button type="button" class="cp-offer-btn" data-offer="' + esc(t.id) + '"' + (applied ? ' disabled' : '') + '>' + (applied ? 'Offer Sent' : 'Make an Offer') + '</button>' : '';
      return '<article class="cp-task"><div class="cp-task-body"><div class="cp-task-meta">' + meta.join('') + '</div>' +
        '<h3 class="cp-task-title">' + esc(t.title || 'Untitled task') + '</h3>' + (cut ? '<p class="cp-task-desc">' + esc(cut) + '</p>' : '') +
        '<p class="cp-task-foot">' + icon('pin') + esc((text(t.location) || 'Location to be confirmed') + ' \u2022 Escrow Secured') + '</p></div>' +
        '<div class="cp-task-side"><div class="cp-budget"><small>Task Budget</small><strong>' + esc(budget || 'To be agreed') + '</strong></div>' + btn + '</div></article>';
    }).join('');
    $('secTasks').hidden = !tasks.length;
  }

  function renderHistory() {
    var rows = state.history, shown = rows.slice(0, state.histShown);
    $('cpHistory').innerHTML = shown.map(function (h) {
      var bits = [];
      if (h.tasker) bits.push('<span>Tasker: ' + esc(h.tasker) + '</span>');
      var when = fmtDate(h.date, { month: 'short', year: 'numeric' });
      if (when) bits.push('<span>Completed ' + esc(when) + '</span>');
      return '<article class="cp-hist"><span class="cp-hist-icon">' + icon('box') + '</span><div class="cp-hist-body"><strong>' + esc(h.title) + '</strong>' +
        '<div class="cp-hist-meta">' + bits.join('') + '</div></div>' +
        (h.paid ? '<span class="cp-paid">' + icon('circle-check') + 'Paid &amp; Closed</span>' : '') + '</article>';
    }).join('');
    setText('cpHistoryCount', rows.length + ' Past Task' + (rows.length === 1 ? '' : 's'));
    $('cpHistoryMore').hidden = rows.length <= state.histShown;
    $('secHistory').hidden = !rows.length;
  }

  function renderReviews(reviews) {
    if (!reviews.length) { $('secReviews').hidden = true; return; }
    setText('cpFirstReviews', state.first);
    var rated = reviews.filter(function (r) { return r.rating; });
    var pos = $('cpPositive');
    if (rated.length) {
      var share = Math.round(rated.filter(function (r) { return r.rating >= 4; }).length / rated.length * 100);
      pos.innerHTML = icon('thumb') + esc(share) + '% Positive Feedback'; pos.hidden = false;
    } else { pos.hidden = true; }
    $('cpReviews').innerHTML = reviews.map(function (r) {
      var av = r.avatar ? '<img src="' + esc(r.avatar) + '" alt="" loading="lazy" />' : esc(initials(r.name));
      return '<article class="cp-review"><div class="cp-review-top">' + (r.rating ? stars(r.rating) : '<span></span>') +
        '<span class="cp-review-when">' + esc(fmtDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })) + '</span></div>' +
        (r.text ? '<p class="cp-review-text">\u201C' + esc(r.text) + '\u201D</p>' : '') +
        '<div class="cp-review-by"><span class="cp-avatar">' + av + '</span><div><strong>' + esc(r.name || 'StreetTasker tasker') + '</strong>' +
        (r.service ? '<span>' + esc(r.service) + '</span>' : '') + '</div></div></article>';
    }).join('');
    $('secReviews').hidden = false;
  }

  function syncEmpty() {
    var any = ['secAbout', 'secTasks', 'secHistory', 'secReviews'].some(function (id) { return !$(id).hidden; });
    $('secEmpty').hidden = any;
    if (any) return;
    setText('cpEmptyTitle', state.isOwner ? 'Your profile is almost empty' : state.first + ' is still setting up');
    setText('cpEmptyText', state.isOwner
      ? 'Add a short bio and how you like to work so taskers know what to expect before they make an offer.'
      : 'This client has not added profile details yet.');
    $('cpEmptyCta').hidden = !state.isOwner;
  }

  function renderActions() {
    var barTasks = $('cpBarTasks');
    setText('cpBarTasksLabel', 'All Tasks (' + state.posted + ')');
    barTasks.hidden = state.posted === 0;
    $('cpActionbar').hidden = state.isOwner || state.posted === 0;
  }

  /* ── actions ─────────────────────────────────────────────── */
  function scrollToTasks() {
    var target = !$('secTasks').hidden ? $('secTasks') : (!$('secHistory').hidden ? $('secHistory') : null);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function shareProfile() {
    var url = window.location.origin + window.location.pathname + '?id=' + encodeURIComponent(state.id);
    if (navigator.share) {
      try { await navigator.share({ title: state.name + ' \u2014 StreetTasker', text: 'Client profile on StreetTasker', url: url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('Profile link copied'); }
    catch (e) { toast(url); }
  }

  function wire() {
    $('cpShare').addEventListener('click', shareProfile);
    $('cpBarTasks').addEventListener('click', scrollToTasks);
    $('cpHistoryMore').addEventListener('click', function () { state.histShown += HISTORY_PAGE; renderHistory(); });

    $('cpBack').addEventListener('click', function (e) {
      if (window.history.length > 1 && document.referrer && document.referrer.indexOf(window.location.origin) === 0) { e.preventDefault(); window.history.back(); }
    });

    $('cpTasks').addEventListener('click', async function (e) {
      var b = e.target.closest('[data-offer]'); if (!b || b.disabled) return;
      var user = await currentUser();
      if (!user) return toLogin();
      window.location.href = 'make-offer.html?task=' + encodeURIComponent(b.getAttribute('data-offer'));
    });
  }

  /* ── load ────────────────────────────────────────────────── */
  async function loadProfile(id) {
    var sb = window.supabase;
    var ur = await sb.from('users').select('*').eq('id', id).maybeSingle();
    var u = ur.data;
    if (!u) return showError('Profile unavailable', 'This profile may have been removed, or you may not have access to it.', 'index.html', 'Back to Home');
    if (String(u.role || '').toLowerCase() === 'tasker') { window.location.replace('tasker-profile.html?id=' + encodeURIComponent(id)); return; }

    var res = await Promise.all([loadTasks(sb, id), loadBookings(sb, id), loadReviews(sb, id)]);
    var tasks = res[0], bookings = res[1], reviews = res[2];
    var d = parseDetails(u.profile_details);

    var real = tasks.filter(function (t) { return taskGroup(t.status) !== 'draft'; });
    state.posted = real.length;
    state.allTaskIds = tasks.map(function (t) { return t.id; });
    state.openTasks = real.filter(function (t) { return taskGroup(t.status) === 'open'; }).slice(0, 10);

    var bookedTaskIds = {};
    bookings.forEach(function (b) { if (b.task_id && NOT_STARTED.indexOf(String(b.status || '').toLowerCase()) === -1) bookedTaskIds[b.task_id] = true; });
    var hired = real.filter(function (t) { var g = taskGroup(t.status); return g === 'progress' || g === 'completed' || bookedTaskIds[t.id]; }).length;
    var closed = real.filter(function (t) { return taskGroup(t.status) === 'closed' && !bookedTaskIds[t.id]; }).length;
    var decided = hired + closed;

    var score = computeScore(bookings);
    var verified = u.is_verified === true;
    var joined = u.created_at || (state.isOwner && state.viewer && state.viewer.created_at) || '';
    var rated = reviews.filter(function (r) { return r.rating; });
    var model = {
      posted: real.length, open: state.openTasks.length,
      completed: real.filter(function (t) { return taskGroup(t.status) === 'completed'; }).length,
      hireRate: decided >= 3 ? Math.round(hired / decided * 100) : null,
      rating: rated.length ? rated.reduce(function (n, r) { return n + r.rating; }, 0) / rated.length : 0, reviewCount: rated.length
    };

    /* completed history: completed bookings first (they know the tasker), then completed tasks without a booking */
    var taskById = {}; tasks.forEach(function (t) { taskById[t.id] = t; });
    var doneBookings = bookings.filter(function (b) { return b.status === 'completed' || b.payment_status === 'released'; });
    var names = await loadTaskerNames(sb, doneBookings.map(function (b) { return b.tasker_id; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }));
    var rows = doneBookings.map(function (b) {
      var t = taskById[b.task_id] || {};
      return { title: text(t.title) || 'Completed task', tasker: shortName(names[b.tasker_id]), date: b.completed_at || b.updated_at || b.created_at, paid: true, tid: b.task_id };
    });
    var seen = {}; rows.forEach(function (r) { if (r.tid) seen[r.tid] = true; });
    real.forEach(function (t) {
      if (taskGroup(t.status) === 'completed' && !seen[t.id]) rows.push({ title: text(t.title) || 'Completed task', tasker: '', date: t.updated_at || t.created_at, paid: false });
    });
    rows.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
    state.history = rows;

    renderHero(u, d, verified, score, joined);
    renderStats(model);
    var cats = renderAbout(u, d);
    renderScore(score);
    renderHiring(real, list(d.categories).map(text).filter(Boolean));
    renderHistory();
    renderReviews(reviews);

    $('cpLoading').hidden = true;
    $('cpContent').hidden = false;

    /* Bids arrive after first paint: counts and "Offer Sent" need a second query */
    var bids = { counts: {}, mine: {} };
    renderTasks(bids);
    renderActions();
    syncEmpty();
    loadBids(sb, state.openTasks.map(function (t) { return t.id; })).then(function (b) { renderTasks(b); });
    void cats;
  }

  async function roleOf(user) {
    var r = '';
    try { r = localStorage.getItem('st_role') || ''; } catch (e) { /* storage blocked */ }
    if (r) return r;
    try { var q = await window.supabase.from('users').select('role').eq('id', user.id).maybeSingle(); return (q.data && q.data.role) || ''; }
    catch (e) { return ''; }
  }

  async function init() {
    wire();
    try {
      var user = await currentUser();
      if (!user) return toLogin();
      state.role = await roleOf(user);
      state.id = new URLSearchParams(window.location.search).get('id');
      if (!state.id && state.role !== 'tasker') state.id = user.id;
      if (!state.id) return showError('Client not found', 'This profile link is incomplete.', 'my-tasks.html', 'Back to Tasks');
      state.isOwner = String(user.id) === String(state.id);
      state.isTasker = state.role === 'tasker';
      await loadProfile(state.id);
    } catch (err) {
      console.error('[client-profile]', err);
      showError('Profile unavailable', 'Something went wrong while loading this profile. Please try again.', 'index.html', 'Back to Home');
    }
  }

  init();
})();

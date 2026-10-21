/* ============================================================
   STREETTASKER — make-offer.js
   Make an Offer page: make-offer.html?task=<task id>
   (?id=<task id> also works). Replaces the small offer pop-up.

   Stage 1 (this file): load the task, check the viewer may make an offer,
   fill the title block and the task summary.
   Later stages add, in order: amount + fee, pitch, availability, proof,
   submit, edit mode, and the links from the task page and client profile.

   Reads:  tasks (the row), users (the customer), reviews (their rating, if the table exists),
           task_applications (has this tasker already made an offer?).
   Nothing is invented. A section or figure with no data hides itself.
   Needs: supabaseClient.js, sanitize.js (escapeHtml), auth.js, db.js, ui.js, app.js.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return escapeHtml(s); };
  var NAIRA = '\u20a6';
  var ENDED = ['cancelled', 'canceled', 'closed', 'done', 'expired'];
  var MAX_SPECS = 5;

  var state = { id: null, task: null, viewer: null, isTasker: false, posterId: null, poster: null, rating: null, myApplication: null };

  /* ── helpers ─────────────────────────────────────────────── */
  function icon(name) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function money(n) { var v = Number(n); return isFinite(v) && v > 0 ? NAIRA + v.toLocaleString('en-NG') : ''; }
  function safeUrl(u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; }
  function label(v) { return String(v || '').replace(/[_-]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'ST';
  }
  function shortName(name) {
    var p = text(name).split(/\s+/).filter(Boolean);
    if (!p.length) return '';
    return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0];
  }
  function fmtDate(iso, opts) { var d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('en-NG', opts) : ''; }
  function parseList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) { try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
    return [];
  }
  function taskGroup(status) {
    var s = String(status || 'open').toLowerCase();
    if (s === 'completed') return 'completed';
    if (s === 'in_progress') return 'progress';
    if (s === 'draft') return 'draft';
    if (ENDED.indexOf(s) !== -1) return 'closed';
    return 'open';
  }
  function toLogin() { window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname.replace(/^\//, '') + window.location.search); }
  function taskUrl() { return 'task-details.html?id=' + encodeURIComponent(state.id); }

  async function currentUser() {
    if (state.viewer) return state.viewer;
    var s = await window.supabase.auth.getSession();
    state.viewer = s.data.session && s.data.session.user;
    return state.viewer;
  }
  async function roleOf(user) {
    var r = '';
    try { r = localStorage.getItem('st_role') || ''; } catch (e) { /* storage blocked */ }
    if (r) return r;
    try { var q = await window.supabase.from('users').select('role').eq('id', user.id).maybeSingle(); return (q.data && q.data.role) || ''; }
    catch (e) { return ''; }
  }
  function showError(title, msg, href, lab) {
    $('moLoading').hidden = true;
    $('moContent').hidden = true;
    setText('moErrorTitle', title); setText('moErrorText', msg);
    var cta = $('moErrorCta'); cta.href = href || 'find-tasks.html'; cta.textContent = lab || 'Browse Tasks';
    $('moError').hidden = false;
  }

  /* ── data ────────────────────────────────────────────────── */
  async function loadMyApplication(sb, taskId, user) {
    try {
      var r = await sb.from('task_applications').select('id, status, message').eq('task_id', taskId).eq('tasker_id', user.id).limit(1);
      return (r.data && r.data[0]) || null;
    } catch (e) { return null; }
  }
  async function loadRating(sb, posterId) {
    try {
      var v = await sb.from('reviews').select('rating').eq('reviewee_id', posterId).limit(200);
      var rows = (v.error ? [] : (v.data || [])).filter(function (x) { return Number(x.rating) > 0; });
      if (!rows.length) return null;
      return { avg: rows.reduce(function (n, r) { return n + Number(r.rating); }, 0) / rows.length, count: rows.length };
    } catch (e) { return null; }
  }

  /* ── rendering ───────────────────────────────────────────── */
  function renderHead(t) {
    var badges = [], urgency = String(t.urgency || '').toLowerCase();
    if (text(t.category)) badges.push('<span class="td-badge td-badge--open">' + icon('check') + esc(label(t.category)) + '</span>');
    if (urgency === 'immediate' || t.urgent === true) badges.push('<span class="td-badge td-badge--urgent">Urgent Need</span>');
    else if (urgency === 'scheduled') badges.push('<span class="td-badge td-badge--soft">Scheduled</span>');
    $('moBadges').innerHTML = badges.join('');
    $('moBadges').hidden = !badges.length;

    var title = text(t.title) || 'Untitled task';
    setText('moTitle', 'Apply for Task: ' + title);
    setText('moSumTitle', title);
    document.title = 'Make an Offer: ' + title + ' \u2014 StreetTasker';

    var remote = String(t.work_mode || t.task_type || '').toLowerCase() === 'remote';
    var chips = [];
    var budget = money(t.budget);
    chips.push('<span class="mo-chip mo-chip--primary">' + icon('wallet') + 'Client budget: ' + esc(budget || 'To be agreed') + '</span>');
    chips.push('<span class="mo-chip">' + icon('shield') + 'Escrow protected</span>');
    if (remote) chips.push('<span class="mo-chip">' + icon('globe') + 'Remote</span>');
    else if (text(t.location)) chips.push('<span class="mo-chip">' + icon('pin') + esc(text(t.location)) + '</span>');
    if (t.deadline) {
      var when = fmtDate(t.deadline, { day: 'numeric', month: 'short' });
      if (when) chips.push('<span class="mo-chip">' + icon('calendar') + 'Due ' + esc(when) + '</span>');
    }
    $('moChips').innerHTML = chips.join('');

    var back = taskUrl();
    $('moBack').href = back; $('moClose').href = back;
  }

  function renderSummary(t) {
    var urls = list(t.photo_urls).map(function (u) { return safeUrl(text(u)); }).filter(Boolean);
    var photo = $('moPhoto');
    photo.hidden = !urls.length;
    if (urls.length) { $('moPhotoImg').src = urls[0]; $('moPhotoImg').alt = ''; }

    var remote = String(t.work_mode || t.task_type || '').toLowerCase() === 'remote';
    var loc = remote ? 'Remote' : text(t.location);
    $('moLoc').hidden = !loc;
    setText('moLocText', loc);

    /* Specifications: the bullet or numbered lines of the description, then what the customer provides */
    var items = [];
    text(t.description).split(/\r?\n/).forEach(function (raw) {
      var m = raw.trim().match(/^(?:[-\u2022*\u25AA\u25CF]|\d+[.)])\s+(.*)$/);
      if (m && m[1]) items.push(m[1].trim());
    });
    parseList(t.host_provides).map(text).filter(Boolean).forEach(function (x) { items.push(x + ' provided'); });
    items = items.map(function (s) { return s.length > 90 ? s.slice(0, 90).trim() + '\u2026' : s; }).slice(0, MAX_SPECS);
    $('moSpecsWrap').hidden = !items.length;
    $('moSpecs').innerHTML = items.map(function (s) { return '<li>' + icon('circle-check') + '<span>' + esc(s) + '</span></li>'; }).join('');
  }

  function renderWho(u) {
    var name = text(u && u.name) || text(u && u.business_name) || 'StreetTasker customer';
    var verified = !!(u && u.is_verified === true);
    var url = safeUrl(text(u && u.avatar_url));
    var av = url ? '<img src="' + esc(url) + '" alt="" />' : esc(initials(name));
    var meta = [];
    if (state.rating) meta.push(icon('star') + '<b>' + state.rating.avg.toFixed(1) + '</b>');
    if (text(u && u.location)) meta.push(esc(text(u.location)));
    var html = '<div class="td-avatar-wrap"><span class="td-avatar" aria-hidden="true">' + av + '</span>' +
      (verified ? '<span class="td-avatar-tick">' + icon('check') + '</span>' : '') + '</div>' +
      '<div class="mo-who-text"><p class="mo-who-name">' + esc(shortName(name)) + '<span class="td-tag">Customer</span></p>' +
      (meta.length ? '<p class="mo-who-meta">' + meta.join('<span aria-hidden="true">\u2022</span>') + '</p>' : '') + '</div>';
    $('moWhoPhone').innerHTML = html; $('moWhoCard').innerHTML = html;
  }

  /* ── load ────────────────────────────────────────────────── */
  async function load() {
    var sb = window.supabase;
    var r = await sb.from('tasks').select('*').eq('id', state.id).maybeSingle();
    var t = r.data;
    if (r.error || !t) return showError('Task not found', 'This task may have been removed, or the link is incomplete.', 'find-tasks.html', 'Browse Tasks');
    state.task = t;
    state.posterId = t.customer_id || t.user_id || null;
    var back = taskUrl();

    if (state.posterId && String(state.viewer.id) === String(state.posterId)) {
      return showError('This is your task', 'Offers are made by taskers. You can review the offers you receive from My Tasks.', 'my-tasks.html', 'Go to My Tasks');
    }
    if (!state.isTasker) {
      return showError('Switch to a tasker account', 'Offers are made by taskers. Switch to your tasker account to apply for this task.', back, 'Back to Task Details');
    }
    if (taskGroup(t.status) !== 'open') {
      return showError('No longer taking offers', 'This task is no longer open, so new offers cannot be sent.', back, 'Back to Task Details');
    }

    var results = await Promise.all([
      state.posterId ? sb.from('users').select('*').eq('id', state.posterId).maybeSingle().then(function (x) { return x.data; }, function () { return null; }) : Promise.resolve(null),
      state.posterId ? loadRating(sb, state.posterId) : Promise.resolve(null),
      loadMyApplication(sb, t.id, state.viewer)
    ]);
    state.poster = results[0]; state.rating = results[1]; state.myApplication = results[2];

    /* Already offered: the edit mode for this arrives in a later stage */
    if (state.myApplication) {
      return showError('You have already sent an offer', 'Your offer for this task is waiting for the customer. You can follow it from My Applications.', 'applications.html', 'View My Applications');
    }

    renderHead(t); renderSummary(t); renderWho(state.poster);

    $('moLoading').hidden = true;
    $('moContent').hidden = false;
  }

  async function init() {
    try {
      var q = new URLSearchParams(window.location.search);
      state.id = text(q.get('task') || q.get('id'));
      if (!state.id) return showError('Task not found', 'This offer link is incomplete.', 'find-tasks.html', 'Browse Tasks');
      var user = await currentUser();
      if (!user) return toLogin();
      state.isTasker = (await roleOf(user)) === 'tasker';
      await load();
    } catch (err) {
      console.error('[make-offer]', err);
      showError('Offer unavailable', 'Something went wrong while loading this page. Please try again.', 'find-tasks.html', 'Browse Tasks');
    }
  }

  init();
})();

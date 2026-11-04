/* ============================================================
   STREETTASKER — task-details.js
   Task Details page: task-details.html?id=<task id>
   Opened from every "View Task" button.

   Reads:  tasks (the row), users (the poster), the poster's other tasks, bookings and reviews (for the
           customer summary), task_applications + taskers (offers on this task).
   Nothing is invented. A section or figure with no data hides itself:
     - Photos            only when the task has photo_urls.
     - Checklist         only when the description has bullet or numbered lines.
     - Payment milestones only when the task row has a `milestones` list.
     - Supplies          only when the task row has `tasker_brings` or `host_provides`.
     - Offers            only when row permissions let this viewer read them.
     - Distance          only when the task row has distance_km.
   Customer summary formulas are the same as client-profile.js:
     Hire rate = tasks that led to a hire / tasks that were decided. Shown once 3 tasks are decided.
   Needs: supabaseClient.js, sanitize.js (escapeHtml), auth.js, db.js (ST.db.applyToTask), ui.js (showToast, stAgo).
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return escapeHtml(s); };
  var NAIRA = '\u20a6';
  var OFFERS_SHOWN = 3;
  var SAVED_KEY = 'st_saved_task_ids';
  var ENDED = ['cancelled', 'canceled', 'closed', 'done', 'expired'];
  var NOT_STARTED = ['pending', 'declined', 'cancelled', 'canceled', 'rejected'];

  var state = {
    id: null, task: null, viewer: null, role: '', isOwner: false, isTasker: false,
    posterId: null, poster: null, photos: [], photoIdx: 0, lbIdx: 0,
    offers: [], offersReadable: false, offersExpanded: false, myApplication: null
  };

  /* ── helpers ─────────────────────────────────────────────── */
  function icon(name) { return '<svg class="ap-i" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function money(n) { var v = Number(n); return isFinite(v) && v > 0 ? NAIRA + v.toLocaleString('en-NG') : ''; }
  function safeUrl(u) { return /^(https?:)?\/\//.test(u || '') || /^\/?[\w.\-\/]+$/.test(u || '') ? u : ''; }
  function initials(name) {
    var s = String(name || '').replace(/[^a-zA-Z ]/g, '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    return s || 'ST';
  }
  function shortName(name) {
    var p = text(name).split(/\s+/).filter(Boolean);
    if (!p.length) return '';
    return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0].toUpperCase() + '.' : p[0];
  }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function fmtDate(iso, opts) { var d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('en-NG', opts) : ''; }
  function toast(msg) { if (window.showToast) window.showToast(msg); }
  function toLogin() { window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname.replace(/^\//, '') + window.location.search); }
  function label(v) { return String(v || '').replace(/[_-]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function ago(iso) { return (typeof stAgo === 'function') ? stAgo(iso) : ''; }
  function taskGroup(status) {
    var s = String(status || 'open').toLowerCase();
    if (s === 'completed') return 'completed';
    if (s === 'in_progress') return 'progress';
    if (s === 'draft') return 'draft';
    if (ENDED.indexOf(s) !== -1) return 'closed';
    return 'open';
  }
  function parseMessage(msg) {
    var t = String(msg || '');
    var m = t.match(/\|\s*Proposed rate:\s*([^|]+)/i);
    var rate = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : NaN;
    return { pitch: t.replace(/\|\s*Proposed rate:.*$/i, '').trim(), rate: isNaN(rate) ? null : rate };
  }
  function parseList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) { try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
    return [];
  }
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
    $('tdLoading').hidden = true;
    setText('tdErrorTitle', title); setText('tdErrorText', msg);
    var cta = $('tdErrorCta'); cta.href = href || 'find-tasks.html'; cta.textContent = lab || 'Browse Tasks';
    $('tdError').hidden = false;
  }
  function shareUrl() { return window.location.origin + window.location.pathname + '?id=' + encodeURIComponent(state.id); }

  /* ── data ────────────────────────────────────────────────── */
  async function loadPosterStats(sb, posterId) {
    var out = { tasks: [], bookings: [], reviews: [] };
    try {
      var r = await sb.from('tasks').select('id, status').or('customer_id.eq.' + posterId + ',user_id.eq.' + posterId).limit(200);
      if (r.error) r = await sb.from('tasks').select('id, status').eq('user_id', posterId).limit(200);
      out.tasks = r.data || [];
    } catch (e) { /* hidden */ }
    try {
      var b = await sb.from('bookings').select('task_id, status').eq('customer_id', posterId).limit(500);
      out.bookings = b.error ? [] : (b.data || []);
    } catch (e) { /* hidden */ }
    try {
      var v = await sb.from('reviews').select('rating').eq('reviewee_id', posterId).limit(200);
      out.reviews = (v.error ? [] : (v.data || [])).filter(function (x) { return Number(x.rating) > 0; });
    } catch (e) { /* hidden */ }
    return out;
  }

  async function loadOffers(sb, taskId) {
    var res = { readable: false, rows: [] };
    try {
      var r = await sb.from('task_applications').select('*').eq('task_id', taskId).neq('status', 'withdrawn').order('created_at', { ascending: false }).limit(50);   /* withdrawn offers are kept but not shown */
      if (r.error) return res;
      res.readable = true;
      var rows = r.data || [];
      var ids = rows.map(function (a) { return a.tasker_id; }).filter(Boolean).map(String);
      var byId = {};
      if (ids.length) {
        try {
          var t = await sb.from('taskers').select('user_id, name, business_name, rating, photo_url').in('user_id', ids);
          (t.data || []).forEach(function (x) { byId[String(x.user_id)] = x; });
        } catch (e) { /* names stay generic */ }
        var missing = ids.filter(function (i) { return !byId[i]; });
        if (missing.length) {
          try {
            var u = await sb.from('users').select('id, name, avatar_url').in('id', missing);
            (u.data || []).forEach(function (x) { byId[String(x.id)] = { name: x.name, photo_url: x.avatar_url }; });
          } catch (e) { /* names stay generic */ }
        }
      }
      res.rows = rows.map(function (a) {
        var tk = byId[String(a.tasker_id)] || {}, p = parseMessage(a.message);
        return {
          id: a.id, taskerId: a.tasker_id, name: text(tk.business_name) || text(tk.name) || 'StreetTasker tasker',
          photo: safeUrl(text(tk.photo_url)), rating: Number(tk.rating) || 0, pitch: p.pitch, rate: p.rate, status: a.status,
          mine: !!(state.viewer && String(a.tasker_id) === String(state.viewer.id))
        };
      });
    } catch (e) { /* blocked by row permissions: offers stay hidden */ }
    return res;
  }

  async function loadMyApplication(sb, taskId, user) {
    if (!user) return null;
    try {
      var r = await sb.from('task_applications').select('id, status').eq('task_id', taskId).eq('tasker_id', user.id).neq('status', 'withdrawn').limit(1);   /* a withdrawn offer means "not applied": the tasker can send it again */
      return (r.data && r.data[0]) || null;
    } catch (e) { return null; }
  }

  /* ── rendering ───────────────────────────────────────────── */
  function renderHead(t) {
    var group = taskGroup(t.status), badges = [];
    if (group === 'open') badges.push('<span class="td-badge td-badge--open"><span class="td-dot"></span>Open for Offers</span>');
    else badges.push('<span class="td-badge td-badge--closed">' + esc(group === 'progress' ? 'In Progress' : label(group)) + '</span>');
    var urgency = String(t.urgency || '').toLowerCase();
    if (urgency === 'immediate' || t.urgent === true) badges.push('<span class="td-badge td-badge--urgent">Urgent Need</span>');
    else if (urgency === 'scheduled') badges.push('<span class="td-badge td-badge--soft">Scheduled</span>');
    if (text(t.category)) badges.push('<span class="td-badge td-badge--soft">' + esc(label(t.category)) + '</span>');
    var posted = ago(t.created_at);
    if (posted) badges.push('<span class="td-posted">' + icon('clock') + 'Posted ' + esc(posted) + '</span>');
    $('tdBadges').innerHTML = badges.join('');
    setText('tdTitle', text(t.title) || 'Untitled task');
    document.title = (text(t.title) || 'Task') + ' \u2014 StreetTasker';

    var remote = String(t.work_mode || t.task_type || '').toLowerCase() === 'remote';
    var when = '';
    if (t.deadline) {
      when = fmtDate(t.deadline, { weekday: 'short', day: 'numeric', month: 'short' });
      var tod = text(t.time_of_day);
      if (tod && tod !== 'anytime') when += ' (' + label(tod) + ')';
    }
    var facts = [
      [remote ? 'globe' : 'pin', remote ? 'Where' : 'Area', remote ? 'Remote' : (text(t.location) || 'To be confirmed')],
      ['calendar', 'Date', when || 'Flexible'],
      [remote ? 'globe' : 'wrench', 'Type', remote ? 'Remote' : 'In person']
    ];
    $('tdFacts').innerHTML = facts.map(function (f) {
      return '<div class="td-fact">' + icon(f[0]) + '<div><dt>' + esc(f[1]) + '</dt><dd>' + esc(f[2]) + '</dd></div></div>';
    }).join('');
  }

  /* Photos: main picture, thumbnail strip, full screen viewer */
  function renderPhotos(t) {
    var urls = list(t.photo_urls).map(function (u) { return safeUrl(text(u)); }).filter(Boolean);
    var labels = list(t.photo_labels);
    state.photos = urls.map(function (u, i) { return { url: u, label: text(labels[i]) }; });
    $('secPhotos').hidden = !state.photos.length;
    if (!state.photos.length) return;
    setText('tdPhotoHint', state.photos.length + (state.photos.length === 1 ? ' photo' : ' photos'));
    $('tdThumbs').innerHTML = state.photos.map(function (p, i) {
      return '<button type="button" role="listitem" class="td-thumb" data-photo="' + i + '" aria-label="Show photo ' + (i + 1) + '"><img src="' + esc(p.url) + '" alt="" loading="lazy" /></button>';
    }).join('');
    showPhoto(0);
  }
  function showPhoto(i) {
    var n = state.photos.length; if (!n) return;
    state.photoIdx = (i + n) % n;
    var p = state.photos[state.photoIdx];
    var img = $('tdStageImg'); img.src = p.url; img.alt = p.label || ('Task photo ' + (state.photoIdx + 1));
    $('tdStageCount').lastElementChild.textContent = (state.photoIdx + 1) + ' / ' + n;
    var lab = $('tdStageLabel'); lab.textContent = p.label; lab.hidden = !p.label;
    Array.prototype.forEach.call($('tdThumbs').children, function (b, k) { b.classList.toggle('is-active', k === state.photoIdx); });
  }
  function openLightbox(i) {
    var n = state.photos.length; if (!n) return;
    state.lbIdx = (i + n) % n;
    var p = state.photos[state.lbIdx];
    $('tdLbImg').src = p.url; $('tdLbImg').alt = p.label || ('Task photo ' + (state.lbIdx + 1));
    setText('tdLbTitle', p.label || 'Task photo');
    setText('tdLbMeta', (state.lbIdx + 1) + ' of ' + n);
    $('tdLbPrev').hidden = $('tdLbNext').hidden = n < 2;
    var dlg = $('tdLightbox');
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }

  /* Description: paragraphs, and bullet or numbered lines become the Key Requirements checklist */
  function renderScope(t) {
    var lines = text(t.description).split(/\r?\n/), paras = [], buf = [], items = [];
    function flush() { if (buf.length) { paras.push(buf.join(' ')); buf = []; } }
    lines.forEach(function (raw) {
      var line = raw.trim(), m = line.match(/^(?:[-\u2022*\u25AA\u25CF]|\d+[.)])\s+(.*)$/);
      if (!line) { flush(); return; }
      if (m && m[1]) { flush(); items.push(m[1].trim()); return; }
      buf.push(line);
    });
    flush();
    /* A lone "Key checklist:" style lead-in line before the bullets adds nothing */
    if (items.length >= 2) paras = paras.filter(function (p) { return !/^(key\s+)?(requirements|checklist)\s*:?$/i.test(p); });
    else if (items.length === 1) { paras.push(items[0]); items = []; }
    $('tdProse').innerHTML = paras.length ? paras.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') : '<p class="td-muted">The poster has not added a description yet.</p>';
    $('tdChecklistWrap').hidden = !items.length;
    $('tdChecks').innerHTML = items.map(function (it) {
      var m = it.match(/^([^:]{2,48}):\s+(.+)$/);
      var body = m ? '<strong>' + esc(m[1]) + '</strong><span>' + esc(m[2]) + '</span>' : '<span>' + esc(it) + '</span>';
      return '<li class="td-check">' + icon('circle-check') + '<div>' + body + '</div></li>';
    }).join('');

    var brings = parseList(t.tasker_brings).map(text).filter(Boolean), host = parseList(t.host_provides).map(text).filter(Boolean);
    var box = $('tdLogistics'), html = '';
    if (brings.length) html += '<div class="td-logi"><h3 class="td-h3">' + icon('wrench') + 'Tasker brings</h3><ul>' + brings.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    if (host.length) html += '<div class="td-logi"><h3 class="td-h3">' + icon('users') + 'Provided by the customer</h3><ul>' + host.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    box.innerHTML = html; box.hidden = !html;
  }

  function renderMilestones(t) {
    var ms = parseList(t.milestones).map(function (m) {
      return { title: text(m && (m.title || m.name)), desc: text(m && (m.description || m.desc)), amount: Number(m && m.amount) };
    }).filter(function (m) { return m.title; });
    $('secMilestones').hidden = !ms.length;
    if (!ms.length) return;
    setText('tdMilestoneCount', ms.length + (ms.length === 1 ? ' step' : ' steps'));
    $('tdMilestones').innerHTML = ms.map(function (m, i) {
      return '<li class="td-step"><span class="td-step-n">' + (i + 1) + '</span><div class="td-step-body"><strong>' + esc(m.title) + '</strong>' +
        (m.desc ? '<span>' + esc(m.desc) + '</span>' : '') + '</div>' + (m.amount > 0 ? '<span class="td-step-amt">' + esc(money(m.amount)) + '</span>' : '') + '</li>';
    }).join('');
  }

  function renderLocation(t) {
    var remote = String(t.work_mode || t.task_type || '').toLowerCase() === 'remote';
    $('secLocation').hidden = remote;
    if (remote) return;
    setText('tdAreaText', text(t.location) || 'Location to be confirmed');
    var d = Number(t.distance_km), el = $('tdDistance');
    el.hidden = !(typeof t.distance_km === 'number' && isFinite(d));
    if (!el.hidden) el.textContent = d.toFixed(1) + ' km from you';
  }

  function renderOffers() {
    var sec = $('secOffers'), rows = state.offers;
    sec.hidden = !state.offersReadable;
    if (!state.offersReadable) return;
    setText('tdOfferCount', String(rows.length));
    var shown = state.offersExpanded ? rows : rows.slice(0, OFFERS_SHOWN);
    $('tdOffers').innerHTML = shown.map(function (o) {
      var av = o.photo ? '<img src="' + esc(o.photo) + '" alt="" />' : esc(initials(o.name));
      var pitch = o.pitch.length > 180 ? o.pitch.slice(0, 180).trim() + '\u2026' : o.pitch;
      var meta = [];
      if (o.rating > 0) meta.push('<span class="td-rate">' + icon('star') + o.rating.toFixed(1) + '</span>');
      if (o.mine) meta.push('<span class="td-badge td-badge--soft">Your offer</span>');
      return '<article class="td-offer"><div class="td-offer-top"><span class="td-avatar td-avatar-sm" aria-hidden="true">' + av + '</span>' +
        '<div class="td-offer-who"><strong>' + esc(o.name) + '</strong><div class="td-offer-meta">' + meta.join('') + '</div></div>' +
        (o.rate != null ? '<div class="td-offer-amt"><strong>' + esc(money(o.rate)) + '</strong>' + (state.task && Number(state.task.budget) > 0 && o.rate === Number(state.task.budget) ? '<span>Matches budget</span>' : '') + '</div>' : '') +
        '</div>' + (pitch ? '<p class="td-offer-pitch">' + esc(pitch) + '</p>' : '') + '</article>';
    }).join('');
    var empty = $('tdOffersEmpty');
    empty.hidden = rows.length > 0;
    if (!rows.length) empty.textContent = state.isOwner ? 'No offers yet. Taskers near you have been notified.' : 'No offers yet. Be the first to make one.';
    var more = $('tdOffersMore');
    more.hidden = rows.length <= OFFERS_SHOWN;
    more.textContent = state.offersExpanded ? 'Show fewer offers' : 'View all ' + rows.length + ' offers';
  }

  /* Customer card + the "About the Customer" numbers */
  function renderPoster(u, stats) {
    var name = text(u && u.name) || text(u && u.business_name) || 'StreetTasker customer';
    var verified = !!(u && u.is_verified === true);
    var av = $('tdAvatar'); av.textContent = '';
    var url = safeUrl(text(u && u.avatar_url));
    if (url) {
      var img = document.createElement('img'); img.alt = ''; img.src = url;
      img.addEventListener('error', function () { av.textContent = initials(name); });
      av.appendChild(img);
    } else av.textContent = initials(name);
    $('tdAvatarTick').hidden = !verified;
    setText('tdPosterName', shortName(name));

    var meta = [];
    if (text(u && u.location)) meta.push(esc(u.location));
    var since = fmtDate(u && u.created_at, { month: 'long', year: 'numeric' });
    if (since) meta.push('Member since ' + esc(since));
    $('tdPosterMeta').innerHTML = meta.join(' \u2022 ');

    var real = stats.tasks.filter(function (t) { return taskGroup(t.status) !== 'draft'; });
    var booked = {};
    stats.bookings.forEach(function (b) { if (b.task_id && NOT_STARTED.indexOf(String(b.status || '').toLowerCase()) === -1) booked[b.task_id] = true; });
    var hired = real.filter(function (t) { var g = taskGroup(t.status); return g === 'progress' || g === 'completed' || booked[t.id]; }).length;
    var closed = real.filter(function (t) { return taskGroup(t.status) === 'closed' && !booked[t.id]; }).length;
    var decided = hired + closed;
    var cells = [];
    if (real.length) cells.push(['Tasks posted', String(real.length)]);
    if (decided >= 3) cells.push(['Hire rate', Math.round(hired / decided * 100) + '%']);
    if (stats.reviews.length) {
      var avg = stats.reviews.reduce(function (n, r) { return n + Number(r.rating); }, 0) / stats.reviews.length;
      cells.push(['Rating', avg.toFixed(1) + ' \u2605 (' + stats.reviews.length + ')']);
    }
    $('tdPosterStats').innerHTML = cells.map(function (c) { return '<div class="td-stat"><strong>' + esc(c[1]) + '</strong><span>' + esc(c[0]) + '</span></div>'; }).join('');

    var ver = [];
    if (verified) ver.push(['id', 'ID verified']);
    $('tdPosterVerify').innerHTML = ver.map(function (v) { return '<li>' + icon(v[0]) + esc(v[1]) + '</li>'; }).join('');

    var link = $('tdProfileLink');
    if (state.posterId) { link.href = 'client-profile.html?id=' + encodeURIComponent(state.posterId); link.hidden = false; } else link.hidden = true;
  }

  /* Who sees which button */
  function renderActions() {
    var t = state.task, open = taskGroup(t.status) === 'open', applied = !!state.myApplication;
    var budget = money(t.budget);
    setText('tdPrice', budget || 'To be agreed');
    var offerBtn = $('tdOfferBtn'), msgBtn = $('tdMessageBtn'), manage = $('tdManageBtn'), post = $('tdPostBtn'), note = $('tdCtaNote');
    var bar = $('tdActionbar'), barOffer = $('tdBarOffer'), barMsg = $('tdBarMsg');
    [offerBtn, msgBtn, manage, post, note, barMsg].forEach(function (el) { el.hidden = true; });
    bar.hidden = true;

    function setOffer(labelText, barText, disabled) {
      offerBtn.hidden = false; setText('tdOfferLabel', labelText); offerBtn.disabled = disabled;
      barOffer.disabled = disabled; setText('tdBarLabel', barText); bar.hidden = false;
    }

    if (state.isOwner) {
      manage.hidden = false;
      note.hidden = false; note.textContent = 'This is your task. Review offers from your dashboard.';
      return;
    }
    if (state.viewer && !state.isTasker) {
      post.hidden = false;
      note.hidden = false; note.textContent = 'Offers are made by taskers. Need something similar done? Post your own task.';
      return;
    }
    if (!open) { setOffer('No longer taking offers', 'No longer taking offers', true); return; }
    if (applied) {
      setOffer('Offer Sent', 'Offer Sent', true);
      msgBtn.hidden = false; barMsg.hidden = false;
      return;
    }
    setOffer('Make an Offer', budget ? 'Apply for ' + budget : 'Make an Offer', false);
    if (state.isTasker) { msgBtn.hidden = false; barMsg.hidden = false; }
  }

  /* ── actions ─────────────────────────────────────────────── */
  /* Making an offer is a full page now: make-offer.html?task=<id> */
  async function startOffer() {
    var user = await currentUser();
    if (!user) return toLogin();
    if (!state.isTasker) return toast('Switch to a tasker account to make offers.');
    window.location.href = 'make-offer.html?task=' + encodeURIComponent(state.task.id);
  }

  /* Messages hang off a task application, so a tasker can message once they have made an offer */
  async function messagePoster() {
    var user = await currentUser();
    if (!user) return toLogin();
    var app = state.myApplication && state.myApplication.id ? state.myApplication : await loadMyApplication(window.supabase, state.task.id, user);
    if (app && app.id) {
      sessionStorage.setItem('st_chat_context', JSON.stringify({
        contextType: 'task_application', contextId: String(app.id), taskerId: String(user.id),
        customerId: String(state.posterId || ''), senderRole: 'tasker'
      }));
      window.location.href = 'messages.html';
      return;
    }
    toast('Make an offer on this task to start a conversation.');
  }

  async function shareTask() {
    var url = shareUrl();
    if (navigator.share) {
      try { await navigator.share({ title: text(state.task.title) + ' \u2014 StreetTasker', text: 'A task on StreetTasker', url: url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copyLink();
  }
  async function copyLink() {
    var url = shareUrl();
    try { await navigator.clipboard.writeText(url); toast('Task link copied'); }
    catch (e) { var i = $('tdShareUrl'); i.focus(); i.select(); toast('Press Ctrl+C to copy the link'); }
  }

  function savedIds() {
    try { var v = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function paintSaved() {
    var on = savedIds().indexOf(String(state.id)) !== -1, b = $('tdSave');
    b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function toggleSaved() {
    var ids = savedIds(), id = String(state.id), at = ids.indexOf(id);
    if (at === -1) ids.push(id); else ids.splice(at, 1);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(ids)); } catch (e) { toast('Could not save on this device.'); return; }
    paintSaved();
    toast(at === -1 ? 'Task saved on this device' : 'Removed from saved tasks');
  }

  function wire() {
    $('tdShare').addEventListener('click', shareTask);
    $('tdCopy').addEventListener('click', copyLink);
    $('tdSave').addEventListener('click', toggleSaved);
    $('tdOfferBtn').addEventListener('click', startOffer);
    $('tdBarOffer').addEventListener('click', startOffer);
    $('tdMessageBtn').addEventListener('click', messagePoster);
    $('tdBarMsg').addEventListener('click', messagePoster);
    $('tdOffersMore').addEventListener('click', function () { state.offersExpanded = !state.offersExpanded; renderOffers(); });
    $('tdShareUrl').addEventListener('focus', function () { this.select(); });

    $('tdBack').addEventListener('click', function (e) {
      /* Never step back into the offer page: that is how Back and the offer page used to bounce between each other */
      if (window.history.length > 1 && document.referrer && document.referrer.indexOf(window.location.origin) === 0 && !/\/make-offer\.html/.test(document.referrer)) { e.preventDefault(); window.history.back(); }
    });

    $('tdThumbs').addEventListener('click', function (e) { var b = e.target.closest('[data-photo]'); if (b) showPhoto(Number(b.getAttribute('data-photo'))); });
    $('tdStage').addEventListener('click', function () { openLightbox(state.photoIdx); });
    $('tdLbPrev').addEventListener('click', function () { openLightbox(state.lbIdx - 1); });
    $('tdLbNext').addEventListener('click', function () { openLightbox(state.lbIdx + 1); });

    var lb = $('tdLightbox');
    lb.addEventListener('click', function (e) {
      if (e.target === lb || e.target.closest('[data-close]')) { if (lb.open) lb.close(); }
    });
    $('tdLightbox').addEventListener('close', function () { showPhoto(state.lbIdx); });
  }

  /* ── load ────────────────────────────────────────────────── */
  async function load() {
    var sb = window.supabase;
    var r = await sb.from('tasks').select('*').eq('id', state.id).maybeSingle();
    var t = r.data;
    if (r.error || !t) return showError('Task not found', 'This task may have been removed, or the link is incomplete.', 'find-tasks.html', 'Browse Tasks');
    if (taskGroup(t.status) === 'draft' && !(state.viewer && String(state.viewer.id) === String(t.customer_id || t.user_id))) {
      return showError('Task unavailable', 'This task is not published yet.', 'find-tasks.html', 'Browse Tasks');
    }
    state.task = t;
    state.posterId = t.customer_id || t.user_id || null;
    state.isOwner = !!(state.viewer && state.posterId && String(state.viewer.id) === String(state.posterId));

    $('tdShareUrl').value = shareUrl();
    renderHead(t); renderPhotos(t); renderScope(t); renderMilestones(t); renderLocation(t);
    paintSaved();

    /* Poster, their summary, offers and my own offer load together; each can fail without breaking the page */
    var results = await Promise.all([
      state.posterId ? sb.from('users').select('*').eq('id', state.posterId).maybeSingle().then(function (x) { return x.data; }, function () { return null; }) : Promise.resolve(null),
      state.posterId ? loadPosterStats(sb, state.posterId) : Promise.resolve({ tasks: [], bookings: [], reviews: [] }),
      loadOffers(sb, t.id),
      state.isOwner ? Promise.resolve(null) : loadMyApplication(sb, t.id, state.viewer)
    ]);
    state.poster = results[0];
    state.offers = results[2].rows; state.offersReadable = results[2].readable;
    state.myApplication = results[3];

    renderPoster(state.poster, results[1]);
    renderOffers();
    renderActions();

    $('tdLoading').hidden = true;
    $('tdContent').hidden = false;
  }

  async function init() {
    wire();
    try {
      state.id = text(new URLSearchParams(window.location.search).get('id'));
      if (!state.id) return showError('Task not found', 'This task link is incomplete.', 'find-tasks.html', 'Browse Tasks');
      var user = await currentUser();
      if (user) { state.role = await roleOf(user); state.isTasker = state.role === 'tasker'; }
      await load();
    } catch (err) {
      console.error('[task-details]', err);
      showError('Task unavailable', 'Something went wrong while loading this task. Please try again.', 'find-tasks.html', 'Browse Tasks');
    }
  }

  init();
})();

/* ============================================================
   STREET TASKER — notifications-panel.js
   The notification popover. Opens from the bell in the nav (desktop and phone) and from the
   "Notifications" links in the menu drawer, instead of sending people to a dashboard page.

   Reads and writes the same `notifications` table as the rest of the site
   (user_id, type, title, message, data, is_read, created_at). Loaded by js/app.js on every page.

   Arrival (new in this version):
     1. Supabase Realtime on `notifications` INSERT: instant. Needs sql/notifications-realtime.sql run once.
        The subscription reconnects by itself (with back-off) if it drops.
     2. A light check every 15 s (30 s while the tab is hidden), and straight away when the person comes back to
        the tab or the phone reconnects. This is the safety net: even with Realtime off, the red dot lights within
        seconds, not only when the bell is clicked.
   Each notification is handled once (known{} by id), so Realtime + the check never double-ring.
   Sound: a short two-note chime made with the Web Audio API (no audio file). ON by default; the speaker button in
   the panel header mutes it and the choice is kept in localStorage ('st_notif_sound' = 'off'). Browsers only allow
   sound after the person has tapped or clicked the page once, so the first click anywhere "unlocks" it.
   ============================================================ */
'use strict';
(function () {
  if (window.ST && window.ST.notifPanel) return;

  var LIMIT = 40;
  var tab = 'inbox';          /* 'inbox' = unread, 'all' = everything */
  var items = [];
  var panel = null, backdrop = null, openerEl = null, loaded = false, userId = null;

  var SOUND_KEY = 'st_notif_sound';          /* 'off' = muted; anything else (or nothing saved) = on */
  var DING_KEY = 'st_notif_ding_at';         /* shared by tabs so two open tabs do not both ring */
  var POLL_VISIBLE = 15000, POLL_HIDDEN = 30000;
  var known = {};                            /* ids already seen: a notification is announced once */
  var primed = false;                        /* known{} filled from the first check, without ringing */
  var rt = { channel: null, ok: false, tries: 0, timer: null };
  var pollTimer = null, checking = false, audioCtx = null;

  /* ── sound ───────────────────────────────────────────────── */
  function soundOn() { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; } }
  function setSound(on) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (e) {} syncSoundBtn(); }

  /* The audio engine can only start inside a tap/click; the first one anywhere on the page unlocks it */
  function unlockAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
    if (audioCtx.state === 'running') {
      ['click', 'touchend', 'keydown'].forEach(function (ev) { document.removeEventListener(ev, unlockAudio, true); });
    }
    return audioCtx;
  }
  ['click', 'touchend', 'keydown'].forEach(function (ev) { document.addEventListener(ev, unlockAudio, true); });

  function chime() {
    var c = audioCtx;
    if (!c || c.state !== 'running') return;                /* still locked: stay silent rather than error */
    var t = c.currentTime;
    [[880, 0], [1318.5, 0.14]].forEach(function (n) {       /* A5 then E6: a friendly two-note ding */
      var o = c.createOscillator(), g = c.createGain(), at = t + n[1];
      o.type = 'sine'; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      o.connect(g); g.connect(c.destination);
      o.start(at); o.stop(at + 0.5);
    });
  }
  function ding() {
    if (!soundOn()) return;
    var now = Date.now(), last = 0;
    try { last = Number(localStorage.getItem(DING_KEY)) || 0; localStorage.setItem(DING_KEY, String(now)); } catch (e) {}
    if (now - last < 2500) return;                          /* just rang (here or in another tab) */
    chime();
  }

  /* ── helpers ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function role() { try { return localStorage.getItem('st_role') === 'tasker' ? 'tasker' : 'customer'; } catch (e) { return 'customer'; } }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min ago' : ' mins ago');
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24); if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /* Where a notification leads, by type (and by role where the page differs) */
  function target(n) {
    var t = String(n.type || '').toLowerCase();
    var d = n.data || {};
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
    var tasker = role() === 'tasker';
    if (d.url) return d.url;
    /* Stage 15: anything that belongs to a conversation opens THAT conversation (messages.html reads ?thread=) */
    if (d.thread_id) return 'messages.html?thread=' + encodeURIComponent(d.thread_id);
    if (t.indexOf('message') > -1 || t.indexOf('payment_request') > -1 || t.indexOf('job_update') > -1) return 'messages.html';
    if (t.indexOf('dispute') > -1) return 'messages.html';          /* Stage 12: problem-report updates (opened, review, decision, refund) */
    if (t.indexOf('application') > -1 || t.indexOf('apply') > -1) return tasker ? 'applications.html' : 'customer-applications.html';
    if (t.indexOf('booking') > -1) return tasker ? 'bookings.html' : 'customer-bookings.html';
    if (t.indexOf('payment') > -1 || t.indexOf('payout') > -1 || t.indexOf('wallet') > -1) return 'wallet.html';
    if (t.indexOf('task') > -1) return tasker ? 'find-tasks.html' : 'my-tasks.html';
    return '';
  }

  /* One glyph per kind of notification (stroke icons, same style as the nav) */
  var ICONS = {
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    task: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
  };
  function iconFor(type) {
    var t = String(type || '').toLowerCase();
    if (t.indexOf('message') > -1) return ICONS.message;
    if (t.indexOf('payment') > -1 || t.indexOf('payout') > -1) return ICONS.money;
    if (t.indexOf('booking') > -1) return ICONS.calendar;
    if (t.indexOf('task') > -1 || t.indexOf('application') > -1) return ICONS.task;
    return ICONS.bell;
  }

  /* ── nav dots ────────────────────────────────────────────── */
  function setDots(on) {
    ['navNotifDot', 'navDrawerNotifDot', 'navDrawerNotifDotTasker'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.hidden = !on;
    });
    var m = document.getElementById('navMobileNotifDot'); if (m) m.style.display = on ? '' : 'none';
  }

  /* ── data ────────────────────────────────────────────────── */
  async function getUser() {
    if (userId) return userId;
    var r = await window.supabase.auth.getSession();
    userId = r.data && r.data.session && r.data.session.user.id;
    return userId;
  }
  async function load() {
    var uid = await getUser();
    if (!uid) throw new Error('Not logged in');
    var r = await window.supabase.from('notifications').select('*')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(LIMIT);
    if (r.error) throw r.error;
    items = r.data || [];
    items.forEach(function (n) { known[String(n.id)] = true; });
    loaded = true;
  }
  function unreadCount() { return items.filter(function (n) { return !n.is_read; }).length; }

  async function markRead(id) {
    var n = items.filter(function (x) { return x.id === id; })[0];
    if (!n || n.is_read) return;
    n.is_read = true;
    try { await window.supabase.from('notifications').update({ is_read: true }).eq('id', id); } catch (e) {}
    setDots(unreadCount() > 0);
  }
  async function markAll() {
    items.forEach(function (n) { n.is_read = true; });
    render();
    setDots(false);
    try {
      var uid = await getUser();
      if (uid) await window.supabase.from('notifications').update({ is_read: true }).eq('user_id', uid).eq('is_read', false);
    } catch (e) {}
  }

  /* ── view ────────────────────────────────────────────────── */
  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'np-backdrop';
    backdrop.hidden = true;

    panel = document.createElement('section');
    panel.className = 'np';
    panel.id = 'notifPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.hidden = true;
    panel.innerHTML =
      '<header class="np-head">' +
        '<h2 class="np-title">Notifications</h2>' +
        '<div class="np-head-actions">' +
          '<button type="button" class="np-sound" data-np-sound aria-pressed="true"><svg class="np-sound-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg><span class="np-sound-label"></span></button>' +
          '<button type="button" class="np-markall" data-np-markall>Mark all as read</button>' +
        '</div>' +
      '</header>' +
      '<div class="np-tabs" role="tablist">' +
        '<button type="button" class="np-tab" role="tab" data-np-tab="inbox" aria-selected="true">Inbox <span class="np-count" data-np-count></span></button>' +
        '<button type="button" class="np-tab" role="tab" data-np-tab="all" aria-selected="false">All</button>' +
      '</div>' +
      '<div class="np-list" data-np-list></div>';
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    syncSoundBtn();

    backdrop.addEventListener('click', close);
    panel.addEventListener('click', function (e) {
      var t = e.target.closest('[data-np-tab]');
      if (t) { tab = t.getAttribute('data-np-tab'); render(); return; }
      if (e.target.closest('[data-np-markall]')) { markAll(); return; }
      if (e.target.closest('[data-np-sound]')) {
        var turningOn = !soundOn();
        setSound(turningOn);
        if (turningOn) { var c = unlockAudio(); if (c && c.state !== 'running' && c.resume) { c.resume().then(chime).catch(function () {}); } else { chime(); } }   /* a short preview */
        return;
      }
      var row = e.target.closest('[data-np-id]');
      if (row) {
        var id = row.getAttribute('data-np-id');
        var n = items.filter(function (x) { return String(x.id) === id; })[0];
        if (!n) return;
        markRead(n.id);
        var url = target(n);
        if (url) { window.location.href = url; } else { render(); }
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });
    window.addEventListener('resize', function () { if (!panel.hidden) place(); });
  }

  var SPEAKER_ON = '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>';
  var SPEAKER_OFF = '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/>';
  function syncSoundBtn() {
    if (!panel) return;
    var b = panel.querySelector('[data-np-sound]'); if (!b) return;
    var on = soundOn();
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Notification sound is on. Tap to mute' : 'Notification sound is muted. Tap to turn on');
    b.title = on ? 'Mute notification sound' : 'Turn notification sound on';
    b.querySelector('.np-sound-ico').innerHTML = on ? SPEAKER_ON : SPEAKER_OFF;
    b.querySelector('.np-sound-label').textContent = on ? 'Sound on' : 'Muted';
  }

  function render() {
    if (!panel) return;
    var list = panel.querySelector('[data-np-list]');
    var unread = unreadCount();
    var cnt = panel.querySelector('[data-np-count]');
    cnt.textContent = unread > 0 ? (unread > 99 ? '99+' : unread) : '';
    cnt.hidden = unread === 0;
    panel.querySelectorAll('[data-np-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-np-tab') === tab ? 'true' : 'false');
    });
    panel.querySelector('[data-np-markall]').disabled = unread === 0;
    var shown = tab === 'inbox' ? items.filter(function (n) { return !n.is_read; }) : items;
    if (!shown.length) {
      list.innerHTML = '<p class="np-empty">' + (tab === 'inbox' ? 'You’re all caught up.' : 'No notifications yet.') + '</p>';
      return;
    }
    list.innerHTML = shown.map(function (n) {
      return '<button type="button" class="np-item' + (n.is_read ? '' : ' is-unread') + '" data-np-id="' + esc(n.id) + '">' +
        '<span class="np-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconFor(n.type) + '</svg></span>' +
        '<span class="np-body">' +
          '<span class="np-line"><strong>' + esc(n.title || 'Notification') + '</strong></span>' +
          (n.message ? '<span class="np-msg">' + esc(n.message) + '</span>' : '') +
          '<span class="np-time">' + esc(ago(n.created_at)) + '</span>' +
        '</span>' +
        (n.is_read ? '' : '<span class="np-dot" aria-label="Unread"></span>') +
      '</button>';
    }).join('');
  }

  function place() {
    /* Phones: a sheet under the nav (CSS). Desktop: under the bell, right edges lined up */
    if (window.matchMedia('(max-width: 768px)').matches || !openerEl) { panel.style.top = panel.style.left = panel.style.right = ''; return; }
    var r = openerEl.getBoundingClientRect();
    panel.style.top = Math.round(r.bottom + 10) + 'px';
    panel.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    panel.style.left = 'auto';
  }

  async function open(opener) {
    if (!panel) build();
    openerEl = opener || openerEl;
    place();
    backdrop.hidden = false;
    panel.hidden = false;
    document.documentElement.classList.add('np-open');
    if (openerEl && openerEl.setAttribute) openerEl.setAttribute('aria-expanded', 'true');
    var list = panel.querySelector('[data-np-list]');
    if (loaded) render(); else list.innerHTML = '<p class="np-empty">Loading…</p>';   /* cached rows show at once; fresh ones replace them */
    syncSoundBtn();
    try { await load(); render(); setDots(unreadCount() > 0); }
    catch (e) { list.innerHTML = '<p class="np-empty">Could not load notifications.</p>'; }
  }
  function close() {
    if (!panel) return;
    panel.hidden = true; backdrop.hidden = true;
    document.documentElement.classList.remove('np-open');
    if (openerEl && openerEl.setAttribute) openerEl.setAttribute('aria-expanded', 'false');
  }
  function toggle(opener) { if (panel && !panel.hidden) close(); else open(opener); }

  /* ── wiring: the bells and the drawer links ─────────────── */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('#navBellBtn, #navMobileBell, a[href*="panel=notifications"]');
    if (!el) return;
    if (!document.body.classList.contains('st-logged-in')) return;
    e.preventDefault();
    e.stopPropagation();
    var drawer = el.closest('.nav-drawer');
    if (drawer && window.ST && window.ST.navDrawer) window.ST.navDrawer.close();
    toggle(drawer ? document.getElementById('navMobileBell') || el : el);
  }, true);

  /* ── arrival: Realtime first, a light check as the safety net ── */
  /* One new notification: red dot, chime, and (if the panel is open or already loaded) the list */
  function onArrive(row) {
    if (!row || row.id == null) return;
    var key = String(row.id);
    if (known[key]) return;
    known[key] = true;
    if (row.is_read) return;
    setDots(true);
    ding();
    if (loaded && !items.some(function (n) { return String(n.id) === key; })) {
      items.unshift(row);
      if (items.length > LIMIT) items.length = LIMIT;
    }
    if (panel && !panel.hidden) render();
  }

  async function check() {
    if (checking || !window.supabase) return;
    checking = true;
    try {
      var uid = await getUser();
      if (!uid) return;
      var r = await window.supabase.from('notifications').select('*')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(20);
      if (r.error || !r.data) return;
      if (!primed) {                                         /* first look: remember what is there, no ringing */
        r.data.forEach(function (n) { known[String(n.id)] = true; });
        primed = true;
        if (r.data.some(function (n) { return !n.is_read; })) setDots(true);
      } else {
        r.data.slice().reverse().forEach(onArrive);          /* oldest first, so the newest ends up on top */
      }
    } catch (e) { /* offline or signed out: try again next time */ }
    finally { checking = false; }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () { check().then(schedulePoll); }, document.hidden ? POLL_HIDDEN : POLL_VISIBLE);
  }

  function retryRealtime() {
    if (rt.timer) return;
    var wait = Math.min(30000, 2000 * Math.pow(2, rt.tries++));
    rt.timer = setTimeout(function () { rt.timer = null; connect(); }, wait);
  }
  function connect() {
    var sb = window.supabase;
    if (!sb || !sb.channel || !userId) return;
    if (rt.channel) { var old = rt.channel; rt.channel = null; try { sb.removeChannel(old); } catch (e) {} }
    rt.ok = false;
    var ch = sb.channel('np-notifs:' + userId + ':' + Date.now());
    rt.channel = ch;
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId },
      function (payload) { onArrive(payload && payload.new); })
      .subscribe(function (status) {
        if (rt.channel !== ch) return;                       /* an old channel we replaced */
        if (status === 'SUBSCRIBED') { rt.ok = true; rt.tries = 0; check(); }   /* catch anything that landed while connecting */
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { rt.ok = false; retryRealtime(); }
      });
  }

  async function start() {
    try {
      var uid = await getUser();
      if (!uid) return;
      await check();                                         /* prime known{} before any live event can ring */
      connect();
      schedulePoll();
      /* Back on the tab, or the phone is online again: look now, and mend a dropped connection */
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        check(); if (!rt.ok) connect(); schedulePoll();
      });
      window.addEventListener('online', function () { check(); connect(); });
      window.addEventListener('focus', function () { check(); });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 300); });
  else setTimeout(start, 300);

  window.ST = window.ST || {};
  window.ST.notifPanel = { open: open, close: close, toggle: toggle };
})();

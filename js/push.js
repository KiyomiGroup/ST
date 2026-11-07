/* ============================================================
   StreetTasker — push.js (M19)
   Phone notifications + the red dot (app badge) on the app icon.
   - Turn on / off notifications for THIS device (asks the phone for permission from a tap).
   - Saves the device through push_save_subscription (own device only); the push-send edge function does the sending.
   - Keeps the app-icon badge equal to the number of unread notifications.
   Works on Android and desktop browsers, and on iPhone (iOS 16.4+) once the app is added to the Home Screen.
   Loaded by js/notifications-panel.js after sign-in. Global: window.STPush.

   v2 (2026-11-06):
   - Notifications are ON BY DEFAULT. After sign-in the device is subscribed by itself when the browser already allows it; when it has not
     been asked yet, the browser's own permission box is shown once, on the person's first tap (browsers do not allow it any other way).
     Someone who turned notifications off (or who blocked them) is never asked again until they switch them back on.
   - Settings rows (STPush.mountSettings): Phone notifications on/off, and Email notifications on/off (saved on the account in
     notification_preferences, see sql/notification-preferences.sql).
   - The "Turn on" error is fixed: the service worker is registered if it is not yet, the wait for it has a time limit, and every
     failure becomes a plain sentence instead of a raw database or browser error.
   ============================================================ */
(function () {
  'use strict';
  var VAPID_PUBLIC_KEY = 'BO8jxfZ77al6ekBgnGr8RoUjiB9MLp5UykbeyilUdXENp05-8qJ-0gZ2tmTPLwda-_J8xBg6b1RouX6_ek-c4qw';
  var SYNC_KEY = 'st_push_synced';
  var ASKED_KEY = 'st_push_asked_at';      /* last time the browser permission box was shown by auto-on */
  var PREF_KEY = 'st_notif_prefs';         /* cached copy of the account preferences: {push, email} */
  var ASK_AGAIN_DAYS = 7;
  var READY_MS = 8000;
  var DAY = 24 * 60 * 60 * 1000;
  var badgeTimer = null;
  var prompts = [];

  function sb() { return window.supabase; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isStandalone() {
    try { return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (e) { return false; }
  }
  function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

  function keyBytes(b64) {
    var pad = '='.repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /* The service worker for this site. Registers it if the page has not yet, and never waits forever. */
  async function getReg() {
    var reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register('/sw.js');
    if (reg.active) return reg;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('sw_timeout')); }, READY_MS); })
    ]);
  }

  async function currentSub() {
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      return reg ? await reg.pushManager.getSubscription() : null;
    } catch (e) { return null; }
  }

  /* Raw browser and database errors become one plain sentence (the detail goes to the console). */
  function friendly(e) {
    try { console.warn('[ST push]', e); } catch (x) {}
    var name = e && e.name, msg = String((e && e.message) || '');
    if (name === 'NotAllowedError') return 'Notifications are blocked. Allow them in your browser or phone settings, then try again.';
    if (name === 'AbortError' || /push service|registration failed/i.test(msg)) return 'Your browser could not reach its notification service. Check your connection and try again.';
    if (msg === 'sw_timeout') return 'The app is still starting. Please wait a moment and try again.';
    if (msg === 'not_allowed') return 'Notifications were not allowed.';
    if (msg === 'unsupported') return 'This phone or browser cannot receive notifications.';
    return 'Notifications could not be turned on right now. Please try again in a moment.';
  }

  /* 'unsupported' | 'ios-install' | 'denied' | 'on' | 'off' */
  async function state() {
    if (isIOS() && !isStandalone()) return 'ios-install';
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && (await currentSub())) return 'on';
    return 'off';
  }

  async function saveSub(sub) {
    var j = sub.toJSON ? sub.toJSON() : {};
    var k = j.keys || {};
    var r = await sb().rpc('push_save_subscription', { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_ua: navigator.userAgent || null });
    if (r && r.error) { console.warn('[ST push] push_save_subscription failed', r.error); throw new Error('save_failed'); }
    try { localStorage.setItem(SYNC_KEY, String(Date.now())); } catch (e) {}
  }

  /* Turn on for THIS device. `remember` (default true) also records the choice on the account. */
  async function enable(opts) {
    if (!supported()) throw new Error('unsupported');
    var perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('not_allowed');
    var reg = await getReg();
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
    await saveSub(sub);
    if (!opts || opts.remember !== false) { try { await setPrefs({ push: true }); } catch (e) {} }
    refreshBadge();
    return true;
  }

  async function disable(opts) {
    if (opts && opts.remember) { try { await setPrefs({ push: false }); } catch (e) {} }
    var sub = await currentSub();
    if (!sub) return true;
    try { await sb().rpc('push_remove_subscription', { p_endpoint: sub.endpoint }); } catch (e) {}
    try { await sub.unsubscribe(); } catch (e) {}
    return true;
  }

  /* ── Account preferences: push_enabled and email_enabled, both ON until the person turns them off ── */
  function cachedPrefs() {
    try { var p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); if (p) return { push: p.push !== false, email: p.email !== false }; } catch (e) {}
    return { push: true, email: true };
  }
  function cachePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }
  async function getPrefs() {
    try {
      var r = await sb().rpc('get_my_notification_prefs');
      if (r && !r.error && r.data) {
        var d = Array.isArray(r.data) ? r.data[0] : r.data;
        if (d) { var p = { push: d.push_enabled !== false, email: d.email_enabled !== false }; cachePrefs(p); return p; }
      }
    } catch (e) {}
    return cachedPrefs();
  }
  /* patch: { push?: bool, email?: bool }. Throws if the account could not be updated. */
  async function setPrefs(patch) {
    var r = await sb().rpc('set_my_notification_prefs', {
      p_push: typeof patch.push === 'boolean' ? patch.push : null,
      p_email: typeof patch.email === 'boolean' ? patch.email : null
    });
    if (r && r.error) throw r.error;
    var cur = cachedPrefs();
    if (typeof patch.push === 'boolean') cur.push = patch.push;
    if (typeof patch.email === 'boolean') cur.email = patch.email;
    cachePrefs(cur);
    return cur;
  }

  /* ── On by default ──
     Already allowed in this browser: subscribe quietly. Not asked yet: show the browser's permission box once, on the first tap
     (it cannot be shown without a tap). Turned off, blocked, or asked in the last week: leave it alone. */
  var autoDone = false;
  async function autoEnable() {
    if (autoDone) return; autoDone = true;
    try {
      if (!supported() || (isIOS() && !isStandalone())) return;
      var s = await sb().auth.getSession();
      if (!(s && s.data && s.data.session)) return;
      var prefs = await getPrefs();
      if (!prefs.push) return;
      if (Notification.permission === 'denied') return;
      if (Notification.permission === 'granted') {
        if (!(await currentSub())) { try { await enable({ remember: false }); } catch (e) { friendly(e); } }
        return;
      }
      var last = 0; try { last = Number(localStorage.getItem(ASKED_KEY) || 0); } catch (e) {}
      if (last && Date.now() - last < ASK_AGAIN_DAYS * DAY) return;
      var armed = true;
      var onTap = function () {
        if (!armed) return; armed = false;
        document.removeEventListener('click', onTap, true);
        try { localStorage.setItem(ASKED_KEY, String(Date.now())); } catch (e) {}
        enable({ remember: false }).then(function () { prompts.forEach(paint); }).catch(function (e) { friendly(e); prompts.forEach(paint); });
      };
      document.addEventListener('click', onTap, true);
    } catch (e) { friendly(e); }
  }

  /* On sign-out: this device stops getting the signed-out person's notifications, and the icon dot is cleared. */
  async function forgetDevice() {
    try { if (supported()) await disable(); } catch (e) {}
    try { if (navigator.clearAppBadge) await navigator.clearAppBadge(); } catch (e) {}
  }

  /* Keep the saved device fresh (once a day), only if this device already has a subscription. */
  async function sync() {
    try {
      if (!supported() || Notification.permission !== 'granted') return;
      var last = Number(localStorage.getItem(SYNC_KEY) || 0);
      if (Date.now() - last < DAY) return;
      var sub = await currentSub();
      if (sub) await saveSub(sub);
    } catch (e) {}
  }

  /* The red dot on the app icon = unread notifications. Asked of the database, so it is the true number. */
  function refreshBadge() {
    if (!('setAppBadge' in navigator)) return;
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(async function () {
      try {
        if (!sb()) return;
        var s = await sb().auth.getSession();
        var uid = s && s.data && s.data.session && s.data.session.user.id;
        if (!uid) { if (navigator.clearAppBadge) navigator.clearAppBadge(); return; }
        var r = await sb().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('is_read', false);
        if (r.error || typeof r.count !== 'number') return;
        if (r.count > 0) await navigator.setAppBadge(r.count);
        else if (navigator.clearAppBadge) await navigator.clearAppBadge();
      } catch (e) {}
    }, 400);
  }

  /* ── The small row inside the notifications panel ── */
  function loadCss() {
    if (document.getElementById('stPushCss')) return;
    var l = document.createElement('link');
    l.id = 'stPushCss'; l.rel = 'stylesheet'; l.href = '/css/push.css';
    document.head.appendChild(l);
  }
  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt) n.textContent = txt; return n; }

  /* A labelled on/off switch. onChange(next) returns a promise; the switch goes back if it fails. */
  function switchRow(title, help, checked, onChange) {
    var row = el('div', 'np-set-row');
    var txt = el('div', 'np-set-text');
    txt.appendChild(el('div', 'np-set-title', title));
    if (help) txt.appendChild(el('div', 'np-set-help', help));
    var lab = el('label', 'np-switch');
    var inp = document.createElement('input');
    inp.type = 'checkbox'; inp.setAttribute('role', 'switch'); inp.checked = !!checked; inp.setAttribute('aria-label', title);
    var track = el('span', 'np-switch-track');
    lab.appendChild(inp); lab.appendChild(track);
    inp.addEventListener('change', async function () {
      var want = inp.checked;
      inp.disabled = true;
      try { await onChange(want); }
      catch (e) { inp.checked = !want; if (window.showToast) window.showToast(friendly(e)); }
      inp.disabled = false;
    });
    row.appendChild(txt); row.appendChild(lab);
    return row;
  }

  async function paint(box) {
    var st = await state();
    var prefs = await getPrefs();
    box.textContent = '';
    box.hidden = false;

    /* Phone notifications */
    if (st === 'ios-install') {
      var r1 = el('div', 'np-set-row'); var t1 = el('div', 'np-set-text');
      t1.appendChild(el('div', 'np-set-title', 'Phone notifications'));
      t1.appendChild(el('div', 'np-set-help', 'To get notifications on your iPhone, add StreetTasker to your Home Screen, then open it from there.'));
      r1.appendChild(t1); box.appendChild(r1);
    } else if (st === 'denied') {
      var r2 = el('div', 'np-set-row'); var t2 = el('div', 'np-set-text');
      t2.appendChild(el('div', 'np-set-title', 'Phone notifications'));
      t2.appendChild(el('div', 'np-set-help', 'Blocked for StreetTasker. Allow them in your phone or browser settings, then come back here.'));
      r2.appendChild(t2); box.appendChild(r2);
    } else if (st !== 'unsupported') {
      box.appendChild(switchRow('Phone notifications', 'Alerts on this device for messages, offers and bookings.', st === 'on', async function (want) {
        if (want) await enable(); else await disable({ remember: true });
      }));
    }

    /* Email notifications (account-wide) */
    box.appendChild(switchRow('Email notifications', 'Updates sent to your email. Sign-in, password and payment emails are always sent.', prefs.email, async function (want) {
      await setPrefs({ email: want });
    }));
  }

  /* Put the two switches into any element (used by the notifications panel and the dashboard Notifications page). */
  function mountSettings(host) {
    try {
      if (!host || host.querySelector('[data-np-push]')) return;
      loadCss();
      var box = el('div', 'np-push');
      box.setAttribute('data-np-push', '');
      box.hidden = true;
      host.appendChild(box);
      prompts.push(box);
      paint(box);
    } catch (e) {}
  }

  function mountPrompt(panel) {
    try {
      if (!panel || panel.querySelector('[data-np-push]')) return;
      loadCss();
      var box = el('div', 'np-push');
      box.setAttribute('data-np-push', '');
      box.hidden = true;
      var tabs = panel.querySelector('.np-tabs');
      if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(box, tabs.nextSibling); else panel.appendChild(box);
      prompts.push(box);
      paint(box);
    } catch (e) {}
  }

  window.STPush = { state: state, enable: enable, disable: disable, forgetDevice: forgetDevice, refreshBadge: refreshBadge, mountPrompt: mountPrompt, mountSettings: mountSettings, getPrefs: getPrefs, setPrefs: setPrefs, autoEnable: autoEnable };

  /* On load: mount into a panel that already exists, refresh the saved device, set the icon number. */
  var existing = document.getElementById('notifPanel');
  if (existing) mountPrompt(existing);
  sync();
  refreshBadge();
  autoEnable();
})();

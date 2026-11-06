/* ============================================================
   StreetTasker — push.js (M19)
   Phone notifications + the red dot (app badge) on the app icon.
   - Turn on / off notifications for THIS device (asks the phone for permission from a tap).
   - Saves the device through push_save_subscription (own device only); the push-send edge function does the sending.
   - Keeps the app-icon badge equal to the number of unread notifications.
   Works on Android and desktop browsers, and on iPhone (iOS 16.4+) once the app is added to the Home Screen.
   Loaded by js/notifications-panel.js after sign-in. Global: window.STPush.
   ============================================================ */
(function () {
  'use strict';
  var VAPID_PUBLIC_KEY = 'BO8jxfZ77al6ekBgnGr8RoUjiB9MLp5UykbeyilUdXENp05-8qJ-0gZ2tmTPLwda-_J8xBg6b1RouX6_ek-c4qw';
  var SYNC_KEY = 'st_push_synced';
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

  async function currentSub() {
    try {
      var reg = await navigator.serviceWorker.ready;
      return await reg.pushManager.getSubscription();
    } catch (e) { return null; }
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
    if (r && r.error) throw r.error;
    try { localStorage.setItem(SYNC_KEY, String(Date.now())); } catch (e) {}
  }

  async function enable() {
    if (!supported()) throw new Error('This phone or browser cannot receive notifications.');
    var perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed.');
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
    await saveSub(sub);
    refreshBadge();
    return true;
  }

  async function disable() {
    var sub = await currentSub();
    if (!sub) return true;
    try { await sb().rpc('push_remove_subscription', { p_endpoint: sub.endpoint }); } catch (e) {}
    try { await sub.unsubscribe(); } catch (e) {}
    return true;
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

  async function paint(box) {
    var st = await state();
    box.textContent = '';
    box.hidden = false;
    if (st === 'unsupported') { box.hidden = true; return; }
    if (st === 'ios-install') {
      box.appendChild(el('p', 'np-push-text', 'To get notifications on your iPhone, add StreetTasker to your Home Screen, then open it from there.'));
      return;
    }
    if (st === 'denied') {
      box.appendChild(el('p', 'np-push-text', 'Notifications are blocked for StreetTasker. Allow them in your phone or browser settings.'));
      return;
    }
    var msg = el('span', 'np-push-text', st === 'on' ? 'Phone notifications are on.' : 'Get notifications on your phone.');
    var btn = el('button', st === 'on' ? 'np-push-link' : 'np-push-btn', st === 'on' ? 'Turn off' : 'Turn on');
    btn.type = 'button';
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        if (st === 'on') await disable(); else await enable();
      } catch (e) {
        if (window.showToast) window.showToast(e && e.message ? e.message : 'Could not change notifications.');
      }
      paint(box);
    });
    box.appendChild(msg); box.appendChild(btn);
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

  window.STPush = { state: state, enable: enable, disable: disable, forgetDevice: forgetDevice, refreshBadge: refreshBadge, mountPrompt: mountPrompt };

  /* On load: mount into a panel that already exists, refresh the saved device, set the icon number. */
  var existing = document.getElementById('notifPanel');
  if (existing) mountPrompt(existing);
  sync();
  refreshBadge();
})();

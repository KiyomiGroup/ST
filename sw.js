/* ============================================================
   StreetTasker service worker (installable web app, v1)
   Job 1: show offline.html when a page cannot be reached.
   Job 2 (M19): show phone notifications sent by the push-send function, set the red dot (app badge) and open the right page on tap.
   It never stores pages, API calls, sign-in, chat, Supabase or Paystack
   responses. Only offline.html, its stylesheets and the icons are kept.
   To ship a change to this list, raise VERSION.
   ============================================================ */
'use strict';

var VERSION = 'st-pwa-v2';
var PRECACHE = [
  '/offline.html',
  '/css/tokens.css',
  '/css/offline.css',
  '/images/pwa/icon-192.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== VERSION; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* Page loads: network first, always. Only when the network fails, show offline.html. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () { return caches.match('/offline.html'); })
    );
    return;
  }

  /* The offline page's own files, so it looks right with no connection. */
  var url = new URL(req.url);
  if (req.method === 'GET' && url.origin === self.location.origin && PRECACHE.indexOf(url.pathname) !== -1) {
    event.respondWith(
      caches.match(req).then(function (hit) { return hit || fetch(req); })
    );
  }
  /* Everything else (Supabase, Paystack, images, scripts, chat): not touched. */
});

/* ── Phone notifications (M19) ── */
self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  var title = d.title || 'StreetTasker';
  var jobs = [
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/images/pwa/icon-192.png',
      tag: d.tag || undefined,
      data: { url: d.url || '/' }
    })
  ];
  if (typeof d.badge === 'number' && self.navigator && self.navigator.setAppBadge) {
    jobs.push(self.navigator.setAppBadge(d.badge).catch(function () {}));
  }
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var raw = (event.notification.data && event.notification.data.url) || '/';
  var url = new URL(raw, self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin);   /* never open another site */
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && new URL(c.url).origin === self.location.origin && 'focus' in c) {
          return c.focus().then(function (w) { return (w && 'navigate' in w) ? w.navigate(url.href) : null; });
        }
      }
      return self.clients.openWindow(url.href);
    })
  );
});

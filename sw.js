/* ============================================================
   StreetTasker service worker (installable web app, v1)
   It does ONE job: show offline.html when a page cannot be reached.
   It never stores pages, API calls, sign-in, chat, Supabase or Paystack
   responses. Only offline.html, its stylesheets and the icons are kept.
   To ship a change to this list, raise VERSION.
   ============================================================ */
'use strict';

var VERSION = 'st-pwa-v1';
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

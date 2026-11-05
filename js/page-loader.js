/* ============================================================
   STREET TASKER — page-loader.js
   Fades out the coin loader that css/styles.css paints on first load
   (see "PAGE LOADER" there), and lets any page bring it back.

   The CSS covers the page from the first paint. This file only decides
   when it is over:
     - app.js pages: when the window has loaded, app.js has built the
       navbar and finished the page's initPage() (it fires "st:app-ready")
     - other pages: when the window has loaded
   A coin that has appeared stays long enough to be seen (no flicker),
   and a page that is still not ready after MAX_WAIT is revealed anyway.

   API (window.ST.loader):
     show()          bring the loader back (counted, pair with hide())
     hide()          release one show()
     wrap(promise)   show while a promise runs, hide after; returns the promise
   Internal link clicks also show it while the next page loads.
   ============================================================ */
(function () {
  'use strict';

  window.ST = window.ST || {};
  if (window.ST.loader) return;

  var root = document.documentElement;

  var SHOW_DELAY  = 160;    /* ms: keep equal to --loader-show-delay */
  var FADE        = 350;    /* ms: keep equal to --loader-fade */
  var MIN_VISIBLE = 500;    /* ms the coin stays once it has appeared */
  var MAX_WAIT    = 10000;  /* ms: reveal the page even if something hangs */
  var NAV_SAFETY  = 8000;   /* ms: a link click that never navigates away */

  var holds = 0;            /* show() calls not yet released */
  var visibleSince = 0;     /* performance.now() when the loader last went up (0 = navigation start) */
  var hideTimer = null;
  var navTimer = null;
  var navSafety = null;

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function reveal() {
    clearTimeout(hideTimer); hideTimer = null;
    root.classList.remove('st-loading');
    root.classList.add('st-loaded');
  }

  /* hide, but never before the coin has had MIN_VISIBLE ms on screen */
  function settle() {
    if (holds > 0) return;
    clearTimeout(hideTimer);
    var coinUp = visibleSince + SHOW_DELAY;
    var wait = now() > coinUp ? Math.max(0, coinUp + MIN_VISIBLE - now()) : 0;
    hideTimer = setTimeout(function () { if (holds === 0) reveal(); }, wait);
  }

  function show() {
    holds += 1;
    clearTimeout(hideTimer); hideTimer = null;
    if (!root.classList.contains('st-loading')) {
      visibleSince = now();
      root.classList.remove('st-loaded');
      root.classList.add('st-loading');
    }
  }

  function hide() {
    holds = Math.max(0, holds - 1);
    settle();
  }

  function wrap(promise) {
    show();
    var done = function () { hide(); };
    Promise.resolve(promise).then(done, done);
    return promise;
  }

  window.ST.loader = { show: show, hide: hide, wrap: wrap };

  /* ── First load ─────────────────────────────────────────── */
  var needApp = window.ST_LOADER_WAIT_APP === true;
  var loaded = document.readyState === 'complete';
  var appReady = !needApp || window.ST_APP_READY === true;
  var initialDone = false;

  function tryFinishInitial() {
    if (initialDone || !loaded || !appReady) return;
    initialDone = true;
    clearTimeout(cap);
    /* fonts last, so text never swaps under the fade (capped by MAX_WAIT) */
    var fonts = document.fonts && document.fonts.ready;
    if (fonts && fonts.then) fonts.then(settle, settle); else settle();
  }

  if (!loaded) window.addEventListener('load', function () { loaded = true; tryFinishInitial(); });
  if (needApp) window.addEventListener('st:app-ready', function () { appReady = true; tryFinishInitial(); });
  var cap = setTimeout(function () { initialDone = true; holds = 0; reveal(); }, MAX_WAIT);
  tryFinishInitial();

  /* ── Leaving the page: keep the coin going until the next page paints ── */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return; /* same page, hash or reload */
    clearTimeout(navTimer); clearTimeout(navSafety);
    navTimer = setTimeout(function () {
      show();
      navSafety = setTimeout(hide, NAV_SAFETY); /* the click did not leave the page after all */
    }, SHOW_DELAY);
  });

  /* back/forward restores a frozen page: never leave it covered */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    clearTimeout(navTimer); clearTimeout(navSafety);
    holds = 0; reveal();
  });
})();

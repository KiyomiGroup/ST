/* ============================================================
   STREET TASKER — pwa-install.js
   "Add to home screen" for phones. Loaded by js/app.js on every page that
   runs app.js, so no page needs a new <script> tag.

   1. Registers /sw.js (offline page only, see sw.js). Never blocks the page.
   2. Shows a small banner, on phones only, on the pages in BANNER_PAGES:
        Android / Chrome : "Add" button opens the browser's own install box.
        iPhone / Safari  : "Show me how" opens the Share > Add to Home Screen steps
                           (Apple gives pages no install button).
        In-app browsers (Instagram, Facebook...): "Open this page in Safari".
   3. Never shows if the app is already installed (standalone) or the person
      tapped "Not now" in the last DISMISS_DAYS days.

   API: window.ST.pwa.show()  shows the banner again (for a future menu link).
   Styles: css/styles.css "INSTALL BANNER". Tokens: --install-* in css/tokens.css.
   ============================================================ */
(function () {
  'use strict';

  window.ST = window.ST || {};
  if (window.ST.pwa) return;

  var BANNER_PAGES  = ['', 'index.html', 'dashboard-customer.html', 'dashboard-tasker.html'];
  var DISMISS_KEY   = 'st_pwa_dismissed_at';
  var DISMISS_DAYS  = 30;
  var PHONE_QUERY   = '(max-width: 768px)';

  var deferredPrompt = null;
  var banner = null;

  /* ── helpers (every storage call is wrapped: private mode can throw) ── */
  function readDismissed() {
    try { return Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch (e) { return 0; }
  }
  function writeDismissed() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }
  function dismissedRecently() {
    var at = readDismissed();
    return at > 0 && (Date.now() - at) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  var ua = navigator.userAgent || '';
  /* iPadOS 13+ reports itself as a Mac, so also check for a touch screen */
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  /* in-app browsers cannot add to the home screen: the person must open Safari */
  var isInApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Twitter|Snapchat|TikTok|BytedanceWebview/i.test(ua);
  /* real Safari: iOS, not Chrome/Firefox/Edge/Opera on iOS, not an in-app browser */
  var isIOSSafari = isIOS && !isInApp && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);

  function isPhone() {
    return !!(window.matchMedia && window.matchMedia(PHONE_QUERY).matches);
  }

  function onBannerPage() {
    var last = location.pathname.split('/').pop();
    return BANNER_PAGES.indexOf(last) !== -1;
  }

  /* ── service worker ── */
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* the site works without it */ });
    } catch (e) { /* ignore */ }
  }

  /* ── banner ── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    document.body.classList.remove('st-install-open');
  }

  function dismiss() {
    writeDismissed();
    hideBanner();
  }

  function showIOSSteps() {
    var dlg = el('dialog', 'st-confirm');
    dlg.setAttribute('aria-labelledby', 'stInstallStepsTitle');
    var body = el('div', 'st-confirm-body');
    var title = el('h2', 'st-confirm-title', 'Add StreetTasker to your home screen');
    title.id = 'stInstallStepsTitle';
    var list = el('ol', 'st-install-steps');
    [
      'Tap the Share button at the bottom of Safari (the square with an arrow pointing up).',
      'Scroll down and tap “Add to Home Screen”.',
      'Tap “Add”. StreetTasker now sits on your home screen like an app.'
    ].forEach(function (t) { list.appendChild(el('li', '', t)); });
    var actions = el('div', 'st-confirm-actions');
    var ok = el('button', 'btn btn-primary', 'Got it');
    ok.type = 'button';
    actions.appendChild(ok);
    body.append(title, list, actions);
    dlg.appendChild(body);
    ok.addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    if (dlg.showModal) dlg.showModal();
  }

  function promptAndroid() {
    if (!deferredPrompt) return;
    var p = deferredPrompt;
    deferredPrompt = null;
    p.prompt();
    p.userChoice.then(function (choice) {
      if (choice && choice.outcome === 'accepted') hideBanner();
      else dismiss();
    }).catch(function () { hideBanner(); });
  }

  /* which kind of banner this browser can honestly offer (null = none) */
  function mode() {
    if (isStandalone()) return null;
    if (isInApp) return 'inapp';
    if (isIOSSafari) return 'ios';
    if (deferredPrompt) return 'android';
    return null;
  }

  function buildBanner(m) {
    var b = el('aside', 'st-install');
    b.setAttribute('role', 'region');
    b.setAttribute('aria-label', 'Add StreetTasker to your home screen');

    var icon = el('img', 'st-install-icon');
    icon.src = 'images/pwa/icon-192.png';
    icon.alt = '';
    icon.width = 44; icon.height = 44;

    var text = el('div', 'st-install-text');
    text.appendChild(el('strong', 'st-install-title', 'Add StreetTasker to your home screen'));
    text.appendChild(el('span', 'st-install-sub',
      m === 'inapp' ? 'Open this page in Safari or Chrome to add it.' : 'Open it in one tap, like an app.'));

    var actions = el('div', 'st-install-actions');
    if (m === 'android' || m === 'ios') {
      var go = el('button', 'btn btn-primary btn-sm', m === 'ios' ? 'Show me how' : 'Add');
      go.type = 'button';
      go.addEventListener('click', m === 'ios' ? showIOSSteps : promptAndroid);
      actions.appendChild(go);
    }
    var no = el('button', 'btn btn-text btn-sm', 'Not now');
    no.type = 'button';
    no.addEventListener('click', dismiss);
    actions.appendChild(no);

    b.append(icon, text, actions);
    return b;
  }

  function show(force) {
    if (banner || !document.body) return;
    if (!isPhone()) return;
    if (!force && (!onBannerPage() || dismissedRecently())) return;
    var m = mode();
    if (!m) return;
    banner = buildBanner(m);
    document.body.appendChild(banner);
    document.body.classList.add('st-install-open');
  }

  /* ── events ── */
  /* js/app.js catches the browser's offer early (window.ST_INSTALL_EVENT) because it can fire
     before this file loads. The listener here covers pages that load this file on their own. */
  function onPrompt(e) {
    e.preventDefault();               /* we show our own button instead of the browser's mini-bar */
    deferredPrompt = e;
    show(false);
  }
  window.addEventListener('beforeinstallprompt', onPrompt);
  if (window.ST_INSTALL_EVENT) deferredPrompt = window.ST_INSTALL_EVENT;
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hideBanner();
  });

  window.ST.pwa = {
    show: function () { show(true); },
    onPrompt: onPrompt,
    /* for tests: what this browser was detected as */
    _mode: mode
  };

  registerWorker();
  /* iPhone and in-app browsers never fire beforeinstallprompt, so decide once the page is settled */
  /* This file is added by app.js, usually after the window's "load" event has already fired. */
  function later() { setTimeout(function () { show(false); }, 2500); }
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later);
})();

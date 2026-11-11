/* ============================================================
   STREETTASKER - verify-retry-nudge.js
   A pop-up for a signed-in person whose identity check did NOT go through, asking them to try again.
   Shown for these server statuses (idv_my_status): REVIEW_REQUIRED, FAILED, ABANDONED, EXPIRED, RESUBMIT_REQUESTED.
   NOT shown for NOT_STARTED, IN_PROGRESS, PENDING (still waiting) or VERIFIED: a person who is simply waiting must not be nagged.
   At most once per browser session and per status, never on the pages listed in SKIP, never over a guided tour.
   "Maybe later" closes it. Reads one status; writes nothing. Fails quiet (any error or unclear answer = show nothing).
   Loaded by js/app.js, so the pages that run it need no edit.
   ============================================================ */
(function () {
  'use strict';

  var SKIP = ['verify', 'verification-done', 'login', 'signup', 'reset-password', 'onboarding-tasker', '404', 'offline',
              'support', 'terms', 'privacy', 'cookies', 'data-consent', 'refunds', 'accessibility', 'ip-complaints',
              'design-system', 'flyer-preview'];
  var SEEN_PREFIX = 'st_verify_retry_seen_';

  function pageName() {
    var last = (window.location.pathname || '').split('/').pop() || 'index';
    return last.replace(/\.html$/i, '').toLowerCase() || 'index';
  }
  var page = pageName();
  if (SKIP.indexOf(page) !== -1 || page.indexOf('coordinator') === 0 || window.location.pathname.indexOf('/admin/') !== -1) return;

  function store(get, key, val) {
    try { return get ? sessionStorage.getItem(key) : sessionStorage.setItem(key, val); } catch (e) { return null; }
  }

  var ID_HELP = 'Use an original, valid government-issued ID, such as an international passport, driver\u2019s licence or national ID card. A passport photograph is not an ID.';

  /* What to say, from the server status. Pure: no page needed. Returns null when no pop-up is wanted. */
  function decide(status) {
    switch (status) {
      case 'REVIEW_REQUIRED':
      case 'FAILED':
      case 'ABANDONED':
        return { cta: 'Try again', title: 'Your ID check did not go through', text: 'We could not complete your identity verification. ' + ID_HELP };
      case 'EXPIRED':
        return { cta: 'Verify again', title: 'Your verification has expired', text: 'Please verify your identity again to keep using StreetTasker. ' + ID_HELP };
      case 'RESUBMIT_REQUESTED':
        return { cta: 'Continue verification', title: 'Your verification needs another step', text: 'Please repeat the steps we asked for to finish verifying your identity.' };
      default:
        return null;
    }
  }

  function waitForClient(tries, done) {
    if (window.supabase && window.supabase.auth && window.supabase.rpc) return done(window.supabase);
    if (tries <= 0) return done(null);
    window.setTimeout(function () { waitForClient(tries - 1, done); }, 100);
  }

  function css() {
    if (document.getElementById('stVerifyNudgeCss')) return;
    var s = document.createElement('style'); s.id = 'stVerifyNudgeCss';
    s.textContent =
      '.st-vnudge{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(18,18,18,.5)}' +
      '.st-vnudge[hidden]{display:none}' +
      '.st-vnudge-card{width:100%;max-width:400px;background:var(--color-bg,#fff);color:var(--color-text,#121212);border-radius:var(--radius-xl,20px);padding:28px 24px 20px;box-shadow:0 20px 50px rgba(0,0,0,.25);text-align:center;font-family:var(--font-body,Inter,system-ui,sans-serif)}' +
      '.st-vnudge-icon{width:56px;height:56px;margin:0 auto 14px;border-radius:16px;background:#FFF3E0;color:#B45F06;display:flex;align-items:center;justify-content:center}' +
      '.st-vnudge-card h2{margin:0 0 8px;font-family:var(--font-heading,Manrope,system-ui,sans-serif);font-size:1.25rem;line-height:1.25}' +
      '.st-vnudge-card p{margin:0 0 20px;font-size:.95rem;line-height:1.5;color:var(--color-text-secondary,#555)}' +
      '.st-vnudge-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;border-radius:999px;background:var(--color-primary,#0F6B46);color:#fff;font-weight:700;text-decoration:none}' +
      '.st-vnudge-go:focus-visible,.st-vnudge-later:focus-visible{outline:3px solid var(--color-primary,#0F6B46);outline-offset:2px}' +
      '.st-vnudge-later{margin-top:8px;width:100%;min-height:44px;border:0;background:none;color:var(--color-text-secondary,#555);font:inherit;font-weight:600;cursor:pointer}';
    document.head.appendChild(s);
  }

  function show(msg) {
    css();
    var root = document.createElement('div'); root.className = 'st-vnudge'; root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'stVNudgeTitle');
    var card = document.createElement('div'); card.className = 'st-vnudge-card';
    var ic = document.createElement('div'); ic.className = 'st-vnudge-icon'; ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    var h = document.createElement('h2'); h.id = 'stVNudgeTitle'; h.textContent = msg.title;
    var p = document.createElement('p'); p.textContent = msg.text;
    var go = document.createElement('a'); go.className = 'st-vnudge-go'; go.href = 'verify.html'; go.textContent = msg.cta;
    var later = document.createElement('button'); later.type = 'button'; later.className = 'st-vnudge-later'; later.textContent = 'Maybe later';
    card.appendChild(ic); card.appendChild(h); card.appendChild(p); card.appendChild(go); card.appendChild(later);
    root.appendChild(card); document.body.appendChild(root);

    function close() { document.removeEventListener('keydown', onKey); root.remove(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    later.addEventListener('click', close);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    document.addEventListener('keydown', onKey);
    try { go.focus(); } catch (e) { /* ignore */ }
  }

  /* Wait out a guided tour (up to ~15 s) instead of landing on top of it. */
  function showWhenFree(msg, key, tries) {
    if (document.querySelector('.st-tour') && tries > 0) return window.setTimeout(function () { showWhenFree(msg, key, tries - 1); }, 5000);
    if (document.querySelector('.st-tour')) return;
    store(false, key, '1');
    show(msg);
  }

  function run() {
    waitForClient(50, async function (sb) {
      if (!sb) return;
      try {
        var s = await sb.auth.getSession();
        var user = s && s.data && s.data.session && s.data.session.user;
        if (!user) return;
        var r = await sb.rpc('idv_my_status');
        if (r.error || !r.data || typeof r.data.status !== 'string') return;   /* cannot tell: say nothing */
        var status = r.data.status;
        var msg = decide(status);
        if (!msg) return;
        var key = SEEN_PREFIX + status;
        if (store(true, key)) return;
        showWhenFree(msg, key, 3);
      } catch (e) { /* quiet */ }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.setTimeout(run, 1500); });
  else window.setTimeout(run, 1500);

  window.ST = window.ST || {};
  window.ST.verifyRetryNudge = { decide: decide };
})();

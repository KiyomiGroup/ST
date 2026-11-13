/* ============================================================
   STREETTASKER - tasker-live-nudge.js
   A pop-up for a signed-in TASKER whose profile is not shown to customers because they have no live service
   (the homepage and Find Taskers are built from live services: services.available = true).
     - no services at all           -> "Post a service" (post-service.html)
     - services, but none are live  -> "Go to My Services" (my-services.html: paused or not live yet)
   Shown at most once per browser session, only while the tasker is acting as a tasker, never on the pages listed in
   SKIP, never over a guided tour. "Maybe later" closes it. Reads one row; writes nothing. Fails quiet.
   Loaded by js/app.js, so the pages that run it need no edit.
   ============================================================ */
(function () {
  'use strict';

  var SKIP = ['post-service', 'my-services', 'verify', 'verification-done', 'login', 'signup', 'reset-password',
              'onboarding-tasker', '404', 'offline', 'support', 'terms', 'privacy', 'cookies', 'data-consent', 'refunds',
              'accessibility', 'ip-complaints', 'design-system', 'flyer-preview'];
  var SEEN_KEY = 'st_live_nudge_seen';

  function pageName() {
    var last = (window.location.pathname || '').split('/').pop() || 'index';
    return last.replace(/\.html$/i, '').toLowerCase() || 'index';
  }
  var page = pageName();
  if (SKIP.indexOf(page) !== -1 || page.indexOf('coordinator') === 0 || window.location.pathname.indexOf('/admin/') !== -1) return;

  function store(get, key, val) {
    try { return get ? sessionStorage.getItem(key) : sessionStorage.setItem(key, val); } catch (e) { return null; }
  }
  if (store(true, SEEN_KEY)) return;

  /* What to say, from the number of services the tasker has and how many are live. Pure: no page needed. */
  function decide(total, live) {
    if (live > 0) return null;
    if (total === 0) {
      return { href: 'post-service.html', cta: 'Post a service', title: 'Customers can\u2019t see you yet',
               text: 'Your profile only shows on the homepage and in search after you post a service. It takes about two minutes.' };
    }
    return { href: 'my-services.html', cta: 'Go to My Services', title: 'Your services are not live',
             text: 'None of your services are showing to customers right now, so your profile is hidden. Open My Services to switch one on.' };
  }

  function waitForClient(tries, done) {
    if (window.supabase && window.supabase.auth && window.supabase.from) return done(window.supabase);
    if (tries <= 0) return done(null);
    window.setTimeout(function () { waitForClient(tries - 1, done); }, 100);
  }

  function css() {
    if (document.getElementById('stLiveNudgeCss')) return;
    var s = document.createElement('style'); s.id = 'stLiveNudgeCss';
    s.textContent =
      '.st-nudge{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(18,18,18,.5)}' +
      '.st-nudge[hidden]{display:none}' +
      '.st-nudge-card{width:100%;max-width:400px;background:var(--color-bg,#fff);color:var(--color-text,#121212);border-radius:var(--radius-xl,20px);padding:28px 24px 20px;box-shadow:0 20px 50px rgba(0,0,0,.25);text-align:center;font-family:var(--font-body,Inter,system-ui,sans-serif)}' +
      '.st-nudge-icon{width:56px;height:56px;margin:0 auto 14px;border-radius:16px;background:var(--color-accent-soft,#E6F4EC);color:var(--color-primary,#0F6B46);display:flex;align-items:center;justify-content:center}' +
      '.st-nudge-card h2{margin:0 0 8px;font-family:var(--font-heading,Manrope,system-ui,sans-serif);font-size:1.25rem;line-height:1.25}' +
      '.st-nudge-card p{margin:0 0 20px;font-size:.95rem;line-height:1.5;color:var(--color-text-secondary,#555)}' +
      '.st-nudge-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;border-radius:999px;background:var(--color-primary,#0F6B46);color:#fff;font-weight:700;text-decoration:none}' +
      '.st-nudge-go:focus-visible,.st-nudge-later:focus-visible{outline:3px solid var(--color-primary,#0F6B46);outline-offset:2px}' +
      '.st-nudge-later{margin-top:8px;width:100%;min-height:44px;border:0;background:none;color:var(--color-text-secondary,#555);font:inherit;font-weight:600;cursor:pointer}';
    document.head.appendChild(s);
  }

  function show(msg) {
    css();
    var root = document.createElement('div'); root.className = 'st-nudge'; root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'stNudgeTitle');
    var card = document.createElement('div'); card.className = 'st-nudge-card';
    var ic = document.createElement('div'); ic.className = 'st-nudge-icon'; ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';
    var h = document.createElement('h2'); h.id = 'stNudgeTitle'; h.textContent = msg.title;
    var p = document.createElement('p'); p.textContent = msg.text;
    var go = document.createElement('a'); go.className = 'st-nudge-go'; go.href = msg.href; go.textContent = msg.cta;
    var later = document.createElement('button'); later.type = 'button'; later.className = 'st-nudge-later'; later.textContent = 'Maybe later';
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
  function showWhenFree(msg, tries) {
    /* also wait for the "try your ID check again" pop-up (js/verify-retry-nudge.js) so the two never stack */
    /* and the first-visit prompts on the homepage (Post a service invitation, Bisi's tour question): while one is on screen or
       waiting its turn (ST.promptsPending, kept by js/post-service-invite.js and js/mascot.js), this pop-up waits too */
    var busy = '.st-tour, .st-vnudge, .psi-overlay, .st-mascot';
    function isBusy() { return !!document.querySelector(busy) || !!(window.ST && window.ST.promptsPending > 0); }
    if (isBusy() && tries > 0) return window.setTimeout(function () { showWhenFree(msg, tries - 1); }, 5000);
    if (isBusy()) return;
    store(false, SEEN_KEY, '1');
    show(msg);
  }

  function run() {
    waitForClient(50, async function (sb) {
      if (!sb) return;
      try {
        var s = await sb.auth.getSession();
        var user = s && s.data && s.data.session && s.data.session.user;
        if (!user) return;
        /* acting as a tasker? (the site keeps the active role in st_role; fall back to the account's role) */
        var role = null;
        try { role = localStorage.getItem('st_role'); } catch (e) { role = null; }
        if (!role && window.ST && window.ST.auth && window.ST.auth.getUserRole) role = await window.ST.auth.getUserRole(user);
        if (role !== 'tasker') return;
        var r = await sb.from('services').select('id, available').eq('user_id', user.id).limit(100);
        if (r.error || !Array.isArray(r.data)) return;   /* cannot tell: say nothing */
        var live = r.data.filter(function (x) { return x.available === true; }).length;
        var msg = decide(r.data.length, live);
        if (msg) showWhenFree(msg, 3);
      } catch (e) { /* quiet */ }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.setTimeout(run, 2500); });
  else window.setTimeout(run, 2500);

  window.ST = window.ST || {};
  window.ST.liveNudge = { decide: decide };
})();

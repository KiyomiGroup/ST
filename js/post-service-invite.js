/* ============================================================
   StreetTasker: "Post a service" invitation (home-feed.html, providers only).

   A pop-up that offers a provider a guided, one-question-per-page way to post their first service.
   It runs BEFORE the first-login tour (js/onboarding-tours-home.js) and the tour waits for it.

   When it shows:
   - the person is a tasker (provider) with no service posted yet (services table, then the older taskers table);
   - first visit: the tasker home tour has not been seen yet, and the pop-up opens after ~10 seconds on the page;
   - second sign-in: if they declined, it comes back once, on their next sign-in (Supabase last_sign_in_at changes),
     and only if they still have no service. After that it never comes back by itself.
   It never shows on a tour replay (?tour=<id>), and never when anything cannot be read (no guessing).

   Buttons:
   - Accept guide     closes the pop-up and fires `st:post-service-guide` on document. The guided pages come next
                      (not built yet), so nothing else happens for now.
   - Decline          closes it; the reminder rules above apply.
   - Fill form myself link to post-service.html (counts as a decline).

   Memory: localStorage `st_psi:<userId>` = { status, signIn, declines }. Per browser, like the tour fallback.

   Two parts: `pure` (no DOM, unit-tested in tests/post-service-invite.test.js) and the browser runtime.
   ============================================================ */
(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) { module.exports = built.pure; }
  else { root.ST = root.ST || {}; root.ST.postServiceInvite = built.create(root); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DELAY_MS = 10000;
  var MANUAL_URL = 'post-service.html';
  var TOUR_ID = 'tasker-home';

  /* ════════════════ pure core ════════════════ */

  /* Should the pop-up open?
       rec   saved memory or null     { status: 'declined' | 'accepted', signIn, declines }
       ctx   { hasService, tourStatus ('new'|'in_progress'|'completed'|'skipped'|null), signIn (this sign-in), replay }
     Returns { show: boolean, reason }. */
  function decide(rec, ctx) {
    ctx = ctx || {};
    if (ctx.replay) return { show: false, reason: 'replay' };
    if (ctx.hasService !== false) return { show: false, reason: ctx.hasService === true ? 'has-service' : 'unknown' };
    if (!rec) {
      if (ctx.tourStatus !== 'new') return { show: false, reason: 'not-first-visit' };
      return { show: true, reason: 'first-visit' };
    }
    if (rec.status === 'accepted') return { show: false, reason: 'accepted' };
    if (rec.status === 'declined') {
      if ((rec.declines || 0) >= 2) return { show: false, reason: 'asked-twice' };
      if (!ctx.signIn || !rec.signIn) return { show: false, reason: 'unknown-sign-in' };
      if (ctx.signIn === rec.signIn) return { show: false, reason: 'same-sign-in' };
      return { show: true, reason: 'second-sign-in' };
    }
    return { show: false, reason: 'unknown-status' };
  }

  /* Memory after an answer. */
  function remember(rec, answer, signIn) {
    if (answer === 'accepted') return { status: 'accepted', signIn: signIn || null, declines: (rec && rec.declines) || 0 };
    return { status: 'declined', signIn: signIn || null, declines: ((rec && rec.declines) || 0) + 1 };
  }

  var pure = { decide: decide, remember: remember, DELAY_MS: DELAY_MS, MANUAL_URL: MANUAL_URL };

  /* ════════════════ browser runtime ════════════════ */

  function create(win) {
    var doc = win.document;
    var open = null;

    function key(uid) { return 'st_psi:' + uid; }
    function read(uid) { try { return JSON.parse(win.localStorage.getItem(key(uid)) || 'null'); } catch (e) { return null; } }
    function write(uid, rec) { try { win.localStorage.setItem(key(uid), JSON.stringify(rec)); } catch (e) {} }

    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    /* Does the provider already have a service? true / false, or null when it cannot be read. */
    async function hasService(uid) {
      try {
        var r = await win.supabase.from('services').select('id', { count: 'exact', head: true }).eq('user_id', uid);
        if (r.error) return null;
        if ((r.count || 0) > 0) return true;
        /* Older accounts keep their listing in the taskers table */
        var t = await win.supabase.from('taskers').select('id', { count: 'exact', head: true }).eq('user_id', String(uid));
        if (t.error) return false;   /* table may not exist for new accounts: the services check already said none */
        return (t.count || 0) > 0;
      } catch (e) { return null; }
    }

    /* Builds and shows the pop-up. Resolves with 'accepted' | 'declined' | 'manual'. */
    function showDialog() {
      return new Promise(function (resolve) {
        var lastFocus = doc.activeElement;
        var overlay = el('div', 'psi-overlay');
        var box = el('div', 'psi-box');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'psiTitle');
        box.setAttribute('aria-describedby', 'psiText');
        box.tabIndex = -1;

        var title = el('h2', 'psi-title', 'Post a service');
        title.id = 'psiTitle';
        var text = el('p', 'psi-text', 'Let us guide you through it, one quick question at a time. You can save a draft and come back any time.');
        text.id = 'psiText';

        var actions = el('div', 'psi-actions');
        var accept = el('button', 'btn btn-primary btn-lg btn-full', 'Accept guide');
        accept.type = 'button';
        var decline = el('button', 'btn btn-outline btn-lg btn-full', 'Decline');
        decline.type = 'button';
        actions.append(accept, decline);

        var manual = el('a', 'btn btn-text psi-link', 'Fill form myself');
        manual.href = MANUAL_URL;

        box.append(title, text, actions, manual);
        overlay.appendChild(box);
        doc.body.appendChild(overlay);
        doc.documentElement.classList.add('psi-lock');
        accept.focus();

        function done(answer) {
          doc.removeEventListener('keydown', onKey, true);
          doc.documentElement.classList.remove('psi-lock');
          overlay.remove();
          open = null;
          if (answer !== 'manual' && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
          resolve(answer);
        }
        function onKey(ev) {
          if (ev.key === 'Escape') { ev.preventDefault(); done('declined'); return; }
          if (ev.key !== 'Tab') return;
          var f = [accept, decline, manual];
          var i = f.indexOf(doc.activeElement);
          if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus(); }
          else if (!ev.shiftKey && (i === f.length - 1)) { ev.preventDefault(); f[0].focus(); }
          else if (i === -1) { ev.preventDefault(); f[0].focus(); }
        }
        doc.addEventListener('keydown', onKey, true);
        accept.addEventListener('click', function () { done('accepted'); });
        decline.addEventListener('click', function () { done('declined'); });
        manual.addEventListener('click', function () { done('manual'); });   /* the link then opens the form */
        open = { close: function () { done('declined'); } };
      });
    }

    /* Call once when the provider's home page is ready. Resolves with:
         'none'      not shown (not eligible, or could not tell): carry on with the tour
         'declined'  they said no: carry on with the tour
         'accepted'  they want the guide: the tour should not start
         'manual'    they are going to the form themselves: the tour should not start */
    async function start(opts) {
      opts = opts || {};
      try {
        if (open) return 'none';
        var replay = /[?&]tour=/.test(win.location.search || '');
        if (replay) return 'none';
        var sess = await win.supabase.auth.getSession();
        var user = sess && sess.data && sess.data.session && sess.data.session.user;
        if (!user) return 'none';
        var signIn = user.last_sign_in_at || null;

        var rec = read(user.id);
        var tourStatus = null;
        if (win.ST && win.ST.onboarding && win.ST.onboarding.status) tourStatus = await win.ST.onboarding.status(TOUR_ID);

        var has = await hasService(user.id);
        var d = decide(rec, { hasService: has, tourStatus: tourStatus, signIn: signIn, replay: false });
        if (!d.show) return 'none';

        /* About 10 seconds on the page first, so the pop-up does not greet them the moment they arrive */
        await new Promise(function (r) { win.setTimeout(r, opts.delay != null ? opts.delay : DELAY_MS); });
        if (!win.document.body) return 'none';
        /* Something else may have taken over meanwhile (a replayed tour): do not stack on top of it */
        if (win.ST && win.ST.onboarding && win.ST.onboarding.isActive && win.ST.onboarding.isActive()) return 'none';

        var answer = await showDialog();
        write(user.id, remember(rec, answer === 'accepted' ? 'accepted' : 'declined', signIn));
        if (answer === 'accepted') {
          try { doc.dispatchEvent(new win.CustomEvent('st:post-service-guide', { detail: { userId: user.id } })); } catch (e) {}
        }
        return answer;
      } catch (e) { return 'none'; }
    }

    return { start: start, _show: showDialog };
  }

  return { pure: pure, create: create };
});

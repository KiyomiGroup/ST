/* Identity re-verification gate (stage V1g-3). Loaded by js/app.js on every page that runs it.
   Asks the server (idv_my_gate) whether this signed-in person must verify. If so, every page except the ones
   listed below sends them to verify.html. Page-level only: it is NOT a lock (the database guard is V1h).
   Fails OPEN: if the check cannot be made, the person is not locked out. Writes nothing. */
(function () {
  'use strict';
  var ALLOWED = ['verify', 'verification-done', 'data-consent', 'terms', 'privacy', 'support', 'login', 'signup', '404'];
  var CACHE_KEY = 'st_gate_ok';
  var CACHE_MS = 5 * 60 * 1000;

  function pageName() {
    var last = (window.location.pathname || '').split('/').pop() || 'index';
    return last.replace(/\.html$/i, '').toLowerCase() || 'index';
  }
  if (ALLOWED.indexOf(pageName()) !== -1) return;

  function waitForClient(tries, done) {
    if (window.supabase && window.supabase.auth && window.supabase.rpc) return done(window.supabase);
    if (tries <= 0) return done(null);
    window.setTimeout(function () { waitForClient(tries - 1, done); }, 100);
  }

  function cachedOk(uid) {
    try {
      var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      return !!(c && c.uid === uid && (Date.now() - c.t) < CACHE_MS);
    } catch (e) { return false; }
  }
  function remember(uid) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ uid: uid, t: Date.now() })); } catch (e) { /* storage blocked */ }
  }

  waitForClient(50, async function (sb) {
    if (!sb) return;
    try {
      var s = await sb.auth.getSession();
      var uid = s && s.data && s.data.session && s.data.session.user && s.data.session.user.id;
      if (!uid || cachedOk(uid)) return;
      var r = await sb.rpc('idv_my_gate');
      if (r.error || !r.data) return;
      if (r.data.required === true) {
        try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        window.location.replace('verify.html?gate=1');
        return;
      }
      remember(uid);
    } catch (e) { /* fail open */ }
  });
})();

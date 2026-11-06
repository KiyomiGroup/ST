/* StreetTasker referral capture (stage M14).
   A link like https://streettasker.com/signup.html?ref=ST4K9X2A records ONE visit through the database (referral_track_visit) and keeps the visit id
   in this browser. FIRST TOUCH WINS: while a stored visit is still valid, a later link never replaces it. The sign-up passes the visit id on and the
   DATABASE decides everything (is the code real, is it inside the window, is it a self-referral). A click never earns points.
   If anything here fails, nothing happens and sign-up is not affected. */
(function () {
  var KEY = 'st_ref_visit';
  var KEEP_DAYS = 90; /* the database applies the real window (homepage_settings); this is only how long the browser remembers the id */

  function read() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && o.id && o.ts && (Date.now() - o.ts) < KEEP_DAYS * 864e5) return o;
    } catch (e) {}
    return null;
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  window.STReferral = {
    visitId: function () { var o = read(); return o ? o.id : null; },
    clear: clear,
  };

  function capture() {
    var code = null;
    try { code = new URLSearchParams(window.location.search).get('ref'); } catch (e) {}
    if (!code) return;
    code = String(code).trim().toUpperCase();
    if (!/^ST[A-Z0-9]{6}$/.test(code)) return;
    if (read()) return; /* first touch wins */
    if (!window.supabase || !window.supabase.rpc) return;
    Promise.resolve(window.supabase.rpc('referral_track_visit', { p_code: code })).then(function (res) {
      var id = res && res.data;
      if (id && typeof id === 'string') {
        try { localStorage.setItem(KEY, JSON.stringify({ id: id, ts: Date.now() })); } catch (e) {}
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', capture);
  else capture();
})();

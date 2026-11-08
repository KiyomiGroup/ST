/* StreetTasker Admin: two-step verification helper (stage A3c).
   Wraps Supabase Auth MFA (authenticator app, TOTP). Used by the sign-in page (enter the 6-digit code) and by My profile
   (set up, list, remove). It holds no secret of its own: the QR code and the set-up key come from Supabase for one set-up
   attempt, are drawn on the page, and are never stored or logged. Data is written with textContent only.
   Set-up is NOT offered on the sign-in page: a password alone must never be enough to add a second step. */
'use strict';
(function () {
  function mfa() { return window.supabase && window.supabase.auth && window.supabase.auth.mfa; }

  function cleanCode(v) { return String(v || '').replace(/\s+/g, ''); }
  function validCode(v) { return /^\d{6}$/.test(cleanCode(v)); }

  function friendly(err) {
    var m = String((err && err.message) || '');
    var c = String((err && (err.code || err.status)) || '');
    if (/too many|rate limit|over_request_rate_limit|429/i.test(m + ' ' + c)) return 'Too many attempts. Wait a minute and try again.';
    if (/invalid.*(code|totp)|mfa_verification_failed|verification failed|code.*(invalid|expired|incorrect)/i.test(m + ' ' + c)) return 'That code did not work. Check the code in your app and try again. Codes change every 30 seconds.';
    if (/aal2|assurance|insufficient/i.test(m)) return 'For safety, sign in again with your code first, then try again.';
    if (/failed to fetch|network/i.test(m)) return "Couldn't reach the server. Nothing was changed.";
    return 'Something went wrong. Nothing was changed. Try again.';
  }

  /* Verified authenticator apps on this login. Throws on a server error. */
  async function verifiedFactors() {
    var r = await mfa().listFactors();
    if (r.error) throw r.error;
    return ((r.data && r.data.totp) || []).filter(function (f) { return !f.status || f.status === 'verified'; });
  }

  /* Starts a set-up: returns { factorId, qr, secret }. Unfinished earlier attempts are cleared first, because Supabase
     refuses a second factor with the same name while an unverified one exists. */
  async function startEnrol() {
    var all = await mfa().listFactors();
    if (all.error) throw all.error;
    var stale = ((all.data && all.data.all) || []).filter(function (f) { return f.status === 'unverified'; });
    for (var i = 0; i < stale.length; i++) { try { await mfa().unenroll({ factorId: stale[i].id }); } catch (e) { /* the new attempt will report it */ } }
    var r = await mfa().enroll({ factorType: 'totp', issuer: 'StreetTasker Admin', friendlyName: 'Authenticator ' + new Date().toISOString().slice(0, 16).replace('T', ' ') });
    if (r.error) throw r.error;
    var d = r.data || {};
    var qr = d.totp && d.totp.qr_code;
    /* only an image from Supabase is ever drawn */
    if (typeof qr !== 'string' || qr.indexOf('data:image/svg+xml') !== 0) qr = '';
    return { factorId: d.id, qr: qr, secret: (d.totp && d.totp.secret) || '' };
  }

  /* Proves the 6-digit code (set-up and sign-in use the same call). Resolves { ok: true } or { ok: false, message }. */
  async function verify(factorId, code) {
    if (!validCode(code)) return { ok: false, message: 'Enter the 6 digits shown in your authenticator app.' };
    try {
      var r = await mfa().challengeAndVerify({ factorId: factorId, code: cleanCode(code) });
      if (r.error) return { ok: false, message: friendly(r.error) };
      return { ok: true };
    } catch (e) { return { ok: false, message: friendly(e) }; }
  }

  async function remove(factorId) {
    var r = await mfa().unenroll({ factorId: factorId });
    if (r.error) throw r.error;
  }

  window.AdminMfa = { verifiedFactors: verifiedFactors, startEnrol: startEnrol, verify: verify, remove: remove, validCode: validCode, friendly: friendly };
})();

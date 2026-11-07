/* StreetTasker promotional flyer: real data (Stage 3).
   Turns what the Tasker profile page already knows into the plain data object that STFlyer.render() draws.
   All profile reading lives here; js/flyer-template.js stays pure drawing.

     STFlyerData.qrLink(code, userId)                  the link the QR carries (the ONLY place that builds it)
     STFlyerData.fromProfile(model, code, userId)      -> { name, profession, location, services, photoUrl, qrUrl }
     STFlyerData.prepare(model, user, userId)          -> Promise<{ ok, reason, message, data }> for the Stage 4 button

   prepare() reasons when ok is false:
     'not-owner'  the viewer is not the owner of this profile (the flyer is for the owner only)
     'unavailable' sample or coordinator-managed profile (no own account, photo cannot be exported)
     'no-code'    the Tasker has no referral profile yet (message says what to do)
     'error'      the referral lookup failed (message says to try again)
   Needs: js/referral-data.js (STReferralData). Reads nothing else, writes nothing. */
(function (root) {
  'use strict';

  var CODE_RE = /^ST[A-Z0-9]{6}$/;   /* same shape js/referral-capture.js accepts, so a QR never carries a code the sign-up page would ignore */

  function str(v) { return String(v == null ? '' : v).trim(); }

  /* https://streettasker.com/signup.html?ref=<CODE>&redirect=tasker-profile.html%3Fid%3D<user id>
     After sign-up the new person lands on this Tasker's profile (js/auth.js carries ?redirect= through sign-up, the verification email and first log-in). */
  function qrLink(code, userId) {
    var c = str(code).toUpperCase(), id = str(userId);
    if (!CODE_RE.test(c) || !id) return '';
    return root.location.origin + '/signup.html?ref=' + encodeURIComponent(c) +
      '&redirect=' + encodeURIComponent('tasker-profile.html?id=' + id);
  }

  /* model = the profile page's buildModel() result: name, service (profession; NOT headline), location, photo, services [{title}] */
  function fromProfile(model, code, userId) {
    var m = model || {};
    return {
      name: str(m.name),
      profession: str(m.service),
      location: str(m.location),
      services: (Array.isArray(m.services) ? m.services : []).map(function (s) { return str(s && s.title); }).filter(Boolean),
      photoUrl: str(m.photo),
      qrUrl: qrLink(code, userId)
    };
  }

  async function prepare(model, user, userId) {
    var m = model || {};
    if (!user || !userId || user.id !== userId) return { ok: false, reason: 'not-owner', message: '' };
    if (m.isDemo || m.isLocal) return { ok: false, reason: 'unavailable', message: '' };
    if (!root.STReferralData) return { ok: false, reason: 'error', message: 'The flyer could not load. Please refresh the page and try again.' };
    var row;
    try { row = await root.STReferralData.mine('tasker'); }
    catch (e) { return { ok: false, reason: 'error', message: 'We could not check your referral link. Please try again in a moment.' }; }
    var code = row && str(row.code).toUpperCase();
    if (!code || !CODE_RE.test(code)) {
      return { ok: false, reason: 'no-code', message: 'Your referral link is not ready yet. Finish setting up your account and check back soon, then your flyer will be ready to download.' };
    }
    return { ok: true, reason: '', message: '', data: fromProfile(m, code, userId) };
  }

  root.STFlyerData = { qrLink: qrLink, fromProfile: fromProfile, prepare: prepare };
})(window);

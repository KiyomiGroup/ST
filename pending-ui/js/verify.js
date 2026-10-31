/* ============================================================
   STREET TASKER — verify.js  (Didit stage V3b: self mode)
   Replaces the old soft-check version. This file NEVER writes
   is_verified, verified, verified_at or any verification status.
   Only the server (Didit webhook / sync -> idv_apply_event) can.
   Success is shown only from the server read idv_my_status().
   Proxy mode (coordinator for a Local Tasker) is stage V3c.
   ============================================================ */
'use strict';

(function () {
  var CONSENT_FALLBACK_MSG = 'Something went wrong. Please try again.';
  var RETURN_FLAG = 'st_idv_out';
  var RETURN_FLAG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  var PANELS_WITH_START = { NOT_STARTED: 1, FAILED: 1, EXPIRED: 1 };

  /* ── helpers shared with other pages ─────────────────────── */

  async function currentUser() {
    try {
      var r = await window.supabase.auth.getUser();
      return (r && r.data && r.data.user) || null;
    } catch (e) { return null; }
  }

  /** Server status for the signed-in user (null if not available). */
  async function getServerStatus() {
    try {
      var r = await window.supabase.rpc('idv_my_status');
      if (r.error || !r.data) return null;
      return r.data;
    } catch (e) { return null; }
  }

  /** True only when the server has set the verified flag (read-only check). */
  async function isUserVerified() {
    var user = await currentUser();
    if (!user) return false;
    try {
      var r = await window.supabase.from('users').select('is_verified').eq('id', user.id).maybeSingle();
      return !!(r.data && r.data.is_verified === true);
    } catch (e) { return false; }
  }

  /** Old shape kept so existing dashboards keep working:
      { status: 'approved' | 'pending' | 'rejected', rejection_reason: '' } or null.
      The reason is always empty: Didit's reasons are never shown or stored here. */
  async function getVerificationStatus() {
    var s = await getServerStatus();
    if (!s) return null;
    var map = {
      VERIFIED: 'approved',
      PENDING: 'pending', IN_PROGRESS: 'pending', REVIEW_REQUIRED: 'pending', RESUBMIT_REQUESTED: 'pending',
      FAILED: 'rejected', ABANDONED: 'rejected', EXPIRED: 'rejected',
    };
    var legacy = map[s.status];
    if (!legacy) return null;
    return { status: legacy, rejection_reason: '', idv_status: s.status };
  }

  /** Gate: call before an action that needs a verified user. */
  async function requireVerification(actionName) {
    if (await isUserVerified()) return true;
    var s = await getServerStatus();
    if (s && s.verified === true) return true;
    if (s && (s.status === 'PENDING' || s.status === 'IN_PROGRESS' || s.status === 'REVIEW_REQUIRED')) {
      if (typeof showToast === 'function') {
        showToast('Your verification is not finished yet. You can ' + (actionName || 'do this') + ' once it is verified.');
      }
      return false;
    }
    var back = encodeURIComponent(window.location.href);
    window.location.href = 'verify.html?return=' + back + '&action=' + encodeURIComponent(actionName || 'continue');
    return false;
  }

  /** Existing behaviour kept (not part of verification): drafts go live. Runs only after the
      SERVER says verified. Stage V3d decides the final gating. */
  async function publishDrafts(userId) {
    try {
      await window.supabase.from('tasks').update({ status: 'open' })
        .or('customer_id.eq.' + userId + ',user_id.eq.' + userId).eq('status', 'draft');
      await window.supabase.from('services').update({ available: true })
        .eq('user_id', userId).eq('available', false);
    } catch (e) { console.warn('[Verify] Could not publish drafts.'); }
  }

  window.ST = window.ST || {};
  window.ST.verify = { getVerificationStatus: getVerificationStatus, isUserVerified: isUserVerified,
                       requireVerification: requireVerification, getServerStatus: getServerStatus };

  /* ── the verify page (runs only where #verifyMain exists) ── */

  function $(id) { return document.getElementById(id); }
  function setHidden(el, hide) { if (el) el.hidden = !!hide; }
  function say(el, text) { if (!el) return; el.textContent = text || ''; el.hidden = !text; }

  /** Only same-site relative targets, never verify.html itself (no open redirect). */
  function safeReturnUrl() {
    try {
      var raw = new URLSearchParams(window.location.search).get('return');
      if (!raw) return null;
      var u = new URL(raw, window.location.href);
      if (u.origin !== window.location.origin) return null;
      if (/\/verify\.html$/i.test(u.pathname)) return null;
      return u.pathname + u.search + u.hash;
    } catch (e) { return null; }
  }

  function isDiditUrl(raw) {
    try {
      var u = new URL(raw);
      return u.protocol === 'https:' && (u.hostname === 'didit.me' || u.hostname.slice(-9) === '.didit.me');
    } catch (e) { return false; }
  }

  async function callFunction(name, body) {
    var r = await window.supabase.functions.invoke(name, { body: body });
    if (r.error) {
      var msg = '';
      try { var j = await r.error.context.json(); msg = (j && j.message) || ''; } catch (e) { /* no body */ }
      throw new Error(msg || CONSENT_FALLBACK_MSG);
    }
    if (!r.data || r.data.ok !== true) throw new Error((r.data && r.data.message) || CONSENT_FALLBACK_MSG);
    return r.data;
  }

  function cameBackFromDidit() {
    var flagged = false;
    try {
      var t = parseInt(sessionStorage.getItem(RETURN_FLAG) || '', 10);
      flagged = t > 0 && (Date.now() - t) < RETURN_FLAG_MAX_AGE_MS;
    } catch (e) { /* storage blocked */ }
    var q = new URLSearchParams(window.location.search);
    return flagged || q.has('verificationSessionId');
  }
  function clearReturnMarks() {
    try { sessionStorage.removeItem(RETURN_FLAG); } catch (e) { /* ignore */ }
    try {
      var q = new URLSearchParams(window.location.search);
      if (q.has('verificationSessionId') || q.has('status')) {
        q.delete('verificationSessionId'); q.delete('status');
        var qs = q.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
      }
    } catch (e) { /* ignore */ }
  }

  function initPage() {
    var main = $('verifyMain');
    if (!main) return;

    var state = { status: null, busy: false };
    var consentBlock = $('consentBlock');
    var pageVersion = consentBlock ? consentBlock.getAttribute('data-consent-version') : null;

    function showPanel(name) {
      var panels = main.querySelectorAll('[data-status-panel]');
      for (var i = 0; i < panels.length; i++) {
        panels[i].hidden = panels[i].getAttribute('data-status-panel') !== name;
      }
    }

    function updateStartButton() {
      var btn = $('verifyStartBtn');
      if (!btn) return;
      var agreed = !!(state.consentGiven || ($('consentCheck') && $('consentCheck').checked));
      btn.disabled = state.busy || !agreed || !state.versionOk;
    }

    function render(s) {
      var status = s.status === 'ABANDONED' ? 'FAILED' : s.status;
      state.status = status;
      state.consentGiven = s.consent_given === true && s.consent_version === pageVersion;
      state.versionOk = !pageVersion || s.consent_version === pageVersion;

      setHidden($('verifyLoading'), true);
      setHidden(main, false);
      showPanel(status);
      setHidden($('verifyStart'), !PANELS_WITH_START[status]);

      if (!state.versionOk) {
        say($('verifyError'), 'This page is out of date. Please reload it.');
      }
      setHidden($('consentSelf'), state.consentGiven);
      setHidden($('consentDone'), !state.consentGiven);
      updateStartButton();

      if (status === 'VERIFIED') {
        var next = $('verifyContinueBtn');
        var back = safeReturnUrl();
        if (next && back) next.setAttribute('href', back);
        currentUser().then(function (u) { if (u) publishDrafts(u.id); });
      }
    }

    async function load() {
      var s = await getServerStatus();
      if (!s) {
        setHidden($('verifyLoading'), true);
        say($('verifyError'), 'We could not load your verification status. Please reload the page or try again later.');
        return;
      }
      render(s);
    }

    async function sync(returned) {
      try {
        await callFunction('didit-sync', { mode: 'self', returned: !!returned });
        return true;
      } catch (e) {
        say($('verifyNotice'), 'We could not reach the verification service just now. Showing your last saved status.');
        return false;
      }
    }

    async function startFlow() {
      if (state.busy) return;
      state.busy = true; updateStartButton();
      say($('verifyError'), '');
      try {
        if (!state.consentGiven) {
          var c = await window.supabase.rpc('idv_give_consent', { p_version: pageVersion });
          if (c.error) throw new Error(c.error.message || CONSENT_FALLBACK_MSG);
          state.consentGiven = true;
        }
        var made = await callFunction('didit-create-session', { mode: 'self', request_id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10) });
        if (!isDiditUrl(made.url)) throw new Error(CONSENT_FALLBACK_MSG);
        try { sessionStorage.setItem(RETURN_FLAG, String(Date.now())); } catch (e) { /* ignore */ }
        window.location.href = made.url;
      } catch (e) {
        say($('verifyError'), e.message || CONSENT_FALLBACK_MSG);
        state.busy = false; updateStartButton();
      }
    }

    async function refresh(btn) {
      if (state.busy) return;
      state.busy = true;
      if (btn) btn.disabled = true;
      var before = state.status;
      var reached = await sync(false);
      await load();
      if (reached) {
        say($('verifyNotice'), state.status === before ? 'No update yet. Please check again in a little while.' : '');
      }
      /* Wait before another check: every check costs one request to Didit. */
      window.setTimeout(function () { state.busy = false; if (btn) btn.disabled = false; }, 5000);
    }

    /* events */
    var check = $('consentCheck');
    if (check) check.addEventListener('change', updateStartButton);
    main.addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-action]') : null;
      if (!el) return;
      var action = el.getAttribute('data-action');
      if (action === 'start' || action === 'resume') startFlow();
      else if (action === 'refresh') refresh(el);
      else if (action === 'retry') {
        if (state.consentGiven) startFlow();
        else { setHidden($('verifyStart'), false); var c = $('consentCheck'); if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); } }
      }
    });

    /* boot */
    (async function () {
      var user = null;
      try { user = await window.ST.auth.requireAuth(); } catch (e) { user = null; }
      if (!user) return;
      if (cameBackFromDidit()) { await sync(true); clearReturnMarks(); }
      await load();
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
  else initPage();
})();

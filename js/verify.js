/* ============================================================
   STREET TASKER — verify.js  (Didit stage V3b: self mode)
   Replaces the old soft-check version. This file NEVER writes
   is_verified, verified, verified_at or any verification status.
   Only the server (Didit webhook / sync -> idv_apply_event) can.
   Success is shown only from the server read idv_my_status().
   Proxy mode (V3c): verify.html?mode=proxy&id=<local tasker id>, for an assigned coordinator only (the server decides).
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

  /** Reads a status. Self: idv_my_status(). Proxy: idv_local_status(tasker) (server checks the coordinator).
      Returns { data } or { error: <message safe to show or ''> }. */
  async function readStatus(taskerId) {
    try {
      var r = taskerId ? await window.supabase.rpc('idv_local_status', { p_tasker: taskerId })
                       : await window.supabase.rpc('idv_my_status');
      if (r.error || !r.data) return { error: (r.error && r.error.hint && r.error.message) || '' };
      return { data: r.data };
    } catch (e) { return { error: '' }; }
  }

  /** Server status for the signed-in user (null if not available). */
  async function getServerStatus() {
    var r = await readStatus(null);
    return r.data || null;
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

    var q0 = new URLSearchParams(window.location.search);
    var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    var proxy = q0.get('mode') === 'proxy';
    var taskerId = proxy ? q0.get('id') : null;
    var state = { status: null, busy: false };
    if (proxy) main.setAttribute('data-mode', 'proxy');
    var consentBlock = $('consentBlock');
    var pageVersion = consentBlock ? consentBlock.getAttribute('data-consent-version') : null;

    function showPanel(name) {
      var panels = main.querySelectorAll('[data-status-panel]');
      for (var i = 0; i < panels.length; i++) {
        panels[i].hidden = panels[i].getAttribute('data-status-panel') !== name;
      }
    }

    function updateStartButton() {
      if (proxy) {
        var pb = $('proxyStartBtn');
        if (pb) {
          var ready = state.consentGiven || (($('proxyMethod') && $('proxyMethod').value) && $('proxyConsentCheck') && $('proxyConsentCheck').checked);
          pb.disabled = state.busy || !ready || !!state.linkMade;
        }
        return;
      }
      var btn = $('verifyStartBtn');
      if (!btn) return;
      var agreed = !!(state.consentGiven || ($('consentCheck') && $('consentCheck').checked));
      btn.disabled = state.busy || !agreed || !state.versionOk;
    }

    function render(s) {
      var status = s.status === 'ABANDONED' ? 'FAILED' : s.status;
      state.status = status;
      if (proxy) {
        state.consentGiven = s.consent_given === true;
        state.versionOk = true;
      } else {
        state.consentGiven = s.consent_given === true && s.consent_version === pageVersion;
        state.versionOk = !pageVersion || s.consent_version === pageVersion;
      }

      setHidden($('verifyLoading'), true);
      setHidden(main, false);
      showPanel(status);
      setHidden($('verifyStart'), !PANELS_WITH_START[status]);
      if (proxy) {
        /* The coordinator explains the Data Consent Notice: hide the self-service agreement box and button. */
        setHidden($('consentSection'), true);   /* the coordinator uses the proxy form below instead */
        setHidden($('consentSelf'), true); setHidden($('consentDone'), true); setHidden($('verifyStartBtn'), true);
        setHidden($('proxyPanel'), !PANELS_WITH_START[status]);
        setHidden($('proxyConsentFields'), state.consentGiven);
        var back = $('proxyBackLink');
        if (back) back.setAttribute('href', 'coordinator-tasker.html?id=' + encodeURIComponent(taskerId));
        var vc = $('verifyContinueBtn');
        if (vc) vc.setAttribute('href', 'coordinator-tasker.html?id=' + encodeURIComponent(taskerId));
        if (!state.versionOk) say($('verifyError'), 'This page is out of date. Please reload it.');
        updateStartButton();
        return;
      }

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
      var r = await readStatus(taskerId);
      if (!r.data) {
        setHidden($('verifyLoading'), true);
        say($('verifyError'), r.error || 'We could not load the verification status. Please reload the page or try again later.');
        return;
      }
      render(r.data);
    }

    async function sync(returned) {
      try {
        await callFunction('didit-sync', proxy ? { mode: 'proxy', local_tasker_user_id: taskerId, returned: !!returned }
                                               : { mode: 'self', returned: !!returned });
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

    async function proxyStartFlow() {
      if (state.busy || state.linkMade) return;
      state.busy = true; updateStartButton();
      say($('verifyError'), '');
      try {
        if (!state.consentGiven) {
          var ev = ($('proxyEvidence') && $('proxyEvidence').value || '').trim();
          var c = await window.supabase.rpc('idv_record_local_consent', {
            p_tasker: taskerId, p_method: $('proxyMethod').value, p_evidence_ref: ev || null, p_details: null });
          if (c.error) throw new Error((c.error.hint && c.error.message) || CONSENT_FALLBACK_MSG);
          state.consentGiven = true;
        }
        var made = await callFunction('didit-create-session', { mode: 'proxy', local_tasker_user_id: taskerId, request_id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10) });
        if (!isDiditUrl(made.url)) throw new Error(CONSENT_FALLBACK_MSG);
        /* The link goes to the Local Tasker, not to this browser: show it, never redirect, never store it. */
        $('proxyLinkInput').value = made.url;
        $('proxyOpenLink').setAttribute('href', made.url);
        setHidden($('proxyLinkBox'), false);
        setHidden($('proxyConsentFields'), true);
        state.linkMade = true;
        say($('verifyNotice'), 'Verification is ready. Give the link below to the Local Tasker. Use "Check again" later to see the result.');
      } catch (e) {
        say($('verifyError'), e.message || CONSENT_FALLBACK_MSG);
      }
      state.busy = false; updateStartButton();
    }

    function copyLink() {
      var inp = $('proxyLinkInput');
      if (!inp || !inp.value) return;
      var done = function () { say($('verifyNotice'), 'Link copied.'); };
      try {
        if (window.navigator && window.navigator.clipboard) { window.navigator.clipboard.writeText(inp.value).then(done, function () { inp.select(); }); return; }
      } catch (e) { /* fall through */ }
      if (inp.select) inp.select();
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
    ['proxyMethod', 'proxyConsentCheck'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('change', updateStartButton); });
    var copyBtn = $('proxyCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyLink);
    main.addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-action]') : null;
      if (!el) return;
      var action = el.getAttribute('data-action');
      if (proxy && action === 'proxy-start') proxyStartFlow();
      else if (proxy && (action === 'resume' || action === 'retry')) { var pp = $('proxyPanel'); if (pp) pp.scrollIntoView({ block: 'center' }); }
      else if (action === 'start' || action === 'resume') startFlow();
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
      if (proxy) {
        if (!UUID.test(taskerId || '')) {
          setHidden($('verifyLoading'), true);
          say($('verifyError'), 'This link is not valid. Open the Local Tasker from your coordinator list and try again.');
          return;
        }
        try {
          var pr = await window.supabase.from('local_tasker_profiles').select('full_name').eq('tasker_user_id', taskerId).maybeSingle();
          var nm = $('proxyName'); if (nm) nm.textContent = (pr && pr.data && pr.data.full_name) || 'this Local Tasker';
        } catch (e) { /* name is optional */ }
        await load();
        return;
      }
      if (cameBackFromDidit()) { await sync(true); clearReturnMarks(); }
      await load();
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
  else initPage();
})();

/* Coordinator identity check (Stage E-1). Page: coordinator-identity.html.
   A new coordinator is 'pending' until Didit confirms their identity; the database then makes them 'active' (trigger idv_coordinator_sync).
   This page NEVER writes a status. It only:
     - reads who the person is        (auth session + their own coordinators row)
     - reads the check status         (rpc idv_my_status; success is shown only from this server read)
     - records consent                (rpc idv_give_consent with the coordinator version)
     - starts the check               (Edge Function didit-create-session, mode self)
     - asks the server to refresh     (Edge Function didit-sync, mode self)
   It does not use js/auth.js, so a coordinator is never treated as a customer. All text from the server is written with textContent. */
(function () {
  'use strict';
  var sb = window.supabase;
  var RETURN_FLAG = 'st_co_idv_out';
  var RETURN_FLAG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  var LOGIN = 'coordinator-login.html';
  var FALLBACK_MSG = 'Something went wrong. Please try again.';
  var START_PANELS = { NOT_STARTED: 1, FAILED: 1, EXPIRED: 1, NEEDS_NAME: 1 };
  var state = { status: null, consentGiven: false, versionOk: true, busy: false, cameBack: false };
  var pageVersion = null;

  function $(id) { return document.getElementById(id); }
  function setHidden(el, hide) { if (el) el.hidden = !!hide; }
  function say(id, text) { var el = $(id); if (!el) return; el.textContent = text || ''; el.hidden = !text; }
  function showOnly(id) {
    ['cidLoading', 'cidBlocked', 'cidActive', 'cidPending', 'cidStart'].forEach(function (p) { setHidden($(p), p !== id && !(id === 'cidPending' && p === 'cidStart')); });
  }
  function isDiditUrl(raw) {
    try { var u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'didit.me' || u.hostname.slice(-9) === '.didit.me'); } catch (e) { return false; }
  }
  function toLogin(params) {
    var q = new URLSearchParams(params || {});
    window.location.replace(LOGIN + (q.toString() ? '?' + q.toString() : ''));
  }

  async function signOut() {
    try { await sb.auth.signOut(); } catch (e) { /* leave anyway */ }
    toLogin({ signedout: '1' });
  }

  async function callFunction(name, body) {
    var r = await sb.functions.invoke(name, { body: body });
    if (r.error) {
      var msg = '';
      try { var j = await r.error.context.json(); msg = (j && j.message) || ''; } catch (e) { /* no body */ }
      throw new Error(msg || FALLBACK_MSG);
    }
    if (!r.data || r.data.ok !== true) throw new Error((r.data && r.data.message) || FALLBACK_MSG);
    return r.data;
  }

  /* The signed-in person's own coordinator row (RLS lets them read only their own). */
  async function myCoordinatorStatus(userId) {
    var r = await sb.from('coordinators').select('status').eq('user_id', userId).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? r.data.status : null;
  }

  async function readStatus() {
    try {
      var r = await sb.rpc('idv_my_status');
      if (r.error || !r.data) return { error: (r.error && r.error.hint && r.error.message) || '' };
      return { data: r.data };
    } catch (e) { return { error: '' }; }
  }

  function showPanel(name) {
    var panels = $('cidPending').querySelectorAll('[data-status-panel]');
    for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute('data-status-panel') !== name;
  }

  function updateStartButton() {
    var btn = $('cidStartBtn');
    if (!btn) return;
    var agreed = !!(state.consentGiven || ($('cidConsentCheck') && $('cidConsentCheck').checked));
    btn.disabled = state.busy || !agreed || !state.versionOk;
  }

  function render(s) {
    var status = s.status === 'ABANDONED' ? 'FAILED' : s.status;
    if (status === 'VERIFIED' && s.needs_name === true) status = 'NEEDS_NAME';   // VR2b: verified before names were kept
    state.status = status;
    state.consentGiven = s.consent_given === true && s.consent_version === pageVersion;
    state.versionOk = !pageVersion || s.consent_version === pageVersion;
    showOnly('cidPending');
    showPanel(status);
    setHidden($('cidStart'), !START_PANELS[status]);
    if (!state.versionOk) say('cidError', 'This page is out of date. Please reload it.');
    setHidden($('cidConsentSelf'), state.consentGiven);
    setHidden($('cidConsentDone'), !state.consentGiven);
    updateStartButton();
  }

  /* Decide what to show. The coordinators row says if the account can work; idv_my_status says where the check is. */
  async function load() {
    var s = await sb.auth.getSession();
    var session = s.data && s.data.session;
    if (!session) { toLogin({ redirect: 'coordinator-identity.html' }); return; }
    var coStatus;
    try { coStatus = await myCoordinatorStatus(session.user.id); }
    catch (e) { showOnly('cidLoading'); say('cidError', 'We could not load your account. Please reload the page or try again later.'); setHidden($('cidLoading'), true); return; }
    if (!coStatus) { toLogin({ denied: 'no' }); return; }
    if (coStatus === 'active') {
      // VR2b: an active coordinator verified before names were kept (or in the middle of the one more check) sees the check; everyone else sees the active page
      var ra = await readStatus();
      if (ra.data && ra.data.subject_kind === 'coordinator' && ra.data.needs_name === true) { render(ra.data); return; }
      showOnly('cidActive');
      return;
    }
    if (coStatus !== 'pending') { showOnly('cidBlocked'); return; }
    var r = await readStatus();
    if (!r.data) {
      setHidden($('cidLoading'), true);
      say('cidError', r.error || 'We could not load the verification status. Please reload the page or try again later.');
      return;
    }
    if (r.data.subject_kind !== 'coordinator') { toLogin({ denied: 'no' }); return; }
    render(r.data);
  }

  async function sync(returned) {
    try { await callFunction('didit-sync', { mode: 'self', returned: !!returned }); return true; }
    catch (e) { say('cidNotice', 'We could not reach the verification service just now. Showing your last saved status.'); return false; }
  }

  function cameBackFromDidit() {
    var flagged = false;
    try {
      var t = parseInt(sessionStorage.getItem(RETURN_FLAG) || '', 10);
      flagged = t > 0 && (Date.now() - t) < RETURN_FLAG_MAX_AGE_MS;
    } catch (e) { /* storage blocked */ }
    return flagged || new URLSearchParams(window.location.search).has('verificationSessionId');
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

  async function startFlow() {
    if (state.busy) return;
    state.busy = true; updateStartButton();
    say('cidError', '');
    try {
      if (!state.consentGiven) {
        var c = await sb.rpc('idv_give_consent', { p_version: pageVersion });
        if (c.error) throw new Error(c.error.message || FALLBACK_MSG);
        state.consentGiven = true;
      }
      var made = await callFunction('didit-create-session', { mode: 'self', request_id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10) });
      if (!isDiditUrl(made.url)) throw new Error(FALLBACK_MSG);
      try { sessionStorage.setItem(RETURN_FLAG, String(Date.now())); } catch (e) { /* ignore */ }
      window.location.href = made.url;
    } catch (e) {
      say('cidError', e.message || FALLBACK_MSG);
      var box = $('cidError'); if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
      state.busy = false; updateStartButton();
    }
  }

  async function refresh(btn) {
    if (state.busy) return;
    state.busy = true;
    if (btn) btn.disabled = true;
    var before = state.status;
    say('cidNotice', '');
    var reached = await sync(false);
    await load();
    if (reached && state.status === before && $('cidActive').hidden) say('cidNotice', 'No update yet. Please check again in a little while.');
    /* Wait before another check: every check costs one request to Didit. */
    window.setTimeout(function () { state.busy = false; if (btn) btn.disabled = false; }, 5000);
  }

  function wire() {
    var check = $('cidConsentCheck');
    if (check) check.addEventListener('change', updateStartButton);
    $('cidPage').addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-action]') : null;
      if (!el) return;
      var action = el.getAttribute('data-action');
      if (action === 'signout') signOut();
      else if (action === 'start' || action === 'resume') startFlow();
      else if (action === 'refresh') refresh(el);
      else if (action === 'retry') {
        if (state.consentGiven) startFlow();
        else { var c = $('cidConsentCheck'); if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); } }
      }
    });
  }

  async function init() {
    var block = $('cidConsentBlock');
    pageVersion = block ? block.getAttribute('data-consent-version') : null;
    wire();
    try {
      if (cameBackFromDidit()) { state.cameBack = true; await sync(true); clearReturnMarks(); }
      await load();
    } catch (e) {
      setHidden($('cidLoading'), true);
      say('cidError', 'We could not load this page. Please reload it or try again later.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

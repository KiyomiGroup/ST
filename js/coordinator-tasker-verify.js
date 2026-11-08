/* Coordinator: identity check for a Local Tasker (Stage E-2). Page: coordinator-tasker-verify.html?id=<local tasker user id>.
   The coordinator portal's own version of verify.html?mode=proxy. This page NEVER writes a verification status. It only:
     - reads the check status       (rpc idv_local_status: the server checks the caller is an ACTIVE coordinator AND that this Local Tasker is assigned to them)
     - records the consent          (rpc idv_record_local_consent: method, optional reference, who/when are stored by the server)
     - starts the check             (Edge Function didit-create-session, mode proxy)
     - asks the server to refresh   (Edge Function didit-sync, mode proxy)
   The Didit link is shown to the coordinator, who opens it on their own phone and hands the phone to the Local Tasker. It is never stored here.
   Runs after js/coordinator.js (route guard) says "ready". All text from the server is written with textContent. */
(function () {
  'use strict';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var FALLBACK = 'Something went wrong. Please try again.';
  var SHOW_START = { NOT_STARTED: 1, FAILED: 1, EXPIRED: 1, IN_PROGRESS: 1, RESUBMIT_REQUESTED: 1 };
  var taskerId = new URLSearchParams(window.location.search).get('id') || '';
  var state = { status: null, consentGiven: false, busy: false, linkMade: false, started: false };

  function $(id) { return document.getElementById(id); }
  function setHidden(el, h) { if (el) el.hidden = !!h; }
  function say(id, text) { var el = $(id); if (!el) return; el.textContent = text || ''; el.hidden = !text; }
  function isDiditUrl(raw) {
    try { var u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'didit.me' || u.hostname.slice(-9) === '.didit.me'); } catch (e) { return false; }
  }
  function sb() { return window.supabase; }

  async function callFunction(name, body) {
    var r = await sb().functions.invoke(name, { body: body });
    if (r.error) {
      var msg = '';
      try { var j = await r.error.context.json(); msg = (j && j.message) || ''; } catch (e) { /* no body */ }
      throw new Error(msg || FALLBACK);
    }
    if (!r.data || r.data.ok !== true) throw new Error((r.data && r.data.message) || FALLBACK);
    return r.data;
  }

  async function readStatus() {
    try {
      var r = await sb().rpc('idv_local_status', { p_tasker: taskerId });
      if (r.error || !r.data) return { error: (r.error && r.error.hint && r.error.message) || '' };
      return { data: r.data };
    } catch (e) { return { error: '' }; }
  }

  function showPanel(name) {
    var panels = $('cvStatus').querySelectorAll('[data-status-panel]');
    for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute('data-status-panel') !== name;
  }

  function updateStartButton() {
    var btn = $('cvStartBtn');
    if (!btn) return;
    var ready = state.consentGiven || ($('cvMethod').value && $('cvConsentCheck').checked);
    btn.disabled = state.busy || !ready;
  }

  function render(s) {
    var status = s.status === 'ABANDONED' ? 'FAILED' : s.status;
    state.status = status;
    state.consentGiven = s.consent_given === true;
    setHidden($('cvLoading'), true);
    setHidden($('cvMain'), false);
    showPanel(status);
    setHidden($('cvStart'), !SHOW_START[status]);
    setHidden($('cvConsentFields'), state.consentGiven);
    setHidden($('cvConsentDone'), !state.consentGiven);
    var reopen = status === 'IN_PROGRESS' || status === 'RESUBMIT_REQUESTED';
    $('cvStartBtn').textContent = reopen ? 'Show the link again' : 'Start verification for this Local Tasker';
    updateStartButton();
  }

  async function load() {
    var r = await readStatus();
    if (!r.data) {
      setHidden($('cvLoading'), true);
      say('cvError', r.error || 'We could not load the verification status. Please reload the page or try again later.');
      return false;
    }
    say('cvError', '');
    render(r.data);
    return true;
  }

  async function startFlow() {
    if (state.busy) return;
    state.busy = true; updateStartButton();
    say('cvError', ''); say('cvNotice', '');
    try {
      if (!state.consentGiven) {
        var ev = ($('cvEvidence').value || '').trim();
        var c = await sb().rpc('idv_record_local_consent', { p_tasker: taskerId, p_method: $('cvMethod').value, p_evidence_ref: ev || null, p_details: null });
        if (c.error) throw new Error((c.error.hint && c.error.message) || FALLBACK);
        state.consentGiven = true;
      }
      var made = await callFunction('didit-create-session', { mode: 'proxy', local_tasker_user_id: taskerId, request_id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10) });
      if (!isDiditUrl(made.url)) throw new Error(FALLBACK);
      /* Show the link; the coordinator opens it on this phone by pressing the button. Never redirect, never store the link itself.
         Remember only which coordinator page to come back to, because Didit sends the browser to verify.html afterwards. */
      try { localStorage.setItem('st_lt_verify_return', JSON.stringify({ u: window.location.pathname.split('/').pop() + window.location.search, t: Date.now() })); } catch (e) { /* the check still works */ }
      $('cvLinkInput').value = made.url;
      $('cvOpenLink').setAttribute('href', made.url);
      setHidden($('cvLinkBox'), false);
      setHidden($('cvConsentFields'), true);
      setHidden($('cvConsentDone'), false);
      state.linkMade = true;
      say('cvNotice', 'Verification is ready. Press Open on this phone and do the check together. When it finishes, come back here and use Check again.');
    } catch (e) {
      say('cvError', e.message || FALLBACK);
      var box = $('cvError'); if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
    }
    state.busy = false; updateStartButton();
  }

  function copyLink() {
    var inp = $('cvLinkInput');
    if (!inp || !inp.value) return;
    var done = function () { say('cvNotice', 'Link copied.'); };
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
    say('cvNotice', '');
    var reached = true;
    try { await callFunction('didit-sync', { mode: 'proxy', local_tasker_user_id: taskerId, returned: false }); }
    catch (e) { reached = false; say('cvNotice', 'We could not reach the verification service just now. Showing the last saved status.'); }
    await load();
    if (reached && state.status === before) say('cvNotice', 'No update yet. Please check again in a little while.');
    /* Wait before another check: every check costs one request to Didit. */
    window.setTimeout(function () { state.busy = false; if (btn) btn.disabled = false; updateStartButton(); }, 5000);
  }

  function wire() {
    ['cvMethod', 'cvConsentCheck'].forEach(function (id) { $(id).addEventListener('change', updateStartButton); });
    $('cvCopyBtn').addEventListener('click', copyLink);
    $('coMain').addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-action]') : null;
      if (!el) return;
      var a = el.getAttribute('data-action');
      if (a === 'start') startFlow();
      else if (a === 'refresh') refresh(el);
    });
  }

  async function start() {
    if (state.started) return;
    state.started = true;
    if (!UUID.test(taskerId)) {
      setHidden($('cvLoading'), true);
      say('cvError', 'This link is not valid. Open the Local Tasker from your list and try again.');
      return;
    }
    $('cvBack').setAttribute('href', 'coordinator-tasker.html?id=' + encodeURIComponent(taskerId));
    $('cvBackText').textContent = 'Back to Local Tasker';
    wire();
    try {
      var pr = await sb().from('local_tasker_profiles').select('full_name').eq('tasker_user_id', taskerId).maybeSingle();
      if (pr && pr.data && pr.data.full_name) $('cvName').textContent = pr.data.full_name;
    } catch (e) { /* the name is optional */ }
    await load();
  }

  document.addEventListener('coordinator:ready', start);
})();

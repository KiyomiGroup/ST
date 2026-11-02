/* ============================================================
   StreetTasker — coordinator-payout.js (Stage 7B)
   coordinator-tasker-payout.html?id=<tasker user id>: register or change the verified payout account
   of ONE Local Tasker.
   The browser writes nothing. It asks the Edge Function `local-payout-account` to (1) list banks,
   (2) check an account with the bank, (3) check again and save. The bank's name, the bank name and the
   Paystack recipient are decided on the server; nothing sent from here is trusted for them.
   The account number lives only in the input box and in the request. It is cleared after a save, is
   never put in the URL, storage, a log or the page text, and the saved account is shown MASKED only.
   Every failure shows its error code on screen.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }

  var last = null, taskerId = null, busy = false, current = null, verified = null, registeredName = '';

  var MESSAGES = {
    unauthenticated: 'Your sign-in has expired. Please sign in again, then come back to this page.',
    not_active_coordinator: 'Your coordinator account is not active. Nothing was saved.',
    not_found: "This Local Tasker isn't assigned to you any more. Nothing was saved.",
    rate_limited: 'Too many account checks in the last hour. Please wait a while and try again.',
    registered_name_incomplete: "Add the Local Tasker's full legal name (at least two names) on their profile first. The bank name is compared with it.",
    account_not_found: "We couldn't verify that account. Check the bank and the 10 digits, then try again.",
    name_mismatch: "The account name from the bank does not match the Local Tasker's registered name. Nothing was saved.",
    paystack_unavailable: 'The bank check is not available right now. Nothing was saved. Please try again later.',
    recipient_failed: 'The account could not be registered with the payment provider. Nothing was saved.',
    live_not_approved: 'Payouts are not switched on yet. Nothing was saved.',
    consent_required: 'Record how the Local Tasker agreed, and tick both confirmations.',
    bad_input: null,
    network: "We couldn't reach the server. Check your connection and try again. Nothing was saved.",
    server_error: 'Something went wrong on our side. Nothing was saved. Please try again in a moment.'
  };

  function showError(code, serverMessage, raw) {
    var text = MESSAGES[code];
    if (!text) text = serverMessage || 'Something went wrong and nothing was saved. Please try again, and quote the error code if it keeps happening.';
    $('coPoErrorText').textContent = text;
    $('coPoErrorCode').textContent = 'Error code: ' + code + (raw ? ' (' + raw + ')' : '');
    var box = $('coPoError'); box.hidden = false; box.focus();
  }
  function clearError() { $('coPoError').hidden = true; }
  function fieldError(id, msg) {
    var err = $(id + 'Err'), input = $(id);
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  async function failureFrom(error) {
    var ctx = error && error.context;
    if (ctx && typeof ctx.json === 'function') {
      var body = null;
      try { body = await ctx.json(); } catch (e) { body = null; }
      var status = ctx.status;
      var code = (body && body.error) || (status ? 'http_' + status : 'server_error');
      var raw = null;
      if (status === 401 && !MESSAGES[code]) { raw = code; code = 'unauthenticated'; }
      return { code: code, message: body && body.message, raw: raw };
    }
    return { code: 'network' };
  }

  async function call(body) {
    var res = await window.supabase.functions.invoke('local-payout-account', { body: body });
    if (res.error) { var f = await failureFrom(res.error); var e = new Error(f.code); e.fail = f; throw e; }
    if (!res.data || res.data.ok !== true) { var e2 = new Error('bad_response'); e2.fail = { code: 'bad_response' }; throw e2; }
    return res.data;
  }

  function digits() { return $('coPoAcct').value.replace(/\D/g, '').slice(0, 10); }
  function keyNow() { return $('coPoBank').value + ':' + digits(); }

  function refreshState() {
    $('coPoAcctCount').textContent = String(digits().length);
    var ok = !!verified && verified.key === keyNow();
    if (!ok && verified) { verified = null; $('coPoResult').hidden = true; }
    var ready = ok && $('coPoAuth').checked && $('coPoOwn').checked && !!$('coPoMethod').value;
    $('coPoSubmit').disabled = !ready || busy;
    $('coPoCheck').disabled = busy || !$('coPoBank').value || digits().length !== 10;
  }

  function showResult(kind, name, note) {
    var box = $('coPoResult');
    box.hidden = false;
    box.classList.toggle('is-ok', kind === 'ok');
    box.classList.toggle('is-bad', kind !== 'ok');
    $('coPoResultLabel').textContent = kind === 'ok' ? 'Account holder (confirmed by the bank)' : 'Account check';
    $('coPoResultName').textContent = name || '';
    $('coPoResultName').hidden = !name;
    $('coPoResultNote').textContent = note || '';
  }

  async function loadBanks() {
    var sel = $('coPoBank');
    try {
      var d = await call({ action: 'banks' });
      sel.textContent = '';
      var first = document.createElement('option'); first.value = ''; first.textContent = 'Choose a bank'; sel.appendChild(first);
      (d.banks || []).forEach(function (b) { var o = document.createElement('option'); o.value = b.code; o.textContent = b.name; sel.appendChild(o); });
      sel.disabled = false;
    } catch (e) {
      sel.textContent = '';
      var o = document.createElement('option'); o.value = ''; o.textContent = 'Bank list unavailable'; sel.appendChild(o);
      var f = e.fail || { code: 'network' };
      fieldError('coPoBank', (MESSAGES[f.code] || 'The bank list could not be loaded.') + ' Reload the page to try again. (' + f.code + ')');
    }
    refreshState();
  }

  async function check() {
    if (busy) return;
    clearError(); fieldError('coPoBank', ''); fieldError('coPoAcct', '');
    var bank = $('coPoBank').value, acct = digits();
    if (!bank) { fieldError('coPoBank', 'Choose the bank.'); $('coPoBank').focus(); return; }
    if (acct.length !== 10) { fieldError('coPoAcct', 'Enter all 10 digits.'); $('coPoAcct').focus(); return; }
    busy = true; verified = null; $('coPoResult').hidden = true;
    var btn = $('coPoCheck'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Checking…';
    try {
      var d = await call({ action: 'resolve', tasker_id: taskerId, bank_code: bank, account_number: acct });
      if (d.matched === true && typeof d.account_name === 'string') {
        verified = { key: bank + ':' + acct };
        showResult('ok', d.account_name, 'The bank\'s name matches the registered name.');
      } else {
        showResult('bad', '', "The bank's name for this account does not match the registered name, so it cannot be used. Check the bank and the number with the Local Tasker.");
      }
    } catch (e) {
      var f = e.fail || { code: 'network' };
      if (f.code === 'account_not_found') showResult('bad', '', MESSAGES.account_not_found);
      else showError(f.code, f.message, f.raw);
    } finally {
      busy = false; btn.textContent = label; refreshState();
    }
  }

  function validateForSave() {
    var bad = null;
    function fail(id, msg) { fieldError(id, msg); if (!bad) bad = id; }
    fieldError('coPoMethod', ''); fieldError('coPoConfirm', ''); fieldError('coPoEvidence', ''); fieldError('coPoDetails', '');
    if (!$('coPoMethod').value) fail('coPoMethod', 'Choose how they agreed.');
    if (!$('coPoAuth').checked || !$('coPoOwn').checked) fail('coPoConfirm', 'Tick both confirmations.');
    var long8 = /[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9][ -]?[0-9]/;
    if (long8.test($('coPoEvidence').value)) fail('coPoEvidence', 'Do not type an account number here.');
    if (long8.test($('coPoDetails').value)) fail('coPoDetails', 'Do not type an account number here.');
    return bad;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    clearError();
    if (!verified || verified.key !== keyNow()) { showError('bad_input', 'Check the account with the bank first.'); return; }
    var bad = validateForSave();
    if (bad) { var f0 = $(bad); if (f0) f0.focus(); return; }
    busy = true;
    var btn = $('coPoSubmit'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var d = await call({
        action: 'save', tasker_id: taskerId, bank_code: $('coPoBank').value, account_number: digits(),
        consent: { authorized: $('coPoAuth').checked, ownership: $('coPoOwn').checked, method: $('coPoMethod').value,
                   evidence_ref: $('coPoEvidence').value.trim(), details: $('coPoDetails').value.trim() }
      });
      /* Done: wipe everything the browser held. */
      $('coPoAcct').value = ''; $('coPoBank').value = ''; verified = null; $('coPoResult').hidden = true;
      $('coPoAuth').checked = false; $('coPoOwn').checked = false; $('coPoMethod').value = '';
      $('coPoEvidence').value = ''; $('coPoDetails').value = '';
      $('coPoSavedText').textContent = (d.changed ? 'Saved. ' : 'Already saved. ') + d.bank_name + ' ' + d.account_mask + ' is now the payout account.';
      var sb = $('coPoSaved'); sb.hidden = false; sb.focus();
      await loadCurrent();
    } catch (err) {
      var f = err.fail || { code: 'network' };
      showError(f.code, f.message, f.raw);
    } finally {
      busy = false; btn.textContent = label; refreshState();
    }
  }

  async function loadCurrent() {
    ['coPoCur', 'coPoCurEmpty', 'coPoCurError'].forEach(function (id) { $(id).hidden = true; });
    try {
      var res = await window.supabase.rpc('local_payout_account', { p_tasker: taskerId });
      if (res.error) throw res.error;
      var a = res.data || {};
      current = a.has_account === true;
      if (!current) {
        $('coPoCurEmpty').hidden = false; $('coPoStatus').textContent = 'Status: No payout account yet';
        $('coPoReplaceNote').hidden = true; $('coHeroTitle').textContent = 'Register payout account';
        return;
      }
      $('coPoCurBank').textContent = a.bank_name || '';
      $('coPoCurMask').textContent = a.account_mask || '';
      $('coPoCurName').textContent = a.account_name || '';
      $('coPoCurWhen').textContent = C.formatDate(a.verified_at);
      var M = { in_person: 'In person', phone: 'By phone call', written: 'In writing' };
      $('coPoCurConsent').textContent = (M[a.consent_method] || '') + (a.consent_recorded_at ? ', ' + C.formatDate(a.consent_recorded_at) : '');
      $('coPoCur').hidden = false; $('coPoStatus').textContent = 'Status: Payout account verified';
      $('coPoReplaceNote').hidden = false; $('coHeroTitle').textContent = 'Change payout account';
    } catch (e) {
      console.error('[coordinator payout account]', e && e.code);
      $('coPoCurError').hidden = false; $('coPoStatus').textContent = 'Status: unknown';
    }
  }

  function show(which) {
    ['coPoLoading', 'coPoLoadError', 'coPoMissing', 'coPoLayout'].forEach(function (id) { $(id).hidden = (id !== which); });
  }

  async function load() {
    taskerId = new URLSearchParams(window.location.search).get('id');
    if (!C.isUuid(taskerId)) { show('coPoMissing'); return; }
    var back = 'coordinator-tasker.html?id=' + encodeURIComponent(taskerId);
    $('coBackLink').href = back; $('coPoCancel').href = back;
    show('coPoLoading');
    try {
      var res = await window.supabase.from('local_tasker_profiles')
        .select('tasker_user_id, full_name, areas_served, skills, status').eq('tasker_user_id', taskerId).maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { show('coPoMissing'); return; }
      var p = res.data;
      registeredName = p.full_name || '';
      $('coPoName').textContent = registeredName || 'Local Tasker';
      $('coPoAvatar').textContent = C.initialsOf(registeredName || 'Local Tasker');
      $('coPoRegistered').textContent = registeredName || 'the registered name';
      $('coPoSub').textContent = [Array.isArray(p.skills) ? p.skills.slice(0, 3).join(', ') : '', p.areas_served || ''].filter(Boolean).join(' · ');
      show('coPoLayout');
      refreshState();
      loadBanks();
      await loadCurrent();
    } catch (e) {
      console.error('[coordinator payout load]', e && e.code);
      show('coPoLoadError');
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    var form = $('coPoForm');
    if (form) {
      form.addEventListener('submit', submit);
      form.addEventListener('input', function (ev) {
        if (ev.target && ev.target.id === 'coPoAcct') { var d = digits(); if ($('coPoAcct').value !== d) $('coPoAcct').value = d; }
        refreshState();
      });
      form.addEventListener('change', refreshState);
    }
    var chk = $('coPoCheck'); if (chk) chk.addEventListener('click', check);
    var retry = $('coPoRetry'); if (retry) retry.addEventListener('click', function () { if (last) load(); });
  });
})();

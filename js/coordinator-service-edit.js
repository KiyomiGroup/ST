/* ============================================================
   StreetTasker — coordinator-service-edit.js (Stage 4B-1)
   Add or edit ONE service of a Local Tasker:
   coordinator-service-edit.html?id=<tasker user id>[&service=<service id>]
   The browser never writes `services`. It calls the database function
   `save_local_tasker_service`, which decides (from the signed-in user, never from anything
   sent here) whether this coordinator currently manages this person, checks the input, records
   the "publish_info" agreement the first time, writes the audit row, and returns the result.
   Services stay hidden from customers while the Local Tasker is a draft (existing policy).
   Every failure shows its error code on screen.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }

  var L = { name: [3, 100], desc: [10, 1000], loc: 200, spec: 10, specEach: 40, maxPrice: 10000000 };
  var UNITS = ['/job', '/hour', '/day', '/visit', '/session'];
  var last = null, busy = false, leaving = false;
  var taskerId = null, serviceId = null;
  var needConsent = true, consentKnown = true;

  var MESSAGES = {
    not_found: "This Local Tasker isn't assigned to you any more, or your coordinator account isn't active. Nothing was changed.",
    consent_required: 'Choose how they agreed and tick the confirmation.',
    service_limit: 'A Local Tasker can have at most 5 services. Edit an existing one instead.',
    live_service_limit: 'A Local Tasker can have at most 3 live services. Untick “Live” on one of their other services first, then save this one again.',
    duplicate_name: 'This Local Tasker already has a service with that name. Pick another title, or edit the existing service.',
    unauthenticated: 'Your sign-in has expired. Please sign in again, then come back to this form.',
    network: "We couldn't reach the server. Before pressing Save again, check the services on the profile so you don't add it twice.",
    server_error: 'Something went wrong on our side. Nothing was changed. Please try again in a moment.'
  };

  function showError(code, serverMessage, raw) {
    var text = MESSAGES[code];
    if (!text) text = (code === 'bad_input' && serverMessage) ? serverMessage : 'Something went wrong and nothing was saved. Please try again, and quote the error code if it keeps happening.';
    $('coFormErrorText').textContent = text;
    $('coFormErrorCode').textContent = 'Error code: ' + code + (raw ? ' (' + raw + ')' : '');
    var box = $('coFormError'); box.hidden = false; box.focus();
  }
  function clearError() { $('coFormError').hidden = true; }
  function fieldError(id, msg) {
    var err = $(id + 'Err'), input = $(id);
    if (!err) return;
    err.textContent = msg || ''; err.hidden = !msg;
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function parseList(raw) { return String(raw || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function parsePrice(raw) {
    var s = String(raw || '').replace(/[₦,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Number(s);
  }
  function read() {
    return {
      name: $('coFName').value.trim(), category: $('coFCategory').value,
      desc: $('coFDesc').value.trim(), spec: parseList($('coFSpec').value),
      loc: $('coFLocation').value.trim(), priceRaw: $('coFPrice').value,
      price: parsePrice($('coFPrice').value), unit: $('coFUnit').value,
      avail: $('coFAvail').value, active: $('coFActive').checked,
      method: $('coFMethod').value, evidence: $('coFEvidence').value.trim(),
      details: $('coFDetails').value.trim(), confirmed: $('coFConfirm').checked
    };
  }
  function validate(v) {
    var first = null;
    function bad(id, msg) { fieldError(id, msg); if (!first) first = id; }
    function ok(id) { fieldError(id, ''); }
    v.name.length < L.name[0] ? bad('coFName', 'Enter a title (at least 3 characters).') : ok('coFName');
    v.category ? ok('coFCategory') : bad('coFCategory', 'Choose a category.');
    v.desc.length < L.desc[0] ? bad('coFDesc', 'Describe what is included (at least 10 characters).') : ok('coFDesc');
    if (v.spec.length > L.spec) bad('coFSpec', 'Up to 10 specialties, please.');
    else if (v.spec.some(function (s) { return s.length > L.specEach; })) bad('coFSpec', 'Each specialty must be 40 characters or fewer.');
    else ok('coFSpec');
    v.loc.length > L.loc ? bad('coFLocation', 'Keep this under 200 characters.') : ok('coFLocation');
    (!(v.price > 0) || v.price > L.maxPrice) ? bad('coFPrice', 'Enter the agreed price as a number, for example 12500.') : ok('coFPrice');
    UNITS.indexOf(v.unit) > -1 ? ok('coFUnit') : bad('coFUnit', 'Choose what the price is per.');
    if (needConsent && consentKnown) {
      v.method ? ok('coFMethod') : bad('coFMethod', 'Choose how they agreed.');
      v.confirmed ? ok('coFConfirm') : bad('coFConfirm', 'Tick the box to confirm they agreed.');
    }
    v.evidence.length > 500 ? bad('coFEvidence', 'Keep the reference under 500 characters.') : ok('coFEvidence');
    v.details.length > 1000 ? bad('coFDetails', 'Keep the notes under 1000 characters.') : ok('coFDetails');
    return first;
  }

  function show(which) {
    ['coEditLoading', 'coEditLoadError', 'coEditMissing', 'coEditLayout'].forEach(function (id) {
      var n = $(id); if (n) n.hidden = (id !== which);
    });
    $('coHeroActions').hidden = (which !== 'coEditLayout');
  }
  function profileUrl(extra) { return 'coordinator-tasker.html?id=' + encodeURIComponent(taskerId) + (extra || ''); }

  function setConsentUi() {
    var show = needConsent;
    $('coAgreeFields').hidden = !show;
    $('coAgreeDone').hidden = show;
  }

  async function load() {
    var qs = new URLSearchParams(window.location.search);
    taskerId = qs.get('id'); serviceId = qs.get('service');
    if (!C.isUuid(taskerId) || (serviceId && !C.isUuid(serviceId))) { show('coEditMissing'); return; }
    $('coBackLink').href = profileUrl(); $('coCancel').href = profileUrl(); $('coCancelTop').href = profileUrl();
    show('coEditLoading');
    try {
      var res = await window.supabase.from('local_tasker_profiles')
        .select('tasker_user_id, full_name, areas_served').eq('tasker_user_id', taskerId).maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { show('coEditMissing'); return; }
      $('coProxyName').textContent = res.data.full_name || 'this Local Tasker';
      $('coFLocation').placeholder = res.data.areas_served || '';

      if (serviceId) {
        var sv = await window.supabase.from('services')
          .select('id, service_name, category, price, rate_unit, description, location, specialties, availability_status, available')
          .eq('id', serviceId).eq('user_id', taskerId).maybeSingle();
        if (sv.error) throw sv.error;
        if (!sv.data) { show('coEditMissing'); return; }
        var s = sv.data;
        $('coHeroTitle').textContent = 'Edit service';
        $('coHeroSub').textContent = 'Change the details or the agreed rate. Every change is recorded, including the old and new price.';
        document.title = 'Edit service — StreetTasker';
        $('coFName').value = s.service_name || '';
        var cat = $('coFCategory');
        if (s.category && !Array.prototype.some.call(cat.options, function (o) { return o.value === s.category; })) {
          var o = document.createElement('option'); o.value = s.category; o.textContent = C.statusLabel(s.category); cat.appendChild(o);
        }
        cat.value = s.category || '';
        $('coFPrice').value = s.price == null ? '' : String(s.price);
        $('coFUnit').value = s.rate_unit || '/job';
        $('coFDesc').value = s.description || '';
        $('coFLocation').value = s.location && s.location !== res.data.areas_served ? s.location : '';
        $('coFSpec').value = Array.isArray(s.specialties) ? s.specialties.join(', ') : '';
        $('coFAvail').value = s.availability_status || 'available_this_week';
        $('coFActive').checked = s.available !== false;
      }

      /* Has the publish_info agreement been recorded already? If this cannot be read, show the
         fields and let the database decide (it answers consent_required if needed). */
      needConsent = true; consentKnown = true;
      try {
        var cs = await window.supabase.from('local_tasker_consents').select('id')
          .eq('tasker_user_id', taskerId).eq('purpose', 'publish_info').is('revoked_at', null);
        if (cs.error) throw cs.error;
        needConsent = !(cs.data && cs.data.length);
      } catch (e) { consentKnown = false; needConsent = true; }
      setConsentUi();
      show('coEditLayout');
    } catch (e) {
      console.error('[coordinator service load]', e);
      show('coEditLoadError');
    }
  }

  function failureFrom(error) {
    var hint = error && error.hint, code = error && error.code;
    if (hint) return { code: hint, message: error.message };
    if (code === '42501') return { code: 'unauthenticated', raw: code };
    if (error && (error.status === 401 || error.status === 403)) return { code: 'unauthenticated', raw: String(error.status) };
    if (code || (error && error.message && !/fetch|network/i.test(error.message))) return { code: 'server_error', raw: code || null };
    return { code: 'network' };
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    clearError();
    var v = read();
    var firstBad = validate(v);
    if (firstBad) { var f = $(firstBad); if (f) f.focus(); return; }

    busy = true;
    var btns = [$('coFSubmit'), $('coFSubmitTop')]; var label = btns[0].textContent;
    btns.forEach(function (b) { b.disabled = true; b.textContent = 'Saving…'; });
    try {
      var res = await window.supabase.rpc('save_local_tasker_service', {
        p_tasker: taskerId,
        p_service_id: serviceId || null,
        p_name: v.name,
        p_category: v.category,
        p_price: v.price,
        p_rate_unit: v.unit,
        p_description: v.desc,
        p_location: v.loc,
        p_specialties: v.spec,
        p_availability: v.avail,
        p_available: v.active,
        p_consent_method: needConsent ? v.method : null,
        p_consent_evidence: needConsent ? v.evidence : null,
        p_consent_details: needConsent ? v.details : null
      });
      if (res.error) { var fail = failureFrom(res.error); showError(fail.code, fail.message, fail.raw); return; }
      var d = res.data;
      if (!d || !C.isUuid(d.service_id) || !Array.isArray(d.changed)) { showError('bad_response'); return; }
      leaving = true;
      var outcome = d.created ? 'created' : (d.changed.length ? 'updated' : 'none');
      window.location.href = profileUrl('&service_saved=' + outcome);
    } catch (err) {
      console.error('[coordinator service save]', err);
      showError('network');
    } finally {
      busy = false;
      if (!leaving) { btns.forEach(function (b) { b.disabled = false; b.textContent = label; }); }
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    var form = $('coForm'); if (form) form.addEventListener('submit', submit);
    var retry = $('coEditRetry'); if (retry) retry.addEventListener('click', function () { if (last) load(); });
  });
})();

/* Shows what the Local Tasker receives after StreetTasker's 12%, while the coordinator types the price. */
(function () {
  'use strict';
  var inp = document.getElementById('coFPrice'), out = document.getElementById('coFPriceNet');
  if (!inp || !out) return;
  var DEFAULT = out.textContent;
  function show() {
    var raw = String(inp.value || '').replace(/[\u20A6,\s]/g, '');
    var p = /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
    if (!(p > 0)) { out.textContent = DEFAULT; return; }
    out.textContent = 'At \u20A6' + p.toLocaleString('en-NG') + ', StreetTasker keeps 12% and they receive \u20A6' + Math.round(p * 0.88).toLocaleString('en-NG') + '.';
  }
  inp.addEventListener('input', show);
  setTimeout(show, 1500); /* the saved price is filled in after the page loads */
})();

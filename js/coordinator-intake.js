/* ============================================================
   StreetTasker — coordinator-intake.js (Local Tasker intake, stage 2)
   Everything a coordinator collects from a Local Tasker at the FIRST in-person meeting, on one page:
   services and agreed rates, payout account, identity check, photos. Plus the "i" pop-up that lists
   what to collect and what to explain.

   window.STIntake.mount(rootEl, taskerId)   draws the four sections into rootEl and keeps a checklist.
   window.STIntake.mountInfo(buttonEl)       makes a button open the info pop-up.

   Nothing here is new back-end: each section calls the same database functions and Edge Functions that
   coordinator-service-edit.js, coordinator-payout.js, coordinator-tasker-verify.js and coordinator-photos.js
   call, with the same inputs. The server decides who may do what. All server text goes in with textContent.
   The bank account number lives only in its input box and the request, and is cleared after a save.
   Every failure shows its error code on screen.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var root = null, tid = null, state = null;

  function $(id) { return document.getElementById(id); }
  function q(sel) { return root ? root.querySelector(sel) : null; }

  /* ── Shared helpers ─────────────────────────────────────── */
  function rpcFailure(error) {
    var hint = error && error.hint, code = error && error.code;
    if (hint) return { code: hint, message: error.message };
    if (code === '42501') return { code: 'unauthenticated', raw: code };
    if (error && (error.status === 401 || error.status === 403)) return { code: 'unauthenticated', raw: String(error.status) };
    if (code || (error && error.message && !/fetch|network/i.test(error.message))) return { code: 'server_error', raw: code || null };
    return { code: 'network' };
  }
  async function fnFailure(error) {
    var ctx = error && error.context;
    if (ctx && typeof ctx.json === 'function') {
      var body = null;
      try { body = await ctx.json(); } catch (e) { body = null; }
      var status = ctx.status;
      var code = (body && (body.error || body.code)) || (status ? 'http_' + status : 'server_error');
      var raw = null;
      if (status === 401 && !COMMON[code]) { raw = code; code = 'unauthenticated'; }
      return { code: code, message: body && body.message, raw: raw };
    }
    return { code: 'network' };
  }
  var COMMON = {
    not_found: "This Local Tasker isn't assigned to you any more, or your coordinator account isn't active. Nothing was changed.",
    not_active_coordinator: 'Your coordinator account is not active. Nothing was saved.',
    consent_required: 'Choose how they agreed and tick the confirmation.',
    unauthenticated: 'Your sign-in has expired. Please sign in again, then come back to this page.',
    network: "We couldn't reach the server. Check your connection and try again.",
    server_error: 'Something went wrong on our side. Nothing was saved. Please try again in a moment.',
    service_limit: 'A Local Tasker can have at most 5 services. Edit or pause an existing one instead.',
    duplicate_name: 'This Local Tasker already has a service with that name. Pick another title.',
    photo_limit: 'A Local Tasker can have at most 8 photos. Remove one first.',
    upload_missing: "The picture didn't finish uploading. Please choose it and try again.",
    upload_not_allowed: "You aren't allowed to upload for this person. Check that they are still assigned to you. Nothing was saved.",
    upload_failed: "The picture couldn't be uploaded. Nothing was saved. Please try again in a moment.",
    file_type: 'Choose a JPEG, PNG or WebP picture.',
    file_size: 'That picture is too large. Choose one under 25 MB.',
    image_unreadable: "That file couldn't be read as a picture. Choose another one.",
    rate_limited: 'Too many account checks in the last hour. Please wait a while and try again.',
    registered_name_incomplete: "Add the Local Tasker's full legal name (at least two names) in the profile above first. The bank name is compared with it.",
    account_not_found: "We couldn't verify that account. Check the bank and the 10 digits, then try again.",
    name_mismatch: "The account name from the bank does not match the Local Tasker's registered name. Nothing was saved.",
    paystack_unavailable: 'The bank check is not available right now. Nothing was saved. Please try again later.',
    recipient_failed: 'The account could not be registered with the payment provider. Nothing was saved.',
    live_not_approved: 'Payouts are not switched on yet. Nothing was saved.'
  };
  function banner(prefix, code, serverMessage, raw) {
    var text = COMMON[code] || (serverMessage ? serverMessage : 'Something went wrong and nothing was saved. Please try again, and quote the error code if it keeps happening.');
    var box = q('[data-err="' + prefix + '"]');
    if (!box) return;
    q('[data-err-text="' + prefix + '"]').textContent = text;
    q('[data-err-code="' + prefix + '"]').textContent = 'Error code: ' + code + (raw ? ' (' + raw + ')' : '');
    box.hidden = false; box.focus();
  }
  function clearBanner(prefix) { var b = q('[data-err="' + prefix + '"]'); if (b) b.hidden = true; }
  function note(prefix, text) { var n = q('[data-note="' + prefix + '"]'); if (!n) return; n.textContent = text || ''; n.hidden = !text; }
  function fieldError(id, msg) {
    var err = q('[data-fe="' + id + '"]'), input = q('[data-f="' + id + '"]');
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function f(id) { return q('[data-f="' + id + '"]'); }
  function val(id) { var n = f(id); return n ? String(n.value || '').trim() : ''; }
  function setDone(key, done, text) {
    var li = q('[data-check="' + key + '"]');
    if (li) { li.classList.toggle('is-done', !!done); }
    var t = q('[data-check-text="' + key + '"]'); if (t && text) t.textContent = text;
    var pill = q('[data-pill="' + key + '"]');
    if (pill) { pill.textContent = done ? 'Done' : 'To do'; pill.className = 'co-status ' + (done ? 'co-status--published' : 'co-status--draft') + ' co-card-pill'; }
    updateProgress();
  }
  function updateProgress() {
    var keys = ['services', 'payout', 'identity'];
    var done = keys.filter(function (k) { var li = q('[data-check="' + k + '"]'); return li && li.classList.contains('is-done'); }).length;
    var n = q('[data-progress]');
    if (n) n.textContent = done + ' of ' + keys.length + ' required items done. Photos are optional.';
    var fill = q('[data-progress-fill]'); if (fill) fill.style.width = Math.round(done / keys.length * 100) + '%';
  }
  function methodOptions() {
    return '<option value="">Choose one</option><option value="in_person">In person</option><option value="phone">By phone call</option><option value="written">In writing</option>';
  }
  function agreeBlock(key, text) {
    return '<div data-agree="' + key + '" hidden>' +
      '<p class="co-card-lead">Record that they agreed. Kept permanently; it cannot be edited.</p>' +
      '<div class="form-group"><label class="form-label" for="ik-' + key + '-method">How did they agree?</label>' +
      '<select class="form-select" id="ik-' + key + '-method" data-f="' + key + 'Method">' + methodOptions() + '</select>' +
      '<p class="co-field-error" data-fe="' + key + 'Method" hidden></p></div>' +
      '<div class="form-group"><label class="co-check" for="ik-' + key + '-confirm"><input type="checkbox" id="ik-' + key + '-confirm" data-f="' + key + 'Confirm" /><span>' + text + '</span></label>' +
      '<p class="co-field-error" data-fe="' + key + 'Confirm" hidden></p></div></div>' +
      '<p class="co-consent-meta" data-agree-done="' + key + '" hidden>Their agreement for this is already on record.</p>';
  }
  function errBox(prefix) {
    return '<div class="co-banner" data-err="' + prefix + '" role="alert" tabindex="-1" hidden><span data-err-text="' + prefix + '"></span><span class="co-banner-code" data-err-code="' + prefix + '"></span></div>' +
      '<div class="co-banner co-banner--info" data-note="' + prefix + '" role="status" hidden></div>';
  }
  var ICON = {
    list: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'
  };
  function head(icon, title, key, extra) {
    return '<div class="co-card-head"><span class="co-icon-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[icon] + '</svg></span>' +
      '<h2 class="co-card-title">' + title + '</h2><span class="co-status co-status--draft co-card-pill" data-pill="' + key + '">To do</span>' + (extra || '') + '</div>';
  }

  /* ── Page template (static text only) ───────────────────── */
  function template() {
    var cats = '<option value="">Choose one</option><option value="barber">Barber / Hair</option><option value="electrician">Electrician</option><option value="cleaning">House Cleaning</option><option value="mechanic">Mechanic / Auto</option><option value="plumber">Plumber</option><option value="beauty">Make-up / Beauty</option><option value="carpentry">Carpentry &amp; Tailoring Crafts</option><option value="painting">Painting</option><option value="moving">Moving / Delivery</option><option value="other">Other</option>';
    var units = '<option value="/job">Job</option><option value="/hour">Hour</option><option value="/day">Day</option><option value="/visit">Visit</option><option value="/session">Session</option>';
    return '' +
    '<section class="co-card ik-progress" aria-label="Meeting checklist">' +
      '<div class="co-card-head"><span class="co-icon-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON.list + '</svg></span><h2 class="co-card-title">Before you leave this Local Tasker</h2></div>' +
      '<div class="co-progress" aria-hidden="true"><span class="co-progress-fill" data-progress-fill></span></div>' +
      '<p class="co-card-lead" data-progress>0 of 3 required items done. Photos are optional.</p>' +
      '<ul class="co-check-list co-check-list--stack">' +
        '<li class="co-check-item" data-check="services"><span class="co-check-mark" aria-hidden="true"></span><a class="co-check-text co-fact-link" href="#ik-services" data-check-text="services">Services and agreed rates</a></li>' +
        '<li class="co-check-item" data-check="payout"><span class="co-check-mark" aria-hidden="true"></span><a class="co-check-text co-fact-link" href="#ik-payout" data-check-text="payout">Payout bank account</a></li>' +
        '<li class="co-check-item" data-check="identity"><span class="co-check-mark" aria-hidden="true"></span><a class="co-check-text co-fact-link" href="#ik-identity" data-check-text="identity">Identity check</a></li>' +
        '<li class="co-check-item is-advice" data-check="photos"><span class="co-check-mark" aria-hidden="true"></span><a class="co-check-text co-fact-link" href="#ik-photos" data-check-text="photos">Photos of their work (optional)</a></li>' +
      '</ul>' +
    '</section>' +

    /* Services */
    '<section class="co-card" id="ik-services" aria-label="Services and agreed rates">' + head('tag', 'Services and agreed rates', 'services') +
      '<p class="co-card-lead">One entry for each thing they offer, with the price they agreed. Up to 5. Hidden from customers until you publish.</p>' +
      '<p class="co-loading" data-loading="services">Loading…</p>' +
      '<ul class="co-svc-list" data-list="services" hidden></ul>' +
      '<form class="co-form ik-subform" data-form="services" novalidate>' +
        '<h3 class="ik-subtitle">Add a service</h3>' +
        '<div class="form-group"><label class="form-label" for="ik-sv-name">Service title</label><input class="form-input" type="text" id="ik-sv-name" data-f="svName" maxlength="100" autocomplete="off" placeholder="Solid wood wardrobe repair" /><p class="co-field-error" data-fe="svName" hidden></p></div>' +
        '<div class="form-group"><label class="form-label" for="ik-sv-cat">Category</label><select class="form-select" id="ik-sv-cat" data-f="svCat">' + cats + '</select><p class="co-field-error" data-fe="svCat" hidden></p></div>' +
        '<div class="form-group"><label class="form-label" for="ik-sv-desc">What is included</label><textarea class="form-textarea" id="ik-sv-desc" data-f="svDesc" maxlength="1000"></textarea><p class="form-helper">At least 10 characters. Say what the price covers and what the customer provides.</p><p class="co-field-error" data-fe="svDesc" hidden></p></div>' +
        '<div class="form-group"><label class="form-label" for="ik-sv-price">Agreed price (₦)</label><input class="form-input" type="text" id="ik-sv-price" data-f="svPrice" inputmode="decimal" autocomplete="off" placeholder="12500" /><p class="co-field-error" data-fe="svPrice" hidden></p></div>' +
        '<div class="form-group"><label class="form-label" for="ik-sv-unit">Per</label><select class="form-select" id="ik-sv-unit" data-f="svUnit">' + units + '</select></div>' +
        agreeBlock('sv', 'They agreed that these services and rates may be listed for customers once I publish.') +
        errBox('services') +
        '<button type="submit" class="btn btn-primary" data-submit="services">Save service</button>' +
      '</form>' +
    '</section>' +

    /* Payout */
    '<section class="co-card" id="ik-payout" aria-label="Payout account">' + head('card', 'Payout account', 'payout') +
      '<div class="co-proxy" role="note"><span class="co-icon-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span><p>The bank checks the account name. It must match their registered full name. The full account number is never stored; only the last four digits are kept.</p></div>' +
      '<p class="co-loading" data-loading="payout">Loading…</p>' +
      '<div data-payout-current hidden><p class="co-fact-label">Current account</p><p class="co-fact-value" data-payout-current-text></p></div>' +
      '<form class="co-form ik-subform" data-form="payout" novalidate autocomplete="off">' +
        '<div class="form-group"><label class="form-label" for="ik-po-bank">Bank</label><select class="form-select" id="ik-po-bank" data-f="poBank" disabled><option value="">Loading banks…</option></select><p class="co-field-error" data-fe="poBank" hidden></p></div>' +
        '<div class="form-group"><label class="form-label" for="ik-po-acct">10-digit account number</label><input class="form-input" type="text" id="ik-po-acct" data-f="poAcct" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false" /><p class="form-helper"><span data-po-count>0</span> of 10 digits. Checked with the bank and not stored.</p><p class="co-field-error" data-fe="poAcct" hidden></p></div>' +
        '<button type="button" class="btn btn-outline" data-action="po-check" disabled>Check account with the bank</button>' +
        '<div class="co-po-result" data-po-result role="status" aria-live="polite" hidden><p class="co-fact-label" data-po-result-label>Account holder</p><p class="co-po-result-name" data-po-result-name></p><p class="co-fact-value" data-po-result-note></p></div>' +
        '<div class="form-group ik-gap"><label class="co-check" for="ik-po-auth"><input type="checkbox" id="ik-po-auth" data-f="poAuth" /><span>They agreed that this bank account may receive their booking payouts.</span></label>' +
        '<label class="co-check" for="ik-po-own"><input type="checkbox" id="ik-po-own" data-f="poOwn" /><span>They told me this account belongs to them, with no one else involved.</span></label><p class="co-field-error" data-fe="poConfirm" hidden></p></div>' +
        '<div class="form-group"><label class="form-label" for="ik-po-method">How did they agree?</label><select class="form-select" id="ik-po-method" data-f="poMethod">' + methodOptions() + '</select><p class="co-field-error" data-fe="poMethod" hidden></p></div>' +
        errBox('payout') +
        '<button type="submit" class="btn btn-primary" data-submit="payout" disabled>Verify and save bank details</button>' +
        '<p class="co-card-lead" data-po-replace hidden>Saving a new account replaces the current one.</p>' +
      '</form>' +
    '</section>' +

    /* Identity */
    '<section class="co-card" id="ik-identity" aria-label="Identity check">' + head('shield', 'Identity check', 'identity') +
      '<p class="co-card-lead">They do the check on their own phone camera, with you beside them. Only the result of the check can mark them verified. A profile cannot be published until it is.</p>' +
      '<p class="co-loading" data-loading="identity">Loading…</p>' +
      '<p class="co-fact-value" data-id-status hidden></p>' +
      '<div data-id-start hidden>' +
        '<div data-id-consent>' +
          '<p class="cv-sub">Read or explain this to them first.</p>' +
          '<div class="cv-consent-text" tabindex="0" role="region" aria-label="What the Local Tasker agrees to">' +
            '<p><strong>Who is responsible.</strong> StreetTasker decides why and how the verification information is used. Didit, our identity verification provider, carries out the check on our behalf and under our instructions.</p>' +
            '<p><strong>What is collected.</strong> A photo of a government-issued ID, including the details printed on it; a short live selfie check to show a real person is present; and a comparison of the face with the photo on the ID. This comparison uses <strong>biometric data</strong>, which is sensitive personal data.</p>' +
            '<p><strong>Why it is used.</strong> Only to confirm that the person is the person on the ID, so that people on StreetTasker can trust who they are dealing with and to help prevent fraud and impersonation. It is not used for marketing and it is not sold.</p>' +
            '<p><strong>Who handles it.</strong> Didit collects and processes the ID photo, selfie and face comparison, and may do so outside Nigeria. StreetTasker receives the result of the check (for example verified or not completed) and the dates, not the ID images, and does not ask for an ID number. If a check needs a manual review, authorised StreetTasker staff may view the verification record in Didit. The information is not shared with anyone else, except where the law requires it.</p>' +
            '<p><strong>How long it is kept.</strong> StreetTasker keeps the result and dates while the account is active. Didit keeps the images only for a limited period set in our Didit account, and then deletes them.</p>' +
            '<p><strong>Their choice and rights.</strong> Giving consent is their choice. Verification is required to be offered on StreetTasker, and without consent we cannot verify them. They can withdraw consent at any time by emailing support@streettasker.com. Withdrawing does not undo what has already happened. They can ask to see, correct or delete their information by emailing the same address, and can complain to the Nigeria Data Protection Commission.</p>' +
            '<p><strong>Your part as coordinator.</strong> You explain this to them first, and you record that they agreed, how, and when. They do the check on their own phone.</p>' +
          '</div>' +
          '<div class="form-group"><label class="form-label" for="ik-id-method">How did they give consent?</label><select class="form-select" id="ik-id-method" data-f="idMethod">' + methodOptions() + '</select></div>' +
          '<div class="form-group"><label class="co-check" for="ik-id-confirm"><input type="checkbox" id="ik-id-confirm" data-f="idConfirm" /><span>I explained the notice above and this Local Tasker agreed to the identity check.</span></label></div>' +
        '</div>' +
        '<p class="cv-sub" data-id-consent-done hidden>Their consent to the identity check is already recorded.</p>' +
        errBox('identity') +
        '<button type="button" class="btn btn-primary" data-action="id-start" disabled>Start verification for this Local Tasker</button>' +
        '<div class="cv-linkbox" data-id-link hidden>' +
          '<p class="cv-sub">Give this link to the Local Tasker. They open it on their own phone and follow the steps. Do not send it to anyone else.</p>' +
          '<input type="text" class="form-input" data-id-link-input readonly autocomplete="off" aria-label="Verification link" />' +
          '<div class="cv-actions"><button type="button" class="btn btn-outline" data-action="id-copy">Copy link</button><a class="btn btn-primary" data-id-open href="#" rel="noopener">Open on this device</a></div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="btn btn-outline ik-gap" data-action="id-refresh" hidden>Check again</button>' +
    '</section>' +

    /* Photos */
    '<section class="co-card" id="ik-photos" aria-label="Photos">' + head('camera', 'Photos of their work (optional)', 'photos') +
      '<p class="co-card-lead">Up to 8. Private until you publish. Pictures are shrunk in your browser and phone location data is removed.</p>' +
      '<p class="co-loading" data-loading="photos">Loading…</p>' +
      '<ul class="co-photo-strip" data-list="photos" hidden></ul>' +
      '<p class="co-consent-meta" data-photo-count hidden></p>' +
      '<form class="co-form ik-subform" data-form="photos" novalidate>' +
        '<div class="form-group"><label class="form-label" for="ik-ph-file">Choose a photo</label><input class="form-input" type="file" id="ik-ph-file" data-f="phFile" accept="image/jpeg,image/png,image/webp" /><p class="co-field-error" data-fe="phFile" hidden></p></div>' +
        '<div class="form-group"><label class="form-label" for="ik-ph-cap">Caption (optional)</label><input class="form-input" type="text" id="ik-ph-cap" data-f="phCap" maxlength="120" autocomplete="off" /><p class="co-field-error" data-fe="phCap" hidden></p></div>' +
        '<div class="form-group"><label class="co-check" for="ik-ph-cover"><input type="checkbox" id="ik-ph-cover" data-f="phCover" /><span>Use as the cover photo</span></label></div>' +
        agreeBlock('ph', 'They agreed that photos of their work may be shown on their profile once I publish.') +
        errBox('photos') +
        '<button type="submit" class="btn btn-primary" data-submit="photos">Upload photo</button>' +
      '</form>' +
    '</section>';
  }

  /* ════════ SERVICES ════════ */
  var UNIT = { '/job': 'job', '/hour': 'hour', '/day': 'day', '/visit': 'visit', '/session': 'session' };
  function money(n) { var x = Number(n); return isFinite(x) ? '₦' + x.toLocaleString('en-NG', { maximumFractionDigits: 2 }) : ''; }
  async function consentExists(purpose) {
    try {
      var cs = await window.supabase.from('local_tasker_consents').select('id').eq('tasker_user_id', tid).eq('purpose', purpose).is('revoked_at', null);
      if (cs.error) throw cs.error;
      return !!(cs.data && cs.data.length);
    } catch (e) { return null; }   /* unknown: show the fields and let the database decide */
  }
  function showAgree(key, exists) {
    var need = exists !== true;
    var a = q('[data-agree="' + key + '"]'), d = q('[data-agree-done="' + key + '"]');
    if (a) a.hidden = !need; if (d) d.hidden = need;
    state['need_' + key] = need;
    if (need && state.method) { var m = f(key + 'Method'); if (m && !m.value) m.value = state.method; }
  }
  async function loadServices() {
    var list = q('[data-list="services"]'); q('[data-loading="services"]').hidden = false; list.hidden = true; list.textContent = '';
    try {
      var res = await window.supabase.from('services').select('id, service_name, category, price, rate_unit, description, available, created_at').eq('user_id', tid).order('created_at', { ascending: true });
      if (res.error) throw res.error;
      var rows = res.data || [];
      rows.forEach(function (s) {
        var li = C.el('li', 'co-svc-item');
        var h = C.el('div', 'co-consent-head');
        h.appendChild(C.el('span', 'co-consent-purpose', s.service_name || 'Service'));
        h.appendChild(C.el('span', s.available === false ? 'co-status co-status--draft' : 'co-status co-status--published', s.available === false ? 'Paused' : 'Active'));
        li.appendChild(h);
        var p = money(s.price);
        var meta = (s.category ? C.statusLabel(s.category) : '') + (p ? (s.category ? ' · ' : '') + p + (UNIT[s.rate_unit] ? ' per ' + UNIT[s.rate_unit] : '') : '');
        if (meta) li.appendChild(C.el('p', 'co-consent-meta', meta));
        if (s.description) li.appendChild(C.el('p', 'co-consent-note', s.description));
        var a = C.el('a', 'co-fact-link', 'Edit service'); a.href = 'coordinator-service-edit.html?id=' + encodeURIComponent(tid) + '&service=' + encodeURIComponent(s.id);
        li.appendChild(a); list.appendChild(li);
      });
      list.hidden = !rows.length;
      state.svcCount = rows.length;
      setDone('services', rows.length > 0, rows.length ? 'Services and agreed rates (' + rows.length + ' added)' : 'Services and agreed rates');
      q('[data-form="services"]').hidden = rows.length >= 5;
      if (rows.length >= 5) note('services', 'The most services allowed (5) are added. Use Edit service to change one.');
    } catch (e) {
      console.error('[intake services]', e);
      banner('services', 'network');
    }
    q('[data-loading="services"]').hidden = true;
    showAgree('sv', await consentExists('publish_info'));
  }
  function parsePrice(raw) { var s = String(raw || '').replace(/[₦,\s]/g, ''); return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN; }
  async function submitService(e) {
    e.preventDefault(); if (state.busy.services) return;
    clearBanner('services'); note('services', '');
    var name = val('svName'), cat = val('svCat'), desc = val('svDesc'), price = parsePrice(val('svPrice')), u = val('svUnit') || '/job';
    var bad = null;
    function fail(id, m) { fieldError(id, m); if (!bad) bad = id; }
    ['svName', 'svCat', 'svDesc', 'svPrice', 'svMethod', 'svConfirm'].forEach(function (i) { fieldError(i, ''); });
    if (name.length < 3) fail('svName', 'Enter a title (at least 3 characters).');
    if (!cat) fail('svCat', 'Choose a category.');
    if (desc.length < 10) fail('svDesc', 'Describe what is included (at least 10 characters).');
    if (!(price > 0) || price > 10000000) fail('svPrice', 'Enter the agreed price as a number, for example 12500.');
    if (state.need_sv) { if (!val('svMethod')) fail('svMethod', 'Choose how they agreed.'); if (!f('svConfirm').checked) fail('svConfirm', 'Tick the box to confirm they agreed.'); }
    if (bad) { f(bad).focus(); return; }
    state.busy.services = true;
    var btn = q('[data-submit="services"]'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var res = await window.supabase.rpc('save_local_tasker_service', {
        p_tasker: tid, p_service_id: null, p_name: name, p_category: cat, p_price: price, p_rate_unit: u, p_description: desc,
        p_location: '', p_specialties: [], p_availability: 'available_this_week', p_available: true,
        p_consent_method: state.need_sv ? val('svMethod') : null, p_consent_evidence: state.need_sv ? '' : null, p_consent_details: state.need_sv ? '' : null
      });
      if (res.error) { var fl = rpcFailure(res.error); banner('services', fl.code, fl.message, fl.raw); return; }
      var d = res.data;
      if (!d || !C.isUuid(d.service_id)) { banner('services', 'bad_response'); return; }
      ['svName', 'svDesc', 'svPrice'].forEach(function (i) { f(i).value = ''; }); f('svCat').value = '';
      await loadServices();
      note('services', 'Service saved. Add another, or move on to the payout account.');
    } catch (err) { console.error('[intake service save]', err); banner('services', 'network'); }
    finally { state.busy.services = false; btn.disabled = false; btn.textContent = label; }
  }

  /* ════════ PAYOUT ════════ */
  var verifiedAcct = null;
  function acctDigits() { return f('poAcct').value.replace(/\D/g, '').slice(0, 10); }
  function acctKey() { return f('poBank').value + ':' + acctDigits(); }
  function refreshPayout() {
    q('[data-po-count]').textContent = String(acctDigits().length);
    var ok = !!verifiedAcct && verifiedAcct.key === acctKey();
    if (!ok && verifiedAcct) { verifiedAcct = null; q('[data-po-result]').hidden = true; }
    var ready = ok && f('poAuth').checked && f('poOwn').checked && !!f('poMethod').value;
    q('[data-submit="payout"]').disabled = !ready || state.busy.payout;
    q('[data-action="po-check"]').disabled = state.busy.payout || !f('poBank').value || acctDigits().length !== 10;
  }
  async function payoutCall(body) {
    var res = await window.supabase.functions.invoke('local-payout-account', { body: body });
    if (res.error) { var fl = await fnFailure(res.error); var e = new Error(fl.code); e.fail = fl; throw e; }
    if (!res.data || res.data.ok !== true) { var e2 = new Error('bad_response'); e2.fail = { code: 'bad_response' }; throw e2; }
    return res.data;
  }
  async function loadBanks() {
    var sel = f('poBank');
    try {
      var d = await payoutCall({ action: 'banks' });
      sel.textContent = '';
      var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Choose a bank'; sel.appendChild(o0);
      (d.banks || []).forEach(function (b) { var o = document.createElement('option'); o.value = b.code; o.textContent = b.name; sel.appendChild(o); });
      sel.disabled = false;
    } catch (e) {
      sel.textContent = ''; var o = document.createElement('option'); o.value = ''; o.textContent = 'Bank list unavailable'; sel.appendChild(o);
      var fl = e.fail || { code: 'network' };
      fieldError('poBank', (COMMON[fl.code] || 'The bank list could not be loaded.') + ' Reload the page to try again. (' + fl.code + ')');
    }
    refreshPayout();
  }
  async function loadPayout() {
    q('[data-loading="payout"]').hidden = false;
    try {
      var res = await window.supabase.rpc('local_payout_account', { p_tasker: tid });
      if (res.error) throw res.error;
      var a = res.data || {}, has = a.has_account === true;
      q('[data-payout-current]').hidden = !has;
      q('[data-po-replace]').hidden = !has;
      if (has) q('[data-payout-current-text]').textContent = (a.bank_name || 'Bank') + ' ' + (a.account_mask || '') + (a.account_name ? ' · ' + a.account_name : '') + ' · verified ' + C.formatDate(a.verified_at);
      setDone('payout', has, has ? 'Payout bank account (saved)' : 'Payout bank account');
      q('[data-submit="payout"]').textContent = has ? 'Verify and replace bank details' : 'Verify and save bank details';
    } catch (e) { console.error('[intake payout]', e && e.code); banner('payout', 'network'); }
    q('[data-loading="payout"]').hidden = true;
  }
  async function poCheck() {
    if (state.busy.payout) return;
    clearBanner('payout'); fieldError('poBank', ''); fieldError('poAcct', '');
    var bank = f('poBank').value, acct = acctDigits();
    if (!bank) { fieldError('poBank', 'Choose the bank.'); f('poBank').focus(); return; }
    if (acct.length !== 10) { fieldError('poAcct', 'Enter all 10 digits.'); f('poAcct').focus(); return; }
    state.busy.payout = true; verifiedAcct = null; q('[data-po-result]').hidden = true;
    var btn = q('[data-action="po-check"]'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Checking…';
    try {
      var d = await payoutCall({ action: 'resolve', tasker_id: tid, bank_code: bank, account_number: acct });
      if (d.matched === true && typeof d.account_name === 'string') { verifiedAcct = { key: bank + ':' + acct }; poResult('ok', d.account_name, "The bank's name matches the registered name."); }
      else poResult('bad', '', "The bank's name for this account does not match the registered name, so it cannot be used. Check the bank and the number with the Local Tasker.");
    } catch (e) {
      var fl = e.fail || { code: 'network' };
      if (fl.code === 'account_not_found') poResult('bad', '', COMMON.account_not_found); else banner('payout', fl.code, fl.message, fl.raw);
    } finally { state.busy.payout = false; btn.textContent = label; refreshPayout(); }
  }
  function poResult(kind, name, text) {
    var box = q('[data-po-result]'); box.hidden = false;
    box.classList.toggle('is-ok', kind === 'ok'); box.classList.toggle('is-bad', kind !== 'ok');
    q('[data-po-result-label]').textContent = kind === 'ok' ? 'Account holder (confirmed by the bank)' : 'Account check';
    var n = q('[data-po-result-name]'); n.textContent = name || ''; n.hidden = !name;
    q('[data-po-result-note]').textContent = text || '';
  }
  async function submitPayout(e) {
    e.preventDefault(); if (state.busy.payout) return;
    clearBanner('payout'); note('payout', '');
    if (!verifiedAcct || verifiedAcct.key !== acctKey()) { banner('payout', 'bad_input', 'Check the account with the bank first.'); return; }
    fieldError('poMethod', ''); fieldError('poConfirm', '');
    if (!f('poMethod').value) { fieldError('poMethod', 'Choose how they agreed.'); f('poMethod').focus(); return; }
    if (!f('poAuth').checked || !f('poOwn').checked) { fieldError('poConfirm', 'Tick both confirmations.'); return; }
    state.busy.payout = true;
    var btn = q('[data-submit="payout"]'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var d = await payoutCall({ action: 'save', tasker_id: tid, bank_code: f('poBank').value, account_number: acctDigits(),
        consent: { authorized: true, ownership: true, method: f('poMethod').value, evidence_ref: '', details: '' } });
      f('poAcct').value = ''; f('poBank').value = ''; verifiedAcct = null; q('[data-po-result]').hidden = true;
      f('poAuth').checked = false; f('poOwn').checked = false; f('poMethod').value = '';
      await loadPayout();
      note('payout', (d.changed ? 'Saved. ' : 'Already saved. ') + d.bank_name + ' ' + d.account_mask + ' is now the payout account.');
    } catch (err) { var fl = err.fail || { code: 'network' }; banner('payout', fl.code, fl.message, fl.raw); }
    finally { state.busy.payout = false; btn.textContent = label; refreshPayout(); }
  }

  /* ════════ IDENTITY ════════ */
  var ID_LABEL = { NOT_STARTED: 'Not started yet', IN_PROGRESS: 'In progress: they have not finished', PENDING: 'Pending: waiting for the result', VERIFIED: 'Verified', REVIEW_REQUIRED: 'Needs attention: being reviewed', FAILED: 'Not completed: start again', ABANDONED: 'Not completed: start again', RESUBMIT_REQUESTED: 'Action required: they must repeat some steps', EXPIRED: 'Expired: start again' };
  var SHOW_START = { NOT_STARTED: 1, FAILED: 1, ABANDONED: 1, EXPIRED: 1, IN_PROGRESS: 1, RESUBMIT_REQUESTED: 1 };
  function isDiditUrl(raw) { try { var u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'didit.me' || u.hostname.slice(-9) === '.didit.me'); } catch (e) { return false; } }
  async function idCall(name, body) {
    var r = await window.supabase.functions.invoke(name, { body: body });
    if (r.error) { var msg = ''; try { var j = await r.error.context.json(); msg = (j && j.message) || ''; } catch (e) { /* no body */ } throw new Error(msg || 'Something went wrong. Please try again.'); }
    if (!r.data || r.data.ok !== true) throw new Error((r.data && r.data.message) || 'Something went wrong. Please try again.');
    return r.data;
  }
  function idReady() {
    var btn = q('[data-action="id-start"]');
    var ok = state.idConsent || (val('idMethod') && f('idConfirm').checked);
    btn.disabled = state.busy.identity || !ok;
  }
  async function loadIdentity() {
    q('[data-loading="identity"]').hidden = false;
    try {
      var r = await window.supabase.rpc('idv_local_status', { p_tasker: tid });
      if (r.error || !r.data) throw new Error('status');
      var s = r.data, st = s.status || 'NOT_STARTED';
      state.idStatus = st; state.idConsent = s.consent_given === true;
      var line = q('[data-id-status]'); line.textContent = 'Status: ' + (ID_LABEL[st] || st); line.hidden = false;
      setDone('identity', st === 'VERIFIED', st === 'VERIFIED' ? 'Identity check (verified)' : (st === 'NOT_STARTED' ? 'Identity check' : 'Identity check (started: ' + (ID_LABEL[st] || st).split(':')[0].toLowerCase() + ')'));
      q('[data-id-start]').hidden = !SHOW_START[st];
      q('[data-id-consent]').hidden = state.idConsent; q('[data-id-consent-done]').hidden = !state.idConsent;
      q('[data-action="id-start"]').textContent = (st === 'IN_PROGRESS' || st === 'RESUBMIT_REQUESTED') ? 'Show the link again' : 'Start verification for this Local Tasker';
      q('[data-action="id-refresh"]').hidden = st === 'VERIFIED' || st === 'NOT_STARTED';
      if (!state.idConsent && state.method && !f('idMethod').value) f('idMethod').value = state.method;
      idReady();
    } catch (e) {
      console.error('[intake identity]', e);
      var line2 = q('[data-id-status]'); line2.textContent = 'We could not load the identity check status. Reload the page to try again.'; line2.hidden = false;
    }
    q('[data-loading="identity"]').hidden = true;
  }
  async function idStart() {
    if (state.busy.identity) return;
    state.busy.identity = true; idReady(); clearBanner('identity'); note('identity', '');
    try {
      if (!state.idConsent) {
        var c = await window.supabase.rpc('idv_record_local_consent', { p_tasker: tid, p_method: val('idMethod'), p_evidence_ref: null, p_details: null });
        if (c.error) throw new Error((c.error.hint && c.error.message) || 'Something went wrong. Please try again.');
        state.idConsent = true;
      }
      var made = await idCall('didit-create-session', { mode: 'proxy', local_tasker_user_id: tid, request_id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10) });
      if (!isDiditUrl(made.url)) throw new Error('Something went wrong. Please try again.');
      q('[data-id-link-input]').value = made.url; q('[data-id-open]').setAttribute('href', made.url);
      q('[data-id-link]').hidden = false; q('[data-id-consent]').hidden = true; q('[data-id-consent-done]').hidden = false;
      q('[data-action="id-refresh"]').hidden = false;
      note('identity', 'Verification is ready. Give the link to the Local Tasker now. After they finish, use Check again.');
    } catch (e) { banner('identity', 'bad_input', e.message); }
    state.busy.identity = false; idReady();
  }
  function idCopy() {
    var inp = q('[data-id-link-input]'); if (!inp || !inp.value) return;
    try { if (navigator.clipboard) { navigator.clipboard.writeText(inp.value).then(function () { note('identity', 'Link copied.'); }, function () { inp.select(); }); return; } } catch (e) { /* fall through */ }
    inp.select();
  }
  async function idRefresh() {
    var btn = q('[data-action="id-refresh"]');
    if (state.busy.identity) return;
    state.busy.identity = true; btn.disabled = true; note('identity', '');
    var before = state.idStatus, reached = true;
    try { await idCall('didit-sync', { mode: 'proxy', local_tasker_user_id: tid, returned: false }); }
    catch (e) { reached = false; note('identity', 'We could not reach the verification service just now. Showing the last saved status.'); }
    await loadIdentity();
    if (reached && state.idStatus === before) note('identity', 'No update yet. Please check again in a little while.');
    window.setTimeout(function () { state.busy.identity = false; btn.disabled = false; idReady(); }, 5000);
  }

  /* ════════ PHOTOS ════════ */
  var BUCKET = 'local-tasker-photos', MAX_PHOTOS = 8, MAX_SIDE = 1600, MAX_BYTES = 5 * 1024 * 1024, MAX_INPUT = 25 * 1024 * 1024;
  var picking = 0;
  function newId() { return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (function () { var b = new Uint8Array(16); window.crypto.getRandomValues(b); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); })(); }
  function decode(file) {
    var viaImg = function () { return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { URL.revokeObjectURL(u); res(im); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('decode')); }; im.src = u; }); };
    return window.createImageBitmap ? window.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(viaImg) : viaImg();
  }
  async function prepare(file) {
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) < 0) throw { code: 'file_type' };
    if (file.size > MAX_INPUT) throw { code: 'file_size' };
    var img; try { img = await decode(file); } catch (e) { throw { code: 'image_unreadable' }; }
    var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    if (!w || !h) throw { code: 'image_unreadable' };
    var sc = Math.min(1, MAX_SIDE / Math.max(w, h)), cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var cx = cv.getContext('2d'); if (!cx) throw { code: 'image_unreadable' };
    cx.fillStyle = 'white'; cx.fillRect(0, 0, cw, ch); cx.drawImage(img, 0, 0, cw, ch); if (img.close) img.close();
    var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.85); });
    if (!blob) throw { code: 'image_unreadable' };
    if (blob.size > MAX_BYTES) throw { code: 'file_size' };
    return blob;
  }
  async function onPick() {
    var input = f('phFile'), file = input.files && input.files[0], ticket = ++picking;
    state.prepared = null; fieldError('phFile', '');
    if (!file) return;
    try { var blob = await prepare(file); if (ticket !== picking) return; state.prepared = { blob: blob, path: tid + '/' + newId() + '.jpg' }; }
    catch (e) { if (ticket !== picking) return; fieldError('phFile', COMMON[(e && e.code) || 'image_unreadable']); input.value = ''; }
  }
  async function loadPhotos() {
    var strip = q('[data-list="photos"]'); q('[data-loading="photos"]').hidden = false; strip.hidden = true; strip.textContent = '';
    try {
      var res = await window.supabase.from('local_tasker_photos').select('id, storage_path, caption, is_cover, created_at').eq('tasker_user_id', tid).is('removed_at', null).order('is_cover', { ascending: false }).order('created_at', { ascending: true });
      if (res.error) throw res.error;
      var rows = res.data || [], map = {};
      if (rows.length) {
        try {
          var s = await window.supabase.storage.from(BUCKET).createSignedUrls(rows.map(function (r) { return r.storage_path; }), 3600);
          if (!s.error) (s.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) map[d.path] = d.signedUrl; });
        } catch (e) { console.error('[intake photo links]', e); }
      }
      rows.forEach(function (p, i) {
        var li = C.el('li', 'co-photo-thumb');
        if (map[p.storage_path]) { var im = C.el('img'); im.src = map[p.storage_path]; im.alt = p.caption || ('Photo ' + (i + 1)); im.loading = 'lazy'; li.appendChild(im); }
        else li.appendChild(C.el('span', 'co-photo-missing', 'Unavailable'));
        if (p.is_cover) li.appendChild(C.el('span', 'co-status co-status--published co-photo-cover', 'Cover'));
        strip.appendChild(li);
      });
      strip.hidden = !rows.length;
      var cnt = q('[data-photo-count]');
      cnt.hidden = !rows.length;
      if (rows.length) { cnt.textContent = rows.length + (rows.length === 1 ? ' photo' : ' photos') + ' of ' + MAX_PHOTOS + '. To change captions, the cover, or remove one, use '; var a = C.el('a', 'co-fact-link', 'Manage photos'); a.href = 'coordinator-photos.html?id=' + encodeURIComponent(tid); cnt.appendChild(a); }
      setDone('photos', rows.length > 0, rows.length ? 'Photos of their work (' + rows.length + ' added)' : 'Photos of their work (optional)');
      q('[data-form="photos"]').hidden = rows.length >= MAX_PHOTOS;
    } catch (e) { console.error('[intake photos]', e); banner('photos', 'network'); }
    q('[data-loading="photos"]').hidden = true;
    showAgree('ph', await consentExists('photos'));
  }
  async function submitPhoto(e) {
    e.preventDefault(); if (state.busy.photos) return;
    clearBanner('photos'); note('photos', '');
    ['phFile', 'phCap', 'phMethod', 'phConfirm'].forEach(function (i) { fieldError(i, ''); });
    var bad = null; function fail(id, m) { fieldError(id, m); if (!bad) bad = id; }
    if (!state.prepared) fail('phFile', 'Choose a photo first.');
    if (val('phCap').length > 120) fail('phCap', 'Keep the caption under 120 characters.');
    if (state.need_ph) { if (!val('phMethod')) fail('phMethod', 'Choose how they agreed.'); if (!f('phConfirm').checked) fail('phConfirm', 'Tick the box to confirm they agreed.'); }
    if (bad) { f(bad).focus(); return; }
    state.busy.photos = true;
    var btn = q('[data-submit="photos"]'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      var up = await window.supabase.storage.from(BUCKET).upload(state.prepared.path, state.prepared.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      if (up && up.error) {
        var sc = String(up.error.statusCode || up.error.status || ''), m = up.error.message || '';
        var code = (sc === '409' || /already exists|duplicate/i.test(m)) ? 'exists' : (sc === '401' || sc === '403' || /row-level security|unauthori[sz]ed|not allowed/i.test(m)) ? 'upload_not_allowed' : (/failed to fetch|network/i.test(m)) ? 'network' : 'upload_failed';
        if (code !== 'exists') { banner('photos', code, null, sc || null); return; }
      }
      var res = await window.supabase.rpc('add_local_tasker_photo', {
        p_tasker: tid, p_path: state.prepared.path, p_caption: val('phCap'), p_make_cover: f('phCover').checked,
        p_consent_method: state.need_ph ? val('phMethod') : null, p_consent_evidence: state.need_ph ? '' : null, p_consent_details: state.need_ph ? '' : null
      });
      if (res.error) { var fl = rpcFailure(res.error); banner('photos', fl.code, fl.message, fl.raw); return; }
      var d = res.data;
      if (!d || !C.isUuid(d.photo_id)) { banner('photos', 'bad_response'); return; }
      state.prepared = null; picking++; f('phFile').value = ''; f('phCap').value = ''; f('phCover').checked = false;
      await loadPhotos();
      note('photos', 'Photo added.');
    } catch (err) { console.error('[intake photo add]', err); banner('photos', 'network'); }
    finally { state.busy.photos = false; btn.disabled = false; btn.textContent = label; }
  }

  /* ════════ MOUNT ════════ */
  function mount(el, taskerId, opts) {
    root = el; tid = taskerId; opts = opts || {};
    state = { busy: {}, method: opts.method || '', need_sv: true, need_ph: true, prepared: null, idConsent: false };
    root.innerHTML = template();
    var sf = q('[data-form="services"]'); sf.addEventListener('submit', submitService);
    var pf = q('[data-form="payout"]'); pf.addEventListener('submit', submitPayout);
    pf.addEventListener('input', function (ev) { if (ev.target === f('poAcct')) { var d = acctDigits(); if (f('poAcct').value !== d) f('poAcct').value = d; } refreshPayout(); });
    pf.addEventListener('change', refreshPayout);
    q('[data-form="photos"]').addEventListener('submit', submitPhoto);
    f('phFile').addEventListener('change', onPick);
    q('[data-action="po-check"]').addEventListener('click', poCheck);
    q('[data-action="id-start"]').addEventListener('click', idStart);
    q('[data-action="id-copy"]').addEventListener('click', idCopy);
    q('[data-action="id-refresh"]').addEventListener('click', idRefresh);
    ['idMethod', 'idConfirm'].forEach(function (i) { f(i).addEventListener('change', idReady); });
    loadBanks(); loadServices(); loadPayout(); loadIdentity(); loadPhotos();
  }

  /* ════════ INFO POP-UP ════════ */
  var INFO = '' +
    '<div class="ik-info-body">' +
    '<h3>Before you meet</h3><p>Ask them to bring:</p><ul>' +
      '<li>A valid government ID that has not expired, for the identity check.</li>' +
      '<li>Their own phone with a working camera, for the identity check (the check is done on their phone, not yours).</li>' +
      '<li>Their bank account details: the bank and the 10-digit account number, in their own name.</li>' +
      '<li>A few clear photos of their work, if they want to show them.</li></ul>' +
    '<h3>What you will collect</h3><ol>' +
      '<li><strong>Profile.</strong> Public name (what customers see), full legal name (must match the bank account name, at least two names), phone number, skills (up to 20), areas served, availability notes.</li>' +
      '<li><strong>Their agreement.</strong> How they agreed (in person, by phone or in writing), an optional reference such as a form number, and your confirmation. The record is permanent.</li>' +
      '<li><strong>Services and agreed rates.</strong> Up to 5. For each: a title, a category, what is included, the price they agreed and what it is per (job, hour, day, visit or session).</li>' +
      '<li><strong>Payout account.</strong> The bank and 10-digit account number. The bank confirms the account name matches their full name. They confirm they agree to payouts going there and that the account is theirs alone. Only the last four digits are stored.</li>' +
      '<li><strong>Identity check.</strong> You record that they agreed to it, start it, and give them the link. They complete it on their own phone. The profile cannot be published until it shows Verified.</li>' +
      '<li><strong>Photos (optional).</strong> Up to 8 photos of their work, with an optional caption and a cover photo. Their agreement is recorded the first time.</li></ol>' +
    '<h3>What to explain to them</h3><ul>' +
      '<li><strong>What this is.</strong> StreetTasker connects customers with skilled people. They do not need a smartphone or the internet: you register them, manage their profile and speak to them by phone.</li>' +
      '<li><strong>Nothing goes live without them.</strong> You work with their agreement. Nothing is shown to customers until you publish, and publishing needs their identity verified.</li>' +
      '<li><strong>Privacy.</strong> Their phone number and full name stay private to you and StreetTasker administrators. Customers see only the public name, services, prices, area and photos.</li>' +
      '<li><strong>How a booking works.</strong> A customer requests a booking. You call them, check they are available, read the price back to them and send the customer a quote. The customer approves and pays, and the money is held safely. When the job is done the customer gives you a release code, and entering it pays the money to their own bank account.</li>' +
      '<li><strong>Prices.</strong> They set the rates. Every price change is recorded. You earn a commission from the service fee.</li>' +
      '<li><strong>The identity check.</strong> It uses a photo of their ID and a short selfie, run by our provider Didit. StreetTasker receives only the result, not the ID images. The images are kept for a limited time and then deleted. It is their choice; without it they cannot be verified. They can withdraw consent, or ask to see, correct or delete their information, by emailing support@streettasker.com, and can complain to the Nigeria Data Protection Commission.</li>' +
      '<li><strong>Payouts.</strong> Only to a bank account in their own name. The bank checks the name. A different account later needs a new check and a new agreement from them.</li>' +
      '<li><strong>Photos.</strong> Private until you publish. It is their decision which ones to show.</li>' +
      '<li><strong>Staying reachable.</strong> You will phone them for each booking, so check the phone number with them and make sure they will answer it.</li>' +
      '<li><strong>If something goes wrong.</strong> A problem can be reported, and StreetTasker support will step in.</li></ul>' +
    '<h3>Before you leave</h3><ul>' +
      '<li>Read their details back to them.</li>' +
      '<li>Check every item in the checklist is done, apart from the optional photos.</li>' +
      '<li>Make sure they have started the identity check on their phone before you go, or agree when they will finish it.</li></ul>' +
    '</div>';

  function mountInfo(btn) {
    if (!btn || btn.getAttribute('data-ik-info') === '1') return;
    btn.setAttribute('data-ik-info', '1');
    var dlg = document.createElement('dialog');
    dlg.className = 'ik-dialog'; dlg.setAttribute('aria-labelledby', 'ikInfoTitle');
    dlg.innerHTML = '<div class="ik-dialog-head"><h2 id="ikInfoTitle">What to collect and what to explain</h2><button type="button" class="ik-dialog-close btn btn-ghost" aria-label="Close">Close</button></div>' + INFO;
    document.body.appendChild(dlg);
    btn.addEventListener('click', function () { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); });
    dlg.querySelector('.ik-dialog-close').addEventListener('click', function () { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && dlg.close) dlg.close(); });
  }

  window.STIntake = { mount: mount, mountInfo: mountInfo };
})();

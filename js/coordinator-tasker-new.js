/* ============================================================
   StreetTasker — coordinator-tasker-new.js (Stage 4A-2)
   "Add a Local Tasker" form. The browser never writes the database: it calls the
   Edge Function `local-tasker-create` (Stage 2D) with the coordinator's own sign-in
   token. The function re-checks that the caller is an ACTIVE coordinator, makes the
   locked placeholder account, and writes everything in ONE transaction.

   Retry safety: ONE request_id is made when the form is first opened and kept in
   sessionStorage. Every submit of this form sends the same id, so a double click, a
   slow connection or a retry can never create a second Local Tasker. The id is
   dropped after a success (or when the server says it was already used).

   Every failure shows the function's error code on screen, so a problem can be
   reported without looking at server logs.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }

  var KEY = 'st_co_new_request';
  var memId = null;       /* used only if sessionStorage is blocked */
  var busy = false;
  var last = null;
  var atCap = false;
  var leaving = false;    /* success: the page is changing, keep the button off */

  /* Same limits as the function and the database. */
  var PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
  var LIMITS = { publicName: [2, 80], fullName: [2, 120], areas: 300, notes: 500, skills: 20, skill: 60, evidence: 500, details: 1000 };

  function uuid4() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var b = new Uint8Array(16); window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function requestId() {
    try {
      var v = sessionStorage.getItem(KEY);
      if (C.isUuid(v)) return v;
      var id = uuid4(); sessionStorage.setItem(KEY, id); return id;
    } catch (e) { memId = memId || uuid4(); return memId; }
  }
  function dropRequestId() {
    memId = null;
    try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing stored */ }
  }

  /* ── Messages ───────────────────────────────────────────── */
  var MESSAGES = {
    not_active_coordinator: "Your coordinator account isn't active, so you can't add Local Taskers.",
    coordinator_cap: 'You already have the most active Local Taskers your plan allows, so no one more can be added. A place is freed when an assignment ends.',
    consent_required: 'Choose how they agreed and tick the confirmation.',
    request_mismatch: 'This form was already used for a different Local Tasker. Nothing was changed. Please press Create again.',
    identity_in_use: 'This form was already used for a different Local Tasker. Nothing was changed. Please press Create again.',
    identity_not_locked: "The system couldn't set up a safe account for this person, so nothing was created. Please tell StreetTasker support and quote the error code.",
    identity_failed: "The system couldn't create the account for this person. Nothing was created. Please try again in a moment.",
    unauthenticated: 'Your sign-in has expired. Please sign in again, then come back to this form.',
    too_large: 'That was too much text to send. Shorten the notes and try again.',
    server_error: 'Something went wrong on our side. Nothing was created. Please try again in a moment.',
    network: "We couldn't reach the server. Check your connection and press Create again. It will not create a duplicate."
  };

  function showError(code, serverMessage, rawCode) {
    var text = MESSAGES[code];
    if (!text) text = (code === 'bad_input' && serverMessage) ? serverMessage : 'Something went wrong and nothing was created. Please try again, and quote the error code if it keeps happening.';
    $('coFormErrorText').textContent = text;
    $('coFormErrorCode').textContent = 'Error code: ' + code + (rawCode ? ' (' + rawCode + ')' : '');
    var box = $('coFormError'); box.hidden = false; box.focus();
    if (code === 'request_mismatch' || code === 'identity_in_use') dropRequestId();
  }
  function clearError() { $('coFormError').hidden = true; }

  function fieldError(id, msg) {
    var err = $(id + 'Err'), input = $(id);
    if (!err) return;
    err.textContent = msg || '';
    err.hidden = !msg;
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* ── Validation (the function re-checks everything) ─────── */
  function parseSkills(raw) {
    return String(raw || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function read() {
    return {
      publicName: $('coFPublicName').value.trim(),
      fullName: $('coFFullName').value.trim(),
      phone: $('coFPhone').value.trim(),
      skills: parseSkills($('coFSkills').value),
      areas: $('coFAreas').value.trim(),
      notes: $('coFNotes').value.trim(),
      method: $('coFMethod').value,
      evidence: $('coFEvidence').value.trim(),
      details: $('coFDetails').value.trim(),
      confirmed: $('coFConfirm').checked
    };
  }
  /* Returns the id of the first invalid field, or null. Shows every message. */
  function validate(v) {
    var first = null;
    function bad(id, msg) { fieldError(id, msg); if (!first) first = id; }
    function ok(id) { fieldError(id, ''); }

    (v.publicName.length < LIMITS.publicName[0]) ? bad('coFPublicName', 'Enter the public name (at least 2 letters).') : ok('coFPublicName');
    (v.fullName.length < LIMITS.fullName[0]) ? bad('coFFullName', 'Enter their full name (at least 2 letters).') : ok('coFFullName');
    PHONE_RE.test(v.phone) ? ok('coFPhone') : bad('coFPhone', 'Enter a valid phone number, for example +234 801 234 5678.');

    if (v.skills.length > LIMITS.skills) bad('coFSkills', 'Up to 20 skills, please.');
    else if (v.skills.some(function (s) { return s.length > LIMITS.skill; })) bad('coFSkills', 'Each skill must be 60 characters or fewer.');
    else ok('coFSkills');

    v.areas.length > LIMITS.areas ? bad('coFAreas', 'Keep the areas under 300 characters.') : ok('coFAreas');
    v.notes.length > LIMITS.notes ? bad('coFNotes', 'Keep the notes under 500 characters.') : ok('coFNotes');
    v.method ? ok('coFMethod') : bad('coFMethod', 'Choose how they agreed.');
    v.evidence.length > LIMITS.evidence ? bad('coFEvidence', 'Keep the reference under 500 characters.') : ok('coFEvidence');
    v.details.length > LIMITS.details ? bad('coFDetails', 'Keep the notes under 1000 characters.') : ok('coFDetails');
    v.confirmed ? ok('coFConfirm') : bad('coFConfirm', 'Tick the box to confirm they agreed.');
    return first;
  }

  /* ── Calling the function ───────────────────────────────── */
  async function failureFrom(error) {
    /* supabase-js: FunctionsHttpError carries the Response in error.context. */
    var ctx = error && error.context;
    if (ctx && typeof ctx.json === 'function') {
      var body = null;
      try { body = await ctx.json(); } catch (e) { body = null; }
      var status = ctx.status;
      var code = (body && (body.error || body.code)) || (status ? 'http_' + status : 'server_error');
      var raw = null;
      if (status === 401 && !MESSAGES[code]) { raw = code; code = 'unauthenticated'; }   /* gateway rejection: keep its own code visible */
      return { code: code, message: body && body.message, raw: raw };
    }
    return { code: 'network' };
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || atCap) return;
    clearError();
    var v = read();
    var firstBad = validate(v);
    if (firstBad) { var f = $(firstBad); if (f) f.focus(); return; }

    busy = true;
    var btn = $('coFSubmit'); var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      var res = await window.supabase.functions.invoke('local-tasker-create', {
        body: {
          request_id: requestId(),
          public_name: v.publicName,
          full_name: v.fullName,
          phone: v.phone,
          areas_served: v.areas,
          skills: v.skills,
          availability_notes: v.notes,
          consent: { confirmed: true, method: v.method, evidence_ref: v.evidence, details: v.details }
        }
      });
      if (res.error) {
        var fail = await failureFrom(res.error);
        showError(fail.code, fail.message, fail.raw);
        return;
      }
      var d = res.data;
      if (!d || d.ok !== true || !C.isUuid(d.tasker_user_id)) {
        showError('bad_response');
        return;
      }
      dropRequestId();
      leaving = true;
      window.location.href = 'coordinator-tasker.html?id=' + encodeURIComponent(d.tasker_user_id) + '&created=' + (d.created ? '1' : '0');
      return;
    } catch (err) {
      console.error('[coordinator add tasker]', err);
      showError('network');
    } finally {
      busy = false;
      if (!leaving && !atCap) { btn.disabled = false; btn.textContent = label; }
    }
  }

  /* ── Places left (display only: the database trigger is the authority) ── */
  async function checkCap(detail) {
    $('coFormCap').hidden = true; $('coFormCheckError').hidden = true;
    try {
      var plan = await C.plan();     /* Stage 7G: capacity and active count come from the coordinator's plan */
      if (!plan) throw new Error('plan unavailable');
      if (plan.places_left <= 0) {
        atCap = true;
        var note = $('coFormCap').querySelector('span');
        if (note) note.textContent = 'You already have the maximum of ' + plan.capacity + ' active Local Taskers for your plan, so you can\u2019t add another. A place is freed when an assignment ends.';
        $('coFormCap').hidden = false;
        $('coFSubmit').disabled = true;
      }
    } catch (e) {
      console.error('[coordinator add tasker cap]', e);
      $('coFormCheckError').hidden = false;
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; requestId(); checkCap(last); });
  document.addEventListener('DOMContentLoaded', function () {
    var form = $('coForm');
    if (form) form.addEventListener('submit', submit);
  });
})();

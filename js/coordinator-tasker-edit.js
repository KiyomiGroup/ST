/* ============================================================
   StreetTasker — coordinator-tasker-edit.js (Stage 4A-3)
   Edit form for ONE Local Tasker: coordinator-tasker-edit.html?id=<tasker user id>.
   The browser never writes tables. It calls the database function
   `update_local_tasker_profile`, which decides (from the signed-in user, never from
   anything sent here) whether this coordinator currently manages this person, then
   updates the profile, writes the audit row and returns the names of the changed fields.
   Status, assignment, agreement and verification cannot be changed from here.
   Every failure shows its error code on screen.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }

  var PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
  var LIMITS = { publicName: [2, 80], fullName: [2, 120], areas: 300, notes: 500, skills: 20, skill: 60 };
  var last = null, busy = false, leaving = false, taskerId = null, mounted = false;

  var MESSAGES = {
    not_found: "This Local Tasker isn't assigned to you any more, or your coordinator account isn't active. Nothing was changed.",
    unauthenticated: 'Your sign-in has expired. Please sign in again, then come back to this form.',
    network: "We couldn't reach the server. Check your connection and press Save again.",
    server_error: 'Something went wrong on our side. Nothing was changed. Please try again in a moment.'
  };

  function showError(code, serverMessage, raw) {
    var text = MESSAGES[code];
    if (!text) text = (code === 'bad_input' && serverMessage) ? serverMessage : 'Something went wrong and nothing was changed. Please try again, and quote the error code if it keeps happening.';
    $('coFormErrorText').textContent = text;
    $('coFormErrorCode').textContent = 'Error code: ' + code + (raw ? ' (' + raw + ')' : '');
    var box = $('coFormError'); box.hidden = false; box.focus();
  }
  function clearError() { $('coFormError').hidden = true; }

  function fieldError(id, msg) {
    var err = $(id + 'Err'), input = $(id);
    if (!err) return;
    err.textContent = msg || '';
    err.hidden = !msg;
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function parseSkills(raw) { return String(raw || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function read() {
    return {
      publicName: $('coFPublicName').value.trim(),
      fullName: $('coFFullName').value.trim(),
      phone: $('coFPhone').value.trim(),
      skills: parseSkills($('coFSkills').value),
      areas: $('coFAreas').value.trim(),
      notes: $('coFNotes').value.trim()
    };
  }
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
    return first;
  }

  /* Live preview and completeness: display only, built from what is typed. Nothing here is sent. */
  var CHECKS = [
    ['publicName', function (v) { return v.publicName.length >= LIMITS.publicName[0]; }],
    ['fullName', function (v) { return v.fullName.length >= LIMITS.fullName[0]; }],
    ['phone', function (v) { return PHONE_RE.test(v.phone); }],
    ['skills', function (v) { return v.skills.length > 0; }],
    ['areas', function (v) { return v.areas.length > 0; }],
    ['notes', function (v) { return v.notes.length > 0; }]
  ];
  function refresh() {
    var v = read();
    $('coPvName').textContent = v.publicName || 'Public name';
    $('coPvAvatar').textContent = C.initialsOf(v.publicName || 'Local Tasker');
    $('coPvAreaText').textContent = v.areas || 'Area not set';
    $('coPvNotes').textContent = v.notes;
    $('coPvNotes').hidden = !v.notes;
    var list = $('coPvSkills'); list.textContent = '';
    v.skills.slice(0, 20).forEach(function (sk) { list.appendChild(C.el('li', 'co-chip', sk)); });
    list.hidden = !v.skills.length;
    var done = 0;
    CHECKS.forEach(function (c) {
      var ok = c[1](v); if (ok) done++;
      var li = document.querySelector('[data-check="' + c[0] + '"]'); if (li) li.classList.toggle('is-done', ok);
    });
    var pct = Math.round(done * 100 / CHECKS.length);
    $('coCompletePct').textContent = pct + '%';
    $('coCompleteFill').style.width = pct + '%';
    $('coCompleteNote').textContent = done === CHECKS.length
      ? 'Everything is filled in.'
      : (CHECKS.length - done) + ' of ' + CHECKS.length + ' still to fill in. A full profile helps customers trust it.';
  }

  function show(which) {
    ['coEditLoading', 'coEditLoadError', 'coEditMissing', 'coEditLayout'].forEach(function (id) {
      var n = $(id); if (n) n.hidden = (id !== which);
    });
    $('coHeroActions').hidden = (which !== 'coEditLayout');
  }

  function profileUrl(extra) {
    return 'coordinator-tasker.html?id=' + encodeURIComponent(taskerId) + (extra || '');
  }

  async function load() {
    taskerId = new URLSearchParams(window.location.search).get('id');
    if (!C.isUuid(taskerId)) { show('coEditMissing'); return; }
    $('coBackLink').href = profileUrl(); $('coCancel').href = profileUrl(); $('coCancelTop').href = profileUrl();
    show('coEditLoading'); $('coPublicNameNote').hidden = true;
    try {
      var res = await window.supabase.from('local_tasker_profiles')
        .select('tasker_user_id, full_name, phone, areas_served, skills, availability_notes')
        .eq('tasker_user_id', taskerId).maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { show('coEditMissing'); return; }
      var p = res.data;
      $('coFFullName').value = p.full_name || '';
      $('coFPhone').value = p.phone || '';
      $('coFAreas').value = p.areas_served || '';
      $('coFNotes').value = p.availability_notes || '';
      $('coFSkills').value = Array.isArray(p.skills) ? p.skills.join(', ') : '';
      /* The public name lives on the public user row. If it can't be read, the box stays
         empty and a note says so; the coordinator then types the name to keep. */
      var pub = '';
      try {
        var u = await window.supabase.from('users').select('name').eq('id', taskerId).maybeSingle();
        if (!u.error && u.data && u.data.name) pub = u.data.name;
      } catch (e) { pub = ''; }
      $('coFPublicName').value = pub;
      if (!pub) $('coPublicNameNote').hidden = false;
      show('coEditLayout');
      refresh();
      $('coProxyName').textContent = p.full_name || 'this Local Tasker';
      if (window.STIntake && !mounted) { mounted = true; window.STIntake.mount($('ikRoot'), taskerId, {}); }
    } catch (e) {
      console.error('[coordinator edit tasker]', e);
      show('coEditLoadError');
    }
  }

  async function failureFrom(error) {
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
      var res = await window.supabase.rpc('update_local_tasker_profile', {
        p_tasker: taskerId,
        p_public_name: v.publicName,
        p_full_name: v.fullName,
        p_phone: v.phone,
        p_areas_served: v.areas,
        p_skills: v.skills,
        p_availability_notes: v.notes
      });
      if (res.error) {
        var fail = await failureFrom(res.error);
        showError(fail.code, fail.message, fail.raw);
        return;
      }
      var changed = res.data && Array.isArray(res.data.changed) ? res.data.changed : null;
      if (!changed) { showError('bad_response'); return; }
      leaving = true;
      window.location.href = profileUrl('&updated=' + (changed.length ? '1' : '0'));
    } catch (err) {
      console.error('[coordinator edit tasker save]', err);
      showError('network');
    } finally {
      busy = false;
      if (!leaving) { btns.forEach(function (b) { b.disabled = false; b.textContent = label; }); }
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    var form = $('coForm'); if (form) { form.addEventListener('submit', submit); form.addEventListener('input', refresh); }
    if (window.STIntake) window.STIntake.mountInfo($('ikInfoBtn'));
    var retry = $('coEditRetry'); if (retry) retry.addEventListener('click', function () { if (last) load(); });
  });
})();

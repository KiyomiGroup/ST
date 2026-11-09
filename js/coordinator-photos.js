/* ============================================================
   StreetTasker — coordinator-photos.js (Stage 4B-2)
   Portfolio photos of ONE Local Tasker: coordinator-photos.html?id=<tasker user id>
   - The browser uploads the file to the PRIVATE bucket `local-tasker-photos` under
     <tasker id>/<new id>.jpg. Storage policy allows this only for an active coordinator who
     currently manages that person. Photos are shrunk to 1600px and re-saved as JPEG in the
     browser (keeps them under 5 MB and drops phone location data).
   - It then calls `add_local_tasker_photo`, which re-checks authority from the sign-in, checks
     the file really exists, records the "photos" agreement the first time, and audits.
   - Caption, cover and removal go through `update_local_tasker_photo` / `remove_local_tasker_photo`.
     Removal only marks the photo removed; nothing is deleted.
   - Pictures are shown through short-lived signed links. Nothing is shown to customers (Stage 4C).
   Every failure shows its error code on screen. All text uses textContent.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  function $(id) { return document.getElementById(id); }

  var BUCKET = 'local-tasker-photos';
  var MAX_PHOTOS = 8, MAX_CAPTION = 120, MAX_INPUT_BYTES = 25 * 1024 * 1024, MAX_BYTES = 5 * 1024 * 1024, MAX_SIDE = 1600;
  var TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  var last = null, busy = false;
  var taskerId = null, photos = [], avatar = null, needConsent = true, consentKnown = true;
  var prepared = null;          /* { blob, path, key }: the chosen file, already shrunk, with its upload path */
  var previewUrl = null, picking = 0;

  var MESSAGES = {
    not_found: "This Local Tasker isn't assigned to you any more, or your coordinator account isn't active. Nothing was changed.",
    consent_required: 'Choose how they agreed and tick the confirmation.',
    photo_limit: 'A Local Tasker can have at most 8 photos. Remove one first.',
    upload_missing: "The picture didn't finish uploading. Please choose it and try again.",
    upload_not_allowed: "You aren't allowed to upload for this person. Check that they are still assigned to you. Nothing was saved.",
    upload_failed: "The picture couldn't be uploaded. Nothing was saved. Please try again in a moment.",
    unauthenticated: 'Your sign-in has expired. Please sign in again, then come back to this page.',
    network: "We couldn't reach the server. Please check your connection and try again.",
    server_error: 'Something went wrong on our side. Please try again in a moment.',
    file_type: 'Choose a JPEG, PNG or WebP picture.',
    file_size: 'That picture is too large. Choose one under 25 MB.',
    image_unreadable: "That file couldn't be read as a picture. Choose another one."
  };

  /* ---------- messages ---------- */
  function clearMessages() { $('coPhotoNotice').hidden = true; $('coPhotoError').hidden = true; }
  function notice(text) {
    $('coPhotoError').hidden = true;
    $('coPhotoNoticeText').textContent = text;
    var n = $('coPhotoNotice'); n.hidden = false; n.focus();
  }
  function showError(code, serverMessage, raw) {
    $('coPhotoNotice').hidden = true;
    var text = MESSAGES[code];
    if (!text) text = (code === 'bad_input' && serverMessage) ? serverMessage : 'Something went wrong and nothing was saved. Please try again, and quote the error code if it keeps happening.';
    $('coPhotoErrorText').textContent = text;
    $('coPhotoErrorCode').textContent = 'Error code: ' + code + (raw ? ' (' + raw + ')' : '');
    var b = $('coPhotoError'); b.hidden = false; b.focus();
  }
  function fieldError(id, msg) {
    var err = $(id + 'Err'), input = $(id);
    if (!err) return;
    err.textContent = msg || ''; err.hidden = !msg;
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function failureFrom(error) {
    var hint = error && error.hint, code = error && error.code;
    if (hint) return { code: hint, message: error.message };
    if (code === '42501') return { code: 'unauthenticated', raw: code };
    if (error && (error.status === 401 || error.status === 403)) return { code: 'unauthenticated', raw: String(error.status) };
    if (code || (error && error.message && !/fetch|network/i.test(error.message))) return { code: 'server_error', raw: code || null };
    return { code: 'network' };
  }
  function storageFailure(err) {
    var sc = String((err && (err.statusCode || err.status)) || ''), msg = (err && err.message) || '';
    if (sc === '409' || /already exists|duplicate/i.test(msg)) return 'exists';
    if (sc === '401' || sc === '403' || /row-level security|unauthori[sz]ed|not allowed/i.test(msg)) return 'upload_not_allowed';
    if (/failed to fetch|network/i.test(msg)) return 'network';
    return 'upload_failed';
  }

  function show(which) {
    ['coEditLoading', 'coEditLoadError', 'coEditMissing', 'coEditLayout'].forEach(function (id) {
      var n = $(id); if (n) n.hidden = (id !== which);
    });
  }
  function profileUrl() { return 'coordinator-tasker.html?id=' + encodeURIComponent(taskerId); }

  /* ---------- picture preparation ---------- */
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var b = new Uint8Array(16); window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function decode(file) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return decodeWithImage(file); });
    }
    return decodeWithImage(file);
  }
  function decodeWithImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  async function prepare(file) {
    if (TYPES.indexOf(file.type) < 0) throw { code: 'file_type' };
    if (file.size > MAX_INPUT_BYTES) throw { code: 'file_size' };
    var img;
    try { img = await decode(file); } catch (e) { throw { code: 'image_unreadable' }; }
    var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    if (!w || !h) throw { code: 'image_unreadable' };
    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw { code: 'image_unreadable' };
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, cw, ch);       /* transparent PNGs get a white background */
    ctx.drawImage(img, 0, 0, cw, ch);
    if (img.close) img.close();
    var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', 0.85); });
    if (!blob) throw { code: 'image_unreadable' };
    if (blob.size > MAX_BYTES) throw { code: 'file_size' };
    return blob;
  }
  function clearPreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    $('coPPreviewBox').hidden = true; $('coPPreview').removeAttribute('src');
  }
  async function onPick() {
    var input = $('coPFile'), file = input.files && input.files[0];
    var ticket = ++picking;
    prepared = null; clearPreview(); fieldError('coPFile', '');
    if (!file) return;
    try {
      var blob = await prepare(file);
      if (ticket !== picking) return;
      prepared = { blob: blob, path: taskerId + '/' + newId() + '.jpg' };
      previewUrl = URL.createObjectURL(blob);
      $('coPPreview').src = previewUrl; $('coPPreviewBox').hidden = false;
    } catch (e) {
      if (ticket !== picking) return;
      var code = (e && e.code) || 'image_unreadable';
      fieldError('coPFile', MESSAGES[code] || MESSAGES.image_unreadable);
      input.value = '';
    }
  }

  /* ---------- list ---------- */
  function sortPhotos(rows) {
    return rows.slice().sort(function (a, b) {
      if (!!a.is_cover !== !!b.is_cover) return a.is_cover ? -1 : 1;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }
  async function signedUrls(rows) {
    var map = {};
    if (!rows.length) return { map: map, ok: true };
    try {
      var res = await window.supabase.storage.from(BUCKET).createSignedUrls(rows.map(function (r) { return r.storage_path; }), 3600);
      if (res.error) throw res.error;
      (res.data || []).forEach(function (d) { if (d && d.signedUrl && !d.error) map[d.path] = d.signedUrl; });
      return { map: map, ok: rows.every(function (r) { return !!map[r.storage_path]; }) };
    } catch (e) {
      console.error('[coordinator photos signed urls]', e);
      return { map: map, ok: false };
    }
  }

  function button(label, cls, handler) {
    var b = C.el('button', 'btn ' + cls + ' btn-sm', label); b.type = 'button'; b.addEventListener('click', handler); return b;
  }

  function photoItem(p, url, idx) {
    var li = C.el('li', 'co-photo-item');
    li.setAttribute('data-photo-id', p.id);
    var frame = C.el('div', 'co-photo-frame');
    if (url) {
      var img = C.el('img'); img.src = url; img.alt = p.caption || ('Photo ' + (idx + 1)); img.loading = 'lazy';
      frame.appendChild(img);
    } else {
      frame.appendChild(C.el('span', 'co-photo-missing', 'Picture unavailable'));
    }
    if (p.is_cover) frame.appendChild(C.el('span', 'co-status co-status--published co-photo-cover', 'Cover'));
    li.appendChild(frame);

    var lab = C.el('label', 'form-label', 'Caption'); lab.setAttribute('for', 'coCap' + idx);
    var cap = C.el('input', 'form-input'); cap.type = 'text'; cap.id = 'coCap' + idx; cap.maxLength = MAX_CAPTION; cap.value = p.caption || ''; cap.autocomplete = 'off';
    var err = C.el('p', 'co-field-error'); err.id = 'coCap' + idx + 'Err'; err.hidden = true; cap.setAttribute('aria-describedby', err.id);
    li.appendChild(lab); li.appendChild(cap); li.appendChild(err);

    var actions = C.el('div', 'co-photo-actions');
    actions.appendChild(button('Save caption', 'btn-outline', function () {
      if (cap.value.trim().length > MAX_CAPTION) { err.textContent = 'Keep the caption under 120 characters.'; err.hidden = false; cap.focus(); return; }
      err.hidden = true; update(p.id, cap.value, false);
    }));
    if (!p.is_cover) actions.appendChild(button('Make cover', 'btn-outline', function () { update(p.id, cap.value, true); }));
    var confirm = C.el('div', 'co-photo-confirm'); confirm.hidden = true;
    confirm.appendChild(C.el('p', 'co-card-lead', 'Remove this photo from the profile? It is hidden, not erased.'));
    var cActions = C.el('div', 'co-photo-actions');
    var yes = button('Yes, remove', 'btn-primary', function () { remove(p.id); });
    var no = button('Keep it', 'btn-ghost', function () { confirm.hidden = true; rm.hidden = false; rm.focus(); });
    cActions.appendChild(yes); cActions.appendChild(no); confirm.appendChild(cActions);
    var rm = button('Remove', 'btn-ghost', function () { confirm.hidden = false; rm.hidden = true; yes.focus(); });
    actions.appendChild(rm);
    li.appendChild(actions); li.appendChild(confirm);
    return li;
  }

  function setBusy(on) {
    busy = on;
    var scope = document.querySelectorAll('#coPhotoGrid button, #coFSubmit');
    Array.prototype.forEach.call(scope, function (b) { b.disabled = on; });
  }

  async function renderList() {
    var grid = $('coPhotoGrid');
    grid.textContent = '';
    $('coPhotosLinkError').hidden = true;
    var rows = sortPhotos(photos);
    $('coPhotosEmpty').hidden = rows.length > 0;
    grid.hidden = rows.length === 0;
    await renderAvatar();
    applyKind();
    if (!rows.length) return;
    var s = await signedUrls(rows);
    rows.forEach(function (p, i) { grid.appendChild(photoItem(p, s.map[p.storage_path], i)); });
    $('coPhotosLinkError').hidden = s.ok;
  }

  async function fetchPhotos() {
    var res = await window.supabase.from('local_tasker_photos')
      .select('id, storage_path, caption, is_cover, created_at, kind')
      .eq('tasker_user_id', taskerId).is('removed_at', null)
      .order('is_cover', { ascending: false }).order('created_at', { ascending: true });
    if (res.error) throw res.error;
    var all = res.data || [];
    photos = all.filter(function (r) { return r.kind !== 'avatar'; });       /* the portfolio: the avatar has its own card */
    avatar = all.filter(function (r) { return r.kind === 'avatar'; })[0] || null;
  }
  function kind() { var k = $('coPKind'); return k && k.value === 'avatar' ? 'avatar' : 'portfolio'; }
  /* The form shows only what the chosen kind needs. A full portfolio (8) never blocks a profile picture. */
  function applyKind() {
    var isAv = kind() === 'avatar', full = photos.length >= MAX_PHOTOS && !isAv;
    $('coPCaptionGroup').hidden = isAv;
    $('coPCoverGroup').hidden = isAv || photos.length === 0;
    $('coAddFull').hidden = !full; $('coAddFields').hidden = full;
    $('coAgreeCard').hidden = full; $('coFormActions').hidden = full;
  }
  async function renderAvatar() {
    var box = $('coAvatarBox'); box.textContent = '';
    $('coAvatarEmpty').hidden = !!avatar; box.hidden = !avatar;
    if (!avatar) return;
    var s = await signedUrls([avatar]);
    var li = C.el('li', 'co-photo-item'), frame = C.el('div', 'co-photo-frame');
    if (s.map[avatar.storage_path]) { var img = C.el('img'); img.src = s.map[avatar.storage_path]; img.alt = 'Profile picture'; img.loading = 'lazy'; frame.appendChild(img); }
    else frame.appendChild(C.el('span', 'co-photo-missing', 'Picture unavailable'));
    li.appendChild(frame); box.appendChild(li);
  }
  async function fetchConsent() {
    needConsent = true; consentKnown = true;
    try {
      var cs = await window.supabase.from('local_tasker_consents').select('id')
        .eq('tasker_user_id', taskerId).eq('purpose', 'photos').is('revoked_at', null);
      if (cs.error) throw cs.error;
      needConsent = !(cs.data && cs.data.length);
    } catch (e) { consentKnown = false; needConsent = true; }
    $('coAgreeFields').hidden = !needConsent; $('coAgreeDone').hidden = needConsent;
  }

  async function load() {
    var qs = new URLSearchParams(window.location.search);
    taskerId = qs.get('id');
    if (!C.isUuid(taskerId)) { show('coEditMissing'); return; }
    $('coBackLink').href = profileUrl(); $('coCancel').href = profileUrl();
    show('coEditLoading');
    try {
      var res = await window.supabase.from('local_tasker_profiles')
        .select('tasker_user_id, full_name').eq('tasker_user_id', taskerId).maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { show('coEditMissing'); return; }
      $('coProxyName').textContent = res.data.full_name || 'this Local Tasker';
      $('coBackText').textContent = res.data.full_name || 'Back to profile';
      await fetchPhotos();
      await fetchConsent();
      show('coEditLayout');
      await renderList();
    } catch (e) {
      console.error('[coordinator photos load]', e);
      show('coEditLoadError');
    }
  }

  async function refresh() {
    try { await fetchPhotos(); await renderList(); }
    catch (e) { console.error('[coordinator photos refresh]', e); showError('network'); }
  }

  /* ---------- actions ---------- */
  async function update(photoId, caption, makeCover) {
    if (busy) return;
    clearMessages(); setBusy(true);
    try {
      var res = await window.supabase.rpc('update_local_tasker_photo', {
        p_tasker: taskerId, p_photo: photoId, p_caption: caption, p_make_cover: !!makeCover
      });
      if (res.error) { var f = failureFrom(res.error); showError(f.code, f.message, f.raw); return; }
      var d = res.data;
      if (!d || !Array.isArray(d.changed)) { showError('bad_response'); return; }
      await refresh();
      notice(d.changed.length ? (makeCover ? 'Cover photo changed.' : 'Photo saved.') : 'Nothing was changed, so nothing was saved.');
    } catch (e) {
      console.error('[coordinator photo update]', e); showError('network');
    } finally { setBusy(false); }
  }

  async function remove(photoId) {
    if (busy) return;
    clearMessages(); setBusy(true);
    try {
      var res = await window.supabase.rpc('remove_local_tasker_photo', { p_tasker: taskerId, p_photo: photoId });
      if (res.error) { var f = failureFrom(res.error); showError(f.code, f.message, f.raw); return; }
      var d = res.data;
      if (!d || d.removed !== true) { showError('bad_response'); return; }
      await refresh();
      notice('Photo removed.');
    } catch (e) {
      console.error('[coordinator photo remove]', e); showError('network');
    } finally { setBusy(false); }
  }

  function readForm() {
    return {
      caption: $('coPCaption').value.trim(), cover: $('coPCover').checked,
      method: $('coFMethod').value, evidence: $('coFEvidence').value.trim(),
      details: $('coFDetails').value.trim(), confirmed: $('coFConfirm').checked
    };
  }
  function validate(v) {
    var first = null;
    function bad(id, msg) { fieldError(id, msg); if (!first) first = id; }
    function ok(id) { fieldError(id, ''); }
    prepared ? ok('coPFile') : bad('coPFile', 'Choose a photo first.');
    if (kind() === 'portfolio') { if (v.caption.length > MAX_CAPTION) bad('coPCaption', 'Keep the caption under 120 characters.'); else ok('coPCaption'); }
    if (needConsent && consentKnown) {
      v.method ? ok('coFMethod') : bad('coFMethod', 'Choose how they agreed.');
      v.confirmed ? ok('coFConfirm') : bad('coFConfirm', 'Tick the box to confirm they agreed.');
    }
    v.evidence.length > 500 ? bad('coFEvidence', 'Keep the reference under 500 characters.') : ok('coFEvidence');
    v.details.length > 1000 ? bad('coFDetails', 'Keep the notes under 1000 characters.') : ok('coFDetails');
    return first;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    clearMessages();
    var v = readForm();
    var firstBad = validate(v);
    if (firstBad) { var f = $(firstBad); if (f) f.focus(); return; }

    setBusy(true);
    var btn = $('coFSubmit'), label = btn.textContent; btn.textContent = 'Uploading…';
    try {
      /* 1. the file. A retry reuses the same path, so "already exists" means the earlier try got through. */
      var up = await window.supabase.storage.from(BUCKET).upload(prepared.path, prepared.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      if (up && up.error) {
        var sf = storageFailure(up.error);
        if (sf !== 'exists') { showError(sf, null, up.error.statusCode ? String(up.error.statusCode) : null); return; }
      }
      /* 2. register it. Safe to repeat for the same path. */
      var isAvatar = kind() === 'avatar';
      var consentArgs = {
        p_consent_method: needConsent ? v.method : null,
        p_consent_evidence: needConsent ? v.evidence : null,
        p_consent_details: needConsent ? v.details : null
      };
      var res = isAvatar
        ? await window.supabase.rpc('add_local_tasker_avatar', Object.assign({ p_tasker: taskerId, p_path: prepared.path }, consentArgs))
        : await window.supabase.rpc('add_local_tasker_photo', Object.assign({ p_tasker: taskerId, p_path: prepared.path, p_caption: v.caption, p_make_cover: !!v.cover }, consentArgs));
      if (res.error) { var fail = failureFrom(res.error); showError(fail.code, fail.message, fail.raw); return; }
      var d = res.data;
      if (!d || !C.isUuid(d.photo_id) || (!isAvatar && typeof d.is_cover !== 'boolean')) { showError('bad_response'); return; }

      prepared = null; picking++; clearPreview();
      $('coPFile').value = ''; $('coPCaption').value = ''; $('coPCover').checked = false;
      if (needConsent) { $('coFMethod').value = ''; $('coFEvidence').value = ''; $('coFDetails').value = ''; $('coFConfirm').checked = false; }
      await fetchConsent();
      await refresh();
      notice(d.created === false ? 'That photo was already added, so nothing new was saved.' : isAvatar ? 'Profile picture saved. It replaces the old one.' : (d.is_cover ? 'Photo added. It is the cover photo.' : 'Photo added.'));
    } catch (err) {
      console.error('[coordinator photo add]', err);
      showError('network');
    } finally {
      btn.textContent = label; setBusy(false);
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    var form = $('coForm'); if (form) form.addEventListener('submit', submit);
    var file = $('coPFile'); if (file) file.addEventListener('change', onPick);
    var kd = $('coPKind'); if (kd) kd.addEventListener('change', applyKind);
    if (kd && new URLSearchParams(window.location.search).get('kind') === 'avatar') kd.value = 'avatar';   /* from the publish checklist */
    var retry = $('coEditRetry'); if (retry) retry.addEventListener('click', function () { if (last) load(); });
  });
})();

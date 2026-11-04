/* ============================================================
   StreetTasker — coordinator-attach.js (Stage 6D-3)
   Lets the coordinator send a photo, a camera photo, a video, a file or a location in the coordinator chat (coordinator-chat.html),
   and draws those messages (from the customer or from the coordinator) inside the conversation.
   How a send works (same order as the Job Room): check -> (photos: re-encode, which removes GPS/EXIF) -> upload to the PRIVATE bucket
   `job-evidence` under <thread_id>/ -> database function coordinator_send_attachment (writes the evidence row and the message).
   Locations go through coordinator_send_location. The database function checks who you are and the real file rules again.
   Everything from the database is put on the page with textContent / properties, never innerHTML (only fixed icon markup below).
   Public API (window.STCoAttach): has(), clear(), send(caption), sync(), isMedia(message), mediaFor(message), sig()
   Needs window.STCoChat (set by coordinator-chat.js).
   ============================================================ */
'use strict';

(function () {
  var MB = 1048576;
  var LIMITS = { photo: 10 * MB, video: 50 * MB, file: 10 * MB };
  var FILE_MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', csv: 'text/csv' };
  var VIDEO_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
  var PHOTO_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/i;
  var BUCKET = 'job-evidence';
  var A = null;            /* the attachment being prepared: { kind, blob, name, mime, size, previewUrl, requestId, path, uploaded, lat, lng, busy } */
  var signed = {};         /* path -> { p: Promise<url>, exp } (page memory only) */

  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function sb() { return window.supabase; }
  function chat() { return window.STCoChat; }
  function svg(inner) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; }
  var ICON_IMAGE = svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>');
  var ICON_FILE = svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>');
  var ICON_PIN = svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>');
  var ICON_CLOSE = svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
  var ICON_PLAY = svg('<polygon points="5 3 19 12 5 21 5 3"/>');

  function extOf(name) { var m = /\.([a-z0-9]{1,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function fileSize(n) { return !n ? '' : n >= MB ? (n / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function safeName(name, mime) {
    var base = String(name || 'file').replace(/\.[^.]*$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'file';
    return base + '.' + (mime === 'image/jpeg' ? 'jpg' : (extOf(name) || 'bin'));
  }

  /* What is this file? -> { kind, mime, reencode } or { error } (same rules as the Job Room) */
  function classify(file) {
    var type = String(file.type || '').toLowerCase(), ext = extOf(file.name), out;
    if (/^image\//.test(type) || /^(jpe?g|png|webp|heic|heif)$/.test(ext)) {
      if (/svg/.test(type) || ext === 'svg') return { error: 'SVG images are not allowed. Use a JPEG, PNG or WebP photo.' };
      if (type && !PHOTO_TYPES.test(type)) return { error: 'Use a JPEG, PNG or WebP photo.' };
      out = { kind: 'photo', mime: 'image/jpeg', reencode: true };
    } else if (/^video\//.test(type) || VIDEO_MIME[ext]) {
      var vm = VIDEO_MIME[ext] || type;
      if (!/^video\/(mp4|webm|quicktime)$/.test(vm)) return { error: 'Use an MP4, WebM or MOV video.' };
      out = { kind: 'video', mime: vm, reencode: false };
    } else if (FILE_MIME[ext]) {
      out = { kind: 'file', mime: FILE_MIME[ext], reencode: false };
    } else {
      return { error: 'This file type is not allowed. Use a photo, video, PDF, Word, Excel, TXT or CSV file.' };
    }
    if (!out.reencode && file.size > LIMITS[out.kind]) return { error: 'This file is too large (max ' + Math.round(LIMITS[out.kind] / MB) + ' MB).' };
    return out;
  }

  /* Re-draw the photo on a canvas: removes EXIF/GPS and shrinks it (longest side 1600 px). */
  function reencodeImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      function done(fn, v) { try { URL.revokeObjectURL(url); } catch (e) { /* ok */ } fn(v); }
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) throw new Error('empty');
          var k = Math.min(1, 1600 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
          var c = document.createElement('canvas'); c.width = cw; c.height = ch;
          var ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch);
          c.toBlob(function (b) { if (b) done(resolve, b); else done(reject, new Error('This photo could not be prepared. Try another one.')); }, 'image/jpeg', 0.85);
        } catch (e) { done(reject, new Error('This photo could not be read. Try a JPEG or PNG.')); }
      };
      img.onerror = function () { done(reject, new Error('This photo could not be read. Try a JPEG or PNG.')); };
      img.src = url;
    });
  }

  /* ── preview chip ─────────────────────────────────────────── */
  function drop() { if (A && A.previewUrl) { try { URL.revokeObjectURL(A.previewUrl); } catch (e) { /* ok */ } } A = null; }
  function renderPreview() {
    var box = $('ccAttachPreview'); if (!box) return;
    box.textContent = '';
    if (!A) { box.hidden = true; chat().updateSend(); return; }
    var chip = el('div', 'jr-attach-chip'), thumb = el('div', 'jr-attach-thumb');
    if (A.previewUrl) { var im = el('img', 'jr-attach-img'); im.src = A.previewUrl; im.alt = ''; thumb.appendChild(im); }
    else thumb.innerHTML = A.kind === 'location' ? ICON_PIN : A.kind === 'file' ? ICON_FILE : ICON_IMAGE;
    var info = el('div', 'jr-attach-info');
    info.appendChild(el('div', 'jr-attach-name', A.name));
    info.appendChild(el('div', 'jr-attach-sub', [A.kind === 'location' ? 'Location' : A.kind === 'photo' ? 'Photo' : A.kind === 'video' ? 'Video' : 'File', fileSize(A.size)].filter(Boolean).join(' · ')));
    info.appendChild(el('div', 'jr-attach-note', A.busy ? 'Sending…' : A.kind === 'location'
      ? 'This shares the place where YOU are now, once, when you tap Send. Type a name for it below if you like.'
      : 'Ready to send to the customer. Type a caption below if you like.'));
    var rm = el('button', 'jr-icon-btn jr-attach-remove'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove attachment'); rm.innerHTML = ICON_CLOSE;
    rm.addEventListener('click', function () { if (!A || !A.busy) { drop(); renderPreview(); } });
    chip.appendChild(thumb); chip.appendChild(info); chip.appendChild(rm);
    box.appendChild(chip); box.hidden = false;
    chat().updateSend();
  }

  async function pick(file) {
    var c = classify(file);
    if (c.error) { chat().toast(c.error, true); return; }
    drop();
    A = { kind: c.kind, mime: c.mime, name: file.name || 'File', size: file.size, blob: null, previewUrl: '', requestId: newId(), path: '', uploaded: false, busy: false, src: file, reencode: c.reencode };
    if (c.reencode) {
      try { A.blob = await reencodeImage(file); } catch (e) { drop(); renderPreview(); chat().toast((e && e.message) || 'This photo could not be prepared.', true); return; }
      if (A.blob.size > LIMITS.photo) { drop(); renderPreview(); chat().toast('This file is too large (max 10 MB).', true); return; }
      A.size = A.blob.size; A.previewUrl = URL.createObjectURL(A.blob);
    } else { A.blob = file; }
    renderPreview();
  }

  function pickLocation() {
    if (!navigator.geolocation) { chat().toast('This device cannot share a location.', true); return; }
    chat().toast('Finding your location…', false);
    navigator.geolocation.getCurrentPosition(function (pos) {
      drop();
      A = { kind: 'location', name: 'Current location', size: 0, lat: pos.coords.latitude, lng: pos.coords.longitude, requestId: newId(), busy: false };
      renderPreview();
    }, function () { chat().toast('Your location could not be found. Allow location access and try again.', true); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  /* ── sending ─────────────────────────────────────────────── */
  async function threadId(S) {
    if (S.thread && S.thread.thread_id) return S.thread.thread_id;
    var r = await sb().rpc('open_local_thread', { p_booking: S.activeId });   /* creates the conversation once if it does not exist yet */
    if (r.error || !r.data || !r.data.thread_id) throw (r.error || new Error('no thread'));
    return r.data.thread_id;
  }
  function hintOf(e) { var h = e && (e.hint || (e.details && e.details.hint)); return h || (e && e.message && /not_found|read_only|bad_input|contact_info|bad_file/.exec(e.message) || [''])[0]; }

  async function send(caption) {
    var C = chat(), S = C.state(); if (!A || A.busy || !C.canWrite()) return false;
    caption = String(caption || '').trim();
    A.busy = true; renderPreview(); C.setSending(true);
    var failMsg = '', keep = false;
    try {
      var res;
      if (A.kind === 'location') {
        res = await sb().rpc('coordinator_send_location', { p_booking: S.activeId, p_request_id: A.requestId, p_lat: A.lat, p_lng: A.lng, p_label: caption || null });
      } else {
        if (!A.uploaded) {
          var tid = await threadId(S);
          A.path = tid + '/' + newId() + '-' + safeName(A.name, A.mime);
          var up = await sb().storage.from(BUCKET).upload(A.path, A.blob, { contentType: A.mime, upsert: false, cacheControl: '3600' });
          if (up.error) throw up.error;
          A.uploaded = true;       /* a retry after a failed database call must not upload again */
        }
        res = await sb().rpc('coordinator_send_attachment', { p_booking: S.activeId, p_request_id: A.requestId, p_kind: A.kind, p_path: A.path, p_name: safeName(A.name, A.mime), p_caption: caption || null });
      }
      if (res.error) throw res.error;
    } catch (e) {
      var h = hintOf(e);
      if (h === 'contact_info') { C.showContactWarn(); keep = true; }
      else if (h === 'not_found' || h === 'read_only') { drop(); failMsg = h === 'read_only' ? 'You can no longer reply to this booking.' : 'This conversation is no longer available to you.'; }
      else if (h === 'bad_file') { failMsg = (e && e.message) || 'This file could not be sent.'; drop(); }
      else if (h === 'bad_input') { failMsg = 'This could not be sent. Check the caption and try again.'; keep = true; }
      else { failMsg = 'Could not send. Check your connection and try again.'; keep = true; }
      if (A) A.busy = false;
      C.setSending(false); renderPreview();
      if (failMsg) C.toast(failMsg, true);
      if (!A || (h === 'not_found' || h === 'read_only')) await C.refreshAll(false);
      return false;
    }
    drop(); renderPreview(); C.setSending(false);
    await C.reloadThread(false); C.loadList(true);
    return true;
  }

  /* ── drawing messages ─────────────────────────────────────── */
  function signedUrl(path) {
    var c = signed[path];
    if (c && c.exp > Date.now()) return c.p;
    var p = sb().storage.from(BUCKET).createSignedUrl(path, 3600).then(function (r) {
      if (r.error || !r.data || !r.data.signedUrl) { delete signed[path]; return ''; }
      return r.data.signedUrl;
    }).catch(function () { delete signed[path]; return ''; });
    signed[path] = { p: p, exp: Date.now() + 50 * 60 * 1000 };
    return p;
  }
  function isMedia(m) { return !!m && (m.type === 'image' || m.type === 'video' || m.type === 'file' || m.type === 'location') && !!m.payload && typeof m.payload === 'object'; }

  function openLink(href, text) {
    var a = el('a', 'jr-loc-link', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function mediaFor(m) {
    var p = m.payload || {}, box;
    if (m.type === 'location') {
      var lat = Number(p.lat), lng = Number(p.lng);
      box = el('div', 'jr-loc'); var pin = el('div', 'jr-loc-pin'); pin.innerHTML = ICON_PIN;
      var info = el('div', 'jr-file-info'); info.appendChild(el('div', 'jr-file-name', p.label || 'Shared location'));
      info.appendChild(el('div', 'jr-file-sub', isFinite(lat) && isFinite(lng) ? lat.toFixed(5) + ', ' + lng.toFixed(5) : ''));
      box.appendChild(pin); box.appendChild(info);
      if (isFinite(lat) && isFinite(lng)) box.appendChild(openLink('https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng), 'Open in Maps'));
      return box;
    }
    var path = typeof p.path === 'string' ? p.path : '';
    if (m.type === 'file') {
      box = el('div', 'jr-file'); var ic = el('div', 'jr-file-icon'); ic.innerHTML = ICON_FILE;
      var fi = el('div', 'jr-file-info'); fi.appendChild(el('div', 'jr-file-name', p.name || 'Document'));
      fi.appendChild(el('div', 'jr-file-sub', fileSize(Number(p.size)) || 'File'));
      box.appendChild(ic); box.appendChild(fi);
      var open = el('a', 'jr-loc-link', 'Open'); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.href = '#'; open.setAttribute('aria-disabled', 'true');
      box.appendChild(open);
      if (path) signedUrl(path).then(function (u) { if (u) { open.href = u; open.removeAttribute('aria-disabled'); } else { open.textContent = 'Unavailable'; } });
      return box;
    }
    box = el('div', 'jr-media' + (m.type === 'video' ? ' jr-media--video' : ''));
    var ph = el('div', 'jr-media-ph'); ph.innerHTML = ICON_IMAGE; box.appendChild(ph);
    if (path) signedUrl(path).then(function (u) {
      if (!u) { ph.textContent = 'Unavailable'; return; }
      var node;
      if (m.type === 'video') { node = el('video', 'jr-media-img'); node.src = u; node.controls = true; node.preload = 'metadata'; node.setAttribute('playsinline', ''); }
      else {
        node = el('img', 'jr-media-img'); node.src = u; node.alt = p.caption || 'Photo'; node.loading = 'lazy'; node.style.cursor = 'zoom-in';
        node.addEventListener('click', function () { window.open(u, '_blank', 'noopener'); });
      }
      if (ph.parentNode) ph.parentNode.replaceChild(node, ph);
    });
    var cap = p.caption || ''; if (cap) box.appendChild(el('div', 'jr-media-caption', cap));
    return box;
  }
  function sig() { return A ? A.requestId + (A.busy ? 'b' : '') : ''; }

  /* ── menu and inputs ──────────────────────────────────────── */
  function menu(open) {
    var m = $('ccAttachMenu'), b = $('ccAttachBtn'); if (!m || !b) return;
    m.hidden = !open; b.setAttribute('aria-expanded', String(!!open));
  }
  function sync() {
    var b = $('ccAttachBtn'); if (!b) return;
    var C = chat(), S = C && C.state(), note = S && S.mode === 'note', can = C && C.canWrite();
    b.parentNode.hidden = !can || note;
    if (note && A) { drop(); renderPreview(); }
  }
  function bind() {
    var b = $('ccAttachBtn'); if (!b || b.dataset.bound) return; b.dataset.bound = '1';
    b.addEventListener('click', function (e) { e.stopPropagation(); if (A && A.busy) return; menu($('ccAttachMenu').hidden); });
    document.addEventListener('click', function (e) { var m = $('ccAttachMenu'); if (m && !m.hidden && !m.contains(e.target)) menu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu(false); });
    var inputs = { photo: $('ccFilePhoto'), camera: $('ccFileCamera'), file: $('ccFileDoc') };
    Array.prototype.forEach.call($('ccAttachMenu').querySelectorAll('[data-attach]'), function (it) {
      it.addEventListener('click', function () {
        var k = it.getAttribute('data-attach'); menu(false);
        if (k === 'location') { pickLocation(); return; }
        if (inputs[k]) { inputs[k].value = ''; inputs[k].click(); }
      });
    });
    Object.keys(inputs).forEach(function (k) {
      inputs[k].addEventListener('change', function () { var f = inputs[k].files && inputs[k].files[0]; if (f) pick(f); inputs[k].value = ''; });
    });
  }

  window.STCoAttach = { has: function () { return !!A; }, busy: function () { return !!(A && A.busy); }, clear: function () { drop(); renderPreview(); }, send: send, sync: sync, isMedia: isMedia, mediaFor: mediaFor, sig: sig, bind: bind };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

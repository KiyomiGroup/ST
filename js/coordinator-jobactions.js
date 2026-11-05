/* ============================================================
   StreetTasker — coordinator-jobactions.js (Stage 6D-4b)
   What a coordinator can do for the Local Tasker in the coordinator chat (coordinator-chat.html), the same things the Job Room lets a tasker do:
     Send an update           the "On my way / I have arrived / The work is finished" lines or free text         coordinator_send_update
     Propose a new time       the customer accepts or declines it (they answer with the existing Job Room function)  coordinator_propose_reschedule
     Send proof of work       1 to 5 files and a note, for the customer's own proof request; then the request is marked done
                              coordinator_send_proof_file (each file), coordinator_send_message (a note alone), coordinator_fulfil_request
     Mark as done             on the customer's own pending ask for an update, an arrival time or proof          coordinator_fulfil_request
   Everything is the Local Tasker speaking: the database writes it as the Local Tasker identity and records which coordinator did it.
   Never compulsory, never touches a payment, the booking step or the release code. The database functions check who you are, the job state and the
   contact-details rule again. Everything from the database is put on the page with textContent. No user id is ever shown.
   The three forms are in coordinator-chat.html (panes coUp, coRs, coPf of the Job actions sheet). The buttons on the customer's ask cards are
   drawn by js/coordinator-cards.js through setHooks. Needs window.STCoChat (coordinator-chat.js), STCoCards and STCoAttach.
   Public API (window.STCoJob): mount(detail, { reload }), available(pane), why(pane), onShow(pane)
   ============================================================ */
'use strict';

(function () {
  var D = null, RELOAD = null, busy = false;
  var U = { key: '', id: '', quick: '' };                              /* send update: the retry id belongs to what was typed */
  var R = { key: '', id: '' };                                         /* propose a new time */
  var P = { target: '', files: [], noteId: '', fulfilId: '', capSent: false, forBooking: '' };   /* proof of work */
  var FIVE = 5;
  var QUICK = { on_my_way: 'On my way.', arrived: 'I have arrived.', finished: 'The work is finished.' };

  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function sb() { return window.supabase; }
  function chat() { return window.STCoChat; }
  function cards() { return window.STCoCards; }
  function attach() { return window.STCoAttach; }
  function newId() {
    if (attach() && attach().newId) return attach().newId();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function bookingId() { var C = chat(); return C ? C.state().activeId : null; }
  function hintOf(e) { var h = e && (e.hint || (e.details && e.details.hint)); return h || ''; }
  function fileSizeText(b) { var n = Number(b) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function todayIso() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

  /* ── who can do what right now ────────────────────────────── */
  function detailOk() { return !!(D && D.booking_id === bookingId()); }
  function canAct() { var C = chat(); return !!(C && C.canWrite() && detailOk() && D.open && !D.frozen); }
  function pendingProof() { var c = cards(); return c ? c.pending('proof').filter(function (r) { return r.by === 'customer'; }) : []; }
  function pendingReschedule() { var c = cards(); return c ? c.pending('reschedule') : []; }

  function available(pane) {
    var C = chat(); if (!C || !C.canWrite()) return false;
    if (pane === 'coUp') return canAct();
    if (pane === 'coRs') return canAct() && !pendingReschedule().length;
    if (pane === 'coPf') return pendingProof().length > 0;
    return false;
  }
  function why(pane) {
    if (!detailOk()) return 'Loading the booking…';
    if (pane === 'coPf') return 'The customer has not asked for proof of work';
    if (D.frozen) return 'This job is locked while a problem report is open';
    if (!D.open) return 'This booking is closed';
    if (pane === 'coRs' && pendingReschedule().length) return 'A new time is already waiting for a reply';
    return 'Not available at this step';
  }

  /* ── small helpers for the forms ──────────────────────────── */
  function fieldError(id, msg) {
    var e = $(id + 'Err'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
    var i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function banner(prefix, msg) {
    var b = $(prefix + 'Error'), t = $(prefix + 'ErrorText'); if (!b || !t) return;
    t.textContent = msg || ''; b.hidden = !msg;
  }
  function info(msg) { var b = $('coPfInfo'); if (!b) return; $('coPfInfoText').textContent = msg || ''; b.hidden = !msg; }
  function setBusy(v, ids) { busy = !!v; (ids || []).forEach(function (i) { var n = $(i); if (n) n.disabled = !!v; }); }

  var FRIENDLY = { contact_info: 'This appears to contain contact details, which are not allowed on StreetTasker. Take them out and try again.' };
  var SAFE_HINTS = ['bad_input', 'closed', 'frozen', 'already_pending', 'bad_file'];
  /* Turns a refused or failed call into text. 'gone' means the conversation is not yours any more (the caller refreshes). */
  function failure(e) {
    var h = hintOf(e), m = String((e && e.message) || '');
    if (h === 'not_found' || h === 'read_only') return { gone: true, text: h === 'read_only' ? 'You can no longer reply to this booking.' : 'This conversation is no longer available to you.' };
    if (h === 'already_answered') return { answered: true, text: 'This request has already been answered.' };
    if (h === 'contact_info') return { contact: true, text: FRIENDLY.contact_info };
    if (SAFE_HINTS.indexOf(h) !== -1 && m) return { text: m };
    return { text: 'Could not send. Check your connection and try again.' };
  }
  async function afterGone(f) {
    var C = chat(); C.toast(f.text, true); C.closeActions();
    await C.refreshAll(false);
  }
  async function afterChange() {
    var C = chat();
    if (RELOAD) { try { await RELOAD(); } catch (e) { /* the page refreshes itself on the next poll */ } }
    else { await C.reloadThread(false); C.loadList(true); }
  }

  /* ── Send an update ───────────────────────────────────────── */
  function paintQuick() {
    var any = !!U.quick;
    Array.prototype.forEach.call(document.querySelectorAll('#coUp [data-quick]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-quick') === U.quick)); });
    var ta = $('coUpText'); ta.disabled = any; if (any) fieldError('coUpText', '');
    $('coUpQuickNote').textContent = any ? 'This will be sent: “' + QUICK[U.quick] + '” Tap it again to write your own.' : '';
    $('coUpQuickNote').hidden = !any;
  }
  async function submitUpdate(ev) {
    ev.preventDefault(); if (busy || !canAct()) return;
    var text = $('coUpText').value.trim(), quick = U.quick;
    fieldError('coUpText', ''); banner('coUp', '');
    if (!quick && (text.length < 3 || text.length > 300)) { fieldError('coUpText', 'Please write a short update (3 to 300 characters), or pick one of the quick lines.'); $('coUpText').focus(); return; }
    var key = quick ? 'q:' + quick : 't:' + text; if (U.key !== key) { U.key = key; U.id = newId(); }
    setBusy(true, ['coUpSubmit']); $('coUpSubmit').textContent = 'Sending…';
    var res;
    try { res = await sb().rpc('coordinator_send_update', { p_booking: bookingId(), p_request_id: U.id, p_text: quick ? null : text, p_quick: quick || null }); } catch (e) { res = { error: e }; }
    setBusy(false, ['coUpSubmit']); $('coUpSubmit').textContent = 'Send update';
    if (res.error) {
      var f = failure(res.error);
      if (f.gone) { await afterGone(f); return; }
      if (f.contact) { fieldError('coUpText', f.text); return; }
      banner('coUp', f.text); return;
    }
    U = { key: '', id: '', quick: '' }; $('coUpText').value = ''; paintQuick();
    chat().toast('Update sent to the customer', false); chat().closeActions(); await afterChange();
  }

  /* ── Propose a new time ───────────────────────────────────── */
  async function submitReschedule(ev) {
    ev.preventDefault(); if (busy || !canAct()) return;
    var date = $('coRsDate').value, time = $('coRsTime').value, reason = $('coRsReason').value.trim();
    ['coRsDate', 'coRsTime', 'coRsReason'].forEach(function (i) { fieldError(i, ''); }); banner('coRs', '');
    var bad = false;
    if (!date) { fieldError('coRsDate', 'Please choose a new date.'); bad = true; }
    else if (date < todayIso()) { fieldError('coRsDate', 'The new date cannot be in the past.'); bad = true; }
    if (!time) { fieldError('coRsTime', 'Please choose a time.'); bad = true; }
    var when = (date && time) ? new Date(date + 'T' + time) : null;
    if (!bad && (!when || isNaN(when.getTime()) || when.getTime() <= Date.now())) { fieldError('coRsTime', 'Please choose a time in the future.'); bad = true; }
    if (reason.length < 3 || reason.length > 300) { fieldError('coRsReason', 'Please say why (3 to 300 characters).'); bad = true; }
    if (bad) return;
    var key = when.toISOString() + '|' + reason; if (R.key !== key) { R.key = key; R.id = newId(); }
    setBusy(true, ['coRsSubmit']); $('coRsSubmit').textContent = 'Sending…';
    var res;
    try { res = await sb().rpc('coordinator_propose_reschedule', { p_booking: bookingId(), p_request_id: R.id, p_when: when.toISOString(), p_reason: reason }); } catch (e) { res = { error: e }; }
    setBusy(false, ['coRsSubmit']); $('coRsSubmit').textContent = 'Send new time';
    if (res.error) {
      var f = failure(res.error);
      if (f.gone) { await afterGone(f); return; }
      if (f.contact) { fieldError('coRsReason', f.text); return; }
      banner('coRs', f.text);
      if (hintOf(res.error) === 'already_pending' || hintOf(res.error) === 'closed' || hintOf(res.error) === 'frozen') await afterChange();
      return;
    }
    R = { key: '', id: '' }; $('coRsDate').value = ''; $('coRsTime').value = ''; $('coRsReason').value = '';
    chat().toast('New time sent to the customer', false); chat().closeActions(); await afterChange();
  }

  /* ── Mark as done (the customer's own ask) ────────────────── */
  var DONE_ID = {};   /* job request id -> retry id */
  async function markDone(req) {
    var C = chat(); if (!C.canWrite()) return;
    var rid = DONE_ID[req.id] || (DONE_ID[req.id] = newId());
    var res;
    try { res = await sb().rpc('coordinator_fulfil_request', { p_booking: bookingId(), p_request_id: rid, p_job_request: req.id }); } catch (e) { res = { error: e }; }
    if (res.error) {
      var f = failure(res.error);
      if (f.gone) { await afterGone(f); return; }
      C.toast(f.answered ? f.text : (hintOf(res.error) === 'bad_input' ? 'This request cannot be marked as done here.' : f.text), true);
      if (f.answered) { delete DONE_ID[req.id]; await afterChange(); }
      return;
    }
    delete DONE_ID[req.id];
    C.toast('Marked as done', false); await afterChange();
  }

  /* The buttons on the customer's pending asks (drawn by coordinator-cards.js) */
  function actionsFor(req) {
    var C = chat(); if (!C || !C.canWrite()) return [];
    var out = [];
    if (req.kind === 'update' || req.kind === 'arrival') {
      if (!detailOk() || canAct()) out.push({ label: 'Send update', run: function () { C.openActions('coUp'); } });
    } else if (req.kind === 'proof') {
      out.push({ label: 'Send proof', run: function () { P.target = req.id; C.openActions('coPf'); } });
    } else return [];
    out.push({ label: 'Mark as done', primary: true, run: function () { return markDone(req); } });
    return out;
  }

  /* ── Send proof of work ───────────────────────────────────── */
  function proofTarget() {
    var list = pendingProof(), c = cards();
    if (P.target && c && c.find(P.target) && c.find(P.target).status === 'pending') return P.target;
    P.target = list.length ? list[0].id : ''; return P.target;
  }
  function paintFiles() {
    var ul = $('coPfList'); ul.textContent = '';
    P.files.forEach(function (f, i) {
      var li = el('li', 'jr-proof-file');
      li.appendChild(el('span', 'jr-proof-name', f.file.name + ' · ' + fileSizeText(f.file.size) + (f.sent ? ' · sent' : f.error ? ' · not sent' : '')));
      if (!f.sent) {
        var rm = el('button', 'jr-sheet-remove', 'Remove'); rm.type = 'button'; rm.disabled = busy;
        rm.addEventListener('click', function () { if (!busy) { P.files.splice(i, 1); paintFiles(); } });
        li.appendChild(rm);
      }
      ul.appendChild(li);
    });
    $('coPfAdd').disabled = busy || P.files.length >= FIVE;
  }
  function paintProof() {
    var bk = bookingId();
    if (P.forBooking !== bk) { P = { target: '', files: [], noteId: '', fulfilId: '', capSent: false, forBooking: bk }; $('coPfNote').value = ''; }
    var t = proofTarget(), c = cards(), req = t && c ? c.find(t) : null;
    $('coPfLead').textContent = req
      ? 'The customer asked for proof of the work. Send what the Local Tasker showed you. Photos, video and files are optional: a note is enough.'
      : 'The customer has not asked for proof of work, or it was already answered.';
    $('coPfForm').hidden = !req; banner('coPf', ''); info(''); fieldError('coPfNote', ''); fieldError('coPfFiles', '');
    paintFiles();
  }
  function addFiles(list) {
    fieldError('coPfFiles', '');
    Array.prototype.forEach.call(list || [], function (f) { if (P.files.length < FIVE) P.files.push({ file: f, rid: newId(), prepared: null, path: '', sent: false, error: '' }); });
    paintFiles();
  }
  async function submitProof(ev) {
    ev.preventDefault(); if (busy) return;
    var C = chat(), A = attach(), bk = bookingId(), t = proofTarget(), note = $('coPfNote').value.trim();
    banner('coPf', ''); info(''); fieldError('coPfNote', ''); fieldError('coPfFiles', '');
    if (!C || !C.canWrite() || !t) { banner('coPf', 'This request is no longer waiting for proof.'); return; }
    var todo = P.files.filter(function (f) { return !f.sent; });
    if (!P.files.length && note.length < 3) { fieldError('coPfNote', 'Add a short note or at least one file.'); $('coPfNote').focus(); return; }
    if (note.length > 500) { fieldError('coPfNote', 'A note can have up to 500 characters.'); return; }
    setBusy(true, ['coPfSubmit']); $('coPfSubmit').textContent = 'Sending…'; paintFiles();
    var failed = [], sentNow = 0, abort = null;
    try {
      if (!P.files.length) {
        if (!P.noteId) P.noteId = newId();
        var r = await sb().rpc('coordinator_send_message', { p_booking: bk, p_request_id: P.noteId, p_body: ('Proof of work: ' + note).slice(0, 2000) });
        if (r.error) throw r.error;
        sentNow++;
      } else {
        for (var i = 0; i < todo.length && !abort; i++) {
          var f = todo[i];
          try {
            if (!f.prepared) f.prepared = await A.prepareFile(f.file);
            if (!f.path) f.path = await A.uploadPrepared(f.prepared);
            var cap = (!P.capSent && note) ? note : null;
            var rr = await sb().rpc('coordinator_send_proof_file', { p_booking: bk, p_request_id: f.rid, p_job_request: t, p_kind: f.prepared.kind, p_path: f.path, p_name: f.prepared.name, p_caption: cap });
            if (rr.error) throw rr.error;
            f.sent = true; f.error = ''; sentNow++; if (cap) P.capSent = true;
          } catch (e) {
            var fl = (!f.prepared && !hintOf(e)) ? { text: (e && e.message) || 'This file could not be prepared.' } : failure(e);   /* a file the browser refused says why */
            if (fl.gone || fl.answered || fl.contact) { abort = { e: e, f: fl }; break; }
            f.error = fl.text; failed.push((f.file.name || 'File') + ': ' + fl.text);
            if (hintOf(e) === 'bad_file' || !hintOf(e) && !f.prepared) f.dead = true;   /* the file itself is refused: do not retry it */
          }
        }
      }
    } catch (e) { abort = { e: e, f: failure(e) }; }
    setBusy(false, ['coPfSubmit']); $('coPfSubmit').textContent = 'Send proof';
    P.files = P.files.filter(function (x) { return !x.dead; }); paintFiles();
    if (sentNow) { C.reloadThread(false); C.loadList(true); }
    if (abort) {
      var af = abort.f;
      if (af.gone) { await afterGone(af); return; }
      if (af.answered) { C.toast(af.text, true); C.closeActions(); await afterChange(); return; }
      if (af.contact) { fieldError('coPfNote', af.text); return; }
      banner('coPf', af.text); return;
    }
    if (failed.length) { info('Sent ' + sentNow + '. Not sent: ' + failed.join(' ') + ' Fix or remove the files below and send again, or close this and use Mark as done.'); return; }
    /* everything was sent: now answer the customer's request (never before) */
    if (!P.fulfilId) P.fulfilId = newId();
    var fr;
    try { fr = await sb().rpc('coordinator_fulfil_request', { p_booking: bk, p_request_id: P.fulfilId, p_job_request: t }); } catch (e) { fr = { error: e }; }
    if (fr.error && hintOf(fr.error) !== 'already_answered') {
      var ff = failure(fr.error);
      if (ff.gone) { await afterGone(ff); return; }
      C.toast('Proof sent, but the request could not be marked as done. Use Mark as done on the request.', true);
    } else C.toast('Proof sent to the customer', false);
    P = { target: '', files: [], noteId: '', fulfilId: '', capSent: false, forBooking: bk }; $('coPfNote').value = '';
    C.closeActions(); await afterChange();
  }

  /* ── wiring ───────────────────────────────────────────────── */
  function onShow(pane) {
    if (pane === 'coUp') { banner('coUp', ''); fieldError('coUpText', ''); paintQuick(); }
    else if (pane === 'coRs') { banner('coRs', ''); ['coRsDate', 'coRsTime', 'coRsReason'].forEach(function (i) { fieldError(i, ''); }); $('coRsDate').min = todayIso(); }
    else if (pane === 'coPf') paintProof();
  }
  function bind() {
    var up = $('coUpForm'); if (!up || up.dataset.bound) return; up.dataset.bound = '1';
    up.addEventListener('submit', submitUpdate);
    Array.prototype.forEach.call(document.querySelectorAll('#coUp [data-quick]'), function (b) {
      b.addEventListener('click', function () { var q = b.getAttribute('data-quick'); U.quick = U.quick === q ? '' : q; paintQuick(); });
    });
    $('coRsForm').addEventListener('submit', submitReschedule);
    $('coPfForm').addEventListener('submit', submitProof);
    $('coPfAdd').addEventListener('click', function () { $('coPfFiles').click(); });
    $('coPfFiles').addEventListener('change', function () { addFiles($('coPfFiles').files); $('coPfFiles').value = ''; });
    if (cards()) cards().setHooks({ actionsFor: actionsFor });
  }
  var lastAct = null;
  async function mount(detail, opts) {
    D = detail || null; RELOAD = opts && opts.reload || null; bind();
    var now = canAct();
    if (lastAct !== now) { lastAct = now; var C = chat(); if (C && C.redraw) C.redraw(); }   /* the Send update buttons on the cards follow the job state */
    return null;
  }

  window.STCoJob = { mount: mount, available: available, why: why, onShow: onShow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

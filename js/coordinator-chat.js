/* ============================================================
   StreetTasker — coordinator-chat.js (Stage 6B)
   The coordinator's inbox and conversation page (coordinator-chat.html).

   Data comes only from these functions (all check the signed-in coordinator in the database):
     coordinator_chat_list       the inbox
     coordinator_chat_thread     one conversation: messages (customer-visible) and notes (internal), in two separate lists
     coordinator_send_message    the ONLY way to write to the customer
     coordinator_add_note        the ONLY way to write an internal note
     coordinator_chat_mark_read  clears the unread count
     local_booking_detail        the booking context panel (current coordinator only)
   Internal notes are drawn in their own block (lock, amber, "Not visible to the customer"), never as a bubble.
   Everything typed by a person is put on the page with textContent, never innerHTML. Runs on `coordinator:ready`.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  var POLL_MS = 20000;
  var MAX_LEN = 2000;
  var S = { rows: [], filter: 'all', q: '', activeId: null, thread: null, detail: null, taskerPhone: '', mode: 'customer', online: navigator.onLine !== false,
            sending: false, pending: null, drafts: {}, seq: 0, sig: '', timer: null, live: null, liveTimer: null };

  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { return C.el(t, c, x); }
  function sb() { return window.supabase; }
  function hintOf(e) {
    if (!e) return '';
    if (e.hint) return e.hint;
    return /contact (details|information)/i.test(e.message || '') ? 'contact_info' : '';
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  /* Static icon markup only (never user text). */
  var ICON_LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  var ICON_CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  /* ── time ─────────────────────────────────────────────────── */
  function timeLabel(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(iso) {
    var d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    var full = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    if (dayKey(d) === dayKey(now)) return 'Today · ' + full;
    if (dayKey(d) === dayKey(y)) return 'Yesterday · ' + full;
    return full;
  }
  function listTime(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (dayKey(d) === dayKey(now)) return timeLabel(iso);
    if (dayKey(d) === dayKey(y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function toast(msg, isError) {
    var box = $('ccToasts'); if (!box) return;
    var t = el('div', 'jr-toast' + (isError ? ' jr-toast--error' : ''), msg); box.appendChild(t);
    setTimeout(function () { t.classList.add('is-leaving'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320); }, 4000);
  }

  /* ── rows ─────────────────────────────────────────────────── */
  function rowById(id) { for (var i = 0; i < S.rows.length; i++) if (S.rows[i].booking_id === id) return S.rows[i]; return null; }
  function isMine(r) { return r && r.access === 'coordinator'; }
  function needsAction(r) { return isMine(r) && B.nextAction(r).tab === 'action'; }
  function previewOf(r) {
    var t = String(r.last_message || '');
    if (/^PAYMENT_REQUEST:/.test(t)) return 'Payment request';
    return t;
  }
  function chipFor(r) {
    if (!isMine(r)) return ['jr-chip jr-chip--muted', 'Read only'];
    var tab = B.nextAction(r).tab;
    var label = r.frozen ? 'Problem reported' : B.ltLabel(r.lt_status);
    return [tab === 'action' ? 'jr-chip jr-chip--action' : tab === 'problem' ? 'jr-chip jr-chip--danger' : tab === 'closed' ? 'jr-chip jr-chip--muted' : 'jr-chip jr-chip--success', label];
  }

  function visibleRows() {
    var q = S.q.trim().toLowerCase();
    return S.rows.filter(function (r) {
      if (S.filter === 'unread' && !(r.unread > 0)) return false;
      if (S.filter === 'action' && !needsAction(r)) return false;
      if (S.filter === 'readonly' && isMine(r)) return false;
      if (!q) return true;
      return [r.customer_name, r.tasker_name, r.title, previewOf(r), B.ref(r.booking_id)].join(' ').toLowerCase().indexOf(q) > -1;
    });
  }

  function renderTabs() {
    var box = $('ccTabs'); box.textContent = '';
    var unread = S.rows.filter(function (r) { return r.unread > 0; }).length;
    var act = S.rows.filter(needsAction).length;
    var ro = S.rows.filter(function (r) { return !isMine(r); }).length;
    var tabs = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread', n: unread }, { id: 'action', label: 'Needs action', n: act }];
    if (ro) tabs.push({ id: 'readonly', label: 'Read only', n: ro });
    tabs.forEach(function (t) {
      var b = el('button', 'jr-tab' + (S.filter === t.id ? ' is-active' : ''), t.label); b.type = 'button';
      if (t.n) b.appendChild(el('span', 'jr-tab-count', String(t.n)));
      b.addEventListener('click', function () { S.filter = t.id; renderList(); });
      box.appendChild(b);
    });
    var active = S.rows.filter(function (r) { return isMine(r) && r.open; }).length;
    var chip = $('ccCount'); chip.hidden = !S.rows.length; chip.textContent = active + ' active';
  }

  function renderList() {
    renderTabs();
    var rows = visibleRows(), ul = $('ccRows'); ul.textContent = '';
    $('ccListLoading').hidden = true; $('ccListError').hidden = true;
    var empty = !rows.length;
    $('ccListEmpty').hidden = !empty; ul.hidden = empty;
    if (empty) {
      var none = !S.rows.length;
      $('ccListEmptyTitle').textContent = none ? 'No conversations yet' : 'Nothing here';
      $('ccListEmptyText').textContent = none ? 'When a customer books one of your Local Taskers, the conversation appears here.' : 'No conversations match. Try another filter or search.';
      return;
    }
    rows.forEach(function (r) {
      var li = el('li');
      var b = el('button', 'msg-thread-item cc-row' + (r.booking_id === S.activeId ? ' active' : '')); b.type = 'button'; b.dataset.id = r.booking_id;
      if (r.booking_id === S.activeId) b.setAttribute('aria-current', 'true');
      b.appendChild(el('div', 'msg-thread-avatar', C.initialsOf(r.customer_name, 'CU')));
      var info = el('div', 'msg-thread-info');
      var top = el('div', 'jr-thread-top');
      top.appendChild(el('div', 'msg-thread-name', r.customer_name || 'Customer'));
      top.appendChild(el('div', 'jr-thread-time', listTime(r.last_message_at || r.created_at)));
      info.appendChild(top);
      info.appendChild(el('div', 'jr-thread-person', (r.title || 'Booking') + (r.tasker_name ? ' · ' + r.tasker_name : '')));
      var pv = previewOf(r); info.appendChild(el('div', 'msg-thread-preview' + (pv ? '' : ' is-empty'), pv || 'No messages yet'));
      var foot = el('div', 'jr-thread-foot'), ch = chipFor(r);
      foot.appendChild(el('span', ch[0], ch[1]));
      if (r.unread > 0) { var u = el('span', 'msg-thread-unread', r.unread > 98 ? '99+' : String(r.unread)); u.setAttribute('aria-label', r.unread + ' unread'); foot.appendChild(u); }
      info.appendChild(foot); b.appendChild(info); li.appendChild(b); ul.appendChild(li);
      b.addEventListener('click', function () { openBooking(r.booking_id); });
    });
  }

  async function loadList(silent) {
    if (!silent) { $('ccListLoading').hidden = false; $('ccListError').hidden = true; $('ccRows').hidden = true; $('ccListEmpty').hidden = true; }
    var res;
    try { res = await sb().rpc('coordinator_chat_list', { p_limit: 100 }); } catch (e) { res = { error: e }; }
    if (res.error || !Array.isArray(res.data)) {
      if (!silent) { $('ccListLoading').hidden = true; $('ccListError').hidden = false; }
      return false;
    }
    S.rows = res.data; renderList(); return true;
  }

  /* ── conversation ─────────────────────────────────────────── */
  function canWrite() { return !!(S.thread && S.thread.access === 'coordinator'); }
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'the customer'; }

  function renderHead() {
    var r = rowById(S.activeId); if (!r) return;
    $('ccHeadAvatar').textContent = C.initialsOf(r.customer_name, 'CU');
    $('ccHeadName').textContent = r.customer_name || 'Customer';
    $('ccHeadSub').textContent = (r.title || 'Booking') + ' · ' + B.ref(r.booking_id);
    var meta = $('ccHeadMeta'); meta.textContent = '';
    var ch = chipFor(r); meta.appendChild(el('span', ch[0], ch[1]));
    if (isMine(r)) meta.appendChild(el('span', 'jr-chip ' + (r.open ? 'jr-chip--success' : 'jr-chip--muted'), r.open ? 'Coordination active' : 'Closed'));
    var strip = [r.title || 'Booking'];
    if (r.tasker_name) strip.push('With ' + r.tasker_name);
    if (r.amount != null && B.naira(r.amount)) strip.push(B.naira(r.amount));
    if (r.scheduled_time) strip.push(B.whenText(r));
    $('ccStripText').textContent = strip.join(' · ');
    var call = $('ccCall'), ph = S.detail && S.detail.customer_phone ? String(S.detail.customer_phone).replace(/[^0-9+]/g, '') : '';
    call.hidden = !ph; if (ph) call.href = 'tel:' + ph;
    $('ccCtxRef').hidden = false; $('ccCtxRef').textContent = B.ref(r.booking_id);
  }

  function noteBlock(n, pending) {
    var box = el('article', 'cc-note' + (pending ? ' is-pending' : '')); box.setAttribute('aria-label', 'Internal note, not visible to the customer');
    if (n.id) box.dataset.id = n.id;
    var head = el('div', 'cc-note-head'); var ic = el('span', 'cc-note-icon'); ic.innerHTML = ICON_LOCK; head.appendChild(ic);
    head.appendChild(el('span', 'cc-note-label', 'Internal note · not visible to the customer')); box.appendChild(head);
    box.appendChild(el('p', 'cc-note-text', n.body));
    box.appendChild(el('div', 'cc-note-foot', pending ? (pending.failed ? 'Not saved' : 'Saving…') : (n.author_name + (n.author_is_me ? ' (you)' : '') + ' · ' + timeLabel(n.created_at))));
    if (pending && pending.failed) { var rb = el('button', 'msg-failed', 'Not saved. Tap to retry'); rb.type = 'button'; rb.addEventListener('click', function () { submit(pending); }); box.appendChild(rb); }
    return box;
  }

  function systemLine(m) {
    var t = String(m.body || ''), pr = /^PAYMENT_REQUEST:[^:]*:(\d+)/.exec(t);
    var text = pr ? 'Payment request sent to the customer: ₦' + Number(pr[1]).toLocaleString('en-NG') : (/^[A-Z_]{4,}:/.test(t) ? 'Job Room update' : t);
    var row = el('div', 'jr-system'), chip = el('div', 'jr-system-chip'), ic = el('span', 'jr-system-icon'); ic.innerHTML = ICON_CHECK;
    chip.appendChild(ic); chip.appendChild(document.createTextNode(text)); row.appendChild(chip); row.appendChild(el('div', 'jr-system-time', timeLabel(m.created_at)));
    return row;
  }

  function bubble(m, who, pending) {
    var mine = m.kind !== 'customer';
    var wrap = el('div', 'msg-bubble-wrap ' + (mine ? 'mine' : 'theirs') + (pending ? ' is-pending' : '') + (pending && pending.failed ? ' is-failed' : ''));
    if (m.id) wrap.dataset.id = m.id;
    var col = el('div', 'cc-bubble-col');
    if (who) col.appendChild(el('div', 'cc-who', who));
    var bb = el('div', 'msg-bubble');
    bb.appendChild(el('span', 'msg-bubble-text', m.body || ''));
    bb.appendChild(el('span', 'msg-bubble-time', pending ? (pending.failed ? '' : 'Sending…') : timeLabel(m.created_at)));
    col.appendChild(bb);
    if (pending && pending.failed) { var rb = el('button', 'msg-failed', 'Not sent. Tap to retry'); rb.type = 'button'; rb.addEventListener('click', function () { submit(pending); }); col.appendChild(rb); }
    wrap.appendChild(col);
    return wrap;
  }

  function renderTimeline(mode) {
    var body = $('ccBody'), t = S.thread; if (!t) return;
    var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80, prevTop = body.scrollTop;
    var r = rowById(S.activeId), items = [];
    t.messages.forEach(function (m) { items.push({ k: 'm', at: m.created_at, v: m }); });
    t.notes.forEach(function (n) { items.push({ k: 'n', at: n.created_at, v: n }); });
    items.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    body.textContent = '';
    if (t.total_messages > t.messages.length) body.appendChild(el('div', 'jr-thread-note', 'Showing the latest ' + t.messages.length + ' messages.'));
    var lastDay = '', lastKey = '', lastAt = 0;
    items.forEach(function (it) {
      var d = new Date(it.at), dk = dayKey(d);
      if (dk !== lastDay) { body.appendChild(el('div', 'msg-date-divider', dayLabel(it.at))); lastDay = dk; lastKey = ''; }
      if (it.k === 'n') { body.appendChild(noteBlock(it.v)); lastKey = ''; return; }
      var m = it.v;
      if (m.kind === 'local_tasker' || m.kind === 'other') { body.appendChild(systemLine(m)); lastKey = ''; return; }
      var key = m.kind + '|' + (m.author_name || ''), gap = d.getTime() - lastAt > 5 * 60 * 1000;
      var who = (key !== lastKey || gap) ? (m.kind === 'customer' ? ((r && r.customer_name) || 'Customer') : (m.author_name + (m.author_is_me ? ' (you)' : ''))) : '';
      body.appendChild(bubble(m, who, null)); lastKey = key; lastAt = d.getTime();
    });
    if (S.pending) {
      if (S.pending.kind === 'note') body.appendChild(noteBlock({ body: S.pending.body }, S.pending));
      else body.appendChild(bubble({ kind: 'coordinator', body: S.pending.body }, '', S.pending));
    }
    if (!items.length && !S.pending) {
      body.appendChild(el('div', 'jr-thread-note', canWrite() ? 'No messages yet. Write to ' + firstName(r && r.customer_name) + ' below, or keep a private internal note.' : 'No messages yet.'));
    }
    body.hidden = false;
    var jump = $('ccJump');
    if (mode === 'bottom' || nearBottom) { body.scrollTop = body.scrollHeight; jump.hidden = true; }
    else { body.scrollTop = prevTop; jump.hidden = !(mode === 'new'); }
  }

  function renderComposer() {
    var can = canWrite(), t = S.thread;
    $('ccComposer').hidden = !can; $('ccReadonly').hidden = can || !t;
    if (t && !can) {
      $('ccReadonlyText').textContent = t.access === 'former_coordinator'
        ? 'You coordinated this booking earlier. You can read the conversation and the notes, but only the current coordinator can reply.'
        : 'You can read this conversation, but only the current coordinator can reply.';
    }
    setMode(S.mode, true);
  }

  function updateSend() {
    var has = $('ccInput').value.trim().length > 0;
    $('ccSend').disabled = !has || S.sending || !S.online || !canWrite();
  }

  function setMode(mode, keepFocus) {
    var prevKey = S.activeId + '|' + S.mode, ta = $('ccInput');
    if (!keepFocus || mode !== S.mode) S.drafts[prevKey] = ta.value;
    S.mode = mode;
    var note = mode === 'note', r = rowById(S.activeId);
    $('ccModeCustomer').classList.toggle('is-active', !note); $('ccModeCustomer').setAttribute('aria-selected', String(!note));
    $('ccModeNote').classList.toggle('is-active', note); $('ccModeNote').setAttribute('aria-selected', String(note));
    $('ccComposer').classList.toggle('is-note', note);
    $('ccHintText').textContent = note ? 'Only coordinators and administrators can see this. The customer never does.' : 'Visible to ' + firstName(r && r.customer_name) + '.';
    ta.placeholder = note ? 'Write an internal note…' : 'Write a message to ' + firstName(r && r.customer_name) + '…';
    $('ccInputLabel').textContent = note ? 'Internal note' : 'Message to the customer';
    $('ccSend').setAttribute('aria-label', note ? 'Save note' : 'Send message');
    ta.value = S.drafts[S.activeId + '|' + mode] || '';
    $('ccWarn').hidden = true; autosize(); updateSend();
  }
  function autosize() { var ta = $('ccInput'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'; }

  function setOffline() { $('ccOffline').hidden = S.online; updateSend(); }

  /* ── context (right-hand column, and the sheet) ───────────── */
  function fact(dl, label, value, opts) {
    var has = value != null && String(value).trim() !== '';
    dl.appendChild(el('dt', 'cc-fact-label', label));
    var dd = el('dd', 'cc-fact-value' + (has ? '' : ' is-empty'));
    if (has && opts && opts.tel) { var a = el('a', 'cc-fact-link', String(value)); a.href = 'tel:' + String(value).replace(/[^0-9+]/g, ''); dd.appendChild(a); }
    else dd.textContent = has ? String(value) : ((opts && opts.empty) || 'Not provided');
    dl.appendChild(dd);
  }
  function card(title) { var c = el('section', 'cc-card'); c.appendChild(el('h3', 'cc-card-title', title)); return c; }

  function buildContext(box) {
    box.textContent = '';
    var r = rowById(S.activeId), d = S.detail;
    if (!r) { box.appendChild(el('div', 'jr-detail-empty', 'Booking details appear here when you open a conversation.')); return; }
    var task = (d && d.task) || {}, svc = (d && d.service) || {};
    if (d) {
      var nx = B.nextAction(d), c0 = card('Next step'); c0.appendChild(el('p', 'cc-next' + (nx.tab === 'action' ? ' is-action' : ''), nx.text)); box.appendChild(c0);
    } else if (!isMine(r)) {
      var cr = card('Read only'); cr.appendChild(el('p', 'cc-next', 'You coordinated this booking earlier. You can read the conversation and the notes. Booking details are shown to the current coordinator only.')); box.appendChild(cr);
    }
    var cs = card('Service'); var dl = el('dl', 'cc-facts');
    fact(dl, 'Job', task.title || svc.service_name || r.title); fact(dl, 'Category', task.category || svc.category, { empty: '—' });
    fact(dl, 'Step', r.frozen ? 'Problem reported' : B.ltLabel(r.lt_status)); cs.appendChild(dl); box.appendChild(cs);

    var cc = card('Customer'); dl = el('dl', 'cc-facts');
    fact(dl, 'Name', r.customer_name);
    if (d) fact(dl, 'Phone', d.customer_phone, { tel: true, empty: d.open ? 'Not on file' : 'Hidden once a booking is closed' });
    cc.appendChild(dl); box.appendChild(cc);

    var ct = card('Local Tasker'); dl = el('dl', 'cc-facts'); fact(dl, 'Name', r.tasker_name); ct.appendChild(dl);
    var badges = el('div', 'cc-badges'); badges.appendChild(el('span', 'jr-chip jr-chip--success', 'Local Tasker')); badges.appendChild(el('span', 'jr-chip jr-chip--muted', 'Phone Assisted')); ct.appendChild(badges);
    if (d && C.isUuid(d.tasker_user_id)) {
      var acts = el('div', 'cc-actions');
      var pl = el('a', 'btn btn-outline btn-sm', 'Open profile'); pl.href = 'coordinator-tasker.html?id=' + encodeURIComponent(d.tasker_user_id); acts.appendChild(pl);
      if (S.taskerPhone) { var cl = el('a', 'btn btn-mint btn-sm', 'Call Local Tasker'); cl.href = 'tel:' + S.taskerPhone.replace(/[^0-9+]/g, ''); acts.appendChild(cl); }
      ct.appendChild(acts);
    }
    box.appendChild(ct);

    var cw = card('When and where'); dl = el('dl', 'cc-facts');
    fact(dl, 'When', B.whenText(r), { empty: 'Not set yet' }); if (d) fact(dl, 'Place', task.location || svc.location, { empty: 'Not set yet' });
    cw.appendChild(dl); box.appendChild(cw);

    var cp = card('Payment (read only)'); dl = el('dl', 'cc-facts');
    fact(dl, 'Status', B.payLabel(r.payment_status)); fact(dl, 'Amount', B.naira(r.amount), { empty: 'Not set yet' }); cp.appendChild(dl);
    cp.appendChild(el('p', 'cc-card-note', 'Payments are handled by StreetTasker. You cannot change them.')); box.appendChild(cp);

    if (d) { var open = el('a', 'btn btn-outline btn-full', 'Open full booking'); open.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id); box.appendChild(open); }
  }
  function renderContext() { buildContext($('ccCtx')); if (!$('ccSheet').hidden) buildContext($('ccSheetBody')); }

  function openSheet() {
    buildContext($('ccSheetBody')); $('ccSheet').hidden = false; $('ccInfo').setAttribute('aria-expanded', 'true'); $('ccSheetClose').focus();
  }
  function closeSheet() { $('ccSheet').hidden = true; $('ccInfo').setAttribute('aria-expanded', 'false'); }

  /* ── open / reload a conversation ─────────────────────────── */
  function showRoom(on) {
    $('ccEmpty').hidden = on; $('ccHead').hidden = !on; $('ccStrip').hidden = !on;
    if (!on) { $('ccBody').hidden = true; $('ccComposer').hidden = true; $('ccReadonly').hidden = true; $('ccJump').hidden = true; }
    $('ccRoom').classList.toggle('open', on);
  }

  function signature(t) {
    var m = t.messages, n = t.notes;
    return [t.thread_id, t.access, t.total_messages, m.length ? m[m.length - 1].id : '', n.length ? n[n.length - 1].id : '', n.length].join('|');
  }

  async function fetchThread(id) {
    var res;
    try { res = await sb().rpc('coordinator_chat_thread', { p_booking: id, p_limit: 100 }); } catch (e) { res = { error: e }; }
    return res;
  }

  async function openBooking(id) {
    var r = rowById(id);
    if (!r) { missing(); return; }
    if (S.activeId) S.drafts[S.activeId + '|' + S.mode] = $('ccInput').value;
    var seq = ++S.seq;
    S.activeId = id; S.thread = null; S.detail = null; S.taskerPhone = ''; S.pending = null; S.sig = '';
    try { var u = new URL(window.location.href); u.searchParams.set('booking', id); history.replaceState(null, '', u.pathname + u.search); } catch (e) { /* not essential */ }
    renderList(); showRoom(true); renderHead(); renderContext();
    var body = $('ccBody'); body.hidden = false; body.textContent = ''; body.appendChild(el('div', 'jr-thread-note', 'Loading the conversation…'));
    $('ccComposer').hidden = true; $('ccReadonly').hidden = true;
    var res = await fetchThread(id);
    if (seq !== S.seq) return;
    if (res.error || !res.data) { threadError(id, hintOf(res.error) === 'not_found'); return; }
    S.thread = res.data; S.sig = signature(S.thread);
    renderTimeline('bottom'); renderComposer(); $('ccBody').scrollTop = $('ccBody').scrollHeight;
    if (S.thread.access === 'coordinator') loadContext(id, seq);
    markRead(id);
  }

  function threadError(id, gone) {
    var body = $('ccBody'); body.hidden = false; body.textContent = '';
    var box = el('div', 'jr-thread-note jr-thread-note--error', gone ? 'This conversation is no longer available to you.' : 'Could not load the conversation. Check your connection and try again.');
    if (!gone) { var b = el('button', 'msg-retry-btn', 'Try again'); b.type = 'button'; b.addEventListener('click', function () { openBooking(id); }); box.appendChild(document.createElement('br')); box.appendChild(b); }
    body.appendChild(box);
  }

  function missing() {
    S.activeId = null; showRoom(false); renderList();
    $('ccEmpty').lastElementChild.textContent = 'That conversation is not available to you. Pick one from the list.';
  }

  async function loadContext(id, seq) {
    try {
      var res = await sb().rpc('local_booking_detail', { p_booking: id });
      if (seq !== S.seq) return;
      if (!res.error && res.data) S.detail = res.data;
      if (S.detail && C.isUuid(S.detail.tasker_user_id)) {
        var p = await sb().from('local_tasker_profiles').select('phone').eq('tasker_user_id', S.detail.tasker_user_id).maybeSingle();
        if (seq === S.seq && !p.error && p.data && p.data.phone) S.taskerPhone = String(p.data.phone);
      }
    } catch (e) { /* the conversation works without the side panel */ }
    if (seq !== S.seq) return;
    renderHead(); renderContext();
  }

  async function markRead(id, force) {
    var r = rowById(id);
    if (!r || !isMine(r) || !S.thread || !S.thread.thread_id || (!force && !(r.unread > 0))) return;
    try {
      var res = await sb().rpc('coordinator_chat_mark_read', { p_booking: id });
      if (!res.error) { r.unread = 0; renderList(); }
    } catch (e) { /* the count simply stays until the next refresh */ }
  }

  /* Refetch the open conversation. Quietly: only redraws when something changed. */
  async function reloadThread(quiet) {
    var id = S.activeId; if (!id) return;
    var seq = S.seq, res = await fetchThread(id);
    if (seq !== S.seq || id !== S.activeId) return;
    if (res.error || !res.data) { if (!quiet) toast('Could not refresh the conversation.', true); return; }
    var sig = signature(res.data), changed = sig !== S.sig;
    S.thread = res.data; S.sig = sig;
    if (changed) { renderTimeline(quiet ? 'new' : 'bottom'); renderComposer(); }
    if (changed && !document.hidden) markRead(id, true);
  }

  async function refreshAll(quiet) {
    if (!S.online) return;
    await loadList(true);
    if (S.activeId && !rowById(S.activeId)) { missing(); return; }
    if (S.activeId) await reloadThread(quiet);
  }

  /* ── sending ──────────────────────────────────────────────── */
  async function submit(p) {
    if (S.sending || !canWrite()) return;
    if (!S.online) { toast('You are offline. Try again when you reconnect.', true); return; }
    S.sending = true; p.failed = false; S.pending = p; updateSend(); renderTimeline('bottom');
    var res;
    try {
      res = await sb().rpc(p.kind === 'note' ? 'coordinator_add_note' : 'coordinator_send_message', { p_booking: S.activeId, p_request_id: p.requestId, p_body: p.body });
    } catch (e) { res = { error: e }; }
    S.sending = false;
    if (res.error) {
      var h = hintOf(res.error);
      if (h === 'contact_info') { S.pending = null; $('ccInput').value = p.body; autosize(); $('ccWarn').hidden = false; renderTimeline('bottom'); updateSend(); return; }
      if (h === 'not_found' || h === 'read_only') {
        S.pending = null; toast(h === 'read_only' ? 'You can no longer reply to this booking.' : 'This conversation is no longer available to you.', true);
        await refreshAll(false); return;
      }
      if (h === 'bad_input') { S.pending = null; $('ccInput').value = p.body; autosize(); toast('Write between 1 and ' + MAX_LEN + ' characters.', true); renderTimeline('bottom'); updateSend(); return; }
      p.failed = true; renderTimeline('bottom'); updateSend(); toast('Could not send. Check your connection and try again.', true); return;
    }
    S.pending = null; delete S.drafts[S.activeId + '|' + (p.kind === 'note' ? 'note' : 'customer')];
    await reloadThread(false); loadList(true); updateSend();
  }

  function onSend() {
    var ta = $('ccInput'), body = ta.value.trim();
    if (!body || S.sending || !canWrite()) return;
    var kind = S.mode === 'note' ? 'note' : 'message';
    ta.value = ''; autosize(); $('ccWarn').hidden = true;
    submit({ requestId: uuid(), body: body, kind: kind, failed: false });
  }

  /* ── live updates ─────────────────────────────────────────── */
  function onLive() {
    clearTimeout(S.liveTimer);
    S.liveTimer = setTimeout(function () { if (!document.hidden) refreshAll(true); }, 600);
  }
  function startLive() {
    try {
      var c = sb();
      if (c && typeof c.channel === 'function') {
        S.live = c.channel('cc-live')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onLive)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coordinator_internal_notes' }, onLive)
          .subscribe();
      }
    } catch (e) { /* polling below still keeps the page current */ }
    S.timer = setInterval(function () { if (!document.hidden) refreshAll(true); }, POLL_MS);
  }

  /* ── wiring ───────────────────────────────────────────────── */
  function bind() {
    $('ccRefresh').addEventListener('click', function () { loadList(false).then(function () { if (S.activeId) reloadThread(false); }); });
    $('ccListRetry').addEventListener('click', function () { loadList(false); });
    $('ccSearch').addEventListener('input', function (e) { S.q = e.target.value; renderList(); });
    $('ccBack').addEventListener('click', function () { S.drafts[S.activeId + '|' + S.mode] = $('ccInput').value; S.activeId = null; S.seq++; showRoom(false); renderList(); closeSheet(); try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* ok */ } });
    $('ccModeCustomer').addEventListener('click', function () { setMode('customer'); });
    $('ccModeNote').addEventListener('click', function () { setMode('note'); });
    var ta = $('ccInput');
    ta.addEventListener('input', function () { autosize(); updateSend(); $('ccWarn').hidden = true; });
    ta.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); onSend(); }
    });
    $('ccSend').addEventListener('click', onSend);
    $('ccWarnEdit').addEventListener('click', function () { $('ccWarn').hidden = true; ta.focus(); });
    $('ccInfo').addEventListener('click', openSheet); $('ccStrip').addEventListener('click', openSheet);
    $('ccSheetClose').addEventListener('click', closeSheet); $('ccSheetBack').addEventListener('click', closeSheet); $('ccSheetBackdrop').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('ccSheet').hidden) closeSheet(); });
    $('ccJump').addEventListener('click', function () { var b = $('ccBody'); b.scrollTop = b.scrollHeight; $('ccJump').hidden = true; });
    $('ccBody').addEventListener('scroll', function () { var b = $('ccBody'); if (b.scrollHeight - b.scrollTop - b.clientHeight < 80) $('ccJump').hidden = true; });
    window.addEventListener('online', function () { S.online = true; setOffline(); refreshAll(true); });
    window.addEventListener('offline', function () { S.online = false; setOffline(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshAll(true); });
    setOffline();
  }

  async function init() {
    bind();
    var ok = await loadList(false);
    startLive();
    if (!ok) return;
    var want = new URLSearchParams(window.location.search).get('booking');
    if (want && C.isUuid(want)) openBooking(want);
  }

  document.addEventListener('coordinator:ready', init);
})();

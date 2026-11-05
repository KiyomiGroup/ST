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
   Job actions (Stage 6C): the composer's Actions button opens the coordinator's Request sheet. Each action is the SAME card, with the same checks and
     the same database function, as on coordinator-booking.html (js/coordinator-confirmation / -quote / -extras / -reduction / -milestones / -release /
     -exceptions / -closeout mount into the sheet). Reads and writes: local_booking_detail, local_booking_confirmations, local_booking_record_confirmation,
     local_booking_quote, local_booking_send_quote, local_booking_extras, local_booking_request_extra, local_booking_cancel_extra, local_booking_reduction,
     local_booking_request_reduction, local_booking_milestones, local_booking_record_milestone, local_booking_code_state, local_booking_submit_code,
     local_booking_exceptions, local_booking_record_exception, local_booking_closeout, local_booking_withdraw_problem, local_booking_step. This page adds
     no new database function and never touches a money table itself.
   Cards and side panels (Stage 6D-1): js/coordinator-cards.js draws the payment and request cards inside the conversation and the Payment history and
     Activity blocks of the right-hand column, read only. It uses coordinator_chat_cards and coordinator_chat_activity (new in stage-6d1-core.sql).
   Job actions for the Local Tasker (Stage 6D-4b): js/coordinator-jobactions.js adds "Send an update", "Propose a new time" and "Send proof of work" to the
     Actions sheet, and "Send update", "Send proof" and "Mark as done" to the customer's own pending asks. Database functions: coordinator_send_update,
     coordinator_propose_reschedule, coordinator_send_proof_file, coordinator_fulfil_request (stage-6d4a-core.sql, stage-6d4b-core.sql).
   Internal notes are drawn in their own block (lock, amber, "Not visible to the customer"), never as a bubble.
   Everything typed by a person is put on the page with textContent, never innerHTML. Runs on `coordinator:ready`.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  var POLL_MS = 20000;
  var MAX_LEN = 2000;
  var S = { rows: [], filter: 'all', q: '', activeId: null, thread: null, detail: null, taskerPhone: '', mode: 'customer', online: navigator.onLine !== false,
            sending: false, pending: null, drafts: {}, seq: 0, sig: '', timer: null, live: null, liveTimer: null,
            pane: null, mountChain: Promise.resolve() };

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

  function svgIcon(inner) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; }
  var ICONS = {
    phone: svgIcon('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'),
    tag: svgIcon('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
    tool: svgIcon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
    down: svgIcon('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
    pin: svgIcon('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
    check: svgIcon('<polyline points="20 6 9 17 4 12"/>'),
    flag: svgIcon('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'),
    chat: svgIcon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    clock: svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    photo: svgIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
    cancel: svgIcon('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>')
  };

  /* The coordinator's Actions sheet. `pane` is the card (id in coordinator-chat.html); it is available when its module has not hidden it. */
  var JOB = function () { return window.STCoJob; };
  var ACTIONS = [
    { pane: 'coUp', group: 'Tell the customer', icon: ICONS.chat,  label: 'Send an update',                   hint: 'On my way, arrived, finished, or a short note from the Local Tasker',
      avail: function () { return !!(JOB() && JOB().available('coUp')); }, why: function () { return JOB() ? JOB().why('coUp') : whyNot(); } },
    { pane: 'coRs', group: 'Tell the customer', icon: ICONS.clock, label: 'Propose a new time',               hint: 'The customer accepts or declines. The job keeps its time until they accept',
      avail: function () { return !!(JOB() && JOB().available('coRs')); }, why: function () { return JOB() ? JOB().why('coRs') : whyNot(); } },
    { pane: 'coPf', group: 'Tell the customer', icon: ICONS.photo, label: 'Send proof of work',               hint: 'Photos, video or files for the customer’s request',
      avail: function () { return !!(JOB() && JOB().available('coPf')); }, why: function () { return JOB() ? JOB().why('coPf') : whyNot(); } },
    { pane: 'coCf', group: 'Price and payment', icon: ICONS.phone,  label: 'Record the Local Tasker’s answer', hint: 'After you phone them: can they do it, and at what price' },
    { pane: 'coQt', group: 'Price and payment', icon: ICONS.tag,    label: 'Send or change the quote',         hint: 'Send the price to the customer to approve and pay' },
    { pane: 'coXt', group: 'Price and payment', icon: ICONS.tool,   label: 'Request an extra cost',            hint: 'More work, materials or transport. The customer can pay or decline' },
    { pane: 'coRd', group: 'Price and payment', icon: ICONS.down,   label: 'Lower the price',                  hint: 'The Local Tasker agreed to less: report it to support' },
    { pane: 'coMs', group: 'On the day',        icon: ICONS.pin,    label: 'Record progress',                  hint: 'Arrived, started or finished, as the Local Tasker told you' },
    { pane: 'coRl', group: 'On the day',        icon: ICONS.check,  label: 'Release the payment',              hint: 'Enter the customer’s release code' },
    { pane: 'coEx', group: 'Problems',          icon: ICONS.flag,   label: 'Write down something that went wrong', hint: 'Only a record. It changes nothing' },
    { pane: 'coCo', group: 'Problems',          icon: ICONS.cancel, label: 'Cancel or report a problem',       hint: 'Cancel the booking or open a report for support' }
  ];
  var CARD_MODULES = ['STCoConfirm', 'STCoQuote', 'STCoMilestones', 'STCoRelease', 'STCoExceptions', 'STCoCloseout', 'STCoExtras', 'STCoReduction', 'STCoJob'];

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
    renderBars();
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
    var fb = window.STCoCards ? window.STCoCards.fallbackText(m) : '';
    var text = fb || (pr ? 'Payment request sent to the customer: ₦' + Number(pr[1]).toLocaleString('en-NG') : (/^[A-Z_]{4,}:/.test(t) ? 'Job Room update' : t));
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
    var A = window.STCoAttach;
    if (A && A.isMedia(m)) { bb.appendChild(A.mediaFor(m)); bb.classList.add('cc-bubble-media'); }
    else bb.appendChild(el('span', 'msg-bubble-text', m.body || ''));
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
      var m = it.v, CO = window.STCoCards;
      if (CO && CO.isCardBody(m)) {
        var cd = CO.cardFor(m, m.kind !== 'customer');
        body.appendChild(cd || systemLine(m)); lastKey = ''; return;
      }
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
    renderBars();
    if (window.STCoAttach) window.STCoAttach.sync();
  }

  function updateSend() {
    var att = window.STCoAttach && window.STCoAttach.has(), has = att || $('ccInput').value.trim().length > 0;
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
    syncActionsBtn();
    $('ccHintText').textContent = note ? 'Only coordinators and administrators can see this. The customer never does.' : 'Visible to ' + firstName(r && r.customer_name) + '.';
    ta.placeholder = note ? 'Write an internal note…' : 'Write a message to ' + firstName(r && r.customer_name) + '…';
    $('ccInputLabel').textContent = note ? 'Internal note' : 'Message to the customer';
    $('ccSend').setAttribute('aria-label', note ? 'Save note' : 'Send message');
    ta.value = S.drafts[S.activeId + '|' + mode] || '';
    $('ccWarn').hidden = true; autosize(); updateSend();
    if (window.STCoAttach) window.STCoAttach.sync();
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

    if (window.STCoCards) {
      var hb = window.STCoCards.historyBlock(S.activeId); if (hb) box.appendChild(hb);
      var ab = window.STCoCards.activityBlock(S.activeId, renderContext); if (ab) box.appendChild(ab);
    }

    if (d) { var open = el('a', 'btn btn-outline btn-full', 'Open full booking'); open.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id); box.appendChild(open); }
  }
  function renderContext() { buildContext($('ccCtx')); if (!$('ccSheet').hidden) buildContext($('ccSheetBody')); }

  function openSheet() {
    buildContext($('ccSheetBody')); $('ccSheet').hidden = false; $('ccInfo').setAttribute('aria-expanded', 'true'); $('ccSheetClose').focus();
  }
  function closeSheet() { $('ccSheet').hidden = true; $('ccInfo').setAttribute('aria-expanded', 'false'); }


  /* ── Job actions (the Request sheet) ──────────────────────── */
  function syncActionsBtn() {
    var b = $('ccActionsBtn'); if (!b) return;
    b.hidden = !(canWrite() && S.mode !== 'note');
  }

  /* The slim "next step" row, the dot on the Actions button, and the problem bar */
  function renderBars() {
    var r = rowById(S.activeId), d = S.detail, can = canWrite();
    var nb = $('ccNextBar'), nx = d ? B.nextAction(d) : null;
    nb.hidden = !(can && nx);
    if (can && nx) { $('ccNextText').textContent = nx.text; nb.classList.toggle('is-action', nx.tab === 'action'); }
    $('ccActionsDot').hidden = !(can && nx && nx.tab === 'action');
    var frozen = !!((d && d.frozen) || (r && r.frozen));
    $('ccDisputeBar').hidden = !(S.activeId && frozen);
    $('ccDisputeBtn').hidden = !can;
    syncActionsBtn();
  }

  function paneAvailable(k) {
    var a = ACTIONS.filter(function (x) { return x.pane === k; })[0];
    if (a && a.avail) return a.avail();     /* the Stage 6D-4b forms are always in the page; the module says when they can be used */
    var c = $(k); return !!(c && !c.hidden);
  }
  function whyNot() {
    var d = S.detail;
    if (!d) return 'Loading the booking…';
    if (!d.open && !d.frozen) return 'This booking is closed';
    return 'Not available at this step';
  }

  function renderActionsMenu() {
    var box = $('ccActionsMenu'); box.textContent = '';
    var d = S.detail;
    if (!d) { box.appendChild(el('div', 'jr-sheet-empty', 'Loading the booking…')); return; }
    var nx = B.nextAction(d);
    box.appendChild(el('div', 'jr-sheet-group', 'Next step'));
    box.appendChild(el('p', 'cc-next' + (nx.tab === 'action' ? ' is-action' : ''), nx.text));
    var group = '';
    ACTIONS.forEach(function (a) {
      if (a.group !== group) { group = a.group; box.appendChild(el('div', 'jr-sheet-group', group)); }
      var ok = paneAvailable(a.pane);
      var b = el('button', 'jr-sheet-item'); b.type = 'button'; b.disabled = !ok;
      var ic = el('span', 'jr-sheet-item-icon'); ic.innerHTML = a.icon; b.appendChild(ic);
      var tx = el('span', 'jr-sheet-item-text');
      tx.appendChild(el('span', 'jr-sheet-item-label', a.label));
      tx.appendChild(el('span', 'jr-sheet-item-hint', ok ? a.hint : (a.why ? a.why() : whyNot())));
      b.appendChild(tx);
      b.addEventListener('click', function () { showPane(a.pane); });
      box.appendChild(b);
    });
  }

  function showMenu() {
    S.pane = null;
    $('ccActionsPanes').hidden = true; $('ccActionsMenu').hidden = false;
    $('ccActionsTitle').textContent = 'Job actions';
    renderActionsMenu();
    $('ccActionsBody').scrollTop = 0;
  }
  function showPane(k) {
    var a = ACTIONS.filter(function (x) { return x.pane === k; })[0]; if (!a) return;
    S.pane = k;
    Array.prototype.forEach.call($('ccActionsPanes').querySelectorAll('.cc-pane'), function (p) { p.hidden = p.getAttribute('data-pane') !== k; });
    $('ccActionsMenu').hidden = true; $('ccActionsPanes').hidden = false;
    $('ccActionsTitle').textContent = a.label;
    $('ccActionsBody').scrollTop = 0;
    if (JOB() && JOB().onShow) JOB().onShow(k);
  }
  function openActions(pane) {
    if (!canWrite() || !S.activeId) return;
    $('ccActions').hidden = false;
    if (pane && paneAvailable(pane)) showPane(pane); else showMenu();
    $('ccActionsClose').focus();
  }
  function closeActions() { $('ccActions').hidden = true; S.pane = null; }

  /* Mount the eight cards for this booking. One at a time, and only for the booking that is still open on screen. */
  function mountCards(d) {
    S.mountChain = S.mountChain.then(function () {
      if (!d || d.booking_id !== S.activeId) return null;
      var reload = reloadDetail;
      return Promise.all(CARD_MODULES.map(function (n) {
        try { return window[n] && window[n].mount ? window[n].mount(d, { reload: reload }) : null; } catch (e) { return null; }
      }));
    }).catch(function () { /* a card that fails shows its own message */ }).then(function () {
      if (!$('ccActions').hidden) {
        if (S.pane && !paneAvailable(S.pane)) showMenu();   // the step moved on, so that form is not needed any more
        else if (!S.pane) renderActionsMenu();
      }
    });
    return S.mountChain;
  }

  /* Called by a card after it has saved something: refresh the booking, the cards, the conversation and the inbox. */
  async function reloadDetail() {
    var id = S.activeId, seq = S.seq; if (!id) return;
    try {
      var res = await sb().rpc('local_booking_detail', { p_booking: id });
      if (seq !== S.seq) return;
      if (!res.error && res.data) S.detail = res.data;
    } catch (e) { /* the old details stay on screen */ }
    renderHead(); renderContext();
    await mountCards(S.detail);
    reloadThread(false); loadList(true);
  }

  /* ── open / reload a conversation ─────────────────────────── */
  function showRoom(on) {
    $('ccEmpty').hidden = on; $('ccHead').hidden = !on; $('ccStrip').hidden = !on;
    if (!on) { $('ccBody').hidden = true; $('ccComposer').hidden = true; $('ccReadonly').hidden = true; $('ccJump').hidden = true; $('ccNextBar').hidden = true; $('ccDisputeBar').hidden = true; }
    $('ccRoom').classList.toggle('open', on);
  }

  function signature(t) {
    var m = t.messages, n = t.notes;
    return [t.thread_id, t.access, t.total_messages, m.length ? m[m.length - 1].id : '', n.length ? n[n.length - 1].id : '', n.length, window.STCoCards ? window.STCoCards.sig() : ''].join('|');
  }

  async function fetchThread(id) {
    var res;
    try { res = await sb().rpc('coordinator_chat_thread', { p_booking: id, p_limit: 100 }); } catch (e) { res = { error: e }; }
    return res;
  }

  function cardsLoad(id) { return window.STCoCards ? window.STCoCards.load(id).catch(function () { return false; }) : Promise.resolve(false); }
  function sideLoad(id, seq) {
    if (!window.STCoCards) return;
    window.STCoCards.loadActivity(id).catch(function () { return false; }).then(function () { if (seq === S.seq && id === S.activeId) renderContext(); });
  }

  async function openBooking(id) {
    if (window.STCoAttach && S.activeId !== id) window.STCoAttach.clear();
    var r = rowById(id);
    if (!r) { missing(); return; }
    if (S.activeId) S.drafts[S.activeId + '|' + S.mode] = $('ccInput').value;
    var seq = ++S.seq;
    closeActions();
    S.activeId = id; S.thread = null; S.detail = null; S.taskerPhone = ''; S.pending = null; S.sig = '';
    try { var u = new URL(window.location.href); u.searchParams.set('booking', id); history.replaceState(null, '', u.pathname + u.search); } catch (e) { /* not essential */ }
    renderList(); showRoom(true); renderHead(); renderContext();
    var body = $('ccBody'); body.hidden = false; body.textContent = ''; body.appendChild(el('div', 'jr-thread-note', 'Loading the conversation…'));
    $('ccComposer').hidden = true; $('ccReadonly').hidden = true;
    var both = await Promise.all([fetchThread(id), cardsLoad(id)]), res = both[0];
    if (seq !== S.seq) return;
    if (res.error || !res.data) { threadError(id, hintOf(res.error) === 'not_found'); return; }
    S.thread = res.data; S.sig = signature(S.thread);
    renderTimeline('bottom'); renderComposer(); $('ccBody').scrollTop = $('ccBody').scrollHeight;
    if (S.thread.access === 'coordinator') loadContext(id, seq);
    sideLoad(id, seq);
    markRead(id);
  }

  function threadError(id, gone) {
    var body = $('ccBody'); body.hidden = false; body.textContent = '';
    var box = el('div', 'jr-thread-note jr-thread-note--error', gone ? 'This conversation is no longer available to you.' : 'Could not load the conversation. Check your connection and try again.');
    if (!gone) { var b = el('button', 'msg-retry-btn', 'Try again'); b.type = 'button'; b.addEventListener('click', function () { openBooking(id); }); box.appendChild(document.createElement('br')); box.appendChild(b); }
    body.appendChild(box);
  }

  function missing() {
    S.activeId = null; closeActions(); showRoom(false); renderList();
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
    if (S.detail) mountCards(S.detail);
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
    var seq = S.seq, both = await Promise.all([fetchThread(id), cardsLoad(id)]), res = both[0];
    if (seq !== S.seq || id !== S.activeId) return;
    if (res.error || !res.data) { if (!quiet) toast('Could not refresh the conversation.', true); return; }
    var sig = signature(res.data), changed = sig !== S.sig;
    S.thread = res.data; S.sig = sig;
    if (changed) { renderTimeline(quiet ? 'new' : 'bottom'); renderComposer(); sideLoad(id, seq); }
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
    if (window.STCoAttach && window.STCoAttach.has() && S.mode !== 'note') {
      if (S.sending || !canWrite()) return;
      if (!S.online) { toast('You are offline. Try again when you reconnect.', true); return; }
      $('ccWarn').hidden = true;
      window.STCoAttach.send(body).then(function (ok) { if (ok) { ta.value = ''; delete S.drafts[S.activeId + '|customer']; autosize(); } updateSend(); });
      return;
    }
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
    $('ccBack').addEventListener('click', function () { if (window.STCoAttach) window.STCoAttach.clear(); S.drafts[S.activeId + '|' + S.mode] = $('ccInput').value; S.activeId = null; S.seq++; closeActions(); showRoom(false); renderList(); closeSheet(); try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* ok */ } });
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
    $('ccActionsBtn').addEventListener('click', function () { openActions(); });
    $('ccNextBtn').addEventListener('click', function () { openActions(); });
    $('ccDisputeBtn').addEventListener('click', function () { openActions('coCo'); });
    $('ccActionsClose').addEventListener('click', closeActions); $('ccActionsBackdrop').addEventListener('click', closeActions);
    $('ccActionsBack').addEventListener('click', showMenu);
    $('ccSheetClose').addEventListener('click', closeSheet); $('ccSheetBack').addEventListener('click', closeSheet); $('ccSheetBackdrop').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('ccActions').hidden) closeActions(); else if (!$('ccSheet').hidden) closeSheet();
    });
    $('ccJump').addEventListener('click', function () { var b = $('ccBody'); b.scrollTop = b.scrollHeight; $('ccJump').hidden = true; });
    $('ccBody').addEventListener('scroll', function () { var b = $('ccBody'); if (b.scrollHeight - b.scrollTop - b.clientHeight < 80) $('ccJump').hidden = true; });
    window.addEventListener('online', function () { S.online = true; setOffline(); refreshAll(true); });
    window.addEventListener('offline', function () { S.online = false; setOffline(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshAll(true); });
    setOffline();
  }

  /* Small surface for js/coordinator-attach.js (Stage 6D-3). */
  window.STCoChat = {
    state: function () { return S; }, toast: toast, canWrite: canWrite, updateSend: updateSend,
    setSending: function (v) { S.sending = !!v; updateSend(); },
    showContactWarn: function () { $('ccWarn').hidden = false; },
    reloadThread: reloadThread, refreshAll: refreshAll, loadList: loadList,
    openActions: openActions, closeActions: closeActions,
    redraw: function () { if (S.thread) renderTimeline(); }
  };

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

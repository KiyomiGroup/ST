/* ============================================================
   STREETTASKER — messages-thread.js   (Job Room, step 4)
   Conversation area + composer.

   Public API (window.JRThread), used by messages.html:
     JRThread.bindComposer()             wire textarea / send button (call once)
     JRThread.open(ctx)                  load + render a thread's messages
                                         ctx: { thread, user, role, onChange }
     JRThread.append(message)            add one message (optimistic or realtime)
     JRThread.onRealtimeInsert(row)      realtime INSERT handler
     JRThread.send(text)                 send a text message (same path as the button)
     JRThread.toast(message, type)       small toast (type: 'error' for errors)

   Message kinds rendered today:
     text, payment_request, payment_confirmed, system.
   Anything else falls back to a text bubble. Image / file / location /
   structured request cards arrive in steps 5-8.

   SAFETY: messages that look like phone numbers, emails or off-platform
   links are NOT sent (terms of use). No "send anyway" option (spec 34/35).

   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var PAGE_SIZE = 200;               /* newest messages loaded per thread */
  var NEAR_BOTTOM_PX = 120;

  var S = {
    thread: null, user: null, role: 'customer', onChange: null,
    lastDay: null, sending: false, bound: false
  };

  /* Extra contact patterns on top of ST.messages.CONTACT_PATTERNS (js/messages.js):
     email addresses and phone numbers written with spaces / dots / dashes. */
  var EXTRA_CONTACT_PATTERNS = [
    /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i,
    /(\+?234|\b0)[\s.\-]?[789][01]?\d[\s.\-]?\d{3}[\s.\-]?\d{4}/
  ];

  /* ── helpers ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function naira(n) {
    return Number(n || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  }
  function timeLabel(iso) {
    return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  function dayKey(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }
  function dayLabel(iso) {
    var d = new Date(iso);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var that = new Date(d); that.setHours(0, 0, 0, 0);
    var diff = Math.round((today.getTime() - that.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function nearBottom(body) {
    return body.scrollHeight - body.scrollTop - body.clientHeight < NEAR_BOTTOM_PX;
  }
  function scrollToBottom(body) { body.scrollTop = body.scrollHeight; }

  function svg(inner, size) {
    var s = size || 16;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ICON_CARD  = svg('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>');
  var ICON_CHECK = svg('<polyline points="20 6 9 17 4 12"/>');
  var ICON_SPIN  = '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

  /* ── toast ───────────────────────────────────────────────── */
  function toast(message, type) {
    var host = $('jrToasts');
    if (!host) {
      host = el('div', 'jr-toasts');
      host.id = 'jrToasts';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    var t = el('div', 'jr-toast' + (type === 'error' ? ' jr-toast--error' : ''), message);
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add('is-leaving');
      setTimeout(function () { t.remove(); }, 350);
    }, 3500);
  }

  /* ── contact-sharing guard ───────────────────────────────── */
  function hasContactInfo(text) {
    var base = (window.ST && window.ST.messages && window.ST.messages.CONTACT_PATTERNS) || [];
    return base.concat(EXTRA_CONTACT_PATTERNS).some(function (re) { return re.test(text); });
  }
  function showWarn() { var w = $('jrComposeWarn'); if (w) w.hidden = false; }
  function hideWarn() { var w = $('jrComposeWarn'); if (w) w.hidden = true; }

  /* ── message builders ────────────────────────────────────── */
  function baseWrap(m, isMine) {
    var wrap = el('div', 'msg-bubble-wrap ' + (isMine ? 'mine' : 'theirs'));
    if (m.id) wrap.dataset.id = String(m.id);
    if (m._isTmp) wrap.dataset.tmp = '1';
    return wrap;
  }

  function buildText(m, isMine) {
    var wrap = baseWrap(m, isMine);
    var bubble = el('div', 'msg-bubble');
    bubble.appendChild(el('span', 'msg-bubble-text', m.body || ''));
    bubble.appendChild(el('span', 'msg-bubble-time', timeLabel(m.created_at)));
    wrap.appendChild(bubble);
    return wrap;
  }

  function buildSystem(m) {
    var row = el('div', 'jr-system');
    if (m.id) row.dataset.id = String(m.id);
    var chip = el('div', 'jr-system-chip');
    var icon = el('span', 'jr-system-icon');
    icon.innerHTML = ICON_CHECK;
    chip.appendChild(icon);
    chip.appendChild(document.createTextNode(m.body || ''));
    row.appendChild(chip);
    row.appendChild(el('div', 'jr-system-time', timeLabel(m.created_at)));
    return row;
  }

  /* Payment request card. Rebuilt with live states in step 6. */
  function buildPaymentRequest(m, isMine) {
    var parts  = (m.body || '').split(':');
    var amount = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
    var reqId  = m.payment_request_id || (parts[1] || '');
    var fmt    = amount > 0 ? naira(amount) : '—';

    var wrap = baseWrap(m, isMine);
    wrap.classList.add('is-card');

    var card = el('div', 'payment-request-card' + (isMine ? ' mine-card' : ''));
    card.id = 'prc-' + reqId;

    var head = el('div', 'prc-header');
    var icon = el('div', 'prc-icon'); icon.innerHTML = ICON_CARD;
    head.appendChild(icon);
    head.appendChild(el('span', 'prc-label', 'Payment request'));
    card.appendChild(head);
    card.appendChild(el('div', 'prc-amount', fmt));

    var notice = el('div', 'prc-notice');
    notice.appendChild(el('strong', null, 'Important: '));
    notice.appendChild(document.createTextNode('Only pay through StreetTasker. Payments made outside are '));
    notice.appendChild(el('strong', null, 'not eligible for refunds'));
    notice.appendChild(document.createTextNode(' and may result in account suspension.'));
    card.appendChild(notice);

    var actions = el('div', 'prc-actions');
    if (!isMine && S.role === 'customer') {
      var pay = el('button', 'prc-pay-btn', 'Pay ' + fmt + ' securely');
      pay.type = 'button';
      pay.addEventListener('click', function () {
        if (window.handleAcceptPayment) window.handleAcceptPayment(reqId, amount, S.thread ? S.thread.id : '');
      });
      actions.appendChild(pay);
    } else {
      actions.appendChild(el('span', 'prc-status-badge accepted', 'Awaiting customer payment'));
    }
    card.appendChild(actions);

    wrap.appendChild(card);
    wrap.appendChild(el('div', 'msg-time', timeLabel(m.created_at)));
    return wrap;
  }

  /* Payment confirmed card.
     SECURITY NOTE: the completion code is stored in the message body, so the
     tasker can read it from the database even though this card hides it.
     Move the code out of messages (bookings only, readable by the customer)
     in step 7. */
  function buildPaymentConfirmed(m, isMine) {
    var pts = (m.body || '').split(':');
    var code = isMine ? (pts[1] || '') : '';
    var total = parseInt(pts[2], 10) || 0;
    var earning = parseInt(pts[3], 10) || 0;
    var fee = parseInt(pts[4], 10) || 0;

    var wrap = baseWrap(m, isMine);
    wrap.classList.add('is-card');

    var card = el('div', 'jr-confirm');
    var head = el('div', 'jr-confirm-head');
    var icon = el('div', 'jr-confirm-icon'); icon.innerHTML = ICON_CHECK;
    head.appendChild(icon);
    head.appendChild(el('strong', 'jr-confirm-title', 'Payment confirmed'));
    card.appendChild(head);

    var sum = el('div', 'jr-confirm-text');
    sum.appendChild(el('strong', null, naira(total)));
    sum.appendChild(document.createTextNode(' held in escrow. Tasker earns '));
    sum.appendChild(el('strong', null, naira(earning)));
    sum.appendChild(document.createTextNode(' (' + naira(fee) + ' fee).'));
    card.appendChild(sum);

    if (code) {
      var box = el('div', 'jr-confirm-code');
      box.appendChild(el('div', 'jr-confirm-code-label', 'Your 6-digit code'));
      box.appendChild(el('div', 'jr-confirm-code-value', String(code)));
      box.appendChild(el('div', 'jr-confirm-code-hint', 'Give this to the tasker ONLY after the job is done'));
      card.appendChild(box);
    }
    card.appendChild(el('div', 'jr-confirm-steps', '1. Tasker completes the job · 2. You give them this code · 3. They enter it and payment is released'));

    wrap.appendChild(card);
    return wrap;
  }

  function buildMessage(m) {
    var isMine = m.sender_id === S.user.id;
    if (m.type === 'system') return buildSystem(m);
    if (m.type === 'payment_request') return buildPaymentRequest(m, isMine);
    if (m.type === 'payment_confirmed') return buildPaymentConfirmed(m, isMine);
    return buildText(m, isMine);
  }

  /* ── list rendering ──────────────────────────────────────── */
  function placeholder(body, html, cls) {
    body.textContent = '';
    var box = el('div', cls || 'jr-thread-note');
    box.innerHTML = html;       /* only constant markup / escaped text passed in */
    body.appendChild(box);
  }

  function addDivider(body, iso) {
    var k = dayKey(iso);
    if (k === S.lastDay) return;
    S.lastDay = k;
    body.appendChild(el('div', 'msg-date-divider', dayLabel(iso)));
  }

  function appendNode(m) {
    var body = $('chatBody');
    if (!body) return null;
    if (m.id && body.querySelector('[data-id="' + String(m.id).replace(/"/g, '') + '"]')) return null; /* already shown */
    var empty = body.querySelector('.jr-thread-note');
    if (empty) { empty.remove(); S.lastDay = null; }
    addDivider(body, m.created_at);
    var node = buildMessage(m);
    body.appendChild(node);
    return node;
  }

  function append(m) {
    var body = $('chatBody');
    if (!body) return null;
    var wasNear = nearBottom(body);
    var mine = S.user && m.sender_id === S.user.id;
    var node = appendNode(m);
    if (!node) return null;
    if (wasNear || mine) {
      scrollToBottom(body);
    } else {
      var j = $('jrJump'); if (j) j.hidden = false;
    }
    return node;
  }

  async function open(ctx) {
    S.thread = ctx.thread; S.user = ctx.user; S.role = ctx.role; S.onChange = ctx.onChange || null;
    S.lastDay = null;
    var token = ctx.thread.id;
    var body = $('chatBody');
    var input = $('msgInput');
    if (input) input.placeholder = S.role === 'tasker' ? 'Reply to customer…' : 'Type a message…';
    hideWarn();
    var jump = $('jrJump'); if (jump) jump.hidden = true;

    placeholder(body, ICON_SPIN + ' Loading…');
    try {
      var res = await window.supabase.from('messages')
        .select('id,sender_id,body,created_at,type,payment_request_id')
        .eq('thread_id', token)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (S.thread.id !== token) return;               /* user switched thread */
      if (res.error) throw res.error;
      var msgs = (res.data || []).slice().reverse();
      body.textContent = '';
      if (!msgs.length) {
        placeholder(body, 'No messages yet. Say hello! 👋');
        return;
      }
      if (msgs.length >= PAGE_SIZE) {
        body.appendChild(el('div', 'jr-thread-note', 'Showing the latest ' + PAGE_SIZE + ' messages.'));
      }
      msgs.forEach(function (m) {
        addDivider(body, m.created_at);
        body.appendChild(buildMessage(m));
      });
      scrollToBottom(body);
    } catch (e) {
      if (S.thread && S.thread.id !== token) return;
      body.textContent = '';
      var err = el('div', 'jr-thread-note jr-thread-note--error', 'Could not load messages: ' + ((e && e.message) || String(e)));
      body.appendChild(err);
    }
  }

  function onRealtimeInsert(row) {
    if (!row || !S.user) return;
    if (row.sender_id === S.user.id) {
      /* Own message already shown optimistically: stamp the real id on it */
      var body = $('chatBody');
      if (!body) return;
      var tmps = body.querySelectorAll('[data-tmp="1"]');
      if (tmps.length) {
        var node = tmps[0];
        node.dataset.id = String(row.id);
        delete node.dataset.tmp;
      } else {
        append(row);
      }
      return;
    }
    append(row);
  }

  /* ── sending ─────────────────────────────────────────────── */
  function receiverOf(t) {
    return S.user.id === t.customer_id ? t.tasker_id : t.customer_id;
  }

  async function deliver(text, node) {
    var sb = window.supabase;
    var t = S.thread;
    var receiverId = receiverOf(t);
    var now = new Date().toISOString();

    var ins = await sb.from('messages').insert({
      thread_id: t.id, sender_id: S.user.id, receiver_id: receiverId,
      body: text, flagged: false, type: 'text'
    }).select('id').maybeSingle();
    if (ins.error) throw ins.error;
    if (node && ins.data && ins.data.id) {
      node.dataset.id = String(ins.data.id);
      delete node.dataset.tmp;
    }

    var isCustomer = S.user.id === t.customer_id;
    var unreadCol = isCustomer ? 'tasker_unread' : 'customer_unread';
    var curUnread = isCustomer ? (t.tasker_unread || 0) : (t.customer_unread || 0);
    try {
      await sb.from('message_threads').update({
        last_message: text.slice(0, 80), last_message_at: now, [unreadCol]: curUnread + 1
      }).eq('id', t.id);
    } catch (_e) {}
    t.last_message = text; t.last_message_at = now;
    if (isCustomer) t.tasker_unread = curUnread + 1; else t.customer_unread = curUnread + 1;
    if (S.onChange) S.onChange();

    try {
      var meta = S.user.user_metadata || {};
      var senderName = meta.name || meta.email || 'Someone';
      await sb.from('notifications').insert({
        user_id: receiverId, type: 'new_message',
        title: '💬 New message from ' + senderName,
        message: text.length > 80 ? text.slice(0, 80) + '…' : text,
        data: { thread_id: t.id, sender_id: S.user.id }, is_read: false
      });
    } catch (_e2) {}
  }

  function markFailed(node, text) {
    if (!node) return;
    node.classList.add('is-failed');
    var btn = el('button', 'msg-failed', 'Not sent. Tap to retry');
    btn.type = 'button';
    btn.addEventListener('click', async function () {
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await deliver(text, node);
        node.classList.remove('is-failed');
        btn.remove();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Not sent. Tap to retry';
        toast('Send failed: ' + ((e && e.message) || String(e)), 'error');
      }
    });
    node.appendChild(btn);
    var body = $('chatBody');
    if (body) scrollToBottom(body);
  }

  /* Returns true when the text was accepted (input can be cleared). */
  async function send(text) {
    text = (text || '').trim();
    if (!text || !S.thread || !S.user || S.sending) return false;

    if (hasContactInfo(text)) {
      showWarn();
      if (typeof window.handleContactViolation === 'function') window.handleContactViolation(S.user.id);
      return false;
    }
    hideWarn();

    S.sending = true;
    var node = append({
      id: 'tmp-' + Date.now(), sender_id: S.user.id, body: text,
      created_at: new Date().toISOString(), type: 'text', _isTmp: true
    });
    try {
      await deliver(text, node);
    } catch (e) {
      markFailed(node, text);
      toast('Send failed: ' + ((e && e.message) || String(e)), 'error');
    } finally {
      S.sending = false;
    }
    return true;
  }

  /* ── composer wiring ─────────────────────────────────────── */
  function syncSendState() {
    var input = $('msgInput'), btn = $('msgSendBtn');
    if (btn && input) btn.disabled = !input.value.trim();
  }

  async function submitFromInput() {
    var input = $('msgInput');
    if (!input) return;
    var ok = await send(input.value);
    if (ok) { input.value = ''; input.style.height = 'auto'; syncSendState(); }
  }

  function bindComposer() {
    if (S.bound) return;
    S.bound = true;
    var input = $('msgInput'), btn = $('msgSendBtn'), edit = $('jrWarnEdit'), body = $('chatBody'), jump = $('jrJump');

    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitFromInput(); }
      });
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        syncSendState();
        var w = $('jrComposeWarn');
        if (w && !w.hidden && !hasContactInfo(input.value)) hideWarn();
      });
    }
    if (btn) btn.addEventListener('click', submitFromInput);
    if (edit) edit.addEventListener('click', function () { hideWarn(); if (input) input.focus(); });
    if (body && jump) {
      body.addEventListener('scroll', function () { if (nearBottom(body)) jump.hidden = true; });
      jump.addEventListener('click', function () { scrollToBottom(body); jump.hidden = true; });
    }
    syncSendState();
  }

  window.JRThread = {
    bindComposer: bindComposer,
    open: open,
    append: append,
    onRealtimeInsert: onRealtimeInsert,
    send: send,
    toast: toast
  };

})();

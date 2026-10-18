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
     JRThread.registerRequest(row)       remember a job_requests row (card state)
     JRThread.onRequestChange(row)       realtime INSERT/UPDATE of job_requests
     JRThread.pendingKinds()             kinds that still have a pending request (asks + money)
     JRThread.registerMoney(row) / onMoneyChange(row) / getMoney(id) / moneyRows()
                                         payment_requests rows for this thread (card state)
     JRThread.hasContactInfo(text)       same contact check the composer uses
     JRThread.focusComposer()

   Message kinds rendered today:
     text, payment_request (all money kinds), payment_confirmed, system, job_request,
     and (Stage 1, UI only) image, video, file, location, safety.
   Anything else falls back to a text bubble.

   Stage 1 types are NOT in the database yet: `messages.type` only allows
   text, system, payment_request, payment_confirmed, job_request. Their data
   shape is `message.meta`:
     image    { url, alt, caption }
     video    { url, poster, duration, caption }   (no url = poster only)
     file     { name, size, mime }
     location { label, address, lat, lng }
     safety   { title }  (text in body)
   Stage 9 adds the storage bucket and widens the type check. Until then the
   composer attach menu only shows a preview chip and sends nothing.

   Message priority (spec 33): normal (text, media), important (system, job
   request, safety), transactional (money cards, payment confirmed). The level
   is written to data-priority on every rendered message.

   JRThread.preview(m, isMine)           render one message without a thread (dev fixtures only)
   JRThread.previewSetup(role, userId)   set viewer role for the fixtures page

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
    lastDay: null, sending: false, bound: false,
    requests: {}, requestsFailed: false,
    money: {}, moneyFailed: false
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
  var ICON_CLIPBOARD = svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>');
  var ICON_FILE  = svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>', 20);
  var ICON_PIN   = svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 20);
  var ICON_PLAY  = svg('<polygon points="6 4 20 12 6 20 6 4"/>', 20);
  var ICON_IMAGE = svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>', 20);
  var ICON_SHIELD = svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', 20);
  var ICON_CLOSE = svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 14);
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

  /* ── media, file, location, safety (Stage 1, UI only) ─────── */
  /* Only http(s), blob and same-site relative paths are used as a src / href. */
  function safeUrl(u) {
    u = String(u || '');
    return /^(https?:\/\/|blob:|[\w][\w./-]*$)/i.test(u) ? u : '';
  }
  function fileSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n ? n + ' B' : '';
  }
  function mediaWrap(m, isMine) {
    var wrap = baseWrap(m, isMine);
    wrap.classList.add('is-card');
    return wrap;
  }
  function withTime(wrap, node, m) {
    wrap.appendChild(node);
    wrap.appendChild(el('div', 'msg-time', timeLabel(m.created_at)));
    return wrap;
  }
  function caption(box, text) {
    if (text) box.appendChild(el('div', 'jr-media-caption', text));
  }

  function buildImage(m, isMine) {
    var meta = m.meta || {};
    var box = el('div', 'jr-media');
    var url = safeUrl(meta.url);
    if (url) {
      var img = el('img', 'jr-media-img');
      img.src = url; img.alt = meta.alt || 'Photo'; img.loading = 'lazy';
      box.appendChild(img);
    } else {
      var ph = el('div', 'jr-media-ph'); ph.innerHTML = ICON_IMAGE;
      box.appendChild(ph);
    }
    caption(box, meta.caption || m.body);
    return withTime(mediaWrap(m, isMine), box, m);
  }

  function buildVideo(m, isMine) {
    var meta = m.meta || {};
    var box = el('div', 'jr-media jr-media--video');
    var url = safeUrl(meta.url), poster = safeUrl(meta.poster);
    if (url) {
      var v = el('video', 'jr-media-img');
      v.src = url; v.controls = true; v.preload = 'none';
      if (poster) v.poster = poster;
      box.appendChild(v);
    } else {
      var stage = el('div', 'jr-media-stage');
      if (poster) { var p = el('img', 'jr-media-img'); p.src = poster; p.alt = 'Video preview'; stage.appendChild(p); }
      var play = el('span', 'jr-media-play'); play.innerHTML = ICON_PLAY;
      stage.appendChild(play);
      if (meta.duration) stage.appendChild(el('span', 'jr-media-badge', meta.duration));
      box.appendChild(stage);
    }
    caption(box, meta.caption || m.body);
    return withTime(mediaWrap(m, isMine), box, m);
  }

  function buildFileMsg(m, isMine) {
    var meta = m.meta || {};
    var box = el('div', 'jr-file');
    var icon = el('div', 'jr-file-icon'); icon.innerHTML = ICON_FILE;
    var info = el('div', 'jr-file-info');
    info.appendChild(el('div', 'jr-file-name', meta.name || 'Document'));
    var sub = [String(meta.mime || '').split('/').pop().toUpperCase(), fileSize(meta.size)].filter(Boolean).join(' · ');
    if (sub) info.appendChild(el('div', 'jr-file-sub', sub));
    box.appendChild(icon); box.appendChild(info);
    return withTime(mediaWrap(m, isMine), box, m);
  }

  function buildLocation(m, isMine) {
    var meta = m.meta || {};
    var box = el('div', 'jr-loc');
    var pin = el('div', 'jr-loc-pin'); pin.innerHTML = ICON_PIN;
    var info = el('div', 'jr-file-info');
    info.appendChild(el('div', 'jr-file-name', meta.label || 'Shared location'));
    if (meta.address) info.appendChild(el('div', 'jr-file-sub', meta.address));
    box.appendChild(pin); box.appendChild(info);
    var lat = Number(meta.lat), lng = Number(meta.lng);
    if (isFinite(lat) && isFinite(lng) && meta.lat != null && meta.lng != null) {
      var a = el('a', 'jr-loc-link', 'Open in Maps');
      a.href = 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      box.appendChild(a);
    }
    return withTime(mediaWrap(m, isMine), box, m);
  }

  /* Platform notice inside the conversation (spec 34/35). Not a user bubble. */
  function buildSafety(m) {
    var row = el('div', 'jr-safety');
    if (m.id) row.dataset.id = String(m.id);
    row.setAttribute('role', 'note');
    var icon = el('span', 'jr-safety-icon'); icon.innerHTML = ICON_SHIELD;
    var text = el('div', 'jr-safety-text');
    text.appendChild(el('strong', null, (m.meta && m.meta.title) || 'Keep communication on StreetTasker'));
    text.appendChild(el('span', null, m.body || 'For your safety and protection, follow StreetTasker\u2019s communication policies and avoid sharing prohibited off-platform contact information.'));
    row.appendChild(icon); row.appendChild(text);
    return row;
  }

  /* ── money request card (step 6) ─────────────────────────── */
  /* No "approved" state: the customer pays or declines ANY kind (spec 11, 12, 21).
     States: pending -> processing -> paid (held in escrow -> released), or declined / cancelled.
     A payment attempt that fails shows 'failed' and the customer can pay again (Stage 7).
     Old rows may still say 'approved' (= pending) or 'accepted' (= processing): JRMoney.normStatus. */
  var MONEY_STATUS_LABEL = {
    pending: 'Payment requested', processing: 'Payment processing',
    paid: 'Paid', released: 'Released', declined: 'Declined', cancelled: 'Cancelled',
    failed: 'Payment failed', refunded: 'Refunded'
  };
  var ADDON_BREAKDOWN_LABEL = { work: 'Additional work', materials: 'Materials' };

  function moneyIdOf(m) {
    if (m.payment_request_id) return m.payment_request_id;
    var p = (m.body || '').split(':');
    return p[0] === 'PAYMENT_REQUEST' ? (p[1] || '') : '';
  }

  function fillMoney(wrap) {
    var m = wrap._msg, isMine = wrap._mine;
    var id = moneyIdOf(m);
    var req = S.money[id] || null;
    var J = window.JRMoney;
    var parts = (m.body || '').split(':');
    var amount = req ? Number(req.amount) : (parseInt(parts[2], 10) || 0);
    var kind = req ? (req.kind || 'payment') : 'payment';
    var addon = J ? J.isAddon(kind) : false;
    var status = req ? (J ? J.normStatus(req.status) : (req.status === 'approved' ? 'pending' : req.status === 'accepted' ? 'processing' : req.status)) : 'pending';
    /* paid -> held in escrow -> released: the server sets settlement (spec 12) */
    var released = status === 'paid' && !!req && req.settlement === 'released';
    var busy = !!(req && req._busy);
    var fmt = amount > 0 ? naira(amount) : '—';
    var isCustomer = S.role === 'customer';
    var title = (J && J.KINDS[kind]) ? J.KINDS[kind].title : 'Payment request';

    wrap.textContent = '';
    var card = el('div', 'payment-request-card jr-money jr-money--' + status + (isMine ? ' mine-card' : ''));
    card.id = 'prc-' + id;

    var head = el('div', 'prc-header');
    var icon = el('div', 'prc-icon'); icon.innerHTML = ICON_CARD;
    head.appendChild(icon);
    head.appendChild(el('span', 'prc-label', title));
    var pillKey = released ? 'released' : status;
    var pillText = MONEY_STATUS_LABEL[pillKey] || status;
    if (req) head.appendChild(el('span', 'jr-req-pill jr-req-pill--' + pillKey, pillText));
    card.appendChild(head);

    card.appendChild(el('div', 'prc-amount', fmt));

    if (req && req.reason) card.appendChild(el('div', 'jr-req-note', req.reason));

    var bd = req && req.breakdown;
    if (bd && typeof bd === 'object') {
      var lines = Object.keys(bd).filter(function (k) { return Number(bd[k]) > 0 && ADDON_BREAKDOWN_LABEL[k]; });
      if (lines.length) {
        var list = el('div', 'jr-money-lines');
        lines.forEach(function (k) {
          var row = el('div', 'jr-money-line');
          row.appendChild(el('span', null, ADDON_BREAKDOWN_LABEL[k]));
          row.appendChild(el('span', null, naira(bd[k])));
          list.appendChild(row);
        });
        card.appendChild(list);
      }
    }

    var actions = el('div', 'prc-actions');
    var payable = !!req && !busy && isCustomer && (status === 'pending' || status === 'processing' || status === 'failed');
    function button(label, cls, fn) {
      var b = el('button', cls, label); b.type = 'button'; b.disabled = busy;
      b.addEventListener('click', fn);
      return b;
    }

    if (!req) {
      /* Request row not loaded (older cards / no access): keep the old behaviour */
      if (isCustomer && !isMine) actions.appendChild(button('Pay ' + fmt, 'prc-pay-btn', function () { if (J) J.pay(id); }));
      else actions.appendChild(el('span', 'prc-status-badge accepted', 'Awaiting customer payment'));
    } else if (payable) {
      /* Every kind, pending or retrying a payment that did not finish:
         Pay / Decline Request / Ask a Question (nothing else, no approve step) */
      actions.classList.add('is-stack');
      var row1 = el('div', 'prc-actions');
      row1.appendChild(button('Pay ' + fmt, 'prc-pay-btn', function () { J.pay(id); }));
      row1.appendChild(button('Decline Request', 'jr-req-btn', function () { J.respond(id, 'declined'); }));
      actions.appendChild(row1);
      actions.appendChild(button('Ask a Question', 'jr-req-btn', focusComposer));
    } else if (busy) {
      actions.appendChild(el('span', 'prc-status-badge accepted', 'Opening payment…'));
    } else if (!isCustomer && (status === 'pending' || status === 'failed')) {
      actions.appendChild(button('Cancel request', 'jr-req-btn', function () { J.respond(id, 'cancelled'); }));
    } else if (!isCustomer && status === 'processing') {
      actions.appendChild(el('span', 'prc-status-badge accepted', 'Customer is paying'));
    } else if (status === 'paid') {
      actions.appendChild(el('span', 'prc-status-badge paid',
        released ? (isCustomer ? '✓ Paid. Released to the Tasker' : '✓ Paid. Released to your wallet')
                 : '✓ Paid. Funds in escrow'));
    } else if (status === 'declined' && J && J.canRevise(req)) {
      /* spec 20: a revised request, the declined one stays in the history */
      actions.appendChild(button('Send Revised Request', 'jr-req-btn', function () {
        if (window.JRRequests && window.JRRequests.openRevise) window.JRRequests.openRevise(req);
      }));
    }
    if (actions.childNodes.length) card.appendChild(actions);

    if (req && status === 'processing' && isCustomer) {
      card.appendChild(el('div', 'jr-req-note', 'A payment was started but not confirmed yet. If you already paid, it will show here shortly.'));
    }
    if (req && status === 'failed' && isCustomer) {
      card.appendChild(el('div', 'jr-req-note', 'The payment did not go through and you have not been charged. You can try again.'));
    }
    if (req && req.revises_id) {
      card.appendChild(el('div', 'jr-req-note', 'Revised request. The earlier one was declined and is kept in the history.'));
    }

    if (req && (status === 'pending' || status === 'processing' || status === 'failed') && isCustomer) {
      var notice = el('div', 'prc-notice');
      notice.appendChild(el('strong', null, 'Important: '));
      notice.appendChild(document.createTextNode('Only pay through StreetTasker. Payments made outside are '));
      notice.appendChild(el('strong', null, 'not eligible for refunds'));
      notice.appendChild(document.createTextNode(' and may result in account suspension.'));
      card.appendChild(notice);
    }

    wrap.appendChild(card);
    wrap.appendChild(el('div', 'msg-time', timeLabel(m.created_at)));
  }

  function buildPaymentRequest(m, isMine) {
    var wrap = baseWrap(m, isMine);
    wrap.classList.add('is-card');
    wrap.dataset.moneyId = String(moneyIdOf(m));
    wrap._msg = m; wrap._mine = isMine;
    fillMoney(wrap);
    return wrap;
  }

  function repaintMoney(id) {
    var body = $('chatBody');
    if (!body) return;
    var nodes = body.querySelectorAll('[data-money-id="' + String(id).replace(/"/g, '') + '"]');
    for (var i = 0; i < nodes.length; i++) fillMoney(nodes[i]);
    if (window.JRRequests && window.JRRequests.update) window.JRRequests.update();
    if (window.JRDetails && window.JRDetails.update) window.JRDetails.update();
  }

  async function loadMoney(threadId) {
    S.money = {}; S.moneyFailed = false;
    try {
      var r = await window.supabase.from('payment_requests').select('*').eq('thread_id', threadId).limit(200);
      if (r.error) throw r.error;
      (r.data || []).forEach(function (row) { S.money[row.id] = row; });
    } catch (_e) { S.moneyFailed = true; }
  }

  async function ensureMoney(m) {
    var id = moneyIdOf(m);
    if (!id || S.money[id]) return;
    try {
      var r = await window.supabase.from('payment_requests').select('*').eq('id', id).maybeSingle();
      if (r.data) { S.money[id] = r.data; repaintMoney(id); }
    } catch (_e) {}
  }

  function registerMoney(row) { if (row && row.id) S.money[row.id] = row; }
  function onMoneyChange(row) {
    if (!row || !row.id) return;
    var merged = Object.assign({}, S.money[row.id] || {}, row);
    if (!('_busy' in row)) delete merged._busy;       /* busy only lasts while the caller says so */
    S.money[row.id] = merged;
    repaintMoney(row.id);
  }
  function getMoney(id) { return S.money[id] || null; }
  function moneyRows() { return Object.keys(S.money).map(function (k) { return S.money[k]; }); }

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

  /* ── job request card (step 5) ───────────────────────────── */
  var REQ_STATUS_LABEL = { pending: 'Pending', fulfilled: 'Done', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' };

  function requestIdOf(m) {
    if (m.job_request_id) return m.job_request_id;
    var p = (m.body || '').split(':');
    return p[0] === 'JOB_REQUEST' ? (p[1] || '') : '';
  }
  function requestKindOf(m, req) {
    if (req && req.kind) return req.kind;
    var p = (m.body || '').split(':');
    return p[0] === 'JOB_REQUEST' ? (p[2] || '') : '';
  }
  function kindMeta(kind) {
    var K = (window.JRRequests && window.JRRequests.KINDS) || {};
    return K[kind] || { title: 'Request', byOther: 'sent you a request.', byMe: 'You sent a request.' };
  }

  async function respondToRequest(id, status) {
    var req = S.requests[id];
    if (!req) return;
    try {
      var r = await window.supabase.from('job_requests').update({ status: status }).eq('id', id).select().maybeSingle();
      if (r.error) throw r.error;
      var row = (r.data) || Object.assign({}, req, { status: status });
      S.requests[id] = Object.assign({}, req, row);
      repaintRequest(id);
    } catch (e) {
      toast((e && e.message) || 'Could not update the request', 'error');
    }
  }

  function fillRequest(wrap) {
    var m = wrap._msg, isMine = wrap._mine;
    var id = requestIdOf(m);
    var req = S.requests[id] || null;
    var kind = requestKindOf(m, req);
    var meta = kindMeta(kind);
    var status = req ? req.status : 'pending';

    wrap.textContent = '';
    var card = el('div', 'jr-req jr-req--' + status + (isMine ? ' is-mine' : ''));

    var head = el('div', 'jr-req-head');
    var icon = el('div', 'jr-req-icon'); icon.innerHTML = ICON_CLIPBOARD;
    head.appendChild(icon);
    head.appendChild(el('span', 'jr-req-title', meta.title));
    if (req) head.appendChild(el('span', 'jr-req-pill jr-req-pill--' + status, REQ_STATUS_LABEL[status] || status));
    card.appendChild(head);

    card.appendChild(el('div', 'jr-req-text', isMine ? meta.byMe : meta.byOther));
    if (req && req.note) {
      var note = el('div', 'jr-req-note', req.note);
      card.appendChild(note);
    }

    if (req && status === 'pending') {
      var actions = el('div', 'jr-req-actions');
      if (req.requested_by !== S.user.id) {
        var reply = el('button', 'jr-req-btn', 'Reply'); reply.type = 'button';
        reply.addEventListener('click', focusComposer);
        var done = el('button', 'jr-req-btn jr-req-btn--primary', 'Mark as done'); done.type = 'button';
        done.addEventListener('click', function () { done.disabled = true; respondToRequest(id, 'fulfilled'); });
        actions.appendChild(reply); actions.appendChild(done);
      } else {
        var cancel = el('button', 'jr-req-btn', 'Cancel request'); cancel.type = 'button';
        cancel.addEventListener('click', function () { cancel.disabled = true; respondToRequest(id, 'cancelled'); });
        actions.appendChild(cancel);
      }
      card.appendChild(actions);
    }

    wrap.appendChild(card);
    wrap.appendChild(el('div', 'msg-time', timeLabel(m.created_at)));
  }

  function buildJobRequest(m, isMine) {
    var wrap = baseWrap(m, isMine);
    wrap.classList.add('is-card');
    wrap.dataset.reqId = String(requestIdOf(m));
    wrap._msg = m; wrap._mine = isMine;
    fillRequest(wrap);
    return wrap;
  }

  function repaintRequest(id) {
    var body = $('chatBody');
    if (!body) return;
    var nodes = body.querySelectorAll('[data-req-id="' + String(id).replace(/"/g, '') + '"]');
    for (var i = 0; i < nodes.length; i++) fillRequest(nodes[i]);
    if (window.JRRequests && window.JRRequests.update) window.JRRequests.update();
  }

  async function loadRequests(msgs) {
    S.requests = {}; S.requestsFailed = false;
    var ids = [];
    msgs.forEach(function (m) {
      if (m.type !== 'job_request') return;
      var id = requestIdOf(m);
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    if (!ids.length) return;
    try {
      var r = await window.supabase.from('job_requests').select('*').in('id', ids);
      if (r.error) throw r.error;
      (r.data || []).forEach(function (row) { S.requests[row.id] = row; });
    } catch (_e) { S.requestsFailed = true; }
  }

  /* A request message arrived live: its job_requests row may not be loaded yet */
  async function ensureRequest(m) {
    var id = requestIdOf(m);
    if (!id || S.requests[id]) return;
    try {
      var r = await window.supabase.from('job_requests').select('*').eq('id', id).maybeSingle();
      if (r.data) { S.requests[id] = r.data; repaintRequest(id); }
    } catch (_e) {}
  }

  function registerRequest(row) { if (row && row.id) S.requests[row.id] = row; }

  function onRequestChange(row) {
    if (!row || !row.id) return;
    S.requests[row.id] = Object.assign({}, S.requests[row.id] || {}, row);
    repaintRequest(row.id);
  }

  function pendingKinds() {
    var kinds = Object.keys(S.requests)
      .filter(function (k) { return S.requests[k].status === 'pending'; })
      .map(function (k) { return S.requests[k].kind; });
    Object.keys(S.money).forEach(function (k) {
      var r = S.money[k];
      if (r.status === 'pending') kinds.push(r.kind || 'payment');
    });
    return kinds;
  }

  function focusComposer() { var i = $('msgInput'); if (i) i.focus(); }

  /* Message priority (spec 33): how much visual weight a message gets. */
  var PRIORITY = {
    text: 'normal', image: 'normal', video: 'normal', file: 'normal', location: 'normal',
    system: 'important', job_request: 'important', safety: 'important',
    payment_request: 'transactional', payment_confirmed: 'transactional'
  };

  function buildMessage(m) {
    var isMine = !!(S.user && m.sender_id === S.user.id);
    var node;
    if (m.type === 'system') node = buildSystem(m);
    else if (m.type === 'safety') node = buildSafety(m);
    else if (m.type === 'payment_request') node = buildPaymentRequest(m, isMine);
    else if (m.type === 'payment_confirmed') node = buildPaymentConfirmed(m, isMine);
    else if (m.type === 'job_request') node = buildJobRequest(m, isMine);
    else if (m.type === 'image') node = buildImage(m, isMine);
    else if (m.type === 'video') node = buildVideo(m, isMine);
    else if (m.type === 'file') node = buildFileMsg(m, isMine);
    else if (m.type === 'location') node = buildLocation(m, isMine);
    else node = buildText(m, isMine);
    node.dataset.priority = PRIORITY[m.type] || 'normal';
    return node;
  }

  /* Dev fixtures only (messages-fixtures.html): render without a thread. */
  function previewSetup(role, userId) {
    S.role = role === 'tasker' ? 'tasker' : 'customer';
    S.user = { id: userId || 'me' };
  }
  function preview(m, isMine) {
    if (!S.user) previewSetup('customer', 'me');
    var copy = Object.assign({}, m, { sender_id: isMine ? S.user.id : 'them' });
    return buildMessage(copy);
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
    if (m.type === 'job_request') ensureRequest(m);
    if (m.type === 'payment_request') ensureMoney(m);
    if (wasNear || mine) {
      scrollToBottom(body);
    } else {
      var j = $('jrJump'); if (j) j.hidden = false;
    }
    return node;
  }

  function fetchMessages(threadId, cols) {
    return window.supabase.from('messages').select(cols)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
  }

  async function open(ctx) {
    S.thread = ctx.thread; S.user = ctx.user; S.role = ctx.role; S.onChange = ctx.onChange || null;
    S.lastDay = null; S.requests = {}; S.requestsFailed = false; S.money = {}; S.moneyFailed = false;
    var token = ctx.thread.id;
    var body = $('chatBody');
    var input = $('msgInput');
    if (input) input.placeholder = S.role === 'tasker' ? 'Reply to customer…' : 'Type a message…';
    hideWarn();
    clearAttach();
    var jump = $('jrJump'); if (jump) jump.hidden = true;

    placeholder(body, ICON_SPIN + ' Loading…');
    try {
      var cols = 'id,sender_id,body,created_at,type,payment_request_id,job_request_id';
      var res = await fetchMessages(token, cols);
      if (res.error && /job_request_id/.test(String(res.error.message || ''))) {
        /* Step 5 SQL not run yet: load without the new column */
        res = await fetchMessages(token, 'id,sender_id,body,created_at,type,payment_request_id');
      }
      if (S.thread.id !== token) return;               /* user switched thread */
      if (res.error) throw res.error;
      var msgs = (res.data || []).slice().reverse();
      await Promise.all([loadRequests(msgs), loadMoney(token)]);
      if (S.thread.id !== token) return;
      if (window.JRDetails) window.JRDetails.update();      /* money rows are in: figures can be drawn */
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

  /* ── attachment preview chip (Stage 1: UI only) ──────────── */
  /* Picking a photo, camera shot, file or location only shows a chip.
     Nothing is uploaded and nothing is sent until Stage 9 (storage bucket,
     message types). While a chip is showing, Send is off so no one thinks
     the attachment went out. */
  var ATTACH_LABEL = { photo: 'Photo', camera: 'Camera photo', file: 'File', location: 'Location' };

  function clearAttach() {
    if (S.attach && S.attach.url) { try { URL.revokeObjectURL(S.attach.url); } catch (_e) {} }
    S.attach = null;
    var box = $('jrAttachPreview');
    if (box) { box.textContent = ''; box.hidden = true; }
    syncSendState();
  }

  function showAttach(kind, file) {
    clearAttach();
    var a = { kind: kind, name: file ? file.name : 'Current location', size: file ? file.size : 0, url: '', isImage: false };
    if (file && /^image\//.test(file.type)) { a.isImage = true; a.url = URL.createObjectURL(file); }
    S.attach = a;

    var box = $('jrAttachPreview');
    if (!box) return;
    box.textContent = '';
    var chip = el('div', 'jr-attach-chip');
    var thumb = el('div', 'jr-attach-thumb');
    if (a.isImage) {
      var img = el('img', 'jr-attach-img'); img.src = a.url; img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = kind === 'location' ? ICON_PIN : (kind === 'photo' || kind === 'camera') ? ICON_IMAGE : ICON_FILE;
    }
    var info = el('div', 'jr-attach-info');
    info.appendChild(el('div', 'jr-attach-name', a.name));
    var sub = [ATTACH_LABEL[kind], fileSize(a.size)].filter(Boolean).join(' · ');
    info.appendChild(el('div', 'jr-attach-sub', sub));
    info.appendChild(el('div', 'jr-attach-note', 'Preview only. Sending attachments is not connected yet. Remove it to send a message.'));
    var rm = el('button', 'jr-icon-btn jr-attach-remove'); rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove attachment'); rm.innerHTML = ICON_CLOSE;
    rm.addEventListener('click', clearAttach);
    chip.appendChild(thumb); chip.appendChild(info); chip.appendChild(rm);
    box.appendChild(chip);
    box.hidden = false;
    syncSendState();
  }

  function pickAttach(kind) {
    if (kind === 'location') { showAttach('location', null); return; }
    var id = kind === 'photo' ? 'attachPhotoInput' : kind === 'camera' ? 'attachCameraInput' : 'attachFileInput';
    var input = $(id);
    if (!input) return;
    input.value = '';
    input.click();
  }

  function bindAttach() {
    var btn = $('attachBtn'), menu = $('attachMenu'), cam = $('cameraBtn');
    function closeMenu() { if (menu) menu.hidden = true; if (btn) btn.setAttribute('aria-expanded', 'false'); }
    if (btn && menu) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      menu.addEventListener('click', function (e) {
        var item = e.target.closest ? e.target.closest('[data-attach]') : null;
        if (!item) return;
        closeMenu();
        pickAttach(item.getAttribute('data-attach'));
      });
      document.addEventListener('click', closeMenu);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    }
    if (cam) cam.addEventListener('click', function () { pickAttach('camera'); });
    [['attachPhotoInput', 'photo'], ['attachCameraInput', 'camera'], ['attachFileInput', 'file']].forEach(function (p) {
      var input = $(p[0]);
      if (!input) return;
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) showAttach(p[1], input.files[0]);
      });
    });
  }

  /* ── composer wiring ─────────────────────────────────────── */
  function syncSendState() {
    var input = $('msgInput'), btn = $('msgSendBtn');
    if (btn && input) btn.disabled = !input.value.trim() || !!S.attach;
  }

  async function submitFromInput() {
    var input = $('msgInput');
    if (!input || S.attach) return;
    var ok = await send(input.value);
    if (ok) { input.value = ''; input.style.height = 'auto'; syncSendState(); }
  }

  function bindComposer() {
    if (S.bound) return;
    S.bound = true;
    var input = $('msgInput'), btn = $('msgSendBtn'), edit = $('jrWarnEdit'), body = $('chatBody'), jump = $('jrJump');
    bindAttach();

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
    toast: toast,
    registerRequest: registerRequest,
    onRequestChange: onRequestChange,
    pendingKinds: pendingKinds,
    hasContactInfo: hasContactInfo,
    focusComposer: focusComposer,
    preview: preview,
    previewSetup: previewSetup,
    registerMoney: registerMoney,
    onMoneyChange: onMoneyChange,
    getMoney: getMoney,
    moneyRows: moneyRows
  };

})();

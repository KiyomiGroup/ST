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

   Stage 9: image, video, file and location are real message types. A row
   carries `payload` (jsonb); withMeta() turns it into `message.meta`. Files
   live in the PRIVATE bucket `job-evidence` and are shown through short-lived
   signed URLs (never stored in the row). Meta shape:
     image    { path | url, alt, caption }
     video    { path | url, poster, duration, caption }   (no url = poster only)
     file     { path, name, size, mime }
     location { label, address, lat, lng }
     safety   { title }  (text in body)
   The composer attach menu uploads first, then writes the attachment row and
   the message row; nothing shows as sent until both succeeded.

   Stage 10: files support removed (table evidence_removals) show as "This file was removed by support".

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
    roomClosed: false,               /* stage M5: the job room is closed or not allowed: history only, no sending */
    requests: {}, requestsFailed: false,
    money: {}, moneyFailed: false,
    removed: {}                      /* storage paths support removed (Stage 10) */
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
  /* ── Stage 9: private evidence files ───────────────────── */
  var EVID_BUCKET = 'job-evidence';
  var SIGN_TTL = 3600;                       /* seconds */
  var MB = 1048576;
  var LIMITS = { photo: 10 * MB, video: 50 * MB, file: 10 * MB, receipt: 10 * MB };
  var FILE_MIME = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv'
  };
  var VIDEO_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
  var signedCache = {};

  /* Short-lived signed URL, cached in memory for this page only. */
  function signedUrl(path, force) {
    var c = signedCache[path];
    if (c && !force && c.exp > Date.now()) return c.p;
    if (!window.supabase || !path) return Promise.resolve('');
    var p = window.supabase.storage.from(EVID_BUCKET).createSignedUrl(path, SIGN_TTL)
      .then(function (r) {
        if (r.error || !r.data) { delete signedCache[path]; return ''; }
        return r.data.signedUrl || '';
      })
      .catch(function () { delete signedCache[path]; return ''; });
    signedCache[path] = { p: p, exp: Date.now() + (SIGN_TTL - 600) * 1000 };
    return p;
  }

  /* Fill node[prop] with a signed URL; one retry if the file fails to load (expired link). */
  function hydrate(node, prop, path) {
    signedUrl(path).then(function (u) {
      if (u) node[prop] = u; else node.setAttribute('data-unavailable', '1');
    });
    if (prop === 'src') {
      var retried = false;
      node.addEventListener('error', function () {
        if (retried) return;
        retried = true;
        signedUrl(path, true).then(function (u) { if (u) node.src = u; });
      });
    } else {
      node.addEventListener('pointerdown', function () {
        signedUrl(path).then(function (u) { if (u) node[prop] = u; });
      });
    }
  }

  /* Database rows carry `payload`; the renderers read `meta`. */
  function withMeta(m) {
    if (!m || m.meta || !m.payload || typeof m.payload !== 'object') return m;
    var p = m.payload;
    return Object.assign({}, m, { meta: {
      path: p.path || '', name: p.name, size: p.size, mime: p.mime,
      caption: p.caption || '', label: p.label, address: p.address,
      lat: p.lat, lng: p.lng, duration: p.duration
    } });
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

  /* Stage 10: a file support removed stays in the chat as a quiet notice, never a broken image. */
  function buildRemoved(m, isMine) {
    var box = el('div', 'jr-file jr-file--removed');
    var icon = el('div', 'jr-file-icon'); icon.innerHTML = ICON_FILE;
    var info = el('div', 'jr-file-info');
    info.appendChild(el('div', 'jr-file-name', 'This file was removed by support'));
    box.appendChild(icon); box.appendChild(info);
    return withTime(mediaWrap(m, isMine), box, m);
  }
  function isRemoved(meta) { return !!(meta && meta.path && S.removed[meta.path]); }

  function buildImage(m, isMine) {
    var meta = m.meta || {};
    if (isRemoved(meta)) return buildRemoved(m, isMine);
    var box = el('div', 'jr-media');
    var url = safeUrl(meta.url);
    if (meta.path) {
      var pimg = el('img', 'jr-media-img');
      pimg.alt = meta.alt || 'Photo'; pimg.loading = 'lazy';
      box.appendChild(pimg);
      hydrate(pimg, 'src', meta.path);
    } else if (url) {
      var img = el('img', 'jr-media-img');
      img.src = url; img.alt = meta.alt || 'Photo'; img.loading = 'lazy';
      box.appendChild(img);
    } else {
      var ph = el('div', 'jr-media-ph'); ph.innerHTML = ICON_IMAGE;
      box.appendChild(ph);
    }
    caption(box, meta.path ? meta.caption : (meta.caption || m.body));
    return withTime(mediaWrap(m, isMine), box, m);
  }

  function buildVideo(m, isMine) {
    var meta = m.meta || {};
    if (isRemoved(meta)) return buildRemoved(m, isMine);
    var box = el('div', 'jr-media jr-media--video');
    var url = safeUrl(meta.url), poster = safeUrl(meta.poster);
    if (meta.path) {
      var pv = el('video', 'jr-media-img');
      pv.controls = true; pv.preload = 'metadata';
      box.appendChild(pv);
      hydrate(pv, 'src', meta.path);
    } else if (url) {
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
    caption(box, meta.path ? meta.caption : (meta.caption || m.body));
    return withTime(mediaWrap(m, isMine), box, m);
  }

  function buildFileMsg(m, isMine) {
    var meta = m.meta || {};
    if (isRemoved(meta)) return buildRemoved(m, isMine);
    var box = el('div', 'jr-file');
    var icon = el('div', 'jr-file-icon'); icon.innerHTML = ICON_FILE;
    var info = el('div', 'jr-file-info');
    info.appendChild(el('div', 'jr-file-name', meta.name || 'Document'));
    var sub = [String(meta.mime || '').split('/').pop().toUpperCase(), fileSize(meta.size)].filter(Boolean).join(' · ');
    if (sub) info.appendChild(el('div', 'jr-file-sub', sub));
    box.appendChild(icon); box.appendChild(info);
    if (meta.path) {
      var open = el('a', 'jr-loc-link', 'Open');
      open.target = '_blank'; open.rel = 'noopener noreferrer';
      box.appendChild(open);
      hydrate(open, 'href', meta.path);
    }
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
    if (kind === 'invoice' && pillKey === 'pending') pillText = 'Awaiting payment';
    if (req) head.appendChild(el('span', 'jr-req-pill jr-req-pill--' + pillKey, pillText));
    card.appendChild(head);

    card.appendChild(el('div', 'prc-amount', fmt));

    /* Invoice (Stage 8): title, number and due date. "Overdue" is display only: nothing is written. */
    if (kind === 'invoice' && req) {
      if (req.title) card.appendChild(el('div', 'jr-inv-title', req.title));
      var metaBits = [];
      if (req.invoice_number) metaBits.push(req.invoice_number);
      if (req.due_date) {
        var dd = new Date(String(req.due_date).slice(0, 10) + 'T00:00:00');
        if (!isNaN(dd)) metaBits.push('Due ' + dd.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }));
      }
      if (metaBits.length || (J && J.isOverdue(req))) {
        var meta = el('div', 'jr-inv-meta', metaBits.join(' · '));
        if (J && J.isOverdue(req)) meta.appendChild(el('span', 'jr-req-pill jr-req-pill--overdue', 'Overdue'));
        card.appendChild(meta);
      }
    }

    if (req && req.reason) card.appendChild(el('div', 'jr-req-note', req.reason));

    /* breakdown is a JSON ARRAY of lines [{ label, amount }] (the table requires it); an old
       {work: n, materials: n} object is still shown if one exists */
    var bd = req && req.breakdown;
    var lines = [];
    if (Array.isArray(bd)) {
      lines = bd.filter(function (l) { return l && Number(l.amount) > 0 && l.label; })
                .map(function (l) { return { label: String(l.label), amount: Number(l.amount) }; });
    } else if (bd && typeof bd === 'object') {
      lines = Object.keys(bd).filter(function (k) { return Number(bd[k]) > 0 && ADDON_BREAKDOWN_LABEL[k]; })
                .map(function (k) { return { label: ADDON_BREAKDOWN_LABEL[k], amount: Number(bd[k]) }; });
    }
    if (lines.length) {
      var list = el('div', 'jr-money-lines');
      lines.forEach(function (l) {
        var row = el('div', 'jr-money-line');
        row.appendChild(el('span', null, l.label));
        row.appendChild(el('span', null, naira(l.amount)));
        list.appendChild(row);
      });
      card.appendChild(list);
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
      row1.appendChild(button((kind === 'invoice' ? 'Pay Invoice ' : 'Pay ') + fmt, 'prc-pay-btn', function () { J.pay(id); }));
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
      /* Stage 8: the receipt is written by the server when the payment is confirmed */
      actions.appendChild(button('View receipt', 'jr-req-btn', function () {
        if (window.JRRequests && window.JRRequests.openReceipt) window.JRRequests.openReceipt(id);
      }));
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

  /* Decision cards: the other person accepts or declines, and the SERVER does the work.
     price_proposal -> price_respond (sets the agreed price); reschedule -> job_reschedule_respond (moves the booking time). */
  var DECISION = {
    price_proposal: { fn: 'price_respond', arg: 'p_request', yes: 'Accept price', no: 'Decline',
                      done: 'Agreed', okMsg: 'Price agreed. The tasker can now request payment.', noMsg: 'Price declined.' },
    reschedule:     { fn: 'job_reschedule_respond', arg: 'p_request', yes: 'Accept new time', no: 'Decline',
                      done: 'Accepted', okMsg: 'New time accepted. The job has been rescheduled.', noMsg: 'Reschedule declined.' }
  };
  async function respondToDecision(id, accept) {
    var req = S.requests[id];
    var d = req && DECISION[req.kind];
    if (!d) return;
    try {
      var args = {}; args[d.arg] = id; args.p_accept = !!accept;
      var r = await window.supabase.rpc(d.fn, args);
      if (r.error) throw r.error;
      S.requests[id] = Object.assign({}, req, { status: accept ? 'fulfilled' : 'declined' });
      repaintRequest(id);
      toast(accept ? d.okMsg : d.noMsg);
      if (accept && req.kind === 'reschedule' && window.JRDetails && window.JRDetails.refreshExtra) window.JRDetails.refreshExtra();
      if (window.JRRequests && window.JRRequests.update) window.JRRequests.update();
      if (window.JRDetails && window.JRDetails.update) window.JRDetails.update();
      if (window.JRRoom && window.JRRoom.refresh) window.JRRoom.refresh();
    } catch (e) {
      toast((e && e.message) || 'Could not answer the price proposal', 'error');
      repaintRequest(id);
    }
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
    var isPrice = kind === 'price_proposal';
    var decision = DECISION[kind] || null;
    var pillText = (decision && status === 'fulfilled') ? decision.done : (REQ_STATUS_LABEL[status] || status);
    if (req) head.appendChild(el('span', 'jr-req-pill jr-req-pill--' + status, pillText));
    card.appendChild(head);

    card.appendChild(el('div', 'jr-req-text', isMine ? meta.byMe : meta.byOther));
    if (kind === 'custom' && req && req.payload && req.payload.title) card.appendChild(el('div', 'jr-req-subject', String(req.payload.title)));
    if (isPrice && req && req.payload && Number(req.payload.amount) > 0) {
      card.appendChild(el('div', 'jr-req-amount', naira(Number(req.payload.amount))));
    }
    if (kind === 'reschedule' && req && req.payload && req.payload.when) {
      var wd = new Date(req.payload.when);
      if (!isNaN(wd.getTime())) {
        card.appendChild(el('div', 'jr-req-when', 'New time: ' + wd.toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })));
      }
    }
    if (req && req.note) {
      var note = el('div', 'jr-req-note', req.note);
      card.appendChild(note);
    }

    if (req && status === 'pending') {
      var actions = el('div', 'jr-req-actions');
      if (decision && req.requested_by !== S.user.id) {
        /* the other person answers: Accept or Decline, nothing else */
        var acc = el('button', 'jr-req-btn jr-req-btn--primary', decision.yes); acc.type = 'button';
        var dec = el('button', 'jr-req-btn', decision.no); dec.type = 'button';
        function lock() { acc.disabled = true; dec.disabled = true; }
        acc.addEventListener('click', function () { lock(); respondToDecision(id, true); });
        dec.addEventListener('click', function () { lock(); respondToDecision(id, false); });
        actions.appendChild(acc); actions.appendChild(dec);
      } else if (req.requested_by !== S.user.id) {
        /* Stage 8: the customer asked for an invoice, the tasker answers by sending one */
        if (kind === 'invoice_request' && S.role === 'tasker') {
          var inv = el('button', 'jr-req-btn jr-req-btn--primary', 'Send invoice'); inv.type = 'button';
          inv.addEventListener('click', function () {
            if (window.JRRequests && window.JRRequests.openInvoice) window.JRRequests.openInvoice({ answers: id });
          });
          actions.appendChild(inv);
        }
        /* Stage 9: the customer asked for proof or a receipt, the tasker answers with the Submit proof form */
        if ((kind === 'proof' || kind === 'receipt_request') && S.role === 'tasker') {
          var pf = el('button', 'jr-req-btn jr-req-btn--primary', kind === 'proof' ? 'Send proof' : 'Send receipt'); pf.type = 'button';
          pf.addEventListener('click', function () {
            if (window.JRForms && window.JRForms.open) window.JRForms.open('submit_proof', { answers: id, kind: kind === 'receipt_request' ? 'receipt' : '' });
          });
          actions.appendChild(pf);
        }
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
    var was = S.requests[row.id] && S.requests[row.id].status;
    S.requests[row.id] = Object.assign({}, S.requests[row.id] || {}, row);
    repaintRequest(row.id);
    if (S.requests[row.id].kind === 'reschedule' && was === 'pending' && row.status === 'fulfilled' && window.JRDetails && window.JRDetails.refreshExtra) {
      window.JRDetails.refreshExtra();
    }
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

  /* A price (or reschedule) proposal waiting for an answer, for the pinned "next step" card (messages-flow.js).
     mine = I sent it, so I am the one waiting. Read only; answering goes through answerDecision (the same server call as the chat card). */
  function pendingDecision() {
    var ids = Object.keys(S.requests || {}).filter(function (k) {
      var r = S.requests[k];
      return r.status === 'pending' && DECISION[r.kind];
    });
    if (!ids.length) return null;
    var r = S.requests[ids[ids.length - 1]];
    return { id: r.id, kind: r.kind, amount: Number(r.payload && r.payload.amount) || 0, note: r.note || '', mine: !!(S.user && r.requested_by === S.user.id) };
  }

  /* Message priority (spec 33): how much visual weight a message gets. */
  var PRIORITY = {
    text: 'normal', image: 'normal', video: 'normal', file: 'normal', location: 'normal',
    system: 'important', job_request: 'important', safety: 'important',
    payment_request: 'transactional', payment_confirmed: 'transactional'
  };

  function buildMessage(m) {
    if (m && (m.type === 'image' || m.type === 'video' || m.type === 'file' || m.type === 'location')) m = withMeta(m);
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

  /* Paths support removed from this thread. Best effort: if the table is missing nothing is hidden. */
  async function loadRemovals(threadId) {
    var out = {};
    try {
      var r = await window.supabase.from('evidence_removals').select('storage_path').eq('thread_id', threadId);
      if (!r.error && r.data) r.data.forEach(function (x) { if (x && x.storage_path) out[x.storage_path] = true; });
    } catch (_e) {}
    return out;
  }

  function fetchMessages(threadId, cols) {
    return window.supabase.from('messages').select(cols)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
  }

  /* Reload the open conversation (cards the server wrote for me, e.g. after an RPC). messages-work.js / messages-forms.js call this. */
  function reload() {
    return S.thread ? open({ thread: S.thread, user: S.user, role: S.role, onChange: S.onChange }) : Promise.resolve();
  }

  async function open(ctx) {
    S.thread = ctx.thread; S.user = ctx.user; S.role = ctx.role; S.onChange = ctx.onChange || null;
    S.lastDay = null; S.requests = {}; S.requestsFailed = false; S.money = {}; S.moneyFailed = false; S.removed = {};
    var token = ctx.thread.id;
    var body = $('chatBody');
    var input = $('msgInput');
    if (input) input.placeholder = S.role === 'tasker' ? 'Reply to customer…' : 'Type a message…';
    hideWarn();
    clearAttach();
    applyRoomState('open');                            /* reset from the previous thread, then ask the database */
    syncRoomState(token);
    var jump = $('jrJump'); if (jump) jump.hidden = true;

    placeholder(body, ICON_SPIN + ' Loading…');
    try {
      var cols = 'id,sender_id,body,created_at,type,payment_request_id,job_request_id,payload';
      var res = await fetchMessages(token, cols);
      if (res.error && /payload/.test(String(res.error.message || ''))) {
        res = await fetchMessages(token, 'id,sender_id,body,created_at,type,payment_request_id,job_request_id');
      }
      if (res.error && /job_request_id/.test(String(res.error.message || ''))) {
        /* Step 5 SQL not run yet: load without the new column */
        res = await fetchMessages(token, 'id,sender_id,body,created_at,type,payment_request_id');
      }
      if (S.thread.id !== token) return;               /* user switched thread */
      if (res.error) throw res.error;
      var msgs = (res.data || []).slice().reverse();
      var rem = await Promise.all([loadRequests(msgs), loadMoney(token), loadRemovals(token)]);
      if (S.thread.id !== token) return;
      S.removed = rem[2] || {};
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

  /* Last-message preview + the other person's unread counter (same as a text send). */
  async function bumpThread(t, preview, now) {
    var sb = window.supabase;
    now = now || new Date().toISOString();
    var isCustomer = S.user.id === t.customer_id;
    var unreadCol = isCustomer ? 'tasker_unread' : 'customer_unread';
    var curUnread = isCustomer ? (t.tasker_unread || 0) : (t.customer_unread || 0);
    try {
      await sb.from('message_threads').update({
        last_message: preview.slice(0, 80), last_message_at: now, [unreadCol]: curUnread + 1
      }).eq('id', t.id);
    } catch (_e) {}
    t.last_message = preview; t.last_message_at = now;
    if (isCustomer) t.tasker_unread = curUnread + 1; else t.customer_unread = curUnread + 1;
    if (S.onChange) S.onChange();
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

    await bumpThread(t, text, now);

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
    if (S.roomClosed) { toast('This chat is closed. You can read it but not send messages.', 'error'); return false; }

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

  /* ── attachments (Stage 9) ───────────────────────────────── */
  /* Order: validate -> (photos: re-encode, which drops GPS/EXIF) -> upload to the
     private bucket -> job_attachments row -> messages row. Only then does the
     message appear. A failure keeps the chip so the person can retry; if the
     upload and row already succeeded, a retry only repeats the message insert. */
  var ATTACH_LABEL = { photo: 'Photo', camera: 'Camera photo', file: 'File', location: 'Location' };
  var PHOTO_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/i;

  function extOf(name) {
    var m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  /* What is this file? -> { kind, mime, reencode } or { error } */
  function classify(file, wantKind) {
    var type = String(file.type || '').toLowerCase(), ext = extOf(file.name);
    var out;
    if (/^image\//.test(type) || /^(jpe?g|png|webp|heic|heif)$/.test(ext)) {
      if (/svg/.test(type) || ext === 'svg') return { error: 'SVG images are not allowed. Use a JPEG, PNG or WebP photo.' };
      if (type && !PHOTO_TYPES.test(type)) return { error: 'Use a JPEG, PNG or WebP photo.' };
      out = { kind: wantKind === 'receipt' ? 'receipt' : 'photo', mime: 'image/jpeg', reencode: true };
    } else if (/^video\//.test(type) || VIDEO_MIME[ext]) {
      var vm = VIDEO_MIME[ext] || type;
      if (!/^video\/(mp4|webm|quicktime)$/.test(vm)) return { error: 'Use an MP4, WebM or MOV video.' };
      if (wantKind === 'receipt') return { error: 'A receipt must be a photo or a PDF.' };
      out = { kind: 'video', mime: vm, reencode: false };
    } else if (FILE_MIME[ext]) {
      if (wantKind === 'receipt' && ext !== 'pdf') return { error: 'A receipt must be a photo or a PDF.' };
      out = { kind: wantKind === 'receipt' ? 'receipt' : 'file', mime: FILE_MIME[ext], reencode: false };
    } else {
      return { error: 'This file type is not allowed. Use a photo, video, PDF, Word, Excel, TXT or CSV file.' };
    }
    if (!out.reencode && file.size > LIMITS[out.kind]) {
      return { error: 'This file is too large (max ' + Math.round(LIMITS[out.kind] / MB) + ' MB).' };
    }
    return out;
  }

  /* Re-draw the photo on a canvas: removes EXIF/GPS and shrinks it (longest side 1600 px). */
  function reencodeImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      function done(fn, v) { try { URL.revokeObjectURL(url); } catch (_e) {} fn(v); }
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) throw new Error('empty');
          var k = Math.min(1, 1600 / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
          var c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          var ctx = c.getContext('2d');
          ctx.fillStyle = 'white'; ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          c.toBlob(function (b) {
            if (b) done(resolve, b); else done(reject, new Error('This photo could not be prepared. Try another one.'));
          }, 'image/jpeg', 0.85);
        } catch (e) { done(reject, new Error('This photo could not be read. Try a JPEG or PNG.')); }
      };
      img.onerror = function () { done(reject, new Error('This photo could not be read. Try a JPEG or PNG.')); };
      img.src = url;
    });
  }

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function safeName(name, mime) {
    var base = String(name || 'file').replace(/\.[^.]*$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'file';
    var ext = mime === 'image/jpeg' ? 'jpg' : (extOf(name) || 'bin');
    return base + '.' + ext;
  }

  /* Upload one file to the private bucket and record it. Reusable by the Submit proof
     form and receipt answers: opts = { kind: 'receipt', label, jobRequestId, paymentRequestId, thread }.
     Resolves { attachment, name }. A failed row insert leaves the uploaded object (clients
     cannot delete from the bucket); it has no row, so nobody can open it. */
  async function uploadEvidence(file, opts) {
    opts = opts || {};
    var sb = window.supabase, t = opts.thread || S.thread;
    if (!sb || !t || !S.user) throw new Error('Open a conversation first.');
    var c = classify(file, opts.kind);
    if (c.error) throw new Error(c.error);
    var blob = file;
    if (c.reencode) blob = await reencodeImage(file);
    if (blob.size > LIMITS[c.kind]) throw new Error('This file is too large (max ' + Math.round(LIMITS[c.kind] / MB) + ' MB).');
    var name = safeName(file.name, c.mime);
    var path = t.id + '/' + newId() + '-' + name;
    var up = await sb.storage.from(EVID_BUCKET).upload(path, blob, { contentType: c.mime, upsert: false, cacheControl: '3600' });
    if (up.error) throw up.error;
    var row = {
      thread_id: t.id, uploader_id: S.user.id, kind: c.kind, storage_path: path,
      mime: c.mime, size: blob.size, label: (opts.label || '').slice(0, 80) || null
    };
    if (opts.jobRequestId) row.job_request_id = opts.jobRequestId;
    if (opts.paymentRequestId) row.payment_request_id = opts.paymentRequestId;
    var ins = await sb.from('job_attachments').insert(row)
      .select('id,kind,storage_path,mime,size,label,created_at').single();
    if (ins.error) throw ins.error;
    return { attachment: ins.data, name: name };
  }

  /* Stage 9 (Submit proof / receipt answers): upload up to 5 files and post each as a chat message, or post a
     note alone. opts = { files: File[], note, kind: 'receipt'|undefined, jobRequestId, paymentRequestId }.
     Resolves { sent, failed: [text] }; throws when nothing could be sent. Photos stay optional: a note is enough. */
  var PROOF_MAX_FILES = 5;
  async function sendProof(opts) {
    opts = opts || {};
    var t = S.thread, sb = window.supabase;
    if (!sb || !t || !S.user) throw new Error('Open a conversation first.');
    var files = (opts.files || []).slice(0, PROOF_MAX_FILES), note = String(opts.note || '').trim();
    if (!files.length && note.length < 3) throw new Error('Add a short note or at least one file.');
    if (note && hasContactInfo(note)) {
      showWarn();
      if (typeof window.handleContactViolation === 'function') window.handleContactViolation(S.user.id);
      throw new Error('Please remove phone numbers, emails or links from the note.');
    }
    var sent = 0, failed = [], lastBody = '';
    async function post(type, body, payload) {
      var ins = await sb.from('messages').insert({
        thread_id: t.id, sender_id: S.user.id, receiver_id: receiverOf(t),
        body: body, flagged: false, type: type, payload: payload || null
      }).select('id,sender_id,body,created_at,type,payload').single();
      if (ins.error) throw ins.error;
      if (S.thread && S.thread.id === t.id) append(ins.data);
      lastBody = body; sent++;
    }
    if (!files.length) {
      await post('text', ('Proof of work: ' + note).slice(0, 2000));
    } else {
      for (var i = 0; i < files.length; i++) {
        try {
          var done = await uploadEvidence(files[i], {
            label: i === 0 ? note : '', thread: t, kind: opts.kind,
            jobRequestId: opts.jobRequestId, paymentRequestId: opts.paymentRequestId
          });
          var att = done.attachment;
          var type = att.kind === 'video' ? 'video' : (att.mime.indexOf('image/') === 0 ? 'image' : 'file');
          var payload = { attachment_id: att.id, path: att.storage_path, name: done.name, size: att.size, mime: att.mime };
          if (i === 0 && note) payload.caption = note;
          await post(type, (i === 0 && note) || (opts.kind === 'receipt' ? 'Receipt' : (type === 'image' ? 'Photo' : type === 'video' ? 'Video' : done.name.slice(0, 80))), payload);
        } catch (e) {
          failed.push((files[i].name || 'File') + ': ' + ((e && e.message) || 'could not be sent'));
        }
      }
    }
    if (!sent) throw new Error(failed.join(' ') || 'Nothing could be sent.');
    try { await bumpThread(t, lastBody); } catch (_e) {}
    if (opts.jobRequestId) {
      try {
        var r = await sb.from('job_requests').update({ status: 'fulfilled' }).eq('id', opts.jobRequestId).select().maybeSingle();
        if (r.data) { S.requests[opts.jobRequestId] = Object.assign({}, S.requests[opts.jobRequestId] || {}, r.data); repaintRequest(opts.jobRequestId); }
      } catch (_e2) {}
    }
    return { sent: sent, failed: failed };
  }

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('Location is not available on this device.')); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        resolve({ lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5 });
      }, function () {
        reject(new Error('Could not get your location. Check that location is allowed for this site.'));
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }

  function setChipNote(text) {
    var n = document.querySelector('#jrAttachPreview .jr-attach-note');
    if (n) n.textContent = text;
  }

  function clearAttach() {
    if (S.attach && S.attach.url) { try { URL.revokeObjectURL(S.attach.url); } catch (_e) {} }
    S.attach = null;
    var box = $('jrAttachPreview');
    if (box) { box.textContent = ''; box.hidden = true; }
    syncSendState();
  }

  function showAttach(kind, file) {
    if (S.uploading) return;
    if (file) {
      var c = classify(file);
      if (c.error) { toast(c.error, 'error'); return; }
    }
    clearAttach();
    var a = { kind: kind, file: file || null, name: file ? file.name : 'Current location', size: file ? file.size : 0, url: '', isImage: false, done: null };
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
    info.appendChild(el('div', 'jr-attach-note', kind === 'location'
      ? 'Your current location is shared once, when you tap Send.'
      : 'Ready to send. Type a caption below if you like.'));
    var rm = el('button', 'jr-icon-btn jr-attach-remove'); rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove attachment'); rm.innerHTML = ICON_CLOSE;
    rm.addEventListener('click', function () { if (!S.uploading) clearAttach(); });
    chip.appendChild(thumb); chip.appendChild(info); chip.appendChild(rm);
    box.appendChild(chip);
    box.hidden = false;
    syncSendState();
  }

  /* Returns true when the attachment message was sent. */
  async function sendAttachment() {
    var a = S.attach, t = S.thread, sb = window.supabase;
    if (!a || !t || !S.user || S.uploading) return false;
    var input = $('msgInput');
    var cap = ((input && input.value) || '').trim();
    if (cap && hasContactInfo(cap)) {
      showWarn();
      if (typeof window.handleContactViolation === 'function') window.handleContactViolation(S.user.id);
      return false;
    }
    hideWarn();
    S.uploading = true;
    setChipNote(a.kind === 'location' ? 'Getting your location…' : 'Uploading…');
    syncSendState();
    try {
      var type, payload, body;
      if (a.kind === 'location') {
        var pos = await getPosition();
        type = 'location';
        payload = { label: (cap || 'Shared location').slice(0, 80), lat: pos.lat, lng: pos.lng };
        body = cap || 'Shared location';
      } else {
        if (!a.done) a.done = await uploadEvidence(a.file, { label: cap, thread: t });
        var att = a.done.attachment;
        type = att.kind === 'video' ? 'video' : (att.mime.indexOf('image/') === 0 ? 'image' : 'file');
        payload = { attachment_id: att.id, path: att.storage_path, name: a.done.name, size: att.size, mime: att.mime };
        if (cap) payload.caption = cap;
        body = cap || (type === 'image' ? 'Photo' : type === 'video' ? 'Video' : a.done.name.slice(0, 80));
      }
      setChipNote('Sending…');
      var ins = await sb.from('messages').insert({
        thread_id: t.id, sender_id: S.user.id, receiver_id: receiverOf(t),
        body: body, flagged: false, type: type, payload: payload
      }).select('id,sender_id,body,created_at,type,payload').single();
      if (ins.error) throw ins.error;
      await bumpThread(t, body);
      if (S.thread && S.thread.id === t.id) append(ins.data);
      if (S.attach === a) clearAttach();
      if (input) { input.value = ''; input.style.height = 'auto'; }
      return true;
    } catch (e) {
      var msg = (e && e.message) || String(e);
      if (S.attach === a) setChipNote('Not sent. ' + msg);
      toast('Not sent: ' + msg, 'error');
      return false;
    } finally {
      S.uploading = false;
      syncSendState();
    }
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
    if (btn && input) btn.disabled = !!S.roomClosed || !!S.uploading || (S.attach ? false : !input.value.trim());
  }

  /* ── closed room (stage M5) ─────────────────────────────────
     The database (stage M2) refuses messages in a closed room. This asks it for the room state so the page can say so
     and switch the composer off instead of letting the person type and fail. If the check cannot run (the helper
     chat_room_status is not installed, or the network fails) nothing changes: the composer stays as it was. */
  function applyRoomState(state) {
    var bar = $('inputBar'), input = $('msgInput');
    var closed = state === 'closed' || state === 'not_yet' || state === 'none';
    S.roomClosed = closed;
    if (bar) bar.classList.toggle('is-closed', closed);
    if (input) {
      input.disabled = closed;
      if (closed) input.placeholder = 'This chat is closed';
      else input.placeholder = S.role === 'tasker' ? 'Reply to customer\u2026' : 'Type a message\u2026';
    }
    var note = $('jrClosedNote');
    if (closed && bar && !note) {
      note = el('div', 'jr-closed-note'); note.id = 'jrClosedNote'; note.setAttribute('role', 'status');
      bar.parentNode.insertBefore(note, bar);
    }
    if (note) {
      note.hidden = !closed;
      note.textContent = state === 'closed'
        ? 'This chat is closed because the job was cancelled or completed. You can still read the conversation.'
        : 'Chat is not open for this job. You can still read the conversation.';
    }
    syncSendState();
  }

  async function syncRoomState(threadId) {
    try {
      var r = await window.supabase.rpc('chat_room_status', { p_thread: threadId });
      if (r.error || !S.thread || S.thread.id !== threadId) return;
      if (r.data == null) return;                      /* not a room of mine, or unknown: leave it alone */
      applyRoomState(String(r.data));
    } catch (e) { /* the database still refuses messages in a closed room */ }
  }

  async function submitFromInput() {
    var input = $('msgInput');
    if (!input) return;
    if (S.attach) { await sendAttachment(); return; }
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
        fitInput(input);
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

  /* The message box keeps its width. It grows one line at a time up to 5 lines (128px with padding and border),
     then stays that size and the text scrolls inside it, so the line you are typing is always visible. */
  function fitInput(input) {
    var MAX = 128;
    input.style.height = 'auto';
    var border = input.offsetHeight - input.clientHeight;
    var want = input.scrollHeight + border;
    input.style.height = Math.min(want, MAX) + 'px';
    input.style.overflowY = want > MAX ? 'auto' : 'hidden';
  }

  window.JRThread = {
    bindComposer: bindComposer,
    open: open,
    reload: reload,
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
    uploadEvidence: uploadEvidence,
    sendProof: sendProof,
    signedUrl: signedUrl,
    getMoney: getMoney,
    moneyRows: moneyRows,
    pendingDecision: pendingDecision,
    answerDecision: function (id, accept) { return respondToDecision(id, accept); },
    isClosed: function () { return !!S.roomClosed; },
    /* Stage 15: messages-work.js and messages-forms.js call reload() after an action; it was never exported, so they silently did nothing */
    reload: function () {
      return S.thread ? open({ thread: S.thread, user: S.user, role: S.role, onChange: S.onChange }) : Promise.resolve();
    }
  };

})();

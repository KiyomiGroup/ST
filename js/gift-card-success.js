/* Gift Cards: payment confirmation page (gift-card-success.html).
   Paystack sends the buyer back here with ?reference=GC-... The page asks the
   verify-gift-card-payment Edge Function to confirm the payment with Paystack
   and shows the card and its code once it is paid. Nothing here decides whether
   a payment is real; that is all done on the server. */
(function () {
  'use strict';

  var THEMES = {
    cleaning:     { label: 'Cleaning & Home', icon: '#gc-brush' },
    birthday:     { label: 'Happy Birthday',  icon: '#gc-cake' },
    housewarming: { label: 'Housewarming',    icon: '#gc-house' },
    thanks:       { label: 'Thank You',       icon: '#gc-heart' },
    congrats:     { label: 'Congratulations', icon: '#gc-party' },
    general:      { label: 'General Voucher', icon: '#gc-gift' }
  };
  var LOCKS = { cleaning: 'Cleaning', handyman: 'Handyman & Home Repairs', moving: 'Moving & Heavy Lifting', wardrobe: 'Wardrobe & Tailoring', tech: 'Tech & Inverter Servicing' };
  var redeemLink = '';
  var REF_RE = /^GC-[A-Z2-9]{20}$/;
  var POLL_MS = 2500;
  var MAX_TRIES = 8;       // about 20 seconds of waiting for the bank

  var FUNCTIONS_URL = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/';
  var ANON_KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';

  var params = new URLSearchParams(window.location.search);
  var reference = (params.get('reference') || params.get('trxref') || '').trim().toUpperCase();

  var states = { loading: document.getElementById('gcs-loading'), paid: document.getElementById('gcs-paid'), problem: document.getElementById('gcs-problem') };
  if (!states.loading) return;

  function naira(n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }
  function field(name) { return document.querySelectorAll('[data-f="' + name + '"]'); }
  function setField(name, text) { field(name).forEach(function (el) { el.textContent = text; }); }

  function show(which) {
    Object.keys(states).forEach(function (k) { states[k].hidden = k !== which; });
    var h = states[which].querySelector('h1');
    if (h) h.focus({ preventScroll: true });
  }

  function problem(title, text, opts) {
    opts = opts || {};
    setField('problem-title', title);
    setField('problem-text', text);
    var refLine = document.getElementById('gcs-problem-ref');
    refLine.hidden = !(opts.showRef && REF_RE.test(reference));
    setField('reference', reference);
    document.getElementById('gcs-retry').hidden = !opts.retry;
    show('problem');
  }

  function renderCard(card) {
    var theme = THEMES[card.theme] || THEMES.general;
    setField('recipient', card.recipientName);
    setField('sender', card.senderName);
    setField('theme', theme.label);
    setField('amount', naira(card.amount));
    setField('message', '\u201C' + (card.message || '') + '\u201D');
    setField('code', card.code);
    var icon = document.querySelector('[data-f-icon]');
    if (icon) icon.setAttribute('href', theme.icon);
    document.querySelector('.gcs-card .gc-cz-card-msg').hidden = !card.message;

    // The printable sheet: what the card can be used for, a QR code to the redeem page, no empty message
    setField('usable', LOCKS[card.category] ? 'Valid for ' + LOCKS[card.category] + ' bookings' : 'Valid on any StreetTasker booking');
    var sheetMsg = document.querySelector('.gcp-msg'); if (sheetMsg) sheetMsg.hidden = !card.message;
    var redeemUrl = window.location.origin + '/redeem.html?code=' + encodeURIComponent(card.code);
    var qrBox = document.getElementById('gcp-qr');
    if (qrBox && typeof qrcode === 'function') {
      try {
        var qr = qrcode(0, 'M'); qr.addData(redeemUrl); qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });   // generated here from our own text, not from user input
      } catch (e) { qrBox.hidden = true; }
    }

    // The shared link opens the redeem page, where the person types the code (they need a free account to redeem)
    var link = window.location.origin + '/redeem.html';
    var text = card.senderName + ' sent you a StreetTasker gift card worth ' + naira(card.amount) + '!' +
      '\n\nYour code: ' + card.code + '\n\nRedeem it here: ' + link + '\n(Open the link, enter your code, and create a free account to add it to your wallet.)';
    redeemLink = link;
    document.getElementById('gcs-share').setAttribute('href', 'https://wa.me/?text=' + encodeURIComponent(text));

    document.title = 'Your Gift Card \u2014 Street Taskers';
    show('paid');
  }

  function verify() {
    return fetch(FUNCTIONS_URL + 'verify-gift-card-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
      body: JSON.stringify({ reference: reference })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { httpStatus: res.status, data: data }; });
    });
  }

  function check(tries) {
    verify().then(function (out) {
      var d = out.data || {};
      if (d.status === 'paid' && d.card) { renderCard(d.card); return; }
      if (d.status === 'pending' && tries < MAX_TRIES) { setTimeout(function () { check(tries + 1); }, POLL_MS); return; }
      if (d.status === 'pending') {
        problem('Still confirming your payment',
          'Your bank is taking a little longer than usual. Your gift card will be created as soon as the payment is confirmed. You can check again in a minute.',
          { retry: true, showRef: true });
        return;
      }
      if (d.status === 'failed') {
        problem('Payment not completed',
          'This payment didn\u2019t go through, so no gift card was created. If you were charged, please contact support and quote the reference below.',
          { showRef: true });
        return;
      }
      if (d.status === 'not_found' || out.httpStatus === 400) {
        problem('We couldn\u2019t find that payment', 'The link may be incomplete. If you paid for a gift card, please contact support.', {});
        return;
      }
      // 502 and anything unexpected: the server could not reach Paystack yet
      if (tries < MAX_TRIES) { setTimeout(function () { check(tries + 1); }, POLL_MS); return; }
      problem('We couldn\u2019t confirm your payment yet',
        d.error || 'Something went wrong on our side. Please check again in a moment.',
        { retry: true, showRef: true });
    }).catch(function () {
      if (tries < MAX_TRIES) { setTimeout(function () { check(tries + 1); }, POLL_MS); return; }
      problem('We couldn\u2019t reach the server', 'Check your connection and try again.', { retry: true, showRef: true });
    });
  }

  // ── Buttons ──
  var linkBtn = document.getElementById('gcs-copylink');
  linkBtn.addEventListener('click', function () {
    var link = redeemLink || window.location.origin + '/redeem.html';
    function done() {
      var label = linkBtn.querySelector('span');
      label.textContent = 'Link copied';
      setTimeout(function () { label.textContent = 'Copy redeem link'; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link:', link); });
    } else {
      window.prompt('Copy this link:', link);
    }
  });

  var copyBtn = document.getElementById('gcs-copy');
  copyBtn.addEventListener('click', function () {
    var code = document.querySelector('.gcs-code-value').textContent;
    function done() {
      var label = copyBtn.querySelector('span');
      label.textContent = 'Copied';
      setTimeout(function () { label.textContent = 'Copy'; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { window.prompt('Copy your code:', code); });
    } else {
      window.prompt('Copy your code:', code);
    }
  });
  document.getElementById('gcs-print').addEventListener('click', function () { window.print(); });
  document.getElementById('gcs-retry').addEventListener('click', function () { show('loading'); check(0); });

  // ── Go ──
  if (!REF_RE.test(reference)) {
    problem('We couldn\u2019t find that payment', 'This page needs the link Paystack sends you after paying. If you paid for a gift card, please contact support.', {});
  } else {
    check(0);
  }
})();

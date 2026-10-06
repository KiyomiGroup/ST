/* Gift Cards: redeem page (redeem.html). The email link is redeem.html?code=ST-XXXX-XXXX-XXXX.
   Everything that matters (is the code real, is it still unused, adding the money) is decided by
   the gift-card-redeem Edge Function. This page only shows the result. */
(function () {
  'use strict';

  var THEMES = {
    cleaning: { label: 'Cleaning & Home', icon: '#gc-brush' }, birthday: { label: 'Happy Birthday', icon: '#gc-cake' },
    housewarming: { label: 'Housewarming', icon: '#gc-house' }, thanks: { label: 'Thank You', icon: '#gc-heart' },
    congrats: { label: 'Congratulations', icon: '#gc-party' }, general: { label: 'General Voucher', icon: '#gc-gift' }
  };
  var FUNCTION_URL = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/gift-card-redeem';
  var ANON_KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';

  var ids = ['loading', 'entry', 'card', 'done', 'problem'];
  var states = {};
  ids.forEach(function (k) { states[k] = document.getElementById('rd-' + k); });
  if (!states.loading) return;

  var code = '';
  var token = '';

  var LOCKS = { cleaning: 'Cleaning', handyman: 'Handyman & Home Repairs', moving: 'Moving & Heavy Lifting', wardrobe: 'Wardrobe & Tailoring', tech: 'Tech & Inverter Servicing' };
  function usableText(cat) { return LOCKS[cat] ? 'It can be used on ' + LOCKS[cat] + ' bookings.' : 'It can be used on any booking.'; }
  function naira(n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }
  function setField(name, text) {
    document.querySelectorAll('[data-f="' + name + '"]').forEach(function (el) { el.textContent = text; });
  }
  function show(which) {
    ids.forEach(function (k) { states[k].hidden = k !== which; });
    var h = states[which].querySelector('h1');
    if (h) h.focus({ preventScroll: true });
  }
  function problem(title, text) { setField('problem-title', title); setField('problem-text', text); show('problem'); }

  function call(action) {
    return fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY) },
      body: JSON.stringify({ action: action, code: code })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    });
  }

  function getToken() {
    var auth = window.supabase && window.supabase.auth;
    if (!auth) return Promise.resolve('');
    return auth.getSession().then(function (r) {
      return r && r.data && r.data.session ? r.data.session.access_token : '';
    }, function () { return ''; });
  }

  function start(raw) {
    code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    code = code.length === 14 ? 'ST-' + code.slice(2, 6) + '-' + code.slice(6, 10) + '-' + code.slice(10) : code;
    show('loading');
    getToken().then(function (t) {
      token = t;
      return call('check');
    }).then(function (out) {
      var d = out.data || {};
      if (out.status === 429) { problem('Too many attempts', d.error); return; }
      if (out.status === 404) {
        problem('We couldn\u2019t find that code', 'Check the code and try again. It looks like ST-XXXX-XXXX-XXXX.');
        return;
      }
      if (out.status !== 200) { problem('Something went wrong', d.error || 'Please try again in a moment.'); return; }
      if (d.status === 'redeemed') { problem('Already redeemed', 'This gift card has already been used.'); return; }
      if (d.status !== 'active') { problem('Card not available', 'This gift card is no longer valid. Please contact support.'); return; }
      renderCard(d);
    }).catch(function () {
      problem('We couldn\u2019t reach the server', 'Check your connection and try again.');
    });
  }

  function renderCard(d) {
    var theme = THEMES[d.theme] || THEMES.general;
    setField('recipient', d.recipientName);
    setField('sender', d.senderName);
    setField('theme', theme.label);
    setField('amount', naira(d.amount));
    setField('usable', usableText(d.category));
    setField('message', '\u201C' + (d.message || '') + '\u201D');
    document.querySelector('[data-f-icon]').setAttribute('href', theme.icon);
    document.querySelector('.gcs-card .gc-cz-card-msg').hidden = !d.message;

    var back = encodeURIComponent('redeem.html?code=' + code);
    document.getElementById('rd-login').setAttribute('href', 'login.html?redirect=' + back);
    document.getElementById('rd-signup').setAttribute('href', 'signup.html');
    document.getElementById('rd-actions-in').hidden = !token;
    document.getElementById('rd-actions-out').hidden = !!token;
    show('card');
  }

  document.getElementById('rd-redeem').addEventListener('click', function () {
    var btn = this, err = document.getElementById('rd-action-error');
    err.hidden = true;
    btn.disabled = true;
    call('redeem').then(function (out) {
      var d = out.data || {};
      if (out.status === 200 && d.redeemed) {
        setField('credited', naira(d.credited));
        setField('usable', usableText(d.category));
        show('done');
        return;
      }
      if (out.status === 401) { window.location.assign('login.html?redirect=' + encodeURIComponent('redeem.html?code=' + code)); return; }
      if (d.code === 'already_yours' || d.code === 'already_redeemed' || d.code === 'card_void') {
        problem(d.code === 'already_yours' ? 'Already redeemed' : 'Card not available', d.error);
        return;
      }
      btn.disabled = false;
      err.textContent = d.error || 'We couldn\u2019t redeem the card. Please try again.';
      err.hidden = false;
    }).catch(function () {
      btn.disabled = false;
      err.textContent = 'We couldn\u2019t reach the server. Check your connection and try again.';
      err.hidden = false;
    });
  });

  document.getElementById('rd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = document.getElementById('rd-code').value;
    var chars = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    var err = document.getElementById('rd-entry-error');
    if (chars.length !== 14 || chars.slice(0, 2) !== 'ST') {
      err.textContent = 'That code doesn\u2019t look right. It looks like ST-XXXX-XXXX-XXXX.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    start(v);
  });

  var fromLink = new URLSearchParams(window.location.search).get('code');
  if (fromLink) start(fromLink); else show('entry');
})();

/* Gift Cards page: preset amount chips on the category cards.
   Picking a chip updates the price in the card footer and the
   "Select & Customize" link. The next section can read ?card= and ?amount=
   from the URL, or listen for the "gc:select" event on document. */
(function () {
  'use strict';

  function naira(n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }

  function update(tile, chip) {
    var amount = chip.dataset.amount;
    var rec = tile.dataset.recommended;
    var isCustom = amount === 'custom';

    tile.querySelectorAll('.gc-amount').forEach(function (c) {
      var on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    var label = tile.querySelector('[data-price-label]');
    var price = tile.querySelector('[data-price]');
    var link = tile.querySelector('[data-select]');

    if (isCustom) {
      label.textContent = 'Your amount';
      price.textContent = 'Custom';
    } else {
      label.textContent = amount === rec ? 'Recommended' : 'Selected';
      price.textContent = naira(amount);
    }
    link.setAttribute('href', '?card=' + encodeURIComponent(tile.dataset.card) +
      '&amount=' + encodeURIComponent(amount) + '#customize');
  }

  document.addEventListener('click', function (e) {
    var chip = e.target.closest('.gc-amount');
    if (chip) {
      var tile = chip.closest('.gc-tile');
      if (tile) update(tile, chip);
      return;
    }
    var link = e.target.closest('[data-select]');
    if (link) {
      var t = link.closest('.gc-tile');
      var active = t && t.querySelector('.gc-amount.is-active');
      document.dispatchEvent(new CustomEvent('gc:select', {
        detail: { card: t.dataset.card, amount: active ? active.dataset.amount : t.dataset.recommended }
      }));
    }
  });
})();

/* Gift Cards page: "Personalize" section (#customize).
   Keeps the form, the live preview card and the order summary in sync, reads
   ?card= and ?amount= from the category cards, and validates on submit.
   When the form is valid it asks the create-gift-card-checkout Edge Function
   to start a Paystack payment and sends the buyer to Paystack's hosted page.
   The price is worked out on the server; nothing sent from here sets it. */
(function () {
  'use strict';

  var root = document.getElementById('customize');
  if (!root) return;
  var form = document.getElementById('gc-cz-form');

  var MIN_AMOUNT = 1000;      // smallest custom amount, in naira
  var MAX_AMOUNT = 1000000;   // largest custom amount, in naira

  var THEMES = {
    cleaning:     { label: 'Cleaning & Home', icon: '#gc-brush',  msg: 'Enjoy a spotless home on me! Kick back and let StreetTasker handle the chores.' },
    birthday:     { label: 'Happy Birthday',  icon: '#gc-cake',   msg: 'Happy birthday! Here is some free time to spend on yourself.' },
    housewarming: { label: 'Housewarming',    icon: '#gc-house',  msg: 'Congratulations on the new place! Let us help you settle in.' },
    thanks:       { label: 'Thank You',       icon: '#gc-heart',  msg: 'Thank you for everything. This one is on me.' },
    congrats:     { label: 'Congratulations', icon: '#gc-party',  msg: 'Congratulations! You deserve a little help and a lot of rest.' },
    general:      { label: 'General Voucher', icon: '#gc-gift',   msg: 'A little gift of free time, from me to you.' }
  };
  var SAMPLE = { name: 'Amaka Obi', from: 'Tunde Adebayo' };

  var CATEGORY_KEYS = ['cleaning', 'handyman', 'moving', 'wardrobe', 'tech'];   // 'universal' (or none) = any category
  var state = { theme: 'cleaning', amount: 30000, custom: false, category: null };

  function $(sel) { return form.querySelector(sel); }
  var presets = form.querySelectorAll('.gc-cz-amount');
  var customChip = $('.gc-cz-amount[data-amount="custom"]');
  var customWrap = $('.gc-cz-custom');
  var customInput = document.getElementById('gc-cz-custom');
  var nameEl = document.getElementById('gc-cz-name');
  var contactEl = document.getElementById('gc-cz-contact');
  var senderEl = document.getElementById('gc-cz-sender');
  var noteEl = document.getElementById('gc-cz-note');
  var timingEl = document.getElementById('gc-cz-timing');
  var dateEl = document.getElementById('gc-cz-date');
  var payButtons = form.querySelectorAll('.gc-cz-checkout, .gc-buybar-btn');
  var checkoutErrors = form.querySelectorAll('[data-checkout-error]');

  function naira(n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }
  function pv(key) { return form.querySelector('[data-pv="' + key + '"]'); }
  function sum(key) { return form.querySelector('[data-sum="' + key + '"]'); }
  function val(el) { return el.value.trim(); }
  function checked(name) { var r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }

  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  dateEl.setAttribute('min', today());

  function render() {
    var theme = THEMES[state.theme];
    root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-custom', state.custom ? 'true' : 'false');

    presets.forEach(function (b) {
      var isCustom = b.dataset.amount === 'custom';
      var on = isCustom ? state.custom : (!state.custom && Number(b.dataset.amount) === state.amount);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    customWrap.classList.toggle('is-active', state.custom && state.amount > 0);

    var amountText = state.amount > 0 ? naira(state.amount) : '\u20A60';
    pv('amount').textContent = amountText;
    sum('amount').textContent = amountText;
    form.querySelectorAll('[data-sum="total"]').forEach(function (el) { el.textContent = amountText; });

    pv('theme').textContent = theme.label;
    form.querySelector('[data-pv-icon]').setAttribute('href', theme.icon);
    pv('name').textContent = val(nameEl) || SAMPLE.name;
    pv('from').textContent = val(senderEl) || SAMPLE.from;
    pv('msg').textContent = '\u201C' + (val(noteEl) || theme.msg) + '\u201D';
    noteEl.setAttribute('placeholder', theme.msg);

    var later = timingEl.value === 'later';
    dateEl.hidden = !later;
    sum('delivery-label').textContent = later ? 'Scheduled Delivery:' : 'Instant Delivery:';
  }

  function setTheme(key) {
    if (!THEMES[key]) key = 'general';
    state.theme = key;
    var radio = form.querySelector('input[name="theme"][value="' + key + '"]');
    if (radio) radio.checked = true;
  }

  function setPreset(amount) {
    state.custom = false;
    state.amount = amount;
    customInput.value = '';
  }

  function setCustom(amount) {
    state.custom = true;
    state.amount = amount > 0 ? amount : 0;
    customInput.value = amount > 0 ? amount.toLocaleString('en-NG') : '';
  }

  // Apply a choice made on the category cards (?card=...&amount=...)
  function applySelection(card, amount) {
    if (card) {
      setTheme(card === 'cleaning' ? 'cleaning' : 'general');
      state.category = CATEGORY_KEYS.indexOf(card) !== -1 ? card : null;   // the card is locked to what the buyer picked
    }
    if (amount === 'custom') {
      setCustom(0);
    } else if (amount) {
      var n = Number(amount);
      if (n > 0) {
        var hit = Array.prototype.some.call(presets, function (b) {
          return b.dataset.amount !== 'custom' && Number(b.dataset.amount) === n;
        });
        if (hit) setPreset(n); else setCustom(n);
      }
    }
    render();
  }

  // ── Errors ──
  function setError(key, el, message) {
    var out = document.getElementById('gc-cz-err-' + key);
    if (out) { out.textContent = message || ''; out.hidden = !message; }
    if (el) {
      if (message) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    }
  }
  function clearError(key, el) { setError(key, el, ''); }

  function validate() {
    var first = null;
    function fail(key, el, msg, focusEl) { setError(key, el, msg); if (!first) first = focusEl || el; }

    if (state.amount < MIN_AMOUNT) {
      fail('amount', state.custom ? customInput : null, 'Choose an amount of ' + naira(MIN_AMOUNT) + ' or more.',
        state.custom ? customInput : presets[0]);
    } else if (state.amount > MAX_AMOUNT) {
      fail('amount', customInput, 'The most you can send is ' + naira(MAX_AMOUNT) + '. For more, use Corporate Gifting.', customInput);
    } else { clearError('amount', customInput); }

    if (!val(nameEl)) fail('name', nameEl, 'Enter the recipient\u2019s name.');
    else clearError('name', nameEl);

    var contact = val(contactEl);
    var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    var isPhone = /^\+?[\d\s-]{10,16}$/.test(contact) && contact.replace(/\D/g, '').length >= 10;
    if (checked('delivery') === 'digital' || contact) {
      if (!contact) fail('contact', contactEl, 'Enter an email address or WhatsApp number.');
      else if (!isEmail && !isPhone) fail('contact', contactEl, 'That doesn\u2019t look like an email or phone number.');
      else clearError('contact', contactEl);
    } else { clearError('contact', contactEl); }

    if (!val(senderEl)) fail('sender', senderEl, 'Enter your name so they know who it\u2019s from.');
    else clearError('sender', senderEl);

    if (timingEl.value === 'later' && (!dateEl.value || dateEl.value < today())) {
      fail('date', dateEl, 'Pick a delivery date from today onwards.');
    } else { clearError('date', dateEl); }

    return first;
  }

  // ── Events ──
  form.addEventListener('click', function (e) {
    var chip = e.target.closest('.gc-cz-amount');
    if (!chip) return;
    clearError('amount', customInput);
    if (chip.dataset.amount === 'custom') {
      setCustom(state.amount);
      render();
      customInput.focus();
    } else {
      setPreset(Number(chip.dataset.amount));
      render();
    }
  });

  customInput.addEventListener('input', function () {
    var digits = customInput.value.replace(/\D/g, '').slice(0, 7);
    setCustom(Number(digits));
    clearError('amount', customInput);
    render();
  });

  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'theme') { state.theme = t.value; render(); }
    else if (t.name === 'delivery') { clearError('contact', contactEl); render(); }
    else if (t === timingEl) { clearError('date', dateEl); render(); }
    else if (t === dateEl) { clearError('date', dateEl); }
  });

  [[nameEl, 'name'], [contactEl, 'contact'], [senderEl, 'sender']].forEach(function (p) {
    p[0].addEventListener('input', function () { clearError(p[1], p[0]); render(); });
  });
  noteEl.addEventListener('input', render);

  // ── Checkout: server creates the order, Paystack takes the payment ──
  var busy = false;
  var FUNCTIONS_URL = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/';
  var ANON_KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';

  function showCheckoutError(text) {
    checkoutErrors.forEach(function (el) { el.textContent = text || ''; el.hidden = !text; });
  }

  function setBusy(on) {
    busy = on;
    form.setAttribute('aria-busy', on ? 'true' : 'false');
    payButtons.forEach(function (b) {
      var label = b.querySelector('.gc-cz-btn-label');
      if (on && label && !b.dataset.label) b.dataset.label = label.textContent;
      if (label) label.textContent = on ? 'Taking you to Paystack\u2026' : (b.dataset.label || label.textContent);
      b.disabled = on;
    });
  }

  // Map the server's field names onto the form's error slots
  var SERVER_FIELDS = {
    amount: ['amount', customInput], recipientName: ['name', nameEl], recipientContact: ['contact', contactEl],
    senderName: ['sender', senderEl], sendOn: ['date', dateEl]
  };

  // ── Buying needs an account. The form is kept for the trip to the login page. ──
  var DRAFT_KEY = 'st_giftcard_draft';
  var DRAFT_MAX_AGE = 30 * 60 * 1000;   // half an hour

  function saveDraft() {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        at: Date.now(), theme: state.theme, category: state.category, amount: state.amount, custom: state.custom,
        delivery: checked('delivery'), name: val(nameEl), contact: val(contactEl), sender: val(senderEl),
        note: val(noteEl), timing: timingEl.value, date: dateEl.value
      }));
    } catch (err) { /* storage blocked: the buyer just fills the form again */ }
  }

  function goToLogin() {
    saveDraft();
    window.location.assign('login.html?redirect=' + encodeURIComponent('gift-cards.html#customize'));
  }

  // Put the saved form back after login. Returns true if there was one.
  function restoreDraft() {
    var raw = null;
    try { raw = sessionStorage.getItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY); } catch (err) { return false; }
    if (!raw) return false;
    var d;
    try { d = JSON.parse(raw); } catch (err) { return false; }
    if (!d || typeof d !== 'object' || !d.at || Date.now() - d.at > DRAFT_MAX_AGE) return false;

    if (THEMES[d.theme]) setTheme(d.theme);
    state.category = CATEGORY_KEYS.indexOf(d.category) !== -1 ? d.category : null;
    if (d.custom) setCustom(Number(d.amount) || 0); else if (Number(d.amount) > 0) setPreset(Number(d.amount));
    var delivery = form.querySelector('input[name="delivery"][value="' + (d.delivery === 'pdf' ? 'pdf' : 'digital') + '"]');
    if (delivery) delivery.checked = true;
    nameEl.value = String(d.name || '').slice(0, 60);
    contactEl.value = String(d.contact || '').slice(0, 80);
    senderEl.value = String(d.sender || '').slice(0, 60);
    noteEl.value = String(d.note || '').slice(0, 200);
    timingEl.value = d.timing === 'later' ? 'later' : 'now';
    dateEl.value = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '';
    render();
    return true;
  }

  function startCheckout(order) {
    if (busy) return;
    showCheckoutError('');
    setBusy(true);

    var auth = window.supabase && window.supabase.auth;
    var sessionP = auth ? auth.getSession().catch(function () { return null; }) : Promise.resolve(null);

    sessionP.then(function (r) {
      var token = r && r.data && r.data.session ? r.data.session.access_token : '';
      if (!token) { goToLogin(); return null; }      // logged out: save the form, sign in, come back
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 25000);
      return fetch(FUNCTIONS_URL + 'create-gift-card-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY) },
        body: JSON.stringify(order),
        signal: ctrl.signal
      }).then(function (res) {
        clearTimeout(timer);
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      }, function (err) { clearTimeout(timer); throw err; });
    }).then(function (out) {
      if (!out) return;                                // heading to the login page
      if (out.data && out.data.code === 'login_required') { goToLogin(); return; }
      var url = out.data && out.data.authorization_url;
      if (out.ok && typeof url === 'string' && url.indexOf('https://checkout.paystack.com/') === 0) {
        window.location.assign(url);       // stay "busy" while the browser leaves
        return;
      }
      setBusy(false);
      var slot = out.data && SERVER_FIELDS[out.data.field];
      if (slot) {
        setError(slot[0], slot[1], out.data.error);
        slot[1].focus();
      } else {
        showCheckoutError((out.data && out.data.error) || 'We couldn\u2019t start the payment. Please try again.');
      }
    }).catch(function (err) {
      // The console line is for whoever is debugging: it says whether the call timed out or was refused
      if (window.console) console.error('[gift-cards] checkout request failed:', (err && err.name) || '', (err && err.message) || err, '→', FUNCTIONS_URL + 'create-gift-card-checkout');
      setBusy(false);
      showCheckoutError('We couldn\u2019t reach the payment service. Check your connection and try again.');
    });
  }

  // Coming back with the browser's Back button from Paystack
  window.addEventListener('pageshow', function (e) { if (e.persisted) setBusy(false); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var bad = validate();
    if (bad) { bad.focus(); return; }
    startCheckout({
      theme: state.theme,
      category: state.category,
      amount: state.amount,
      delivery: checked('delivery'),
      recipientName: val(nameEl),
      recipientContact: val(contactEl),
      senderName: val(senderEl),
      message: val(noteEl) || THEMES[state.theme].msg,   // what the preview shows is what gets sent
      sendOn: timingEl.value === 'later' ? dateEl.value : 'now'
    });
  });

  // The category cards fire this before they navigate
  document.addEventListener('gc:select', function (e) {
    if (e.detail) applySelection(e.detail.card, e.detail.amount);
  });

  // Initial state: a form saved before login, else the URL, else the defaults in the markup
  var params = new URLSearchParams(window.location.search);
  if (restoreDraft()) { /* back from the login page with the form as it was */ }
  else if (params.get('card') || params.get('amount')) applySelection(params.get('card'), params.get('amount'));
  else render();
})();

/* Gift Cards page: "Already have a card?" balance check (#check-balance).
   There is no balance lookup in the project yet, so this only validates the
   code and hands it off. To connect it, listen for "gc:check-balance" on
   document, call event.preventDefault() to say you are handling it, look the
   code up (for example with a Supabase rpc), then call detail.done():
     done({ ok: true, balance: 30000 })
     done({ ok: false, message: 'We could not find that code.' })
   If nothing handles the event, the page shows a "not available yet" message. */
(function () {
  'use strict';

  var form = document.getElementById('gc-bal-form');
  if (!form) return;
  var input = document.getElementById('gc-bal-code');
  var button = form.querySelector('.gc-bal-btn');
  var out = document.getElementById('gc-bal-result');

  function naira(n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }

  // The two designs show different example codes
  var phones = window.matchMedia('(max-width: 768px)');
  function placeholder() { input.setAttribute('placeholder', phones.matches ? 'ST-XXXX-XXXX-XXXX' : 'e.g. ST-7892-4410-9921'); }
  placeholder();
  if (phones.addEventListener) phones.addEventListener('change', placeholder);

  function show(kind, text) {
    out.hidden = !text;
    out.textContent = text || '';
    out.classList.toggle('is-success', kind === 'success');
    out.classList.toggle('is-error', kind === 'error');
    if (kind === 'error') input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function busy(on) {
    button.disabled = on;
    form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  input.addEventListener('input', function () { if (input.getAttribute('aria-invalid')) show('', ''); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = input.value.toUpperCase().replace(/\s+/g, '');
    var chars = code.replace(/-/g, '');

    if (!chars) { show('error', 'Enter your voucher code.'); input.focus(); return; }
    if (!/^[A-Z0-9-]+$/.test(code) || chars.length < 12 || chars.length > 16) {
      show('error', 'That code doesn\u2019t look right. Check it and try again.');
      input.focus();
      return;
    }

    busy(true);
    show('', 'Checking your balance\u2026');
    var finished = false;
    function done(result) {
      if (finished) return;
      finished = true;
      busy(false);
      if (result && result.ok) show('success', 'Available balance: ' + naira(result.balance));
      else show('error', (result && result.message) || 'We could not find that code. Check it and try again.');
    }

    var handled = !document.dispatchEvent(new CustomEvent('gc:check-balance', {
      cancelable: true,
      detail: { code: code, done: done }
    }));
    if (!handled) done({ ok: false, message: 'Balance checks are not available yet. Please try again soon.' });
  });
})();

/* Gift Cards page: connects the "Already have a card?" box to the gift-card-redeem
   Edge Function. The server decides everything; this only asks and shows the answer. */
(function () {
  'use strict';
  var URL_ = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/gift-card-redeem';
  var KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';

  document.addEventListener('gc:check-balance', function (e) {
    e.preventDefault();
    var done = e.detail.done;
    fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ action: 'check', code: e.detail.code })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) { return { status: res.status, d: d }; });
    }).then(function (out) {
      var d = out.d || {};
      if (out.status === 200) {
        if (d.status === 'redeemed') done({ ok: false, message: 'This card has already been redeemed.' });
        else if (d.status === 'void') done({ ok: false, message: 'This card is no longer valid.' });
        else done({ ok: true, balance: d.balance });
        return;
      }
      done({ ok: false, message: d.error || 'We could not check that code. Please try again.' });
    }).catch(function () {
      done({ ok: false, message: 'We could not reach the server. Check your connection and try again.' });
    });
  });
})();

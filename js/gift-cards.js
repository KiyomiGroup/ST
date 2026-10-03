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
   When the form is valid it fires a "gc:checkout" event on document with the
   order details; hook the payment step to that event. */
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

  var state = { theme: 'cleaning', amount: 30000, custom: false };

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
    sum('total').textContent = amountText;

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
    if (card) setTheme(card === 'cleaning' ? 'cleaning' : 'general');
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var bad = validate();
    if (bad) { bad.focus(); return; }
    document.dispatchEvent(new CustomEvent('gc:checkout', {
      detail: {
        theme: state.theme,
        amount: state.amount,
        delivery: checked('delivery'),
        recipientName: val(nameEl),
        recipientContact: val(contactEl),
        senderName: val(senderEl),
        message: val(noteEl),
        sendOn: timingEl.value === 'later' ? dateEl.value : 'now'
      }
    }));
  });

  // The category cards fire this before they navigate
  document.addEventListener('gc:select', function (e) {
    if (e.detail) applySelection(e.detail.card, e.detail.amount);
  });

  // Initial state from the URL, otherwise the defaults in the markup
  var params = new URLSearchParams(window.location.search);
  if (params.get('card') || params.get('amount')) applySelection(params.get('card'), params.get('amount'));
  else render();
})();

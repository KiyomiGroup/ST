/* Gift Cards page: the mobile "See more options" button and the corporate enquiry form.
   The form is checked here for convenience and again on the server. */
(function () {
  'use strict';

  /* ── Mobile: show 4 category cards, the rest behind a button ── */
  var tiles = document.getElementById('gc-tiles');
  if (tiles && window.matchMedia) {
    var mq = window.matchMedia('(max-width: 768px)');
    var more = tiles.querySelectorAll('.gc-tile[data-more]').length;
    var wrap = document.createElement('div');
    wrap.className = 'gc-tiles-more';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn gc-btn gc-btn-dark';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'gc-tiles');
    wrap.appendChild(btn);
    tiles.parentNode.insertBefore(wrap, tiles.nextSibling);

    var label = function () { btn.textContent = tiles.classList.contains('is-expanded') ? 'Show fewer options' : 'See ' + more + ' more options'; };
    var apply = function () {
      if (mq.matches && more > 0) { tiles.classList.add('gc-tiles--collapsible'); wrap.hidden = false; }
      else { tiles.classList.remove('gc-tiles--collapsible', 'is-expanded'); wrap.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
      label();
    };
    btn.addEventListener('click', function () {
      var open = tiles.classList.toggle('is-expanded');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      label();
    });
    if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
    apply();
  }

  /* ── Corporate enquiry form ── */
  var form = document.getElementById('gc-corp-form');
  if (!form) return;
  var FN = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/gift-card-corporate';
  var KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
  var err = document.getElementById('gc-corp-error');
  var done = document.getElementById('gc-corp-done');
  var submit = document.getElementById('gc-corp-submit');

  function showError(msg, field) {
    err.textContent = msg; err.hidden = false;
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
    var f = form.elements;
    var company = f.company.value.trim(), name = f.contact_name.value.trim(), email = f.email.value.trim();
    if (!company) return showError('Enter your company name.', f.company);
    if (!name) return showError('Enter your name.', f.contact_name);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Enter a valid work email.', f.email);

    submit.disabled = true; submit.textContent = 'Sending\u2026';
    fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        company: company, contactName: name, email: email, phone: f.phone.value.trim(),
        quantity: f.quantity.value, budget: f.budget.value.trim(), message: f.message.value.trim(), website: f.website.value
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, d: d }; });
    }).then(function (out) {
      if (!out.ok) { submit.disabled = false; submit.textContent = 'Send Enquiry'; showError(out.d.error || 'We could not send that. Please try again.'); return; }
      form.querySelectorAll('input, select, textarea').forEach(function (n) { n.disabled = true; });
      submit.hidden = true; done.hidden = false; done.focus && done.setAttribute('tabindex', '-1'); done.focus();
    }).catch(function () {
      submit.disabled = false; submit.textContent = 'Send Enquiry';
      showError('We could not reach the server. Check your connection and try again.');
    });
  });
})();

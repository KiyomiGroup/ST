/* Local Taskers donation form: asks the donate-checkout Edge Function for a Paystack link, then sends the visitor there.
   The amount is checked again on the server. The receipt is emailed by the server once Paystack confirms the payment. */
(function () {
  'use strict';
  var form = document.getElementById('lt-donate-form');
  if (!form) return;
  var FUNCTIONS_URL = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/';
  var ANON_KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
  var MIN = 500, MAX = 5000000;
  var btn = document.getElementById('lt-donate-btn');
  var err = document.getElementById('lt-donate-error');
  var other = document.getElementById('lt-other');
  var otherWrap = document.getElementById('lt-other-wrap');
  var emailEl = document.getElementById('lt-demail');
  var nameEl = document.getElementById('lt-dname');
  var BTN_TEXT = btn.textContent;

  function showError(msg) { err.textContent = msg; err.hidden = false; }
  function clearError() { err.hidden = true; err.textContent = ''; }
  function setBusy(b) { btn.disabled = b; btn.textContent = b ? 'Taking you to Paystack\u2026' : BTN_TEXT; }
  function chosen() {
    var r = form.querySelector('input[name="lt-amt"]:checked');
    return r ? r.value : '5000';
  }

  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'lt-amt') {
      var isOther = chosen() === 'other';
      otherWrap.hidden = !isOther;
      if (isOther) other.focus();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();
    var raw = chosen() === 'other' ? other.value.replace(/[,\s\u20A6]/g, '') : chosen();
    if (!/^\d+$/.test(raw)) { showError('Enter the amount as whole naira, for example 15000.'); other.focus(); return; }
    var amount = parseInt(raw, 10);
    if (amount < MIN) { showError('The smallest donation is \u20A6500.'); return; }
    if (amount > MAX) { showError('For gifts above \u20A65,000,000, please email contact@streettasker.com.'); return; }
    var email = emailEl.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Enter an email address so we can send your receipt.'); emailEl.focus(); return; }

    setBusy(true);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 25000);
    fetch(FUNCTIONS_URL + 'donate-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
      body: JSON.stringify({ amount: amount, email: email, name: nameEl.value.trim() }),
      signal: ctrl.signal
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (out) {
      var url = out.data && out.data.authorization_url;
      if (out.ok && typeof url === 'string' && url.indexOf('https://checkout.paystack.com/') === 0) {
        window.location.assign(url);
        return;
      }
      setBusy(false);
      showError((out.data && out.data.error) || 'We could not start the payment. Please try again, or use the bank transfer details below.');
    }).catch(function () {
      clearTimeout(timer);
      setBusy(false);
      showError('We could not reach the payment service. Please check your connection and try again, or use the bank transfer details below.');
    });
  });

  /* Back from Paystack */
  if (/[?&]donation=thanks\b/.test(window.location.search)) {
    var t = document.getElementById('lt-donate-thanks');
    if (t) { t.hidden = false; }
  }
})();

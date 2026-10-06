/* ============================================================
   STREETTASKER — wallet-ui.js
   UI only. Sets which role's wallet the page shows. No data, no payments.

   Order of precedence for the role:
   1. ?role=tasker or ?role=customer in the URL (for previewing the design)
   2. localStorage "st_role" (the key auth.js already writes at login)
   3. customer

   NOTE FOR WHOEVER CONNECTS THIS PAGE:
   - Replace step 1 with the real session role before going live, and send
     customers who are not logged in to login.html.
   - Never rely on this attribute to protect withdrawals. It only hides UI.
     Tasker-only actions must be checked on the server.
   ============================================================ */
(function () {
  'use strict';

  var page = document.getElementById('walletPage');
  if (!page) return;

  function resolveRole() {
    var fromUrl = new URLSearchParams(window.location.search).get('role');
    if (fromUrl === 'tasker' || fromUrl === 'customer') return fromUrl;
    var stored = null;
    try { stored = localStorage.getItem('st_role'); } catch (e) { /* storage blocked */ }
    return stored === 'tasker' ? 'tasker' : 'customer';
  }

  page.setAttribute('data-role', resolveRole());

  // Gift card progress bars: width comes from data-pct (0 to 100).
  page.querySelectorAll('.wl-gc-fill[data-pct]').forEach(function (bar) {
    var pct = parseFloat(bar.getAttribute('data-pct'));
    if (!isNaN(pct)) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  });

  // Copy gift card code. Reads data-copy (the full code); swap in real codes when connecting.
  page.addEventListener('click', function (e) {
    var btn = e.target.closest('.wl-gc-copy');
    if (!btn) return;
    var code = btn.getAttribute('data-copy') || '';
    function done() {
      btn.classList.add('is-copied');
      btn.setAttribute('aria-label', 'Code copied');
      setTimeout(function () {
        btn.classList.remove('is-copied');
        btn.setAttribute('aria-label', 'Copy gift card code');
      }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { /* clipboard blocked */ });
    }
  });
  // Ledger filters (section 5). Each button has data-filter; each row lists the
  // filters it belongs to in data-types. This only hides rows already on the page,
  // so when the ledger is connected to real data, fetch the filtered page instead.
  page.addEventListener('click', function (e) {
    var btn = e.target.closest('.wl-filter');
    if (!btn) return;
    var group = btn.closest('.wl-filters');
    var pane = document.getElementById(group.getAttribute('aria-controls'));
    if (!pane) return;
    var key = btn.getAttribute('data-filter');

    group.querySelectorAll('.wl-filter').forEach(function (b) {
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });

    var shown = 0;
    pane.querySelectorAll('.wl-tx').forEach(function (row) {
      var types = (row.getAttribute('data-types') || '').split(' ');
      var match = key === 'all' || types.indexOf(key) !== -1;
      row.hidden = !match;
      if (match) shown++;
    });

    var shownEl = pane.querySelector('[data-wl-shown]');
    var totalEl = pane.querySelector('[data-wl-total]');
    var all = key === 'all';
    if (shownEl) shownEl.textContent = shown;
    // Filtered views only know the rows on this page, so the total matches what is shown
    if (totalEl) totalEl.textContent = all ? pane.getAttribute('data-total') : shown;
    var plural = pane.querySelector('[data-wl-plural]');
    if (plural) plural.textContent = (all ? parseInt(pane.getAttribute('data-total'), 10) : shown) === 1 ? '' : 's';
    var empty = pane.querySelector('.wl-led-empty');
    if (empty) empty.hidden = shown !== 0;
  });

  // ── Withdrawal popup (section 7) ─────────────────────────────────────────
  // UI only. Nothing is sent. On confirm it fires a "wallet:withdraw" event on
  // #walletPage with {amount} (whole naira). Connect the real transfer there,
  // and check the amount, limit and balance again on the server.
  // "Change Account" buttons fire "wallet:change-account" the same way.
  var modal = document.getElementById('withdrawModal');
  if (modal) {
    var input = document.getElementById('wdAmount');
    var field = modal.querySelector('[data-wd-field]');
    var errorEl = document.getElementById('wdError');
    var continueBtn = modal.querySelector('[data-wd-continue]');
    var confirmBtn = modal.querySelector('[data-wd-confirm]');
    var stepLine = modal.querySelector('[data-wd-stepline]');
    var min = parseInt(modal.getAttribute('data-min'), 10) || 0;
    var limit = parseInt(modal.getAttribute('data-limit'), 10) || 0;
    var opener = null;
    var amount = 0;
    var STEP_TEXT = { 1: 'Step 1 of 2 \u2022 Enter amount', 2: 'Step 2 of 2 \u2022 Review', 3: 'All done' };

    function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    function digits(str) { return parseInt(String(str).replace(/[^0-9]/g, ''), 10) || 0; }
    function available() {
      var el = page.querySelector('[data-wl-value="available"]');
      return el ? digits(el.textContent) : 0;
    }
    function setAll(name, value) {
      modal.querySelectorAll('[data-wd="' + name + '"]').forEach(function (el) { el.textContent = value; });
    }
    function showStep(n) {
      modal.querySelectorAll('[data-wd-step]').forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-wd-step') !== String(n);
      });
      stepLine.textContent = STEP_TEXT[n];
    }
    function problem(value, avail) {
      if (avail < min) return 'You need at least \u20A6' + money(min) + ' available to withdraw.';
      if (value < min) return 'The minimum withdrawal is \u20A6' + money(min) + '.';
      if (value > avail) return 'That is more than your available balance of \u20A6' + money(avail) + '.';
      if (value > limit) return 'The daily instant limit is \u20A6' + money(limit) + '.';
      return '';
    }
    function validate(showEmpty) {
      var value = digits(input.value);
      var msg = (value === 0 && !showEmpty) ? '' : problem(value, available());
      errorEl.textContent = msg;
      field.classList.toggle('has-error', msg !== '');
      input.setAttribute('aria-invalid', msg !== '' ? 'true' : 'false');
      continueBtn.disabled = value === 0 || problem(value, available()) !== '';
    }

    function open(trigger) {
      opener = trigger || null;
      input.value = '';
      amount = 0;
      confirmBtn.disabled = false;
      setAll('available', money(available()));
      showStep(1);
      validate(false);
      if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
      document.documentElement.classList.add('wl-lock');
      // If there is nothing to withdraw, say so straight away
      if (available() < min) validate(true);
      input.focus();
    }
    function close() {
      if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
      cleanup();
    }
    function cleanup() {
      document.documentElement.classList.remove('wl-lock');
      if (opener && typeof opener.focus === 'function') opener.focus();
      opener = null;
    }

    page.addEventListener('click', function (e) {
      var change = e.target.closest('[data-action="change-account"]');
      if (change) {
        page.dispatchEvent(new CustomEvent('wallet:change-account', { bubbles: true }));
        return;
      }
      var trigger = e.target.closest('[data-action="withdraw"]');
      if (trigger && page.getAttribute('data-role') === 'tasker') open(trigger);
    });

    input.addEventListener('input', function () {
      var value = digits(input.value);
      input.value = value ? money(value) : '';
      validate(false);
    });
    modal.querySelectorAll('[data-wd-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var value = Math.min(Math.floor(available() * parseFloat(btn.getAttribute('data-wd-preset'))), limit);
        input.value = value ? money(value) : '';
        validate(true);
        input.focus();
      });
    });

    // Step 1 -> 2 (Enter in the amount field also submits the form)
    document.getElementById('wdStep1').addEventListener('submit', function (e) {
      e.preventDefault();
      validate(true);
      if (continueBtn.disabled) return;
      amount = digits(input.value);
      setAll('amount', money(amount));
      setAll('receive', money(amount)); // fee is free today; subtract it here if that changes
      showStep(2);
      confirmBtn.focus();
    });
    modal.querySelector('[data-wd-back]').addEventListener('click', function () {
      showStep(1);
      input.focus();
    });
    confirmBtn.addEventListener('click', function () {
      confirmBtn.disabled = true; // stops a double tap sending the request twice
      page.dispatchEvent(new CustomEvent('wallet:withdraw', { bubbles: true, detail: { amount: amount } }));
      showStep(3);
      modal.querySelector('.wl-wd-done-title').focus();
    });

    modal.querySelectorAll('[data-wd-close]').forEach(function (btn) { btn.addEventListener('click', close); });
    // Click on the dim area outside the box closes it
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    // Esc closes it through the browser; keep the page unlocked either way
    modal.addEventListener('close', cleanup);
  }
})();

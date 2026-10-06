/* ============================================================
   STREETTASKER — wallet-ui.js
   Sets which role's wallet the page shows, plus small UI helpers. Real data and
   withdrawals live in js/wallet-data.js.

   Order of precedence for the role:
   1. ?role=tasker or ?role=customer in the URL (for previewing the design)
   2. localStorage "st_role" (the key auth.js already writes at login)
   3. customer

   NOTE: this is only the first guess, so the page can draw before the network
   answers. js/wallet-data.js then sets the real role from the signed-in session,
   and that always wins over the URL and the cache.

   OLD NOTE (kept for reference):
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
  // Ledger filters for the static gift card list (customer). The tasker ledger is live, see wallet-data.js. Each button has data-filter; each row lists the
  // filters it belongs to in data-types. This only hides rows already on the page,
  // so when the ledger is connected to real data, fetch the filtered page instead.
  page.addEventListener('click', function (e) {
    var btn = e.target.closest('.wl-filter');
    if (!btn) return;
    var group = btn.closest('.wl-filters');
    var pane = document.getElementById(group.getAttribute('aria-controls'));
    if (!pane || pane.hasAttribute('data-live')) return; // live panes are handled by wallet-data.js
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

})();

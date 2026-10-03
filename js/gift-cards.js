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

/* ============================================================
   StreetTasker — coordinator-wallet-tile.js (Stage 7F)
   The wallet balance on coordinator-dashboard.html.

   Reads ONLY the signed-in coordinator's own `wallets` row, the same table the tasker wallet reads (the existing
   row-level rule lets a person read their own wallet only). It never creates a wallet and never changes anything:
   money moves only on wallet.html, through the server. If the balance cannot be read it shows a dash and a
   message, never a made-up number. A coordinator with no wallet row yet has a balance of 0.

   Runs on the `coordinator:ready` event from js/coordinator.js (after the route guard passed).
   Renders with textContent only.
   ============================================================ */
'use strict';

(function () {
  function $(id) { return document.getElementById(id); }

  function naira(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) return null;
    return '\u20A6' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function show(text, note) {
    var value = $('coWalletBalance'), box = $('coWalletNote');
    if (value) value.textContent = text;
    if (box) { box.textContent = note || ''; box.hidden = !note; }
  }

  async function load(detail) {
    show('\u2014', '');
    try {
      var res = await window.supabase.from('wallets').select('balance').eq('user_id', detail.userId).maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { show(naira(0), ''); return; }            // no wallet row yet: nothing earned
      var text = naira(res.data.balance);
      if (text === null) throw new Error('unreadable balance');
      show(text, '');
    } catch (e) {
      console.error('[coordinator wallet]', e);
      show('\u2014', 'We couldn\u2019t load your wallet balance just now. Open your wallet to see it.');
    }
  }

  document.addEventListener('coordinator:ready', function (e) { load(e.detail); });
})();

/* Wallet page: the customer's real gift cards, the gift card total, and the gift card ledger.
   Reads only what the database lets this user see (their own redeemed cards and those cards'
   transactions). Spending never happens here: it happens at booking checkout, on the server. */
(function () {
  'use strict';
  var sb = window.supabase;
  var grid = document.querySelector('.wl-gc-grid');
  if (!sb || !grid) return;

  var KINDS = {
    cleaning: { cat: 'Home Services', title: 'Deep Home Cleaning Voucher', icon: '#i-broom', lock: 'Cleaning tasks',
      desc: 'Valid for standard cleaning, deep scrub, or post-construction janitorial tasks.' },
    handyman: { cat: 'Home Repairs', title: 'Handyman & Repairs Voucher', icon: '#i-wrench', lock: 'Handyman & repair tasks',
      desc: 'Valid for plumbing, electrical, carpentry, painting and mechanic jobs.' },
    moving:   { cat: 'Moving', title: 'Moving & Heavy Lifting Voucher', icon: '#i-wrench', lock: 'Moving & delivery tasks',
      desc: 'Valid for relocation, furniture haulage, packing and delivery.' },
    wardrobe: { cat: 'Fashion & Style', title: 'Wardrobe & Tailoring Voucher', icon: '#i-shirt', lock: 'Wardrobe & tailoring tasks',
      desc: 'Valid for fittings, alterations and tailoring.' },
    tech:     { cat: 'Tech & Power', title: 'Tech & Inverter Voucher', icon: '#i-wrench', lock: 'Tech & inverter tasks',
      desc: 'Valid for inverter, solar, WiFi and smart security jobs.' },
    universal:{ cat: 'Universal', title: 'Universal StreetTasker Voucher', icon: '#i-gift', lock: 'any booking',
      desc: 'Valid on any task or verified professional.' }
  };
  function kind(c) { return KINDS[c.category] || KINDS.universal; }
  function naira(n) { return '\u20A6' + Math.round(n).toLocaleString('en-NG'); }
  function q(root, sel) { return root.querySelector(sel); }
  function setText(root, sel, text) { var n = q(root, sel); if (n) n.textContent = text; }
  function mask(code) { return code.replace(/-[A-Z0-9]{4}$/, '-****'); }

  var template = q(grid, '.wl-gc[data-wl-giftcard]');
  var templateHtml = template ? template.cloneNode(true) : null;

  function renderCard(c) {
    var k = kind(c), a = templateHtml.cloneNode(true);
    var pct = c.amount > 0 ? Math.max(0, Math.min(100, Math.round((c.balance / c.amount) * 1000) / 10)) : 0;
    var useEl = q(a, '.wl-gc-icon use'); if (useEl) useEl.setAttribute('href', k.icon);
    var ic = q(a, '.wl-gc-icon'); if (ic) ic.classList.toggle('wl-gc-icon-on', c.balance > 0);
    setText(a, '.wl-gc-exp', 'No expiry');
    setText(a, '.wl-gc-exp-short', 'No expiry');
    setText(a, '.wl-gc-cat', k.cat);
    setText(a, '.wl-gc-title', k.title);
    setText(a, '.wl-gc-desc', k.desc);
    setText(a, '.wl-gc-code strong', c.code);
    setText(a, '.wl-gc-left strong', naira(c.balance));
    setText(a, '.wl-gc-orig .wl-desk', 'Original: ' + naira(c.amount));
    setText(a, '.wl-gc-orig .wl-mob', 'left of ' + naira(c.amount));
    var bar = q(a, '.wl-gc-bar'); if (bar) bar.setAttribute('aria-valuenow', String(pct));
    var fill = q(a, '.wl-gc-fill'); if (fill) { fill.setAttribute('data-pct', String(pct)); fill.style.width = pct + '%'; }
    setText(a, '.wl-gc-avail', pct + '% Available');
    var stats = q(a, '.wl-gc-stats'); if (stats && stats.children[1]) stats.children[1].textContent = naira(c.amount - c.balance) + ' applied';
    var lock = q(a, '.wl-gc-lock-text');
    if (lock) {
      Array.prototype.slice.call(lock.childNodes).forEach(function (n) { if (n.nodeType === 3) lock.removeChild(n); });
      lock.appendChild(document.createTextNode(c.category ? 'Usable exclusively on ' + k.lock : 'Usable on any booking'));
    }
    setText(a, '.wl-gc-codechip code', mask(c.code));
    var copy = q(a, '.wl-gc-copy'); if (copy) copy.setAttribute('data-copy', c.code);
    var link = q(a, '.wl-gc-foot .wl-link');
    if (link) {
      link.setAttribute('href', 'find-services.html');
      Array.prototype.slice.call(link.childNodes).forEach(function (n) { if (n.nodeType === 3) n.nodeValue = 'Use on a booking'; });
    }
    return a;
  }

  function renderCards(cards) {
    grid.textContent = '';
    if (!templateHtml || cards.length === 0) {
      var p = document.createElement('p');
      p.className = 'wl-sec-sub';
      p.textContent = 'No gift cards yet. When someone gives you one, redeem it and it will appear here.';
      grid.appendChild(p);
      return;
    }
    cards.forEach(function (c) { grid.appendChild(renderCard(c)); });
  }

  function renderTotal(cards) {
    var total = cards.reduce(function (s, c) { return s + c.balance; }, 0);
    var live = cards.filter(function (c) { return c.balance > 0; }).length;
    var num = document.querySelector('[data-wl-value="giftcards"]');
    if (num) {
      num.textContent = Math.floor(total).toLocaleString('en-NG');
      var dec = num.parentNode.querySelector('.wl-amt-dec'); if (dec) dec.textContent = '.00';
    }
    var note = document.querySelector('[data-wl-value="giftcards-count"]');
    if (note) note.textContent = live === 0 ? 'No gift cards with a balance' : 'Across ' + live + ' gift card' + (live === 1 ? '' : 's');
  }

  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function renderLedger(txns, byId) {
    var pane = document.getElementById('ledgerCustomer');
    if (!pane) return;
    var list = q(pane, '.wl-tx-list');
    var rows = txns.filter(function (t) { return t.type === 'redeemed' || t.type === 'spend' || t.type === 'refund'; }).slice(0, 50);
    list.textContent = '';
    rows.forEach(function (t) {
      var c = byId[t.gift_card_id], k = c ? kind(c) : KINDS.universal;
      var spend = t.type === 'spend';
      var li = document.createElement('li'); li.className = 'wl-tx'; li.setAttribute('data-types', spend ? 'spend' : 'topup');
      var icon = document.createElement('span'); icon.className = 'wl-tx-icon wl-tx-icon-mint'; icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg class="wl-i"><use href="' + (spend ? '#i-credit-card' : '#i-plus-circle') + '"/></svg>';
      var main = document.createElement('div'); main.className = 'wl-tx-main';
      var title = document.createElement('p'); title.className = 'wl-tx-title';
      var t1 = document.createElement('span');
      t1.textContent = (spend ? 'Gift Card Applied: ' : t.type === 'refund' ? 'Gift Card Refund: ' : 'Gift Card Added: ') + k.title.replace(' Voucher', '');
      var badge = document.createElement('span'); badge.className = 'wl-badge wl-badge-mint'; badge.textContent = spend ? 'Applied' : 'Completed';
      title.appendChild(t1); title.appendChild(badge);
      var meta = document.createElement('p'); meta.className = 'wl-tx-meta';
      meta.textContent = (c ? 'Voucher ' + mask(c.code) + ' \u2022 ' : '') + (spend ? 'Applied to a booking' : t.type === 'refund' ? 'Returned to the card' : 'Added to your wallet');
      main.appendChild(title); main.appendChild(meta);
      var side = document.createElement('div'); side.className = 'wl-tx-side';
      var amt = document.createElement('p'); amt.className = 'wl-tx-amt is-credit';
      amt.textContent = (spend ? '-' : '+') + '\u20A6' + Number(t.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 });
      var date = document.createElement('p'); date.className = 'wl-tx-date'; date.textContent = when(t.created_at);
      side.appendChild(amt); side.appendChild(date);
      li.appendChild(icon); li.appendChild(main); li.appendChild(side);
      list.appendChild(li);
    });
    pane.setAttribute('data-total', String(rows.length));
    var shown = q(pane, '[data-wl-shown]'), total = q(pane, '[data-wl-total]'), plural = q(pane, '[data-wl-plural]');
    if (shown) shown.textContent = rows.length; if (total) total.textContent = rows.length;
    if (plural) plural.textContent = rows.length === 1 ? '' : 's';
    var prev = q(pane, '[data-action="ledger-prev"]'), next = q(pane, '[data-action="ledger-next"]');
    if (prev) prev.disabled = true; if (next) next.disabled = true;
    var empty = q(pane, '.wl-led-empty');
    if (!empty) { empty = document.createElement('p'); empty.className = 'wl-led-empty'; list.parentNode.insertBefore(empty, list.nextSibling); }
    empty.textContent = rows.length === 0 ? 'No gift card activity yet.' : '';
    empty.hidden = rows.length !== 0;
  }

  sb.auth.getSession().then(function (r) {
    var user = r && r.data && r.data.session && r.data.session.user;
    if (!user) return;
    return Promise.all([
      sb.from('gift_cards').select('id,code,amount,balance,category,theme,redeemed_at').eq('redeemed_by', user.id).order('redeemed_at', { ascending: false }),
      sb.from('gift_card_transactions').select('gift_card_id,type,amount,created_at').order('created_at', { ascending: false }).limit(100)
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      var cards = (res[0].data || []).map(function (c) { c.balance = Number(c.balance); c.amount = Number(c.amount); return c; });
      cards.sort(function (a, b) { return (b.balance > 0) - (a.balance > 0); });   // cards with money first
      var byId = {}; cards.forEach(function (c) { byId[c.id] = c; });
      renderCards(cards);
      renderTotal(cards);
      var page = document.querySelector('[data-role]');
      if (page && page.getAttribute('data-role') === 'tasker') return;   // taskers' ledger is built by wallet-data.js
      renderLedger(res[1].data || [], byId);
    });
  }).catch(function (e) { console.warn('[Wallet] gift cards could not load:', e && e.message); });
})();

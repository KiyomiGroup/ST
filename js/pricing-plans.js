/* StreetTasker: pricing page plan cards (S4b).
   Reads plans from the database (get_public_plans) and, for a signed-in person, their current plan (get_my_entitlements).
   No price, limit or plan name is written in this file. Nothing here changes a subscription: the paid-plan button calls
   StPricing.onChoose(planKey) when S5d provides it, and until then says that checkout is not open yet. */
(function () {
  'use strict';

  var POPULAR_KEY = 'professional';          // which plan gets "Most popular" (a label choice, not a limit)
  var ANALYTICS_TEXT = { none: 'No analytics', basic: 'Basic analytics', advanced: 'Advanced analytics', business: 'Business analytics' };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function naira(kobo) {
    var v = Math.round(Number(kobo) / 100);
    return '\u20A6' + v.toLocaleString('en-NG');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function featureLines(p) {
    var f = p.features || {};
    var lines = [];
    lines.push({ on: true, text: p.offers_per_month == null ? 'Unlimited offers (fair use applies)' : plural(p.offers_per_month, 'offer', 'offers') + ' per month' });
    lines.push({ on: true, text: plural(p.listing_limit, 'service listing', 'service listings') });
    var a = f.analytics || 'none';
    lines.push({ on: a !== 'none', text: ANALYTICS_TEXT[a] || ANALYTICS_TEXT.basic });
    lines.push({ on: !!f.featured_placement, text: 'Featured placement' });
    lines.push({ on: !!f.priority_recommendation, text: 'Priority recommendations' });
    lines.push({ on: !!f.priority_support, text: 'Priority support' });
    lines.push({ on: !!f.early_access, text: 'Early access to new features' });
    lines.push({ on: !!f.expanded_portfolio, text: 'Expanded portfolio' });
    return lines;
  }

  function showNotice(msg) {
    var n = document.getElementById('pricingNotice');
    if (!n) return;
    n.textContent = msg;
    n.hidden = false;
  }

  function loginUrl() {
    return 'login.html?redirect=' + encodeURIComponent('subscription.html');
  }

  function ctaFor(p, ctx) {
    var onDark = p.membership_label === 'PREMIUM';   // the Business card is dark: its buttons use the light style
    var outline = onDark ? 'btn-mint' : 'btn-outline';
    var paid = Number(p.price_kobo) > 0;
    var isCurrent = ctx.currentKey && ctx.currentKey === p.plan_key;
    var cta;
    if (isCurrent) {
      cta = el('button', 'btn ' + outline + ' btn-lg', 'Your current plan');
      cta.type = 'button'; cta.disabled = true;
    } else if (!ctx.signedIn) {
      cta = el('a', 'btn btn-lg ' + (p.plan_key === POPULAR_KEY ? 'btn-primary' : outline), paid ? 'Log in to choose' : 'Start free');
      cta.href = paid ? loginUrl() : 'signup.html';
    } else if (!paid) {
      cta = el('a', 'btn ' + outline + ' btn-lg', 'Manage your plan');
      cta.href = 'my-subscription.html';
      cta.hidden = !ctx.hasManagePage;
    } else {
      cta = el('button', 'btn btn-lg ' + (p.plan_key === POPULAR_KEY ? 'btn-primary' : outline), 'Choose ' + p.name);
      cta.type = 'button';
      cta.addEventListener('click', function () {
        var hook = window.StPricing && window.StPricing.onChoose;
        if (typeof hook === 'function') hook(p.plan_key);
        else showNotice('Plan checkout is not open yet. Nothing was charged and your plan has not changed.');
      });
    }
    return cta;
  }

  function buildCard(p, ctx) {
    var card = el('article', 'sub-card');
    var premium = p.membership_label === 'PREMIUM';
    if (p.plan_key === POPULAR_KEY) card.classList.add('sub-card--popular');
    if (premium) card.classList.add('sub-card--premium');
    if (ctx.currentKey === p.plan_key) card.classList.add('sub-card--current');
    card.setAttribute('data-plan', p.plan_key);
    if (p.plan_key === POPULAR_KEY) card.appendChild(el('span', 'sub-card-flag', 'Most popular'));

    var head = el('div', 'sub-card-head');
    var nameWrap = el('h3', 'sub-card-name');
    var nm = el('span', 'membership-name');
    nm.appendChild(el('span', 'membership-name__text', p.name));
    if (p.membership_label === 'PRO' || p.membership_label === 'PREMIUM') {
      nm.appendChild(el('span', 'membership-label membership-label--' + p.membership_label.toLowerCase(), p.membership_label));
    }
    nameWrap.appendChild(nm);
    head.appendChild(nameWrap);

    var price = el('div', 'sub-price');
    price.appendChild(el('span', 'sub-price-amount', naira(p.price_kobo)));
    if (Number(p.price_kobo) > 0) price.appendChild(el('span', 'sub-price-period', '/month'));
    head.appendChild(price);
    card.appendChild(head);

    var ul = el('ul', 'sub-features');
    featureLines(p).forEach(function (l) {
      var li = el('li', 'sub-feature' + (l.on ? '' : ' sub-feature--off'));
      li.appendChild(el('span', 'sub-sr', l.on ? 'Included: ' : 'Not included: '));
      li.appendChild(document.createTextNode(l.text));
      ul.appendChild(li);
    });
    card.appendChild(ul);

    card.appendChild(ctaFor(p, ctx));
    return card;
  }

  function showSkeleton(grid) {
    grid.innerHTML = '';
    grid.setAttribute('aria-busy', 'true');
    for (var i = 0; i < 4; i++) grid.appendChild(el('div', 'sub-skel'));
  }

  function showError(grid) {
    grid.innerHTML = '';
    grid.setAttribute('aria-busy', 'false');
    var box = el('div', 'sub-error');
    box.appendChild(el('p', null, 'We could not load the plans. Check your connection and try again.'));
    var b = el('button', 'btn btn-outline btn-sm', 'Try again');
    b.type = 'button';
    b.addEventListener('click', function () { load(); });
    box.appendChild(b);
    grid.appendChild(box);
  }

  async function currentContext() {
    var ctx = { signedIn: false, currentKey: null, hasManagePage: false };
    try {
      var user = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
      if (!user) return ctx;
      ctx.signedIn = true;
      var r = await window.supabase.rpc('get_my_entitlements');
      if (!r.error && r.data && r.data.plan_key) ctx.currentKey = r.data.plan_key;
    } catch (e) { /* the cards still work without knowing the current plan */ }
    return ctx;
  }

  async function load() {
    var grid = document.getElementById('planGrid');
    if (!grid) return;
    showSkeleton(grid);
    var plans;
    try {
      var r = await window.supabase.rpc('get_public_plans');
      if (r.error || !Array.isArray(r.data) || !r.data.length) { showError(grid); return; }
      plans = r.data.slice().sort(function (a, b) { return (a.sort_order - b.sort_order); });
    } catch (e) { showError(grid); return; }
    var ctx = await currentContext();
    grid.innerHTML = '';
    plans.forEach(function (p) { grid.appendChild(buildCard(p, ctx)); });
    grid.setAttribute('aria-busy', 'false');
  }

  window.StPricing = window.StPricing || { onChoose: null, buildCard: buildCard, featureLines: featureLines, naira: naira };
  window.initPage = load;
})();

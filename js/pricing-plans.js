/* StreetTasker: pricing page plan cards, comparison table, FAQ label sentence and final CTA (S4b-S4d).
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


  /* Comparison table: one row per benefit, one column per plan, built from the same plan rows as the cards. */
  function yes(text) { return { on: true, text: text }; }
  function flag(v) { return { on: !!v, text: v ? 'Included' : 'Not included' }; }
  var COMPARE_ROWS = [
    ['Price per month', function (p) { return { on: true, plain: true, text: Number(p.price_kobo) > 0 ? naira(p.price_kobo) : naira(0) }; }],
    ['Offers per month', function (p) { return { on: true, plain: true, text: p.offers_per_month == null ? 'Unlimited (fair use)' : String(p.offers_per_month) }; }],
    ['Service listings', function (p) { return { on: true, plain: true, text: String(p.listing_limit) }; }],
    ['Analytics', function (p) { var a = (p.features || {}).analytics || 'none'; return { on: a !== 'none', plain: true, text: a === 'none' ? 'None' : (ANALYTICS_TEXT[a] || ANALYTICS_TEXT.basic).replace(' analytics', '') }; }],
    ['Featured placement', function (p) { return flag((p.features || {}).featured_placement); }],
    ['Priority recommendations', function (p) { return flag((p.features || {}).priority_recommendation); }],
    ['Priority support', function (p) { return flag((p.features || {}).priority_support); }],
    ['Early access to new features', function (p) { return flag((p.features || {}).early_access); }],
    ['Expanded portfolio', function (p) { return flag((p.features || {}).expanded_portfolio); }],
    ['Membership label', function (p) { return { on: !!p.membership_label, plain: true, text: p.membership_label || 'None', label: p.membership_label || null }; }]
  ];

  function buildCompare(plans) {
    var t = document.getElementById('compareTable');
    var sec = document.getElementById('compare');
    if (!t || !sec) return;
    t.innerHTML = '';
    var cap = el('caption', 'sub-sr', 'Comparison of plans');
    t.appendChild(cap);
    var thead = el('thead'), hr = el('tr');
    var corner = el('th', null, 'Benefit'); corner.scope = 'col'; hr.appendChild(corner);
    plans.forEach(function (p) {
      var th = el('th', p.plan_key === POPULAR_KEY ? 'sub-col--popular' : null);
      th.scope = 'col';
      var nm = el('span', 'membership-name');
      nm.appendChild(el('span', 'membership-name__text', p.name));
      th.appendChild(nm);
      hr.appendChild(th);
    });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    COMPARE_ROWS.forEach(function (row) {
      var tr = el('tr');
      var h = el('th', null, row[0]); h.scope = 'row'; tr.appendChild(h);
      plans.forEach(function (p) {
        var v = row[1](p);
        var td = el('td', p.plan_key === POPULAR_KEY ? 'sub-col--popular' : null);
        if (v.plain) {
          if (v.label) {
            td.appendChild(el('span', 'membership-label membership-label--sm membership-label--' + v.label.toLowerCase(), v.label));
          } else td.appendChild(document.createTextNode(v.text));
        } else {
          td.className = (td.className ? td.className + ' ' : '') + (v.on ? 'sub-cell-yes' : 'sub-cell-no');
          td.appendChild(el('span', 'sub-sr', v.text));
          td.appendChild(el('span', null, v.on ? '\u2713' : '\u2013')).setAttribute('aria-hidden', 'true');
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    sec.hidden = false;
  }

  /* FAQ 9: which plan shows which label, filled from the plan rows (no plan name is written in the page). */
  function buildFaqLabels(plans) {
    var span = document.getElementById('faqLabelMap');
    if (!span) return;
    var parts = [];
    plans.forEach(function (p) {
      if (p.membership_label === 'PRO' || p.membership_label === 'PREMIUM') parts.push(p.name + ' shows ' + p.membership_label);
    });
    span.textContent = parts.length ? parts.join('; ') + '. ' : '';
  }

  /* Final CTA: a signed-in person already has an account, so "Start free" is hidden for them. */
  function applyFinalCta(ctx) {
    var b = document.getElementById('finalStartFree');
    if (b) b.hidden = !!(ctx && ctx.signedIn);
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
      if (r.error || !Array.isArray(r.data) || !r.data.length) { showError(grid); currentContext().then(applyFinalCta); return; }
      plans = r.data.slice().sort(function (a, b) { return (a.sort_order - b.sort_order); });
    } catch (e) { showError(grid); currentContext().then(applyFinalCta); return; }
    var ctx = await currentContext();
    grid.innerHTML = '';
    plans.forEach(function (p) { grid.appendChild(buildCard(p, ctx)); });
    grid.setAttribute('aria-busy', 'false');
    buildCompare(plans);
    buildFaqLabels(plans);
    applyFinalCta(ctx);
  }

  window.StPricing = window.StPricing || { onChoose: null, buildCard: buildCard, buildCompare: buildCompare, buildFaqLabels: buildFaqLabels, featureLines: featureLines, naira: naira };
  window.initPage = load;
})();

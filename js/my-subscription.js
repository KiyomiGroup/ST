/* StreetTasker: My Subscription page (S4e view, S4f-2 listing chooser, S5d: manage buttons removed).
   Reads get_my_entitlements() (plan, price, period, end date, offers and listings meters, features), get_public_plans() (names)
   and the person's own subscriptions row (only to say that an earlier paid plan has ended).
   No price, limit or plan name is written in this file. Plans never renew by themselves and nothing about a card or bank account
   is saved (owner rule, 2026-11-04), so there are no cancel, undo or lower-plan buttons. The only write on this page is the
   listing chooser, which calls choose_active_listings and re-reads get_my_entitlements(). Nothing here charges money; payment
   happens on the pricing page. The server decides every rule and the page shows its answer. */
(function () {
  'use strict';

  var ANALYTICS_TEXT = { none: 'No analytics', basic: 'Basic analytics', advanced: 'Advanced analytics', business: 'Business analytics' };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function naira(kobo) { return '₦' + Math.round(Number(kobo) / 100).toLocaleString('en-NG'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }); }
    catch (e) { return ''; }
  }

  function show(which) {
    $('mysubLoading').hidden = which !== 'loading';
    $('mysubError').hidden = which !== 'error';
    $('mysubContent').hidden = which !== 'content';
  }

  /* Which state the person is in. Pure function of the entitlements (plus an optional ended-plan row), so it is easy to test. */
  function describeState(e, ended) {
    if (!e.is_paid) return ended ? 'expired' : 'free';
    if (e.status === 'cancelling' || e.cancel_at_period_end) return 'cancelling';
    if (e.status === 'past_due' || e.in_grace) return 'past_due';
    return 'active';
  }

  var STATUS_TEXT = { free: 'Free plan', active: 'Active', past_due: 'Payment overdue', cancelling: 'Ending', expired: 'Free plan' };
  var STATUS_TONE = { free: 'neutral', active: 'success', past_due: 'danger', cancelling: 'warning', expired: 'neutral' };

  function banner(state, e, ended, planNames) {
    var b = $('mysubBanner');
    var msg = '', tone = 'info';
    if (state === 'past_due') {
      msg = 'Your payment for the next period is overdue. Pay again to keep your plan, or you move to the Free plan.';
      tone = 'danger';
    } else if (state === 'cancelling') {
      msg = 'Your plan ends on ' + fmtDate(e.period_end) + ' and will not renew. You keep its benefits until then, then you move to the Free plan.';
      tone = 'warning';
    } else if (state === 'expired') {
      msg = 'Your ' + (planNames[ended.plan] || 'paid') + ' plan ended' + (ended.current_period_end ? ' on ' + fmtDate(ended.current_period_end) : '') + '. You are on the Free plan now.';
    } else if (e.pending_plan && e.pending_change_at) {
      msg = 'Your plan will change to ' + (planNames[e.pending_plan] || 'a lower plan') + ' on ' + fmtDate(e.pending_change_at) + '. Until then you keep everything in your current plan.';
    } else if (state === 'active') {
      msg = 'Your plan does not renew automatically. To continue after ' + fmtDate(e.period_end) + ', you pay again with Paystack. If you do not, you move to the Free plan.';
    }
    b.hidden = !msg;
    b.textContent = msg;
    b.className = 'mysub-banner mysub-banner--' + tone;
  }

  function fact(dl, label, value) {
    var wrap = el('div', 'mysub-fact');
    wrap.appendChild(el('dt', null, label));
    wrap.appendChild(el('dd', null, value));
    dl.appendChild(wrap);
  }

  var ctx = { e: null, user: null };

  function renderActions() {
    var box = $('mysubActions');
    while (box.children.length > 1) box.removeChild(box.lastChild);   /* the only button is the See all plans link */
    $('mysubNote').hidden = true;
  }

  /* ---- listing chooser: shown only when there are more active listings than the plan allows ---- */
  async function renderChooser(e) {
    var card = $('mysubChooser'), l = e.listings || {};
    if (!(l.active > l.limit && l.limit > 0)) { card.hidden = true; return; }
    var rows = [];
    try {
      var r = await window.supabase.from('services').select('id,service_name,listing_status,updated_at')
        .eq('user_id', ctx.user.id).order('updated_at', { ascending: false });
      rows = (r && !r.error && r.data) ? r.data.filter(function (s) { return s.listing_status !== 'paused'; }) : [];
    } catch (x) { rows = []; }
    if (!rows.length) { card.hidden = true; return; }
    $('mysubChooserHelp').textContent = 'Your plan allows ' + plural(l.limit, 'active listing', 'active listings') + ' and you have ' + l.active +
      '. Pick the ones to keep. The others are paused, not deleted, and you can reactivate them if you free a slot or upgrade.';
    var ul = $('mysubChooserList');
    ul.textContent = '';
    var boxes = [];
    function sync() {
      var n = boxes.filter(function (b) { return b.checked; }).length;
      boxes.forEach(function (b) { b.disabled = !b.checked && n >= l.limit; });
      $('mysubChooserSave').disabled = n < 1;
    }
    rows.forEach(function (s, i) {
      var li = el('li'), lab = el('label', 'mysub-choice');
      var cb = el('input'); cb.type = 'checkbox'; cb.value = s.id; cb.checked = i < l.limit;   /* default: most recently updated */
      cb.addEventListener('change', sync);
      boxes.push(cb);
      lab.appendChild(cb); lab.appendChild(el('span', null, s.service_name || 'Untitled listing'));
      li.appendChild(lab); ul.appendChild(li);
    });
    sync();
    var save = $('mysubChooserSave'), err = $('mysubChooserError');
    save.onclick = async function () {
      var ids = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
      save.disabled = true; err.hidden = true;
      try {
        await window.ST.db.chooseActiveListings(ids);
      } catch (x) { err.textContent = x.message || 'Something went wrong. Please try again.'; err.hidden = false; save.disabled = false; return; }
      await load();
      var note = $('mysubNote'); note.className = 'mysub-note'; note.textContent = 'Done. Your chosen listings stay active; the others are paused.'; note.hidden = false;
    };
    card.hidden = false;
  }

  function renderPlan(e, state) {
    var nameEl = $('mysubPlanName');
    nameEl.textContent = '';
    var nm = el('span', 'membership-name');
    nm.appendChild(el('span', 'membership-name__text', e.plan_name));
    if (e.membership_label === 'PRO' || e.membership_label === 'PREMIUM') {
      nm.appendChild(el('span', 'membership-label membership-label--' + e.membership_label.toLowerCase(), e.membership_label));
    }
    nameEl.appendChild(nm);

    var st = $('mysubStatus');
    st.textContent = STATUS_TEXT[state];
    st.className = 'mysub-status mysub-status--' + STATUS_TONE[state];

    var dl = $('mysubFacts');
    dl.textContent = '';
    var paid = !!e.is_paid;
    fact(dl, 'Price', paid ? naira(e.price_kobo) + ' per month' : naira(0));
    fact(dl, paid ? 'Billing period' : 'Current month', fmtDate(e.period_start) + ' to ' + fmtDate(e.period_end));
    if (paid) fact(dl, 'Plan ends', fmtDate(e.period_end));
    else fact(dl, 'Allowance resets', fmtDate(e.period_end));
  }

  function meter(parent, label, used, max, valueText, note) {
    var row = el('div', 'mysub-meter');
    var top = el('div', 'mysub-meter-top');
    top.appendChild(el('span', 'mysub-meter-label', label));
    top.appendChild(el('span', 'mysub-meter-value', valueText));
    row.appendChild(top);
    if (max != null && max > 0) {
      var p = el('progress', 'mysub-progress');
      p.max = max; p.value = Math.min(used, max);
      p.setAttribute('aria-label', label + ': ' + valueText);
      row.appendChild(p);
    }
    if (note) row.appendChild(el('p', 'mysub-meter-note', note));
    parent.appendChild(row);
  }

  function renderUsage(e) {
    var box = $('mysubMeters');
    box.textContent = '';
    var o = e.offers || {};
    if (o.unlimited) {
      meter(box, 'Offers', 0, null, 'Unlimited', 'Fair use applies, so one account cannot flood the platform.');
      if (o.fair_use_day_cap != null) meter(box, 'Offers in the last 24 hours', o.fair_use_day_used || 0, o.fair_use_day_cap,
        (o.fair_use_day_used || 0) + ' of ' + o.fair_use_day_cap);
      if (o.fair_use_month_cap != null) meter(box, 'Offers this period', o.fair_use_month_used || 0, o.fair_use_month_cap,
        (o.fair_use_month_used || 0) + ' of ' + o.fair_use_month_cap);
    } else {
      var note = o.remaining === 0 ? 'You have used your offers for this period. They renew on ' + fmtDate(e.period_end) + '.' : plural(o.remaining, 'offer', 'offers') + ' left.';
      meter(box, 'Offers', o.used, o.allowance, o.used + ' of ' + o.allowance + ' used', note);
    }
    if (o.credits > 0) {
      meter(box, 'Extra offer credits', 0, null, String(o.credits), o.next_credit_expiry ? 'Next credits expire on ' + fmtDate(o.next_credit_expiry) + '.' : '');
    }
    var l = e.listings || {};
    meter(box, 'Active service listings', l.active, l.limit, l.active + ' of ' + l.limit + ' used',
      l.active > l.limit ? 'You have more listings than this plan allows. Nothing is deleted; extra listings are paused after we notify you.'
        : (l.remaining === 0 ? 'All your listing slots are in use.' : plural(l.remaining, 'slot', 'slots') + ' free.'));
  }

  function renderIncludes(e) {
    var ul = $('mysubIncludes');
    ul.textContent = '';
    var f = e.features || {};
    var a = f.analytics || 'none';
    var rows = [
      [a !== 'none', ANALYTICS_TEXT[a] || ANALYTICS_TEXT.basic],
      [!!f.featured_placement, 'Featured placement'],
      [!!f.priority_recommendation, 'Priority recommendations'],
      [!!f.priority_support, 'Priority support'],
      [!!f.early_access, 'Early access to new features'],
      [!!f.expanded_portfolio, 'Expanded portfolio']
    ];
    rows.forEach(function (r) {
      var li = el('li', 'mysub-include' + (r[0] ? '' : ' mysub-include--off'));
      li.appendChild(el('span', 'mysub-sr', r[0] ? 'Included: ' : 'Not included: '));
      li.appendChild(document.createTextNode(r[1]));
      ul.appendChild(li);
    });
  }

  async function endedPlan(user) {
    try {
      var r = await window.supabase.from('subscriptions').select('plan,status,current_period_end')
        .eq('user_id', user.id).in('status', ['expired', 'cancelled']).order('current_period_end', { ascending: false }).limit(1);
      return r && !r.error && r.data && r.data[0] ? r.data[0] : null;
    } catch (x) { return null; }
  }

  async function planNames() {
    var map = {};
    try {
      var r = await window.supabase.rpc('get_public_plans');
      if (!r.error && Array.isArray(r.data)) { r.data.forEach(function (p) { map[p.plan_key] = p.name; }); }
    } catch (x) { /* names are optional */ }
    return map;
  }

  async function load() {
    show('loading');
    var user = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
    if (!user) { window.location.replace('login.html?next=my-subscription.html'); return; }
    var role = null;
    try { role = typeof getUserRole === 'function' ? await getUserRole(user) : null; } catch (x) { /* use cache */ }
    try { role = role || localStorage.getItem('st_role'); } catch (x) { /* storage blocked */ }
    if (role === 'customer') { window.location.replace('my-tasks.html'); return; }

    var e;
    try {
      var r = await window.supabase.rpc('get_my_entitlements');
      if (r.error || !r.data || !r.data.plan_key) { show('error'); return; }
      e = r.data;
    } catch (x) { show('error'); return; }

    ctx.e = e; ctx.user = user;
    var ended = e.is_paid ? null : await endedPlan(user);
    var names = (e.pending_plan || ended) ? await planNames() : {};
    var state = describeState(e, ended);
    renderPlan(e, state);
    banner(state, e, ended, names);
    renderUsage(e);
    renderIncludes(e);
    renderActions(e, state);
    await renderChooser(e);
    show('content');
  }

  var retry = $('mysubRetry');
  if (retry) retry.addEventListener('click', load);
  window.StMySub = { describeState: describeState };
  window.initPage = load;
})();

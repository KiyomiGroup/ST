/* StreetTasker: My Subscription page, read-only view (S4e).
   Reads get_my_entitlements() (plan, price, period, renewal, offers, listings, features), get_public_plans() (names, for a
   scheduled plan change) and the person's own subscriptions row (only to say that an earlier paid plan has ended).
   No price, limit or plan name is written in this file. Nothing here changes a subscription (manage actions are S4f). */
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
      msg = 'Your renewal payment has not gone through. Your plan stays active for a short grace period. After that you move to the Free plan.';
      tone = 'danger';
    } else if (state === 'cancelling') {
      msg = 'Your subscription is cancelled and will not renew. You keep your plan’s benefits until ' + fmtDate(e.period_end) + ', then you move to the Free plan.';
      tone = 'warning';
    } else if (state === 'expired') {
      msg = 'Your ' + (planNames[ended.plan] || 'paid') + ' plan ended' + (ended.current_period_end ? ' on ' + fmtDate(ended.current_period_end) : '') + '. You are on the Free plan now.';
    } else if (e.pending_plan && e.pending_change_at) {
      msg = 'Your plan will change to ' + (planNames[e.pending_plan] || 'a lower plan') + ' on ' + fmtDate(e.pending_change_at) + '. Until then you keep everything in your current plan.';
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
    if (paid && e.renews_at) fact(dl, 'Next renewal', fmtDate(e.renews_at));
    else if (paid && e.cancel_at_period_end) fact(dl, 'Plan ends', fmtDate(e.period_end));
    else if (!paid) fact(dl, 'Allowance resets', fmtDate(e.period_end));
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
      if (!r.error && Array.isArray(r.data)) r.data.forEach(function (p) { map[p.plan_key] = p.name; });
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

    var ended = e.is_paid ? null : await endedPlan(user);
    var names = (e.pending_plan || ended) ? await planNames() : {};
    var state = describeState(e, ended);
    renderPlan(e, state);
    banner(state, e, ended, names);
    renderUsage(e);
    renderIncludes(e);
    show('content');
  }

  var retry = $('mysubRetry');
  if (retry) retry.addEventListener('click', load);
  window.StMySub = { describeState: describeState };
  window.initPage = load;
})();

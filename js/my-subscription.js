/* StreetTasker: My Subscription page (S4e view, S4f-2 listing chooser, S5d: manage buttons removed, S5e-2: Pay again, S5f: payment history and printable receipt).
   Reads get_my_entitlements() (plan, price, period, end date, offers and listings meters, features), get_public_plans() (names)
   and the person's own subscriptions row (only to say that an earlier paid plan has ended).
   No price, limit, window or plan name is written in this file. Plans never renew by themselves and nothing about a card or bank
   account is saved (owner rule, 2026-11-04). To continue, the tasker pays again with Paystack: the page asks the server
   (get_subscription_quote for the CURRENT plan) whether paying again is open (last days of the period, or the grace days) and shows
   the "Pay again" button only when the server says kind = renewal. The button runs ST.payments.payForSubscription(plan key); the
   browser sends only the plan key, the server decides the amount. Afterwards the page re-reads get_my_entitlements() and says the
   plan was extended only if the server's period end moved forward. The other write on this page is the listing chooser
   (choose_active_listings). S5f: the Payment history card reads the person's OWN rows of subscription_receipts (read-only; the
   database allows nothing else) and prints one receipt through the browser's print dialog. The server decides every rule and the page shows its answer. */
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

  function banner(state, e, ended, planNames, quote) {
    var b = $('mysubBanner');
    var msg = '', tone = 'info';
    var canPay = !!(quote && quote.open);
    if (state === 'past_due') {
      msg = 'Your ' + e.plan_name + ' plan ended on ' + fmtDate(e.period_end) + '. ' +
        (canPay ? 'Pay again now to keep it. The new month starts from that date, so you lose no days. If you do not, you move to the Free plan soon.'
                : 'Pay again to keep your plan, or you move to the Free plan soon.');
      tone = 'danger';
    } else if (state === 'cancelling') {
      msg = 'Your plan ends on ' + fmtDate(e.period_end) + ' and will not renew. You keep its benefits until then, then you move to the Free plan.';
      tone = 'warning';
    } else if (state === 'expired') {
      msg = 'Your ' + (planNames[ended.plan] || 'paid') + ' plan ended' + (ended.current_period_end ? ' on ' + fmtDate(ended.current_period_end) : '') + '. You are on the Free plan now.';
    } else if (e.pending_plan && e.pending_change_at) {
      msg = 'Your plan will change to ' + (planNames[e.pending_plan] || 'a lower plan') + ' on ' + fmtDate(e.pending_change_at) + '. Until then you keep everything in your current plan.';
    } else if (state === 'active') {
      msg = canPay
        ? 'Your plan ends on ' + fmtDate(e.period_end) + ' and does not renew automatically. You can pay again now: the new month starts when this one ends, so you lose no days.'
        : 'Your plan does not renew automatically. To continue after ' + fmtDate(e.period_end) + ', you pay again with Paystack. The Pay again button appears here a few days before your plan ends.';
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
  var busy = false;          /* a payment is open on this page */
  var blockPay = false;      /* a payment was made but not confirmed yet: do not offer a second one until the page is reloaded */
  var afterNote = null;      /* a message to show once load() has redrawn the page */

  function setNote(text, tone) {
    var note = $('mysubNote');
    note.textContent = text;
    note.className = 'mysub-note mysub-note--' + (tone || 'success');
    note.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    note.hidden = false;
    if (note.scrollIntoView) { try { note.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (x) { /* older browsers */ } }
  }

  /* Ask the server whether the current plan can be paid again right now. The browser never knows the window or the grace days.
     The argument name of the S5a function was not in the session files, so a few likely names are tried; a "function not found"
     answer moves to the next name, any other answer is final. */
  var QUOTE_ARGS = ['p_plan', 'plan', 'p_plan_key'];
  function notFound(err) {
    return !!err && (err.code === 'PGRST202' || /schema cache|could not find the function/i.test(String(err.message || '')));
  }
  async function getQuote(planKey) {
    var r = null;
    try {
      for (var i = 0; i < QUOTE_ARGS.length; i++) {
        var args = {}; args[QUOTE_ARGS[i]] = planKey;
        r = await window.supabase.rpc('get_subscription_quote', args);
        if (!(r && r.error && notFound(r.error))) break;
      }
    } catch (x) { return { unknown: true }; }
    if (!r || r.error || !r.data || typeof r.data !== 'object') return { unknown: true };
    var d = r.data;
    if (d.ok === true && d.kind === 'renewal') return { open: true, q: d };
    return { open: false, reason: d.reason || null };
  }

  function payError(err) {
    var ref = err && err.reference ? ' Reference: ' + err.reference + '.' : '';
    switch (err && err.code) {
      case 'closed': return 'The payment window was closed before the payment finished. If you were charged, your plan will update shortly; if not, nothing was taken.';
      case 'pending': return 'Your payment is being confirmed. You do not need to pay again. Refresh this page in a minute.' + ref;
      case 'review': return 'Your payment was received but we could not extend your plan automatically. Please do not pay again. Contact support and quote the reference.' + ref;
      case 'failed': return 'We could not confirm your payment. If you were charged, please contact support and quote the reference.' + ref;
      case 'init': return (err.message || 'We could not start the payment.') + ' Nothing was charged.';
      default: return 'Something went wrong. Nothing was charged. Please try again.';
    }
  }

  async function payAgain(planKey, previousEnd) {
    if (busy || blockPay) return;
    var pay = window.ST && window.ST.payments && window.ST.payments.payForSubscription;
    if (typeof pay !== 'function' || typeof window.PaystackPop === 'undefined') {
      setNote('The payment window could not load. Check your connection, refresh the page and try again. Nothing was charged.', 'danger');
      return;
    }
    busy = true;
    var btn = document.querySelector('[data-pay-again]');
    if (btn) btn.disabled = true;
    setNote('Opening the secure Paystack payment window. Paystack shows the exact amount before you pay.', 'info');
    var result = null, failure = null;
    try { result = await pay(planKey); } catch (err) { failure = err; }
    if (failure) {
      if (failure.code === 'pending' || failure.code === 'review' || failure.code === 'failed') blockPay = true;
      afterNote = { text: payError(failure), tone: failure.code === 'closed' || failure.code === 'init' ? 'warning' : 'danger' };
    } else {
      setNote('Payment received. Confirming your plan\u2026', 'info');
      var e2 = null;
      try { var r = await window.supabase.rpc('get_my_entitlements'); e2 = !r.error && r.data ? r.data : null; } catch (x) { e2 = null; }
      var moved = !!(e2 && e2.is_paid && e2.plan_key === planKey && !e2.in_grace && e2.period_end && previousEnd &&
                     new Date(e2.period_end).getTime() > new Date(previousEnd).getTime());
      if (moved) {
        afterNote = { text: 'Payment received. Your ' + e2.plan_name + ' plan now runs until ' + fmtDate(e2.period_end) + '. It does not renew by itself: to continue after that date you pay again with Paystack.', tone: 'success' };
      } else {
        blockPay = true;
        afterNote = { text: 'We received your payment, but your plan has not been extended yet. Please do not pay again. Refresh this page in a minute; if it has not changed, contact support and quote reference ' + result.reference + '.', tone: 'warning' };
      }
    }
    busy = false;
    await load();
  }

  function renderActions(e, state, quote) {
    var box = $('mysubActions');
    var old = box.querySelector('[data-pay-again]');
    if (old) box.removeChild(old);
    var plans = box.querySelector('a[href="subscription.html"]');
    if (plans) plans.className = 'btn btn-primary';
    $('mysubNote').hidden = true;
    var info = $('mysubRenewInfo');
    info.hidden = true; info.textContent = '';
    if (!e.is_paid || !quote) return;

    if (blockPay) {
      info.textContent = 'Your last payment is still being confirmed. Please do not pay again. Refresh this page in a minute.';
      info.hidden = false;
      return;
    }
    if (quote.unknown) {
      info.textContent = 'We could not check whether you can pay again right now. Refresh the page in a moment.';
      info.hidden = false;
      return;
    }
    if (!quote.open) return;                       /* too early to pay again: nothing to show, the banner explains */

    var q = quote.q;
    info.textContent = 'Paying ' + naira(q.net_kobo) + ' adds one month, from ' + fmtDate(q.period_start) + ' to ' + fmtDate(q.period_end) +
      '. Paystack shows the exact amount before you pay.';
    info.hidden = false;
    var b = el('button', 'btn btn-primary', 'Pay again');
    b.type = 'button';
    b.setAttribute('data-pay-again', '');
    b.addEventListener('click', function () { payAgain(e.plan_key, e.period_end); });
    box.insertBefore(b, box.firstChild);
    if (plans) plans.className = 'btn btn-outline';
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
    if (f.portfolio_max != null && isFinite(Number(f.portfolio_max))) rows.push([true, plural(Number(f.portfolio_max), 'portfolio photo', 'portfolio photos')]);
    rows.forEach(function (r) {
      var li = el('li', 'mysub-include' + (r[0] ? '' : ' mysub-include--off'));
      li.appendChild(el('span', 'mysub-sr', r[0] ? 'Included: ' : 'Not included: '));
      li.appendChild(document.createTextNode(r[1]));
      ul.appendChild(li);
    });
  }

  /* ---- payment history and printable receipt (S5f): own rows of subscription_receipts, read only ---- */
  var RECEIPT_COLS = 'id,receipt_number,reference,plan_name,kind,price_kobo,credit_kobo,amount_kobo,period_start,period_end,paid_at';
  var HISTORY_PAGE = 10;
  var KIND_TEXT = { new: 'New plan', upgrade: 'Upgrade', renewal: 'Paid again' };
  var history = { rows: [], failed: false };

  async function fetchReceipts(from) {
    try {
      var r = await window.supabase.from('subscription_receipts').select(RECEIPT_COLS)
        .eq('user_id', ctx.user.id).order('paid_at', { ascending: false }).range(from, from + HISTORY_PAGE);   /* one extra row tells us there is more */
      if (!r || r.error || !Array.isArray(r.data)) return null;
      return r.data;
    } catch (x) { return null; }
  }

  function fillPrint(rc) {
    var box = $('mysubPrint');
    box.textContent = '';
    box.appendChild(el('h1', 'mysub-print-title', 'Payment receipt'));
    box.appendChild(el('p', 'mysub-print-brand', 'StreetTasker'));
    var dl = el('dl', 'mysub-print-list');
    function row(k, v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    row('Receipt number', rc.receipt_number);
    row('Date paid', fmtDate(rc.paid_at));
    row('Plan', rc.plan_name);
    row('Type', KIND_TEXT[rc.kind] || rc.kind);
    row('Period covered', fmtDate(rc.period_start) + ' to ' + fmtDate(rc.period_end));
    row('Plan price', naira(rc.price_kobo));
    if (Number(rc.credit_kobo) > 0) row('Credit for unused days', '-' + naira(rc.credit_kobo));
    row('Amount paid', naira(rc.amount_kobo));
    row('Paid with', 'Paystack');
    row('Payment reference', rc.reference);
    box.appendChild(dl);
    box.appendChild(el('p', 'mysub-print-foot', 'This receipt confirms a StreetTasker subscription payment. The plan does not renew automatically.'));
  }

  function printReceipt(rc) {
    fillPrint(rc);
    document.body.classList.add('mysub-printing');
    var done = function () { document.body.classList.remove('mysub-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (x) { done(); }
  }

  function drawHistory(hasMore) {
    var ul = $('mysubHistory');
    ul.textContent = '';
    history.rows.forEach(function (rc) {
      var li = el('li', 'mysub-pay');
      var main = el('div', 'mysub-pay-main');
      main.appendChild(el('p', 'mysub-pay-title', rc.plan_name + ' \u2013 ' + (KIND_TEXT[rc.kind] || rc.kind)));
      main.appendChild(el('p', 'mysub-pay-meta', 'Paid ' + fmtDate(rc.paid_at) + ' \u00B7 ' + rc.receipt_number));
      main.appendChild(el('p', 'mysub-pay-meta', 'Covers ' + fmtDate(rc.period_start) + ' to ' + fmtDate(rc.period_end)));
      var side = el('div', 'mysub-pay-side');
      side.appendChild(el('span', 'mysub-pay-amount', naira(rc.amount_kobo)));
      var b = el('button', 'btn btn-outline btn-sm', 'Print receipt');
      b.type = 'button';
      b.setAttribute('aria-label', 'Print receipt ' + rc.receipt_number);
      b.addEventListener('click', function () { printReceipt(rc); });
      side.appendChild(b);
      li.appendChild(main); li.appendChild(side);
      ul.appendChild(li);
    });
    $('mysubHistoryEmpty').hidden = history.failed || history.rows.length > 0;
    $('mysubHistoryError').hidden = !history.failed;
    var more = $('mysubHistoryMore');
    more.hidden = !hasMore;
    more.disabled = false;
  }

  async function renderHistory() {
    history = { rows: [], failed: false };
    var data = await fetchReceipts(0);
    if (data === null) { history.failed = true; drawHistory(false); return; }
    history.rows = data.slice(0, HISTORY_PAGE);
    drawHistory(data.length > HISTORY_PAGE);
    var more = $('mysubHistoryMore');
    more.onclick = async function () {
      more.disabled = true;
      var next = await fetchReceipts(history.rows.length);
      if (next === null) { more.disabled = false; return; }
      history.rows = history.rows.concat(next.slice(0, HISTORY_PAGE));
      drawHistory(next.length > HISTORY_PAGE);
    };
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
    var quote = e.is_paid ? await getQuote(e.plan_key) : null;
    renderPlan(e, state);
    banner(state, e, ended, names, quote);
    renderUsage(e);
    renderIncludes(e);
    renderActions(e, state, quote);
    await renderChooser(e);
    await renderHistory();
    show('content');
    if (afterNote) { setNote(afterNote.text, afterNote.tone); afterNote = null; }
  }

  var retry = $('mysubRetry');
  if (retry) retry.addEventListener('click', load);
  window.StMySub = { describeState: describeState, payError: payError };
  window.initPage = load;
})();

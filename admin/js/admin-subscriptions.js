/* StreetTasker Admin: Subscriptions (stage A18, spec S16 read half). READ ONLY.
   Calls admin_subscriptions_overview, admin_subscription_plans, admin_subscriber_list, admin_subscriber_detail (subscriptions.view),
   admin_subscription_payments (subscriptions.payments.view) and admin_subscription_audit (subscriptions.view); each checks again on the server.
   No button here changes, overrides, cancels, credits, refunds or exports anything. No card detail is ever requested or shown.
   Amounts arrive as integer kobo and are shown without floating point. All text via textContent. */
'use strict';
AdminShell.init({ page: 'subscriptions', title: 'Subscriptions', permission: 'subscriptions.view' }).then(function (ctx) {
  var $ = function (id) { return document.getElementById(id); };
  $('sbRoot').hidden = false;
  var canPay = ctx.has('subscriptions.payments.view');
  $('sbPaySection').hidden = !canPay;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { var d = new Date(v); return (v == null || isNaN(d)) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }); }
  function dayOnly(v) { var d = new Date(v); return (v == null || isNaN(d)) ? '' : d.toLocaleDateString('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }); }
  function naira(k) {
    if (k == null || k === '' || isNaN(Number(k))) return 'Not available';
    var n = Number(k), neg = n < 0; if (neg) n = -n;
    var whole = Math.floor(n / 100), cents = n % 100;
    return (neg ? '-' : '') + '₦' + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
  }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function fail(res) {
    if (res && res.error) return 'The server could not answer. Nothing was changed.';
    if (res && res.data && res.data.ok === false) return res.data.error || 'The server refused this.';
    return null;
  }
  async function call(n, a) { try { return await window.supabase.rpc(n, a || {}); } catch (e) { return { error: e }; } }
  function stat(label, value, def, cls) {
    var s = el('div', 'ad-stat' + (cls ? ' ad-stat--' + cls : ''));
    s.appendChild(el('div', 'ad-stat-label', label)); s.appendChild(el('div', 'ad-stat-num', value));
    if (def) s.appendChild(el('p', 'ad-hint', def));
    return s;
  }
  function tableOf(caption, heads) {
    var wrap = el('div', 'ad-tablewrap ad-cards'), tbl = el('table', 'ad-table ad-table--cards');
    tbl.appendChild(el('caption', 'ad-sr', caption));
    var tr = el('tr'); heads.forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; tr.appendChild(th); });
    var th = el('thead'); th.appendChild(tr); tbl.appendChild(th);
    var tb = el('tbody'); tbl.appendChild(tb); wrap.appendChild(tbl);
    return { wrap: wrap, body: tb };
  }
  function cell(tr, label, content) {
    var td = el('td'); td.setAttribute('data-label', label);
    if (content && content.nodeType) td.appendChild(content); else td.textContent = content == null ? '' : content;
    tr.appendChild(td); return td;
  }
  function flag(text) { return el('span', 'badge', text); }
  function facts(pairs) {
    var dl = el('dl', 'ad-dl');
    pairs.forEach(function (p) { if (p[1] == null || p[1] === '') return; dl.appendChild(el('dt', null, p[0])); dl.appendChild(el('dd', null, String(p[1]))); });
    return dl;
  }
  function tabs(box, list, current, onPick) {
    clear(box);
    list.forEach(function (x) {
      var b = el('button', 'btn btn-sm ' + (x[0] === current ? 'btn-outline' : 'btn-ghost'), x[1]); b.type = 'button';
      b.setAttribute('aria-pressed', x[0] === current ? 'true' : 'false');
      b.addEventListener('click', function () { onPick(x[0]); });
      box.appendChild(b);
    });
  }
  /* A line plus a full-width row under it that opens and closes. build() may return a node or a promise of one. */
  function withDetails(t, tr, cols, build) {
    var drow = el('tr', 'ad-detail-row'), td = el('td'); td.colSpan = cols; td.setAttribute('data-label', '');
    var holder = el('div', 'ad-detail'); td.appendChild(holder); drow.appendChild(td);
    var act = el('td'); act.setAttribute('data-label', '');
    var b = el('button', 'btn ad-btn-small', 'Details'); b.type = 'button';
    b.addEventListener('click', async function () {
      if (holder.firstChild) { clear(holder); b.textContent = 'Details'; return; }
      b.textContent = 'Hide'; holder.appendChild(ctx.skeleton(2));
      var node = await build(); clear(holder);
      if (b.textContent === 'Hide') holder.appendChild(node);
    });
    act.appendChild(b); tr.appendChild(act); t.body.appendChild(tr); t.body.appendChild(drow);
  }
  function pager(prefix, off, n, PAGE) {
    $(prefix + 'Newer').disabled = off === 0; $(prefix + 'Older').disabled = n < PAGE;
    $(prefix + 'Pager').hidden = off === 0 && n < PAGE;
  }

  var PAGE = 25;
  var STATUS = { active: 'Active', past_due: 'Past due', cancelled: 'Ended (cancelled)', expired: 'Ended (expired)' };
  function statusWord(s) { return STATUS[s] || words(s) || 'Unknown'; }

  /* ---------- overview ---------- */
  async function loadOverview() {
    var box = $('sbOverview'), by = $('sbByPlan'), al = $('sbAlerts');
    clear(box); clear(by); clear(al); box.appendChild(ctx.skeleton(3));
    var res = await call('admin_subscriptions_overview');
    var m = fail(res); clear(box);
    if (m || !res.data) { ctx.showError(box, m || 'The overview could not be read.', loadOverview); return; }
    var d = res.data, s = d.subscribers || {}, st = s.by_status || {}, pay = d.payments || {}, cards = d.card_authorizations || {}, rev = d.revenue_month || {};

    var warn = [];
    if (pay.allowed && pay.needs_review > 0) warn.push(pay.needs_review + ' payment(s) need review: money received but no receipt, or a receipt for someone with no subscription (Payments, Needs review).');
    if (cards.exists && cards.rows > 0) warn.push('The table subscription_card_authorizations holds ' + cards.rows + ' row(s), although the owner’s rule R-C says no saved cards. Authorization codes are never read or shown here. This needs a decision outside this page.');
    if (warn.length) {
      var b = el('div', 'ad-banner'); b.appendChild(el('strong', null, 'Needs attention'));
      var ul = el('ul'); warn.forEach(function (w) { ul.appendChild(el('li', null, w)); }); b.appendChild(ul); al.appendChild(b);
    }
    if (!pay.allowed) al.appendChild(el('p', 'ad-note', 'Payment review is not shown to you: it needs the permission subscriptions.payments.view. This is not a statement that nothing needs review.'));
    else if (!(pay.needs_review > 0)) al.appendChild(el('p', 'ad-note', 'No subscription payment needs review.'));

    var g = el('div', 'ad-grid');
    g.appendChild(stat('People with a subscription row', String(s.total || 0), 'Every row in the subscriptions table, any status.'));
    g.appendChild(stat('Active', String(st.active || 0), 'Status active. Local Taskers and coordinator plans are not counted.'));
    g.appendChild(stat('Past due', String(st.past_due || 0), 'Period ended and the person has not paid again yet (grace days).', st.past_due > 0 ? 'warn' : null));
    g.appendChild(stat('Ended', String((st.cancelled || 0) + (st.expired || 0)), 'Cancelled ' + (st.cancelled || 0) + ', expired ' + (st.expired || 0) + '. A plan does not renew by itself.'));
    g.appendChild(stat('Ending within 7 days', String(s.ending_soon || 0), 'Active, period ends in the next 7 days.'));
    g.appendChild(stat('Marked to end at period end', String(s.cancel_at_period_end || 0), 'Active plans with the end-of-period flag set.'));
    if (rev.allowed) g.appendChild(stat('Paid this month', naira(rev.kobo), rev.rows + ' paid receipt(s) this Lagos month, as stored. Not job money. Full revenue is on Revenue and commissions.'));
    if (pay.allowed) {
      g.appendChild(stat('Needs review', String(pay.needs_review || 0), 'Paid but no receipt, or a receipt but no subscription row.', pay.needs_review > 0 ? 'warn' : null));
      g.appendChild(stat('Payments not completed', String(pay.not_completed || 0), 'Subscription payments that are pending, failed or mismatched, as stored.'));
    }
    box.appendChild(g);
    if (!rev.allowed) box.appendChild(el('p', 'ad-hint', 'Revenue is shown only with the permission subscriptions.revenue.view.'));

    var bp = d.by_plan || [];
    if (!bp.length) ctx.showEmpty(by, 'No subscriptions yet.');
    else {
      var t = tableOf('Subscribers by plan', ['Plan', 'Active', 'Past due', 'Ended']);
      bp.forEach(function (p) { var tr = el('tr'); cell(tr, 'Plan', p.label || p.plan); cell(tr, 'Active', String(p.active)); cell(tr, 'Past due', String(p.past_due)); cell(tr, 'Ended', String(p.ended)); t.body.appendChild(tr); });
      by.appendChild(t.wrap);
    }
    $('sbStamp').textContent = 'Read from the server at ' + when(d.generated_at) + '.';
  }

  /* ---------- plans ---------- */
  async function loadPlans() {
    var box = $('sbPlans'); clear(box); box.appendChild(ctx.skeleton(2));
    var res = await call('admin_subscription_plans'); var m = fail(res); clear(box);
    if (m || !res.data) { ctx.showError(box, m || 'The plans could not be read.', loadPlans); return; }
    var d = res.data, items = d.items || [];
    if (d.available === false) { ctx.showError(box, d.note || 'The plans table was not found.', loadPlans); return; }
    if (!items.length) { ctx.showEmpty(box, 'No plans are stored.'); return; }
    var t = tableOf('Plans', ['Plan', 'Price', 'Offers a month', 'Listing limit', 'Membership label', 'Offered', 'Active', 'Past due', 'Ended']);
    items.forEach(function (p) {
      var tr = el('tr');
      cell(tr, 'Plan', p.name || p.plan); cell(tr, 'Price', naira(p.price_kobo));
      cell(tr, 'Offers a month', p.offers_per_month == null ? 'Not available' : String(p.offers_per_month));
      cell(tr, 'Listing limit', p.listing_limit == null ? 'Not available' : String(p.listing_limit));
      cell(tr, 'Membership label', p.membership_label || 'None');
      cell(tr, 'Offered', p.is_active == null ? 'Not available' : (p.is_active ? 'Yes' : 'No (inactive)'));
      cell(tr, 'Active', String(p.active)); cell(tr, 'Past due', String(p.past_due)); cell(tr, 'Ended', String(p.ended));
      t.body.appendChild(tr);
    });
    box.appendChild(t.wrap);
    box.appendChild(el('p', 'ad-hint', 'Membership labels (PRO, PREMIUM) are labels, never identity verification.'));
  }

  /* ---------- subscribers ---------- */
  var SUB_TABS = [['all', 'All'], ['active', 'Active'], ['past_due', 'Past due'], ['ending_soon', 'Ending within 7 days'], ['cancel_at_end', 'Marked to end'], ['ended', 'Ended']];
  var sub = { f: 'all', q: '', off: 0, req: 0 };

  async function personDetail(userId) {
    var res = await call('admin_subscriber_detail', { p_user: userId }), m = fail(res), wrap = el('div');
    if (m || !res.data) { wrap.appendChild(el('p', 'ad-note', m || 'The details could not be read.')); return wrap; }
    var d = res.data, s = d.subscription;
    wrap.appendChild(el('h3', null, d.name || 'Unnamed'));
    if (s) wrap.appendChild(facts([['Plan', s.plan_label || s.plan], ['Tier', s.tier], ['Status', statusWord(s.status)], ['Period ends', s.period_end ? when(s.period_end) : ''],
      ['Started', s.started_at ? when(s.started_at) : ''], ['Marked to end at period end', s.cancel_at_period_end ? 'Yes' : 'No'], ['Plan after this period', s.pending_plan]]));
    else wrap.appendChild(el('p', 'ad-note', 'This person has no subscription row.'));
    if (d.receipts_allowed) {
      wrap.appendChild(el('h3', null, 'Receipts'));
      var r = d.receipts || [];
      if (!r.length) wrap.appendChild(el('p', 'ad-hint', 'No receipts.'));
      else {
        var t = tableOf('Receipts', ['Paid', 'Receipt', 'Plan', 'Amount', 'Period']);
        r.forEach(function (x) {
          var tr = el('tr'); cell(tr, 'Paid', x.paid_at ? when(x.paid_at) : 'Not paid'); cell(tr, 'Receipt', x.receipt_number || x.reference);
          cell(tr, 'Plan', x.plan_name); cell(tr, 'Amount', naira(x.amount_kobo));
          cell(tr, 'Period', x.period_start || x.period_end ? dayOnly(x.period_start) + ' to ' + dayOnly(x.period_end) : ''); t.body.appendChild(tr);
        });
        wrap.appendChild(t.wrap);
      }
    } else wrap.appendChild(el('p', 'ad-hint', 'Receipts and amounts need the permission subscriptions.payments.view.'));
    wrap.appendChild(el('h3', null, 'Timeline'));
    var tl = d.timeline || [];
    if (!tl.length) wrap.appendChild(el('p', 'ad-hint', 'No events recorded.'));
    else wrap.appendChild(timelineTable(tl, false));
    return wrap;
  }

  function timelineTable(items, withPerson) {
    var heads = ['When'].concat(withPerson ? ['Person'] : []).concat(['Source', 'What', 'Plan change', 'Note']);
    var t = tableOf('Timeline', heads);
    items.forEach(function (e) {
      var tr = el('tr'); cell(tr, 'When', when(e.at));
      if (withPerson) cell(tr, 'Person', e.name || (e.user_id ? String(e.user_id).slice(0, 8) : ''));
      var src = el('span'); src.appendChild(flag(e.src === 'admin' ? 'Admin action' : 'Event')); if (e.src === 'admin') src.appendChild(flag(e.has_approval ? 'Approval recorded' : 'No approval id'));
      cell(tr, 'Source', src); cell(tr, 'What', words(e.kind));
      cell(tr, 'Plan change', (e.from_plan || e.to_plan) ? (e.from_plan || '?') + ' to ' + (e.to_plan || '?') : '');
      cell(tr, 'Note', e.note); t.body.appendChild(tr);
    });
    return t.wrap;
  }

  async function loadSubs() {
    var mine = ++sub.req, box = $('sbSubList');
    tabs($('sbSubTabs'), SUB_TABS, sub.f, function (f) { sub.f = f; sub.off = 0; loadSubs(); });
    clear(box); box.appendChild(ctx.skeleton(3)); $('sbSubPager').hidden = true;
    var res = await call('admin_subscriber_list', { p_search: sub.q || null, p_status: sub.f, p_offset: sub.off });
    if (mine !== sub.req) return;
    var m = fail(res); clear(box);
    if (m || !res.data) { ctx.showError(box, m || 'The subscribers could not be read.', loadSubs); return; }
    var d = res.data, items = d.items || [];
    $('sbSubCount').textContent = d.total + ' person(s) in this view.';
    if (!items.length) { if (sub.off > 0) ctx.showEmpty(box, 'No more people.'); else if (sub.f === 'all' && !sub.q) ctx.showEmpty(box, 'No subscriptions yet.'); else ctx.showNoResults(box); }
    else {
      var t = tableOf('Subscribers', ['Person', 'Plan', 'Status', 'Period ends', '']);
      items.forEach(function (x) {
        var tr = el('tr');
        cell(tr, 'Person', (x.name || 'Unnamed') + ' (' + String(x.user_id || '').slice(0, 8) + ')');
        cell(tr, 'Plan', x.plan_label || x.plan || 'Not recorded');
        var s = el('span'); s.appendChild(flag(statusWord(x.status)));
        if (x.status === 'active' && x.days_left != null && x.days_left <= 7 && x.days_left >= 0) s.appendChild(flag('Ends in ' + x.days_left + ' day(s)'));
        if (x.cancel_at_period_end) s.appendChild(flag('Marked to end'));
        if (x.pending_plan) s.appendChild(flag('Next: ' + x.pending_plan));
        cell(tr, 'Status', s); cell(tr, 'Period ends', x.period_end ? dayOnly(x.period_end) : '');
        withDetails(t, tr, 5, function () { return personDetail(x.user_id); });
      });
      box.appendChild(t.wrap);
    }
    pager('sbSub', sub.off, items.length, PAGE);
  }

  /* ---------- payments ---------- */
  var PAY_TABS = [['review', 'Needs review'], ['not_paid', 'Not completed'], ['receipts', 'Receipts']];
  var pay = { f: 'review', off: 0, req: 0 };
  async function loadPay() {
    if (!canPay) return;
    var mine = ++pay.req, box = $('sbPayList');
    clear(box); box.appendChild(ctx.skeleton(3)); $('sbPayPager').hidden = true;
    var res = await call('admin_subscription_payments', { p_filter: pay.f, p_offset: pay.off });
    if (mine !== pay.req) return;
    var m = fail(res); clear(box);
    if (m || !res.data) { tabs($('sbPayTabs'), PAY_TABS, pay.f, pickPay); ctx.showError(box, m || 'The payments could not be read.', loadPay); return; }
    var d = res.data, items = d.items || [], c = d.counts || {};
    tabs($('sbPayTabs'), PAY_TABS.map(function (x) { return [x[0], x[1] + ' (' + (c[x[0]] || 0) + ')']; }), pay.f, pickPay);
    $('sbPayCount').textContent = d.total + ' record(s), ' + naira(d.total_kobo) + ' in this view.';
    if (!items.length) { if (pay.off > 0) ctx.showEmpty(box, 'No older records.'); else ctx.showEmpty(box, pay.f === 'review' ? 'Nothing needs review.' : 'Nothing here.'); }
    else {
      var t = tableOf('Subscription payments', ['When', 'Person', 'Amount', 'Reference', 'Status', 'Note']);
      items.forEach(function (x) {
        var tr = el('tr'); cell(tr, 'When', when(x.at)); cell(tr, 'Person', x.name || (x.user_id ? String(x.user_id).slice(0, 8) : ''));
        cell(tr, 'Amount', naira(x.amount_kobo)); cell(tr, 'Reference', x.receipt_number ? x.reference + ' (' + x.receipt_number + ')' : x.reference);
        cell(tr, 'Status', flag(words(x.status))); cell(tr, 'Note', x.reason || x.plan || ''); t.body.appendChild(tr);
      });
      box.appendChild(t.wrap);
    }
    if (pay.f === 'review') box.appendChild(el('p', 'ad-hint', 'Nothing here can be fixed from this page. If the money is real and the plan is not active, the plan is fixed through the subscription process (a later stage, with approval), and any refund is made in Paystack by an authorised person.'));
    pager('sbPay', pay.off, items.length, PAGE);
  }
  function pickPay(f) { pay.f = f; pay.off = 0; loadPay(); }

  /* ---------- audit ---------- */
  var AUD_TABS = [['all', 'All'], ['admin', 'Admin actions'], ['event', 'Events']];
  var aud = { f: 'all', off: 0, req: 0 };
  async function loadAud() {
    var mine = ++aud.req, box = $('sbAudList');
    tabs($('sbAudTabs'), AUD_TABS, aud.f, function (f) { aud.f = f; aud.off = 0; loadAud(); });
    clear(box); box.appendChild(ctx.skeleton(3)); $('sbAudPager').hidden = true;
    var res = await call('admin_subscription_audit', { p_source: aud.f, p_offset: aud.off });
    if (mine !== aud.req) return;
    var m = fail(res); clear(box);
    if (m || !res.data) { ctx.showError(box, m || 'The audit could not be read.', loadAud); return; }
    var d = res.data, items = d.items || [];
    $('sbAudCount').textContent = d.total + ' entr' + (d.total === 1 ? 'y' : 'ies') + ' in this view.';
    if (!items.length) ctx.showEmpty(box, aud.off > 0 ? 'No older entries.' : 'No entries.');
    else box.appendChild(timelineTable(items, true));
    pager('sbAud', aud.off, items.length, PAGE);
  }

  $('sbFilters').addEventListener('submit', function (e) { e.preventDefault(); sub.q = $('sbSearch').value.trim(); sub.off = 0; loadSubs(); });
  $('sbReset').addEventListener('click', function () { $('sbSearch').value = ''; sub.q = ''; sub.f = 'all'; sub.off = 0; loadSubs(); });
  $('sbSubNewer').addEventListener('click', function () { sub.off = Math.max(0, sub.off - PAGE); loadSubs(); });
  $('sbSubOlder').addEventListener('click', function () { sub.off += PAGE; loadSubs(); });
  $('sbPayNewer').addEventListener('click', function () { pay.off = Math.max(0, pay.off - PAGE); loadPay(); });
  $('sbPayOlder').addEventListener('click', function () { pay.off += PAGE; loadPay(); });
  $('sbAudNewer').addEventListener('click', function () { aud.off = Math.max(0, aud.off - PAGE); loadAud(); });
  $('sbAudOlder').addEventListener('click', function () { aud.off += PAGE; loadAud(); });

  loadOverview(); loadPlans(); loadSubs(); loadPay(); loadAud();
});

/* StreetTasker Admin: Transactions and donations (stage A15, spec S14). READ ONLY.
   Calls admin_transactions_overview, admin_transaction_list (transactions.view) and admin_donation_list (donations.view); each checks again.
   No button changes, retries, refunds or reconciles anything. Amounts arrive as integer kobo and are shown without floating point.
   All text via textContent. */
'use strict';
AdminShell.init({ page: 'transactions', title: 'Transactions', permission: ['transactions.view', 'donations.view'] }).then(function (ctx) {
  var $ = function (id) { return document.getElementById(id); };
  $('txRoot').hidden = false;
  var canTx = ctx.has('transactions.view'), canDn = ctx.has('donations.view');
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { var d = new Date(v); return (v == null || isNaN(d)) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }); }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim().toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function naira(k) {
    if (k == null || k === '' || isNaN(Number(k))) return 'Not available';
    var n = Number(k), neg = n < 0; if (neg) n = -n;
    var whole = Math.floor(n / 100), cents = n % 100;
    return (neg ? '-' : '') + '₦' + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
  }
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
  function toggleRow(t, tr, cols, build) {
    var drow = el('tr', 'ad-detail-row'), td = el('td'); td.colSpan = cols; td.setAttribute('data-label', '');
    var holder = el('div', 'ad-detail'); td.appendChild(holder); drow.appendChild(td);
    var act = el('td'); act.setAttribute('data-label', '');
    var b = el('button', 'btn ad-btn-small', 'Details'); b.type = 'button';
    b.addEventListener('click', function () {
      if (holder.firstChild) { clear(holder); b.textContent = 'Details'; return; }
      holder.appendChild(build()); b.textContent = 'Hide';
    });
    act.appendChild(b); tr.appendChild(act); t.body.appendChild(tr); t.body.appendChild(drow);
  }

  var KIND_LABEL = { job: 'Job payment', job_room: 'Job Room payment', subscription: 'Subscription', coordinator_plan: 'Coordinator plan', gift_card: 'Gift card', urgent_fee: 'Urgent fee', refund: 'Refund recorded', other: 'Other' };
  var KINDS = [['all', 'All']].concat(Object.keys(KIND_LABEL).map(function (k) { return [k, KIND_LABEL[k]]; }));
  var STATUSES = [['all', 'Any status'], ['review', 'Needs review'], ['pending', 'Pending'], ['failed', 'Failed or expired'], ['paid', 'Paid']];
  var RECON = { matched: 'Matched', needs_review: 'Needs review', unverified: 'Unverified', open: 'Not paid yet' };
  var DN_TABS = [['all', 'All'], ['flagged', 'Flagged'], ['stuck', 'Stuck'], ['no_receipt', 'Receipt not sent'], ['pending', 'Pending'], ['paid', 'Paid']];
  var kind = 'all', status = 'all', off = 0, req = 0, dnF = 'all', dnOff = 0, dnReq = 0, PAGE = 25;

  async function loadOverview() {
    var alerts = $('txAlerts'), sum = $('txSummary'); clear(alerts); clear(sum);
    if (!canTx) { $('txSumTitle').parentNode.hidden = true; $('txListTitle').parentNode.hidden = true; return; }
    var res = await call('admin_transactions_overview');
    var m = fail(res);
    if (m || !res.data) { ctx.showError(alerts, m || 'The summary could not be read.', loadAll); return; }
    var d = res.data, ks = d.kinds || {}, warn = [];
    if (d.needs_review > 0) warn.push(d.needs_review + ' record(s) need a look: a mismatch, a missing time, receipt or escrow row, or pending for over a day (Needs review).');
    if (d.unverified_urgent > 0) warn.push(d.unverified_urgent + ' urgent fee(s) were paid in the browser and the server did not verify them.');
    if (warn.length) {
      var b = el('div', 'ad-banner'); b.appendChild(el('strong', null, 'Needs attention'));
      var ul = el('ul'); warn.forEach(function (w) { ul.appendChild(el('li', null, w)); }); b.appendChild(ul); alerts.appendChild(b);
    } else alerts.appendChild(el('p', 'ad-note', 'Nothing needs a look.'));
    var g = el('div', 'ad-grid');
    Object.keys(KIND_LABEL).forEach(function (k) {
      var x = ks[k]; if (!x) return;
      g.appendChild(stat(KIND_LABEL[k], naira(x.paid_kobo), x.paid_rows + ' paid of ' + x.rows + ' record(s). Never added into one total.'));
    });
    sum.appendChild(g);
    sum.appendChild(el('p', 'ad-hint', 'Total records: ' + (d.total || 0) + '. Pending: ' + (d.pending_rows || 0) + '. Failed or expired: ' + (d.failed_rows || 0) + '. Each box is a different kind of money; a gift card sale and a refund are not income.'));
    $('txStamp').textContent = 'Read from the server at ' + when(d.generated_at) + '.';
  }

  async function loadList() {
    if (!canTx) return;
    var mine = ++req, box = $('txList');
    tabs($('txKinds'), KINDS, kind, function (k) { kind = k; off = 0; loadList(); });
    tabs($('txStatus'), STATUSES, status, function (s) { status = s; off = 0; loadList(); });
    clear(box); box.appendChild(ctx.skeleton(3)); $('txPager').hidden = true;
    var res = await call('admin_transaction_list', { p_kind: kind, p_status: status, p_offset: off });
    if (mine !== req) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The payments could not be read.', loadList); return; }
    var d = res.data, items = d.items || [];
    $('txCount').textContent = d.total + ' record(s) in this view, ' + naira(d.total_kobo) + ' in total (one kind at a time is easier to read).';
    clear(box);
    if (!items.length) { if (off > 0) ctx.showEmpty(box, 'No older records.'); else if (kind === 'all' && status === 'all') ctx.showEmpty(box, 'No payments yet.'); else ctx.showNoResults(box); }
    else {
      var t = tableOf('Payments', ['Date', 'Kind', 'Who', 'Amount', 'Status', 'Check', '']);
      items.forEach(function (x) {
        var tr = el('tr');
        cell(tr, 'Date', when(x.occurred_at));
        cell(tr, 'Kind', KIND_LABEL[x.kind] || words(x.kind));
        cell(tr, 'Who', x.party_name || '');
        cell(tr, 'Amount', naira(x.amount_kobo));
        cell(tr, 'Status', words(x.status));
        var ck = el('span'); ck.appendChild(flag(RECON[x.recon] || words(x.recon))); cell(tr, 'Check', ck);
        toggleRow(t, tr, 7, function () {
          return facts([['Reference', x.reference], ['Booking', x.booking_ref], ['Table', x.source], ['Record id', x.id], ['Person id', x.party_id], ['Why it needs a look', x.review_reason], ['Refund', x.refund_note],
            ['What the check means', x.recon === 'unverified' ? 'Not verified by the server.' : x.recon === 'matched' ? 'The site\u2019s own records agree. Paystack was not asked.' : '']]);
        });
      });
      box.appendChild(t.wrap);
    }
    $('txNewer').disabled = off === 0; $('txOlder').disabled = items.length < PAGE;
    $('txPager').hidden = off === 0 && items.length < PAGE;
  }

  async function loadDonations() {
    if (!canDn) return;
    $('dnCard').hidden = false;
    var mine = ++dnReq, box = $('dnList');
    tabs($('dnTabs'), DN_TABS, dnF, function (f) { dnF = f; dnOff = 0; loadDonations(); });
    clear(box); box.appendChild(ctx.skeleton(3)); $('dnPager').hidden = true;
    var res = await call('admin_donation_list', { p_filter: dnF, p_offset: dnOff });
    if (mine !== dnReq) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The donations could not be read.', loadDonations); return; }
    var d = res.data, items = d.items || [], c = d.counts || {}, sm = $('dnSummary'); clear(sm);
    var g = el('div', 'ad-grid');
    g.appendChild(stat('Donations received', naira(c.paid_kobo), (c.paid || 0) + ' paid. Kept apart from income.'));
    g.appendChild(stat('Flagged', String(c.flagged || 0), 'Marked suspicious.', c.flagged > 0 ? 'warn' : null));
    g.appendChild(stat('Stuck', String(c.stuck || 0), 'Pending for over a day.', c.stuck > 0 ? 'warn' : null));
    g.appendChild(stat('Receipt not sent', String(c.no_receipt || 0), 'Paid but no receipt email recorded.', c.no_receipt > 0 ? 'warn' : null));
    sm.appendChild(g);
    $('dnCount').textContent = d.total + ' donation(s) in this view.';
    clear(box);
    if (!items.length) { if (dnOff > 0) ctx.showEmpty(box, 'No older donations.'); else if (dnF === 'all') ctx.showEmpty(box, 'No donations yet.'); else ctx.showNoResults(box); }
    else {
      var t = tableOf('Donations', ['Date', 'Donor', 'Amount', 'Status', 'Source', '']);
      items.forEach(function (x) {
        var tr = el('tr');
        cell(tr, 'Date', when(x.paid_at || x.created_at));
        cell(tr, 'Donor', (x.donor_name || 'Anonymous') + (x.donor_email ? ' (' + x.donor_email + ')' : ''));
        cell(tr, 'Amount', naira(x.amount_kobo));
        var st = el('span'); st.appendChild(flag(words(x.status))); if (x.stuck) st.appendChild(flag('Stuck')); if (x.no_receipt) st.appendChild(flag('Receipt not sent'));
        cell(tr, 'Status', st);
        cell(tr, 'Source', words(x.source));
        toggleRow(t, tr, 6, function () { return facts([['Reference', x.reference], ['Channel', x.channel], ['Started', when(x.created_at)], ['Paid', x.paid_at ? when(x.paid_at) : ''], ['Flag reason', x.flag_reason], ['Receipt', x.receipt_sent ? 'Sent' : 'Not sent']]); });
      });
      box.appendChild(t.wrap);
    }
    $('dnNewer').disabled = dnOff === 0; $('dnOlder').disabled = items.length < PAGE;
    $('dnPager').hidden = dnOff === 0 && items.length < PAGE;
  }

  function loadAll() { return Promise.all([loadOverview(), loadList(), loadDonations()]); }
  $('txNewer').addEventListener('click', function () { off = Math.max(0, off - PAGE); loadList(); });
  $('txOlder').addEventListener('click', function () { off += PAGE; loadList(); });
  $('dnNewer').addEventListener('click', function () { dnOff = Math.max(0, dnOff - PAGE); loadDonations(); });
  $('dnOlder').addEventListener('click', function () { dnOff += PAGE; loadDonations(); });
  loadAll();
});

/* StreetTasker Admin: Earnings and payouts watch (stage A17, spec S18). READ ONLY.
   Calls admin_payouts_overview, admin_withdrawal_list and admin_local_payout_list (each checks payouts.view again).
   There is no button that sends, retries, refunds or changes anything. Bank details are shown as bank name and last four digits only.
   Amounts are naira as stored. All text via textContent. */
'use strict';
AdminShell.init({ page: 'payouts', title: 'Earnings and payouts', permission: 'payouts.view' }).then(function (ctx) {
  var $ = function (id) { return document.getElementById(id); };
  $('poRoot').hidden = false;
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }); }
  function naira(v) {
    if (v == null || v === '' || isNaN(Number(v))) return 'Not available';
    var n = Number(v), neg = n < 0; if (neg) n = -n;
    var s = n.toLocaleString('en-NG', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return (neg ? '-' : '') + '₦' + s;
  }
  function words(s) { var t = String(s == null ? '' : s).replace(/[._]/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function age(m) { m = Number(m); if (isNaN(m)) return ''; return m < 60 ? m + ' min' : m < 2880 ? Math.floor(m / 60) + ' h' : Math.floor(m / 1440) + ' days'; }
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
  /* A line plus a full-width row under it that opens and closes. */
  function withDetails(t, tr, cols, build) {
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
  function tabs(box, list, current, onPick) {
    clear(box);
    list.forEach(function (x) {
      var b = el('button', 'btn btn-sm ' + (x[0] === current ? 'btn-outline' : 'btn-ghost'), x[1]); b.type = 'button';
      b.setAttribute('aria-pressed', x[0] === current ? 'true' : 'false');
      b.addEventListener('click', function () { onPick(x[0]); });
      box.appendChild(b);
    });
  }

  var REG_TABS = [['all', 'All'], ['stuck', 'Stuck'], ['pending', 'Pending'], ['processing', 'Processing'], ['failed', 'Failed'], ['reversed', 'Reversed'], ['success', 'Sent'], ['anomaly', 'Anomalies']];
  var LOC_TABS = [['all', 'All'], ['overdue', 'Overdue'], ['queued', 'Queued'], ['processing', 'Processing'], ['review', 'Needs review'], ['failed', 'Failed'], ['reversed', 'Reversed'], ['paid', 'Paid']];
  var regF = 'all', regOff = 0, locF = 'all', locOff = 0, regReq = 0, locReq = 0, PAGE = 25;

  async function loadOverview() {
    var res = await call('admin_payouts_overview');
    var m = fail(res), alerts = $('poAlerts'), rs = $('poRegSummary'), ls = $('poLocSummary');
    clear(alerts); clear(rs); clear(ls);
    if (m || !res.data) { ctx.showError(alerts, m || 'The summary could not be read.', loadAll); return; }
    var d = res.data, r = d.regular || {}, l = d.local || {}, rc = r.counts || {}, lc = l.counts || {};
    var warn = [];
    if (r.stuck > 0) warn.push(r.stuck + ' withdrawal(s) still pending or processing after 15 minutes (Stuck tab).');
    if (r.anomalies > 0) warn.push(r.anomalies + ' withdrawal(s) carry an ANOMALY note: Paystack and the site disagree. Check Paystack by hand (Anomalies tab).');
    if (l.overdue > 0) warn.push(l.overdue + ' Local payout(s) are still queued 30 minutes after they were due (Overdue tab).');
    if (l.needs_review > 0) warn.push(l.needs_review + ' Local payout(s) are failed or need review.');
    if (warn.length) {
      var b = el('div', 'ad-banner'); b.appendChild(el('strong', null, 'Needs attention'));
      var ul = el('ul'); warn.forEach(function (w) { ul.appendChild(el('li', null, w)); }); b.appendChild(ul); alerts.appendChild(b);
    } else alerts.appendChild(el('p', 'ad-note', 'Nothing is stuck, overdue or flagged.'));

    var g = el('div', 'ad-grid');
    g.appendChild(stat('Wallet balances', naira(r.wallet_balance_total), 'What taskers hold in their wallets now, owed to them. ' + (r.wallets_with_balance || 0) + ' wallet(s) above zero.'));
    g.appendChild(stat('Clearing', naira(r.wallet_pending_total), 'Pending balance shown on wallets.'));
    g.appendChild(stat('In flight', naira(r.in_flight_amount), (r.in_flight_count || 0) + ' withdrawal(s) pending or processing.', r.stuck > 0 ? 'warn' : null));
    g.appendChild(stat('Sent so far', naira(r.paid_amount), 'Net amount of withdrawals marked success. Fees kept: ' + naira(r.fees_amount) + '.'));
    rs.appendChild(g);
    rs.appendChild(el('p', 'ad-hint', 'Withdrawals by status: ' + ['pending', 'processing', 'success', 'failed', 'reversed'].map(function (k) { return words(k) + ' ' + (rc[k] || 0); }).join(', ') + '. Total ' + (r.total || 0) + '.'));

    var g2 = el('div', 'ad-grid');
    g2.appendChild(stat('In flight', naira(l.in_flight_amount), (l.in_flight_count || 0) + ' payout(s) queued or processing.', l.overdue > 0 ? 'warn' : null));
    g2.appendChild(stat('Paid so far', naira(l.paid_amount), 'Amount sent for payouts marked paid.'));
    g2.appendChild(stat('Needs review', String(l.needs_review || 0), 'Failed or in review.', l.needs_review > 0 ? 'warn' : null));
    ls.appendChild(g2);
    ls.appendChild(el('p', 'ad-hint', 'Payouts by status: ' + ['queued', 'processing', 'paid', 'failed', 'review', 'reversed'].map(function (k) { return words(k) + ' ' + (lc[k] || 0); }).join(', ') + '. Total ' + (l.total || 0) + '.'));
    $('poStamp').textContent = 'Read from the server at ' + when(d.generated_at) + '.';
  }

  async function loadReg() {
    var mine = ++regReq, box = $('poRegList');
    tabs($('poRegTabs'), REG_TABS, regF, function (f) { regF = f; regOff = 0; loadReg(); });
    clear(box); box.appendChild(ctx.skeleton(3)); $('poRegPager').hidden = true;
    var res = await call('admin_withdrawal_list', { p_filter: regF, p_offset: regOff });
    if (mine !== regReq) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The withdrawals could not be read.', loadReg); return; }
    var d = res.data, items = d.items || [];
    $('poRegCount').textContent = d.total + ' withdrawal(s) in this view.';
    clear(box);
    if (!items.length) { if (regOff > 0) ctx.showEmpty(box, 'No older withdrawals.'); else if (regF === 'all') ctx.showEmpty(box, 'No withdrawals yet.'); else ctx.showNoResults(box); }
    else {
      var t = tableOf('Withdrawals', ['Requested', 'Tasker', 'Amount', 'Status', 'Bank', '']);
      items.forEach(function (w) {
        var tr = el('tr');
        cell(tr, 'Requested', when(w.created_at));
        cell(tr, 'Tasker', w.name || 'Unnamed');
        cell(tr, 'Amount', naira(w.amount));
        var st = el('span'); st.appendChild(flag(words(w.status) + (w.status === 'success' ? ' (sent)' : ''))); if (w.stuck) st.appendChild(flag('Stuck ' + age(w.age_minutes))); if (w.anomaly) st.appendChild(flag('Anomaly'));
        cell(tr, 'Status', st);
        cell(tr, 'Bank', (w.bank_name || 'Bank') + ' ••••' + (w.account_last4 || ''));
        withDetails(t, tr, 6, function () {
          return facts([['Reference', w.reference], ['Tasker id', w.user_id], ['Amount taken from wallet', naira(w.amount)], ['Fee', naira(w.fee)], ['Sent to the bank (after fee)', naira(w.net_amount)],
            ['Paystack transfer code', w.transfer_code], ['Settled', w.settled_at ? when(w.settled_at) : ''], ['Age', age(w.age_minutes)], ['Failure or note', w.failure_reason]]);
        });
      });
      box.appendChild(t.wrap);
    }
    $('poRegNewer').disabled = regOff === 0; $('poRegOlder').disabled = items.length < PAGE;
    $('poRegPager').hidden = regOff === 0 && items.length < PAGE;
  }

  async function loadLoc() {
    var mine = ++locReq, box = $('poLocList');
    tabs($('poLocTabs'), LOC_TABS, locF, function (f) { locF = f; locOff = 0; loadLoc(); });
    clear(box); box.appendChild(ctx.skeleton(3)); $('poLocPager').hidden = true;
    var res = await call('admin_local_payout_list', { p_filter: locF, p_offset: locOff });
    if (mine !== locReq) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The payouts could not be read.', loadLoc); return; }
    var d = res.data, items = d.items || [];
    $('poLocCount').textContent = d.total + ' payout record(s) in this view.';
    clear(box);
    if (!items.length) { if (locOff > 0) ctx.showEmpty(box, 'No older payouts.'); else if (locF === 'all') ctx.showEmpty(box, 'No Local Tasker payouts yet.'); else ctx.showNoResults(box); }
    else {
      var t = tableOf('Local Tasker payouts', ['Created', 'Local Tasker', 'Amount', 'Status', 'Destination', '']);
      items.forEach(function (p) {
        var tr = el('tr');
        cell(tr, 'Created', when(p.created_at));
        cell(tr, 'Local Tasker', p.name || 'Unnamed');
        cell(tr, 'Amount', naira(p.amount));
        var st = el('span'); st.appendChild(flag(words(p.status))); if (p.overdue) st.appendChild(flag('Overdue')); if (p.attempts > 1) st.appendChild(flag(p.attempts + ' attempts'));
        cell(tr, 'Status', st);
        cell(tr, 'Destination', p.account_last4 ? (p.bank_name || 'Bank') + ' ••••' + p.account_last4 : 'No account on file');
        withDetails(t, tr, 6, function () {
          return facts([['Payout id', p.id], ['Booking', p.booking_id], ['Release', p.release_key], ['Job payment (base)', naira(p.base_amount)], ['Fees taken', naira(p.fee_total)], ['Payout amount', naira(p.amount)],
            ['Transfer fee', p.transfer_fee == null ? '' : naira(p.transfer_fee)], ['Amount sent to the bank', p.send_amount == null ? '' : naira(p.send_amount)],
            ['Due after', p.release_after ? when(p.release_after) : ''], ['Claimed by the sender', p.claimed_at ? when(p.claimed_at) : ''], ['Sent', p.sent_at ? when(p.sent_at) : ''], ['Paid', p.paid_at ? when(p.paid_at) : ''],
            ['Provider status', p.provider_status], ['Reference', p.reference], ['Reason', p.status_reason], ['Last error', p.last_error], ['Payout account', p.account_status ? words(p.account_status) : '']]);
        });
      });
      box.appendChild(t.wrap);
    }
    $('poLocNewer').disabled = locOff === 0; $('poLocOlder').disabled = items.length < PAGE;
    $('poLocPager').hidden = locOff === 0 && items.length < PAGE;
  }

  function loadAll() { return Promise.all([loadOverview(), loadReg(), loadLoc()]); }
  $('poRegNewer').addEventListener('click', function () { regOff = Math.max(0, regOff - PAGE); loadReg(); });
  $('poRegOlder').addEventListener('click', function () { regOff += PAGE; loadReg(); });
  $('poLocNewer').addEventListener('click', function () { locOff = Math.max(0, locOff - PAGE); loadLoc(); });
  $('poLocOlder').addEventListener('click', function () { locOff += PAGE; loadLoc(); });
  loadAll();
});

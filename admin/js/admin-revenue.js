/* StreetTasker Admin: Revenue and commissions (stage A16, spec S15). READ ONLY.
   Calls admin_revenue_report and admin_revenue_list (revenue.view); both check again on the server.
   No button changes, refunds, adjusts or exports anything. Amounts arrive as integer kobo and are shown without floating point.
   Streams are never added together. All text via textContent. */
'use strict';
AdminShell.init({ page: 'revenue', title: 'Revenue and commissions', permission: 'revenue.view' }).then(function (ctx) {
  var $ = function (id) { return document.getElementById(id); };
  $('rvRoot').hidden = false;
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { var d = new Date(v); return (v == null || isNaN(d)) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }); }
  function day(s, opts) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m) return ''; return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-NG', Object.assign({ timeZone: 'UTC' }, opts)); }
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
  function cell(tr, label, content) { var td = el('td'); td.setAttribute('data-label', label); td.textContent = content == null ? '' : content; tr.appendChild(td); return td; }

  /* The five platform streams, then the memo. Definitions are printed under each number (spec S15). */
  var STREAMS = [
    { key: 'regular_commission', label: 'Regular Tasker commission', def: 'The platform fee stored on a job done by a Regular Tasker, counted on the day the release code was entered. Local Tasker jobs are not in this box.' },
    { key: 'local_commission', label: 'Local job commission (platform share)', def: 'The platform\u2019s share of the fee on a Local job, counted on the day of the final release. The Local Tasker\u2019s earnings and the coordinator\u2019s share are not in it.' },
    { key: 'subscription', label: 'Subscription revenue', def: 'Paid subscription receipts, plan price as stored, counted on the day paid. Not job money, and not coordinator plans.' },
    { key: 'coordinator_plan', label: 'Coordinator plan revenue', def: 'Paid coordinator tier upgrades, counted on the day paid. Kept apart from subscriptions.' },
    { key: 'withdrawal_fee', label: 'Withdrawal fees', def: 'The fee kept from a Regular Tasker on a successful withdrawal. Paystack bills its own transfer cost separately and that cost is not taken off here.' }
  ];
  var MEMO = { key: 'coordinator_share', label: 'Coordinator share (not platform income)', def: 'The coordinator\u2019s share of Local job fees. Shown so the Local fee can be traced; it is not the platform\u2019s money.' };
  var ALL = STREAMS.concat([MEMO]);
  var LABEL = {}; ALL.forEach(function (s) { LABEL[s.key] = s.label; });

  var cur = { bucket: 'week', from: '', to: '' }, rows = { stream: null, off: 0, req: 0 }, PAGE = 25, loadReq = 0;
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  function range() { return { p_from: ISO.test(cur.from) ? cur.from : null, p_to: ISO.test(cur.to) ? cur.to : null }; }

  function periodLabel(p, bucket) {
    if (bucket === 'month') return day(p, { month: 'long', year: 'numeric' });
    if (bucket === 'week') return 'Week of ' + day(p, { day: 'numeric', month: 'short', year: 'numeric' });
    return day(p, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function loadReport() {
    var mine = ++loadReq, sum = $('rvSummary'), ser = $('rvSeries'), al = $('rvAlerts');
    clear(sum); clear(ser); clear(al); $('rvRowsCard').hidden = true; rows.stream = null;
    sum.appendChild(ctx.skeleton(3));
    var r = range();
    var res = await call('admin_revenue_report', { p_bucket: cur.bucket, p_from: r.p_from, p_to: r.p_to });
    if (mine !== loadReq) return;
    var m = fail(res); clear(sum);
    if (m || !res.data) { ctx.showError(sum, m || 'The report could not be read.', loadReport); return; }
    var d = res.data;
    cur.from = d.from; cur.to = d.to; $('rvFrom').value = d.from; $('rvTo').value = d.to;
    $('rvRange').textContent = 'Showing ' + day(d.from, { day: 'numeric', month: 'short', year: 'numeric' }) + ' to ' + day(d.to, { day: 'numeric', month: 'short', year: 'numeric' }) + ' (Lagos days).';

    var g = el('div', 'ad-grid');
    STREAMS.forEach(function (s) { g.appendChild(streamBox(s, (d.streams || {})[s.key])); });
    sum.appendChild(g);
    var g2 = el('div', 'ad-grid');
    g2.appendChild(streamBox(MEMO, (d.streams || {})[MEMO.key]));
    var h = d.held || {};
    g2.appendChild(stat('Commission held, not earned yet', naira(h.kobo), (h.rows || 0) + ' job(s) paid and held in escrow. It becomes commission only when the release code is entered. Not part of any box above.'));
    sum.appendChild(g2);
    sum.appendChild(el('p', 'ad-hint', 'These boxes are different kinds of money and are never added into one total. Refunds recorded by support are not subtracted. No gift-card fee is stored anywhere, so none is counted.'));

    var any = ALL.some(function (s) { var x = (d.streams || {})[s.key]; return x && x.rows > 0; });
    if (!any) al.appendChild(el('p', 'ad-note', 'Nothing was earned in this period.'));

    var series = (d.series || []).slice().reverse();
    if (!series.length) ctx.showEmpty(ser, 'No periods in this range.');
    else {
      var t = tableOf('Revenue by period', ['Period'].concat(ALL.map(function (s) { return s.label; })));
      series.forEach(function (p) {
        var tr = el('tr'); cell(tr, 'Period', periodLabel(p.period, d.bucket));
        ALL.forEach(function (s) { cell(tr, s.label, naira(p[s.key])); });
        t.body.appendChild(tr);
      });
      ser.appendChild(t.wrap);
    }
    $('rvStamp').textContent = 'Read from the server at ' + when(d.generated_at) + '.';
  }

  function streamBox(s, x) {
    var box = el('div'), n = x ? x.rows : 0;
    box.appendChild(stat(s.label, naira(x ? x.kobo : null), s.def + ' ' + n + ' record(s).'));
    var b = el('button', 'btn ad-btn-small', 'Show rows'); b.type = 'button'; b.setAttribute('aria-label', 'Show the rows behind ' + s.label);
    b.disabled = !n;
    b.addEventListener('click', function () { rows.stream = s.key; rows.off = 0; loadRows(); });
    box.appendChild(b);
    return box;
  }

  async function loadRows() {
    var mine = ++rows.req, box = $('rvRows'), card = $('rvRowsCard');
    card.hidden = false; $('rvRowsTitle').textContent = 'Rows behind: ' + (LABEL[rows.stream] || rows.stream);
    clear(box); box.appendChild(ctx.skeleton(3)); $('rvPager').hidden = true;
    var r = range();
    var res = await call('admin_revenue_list', { p_stream: rows.stream, p_from: r.p_from, p_to: r.p_to, p_offset: rows.off });
    if (mine !== rows.req) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The rows could not be read.', loadRows); return; }
    var d = res.data, items = d.items || []; clear(box);
    $('rvRowsCount').textContent = d.total + ' record(s), ' + naira(d.total_kobo) + ' in this box.';
    if (!items.length) ctx.showEmpty(box, rows.off > 0 ? 'No older records.' : 'No records in this period.');
    else {
      var t = tableOf('Records', ['Date', 'Amount', 'Reference', 'Booking', 'What it is']);
      items.forEach(function (x) {
        var tr = el('tr'); cell(tr, 'Date', when(x.occurred_at)); cell(tr, 'Amount', naira(x.amount_kobo)); cell(tr, 'Reference', x.reference);
        cell(tr, 'Booking', x.booking_ref); cell(tr, 'What it is', x.note); t.body.appendChild(tr);
      });
      box.appendChild(t.wrap);
    }
    $('rvNewer').disabled = rows.off === 0; $('rvOlder').disabled = items.length < PAGE;
    $('rvPager').hidden = rows.off === 0 && items.length < PAGE;
    card.scrollIntoView({ block: 'nearest' });
  }

  $('rvFilters').addEventListener('submit', function (e) {
    e.preventDefault();
    cur.bucket = $('rvBucket').value; cur.from = $('rvFrom').value; cur.to = $('rvTo').value; loadReport();
  });
  $('rvReset').addEventListener('click', function () { cur = { bucket: 'week', from: '', to: '' }; $('rvBucket').value = 'week'; $('rvFrom').value = ''; $('rvTo').value = ''; loadReport(); });
  $('rvNewer').addEventListener('click', function () { rows.off = Math.max(0, rows.off - PAGE); loadRows(); });
  $('rvOlder').addEventListener('click', function () { rows.off += PAGE; loadRows(); });
  loadReport();
});

/* StreetTasker Admin: Accountant (stage A15b-2, spec S14b). Shows the daily release report, profit, owner capital and the
   labelled ledger, and records two kinds of human step: "I sent it to Paystack" and typed ledger lines (fees, expenses,
   settlements, capital) plus reversals. RECORD ONLY: nothing here moves money or calls Paystack (hard boundary 1).
   Server functions (all check the permission again): admin_accountant_reports, _mark_sent, _profit, _ledger, _record, _reverse.
   Needs accounting.view; recording needs accounting.record; capital lines need accounting.capital. All text via textContent. */
'use strict';
AdminShell.init({ page: 'accountant', title: 'Accountant', permission: 'accounting.view' }).then(function (ctx) {
  var PAGE = 50;
  var canRecord = ctx.has('accounting.record');
  var canCapital = ctx.has('accounting.capital');
  var $ = function (id) { return document.getElementById(id); };
  var root = $('acRoot');
  root.hidden = false;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function when(v) { var d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }); }
  function day(v) { var d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }); }
  function reportDay(s) { var d = new Date(String(s) + 'T12:00:00Z'); return isNaN(d) ? String(s || '') : d.toLocaleDateString('en-NG', { dateStyle: 'medium', timeZone: 'UTC' }); }
  function lagosToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }); }
  function dayStart(v) { return v ? new Date(v + 'T00:00:00+01:00').toISOString() : null; }
  function dayAfter(v) { return v ? new Date(new Date(v + 'T00:00:00+01:00').getTime() + 86400000).toISOString() : null; }

  /* Integer kobo to naira text. No floating point on the way in or out. */
  function naira(k) {
    if (k == null || k === '' || isNaN(Number(k))) return 'Not available';
    var n = Number(k), neg = n < 0; if (neg) n = -n;
    var whole = Math.floor(n / 100), cents = n % 100;
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
    return (neg ? '-' : '') + '₦' + s;
  }
  /* "12,500.50" to 1250050, or null if it is not a plain amount with at most two decimals. */
  function toKobo(text) {
    var t = String(text || '').replace(/[,\s₦]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var p = t.split('.'), frac = ((p[1] || '') + '00').slice(0, 2);
    var k = Number(p[0]) * 100 + Number(frac);
    return k > 0 && k <= Number.MAX_SAFE_INTEGER ? k : null;
  }
  function fail(res) {
    if (res && res.error) return 'The server could not answer. Nothing was changed.';
    if (res && res.data && res.data.ok === false) return res.data.error || 'The server refused this.';
    return null;
  }
  async function call(name, args) {
    try { return await window.supabase.rpc(name, args || {}); } catch (e) { return { error: e }; }
  }
  function badge(text) { return el('span', 'badge', text); }
  function stat(label, value, def, cls) {
    var s = el('div', 'ad-stat' + (cls ? ' ad-stat--' + cls : ''));
    s.appendChild(el('div', 'ad-stat-label', label));
    s.appendChild(el('div', 'ad-stat-num', value));
    if (def) s.appendChild(el('p', 'ad-hint', def));
    return s;
  }
  function tableOf(caption, heads) {
    var wrap = el('div', 'ad-tablewrap ad-cards');
    var tbl = el('table', 'ad-table ad-table--cards');
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
  /* Details and forms open in their own full-width row under the line, so long amounts never get squeezed into the button column. */
  function detailRow(t, cols) {
    var tr = el('tr', 'ad-detail-row'), td = el('td'); td.colSpan = cols; td.setAttribute('data-label', '');
    var holder = el('div', 'ad-detail'); td.appendChild(holder); tr.appendChild(td);
    return { tr: tr, holder: holder };
  }
  function stamp(v) { $('acStamp').textContent = v ? 'Read from the server at ' + when(v) + '.' : ''; }

  /* ---------------- daily reports and the "I sent it" record ---------------- */
  var reports = [];
  var statusText = { to_send: 'To send', sent: 'Sent', no_release: 'Nothing due' };

  function reportFacts(r) {
    var dl = el('dl', 'ad-dl');
    function add(k, v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    add('Window', when(r.window_start) + ' to ' + when(r.window_end) + ' (Nigeria time)');
    add('Jobs released by release code', String(r.jobs_released));
    add('Amount to send to Paystack', naira(r.tasker_kobo));
    add('Regular Taskers', naira(r.regular_kobo));
    add('Local Taskers', naira(r.local_kobo));
    add('Coordinator commission (shown apart, not in the amount to send)', r.coordinator_kobo == null ? 'Not available' : naira(r.coordinator_kobo));
    add('Platform commission (the owner’s own money, not sent)', naira(r.platform_kobo));
    add('Customers paid for these jobs', naira(r.customer_kobo));
    return dl;
  }

  function drawDue() {
    var box = $('acDue'); clear(box);
    if (!reports.length) { box.appendChild(el('p', 'ad-note', 'No daily report has been built yet. The first one is built at 9:00 pm Nigeria time.')); return; }
    var open = reports.filter(function (r) { return r.status === 'to_send'; });
    if (!open.length) {
      var last = reports[0];
      box.appendChild(el('p', 'ad-note', last.status === 'no_release'
        ? 'Nothing is waiting. ' + reportDay(last.report_date) + ': no release code was entered, so nothing needs to be sent.'
        : 'Nothing is waiting. ' + reportDay(last.report_date) + ' was recorded as sent (' + naira(last.sent_kobo) + ').'));
      return;
    }
    var total = open.reduce(function (a, r) { return a + Number(r.tasker_kobo || 0); }, 0);
    var banner = el('div', 'ad-banner');
    banner.appendChild(el('strong', null, open.length + (open.length === 1 ? ' day is' : ' days are') + ' waiting. Total to send: ' + naira(total) + '.'));
    banner.appendChild(el('p', 'ad-hint', 'Put this in Paystack, then record it in the table below. Recording does not send anything.'));
    box.appendChild(banner);
  }

  function openSendForm(r, holder, btn) {
    if (holder.dataset.open === '1') { clear(holder); holder.dataset.open = ''; btn.textContent = 'Record as sent'; return; }
    clear(holder);
    holder.appendChild(reportFacts(r));
    var form = el('form', 'ad-form ad-inline-form'); form.noValidate = true;
    var fa = el('div', 'ad-field'), la = el('label', null, 'Amount you sent (₦)'); la.htmlFor = 'sAmt' + r.report_date;
    var ia = el('input', 'form-input'); ia.id = 'sAmt' + r.report_date; ia.inputMode = 'decimal'; ia.autocomplete = 'off';
    ia.value = (Number(r.tasker_kobo) % 100 === 0) ? String(Number(r.tasker_kobo) / 100) : (Number(r.tasker_kobo) / 100).toFixed(2);
    fa.appendChild(la); fa.appendChild(ia);
    var fn = el('div', 'ad-field'), ln = el('label', null, 'Note (needed only if the amount differs from the report: 10 or more characters)'); ln.htmlFor = 'sNote' + r.report_date;
    var inn = el('input', 'form-input'); inn.id = 'sNote' + r.report_date; inn.maxLength = 300; inn.autocomplete = 'off';
    fn.appendChild(ln); fn.appendChild(inn);
    var err = el('p', 'ad-error'); err.setAttribute('role', 'alert'); err.hidden = true;
    var go = el('button', 'btn btn-primary', 'I sent this amount to Paystack'); go.type = 'submit';
    form.appendChild(fa); form.appendChild(fn); form.appendChild(err); form.appendChild(go);
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); err.hidden = true;
      var k = toKobo(ia.value);
      if (k == null) { err.textContent = 'Enter the amount as a plain number, for example 12500 or 12500.50.'; err.hidden = false; return; }
      if (k !== Number(r.tasker_kobo) && inn.value.trim().length < 10) { err.textContent = 'The amount differs from the report. Write a reason of at least 10 characters.'; err.hidden = false; return; }
      go.disabled = true;
      var res = await call('admin_accountant_mark_sent', { p_date: r.report_date, p_amount_kobo: k, p_note: inn.value.trim() || null });
      go.disabled = false;
      var m = fail(res);
      if (m) { err.textContent = m; err.hidden = false; return; }
      ctx.toast('Recorded as sent. Nothing was sent by this page.', 'success');
      await loadAll();
    });
    holder.appendChild(form);
    holder.dataset.open = '1'; btn.textContent = 'Close';
  }

  function drawReports() {
    var box = $('acReports'); clear(box);
    if (!reports.length) { ctx.showEmpty(box, 'Reports appear here after the first 9:00 pm run.'); return; }
    var t = tableOf('Daily reports', ['Day', 'Jobs released', 'To send', 'Platform commission', 'Status', '']);
    reports.forEach(function (r) {
      var tr = el('tr');
      cell(tr, 'Day', reportDay(r.report_date));
      cell(tr, 'Jobs released', String(r.jobs_released));
      cell(tr, 'To send', naira(r.tasker_kobo));
      cell(tr, 'Platform commission', naira(r.platform_kobo));
      var st = el('span'); st.appendChild(badge(statusText[r.status] || r.status));
      if (r.status === 'sent') st.appendChild(el('span', 'ad-row-sub', ' ' + [naira(r.sent_kobo), r.sent_at ? when(r.sent_at) : ''].filter(Boolean).join(', ')));
      cell(tr, 'Status', st);
      var act = el('td'); act.setAttribute('data-label', '');
      var dr = detailRow(t, 6), holder = dr.holder;
      var det = el('button', 'btn ad-btn-small', 'Details'); det.type = 'button';
      det.addEventListener('click', function () {
        if (holder.dataset.open === 'facts') { clear(holder); holder.dataset.open = ''; return; }
        clear(holder); holder.appendChild(reportFacts(r)); holder.dataset.open = 'facts';
      });
      act.appendChild(det);
      if (r.status === 'to_send' && canRecord) {
        var b = el('button', 'btn btn-primary ad-btn-small', 'Record as sent'); b.type = 'button';
        b.addEventListener('click', function () { openSendForm(r, holder, b); });
        act.appendChild(b);
      }
      tr.appendChild(act);
      t.body.appendChild(tr); t.body.appendChild(dr.tr);
    });
    box.appendChild(t.wrap);
    if (!canRecord) box.appendChild(el('p', 'ad-hint', 'You can read the reports. Recording that money was sent needs the Record permission.'));
  }

  /* ---------------- profit ---------------- */
  var profitReq = 0;
  async function loadProfit() {
    var mine = ++profitReq, box = $('acProfit');
    clear(box); box.appendChild(ctx.skeleton(2));
    var res = await call('admin_accountant_profit', { p_from: dayStart($('pFrom').value), p_to: dayAfter($('pTo').value) });
    if (mine !== profitReq) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The profit could not be read.', loadProfit); return; }
    var d = res.data; clear(box);
    var grid = el('div', 'ad-grid');
    grid.appendChild(stat('Income', naira(d.income_kobo), 'Commission on released jobs, subscription payments, and the transfer fee and stamp duty deducted from taskers. From site records.'));
    grid.appendChild(stat('Costs', naira(d.costs_kobo), 'Fees and expenses typed in below. Entered by the accountant.'));
    grid.appendChild(stat(d.complete ? 'Profit' : 'Profit (not final)', naira(d.profit_kobo), 'Income minus costs. Gift cards sold, donations, wallet top-ups, customer or tasker money and owner capital are never income.', d.complete ? null : 'warn'));
    box.appendChild(grid);
    if (!d.complete) {
      var b = el('div', 'ad-banner');
      b.appendChild(el('strong', null, 'This profit is not final.'));
      b.appendChild(el('p', 'ad-hint', 'No entry has been typed in this period for: ' + (d.missing_cost_entries || []).join(', ') + '. If one of these was paid, record it below; if it truly cost nothing, the profit is correct for now.'));
      box.appendChild(b);
    }
    [['Income lines', d.income], ['Cost lines', d.costs]].forEach(function (g) {
      if (!g[1] || !g[1].length) return;
      var t = tableOf(g[0], ['Line', 'Amount']);
      g[1].forEach(function (x) { var tr = el('tr'); cell(tr, 'Line', x.title); cell(tr, 'Amount', naira(x.amount_kobo)); t.body.appendChild(tr); });
      box.appendChild(t.wrap);
    });
    box.appendChild(el('p', 'ad-hint', 'Coordinator plan payments are not counted yet, so income may be understated.'));
    stamp(d.generated_at);
  }

  /* ---------------- owner capital (all time) ---------------- */
  async function loadCapital() {
    var box = $('acCapital'); clear(box);
    var res = await call('admin_accountant_ledger', { p_limit: 1, p_offset: 0 });
    var m = fail(res);
    if (m || !res.data) { box.appendChild(el('p', 'ad-note', 'Not available: the totals could not be read.')); return; }
    var inK = 0, outK = 0;
    (res.data.totals || []).forEach(function (t) {
      if (t.label === 'capital_in') inK = Number(t.amount_kobo);
      if (t.label === 'capital_repaid') outK = Number(t.amount_kobo);
    });
    var grid = el('div', 'ad-grid');
    grid.appendChild(stat('Put in', naira(inK), 'Owner money put into the business.'));
    grid.appendChild(stat('Repaid', naira(outK), 'Owner money taken back.'));
    grid.appendChild(stat('Outstanding', naira(inK - outK), 'Put in minus repaid. Reversed entries are not counted.', (inK - outK) < 0 ? 'danger' : null));
    box.appendChild(grid);
    box.appendChild(el('p', 'ad-hint', 'This page cannot see the real bank or Paystack balance. Do not take money back unless the cash held covers what is still owed to taskers and gift card holders.'));
  }

  /* ---------------- ledger ---------------- */
  var offset = 0, ledReq = 0, labelsDrawn = false;

  function drawLabelFilter(totals, entries) {
    // Labels seen so far; the server has no separate label list.
    var f = $('fLabel'), seen = {};
    Array.prototype.forEach.call(f.options, function (o) { seen[o.value] = true; });
    (totals || []).concat(entries || []).forEach(function (x) {
      if (!x.label || seen[x.label]) return; seen[x.label] = true;
      var o = el('option', null, x.title || x.label); o.value = x.label; f.appendChild(o);
    });
  }

  function drawTotals(totals) {
    var box = $('acTotals'); clear(box);
    if (!totals || !totals.length) return;
    var t = tableOf('Totals by label', ['Group', 'Label', 'Entries', 'Total']);
    totals.forEach(function (x) {
      var tr = el('tr'); cell(tr, 'Group', x.group); cell(tr, 'Label', x.title); cell(tr, 'Entries', String(x.entries)); cell(tr, 'Total', naira(x.amount_kobo));
      t.body.appendChild(tr);
    });
    var d = el('details', 'ad-card'); d.appendChild(el('summary', null, 'Totals by label for this filter'));
    d.appendChild(t.wrap); box.appendChild(d);
  }

  function reverseForm(e, holder, btn) {
    if (holder.dataset.open === '1') { clear(holder); holder.dataset.open = ''; btn.textContent = 'Reverse'; return; }
    var form = el('form', 'ad-form ad-inline-form'); form.noValidate = true;
    var fa = el('div', 'ad-field'), la = el('label', null, 'Reason for reversing this line (10 or more characters)'); la.htmlFor = 'rv' + e.id;
    var ia = el('input', 'form-input'); ia.id = 'rv' + e.id; ia.maxLength = 300; ia.autocomplete = 'off';
    fa.appendChild(la); fa.appendChild(ia);
    var err = el('p', 'ad-error'); err.setAttribute('role', 'alert'); err.hidden = true;
    var go = el('button', 'btn btn-primary', 'Add the reversal'); go.type = 'submit';
    form.appendChild(el('p', 'ad-hint', 'This adds a new line that cancels the first. The first line stays in the ledger.'));
    form.appendChild(fa); form.appendChild(err); form.appendChild(go);
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault(); err.hidden = true;
      if (ia.value.trim().length < 10) { err.textContent = 'Write a reason of at least 10 characters.'; err.hidden = false; return; }
      go.disabled = true;
      var res = await call('admin_accountant_reverse', { p_entry: e.id, p_reason: ia.value.trim() });
      go.disabled = false;
      var m = fail(res);
      if (m) { err.textContent = m; err.hidden = false; return; }
      ctx.toast('Reversal added to the ledger.', 'success');
      await Promise.all([loadLedger(), loadProfit(), loadCapital()]);
    });
    clear(holder); holder.appendChild(form); holder.dataset.open = '1'; btn.textContent = 'Close';
  }

  function drawLedger(entries) {
    var box = $('acLedger'); clear(box);
    if (!entries.length) {
      if (offset > 0) ctx.showEmpty(box, 'No older entries.'); else ctx.showNoResults(box);
      return;
    }
    var t = tableOf('Ledger', ['Date', 'Label', 'Direction', 'Amount', 'Reference or note', 'Source', '']);
    var dirText = { 'in': 'Money in', out: 'Money out', memo: 'Record only' };
    entries.forEach(function (e) {
      var extra = null;
      var tr = el('tr'); if (e.reversed) tr.className = 'ad-muted';
      cell(tr, 'Date', when(e.entry_at));
      var lab = el('span'); lab.appendChild(el('span', null, e.title || e.label));
      if (e.reversed) lab.appendChild(badge('Reversed'));
      if (e.reverses != null) lab.appendChild(badge('Reverses #' + e.reverses));
      cell(tr, 'Label', lab);
      cell(tr, 'Direction', dirText[e.direction] || e.direction);
      cell(tr, 'Amount', naira(e.amount_kobo));
      var note = el('span'); if (e.reference) note.appendChild(el('span', null, e.reference + (e.note ? ' — ' : '')));
      if (e.note) note.appendChild(el('span', 'ad-row-sub', e.note));
      if (e.booking_ref) note.appendChild(el('span', 'ad-row-sub', ' Job ' + e.booking_ref));
      cell(tr, 'Reference or note', note.firstChild ? note : '—');
      cell(tr, 'Source', e.auto ? 'Site' : 'Typed');
      var act = el('td'); act.setAttribute('data-label', '');
      var canRev = canRecord && !e.auto && !e.reversed && e.label !== 'reversal' && ((e.label !== 'capital_in' && e.label !== 'capital_repaid') || canCapital);
      if (canRev) {
        var dr = detailRow(t, 7), holder = dr.holder; extra = dr.tr;
        var b = el('button', 'btn ad-btn-small', 'Reverse'); b.type = 'button';
        b.addEventListener('click', function () { reverseForm(e, holder, b); });
        act.appendChild(b);
      }
      tr.appendChild(act); t.body.appendChild(tr); if (extra) t.body.appendChild(extra);
    });
    box.appendChild(t.wrap);
  }

  async function loadLedger() {
    var mine = ++ledReq, box = $('acLedger');
    clear(box); box.appendChild(ctx.skeleton(4)); $('acPager').hidden = true;
    var res = await call('admin_accountant_ledger', {
      p_from: dayStart($('fFrom').value), p_to: dayAfter($('fTo').value), p_label: $('fLabel').value || null, p_limit: PAGE, p_offset: offset
    });
    if (mine !== ledReq) return;
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The ledger could not be read.', loadLedger); clear($('acTotals')); return; }
    var d = res.data, entries = d.entries || [];
    drawLabelFilter(d.totals, entries);
    drawTotals(d.totals);
    drawLedger(entries);
    $('pNewer').disabled = offset === 0;
    $('pOlder').disabled = entries.length < PAGE;
    $('acPager').hidden = offset === 0 && entries.length < PAGE;
    stamp(d.generated_at);
  }

  /* ---------------- typed entries ---------------- */
  var TYPED = [
    { group: 'Moves between accounts', items: [['settlement_received', 'Paystack settlement paid into the bank'], ['commission_moved', 'Platform commission moved to the operating account']] },
    { group: 'Fees and costs', items: [['paystack_fee_collection', 'Paystack fee on customer payments (from the statement)'], ['paystack_fee_transfer', 'Paystack transfer fee (from the statement)'], ['paystack_stamp_duty', 'Stamp duty charged by Paystack (from the statement)'], ['expense_hosting', 'Hosting and database'], ['expense_email', 'Email service'], ['expense_id_verification', 'ID verification service'], ['expense_domain', 'Domain'], ['expense_marketing', 'Marketing'], ['expense_tax', 'Tax'], ['expense_other', 'Other expense (the note must say what)']] },
    { group: 'Owner capital (Super Admin only)', capital: true, items: [['capital_in', 'Owner put money into the business (a loan, not income)'], ['capital_repaid', 'Owner took money back (repaying the loan)']] }
  ];

  function setupForm() {
    if (!canRecord && !canCapital) return;
    $('acFormCard').hidden = false;
    var sel = $('rLabel');
    TYPED.forEach(function (g) {
      if (g.capital && !canCapital) return;
      if (!g.capital && !canRecord) return;
      var og = el('optgroup'); og.label = g.group;
      g.items.forEach(function (i) { var o = el('option', null, i[1]); o.value = i[0]; og.appendChild(o); });
      sel.appendChild(og);
    });
    $('rDate').max = lagosToday(); $('rDate').value = lagosToday();
    sel.addEventListener('change', function () {
      $('rNoteHint').textContent = sel.value === 'expense_other' ? 'At least 10 characters: say what it was.' : 'At least 5 characters.';
    });
    $('acForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('rError'); err.hidden = true;
      function bad(t) { err.textContent = t; err.hidden = false; }
      var k = toKobo($('rAmount').value);
      if (k == null) return bad('Enter the amount as a plain number above zero, for example 12500 or 12500.50.');
      if (!$('rDate').value) return bad('Enter the date it happened.');
      if ($('rDate').value > lagosToday()) return bad('The date cannot be in the future.');
      var note = $('rNote').value.trim(), min = sel.value === 'expense_other' ? 10 : 5;
      if (note.length < min) return bad('Write a note of at least ' + min + ' characters saying what this is.');
      $('rSave').disabled = true;
      var res = await call('admin_accountant_record', { p_label: sel.value, p_amount_kobo: k, p_date: $('rDate').value, p_note: note, p_reference: $('rRef').value.trim() || null });
      $('rSave').disabled = false;
      var m = fail(res);
      if (m) return bad(m);
      ctx.toast('Added to the ledger.', 'success');
      $('rAmount').value = ''; $('rNote').value = ''; $('rRef').value = '';
      offset = 0;
      await Promise.all([loadLedger(), loadProfit(), loadCapital()]);
    });
  }

  /* ---------------- load ---------------- */
  async function loadReports() {
    var box = $('acReports'); clear(box); box.appendChild(ctx.skeleton(3));
    var res = await call('admin_accountant_reports', { p_limit: 31 });
    var m = fail(res);
    if (m || !res.data) { ctx.showError(box, m || 'The reports could not be read.', loadAll); clear($('acDue')); return; }
    reports = res.data.reports || [];
    stamp(res.data.generated_at);
    drawDue(); drawReports();
  }
  function loadAll() { return Promise.all([loadReports(), loadProfit(), loadCapital(), loadLedger()]); }

  var today = lagosToday();
  $('pFrom').value = today.slice(0, 8) + '01'; $('pTo').value = today;
  $('acProfitForm').addEventListener('submit', function (e) { e.preventDefault(); loadProfit(); });
  $('pAll').addEventListener('click', function () { $('pFrom').value = ''; $('pTo').value = ''; loadProfit(); });
  $('acLedForm').addEventListener('submit', function (e) { e.preventDefault(); offset = 0; loadLedger(); });
  $('fReset').addEventListener('click', function () { $('fLabel').value = ''; $('fFrom').value = ''; $('fTo').value = ''; offset = 0; loadLedger(); });
  $('pNewer').addEventListener('click', function () { offset = Math.max(0, offset - PAGE); loadLedger(); });
  $('pOlder').addEventListener('click', function () { offset += PAGE; loadLedger(); });
  setupForm();
  loadAll();
});

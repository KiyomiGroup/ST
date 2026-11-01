/* ============================================================
   STREETTASKER — wallet-data.js
   Real data for wallet.html. Loads after wallet-ui.js.

   WHAT IS LIVE (tasker)
   - Balance cards ......... wallets.balance and wallets.pending_balance
                             (via ST.payments.getWallet, which also counts
                             escrow_payments rows that are still "held")
   - Lifetime disbursed .... sum of the tasker's completed earnings in
                             wallet_transactions (types escrow_release and
                             earning, already net of the platform fee)
   - Financial ledger ...... wallet_transactions + held escrow_payments,
                             with job titles from bookings, tasks, services
   - Recent activity ....... the same rows, newest five (mobile)
   - Withdrawal popup ...... pays to a SAVED bank account: ST.payments.listBankAccounts,
                             then ST.payments.withdrawFromWallet(amount, accountId), which
                             calls the process-withdrawal Edge Function. Fee and limits come
                             from the database (withdrawal_fee, withdrawal_limits).

   NOT HERE ON PURPOSE
   - Service gift cards and the gift card ledger stay as placeholders for
     whoever builds the gift card functionality.

   SECURITY
   - The role comes from the signed-in session, not from the URL.
   - This file only shows data the user's own Supabase session can read.
     The balance check and the transfer are done by the Edge Function.
   - Every value from the database is written with textContent, never as HTML.
   ============================================================ */
(function () {
  'use strict';

  var page = document.getElementById('walletPage');
  if (!page) return;

  var PAGE_SIZE = 5;
  var CREDIT_TYPES = ['escrow_release', 'earning'];
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var state = { uid: null, role: null, wallet: null, rows: [], filter: 'all', pageNo: 1 };

  /* ── Small helpers ───────────────────────────────────────── */
  function $(sel, root) { return (root || page).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || page).querySelectorAll(sel)); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(n) { return Math.floor(Math.abs(n)).toLocaleString('en-NG'); }
  function cents(n) { return String(Math.round((Math.abs(n) - Math.floor(Math.abs(n))) * 100)).padStart(2, '0'); }
  function money2(n) { return '\u20A6' + Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function moneyShort(n) { return '\u20A6' + (Math.abs(n) % 1 ? Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt(n)); }
  function safe(p) { return Promise.resolve(p).then(function (r) { return (r && r.data) || null; }, function () { return null; }); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(id) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'wl-i');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  /* ── Dates ───────────────────────────────────────────────── */
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function timeStr(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function dateLong(d) {
    if (isNaN(d)) return '';
    var now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(d, now)) return 'Today, ' + timeStr(d);
    if (sameDay(d, y)) return 'Yesterday, ' + timeStr(d);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function dateShort(d) {
    if (isNaN(d)) return '';
    var now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(d, now)) return 'Today, ' + timeStr(d);
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* ── Balance cards ───────────────────────────────────────── */
  // value null means "unknown" (shown as a dash)
  function setAmount(name, value) {
    $$('[data-wl-value="' + name + '"]').forEach(function (n) {
      n.textContent = value == null ? '\u2014' : fmt(value);
      var dec = n.parentNode && n.parentNode.querySelector('.wl-amt-dec');
      if (dec) dec.textContent = value == null ? '' : '.' + cents(value);
    });
  }
  function setText(name, text) {
    $$('[data-wl-value="' + name + '"]').forEach(function (n) { n.textContent = text; });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function monthKey(d) { return d.getFullYear() * 12 + d.getMonth(); }

  function renderCards(wallet, rows, heldCount) {
    var available = num(wallet.balance), escrow = num(wallet.pending_balance);
    setAmount('available', available);
    setAmount('escrow', escrow);
    setText('escrow-short', '\u20A6' + fmt(escrow) + ' Escrow');
    setText('escrow-tasks', plural(heldCount, 'Active Task', 'Active Tasks'));

    var total = 0, count = 0, thisM = 0, lastM = 0;
    var now = new Date(), thisKey = monthKey(now), lastKey = thisKey - 1;
    rows.forEach(function (r) {
      if (!r.earning) return;
      total += r.amount; count++;
      var k = monthKey(r.date);
      if (k === thisKey) thisM += r.amount; else if (k === lastKey) lastM += r.amount;
    });
    setAmount('lifetime', total);
    setText('lifetime-tasks', plural(count, 'task', 'tasks') + ' completed');
    if (lastM > 0) {
      var pct = Math.round(((thisM - lastM) / lastM) * 100);
      setText('lifetime-growth', (pct > 0 ? '+' : '') + pct + '%');
    } else {
      setText('lifetime-growth', '\u2014');
    }
  }

  /* ── Turning database rows into ledger rows ──────────────── */
  function describeJob(info, bookingId) {
    var title = (info && info.title) || 'Job payment';
    var parts = [];
    if (bookingId) parts.push('Booking #' + String(bookingId).slice(0, 6).toUpperCase());
    if (info && info.client) parts.push('Client: ' + info.client);
    if (info && info.location) parts.push(info.location);
    return { title: title, meta: parts.join(' \u2022 ') };
  }

  function withdrawalBadge(status) {
    var s = String(status || 'completed').toLowerCase();
    if (s === 'completed' || s === 'success' || s === 'successful' || s === 'processed') return { text: 'Processed', cls: 'grey' };
    if (s === 'failed' || s === 'reversed' || s === 'rejected') return { text: 'Failed', cls: 'grey' };
    return { text: 'Pending', cls: 'grey' };
  }

  function buildRows(txns, held, jobs) {
    var rows = [];
    txns.forEach(function (t) {
      var amount = num(t.amount), date = new Date(t.created_at), info = jobs[t.booking_id] || null;
      if (CREDIT_TYPES.indexOf(t.type) !== -1) {
        var j = describeJob(info, t.booking_id);
        rows.push({
          date: date, amount: amount, earning: String(t.status || 'completed') !== 'failed', kind: 'credit',
          filters: ['earning', 'escrow'], icon: 'i-arrow-down', tone: 'mint',
          title: (t.type === 'escrow_release' ? 'Escrow Released: ' : 'Task Earning: ') + j.title,
          actTitle: t.type === 'escrow_release' ? 'Escrow Released' : 'Task Earning Received',
          actSub: j.title, actIcon: t.type === 'escrow_release' ? 'i-badge-check' : 'i-banknote',
          meta: j.meta, badge: { text: 'Completed', cls: 'mint' }, sign: '+', amtClass: 'is-credit'
        });
      } else if (t.type === 'withdrawal_refund') {
        // Money returned after a failed or reversed withdrawal: a credit, but NOT an earning
        var rmeta = [];
        if (t.reference) rmeta.push('Ref: ' + String(t.reference).replace(/-refund$/, ''));
        rmeta.push('Returned to your wallet');
        rows.push({
          date: date, amount: amount, earning: false, kind: 'credit',
          filters: ['withdrawal'], icon: 'i-arrow-down', tone: 'mint',
          title: 'Withdrawal refunded', actTitle: 'Withdrawal Refunded', actSub: 'Returned to your wallet', actIcon: 'i-arrow-down',
          meta: rmeta.join(' \u2022 '), badge: { text: 'Completed', cls: 'mint' }, sign: '+', amtClass: 'is-credit'
        });
      } else if (t.type === 'withdrawal') {
        var meta = [];
        if (t.reference) meta.push('Ref: ' + t.reference);
        if (t.note) meta.push(String(t.note).slice(0, 80));
        var b = withdrawalBadge(t.status);
        rows.push({
          date: date, amount: amount, earning: false, kind: 'debit',
          filters: ['withdrawal'], icon: 'i-arrow-up-right', tone: 'grey',
          title: 'Withdrawal to bank', actTitle: 'Payout to Bank', actSub: b.text, actIcon: 'i-arrow-up-right',
          meta: meta.join(' \u2022 ') || 'Bank transfer', badge: b, sign: '-', amtClass: 'is-debit'
        });
      }
      // other types (customer-side holds, notes) are not part of a tasker's ledger
    });
    held.forEach(function (h) {
      var j = describeJob(jobs[h.booking_id] || null, h.booking_id);
      rows.push({
        date: new Date(h.paid_at || h.created_at), amount: num(h.tasker_amount), earning: false, kind: 'hold',
        filters: ['escrow'], icon: 'i-hourglass', tone: 'soft',
        title: 'Locked In Escrow: ' + j.title, actTitle: 'Locked In Escrow', actSub: j.title, actIcon: 'i-hourglass',
        meta: j.meta, badge: { text: 'In Escrow', cls: 'grey' }, sign: '', amtClass: 'is-hold'
      });
    });
    rows.sort(function (a, b) { return b.date - a.date; });
    return rows;
  }

  /* ── Ledger (desktop) ────────────────────────────────────── */
  var pane = document.getElementById('ledgerTasker');

  function filtered() {
    return state.rows.filter(function (r) { return state.filter === 'all' || r.filters.indexOf(state.filter) !== -1; });
  }

  function renderLedger() {
    if (!pane) return;
    var list = $('.wl-tx-list', pane), empty = $('.wl-led-empty', pane);
    var all = filtered(), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.pageNo = Math.min(Math.max(1, state.pageNo), pages);
    var slice = all.slice((state.pageNo - 1) * PAGE_SIZE, state.pageNo * PAGE_SIZE);

    list.textContent = '';
    slice.forEach(function (r) {
      var li = el('li', 'wl-tx');
      var ic = el('span', 'wl-tx-icon wl-tx-icon-' + r.tone);
      ic.setAttribute('aria-hidden', 'true');
      ic.appendChild(icon(r.icon));
      var main = el('div', 'wl-tx-main');
      var title = el('p', 'wl-tx-title');
      title.appendChild(el('span', null, r.title));
      title.appendChild(el('span', 'wl-badge wl-badge-' + r.badge.cls, r.badge.text));
      main.appendChild(title);
      if (r.meta) main.appendChild(el('p', 'wl-tx-meta', r.meta));
      var side = el('div', 'wl-tx-side');
      side.appendChild(el('p', 'wl-tx-amt ' + r.amtClass, r.sign + money2(r.amount)));
      side.appendChild(el('p', 'wl-tx-date', dateLong(r.date)));
      li.appendChild(ic); li.appendChild(main); li.appendChild(side);
      list.appendChild(li);
    });

    empty.textContent = '';
    if (slice.length === 0) {
      empty.hidden = false;
      empty.textContent = state.rows.length === 0
        ? 'No transactions yet. Complete jobs to start earning.'
        : 'No transactions in this view yet.';
    } else {
      empty.hidden = true;
    }
    $('[data-wl-shown]', pane).textContent = slice.length;
    $('[data-wl-total]', pane).textContent = all.length;
    $('[data-wl-plural]', pane).textContent = all.length === 1 ? '' : 's';
    $('[data-action="ledger-prev"]', pane).disabled = state.pageNo <= 1;
    $('[data-action="ledger-next"]', pane).disabled = state.pageNo >= pages;
  }

  if (pane) {
    page.addEventListener('click', function (e) {
      var f = e.target.closest('.wl-filter');
      if (f) {
        var group = f.closest('.wl-filters');
        if (!group || group.getAttribute('aria-controls') !== 'ledgerTasker') return;
        $$('.wl-filter', group).forEach(function (b) { b.setAttribute('aria-pressed', b === f ? 'true' : 'false'); });
        state.filter = f.getAttribute('data-filter');
        state.pageNo = 1;
        renderLedger();
        return;
      }
      var a = e.target.closest('[data-action="ledger-prev"], [data-action="ledger-next"]');
      if (a && pane.contains(a)) {
        state.pageNo += a.getAttribute('data-action') === 'ledger-next' ? 1 : -1;
        renderLedger();
      }
    });
  }

  /* ── Recent activity (mobile) ────────────────────────────── */
  function renderActivity() {
    var ul = document.getElementById('actTasker'), empty = document.getElementById('actTaskerEmpty');
    if (!ul || !empty) return;
    ul.textContent = '';
    state.rows.slice(0, PAGE_SIZE).forEach(function (r) {
      var li = el('li', 'wl-act');
      var ic = el('span', 'wl-act-icon');
      ic.setAttribute('aria-hidden', 'true');
      ic.appendChild(icon(r.actIcon));
      var main = el('div', 'wl-act-main');
      main.appendChild(el('p', 'wl-act-title', r.actTitle));
      main.appendChild(el('p', 'wl-act-sub', r.actSub));
      var side = el('div', 'wl-act-side');
      side.appendChild(el('p', 'wl-act-amt ' + (r.kind === 'credit' ? 'is-credit' : 'is-debit'), r.sign + moneyShort(r.amount)));
      side.appendChild(el('p', 'wl-act-date', dateShort(r.date)));
      li.appendChild(ic); li.appendChild(main); li.appendChild(side);
      ul.appendChild(li);
    });
    empty.hidden = state.rows.length > 0;
    empty.textContent = 'No activity yet. Complete jobs to start earning.';
  }

  /* ── Loading and errors ──────────────────────────────────── */
  function showError(message) {
    page.classList.remove('wl-loading');
    ['available', 'escrow', 'lifetime'].forEach(function (n) { setAmount(n, null); });
    setText('escrow-short', '\u20A6\u2014 Escrow');
    setText('escrow-tasks', 'Unavailable');
    setText('lifetime-tasks', 'Unavailable');
    setText('lifetime-growth', '\u2014');
    [[pane && $('.wl-led-empty', pane)], [document.getElementById('actTaskerEmpty')]].forEach(function (pair) {
      var n = pair[0];
      if (!n) return;
      n.hidden = false;
      n.textContent = message + ' ';
      var retry = el('button', 'wl-led-retry', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', function () { n.textContent = 'Loading\u2026'; loadTasker(); });
      n.appendChild(retry);
    });
    if (pane) { $('.wl-tx-list', pane).textContent = ''; }
  }

  /* ── Loading the tasker's real data ──────────────────────── */
  var loading = false;
  function loadTasker() {
    if (loading) return Promise.resolve();
    loading = true;
    var sb = window.supabase, pay = window.ST && window.ST.payments;
    if (!sb || !pay) { loading = false; showError('The payment module did not load. Refresh the page.'); return Promise.resolve(); }

    return pay.getWallet(state.uid).then(function (wallet) {
      if (wallet._stub) throw new Error('Your wallet is not set up yet. Please contact support.');
      state.wallet = wallet;
      return Promise.all([
        pay.fetchWalletTransactions(state.uid, 500),
        safe(sb.from('escrow_payments').select('*').eq('tasker_id', state.uid).eq('status', 'held'))
      ]).then(function (res) {
        var txns = res[0] || [], held = res[1] || [];
        var ids = [];
        txns.concat(held).forEach(function (r) { if (r.booking_id && ids.indexOf(r.booking_id) === -1) ids.push(r.booking_id); });
        return loadJobs(ids).then(function (jobs) {
          state.rows = buildRows(txns, held, jobs);
          renderCards(wallet, state.rows, held.length);
          renderLedger();
          renderActivity();
          page.classList.remove('wl-loading');
        });
      });
    }).catch(function (e) {
      console.warn('[Wallet] load failed:', e && e.message);
      showError((e && e.message) || 'Could not load your wallet.');
    }).then(function () { loading = false; });
  }

  // Job title, client and place for each booking id: same sources the tasker overview uses
  function loadJobs(ids) {
    var sb = window.supabase, jobs = {};
    if (!ids.length) return Promise.resolve(jobs);
    return safe(sb.from('bookings').select('*').in('id', ids)).then(function (bks) {
      bks = bks || [];
      var taskIds = [], svcIds = [], custIds = [];
      bks.forEach(function (b) {
        if (b.task_id && taskIds.indexOf(b.task_id) === -1) taskIds.push(b.task_id);
        if (b.service_id && svcIds.indexOf(b.service_id) === -1) svcIds.push(b.service_id);
        if (b.customer_id && custIds.indexOf(b.customer_id) === -1) custIds.push(b.customer_id);
      });
      return Promise.all([
        taskIds.length ? safe(sb.from('tasks').select('*').in('id', taskIds)) : null,
        svcIds.length ? safe(sb.from('services').select('*').in('id', svcIds)) : null,
        custIds.length ? safe(sb.from('users').select('id,name,first_name,last_name,location').in('id', custIds)) : null
      ]).then(function (res) {
        var tasks = {}, svcs = {}, custs = {};
        (res[0] || []).forEach(function (t) { tasks[t.id] = t; });
        (res[1] || []).forEach(function (s) { svcs[s.id] = s; });
        (res[2] || []).forEach(function (u) { custs[u.id] = u; });
        bks.forEach(function (b) {
          var t = tasks[b.task_id] || null, s = svcs[b.service_id] || null, u = custs[b.customer_id] || null;
          var title = (t && t.title) || (s && (s.service_name || s.service)) || (b.notes ? String(b.notes).slice(0, 48) : '');
          var client = u ? ((u.first_name && u.last_name) ? u.first_name + ' ' + u.last_name : (u.name || '')) : '';
          jobs[b.id] = { title: title, client: client, location: (t && t.location) || (s && s.location) || (u && u.location) || '' };
        });
        return jobs;
      });
    });
  }

  /* ── Withdrawal popup ────────────────────────────────────── */
  // Pays ONLY to a saved bank account (CR-1). The popup never sees a full account number:
  // it lists the saved accounts (ST.payments.listBankAccounts), sends the chosen account's id
  // (ST.payments.withdrawFromWallet) and shows the fee that the database computes.
  var modal = document.getElementById('withdrawModal');
  if (modal) {
    var form = document.getElementById('wdStep1');
    var amountIn = document.getElementById('wdAmount');
    var field = $('[data-wd-field]', modal), errAmount = document.getElementById('wdError');
    var errForm = document.getElementById('wdFormError'), errConfirm = document.getElementById('wdConfirmError');
    var continueBtn = $('[data-wd-continue]', modal), confirmBtn = $('[data-wd-confirm]', modal);
    var retryBtn = $('[data-wd-retry]', modal);
    var stepLine = $('[data-wd-stepline]', modal), opener = null;
    var listEl = document.getElementById('wdAccountList'), tpl = document.getElementById('wdAccountTemplate');
    var loadingEl = document.getElementById('wdAccountsLoading'), emptyEl = document.getElementById('wdAccountsEmpty');
    var acctErr = document.getElementById('wdAccountsError'), acctRetry = null;
    var STEP_TEXT = { 1: 'Step 1 of 2 \u2022 Choose account and amount', 2: 'Step 2 of 2 \u2022 Review', 3: 'Processing', 4: 'Not completed' };
    var MASK = '\u2022\u2022\u2022\u2022 ';
    var FEE_FAIL = 'We could not work out your transfer fee. Please try again.';
    // Server refusals that send the person back to step 1 (nothing was sent to the bank)
    var BACK_TO_FORM = ['low_balance', 'daily_limit', 'below_min', 'above_max', 'bad_amount', 'not_tasker',
      'account_unavailable', 'account_cooldown', 'bad_account'];
    var RELOAD_ACCOUNTS = ['account_unavailable', 'account_cooldown', 'bad_account'];

    var limits = { min: 500, max: 500000, daily: 1000000 };   // same numbers as the markup; overwritten from the database
    var accounts = {};                                          // saved account id -> account (as listed by the server)
    var req = { amount: 0, accountId: '', fee: 0, net: 0, bankName: '', mask: '' };
    var sending = false;      // a withdrawal request is running: nothing may close the popup or send a second one
    var checking = false;     // the fee is being looked up
    var openId = 0;           // changes on open and close, so a late answer for an old popup is ignored
    var listSeq = 0;

    var digits = function (v) { return parseInt(String(v).replace(/[^0-9]/g, ''), 10) || 0; };
    var available = function () { return state.wallet ? num(state.wallet.balance) : 0; };
    var isOpen = function () { return modal.open === true || modal.hasAttribute('open'); };
    function setAll(name, value) { $$('[data-wd="' + name + '"]', modal).forEach(function (n) { n.textContent = value; }); }
    function showStep(n) {
      $$('[data-wd-step]', modal).forEach(function (p) { p.hidden = p.getAttribute('data-wd-step') !== String(n); });
      stepLine.textContent = STEP_TEXT[n];
    }
    function focusTitle(stepId) {
      var t = $('#' + stepId + ' .wl-wd-done-title', modal);
      if (t) t.focus();
    }
    function syncAvailable() {
      if (!state.wallet) return;
      setAll('available', fmt(available()));
      $$('.wl-wd-avail-amt .wl-amt-dec', modal).forEach(function (n) { n.textContent = '.' + cents(available()); });
    }
    function setLimitsText() {
      setAll('min', fmt(limits.min)); setAll('max', fmt(limits.max)); setAll('daily', fmt(limits.daily));
    }
    function resetConfirm() { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Withdrawal'; }

    /* Saved accounts */
    function selectedAccount() {
      var i = form.querySelector('input[name="wdAccount"]:checked');
      return i && accounts[i.value] ? accounts[i.value] : null;
    }
    function fillCard(card, key, text) {
      var n = card.querySelector('[data-acct="' + key + '"]');
      if (n) n.textContent = text;
    }
    function renderAccounts(list, keepId) {
      listEl.textContent = '';
      accounts = {};
      list = list || [];
      list.forEach(function (a) { accounts[a.id] = a; });
      emptyEl.hidden = list.length > 0;
      var pick = '';
      if (keepId && accounts[keepId]) pick = keepId;
      else {
        list.forEach(function (a) { if (!pick && a.isDefault) pick = a.id; });
        if (!pick && list.length === 1) pick = list[0].id;
      }
      list.forEach(function (a) {
        var card = tpl.content.firstElementChild.cloneNode(true);
        var input = card.querySelector('input[name="wdAccount"]');
        input.value = a.id;
        input.checked = a.id === pick;
        fillCard(card, 'bank', a.bankName);
        fillCard(card, 'name', a.accountName);
        fillCard(card, 'last4', a.last4);
        var def = card.querySelector('[data-acct="default"]');
        if (def) def.hidden = !a.isDefault;
        listEl.appendChild(card);
      });
      refreshContinue();
    }
    function showAccountsError(message) {
      acctErr.textContent = message;
      if (!acctRetry) {
        acctRetry = el('button', 'wl-led-retry', 'Try again');
        acctRetry.type = 'button';
        acctRetry.addEventListener('click', function () { loadAccounts(''); });
        acctErr.parentNode.insertBefore(acctRetry, acctErr.nextSibling);
      }
      acctRetry.hidden = false;
    }
    function loadAccounts(keepId) {
      var mine = ++listSeq, pay = window.ST && window.ST.payments;
      listEl.textContent = '';
      accounts = {};
      emptyEl.hidden = true;
      acctErr.textContent = '';
      if (acctRetry) acctRetry.hidden = true;
      loadingEl.hidden = false;
      refreshContinue();
      if (!pay || typeof pay.listBankAccounts !== 'function') {
        loadingEl.hidden = true;
        showAccountsError('The payment module did not load. Refresh the page.');
        return Promise.resolve();
      }
      return Promise.resolve().then(function () { return pay.listBankAccounts(); }).then(function (list) {
        if (mine !== listSeq) return;
        loadingEl.hidden = true;
        renderAccounts(list, keepId);
      }, function (err) {
        if (mine !== listSeq) return;
        loadingEl.hidden = true;
        showAccountsError((err && err.message) || 'We could not load your bank accounts. Please try again.');
        refreshContinue();
      });
    }

    /* Limits and fee come from the database (one place to change them) */
    function loadLimits() {
      var sb = window.supabase;
      if (!sb || typeof sb.rpc !== 'function') return Promise.resolve();
      return Promise.resolve().then(function () { return sb.rpc('withdrawal_limits'); }).then(function (r) {
        var d = r && !r.error ? r.data : null;
        var mn = d && Number(d.min_amount), mx = d && Number(d.max_amount), dl = d && Number(d.daily_max);
        if (!(mn > 0 && mx >= mn && dl >= mx) || !isFinite(dl)) return;   // keep the defaults; the server still enforces its own
        limits = { min: mn, max: mx, daily: dl };
        setLimitsText();
        if (isOpen()) validateAmount(false);
      }, function () { /* keep the defaults */ });
    }
    function getFee(amount) {
      var sb = window.supabase;
      if (!sb || typeof sb.rpc !== 'function') return Promise.reject(new Error(FEE_FAIL));
      return Promise.resolve().then(function () { return sb.rpc('withdrawal_fee', { p_amount: amount }); }).then(function (r) {
        var fee = r && !r.error && r.data != null ? Number(r.data) : NaN;
        if (!isFinite(fee) || fee < 0 || fee >= amount || Math.floor(fee) !== fee) throw new Error(FEE_FAIL);
        return fee;
      }, function () { throw new Error(FEE_FAIL); });
    }

    /* Amount */
    function amountProblem(v) {
      if (available() <= 0) return 'You have no available balance to withdraw yet.';
      if (v > available()) return 'That is more than your available balance of \u20A6' + fmt(available()) + '.';
      if (v > 0 && v < limits.min) return 'The minimum withdrawal is \u20A6' + fmt(limits.min) + '.';
      if (v > limits.max) return 'The most you can withdraw at once is \u20A6' + fmt(limits.max) + '.';
      return '';
    }
    function refreshContinue() {
      var v = digits(amountIn.value);
      continueBtn.disabled = checking || sending || v === 0 || amountProblem(v) !== '' || !selectedAccount();
    }
    function validateAmount(showEmpty) {
      var v = digits(amountIn.value);
      var msg = (v === 0 && !showEmpty) ? '' : amountProblem(v);
      errAmount.textContent = msg;
      field.classList.toggle('has-error', msg !== '');
      amountIn.setAttribute('aria-invalid', msg !== '' ? 'true' : 'false');
      refreshContinue();
    }

    /* Refresh the balance and the ledger after a withdrawal attempt. If a load is already
       running it may predate the withdrawal, so wait for it and then load again. */
    function refreshWallet() {
      var tries = 0;
      return new Promise(function (resolve) {
        (function go() {
          if (!loading) { loadTasker().then(resolve, resolve); return; }
          if (++tries > 20) { resolve(); return; }
          setTimeout(go, 300);
        })();
      }).then(function () { syncAvailable(); if (isOpen()) validateAmount(false); });
    }

    function open(trigger) {
      opener = trigger || null;
      openId++;
      checking = false;
      amountIn.value = '';
      errForm.textContent = ''; errConfirm.textContent = '';
      resetConfirm();
      syncAvailable();
      setLimitsText();
      showStep(1);
      validateAmount(false);
      if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
      document.documentElement.classList.add('wl-lock');
      if (available() <= 0) validateAmount(true);
      amountIn.focus();
      loadAccounts('');
      loadLimits();
    }
    function close() {
      if (sending) return;   // never walk away from a request that is still running
      if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
      cleanup();
    }
    function cleanup() {
      openId++;
      document.documentElement.classList.remove('wl-lock');
      if (opener && typeof opener.focus === 'function') opener.focus();
      opener = null;
    }

    function showFailed(message, canRetry) {
      setAll('failMessage', message);
      if (retryBtn) retryBtn.hidden = !canRetry;
      showStep(4);
      focusTitle('wdStep4');
    }
    function whole(v, fallback) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : fallback; }

    page.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action="withdraw"]');
      if (t && state.role === 'tasker' && state.wallet) open(t);
    });
    amountIn.addEventListener('input', function () {
      var v = digits(amountIn.value);
      amountIn.value = v ? v.toLocaleString('en-NG') : '';
      validateAmount(false);
    });
    listEl.addEventListener('change', function () { errForm.textContent = ''; refreshContinue(); });
    $$('[data-wd-preset]', modal).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = Math.min(Math.floor(available() * parseFloat(btn.getAttribute('data-wd-preset'))), limits.max);
        amountIn.value = v ? v.toLocaleString('en-NG') : '';
        validateAmount(true);
        amountIn.focus();
      });
    });
    // The bank details sheet (W6e) announces changes so the list here never goes stale
    document.addEventListener('wallet:bank-accounts-changed', function () {
      if (!isOpen() || sending) return;
      var cur = selectedAccount();
      loadAccounts(cur ? cur.id : '');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (checking || sending) return;
      validateAmount(true);
      if (continueBtn.disabled) {
        if (!selectedAccount() && digits(amountIn.value) > 0 && amountProblem(digits(amountIn.value)) === '') {
          errForm.textContent = Object.keys(accounts).length ? 'Choose the bank account to pay to.' : 'Add a bank account first.';
        } else {
          amountIn.focus();
        }
        return;
      }
      var amount = digits(amountIn.value), acct = selectedAccount(), mine = openId;
      errForm.textContent = '';
      checking = true;
      refreshContinue();
      getFee(amount).then(function (fee) {
        if (mine !== openId) return;
        checking = false;
        req = { amount: amount, accountId: acct.id, fee: fee, net: amount - fee, bankName: acct.bankName, mask: MASK + acct.last4 };
        setAll('amount', fmt(req.amount)); setAll('fee', fmt(req.fee)); setAll('receive', fmt(req.net));
        setAll('bank', acct.bankName); setAll('name', acct.accountName); setAll('acct', req.mask);
        errConfirm.textContent = '';
        resetConfirm();
        showStep(2);
        confirmBtn.focus();
        refreshContinue();
      }, function (err) {
        if (mine !== openId) return;
        checking = false;
        errForm.textContent = (err && err.message) || FEE_FAIL;
        refreshContinue();
      });
    });
    $('[data-wd-back]', modal).addEventListener('click', function () { if (sending) return; showStep(1); amountIn.focus(); });
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        if (sending) return;
        var cur = selectedAccount();
        errForm.textContent = ''; errConfirm.textContent = '';
        resetConfirm();
        showStep(1);
        validateAmount(false);
        loadAccounts(cur ? cur.id : '');
        amountIn.focus();
      });
    }

    confirmBtn.addEventListener('click', function () {
      if (sending) return;
      var pay = window.ST && window.ST.payments;
      if (!pay || typeof pay.withdrawFromWallet !== 'function') { errConfirm.textContent = 'The payment module did not load. Refresh the page.'; return; }
      if (!req.accountId || !req.amount) return;
      sending = true;   // stops a double tap sending the request twice
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing\u2026';
      errConfirm.textContent = '';
      Promise.resolve().then(function () { return pay.withdrawFromWallet(req.amount, req.accountId); }).then(function (res) {
        sending = false;
        resetConfirm();
        res = res || {};
        setAll('receive', fmt(whole(res.netAmount, req.net)));
        setAll('bank', typeof res.bankName === 'string' && res.bankName ? res.bankName : req.bankName);
        setAll('acct', typeof res.accountLast4 === 'string' && /^[0-9]{4}$/.test(res.accountLast4) ? MASK + res.accountLast4 : req.mask);
        showStep(3);
        focusTitle('wdStep3');
        refreshWallet();   // real balance and ledger from the database
      }, function (err) {
        sending = false;
        resetConfirm();
        var code = err && err.code, msg = (err && err.message) || 'Withdrawal failed. Please try again.';
        if (err && err.refresh) {
          // The result is not certain (or money was returned): show the message, then read the real numbers.
          // An unknown result never offers a blind "Try again", and neither does a refund that is still pending.
          showFailed(msg, !(err.unknown || code === 'refund_pending'));
          refreshWallet();
          return;
        }
        if (BACK_TO_FORM.indexOf(code) !== -1) {
          errForm.textContent = msg;
          showStep(1);
          if (RELOAD_ACCOUNTS.indexOf(code) !== -1) loadAccounts('');
          if (code === 'low_balance') refreshWallet();
          validateAmount(false);
          amountIn.focus();
          return;
        }
        errConfirm.textContent = msg;   // for example in_progress: stay on the review step
      });
    });

    $$('[data-wd-close]', modal).forEach(function (b) { b.addEventListener('click', close); });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.addEventListener('cancel', function (e) { if (sending) e.preventDefault(); });   // Escape while a request runs
    modal.addEventListener('close', cleanup);
  }

  /* ── Start ───────────────────────────────────────────────── */
  function start() {
    var sb = window.supabase;
    if (!sb) { page.classList.remove('wl-loading'); return; }
    sb.auth.getSession().then(function (r) {
      var user = r && r.data && r.data.session && r.data.session.user;
      if (!user) { window.location.replace('login.html?redirect=' + encodeURIComponent('wallet.html')); return; }
      state.uid = user.id;
      var roleP = (window.ST && window.ST.auth && window.ST.auth.getUserRole)
        ? window.ST.auth.getUserRole(user).catch(function () { return null; }) : Promise.resolve(null);
      return roleP.then(function (role) {
        state.role = role === 'tasker' ? 'tasker' : 'customer';   // the session decides, never the URL
        page.setAttribute('data-role', state.role);
        if (state.role === 'tasker') return loadTasker();
        page.classList.remove('wl-loading');
      });
    }).catch(function (e) {
      console.warn('[Wallet] start failed:', e && e.message);
      page.classList.remove('wl-loading');
    });
  }
  start();
})();

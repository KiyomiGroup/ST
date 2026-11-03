// W6c page test: the REAL wallet.html, wallet-ui.js, payments.js and wallet-data.js in headless Chromium.
// Fake: the Supabase client (database + rpc) and the process-withdrawal answers. Nothing leaves the machine.
// Run:  NODE_PATH=$(npm root -g) node docs/withdrawals/tests/w6c/wallet-w6c.test.js <repo-dir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const repo = path.resolve(process.argv[2] || '.');
const URL_FN = 'https://ftoiqbacutnbjnztguts.supabase.co/functions/v1/process-withdrawal';

const ACCTS = [
  { id: '11111111-1111-4111-8111-111111111111', bank_code: '058', bank_name: 'Guaranty Trust Bank', account_name: 'ADEBAYO JOHNSON', account_last4: '1234', is_default: true, created_at: '2026-10-01' },
  { id: '22222222-2222-4222-8222-222222222222', bank_code: '011', bank_name: 'First Bank', account_name: 'ADEBAYO J', account_last4: '9876', is_default: false, created_at: '2026-10-02' },
];
const A1 = ACCTS[0].id, A2 = ACCTS[1].id;

const initScript = (init) => {
  window.SUPABASE_URL = 'https://fake.supabase.test'; window.SUPABASE_ANON_KEY = 'anon-test';
  const db = window.__db = Object.assign({
    wallet: { user_id: 'u1', balance: 80000, pending_balance: 0 }, txns: [], accounts: [], listFail: false,
    listDelays: [], feeMode: 'tier', limits: { min_amount: 500, max_amount: 500000, daily_max: 1000000 }, limitsFail: false,
    calls: [], walletReads: 0,
  }, init || {});
  const tier = (a) => (a <= 5000 ? 10 : a <= 9999 ? 25 : a <= 50000 ? 75 : 100);
  class Chain {
    constructor(t) { this.t = t; }
    select() { return this; } eq() { return this; } is() { return this; } order() { return this; } limit() { return this; } in() { return this; }
    maybeSingle() { if (this.t === 'users') return Promise.resolve({ data: { id: 'u1', role: db.role || 'tasker' }, error: null }); if (this.t === 'wallets') db.walletReads++; return Promise.resolve({ data: this.t === 'wallets' ? JSON.parse(JSON.stringify(db.wallet)) : null, error: null }); }
    then(res, rej) { return this._run().then(res, rej); }
    _run() {
      db.calls.push('from:' + this.t);
      if (this.t === 'wallet_transactions') return Promise.resolve({ data: JSON.parse(JSON.stringify(db.txns)), error: null });
      if (this.t === 'withdrawal_bank_accounts') {
        const d = db.listDelays.length ? db.listDelays.shift() : 0;
        const out = db.listFail ? { data: null, error: { code: 'X1', message: 'raw db text' } } : { data: JSON.parse(JSON.stringify(db.accounts)), error: null };
        return new Promise((r) => setTimeout(() => r(out), d));
      }
      return Promise.resolve({ data: [], error: null });
    }
  }
  window.supabase = {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'tok-test' } } }), getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t) => new Chain(t),
    rpc: async (name, args) => {
      db.calls.push('rpc:' + name + ':' + JSON.stringify(args || {}));
      if (name === 'withdrawal_limits') return db.limitsFail ? { data: null, error: { message: 'x' } } : { data: db.limits, error: null };
      if (name === 'withdrawal_fee') {
        if (db.feeMode === 'error') return { data: null, error: { message: 'raw fee error' } };
        if (db.feeMode === 'huge') return { data: args.p_amount, error: null };
        if (db.feeMode === 'decimal') return { data: 10.5, error: null };
        if (db.feeMode === 'string') return { data: String(tier(args.p_amount)) + '.00', error: null };
        if (db.feeMode === 'throw') throw new Error('network down');
        return { data: tier(args.p_amount), error: null };
      }
      return { data: null, error: null };
    },
  };
  window.ST = { auth: { getUserRole: async () => db.role || 'tasker' } };
};

let passed = 0, failed = 0; const failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.log('  FAIL: ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

async function newPage(browser, init, scenario, width) {
  const ctx = await browser.newContext({ viewport: { width: width || 390, height: width ? 900 : 844 } });
  const page = await ctx.newPage();
  page.errs = []; page.sent = []; page.blocked = [];
  page.on('pageerror', (e) => page.errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|components\/(navbar|bottom-nav)\.html/.test(m.text())) page.errs.push('console: ' + m.text()); });
  page.scenario = scenario || {};
  await page.route('**/*', async (route) => {
    const u = route.request().url();
    if (u === URL_FN) {
      const body = JSON.parse(route.request().postData() || '{}');
      page.sent.push(body);
      const s = page.scenario;
      if (s.delay) await new Promise((r) => setTimeout(r, s.delay));
      if (s.abort) return route.abort();
      if (s.effect) await page.evaluate(s.effect, body);
      return route.fulfill({ status: s.status || 200, contentType: 'application/json', body: typeof s.raw === 'string' ? s.raw : JSON.stringify(s.body || {}) });
    }
    if (u.startsWith('file://')) { const f = decodeURIComponent(u.slice(7).split('?')[0]); return fs.existsSync(f) ? route.continue() : route.abort(); }
    if (!/supabase\.min\.js$/.test(u) && !/fonts\.googleapis\.com/.test(u)) page.blocked.push(u); return route.abort();   // the CDN supabase library is replaced by the fake
  });
  await page.addInitScript(initScript, init);
  await page.goto('file://' + path.join(repo, 'wallet.html'));
  await page.waitForFunction(() => !document.getElementById('walletPage').classList.contains('wl-loading'));
  return page;
}
const txt = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); return n ? n.textContent.trim() : null; }, sel);
const hiddenOf = (page, sel) => page.evaluate((s) => document.querySelector(s).hidden, sel);
const stepShown = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#withdrawModal [data-wd-step]')).filter((p) => !p.hidden).map((p) => p.getAttribute('data-wd-step')));
const isOpen = (page) => page.evaluate(() => document.getElementById('withdrawModal').open);
const wdCalls = (page) => page.evaluate(() => window.__db.calls.slice());
async function openPopup(page) {
  await page.evaluate(() => document.querySelector('#walletPage [data-action="withdraw"]').click());
  await page.waitForFunction(() => document.getElementById('wdAccountsLoading').hidden);
}
async function typeAmount(page, v) { await page.fill('#wdAmount', String(v)); }
const cont = (page) => page.click('[data-wd-continue]');
async function toReview(page, amount) { await typeAmount(page, amount); await cont(page); await page.waitForFunction(() => !document.getElementById('wdStep2').hidden); }
const pick = (page, id) => page.click('label.wl-acct:has(input[value="' + id + '"])');
const bodyText = (page) => page.evaluate(() => document.body.innerText);

(async () => {
  const browser = await chromium.launch();

  /* 1 ─ ledger rows and badges */
  {
    const txns = [
      { id: 't1', type: 'withdrawal', amount: 10000, status: 'completed', reference: 'wd-aaa', created_at: '2026-10-30T10:00:00Z', note: null },
      { id: 't2', type: 'withdrawal', amount: 20000, status: 'processing', reference: 'wd-bbb', created_at: '2026-10-30T11:00:00Z' },
      { id: 't3', type: 'withdrawal', amount: 3000, status: 'pending', reference: 'wd-ccc', created_at: '2026-10-30T12:00:00Z' },
      { id: 't4', type: 'withdrawal', amount: 4000, status: 'failed', reference: 'wd-ddd', created_at: '2026-10-30T13:00:00Z', note: 'Withdrawal failed, money returned' },
      { id: 't5', type: 'withdrawal_refund', amount: 4000, status: 'completed', reference: 'wd-ddd-refund', created_at: '2026-10-30T13:01:00Z', note: 'Withdrawal refunded: \u20A64,000 returned to your wallet' },
      { id: 't6', type: 'earning', amount: 50000, status: 'completed', reference: 'e1', created_at: '2026-10-29T10:00:00Z' },
    ];
    const page = await newPage(browser, { txns }, {}, 1280);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#ledgerTasker .wl-tx')).map((li) => ({
      title: li.querySelector('.wl-tx-title span').textContent, badge: li.querySelector('.wl-badge').textContent,
      amt: li.querySelector('.wl-tx-amt').textContent, credit: li.querySelector('.wl-tx-amt').classList.contains('is-credit'),
      meta: (li.querySelector('.wl-tx-meta') || {}).textContent || '' })));
    // page size is 5: newest five rows (t5, t4, t3, t2, t1)
    eq(rows.map((r) => r.title), ['Withdrawal refunded', 'Withdrawal to bank', 'Withdrawal to bank', 'Withdrawal to bank', 'Withdrawal to bank'], 'ledger titles, newest first');
    eq(rows.map((r) => r.badge), ['Completed', 'Failed', 'Pending', 'Pending', 'Processed'], 'badges: refund Completed, failed Failed, pending and processing Pending, completed Processed');
    ok(rows[0].amt.startsWith('+') && rows[0].credit, 'refund row is a credit with a plus sign');
    ok(rows[1].amt.startsWith('-') && !rows[1].credit, 'withdrawal row is a debit');
    ok(rows[0].meta.includes('Ref: wd-ddd') && !rows[0].meta.includes('-refund'), 'refund row shows the withdrawal reference, not the -refund one');
    ok(rows[0].meta.includes('Returned to your wallet'), 'refund row says the money came back');
    const life = await page.evaluate(() => document.querySelector('[data-wl-value="lifetime"]').textContent);
    eq(life, '50,000', 'lifetime earnings count the earning only, not the refund');
    // withdrawals filter: five withdrawal-related rows (4 withdrawals + refund), no earning
    await page.click('.wl-tasker-only .wl-filter[data-filter="withdrawal"]');
    const tot = await txt(page, '#ledgerTasker [data-wl-total]');
    eq(tot, '5', 'Withdrawals filter holds 4 withdrawals and the refund (not the earning)');
    // mobile activity list
    const act = await page.evaluate(() => Array.from(document.querySelectorAll('#actTasker .wl-act-title')).map((n) => n.textContent));
    ok(act.includes('Withdrawal Refunded'), 'recent activity shows the refund');
    ok(page.errs.length === 0, 'ledger page: no console or page errors ' + page.errs.join('|'));
    await page.context().close();
  }

  /* 2 ─ opening: saved account cards, default selected, text only, limits from the database */
  {
    const evil = '<img src=x onerror=window.__pwn=1>';
    const accts = [Object.assign({}, ACCTS[0], { account_name: evil }), ACCTS[1]];
    const page = await newPage(browser, { accounts: accts, wallet: { user_id: 'u1', balance: 300000, pending_balance: 0 }, limits: { min_amount: 1000, max_amount: 200000, daily_max: 400000 } });
    await openPopup(page);
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('#wdAccountList .wl-acct')).map((c) => ({
      id: c.querySelector('input').value, checked: c.querySelector('input').checked, bank: c.querySelector('[data-acct="bank"]').textContent,
      name: c.querySelector('[data-acct="name"]').textContent, last4: c.querySelector('[data-acct="last4"]').textContent,
      def: !c.querySelector('[data-acct="default"]').hidden })));
    eq(cards.length, 2, 'two saved accounts rendered');
    eq(cards.map((c) => c.checked), [true, false], 'default account is pre-selected');
    eq(cards.map((c) => c.def), [true, false], 'default label only on the default');
    eq(cards.map((c) => c.last4), ['1234', '9876'], 'last four digits only');
    eq(cards[0].id, A1, 'radio value is the saved account id');
    eq(cards[0].name, evil, 'account name shown as plain text');
    eq(await page.evaluate(() => !!window.__pwn || !!document.querySelector('#wdAccountList img')), false, 'no HTML injected from an account name');
    eq(await hiddenOf(page, '#wdAccountsEmpty'), true, 'empty state hidden');
    eq(await hiddenOf(page, '#wdAccountsLoading'), true, 'loading note hidden after load');
    eq(await txt(page, '#wdLimits [data-wd="min"]') + '/' + await txt(page, '#wdLimits [data-wd="max"]') + '/' + await txt(page, '#wdLimits [data-wd="daily"]'), '1,000/200,000/400,000', 'limits line comes from the database');
    eq(await stepShown(page), ['1'], 'step 1 shown');
    eq(await txt(page, '[data-wd-stepline]'), 'Step 1 of 2 \u2022 Choose account and amount', 'step line text');
    eq(await page.evaluate(() => ['wdBank', 'wdAcct', 'wdName'].map((i) => !!document.getElementById(i))), [false, false, false], 'old bank / account / name inputs are not on the page');
    // limits: below the DATABASE minimum
    await typeAmount(page, 900);
    ok((await txt(page, '#wdError')).includes('minimum') && (await txt(page, '#wdError')).includes('1,000'), 'below-minimum message uses the database minimum');
    eq(await page.evaluate(() => document.querySelector('[data-wd-continue]').disabled), true, 'Continue disabled below minimum');
    await typeAmount(page, 250000);
    ok((await txt(page, '#wdError')).includes('200,000'), 'above-maximum message uses the database maximum');
    await typeAmount(page, 350000);
    ok((await txt(page, '#wdError')).includes('available balance'), 'above-balance message');
    await typeAmount(page, 5000);
    eq(await txt(page, '#wdError'), '', 'valid amount clears the message');
    eq(await page.evaluate(() => document.querySelector('[data-wd-continue]').disabled), false, 'Continue enabled with account and valid amount');
    ok(page.errs.length === 0, 'open: no console or page errors ' + page.errs.join('|'));
    await page.context().close();
  }

  /* 3 ─ presets clamp to the maximum; limits fall back when the database call fails */
  {
    const page = await newPage(browser, { accounts: ACCTS, wallet: { user_id: 'u1', balance: 800000, pending_balance: 0 }, limitsFail: true });
    await openPopup(page);
    await page.click('[data-wd-preset="1"]');
    eq(await page.inputValue('#wdAmount'), '500,000', 'Max quick pick is capped at the maximum');
    await page.click('[data-wd-preset="0.25"]');
    eq(await page.inputValue('#wdAmount'), '200,000', '25% quick pick');
    eq(await txt(page, '#wdLimits [data-wd="max"]'), '500,000', 'defaults stay when the limits call fails');
    await page.context().close();
  }

  /* 4 ─ no saved account, and list failure with retry */
  {
    const page = await newPage(browser, { accounts: [] });
    await openPopup(page);
    eq(await hiddenOf(page, '#wdAccountsEmpty'), false, 'empty state shown with no saved account');
    await typeAmount(page, 5000);
    eq(await page.evaluate(() => document.querySelector('[data-wd-continue]').disabled), true, 'Continue stays disabled with no saved account');
    await page.evaluate(() => document.getElementById('wdStep1').requestSubmit());
    eq(await txt(page, '#wdFormError'), 'Add a bank account first.', 'submit with no account says so');
    eq(await stepShown(page), ['1'], 'still on step 1');
    await page.context().close();

    const p2 = await newPage(browser, { accounts: ACCTS, listFail: true });
    await openPopup(p2);
    eq(await txt(p2, '#wdAccountsError'), 'We could not load your bank accounts. Please try again.', 'list failure shows the plain message, not raw text');
    ok(!(await bodyText(p2)).includes('raw db text'), 'raw database text is never shown');
    eq(await p2.evaluate(() => { const b = document.querySelector('#wdAccountsError').nextElementSibling; return !!b && !b.hidden && b.tagName === 'BUTTON'; }), true, 'a Try again button appears');
    await typeAmount(p2, 5000);
    eq(await p2.evaluate(() => document.querySelector('[data-wd-continue]').disabled), true, 'Continue disabled while the list is unavailable');
    await p2.evaluate(() => { window.__db.listFail = false; window.__db.accounts = JSON.parse(JSON.stringify(window.__db.__a || [])); });
    await p2.evaluate((a) => { window.__db.accounts = a; }, ACCTS);
    await p2.click('#wdAccountsError + button');
    await p2.waitForFunction(() => document.querySelectorAll('#wdAccountList .wl-acct').length === 2);
    eq(await txt(p2, '#wdAccountsError'), '', 'error cleared after retry');
    eq(await p2.evaluate(() => document.querySelector('#wdAccountsError').nextElementSibling.hidden), true, 'retry button hidden again');
    eq(await p2.evaluate(() => document.querySelector('[data-wd-continue]').disabled), false, 'Continue enabled after the list loads');
    await p2.context().close();
  }

  /* 4b ─ one saved account that is not marked default is still pre-selected; two with no default are not */
  {
    const page = await newPage(browser, { accounts: [Object.assign({}, ACCTS[1])] });
    await openPopup(page);
    eq(await page.evaluate(() => document.querySelector('input[name="wdAccount"]').checked), true, 'a single non-default account is pre-selected');
    await page.context().close();
    const p2 = await newPage(browser, { accounts: ACCTS.map((a) => Object.assign({}, a, { is_default: false })) });
    await openPopup(p2);
    eq(await p2.evaluate(() => document.querySelectorAll('input[name="wdAccount"]:checked').length), 0, 'two accounts and no default: nothing pre-selected');
    await typeAmount(p2, 5000);
    eq(await p2.evaluate(() => document.querySelector('[data-wd-continue]').disabled), true, 'Continue locked until one is chosen');
    await p2.evaluate(() => document.getElementById('wdStep1').requestSubmit());
    eq(await txt(p2, '#wdFormError'), 'Choose the bank account to pay to.', 'asks the person to choose an account');
    await pick(p2, A2);
    eq(await p2.evaluate(() => document.querySelector('[data-wd-continue]').disabled), false, 'Continue opens after choosing');
    await p2.context().close();
  }

  /* 5 ─ fee lookup and the review step */
  {
    const page = await newPage(browser, { accounts: ACCTS });
    await openPopup(page);
    await pick(page, A2);
    await toReview(page, 20000);
    const calls = await wdCalls(page);
    ok(calls.includes('rpc:withdrawal_fee:{"p_amount":20000}'), 'fee asked from the database with a whole-number amount');
    eq(await stepShown(page), ['2'], 'step 2 shown');
    eq(await txt(page, '#wdStep2 [data-wd="amount"]'), '20,000', 'review: amount');
    eq(await txt(page, '#wdStep2 [data-wd="fee"]'), '75', 'review: fee from the database');
    eq(await txt(page, '#wdStep2 [data-wd="receive"]'), '19,925', 'review: you receive = amount minus fee');
    eq(await txt(page, '#wdStep2 [data-wd="bank"]'), 'First Bank', 'review: bank of the chosen account');
    eq(await txt(page, '#wdStep2 [data-wd="name"]'), 'ADEBAYO J', 'review: account name');
    eq(await txt(page, '#wdStep2 [data-wd="acct"]'), '\u2022\u2022\u2022\u2022 9876', 'review: masked number');
    eq(await txt(page, '[data-wd-stepline]'), 'Step 2 of 2 \u2022 Review', 'step line on review');
    // back keeps the amount and the choice
    await page.click('[data-wd-back]');
    eq(await page.inputValue('#wdAmount'), '20,000', 'Back keeps the typed amount');
    eq(await page.evaluate(() => document.querySelector('input[name="wdAccount"]:checked').value), A2, 'Back keeps the chosen account');
    await page.context().close();

    for (const mode of ['error', 'huge', 'decimal', 'throw']) {
      const p = await newPage(browser, { accounts: ACCTS, feeMode: mode });
      await openPopup(p);
      await typeAmount(p, 20000); await cont(p);
      await p.waitForFunction(() => document.getElementById('wdFormError').textContent !== '');
      eq(await txt(p, '#wdFormError'), 'We could not work out your transfer fee. Please try again.', 'fee mode ' + mode + ': plain message');
      eq(await stepShown(p), ['1'], 'fee mode ' + mode + ': stays on step 1');
      eq(p.sent.length, 0, 'fee mode ' + mode + ': nothing sent to the withdrawal function');
      ok(!(await bodyText(p)).includes('raw fee error') && !(await bodyText(p)).includes('network down'), 'fee mode ' + mode + ': raw text not shown');
      eq(await p.evaluate(() => document.querySelector('[data-wd-continue]').disabled), false, 'fee mode ' + mode + ': Continue usable again');
      await p.context().close();
    }
    const ps = await newPage(browser, { accounts: ACCTS, feeMode: 'string' });
    await openPopup(ps); await toReview(ps, 20000);
    eq(await txt(ps, '#wdStep2 [data-wd="fee"]'), '75', 'a fee returned as the text "75.00" is read as 75');
    await ps.context().close();
  }

  /* 6 ─ success: processing screen, exact request, balance and ledger refreshed */
  {
    const effect = (body) => {
      const d = window.__db; d.wallet.balance -= body.amount;
      d.txns.unshift({ id: 'tn', type: 'withdrawal', amount: body.amount, status: 'processing', reference: 'wd-new', created_at: new Date().toISOString() });
    };
    const page = await newPage(browser, { accounts: ACCTS }, { effect, body: { status: 'processing', reference: 'wd-new', amount: 20000, fee: 75, net_amount: 19925, bank_name: 'Guaranty Trust Bank', account_last4: '1234', balance_after: 60000, message: 'Your withdrawal is being processed.' } });
    await openPopup(page);
    await toReview(page, 20000);
    await page.click('[data-wd-confirm]');
    await page.waitForFunction(() => !document.getElementById('wdStep3').hidden);
    eq(page.sent, [{ action: 'withdraw', amount: 20000, bank_account_id: A1 }], 'the request holds ONLY action, amount and the saved account id');
    eq(await txt(page, '#wdStep3 [data-wd="receive"]'), '19,925', 'processing screen: net amount from the server');
    eq(await txt(page, '#wdStep3 [data-wd="bank"]'), 'Guaranty Trust Bank', 'processing screen: bank');
    eq(await txt(page, '#wdStep3 [data-wd="acct"]'), '\u2022\u2022\u2022\u2022 1234', 'processing screen: masked number');
    eq(await txt(page, '[data-wd-stepline]'), 'Processing', 'step line says Processing');
    ok(!/all done/i.test(await bodyText(page)), 'the words "All done" appear nowhere');
    eq(await page.evaluate(() => document.activeElement && document.activeElement.className), 'wl-wd-done-title', 'focus moves to the processing heading');
    await page.waitForFunction(() => document.querySelector('[data-wl-value="available"]').textContent === '60,000');
    ok(true, 'balance card refreshed to 60,000 from the database');
    await page.waitForFunction(() => document.querySelector('#ledgerTasker .wl-tx-title span').textContent === 'Withdrawal to bank');
    eq(await page.evaluate(() => document.querySelector('#ledgerTasker .wl-badge').textContent), 'Pending', 'new withdrawal shows in the ledger as Pending');
    eq(await txt(page, '#withdrawModal [data-wd="available"]'), '60,000', 'popup balance also updated');
    await page.click('#wdStep3 [data-wd-close]');
    eq(await isOpen(page), false, 'Done closes the popup');
    ok(page.errs.length === 0, 'success path: no console or page errors ' + page.errs.join('|'));
    ok(page.blocked.length === 0, 'success path: no request left the test machine ' + page.blocked.join('|'));
    await page.context().close();
  }

  /* 6b ─ the account the person picked is the one that is sent */
  {
    const page = await newPage(browser, { accounts: ACCTS }, { body: { status: 'processing', reference: 'wd-y', amount: 7000, fee: 25, net_amount: 6975, bank_name: 'First Bank', account_last4: '9876' } });
    await openPopup(page);
    await pick(page, A2);
    await toReview(page, 7000);
    eq(await txt(page, '#wdStep2 [data-wd="bank"]'), 'First Bank', 'picked account shown on the review step');
    await page.click('[data-wd-confirm]');
    await page.waitForFunction(() => !document.getElementById('wdStep3').hidden);
    eq(page.sent, [{ action: 'withdraw', amount: 7000, bank_account_id: A2 }], 'the picked (non-default) account id is sent');
    eq(await txt(page, '#wdStep3 [data-wd="bank"]'), 'First Bank', 'processing screen names the picked bank');
    await page.context().close();
  }

  /* 7 ─ double tap, and the popup cannot be closed while the request runs */
  {
    const page = await newPage(browser, { accounts: ACCTS }, { delay: 700, body: { status: 'processing', reference: 'wd-x', amount: 5000, fee: 10, net_amount: 4990, bank_name: 'Guaranty Trust Bank', account_last4: '1234' } });
    await openPopup(page); await toReview(page, 5000);
    await page.evaluate(() => { const b = document.querySelector('[data-wd-confirm]'); b.click(); b.click(); b.click(); });
    await page.waitForTimeout(150);
    eq(page.sent.length, 1, 'three quick taps send ONE request');
    eq(await txt(page, '[data-wd-confirm]'), 'Processing\u2026', 'button says Processing while the request runs');
    eq(await page.evaluate(() => document.querySelector('[data-wd-confirm]').disabled), true, 'Confirm disabled while the request runs');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('#wdStep2 [data-wd-back]').click());
    await page.evaluate(() => document.getElementById('withdrawModal').click());
    await page.evaluate(() => document.querySelector('[data-wd-close]').click());
    eq(await isOpen(page), true, 'Escape, Back, backdrop and close button do nothing while the request runs');
    eq(await stepShown(page), ['2'], 'still on the review step while waiting');
    await page.waitForFunction(() => !document.getElementById('wdStep3').hidden);
    eq(page.sent.length, 1, 'still exactly one request after the answer');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('withdrawModal').open);
    ok(true, 'Escape closes the popup once the answer is in');
    await page.waitForFunction(() => !document.documentElement.classList.contains('wl-lock'), null, { timeout: 3000 });
    ok(true, 'page scroll lock released after Escape');
    await page.context().close();
  }

  /* 8 ─ server refusals that send the person back to step 1 */
  {
    const cases = [
      ['low_balance', 422, 'You do not have enough money in your wallet.', false],
      ['daily_limit', 422, 'This would pass your daily limit of \u20A61,000,000.', false],
      ['below_min', 422, 'The minimum withdrawal is \u20A6500.', false],
      ['above_max', 422, 'The most you can withdraw at once is \u20A6500,000.', false],
      ['not_tasker', 403, 'Only taskers can withdraw.', false],
      ['bad_amount', 400, 'Enter a whole number of naira.', false],
      ['account_unavailable', 422, 'That bank account is no longer available.', true],
      ['account_cooldown', 422, 'This account was added recently. Please try again later.', true],
      ['bad_account', 400, 'Choose a saved bank account.', true],
    ];
    for (const [code, status, message, reloads] of cases) {
      const page = await newPage(browser, { accounts: ACCTS }, { status, body: { error: message, code } });
      await openPopup(page); await toReview(page, 20000);
      await page.click('[data-wd-confirm]');
      await page.waitForFunction(() => !document.getElementById('wdStep1').hidden);
      eq(await txt(page, '#wdFormError'), message, code + ': server message shown on step 1');
      eq(await page.inputValue('#wdAmount'), '20,000', code + ': typed amount kept');
      eq(await page.evaluate(() => document.querySelector('[data-wd-confirm]').disabled), false, code + ': confirm button reset');
      await page.waitForTimeout(150);
      const lists = (await wdCalls(page)).filter((c) => c === 'from:withdrawal_bank_accounts').length;
      eq(lists, reloads ? 2 : 1, code + ': saved accounts ' + (reloads ? 're-read' : 'not re-read'));
      if (code === 'low_balance') {
        const reads = await page.evaluate(() => window.__db.walletReads);
        ok(reads >= 2, 'low_balance: the wallet balance was read again');
      }
      await page.context().close();
    }
    // in_progress stays on the review step
    const page = await newPage(browser, { accounts: ACCTS }, { status: 409, body: { error: 'You already have a withdrawal in progress. Please wait until it finishes.', code: 'in_progress' } });
    await openPopup(page); await toReview(page, 20000);
    await page.click('[data-wd-confirm]');
    await page.waitForFunction(() => document.getElementById('wdConfirmError').textContent !== '');
    eq(await stepShown(page), ['2'], 'in_progress: stays on the review step');
    ok((await txt(page, '#wdConfirmError')).includes('in progress'), 'in_progress: message shown there');
    await page.context().close();
  }

  /* 9 ─ failed screen: money returned, refund pending, unknown outcome */
  {
    const fails = [
      ['not_sent', 422, { error: 'We could not send your withdrawal. Your money is back in your wallet.', code: 'not_sent' }, null, true],
      ['start_failed', 500, { error: 'We could not start your withdrawal. Please try again.', code: 'start_failed' }, null, true],
      ['refund_pending', 500, { error: 'Your money is safe and is being checked. Please do not try again for a few minutes.', code: 'refund_pending' }, null, false],
      ['unknown (lost answer)', 0, null, 'abort', false],
      ['unknown (unreadable 200)', 200, null, 'not json at all', false],
    ];
    for (const [name, status, body, special, retry] of fails) {
      const sc = special === 'abort' ? { abort: true } : special ? { status, raw: special } : { status, body };
      const page = await newPage(browser, { accounts: ACCTS }, sc);
      await openPopup(page); await toReview(page, 20000);
      const readsBefore = await page.evaluate(() => window.__db.walletReads);
      await page.click('[data-wd-confirm]');
      await page.waitForFunction(() => !document.getElementById('wdStep4').hidden);
      const shown = await txt(page, '#wdStep4 [data-wd="failMessage"]');
      ok(shown.length > 10, name + ': a plain message is shown (' + shown + ')');
      if (body) eq(shown, body.error, name + ': the server text is shown as it is');
      else ok(/check|unknown|not sure|transactions/i.test(shown), name + ': unknown outcome tells the person to check their transactions');
      eq(await txt(page, '[data-wd-stepline]'), 'Not completed', name + ': step line');
      eq(await page.evaluate(() => document.querySelector('[data-wd-retry]').hidden), !retry, name + ': Try again ' + (retry ? 'offered' : 'NOT offered'));
      await page.waitForFunction((n) => window.__db.walletReads > n, readsBefore);
      ok(true, name + ': wallet and ledger read again from the database');
      eq(await page.evaluate(() => document.activeElement && document.activeElement.className), 'wl-wd-done-title', name + ': focus on the heading');
      ok(!/ok:|false|undefined|\[object/i.test(shown), name + ': no raw text');
      await page.context().close();
    }
    // Try again: back to step 1, amount kept, accounts re-read, same account chosen
    const page = await newPage(browser, { accounts: ACCTS }, { status: 422, body: { error: 'We could not send your withdrawal. Your money is back in your wallet.', code: 'not_sent' } });
    await openPopup(page);
    await pick(page, A2);
    await toReview(page, 12000);
    await page.click('[data-wd-confirm]');
    await page.waitForFunction(() => !document.getElementById('wdStep4').hidden);
    await page.click('[data-wd-retry]');
    eq(await stepShown(page), ['1'], 'Try again goes back to step 1');
    eq(await page.inputValue('#wdAmount'), '12,000', 'Try again keeps the typed amount');
    await page.waitForFunction(() => document.querySelectorAll('#wdAccountList .wl-acct').length === 2);
    eq(await page.evaluate(() => document.querySelector('input[name="wdAccount"]:checked').value), A2, 'Try again keeps the chosen account');
    eq(await page.evaluate(() => document.querySelector('[data-wd-continue]').disabled), false, 'Continue usable again');
    await page.context().close();
  }

  /* 10 ─ the bank details sheet can announce changes; stale list answers are ignored */
  {
    const page = await newPage(browser, { accounts: [ACCTS[0]] });
    await openPopup(page);
    eq(await page.evaluate(() => document.querySelectorAll('#wdAccountList .wl-acct').length), 1, 'one account at first');
    eq(await page.evaluate(() => document.querySelector('input[name="wdAccount"]').checked), true, 'a single saved account is pre-selected');
    await page.evaluate((a) => { window.__db.accounts = a; }, ACCTS);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('wallet:bank-accounts-changed')));
    await page.waitForFunction(() => document.querySelectorAll('#wdAccountList .wl-acct').length === 2);
    eq(await page.evaluate(() => document.querySelector('input[name="wdAccount"]:checked').value), A1, 'list refreshed, selection kept');
    await page.click('[data-wd-close]');
    const before = (await wdCalls(page)).filter((c) => c === 'from:withdrawal_bank_accounts').length;
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('wallet:bank-accounts-changed')));
    await page.waitForTimeout(150);
    eq((await wdCalls(page)).filter((c) => c === 'from:withdrawal_bank_accounts').length, before, 'announcement ignored while the popup is closed');
    // slow first answer must not overwrite the newer one
    await page.evaluate((a) => { window.__db.accounts = [a[1]]; window.__db.listDelays = [600, 0]; }, ACCTS);
    await page.evaluate(() => document.querySelector('#walletPage [data-action="withdraw"]').click());
    await page.click('[data-wd-close]');
    await page.evaluate((a) => { window.__db.accounts = [a[0]]; }, ACCTS);
    await page.evaluate(() => document.querySelector('#walletPage [data-action="withdraw"]').click());
    await page.waitForTimeout(900);
    eq(await page.evaluate(() => Array.from(document.querySelectorAll('#wdAccountList input')).map((i) => i.value)), [A1], 'a late answer for an earlier opening is ignored');
    await page.context().close();
  }

  /* 11 ─ a customer cannot open the withdrawal popup */
  {
    const page = await newPage(browser, { accounts: ACCTS, role: 'customer' });
    await page.evaluate(() => document.querySelector('#walletPage [data-action="withdraw"]').click());
    await page.waitForTimeout(200);
    eq(await isOpen(page), false, 'customer: the withdrawal popup does not open');
    eq((await wdCalls(page)).filter((c) => c === 'from:withdrawal_bank_accounts').length, 0, 'customer: saved accounts are never read');
    await page.context().close();
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });

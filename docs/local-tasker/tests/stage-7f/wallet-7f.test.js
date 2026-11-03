// (harness copied from the W6c page test and adapted for the current site; see handoff stage-07f.md) W6c page test: the REAL wallet.html, wallet-ui.js, payments.js and wallet-data.js in headless Chromium.
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
      if (name === 'is_active_coordinator') {
        if (db.coordinator === 'throw') throw new Error('network down');
        if (db.coordinator === 'error') return { data: null, error: { code: 'X1', message: 'raw db text' } };
        if (db.coordinator === 'string') return { data: 'true', error: null };
        if (db.coordinator === 'one') return { data: 1, error: null };
        return { data: db.coordinator === true, error: null };
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
  const rpcCalls = (page) => page.evaluate(() => window.__db.calls.filter((c) => c.startsWith('rpc:')).map((c) => c.split(':')[1]));
  const fromCalls = (page) => page.evaluate(() => window.__db.calls.filter((c) => c.startsWith('from:')).map((c) => c.slice(5)));
  const dataRole = (page) => page.evaluate(() => document.getElementById('walletPage').getAttribute('data-role'));
  const owner = (page) => page.evaluate(() => document.getElementById('walletPage').getAttribute('data-wallet-owner'));
  const bal = (page) => page.evaluate(() => (document.querySelector('[data-wl-value="available"]') || {}).textContent);

  const COMMISSION = { id: 'c1', type: 'coordinator_commission', amount: 6000, status: 'completed', reference: 'cc1', created_at: '2026-10-31T10:00:00Z', booking_id: null };
  const EARN = { id: 'e1', type: 'earning', amount: 50000, status: 'completed', reference: 'e1', created_at: '2026-10-29T10:00:00Z' };

  /* 1 ─ an ACTIVE coordinator (users.role is customer) gets the tasker-style wallet */
  {
    const page = await newPage(browser, { role: 'customer', coordinator: true, accounts: ACCTS, txns: [COMMISSION], wallet: { user_id: 'u1', balance: 6000, pending_balance: 0 } }, { body: { status: 'processing', reference: 'wd-new', amount: 3000, fee: 10, net_amount: 2990, bank_name: 'Guaranty Trust Bank', account_last4: '1234', balance_after: 3000, message: 'Your withdrawal is being processed.' } }, 1280);
    eq(await dataRole(page), 'tasker', 'coordinator: tasker-style wallet');
    eq(await owner(page), 'coordinator', 'coordinator: the page says who the wallet owner is');
    ok((await rpcCalls(page)).includes('is_active_coordinator'), 'coordinator: the DATABASE was asked');
    ok((await fromCalls(page)).includes('wallet_transactions'), 'coordinator: the wallet ledger was read');
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#ledgerTasker .wl-tx')).map((li) => ({ title: li.querySelector('.wl-tx-title span').textContent, amt: li.querySelector('.wl-tx-amt').textContent, credit: li.querySelector('.wl-tx-amt').classList.contains('is-credit') })));
    eq(rows.map((r) => r.title), ['Coordinator commission'], 'coordinator: the commission row is in the ledger');
    ok(rows[0] && rows[0].amt.startsWith('+') && rows[0].credit, 'coordinator: commission is a credit with a plus sign');
    eq(await page.evaluate(() => document.querySelector('[data-wl-value="lifetime"]').textContent), '6,000', 'coordinator: commission counts in lifetime earnings');
    await openPopup(page);
    ok(await isOpen(page), 'coordinator: the withdraw popup opens');
    eq(await page.evaluate(() => document.querySelectorAll('#withdrawModal label.wl-acct').length), 2, 'coordinator: both saved accounts are listed in the popup');
    await toReview(page, 3000);
    await page.click('[data-wd-confirm]');
    await page.waitForFunction(() => !document.getElementById('wdStep3').hidden, null, { timeout: 5000 });
    eq(page.sent, [{ action: 'withdraw', amount: 3000, bank_account_id: A1 }], 'coordinator: exactly one request, holding ONLY the action, amount and saved account id (no user id, no role)');
    eq(await txt(page, '#wdStep3 [data-wd="receive"]'), '2,990', 'coordinator: the processing screen shows the amount the SERVER sent');
    eq(page.errs, [], 'coordinator: no console or page errors');
    await page.context().close();
  }
  /* 1a ─ the way back to the coordinator portal (shown only for a coordinator) */
  for (const w of [1280, 390, 320]) {
    const page = await newPage(browser, { role: 'customer', coordinator: true, accounts: ACCTS, txns: [COMMISSION], wallet: { user_id: 'u1', balance: 6000, pending_balance: 0 } }, {}, w);
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('[data-wl-coordinator]')).map((a) => ({ href: a.querySelector('a') ? a.querySelector('a').getAttribute('href') : a.getAttribute('href'), shown: a.offsetParent !== null, text: a.textContent.trim(), right: a.getBoundingClientRect().right })));
    eq(links.filter((l) => l.shown).map((l) => l.href), ['coordinator-dashboard.html'], 'coordinator at ' + w + 'px: exactly one visible way back, to the coordinator overview');
    ok(links.filter((l) => l.shown).every((l) => l.right <= w), 'coordinator at ' + w + 'px: the back link is inside the screen');
    eq(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0), true, 'coordinator at ' + w + 'px: no sideways scroll');
    if (process.env.ST_SHOTS) await page.screenshot({ path: process.env.ST_SHOTS + '/wallet-coordinator-' + w + '.png', fullPage: false });
    await page.context().close();
  }
  for (const [role, co] of [['customer', false], ['tasker', false]]) {
    const page = await newPage(browser, { role, coordinator: co, accounts: ACCTS, txns: [EARN] }, {}, 1280);
    eq(await page.evaluate(() => Array.from(document.querySelectorAll('[data-wl-coordinator]')).filter((a) => a.offsetParent !== null).length), 0, role + ': no coordinator back link is shown');
    await page.context().close();
  }
  /* 1b ─ bank details sheet works for a coordinator (#bank-details) */
  {
    const page = await newPage(browser, { role: 'customer', coordinator: true, accounts: ACCTS }, {}, 390);
    await page.evaluate(() => { location.hash = '#bank-details'; });
    await page.waitForFunction(() => document.getElementById('bankModal').open, null, { timeout: 4000 }).catch(() => {});
    ok(await page.evaluate(() => document.getElementById('bankModal').open), 'coordinator: the bank details sheet opens from #bank-details');
    await page.context().close();
  }
  /* 2 ─ a CUSTOMER (not a coordinator) is unchanged: customer view, no wallet ledger read, no money popup */
  {
    const page = await newPage(browser, { role: 'customer', coordinator: false, accounts: ACCTS, txns: [EARN] }, {}, 1280);
    eq(await dataRole(page), 'customer', 'customer: still the customer view');
    eq(await owner(page), null, 'customer: no wallet-owner marker');
    ok(!(await fromCalls(page)).includes('wallet_transactions') && !(await fromCalls(page)).includes('withdrawal_bank_accounts'), 'customer: the money tables were never read');
    await page.evaluate(() => { const b = document.querySelector('#walletPage [data-action="withdraw"]'); if (b) b.click(); });
    await page.waitForTimeout(300);
    ok(!(await isOpen(page)), 'customer: the withdraw popup does not open');
    await page.context().close();
  }
  /* 3 ─ fail closed: the check errors, throws, or gives anything but the exact answer true */
  for (const mode of ['error', 'throw', 'string', 'one']) {
    const page = await newPage(browser, { role: 'customer', coordinator: mode, accounts: ACCTS, txns: [EARN] }, {}, 390);
    eq(await dataRole(page), 'customer', 'fail closed (' + mode + '): customer view');
    ok(!(await fromCalls(page)).includes('wallet_transactions'), 'fail closed (' + mode + '): no wallet ledger read');
    await page.context().close();
  }
  /* 4 ─ a TASKER is unchanged and the coordinator question is never asked */
  {
    const page = await newPage(browser, { role: 'tasker', coordinator: true, accounts: ACCTS, txns: [EARN] }, {}, 1280);
    eq(await dataRole(page), 'tasker', 'tasker: tasker view');
    eq(await owner(page), null, 'tasker: not marked as a coordinator wallet');
    ok(!(await rpcCalls(page)).includes('is_active_coordinator'), 'tasker: the coordinator question is not asked');
    eq(await page.evaluate(() => document.querySelector('[data-wl-value="lifetime"]').textContent), '50,000', 'tasker: lifetime earnings as before');
    await page.context().close();
  }
  /* 5 ─ the URL cannot make anyone a wallet owner */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage(); page.errs = [];
    await page.route('**/*', async (route) => { const u = route.request().url(); if (u.startsWith('file://')) { const f = decodeURIComponent(u.slice(7).split('?')[0]); return fs.existsSync(f) ? route.continue() : route.abort(); } return route.abort(); });
    await page.addInitScript(initScript, { role: 'customer', coordinator: false, accounts: ACCTS });
    await page.goto('file://' + path.join(repo, 'wallet.html') + '?role=tasker');
    await page.waitForFunction(() => !document.getElementById('walletPage').classList.contains('wl-loading'));
    eq(await dataRole(page), 'customer', '?role=tasker in the address does not make a customer a wallet owner');
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log(failures.join('\n')); process.exit(1); }
})().catch((e) => { console.log('TEST CRASH', e); process.exit(2); });

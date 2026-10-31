// Stage V3b test: runs js/verify.js against a tiny fake DOM and a stubbed Supabase client.
// Run: node --test tests/verify-page.test.mjs   (from the package root; Node 22). In the repo, js/verify.js is the file under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const J = (x) => JSON.parse(JSON.stringify(x));
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pending-ui', 'js', 'verify.js'), 'utf8');
const PANELS = ['NOT_STARTED','IN_PROGRESS','PENDING','VERIFIED','REVIEW_REQUIRED','FAILED','RESUBMIT_REQUESTED','EXPIRED'];

function el(id, attrs = {}) {
  const l = {};
  return { id, attrs: { ...attrs }, hidden: false, disabled: false, checked: false, textContent: '', _l: l,
    getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { (l[t] ||= []).push(f); }, fire(t, ev = {}) { (l[t] || []).forEach(f => f(ev)); },
    scrollIntoView() {}, focus() { this.focused = true; }, closest() { return null; } };
}

function setup({ status = 'NOT_STARTED', consent = false, version = 'v1', search = '', flag = false,
                 rpcFail = false, fnUrl = 'https://verify.didit.me/session/abc', syncFails = false, pageVersion = 'v1' } = {}) {
  const calls = { rpc: [], fn: [], from: [] };
  const ids = {};
  ['verifyLoading','verifyError','verifyNotice','verifyMain','verifyStart','consentBlock','consentCheck','consentSelf','consentDone','verifyStartBtn','verifyContinueBtn']
    .forEach(i => ids[i] = el(i));
  ids.consentBlock.attrs['data-consent-version'] = pageVersion;
  ids.verifyContinueBtn.attrs.href = 'index.html';
  const panels = PANELS.map(n => { const p = el('p-' + n, { 'data-status-panel': n }); p.hidden = true; return p; });
  ['verifyError','verifyNotice','verifyMain','verifyStart','consentDone'].forEach(i => ids[i].hidden = true);
  const btns = {};
  ['start','resume','refresh','retry'].forEach(a => btns[a] = el('b-' + a, { 'data-action': a }));
  Object.values(btns).forEach(b => { b.closest = () => b; });
  ids.verifyMain.querySelectorAll = () => panels;
  const store = {};
  if (flag) store.st_idv_out = String(Date.now());
  const loc = { search, href: 'https://streettasker.com/verify.html' + search, origin: 'https://streettasker.com', pathname: '/verify.html' };
  const server = { status, consent_given: consent, consent_version: version, verified: status === 'VERIFIED' };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: async (name, args) => { calls.rpc.push([name, args]); if (rpcFail) return { error: { message: 'x' } };
      if (name === 'idv_my_status') return { data: server }; if (name === 'idv_give_consent') return { data: { ok: true } }; return { data: null }; },
    from: (t) => { const q = { t, ops: [] }; calls.from.push(q);
      const chain = new Proxy({}, { get: (_, k) => (...a) => { q.ops.push([k, a]); if (k === 'maybeSingle') return Promise.resolve({ data: { is_verified: false } }); return chain; } });
      return chain; },
    functions: { invoke: async (name, o) => { calls.fn.push([name, o.body]);
      if (name === 'didit-sync' && syncFails) return { error: { context: { json: async () => ({ message: 'down' }) } } };
      if (name === 'didit-sync') return { data: { ok: true, status } };
      return { data: { ok: true, url: fnUrl, status: 'NOT_STARTED', reused: false } }; } },
  };
  const document = { readyState: 'complete', getElementById: i => ids[i] || null, addEventListener() {} };
  ids.verifyMain.addEventListener = (t, f) => { (ids.verifyMain._l[t] ||= []).push(f); };
  const win = { setTimeout: () => 0, supabase, ST: { auth: { requireAuth: async () => ({ id: 'u1' }) } }, location: loc, history: { replaceState() {} } };
  const ctx = vm.createContext({ window: win, document, URL, URLSearchParams, Date, Math, console, Promise, parseInt, encodeURIComponent, decodeURIComponent,
    sessionStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } }, setTimeout: () => 0 });
  vm.runInContext(SRC, ctx);
  const click = (a) => ids.verifyMain.fire('click', { target: btns[a] });
  const visible = () => panels.filter(p => !p.hidden).map(p => p.attrs['data-status-panel']);
  return { ids, calls, win, store, click, visible, tick: () => new Promise(r => setImmediate(r)).then(() => new Promise(r => setImmediate(r))) };
}
const settle = async (t) => { for (let i = 0; i < 6; i++) await t.tick(); };

test('not started, no consent: one panel, start area shown, button needs the tick', async () => {
  const t = setup(); await settle(t);
  assert.deepEqual(J(t.visible()), ['NOT_STARTED']);
  assert.equal(t.ids.verifyMain.hidden, false); assert.equal(t.ids.verifyLoading.hidden, true);
  assert.equal(t.ids.verifyStart.hidden, false);
  assert.equal(t.ids.verifyStartBtn.disabled, true);
  t.ids.consentCheck.checked = true; t.ids.consentCheck.fire('change');
  assert.equal(t.ids.verifyStartBtn.disabled, false);
});
test('start: records consent v1, calls create-session with mode+request_id only, redirects to Didit, marks the return', async () => {
  const t = setup(); await settle(t);
  t.ids.consentCheck.checked = true; t.ids.consentCheck.fire('change'); t.click('start'); await settle(t);
  assert.deepEqual(J(t.calls.rpc.filter(c => c[0] === 'idv_give_consent')), [['idv_give_consent', { p_version: 'v1' }]]);
  const f = t.calls.fn.filter(c => c[0] === 'didit-create-session');
  assert.equal(f.length, 1); assert.deepEqual(J(Object.keys(f[0][1]).sort()), ['mode', 'request_id']); assert.equal(f[0][1].mode, 'self');
  assert.equal(t.win.location.href, 'https://verify.didit.me/session/abc');
  assert.ok(t.store.st_idv_out);
});
test('a link that is not https on didit.me is refused (no redirect)', async () => {
  for (const bad of ['https://evil.com/x', 'http://didit.me/x', 'javascript:alert(1)', 'https://didit.me.evil.com/x']) {
    const t = setup({ fnUrl: bad }); await settle(t);
    t.ids.consentCheck.checked = true; t.ids.consentCheck.fire('change'); t.click('start'); await settle(t);
    assert.ok(!/didit|evil|javascript/.test(t.win.location.href.replace('streettasker.com','')) , bad);
    assert.equal(t.ids.verifyError.hidden, false, bad);
  }
});
test('consent already given for this version: tick hidden, start enabled, no second consent call', async () => {
  const t = setup({ consent: true }); await settle(t);
  assert.equal(t.ids.consentSelf.hidden, true); assert.equal(t.ids.consentDone.hidden, false);
  assert.equal(t.ids.verifyStartBtn.disabled, false);
  t.click('start'); await settle(t);
  assert.equal(t.calls.rpc.filter(c => c[0] === 'idv_give_consent').length, 0);
  assert.equal(t.calls.fn.filter(c => c[0] === 'didit-create-session').length, 1);
});
test('consent version mismatch (page v1, server v2): error shown, start stays disabled', async () => {
  const t = setup({ version: 'v2', consent: true }); await settle(t);
  assert.equal(t.ids.verifyError.hidden, false); assert.equal(t.ids.verifyStartBtn.disabled, true);
});
test('every status shows exactly its panel; ABANDONED shows FAILED; start area only for NOT_STARTED/FAILED/EXPIRED', async () => {
  for (const [s, shown, startArea] of [['NOT_STARTED','NOT_STARTED',true],['IN_PROGRESS','IN_PROGRESS',false],['PENDING','PENDING',false],['VERIFIED','VERIFIED',false],
    ['REVIEW_REQUIRED','REVIEW_REQUIRED',false],['FAILED','FAILED',true],['ABANDONED','FAILED',true],['RESUBMIT_REQUESTED','RESUBMIT_REQUESTED',false],['EXPIRED','EXPIRED',true]]) {
    const t = setup({ status: s }); await settle(t);
    assert.deepEqual(J(t.visible()), [shown], s); assert.equal(!t.ids.verifyStart.hidden, startArea, s);
  }
});
test('VERIFIED: continue link follows a same-site return, ignores an outside one and verify.html itself', async () => {
  let t = setup({ status: 'VERIFIED', search: '?return=' + encodeURIComponent('https://streettasker.com/post-task.html?x=1') }); await settle(t);
  assert.equal(t.ids.verifyContinueBtn.attrs.href, '/post-task.html?x=1');
  for (const bad of ['https://evil.com/a', '//evil.com/a', '/verify.html', 'javascript:alert(1)']) {
    t = setup({ status: 'VERIFIED', search: '?return=' + encodeURIComponent(bad) }); await settle(t);
    assert.equal(t.ids.verifyContinueBtn.attrs.href, 'index.html', bad);
  }
});
test('returning from Didit: sync runs with returned:true BEFORE the status read, flag cleared', async () => {
  const t = setup({ status: 'PENDING', flag: true }); await settle(t);
  assert.deepEqual(J(t.calls.fn[0]), ['didit-sync', { mode: 'self', returned: true }]);
  assert.equal(t.store.st_idv_out, undefined);
  assert.deepEqual(J(t.visible()), ['PENDING']);
});
test('no return mark: the page does not call sync on load', async () => {
  const t = setup({ status: 'PENDING' }); await settle(t);
  assert.equal(t.calls.fn.length, 0);
});
test('sync failure on return: notice shown, last saved status still displayed', async () => {
  const t = setup({ status: 'PENDING', flag: true, syncFails: true }); await settle(t);
  assert.equal(t.ids.verifyNotice.hidden, false); assert.deepEqual(J(t.visible()), ['PENDING']);
});
test('server read fails: error shown, no panel claims success', async () => {
  const t = setup({ rpcFail: true }); await settle(t);
  assert.equal(t.ids.verifyError.hidden, false); assert.deepEqual(J(t.visible()), []); assert.equal(t.ids.verifyMain.hidden, true);
});
test('"Check again" calls sync with returned:false then reads again', async () => {
  const t = setup({ status: 'PENDING' }); await settle(t);
  t.click('refresh'); await settle(t);
  assert.deepEqual(J(t.calls.fn.at(-1)), ['didit-sync', { mode: 'self', returned: false }]);
  assert.ok(t.calls.rpc.filter(c => c[0] === 'idv_my_status').length >= 2);
});
test('nothing the page does writes a verification flag or status', async () => {
  for (const s of ['NOT_STARTED','VERIFIED','FAILED']) {
    const t = setup({ status: s }); await settle(t);
    if (s === 'NOT_STARTED') { t.ids.consentCheck.checked = true; t.ids.consentCheck.fire('change'); t.click('start'); await settle(t); }
    for (const q of t.calls.from) {
      const writes = q.ops.filter(o => ['update','insert','upsert','delete'].includes(o[0]));
      if (writes.length) { assert.ok(['tasks','services'].includes(q.t), 'write to ' + q.t); assert.ok(s === 'VERIFIED', 'drafts only after VERIFIED'); }
      assert.ok(!['verifications','identity_verifications','identity_verification_consents'].includes(q.t));
    }
  }
});
test('source check: no browser write to users/taskers/verifications, no innerHTML, no ID-number code', () => {
  assert.ok(!/from\(\s*['"](verifications|taskers|identity_verifications)['"]/.test(SRC));
  assert.ok(!/is_verified\s*:\s*true|process_verification|verified_at\s*:/.test(SRC));
  const writers = [...SRC.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)\s*\.(update|insert|upsert|delete)/g)].map(m => m[1]);
  assert.deepEqual(writers.sort(), ['services', 'tasks']);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(SRC));
  assert.ok(!/id_number|idNumber|validateIdFormat/.test(SRC));
});
test('legacy helpers: status mapping for dashboards and isUserVerified is read-only', async () => {
  const map = { VERIFIED: 'approved', PENDING: 'pending', IN_PROGRESS: 'pending', REVIEW_REQUIRED: 'pending', FAILED: 'rejected', EXPIRED: 'rejected', ABANDONED: 'rejected' };
  for (const [k, v] of Object.entries(map)) {
    const t = setup({ status: k }); await settle(t);
    const r = await t.win.ST.verify.getVerificationStatus();
    assert.equal(r.status, v, k); assert.equal(r.rejection_reason, '');
  }
  const t = setup({ status: 'NOT_STARTED' }); await settle(t);
  assert.equal(await t.win.ST.verify.getVerificationStatus(), null);
  assert.equal(await t.win.ST.verify.isUserVerified(), false);
});
